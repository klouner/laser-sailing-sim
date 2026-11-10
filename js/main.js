import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoat, HULL } from './boat.js';
import { makeSky, makeShore, HAZE, makeClouds, makeWater, makeCompassRing, VectorArrow, makeWindStreaks, makeWake, makeSpray, makeBoatReflection, setLabelScale } from './scene.js';
import { createState, defaultControls, step, settleRig, norm180, norm360, compassName, optimalSheet, KN, PHYS_DT, BOAT } from './physics.js';
import { createMinimap } from './hud.js';
import { createCourse, fmtTime } from './course.js';
import { createEnvironment } from './env.js';
import { LESSONS, createLessonRunner } from './lessons.js';
import { loadTop, isRecord, submit, rememberName, savedName, isShared } from './leaderboard.js';
import { initAnalytics } from './analytics.js';
import { createAudio } from './audio.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

// ---------- рендер ----------
const canvas = $('scene');
// Профиль качества: на телефоне дешевле тени и нет двойного сглаживания (при плотности ≥2 оно почти не видно)
const isTouch = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
// Уровни качества. fx: 0 — без эффектов, 1 — брызги и пена, 2 — ещё и отражение лодки в воде.
const DEVICE_DPR = window.devicePixelRatio || 1;
const LEVELS = {
  low: { maxDpr: Math.min(DEVICE_DPR, 1), minDpr: 0.75, shadow: 512, fx: 0 },
  med: { maxDpr: Math.min(DEVICE_DPR, 1.5), minDpr: 1, shadow: 1024, fx: 1 },
  high: { maxDpr: Math.min(DEVICE_DPR, 2), minDpr: 1, shadow: 2048, fx: 2 },
};
const LEVEL_NAME = { low: 'низкое', med: 'среднее', high: 'высокое' };
const prefs = { quality: 'auto', fps: false, sound: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('laser3d.view') || '{}')); } catch (e) {}
if (!LEVELS[prefs.quality]) prefs.quality = 'auto';
const savePrefs = () => { try { localStorage.setItem('laser3d.view', JSON.stringify(prefs)); } catch (e) {} };
const audio = createAudio(), sound = { aws: 0, speed: 0, luff: 0, sheet: 45, slam: 0, paused: false };
audio.setEnabled(false);
// звук можно включить только из обработчика действия пользователя: первое касание или клавиша
const unlockAudio = () => { if (prefs.sound) audio.setEnabled(true); };
window.addEventListener('pointerdown', unlockAudio, { passive: true }); window.addEventListener('keydown', unlockAudio);
const autoLevel = isTouch ? 'med' : 'high';
let level = prefs.quality === 'auto' ? autoLevel : prefs.quality;
let QUALITY = LEVELS[level];
// сглаживание и тип теней задаются один раз при создании контекста; остальное меняется на лету
const renderer = new THREE.WebGLRenderer({ canvas, antialias: level !== 'low' && !(isTouch && DEVICE_DPR >= 2), powerPreference: 'high-performance' });
let dpr = QUALITY.maxDpr;
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = !isTouch && level !== 'low' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 180, 1500);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(-8, 4.5, 6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 3; controls.maxDistance = 60;
controls.target.set(0, 0.8, 0);

// свет
const sunDir = new THREE.Vector3(0.45, 0.6, -0.65).normalize();
const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
sun.position.copy(sunDir).multiplyScalar(40);
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
sun.shadow.camera.near = 5; sun.shadow.camera.far = 90;
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.HemisphereLight('#bcd7f5', '#1b4a70', 0.9));

// окружение для отражений (простая градиентная сцена)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(makeSky(sunDir, true));
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
}

const sky = makeSky(sunDir); scene.add(sky);
const shore = makeShore(); scene.add(shore);
const clouds = makeClouds(); scene.add(clouds);
const env = createEnvironment();   // волны и порывы: общие для физики, качки и шейдеров
const water = makeWater(env); scene.add(water);
const compass = makeCompassRing(env); scene.add(compass);
const streaks = makeWindStreaks(); scene.add(streaks);
const wake = makeWake(env); scene.add(wake);
// фиксированный порядок прозрачных слоёв: вода → кильватер → компас (иначе сортировка по расстоянию даёт мерцание)
water.renderOrder = 1;
compass.traverse((o) => { if (o.isMesh || o.isLine || o.isLineSegments) o.renderOrder = 3; });
streaks.renderOrder = 4;

const boat = createBoat(env); scene.add(boat.root);
const spray = makeSpray(env); scene.add(spray);
// отражение рисует только лодку: она и свет помечены слоем 1
let reflection = null;
boat.root.traverse((o) => o.layers.enable(1));
scene.traverse((o) => { if (o.isLight) o.layers.enable(1); });
const sprayE = { x: 0, z: 0, fx: 0, fz: -1, sx: 1, sz: 0, vx: 0, vz: 0, wx: 0, wz: 0, heave: 0, sf: 0, speed: 0 };

const arrows = {
  trueWind: new VectorArrow(scene, 'rgb(0,71,255)', 'Истинный ветер'),
  appWind: new VectorArrow(scene, 'rgb(141,176,255)', 'Вымпельный ветер'),
  vel: new VectorArrow(scene, 'rgb(255,255,255)', 'Скорость лодки'),
  force: new VectorArrow(scene, 'rgb(255,87,0)', 'Сила на парусе'),
};
arrows.trueWind.labelAt = 0.0; arrows.trueWind.labelLift = 0.3;
arrows.appWind.labelAt = 0.4; arrows.appWind.labelLift = 0.3;
arrows.vel.labelAt = 1.0; arrows.vel.labelLift = 0.3;
arrows.force.labelAt = 1.0; arrows.force.labelLift = 0.3;

const course = createCourse(scene, env);
const lessons = createLessonRunner();

// ---------- состояние ----------
const state = createState();
const ctl = defaultControls();
settleRig(state, ctl);
ctl.heading = state.heading;
const show = { trueWind: true, appWind: true, vel: true, force: true, noGo: true, streaks: true, labels: !isTouch, sailor: true };
$('showLabels').checked = show.labels;
let camMode = 'chase';
const keys = {};
let autopilot = null; // { target }
let holdTarget = null; // курс, который матрос держит при отпущенном руле
const drawMinimap = createMinimap($('minimap'));

// ---------- UI ----------
const ui = {
  windFrom: $('windFrom'), windSpeed: $('windSpeed'), heading: $('heading'), sheet: $('sheet'), rudder: $('rudder'),
  autoSheet: $('autoSheet'), lockHeading: $('lockHeading'), rudderReturn: $('rudderReturn'), holdCourse: $('holdCourse'),
};
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
function setRudder(v) { ctl.rudder = THREE.MathUtils.clamp(v, -35, 35); ui.rudder.value = Math.round(ctl.rudder); autopilot = null; holdTarget = null; }
function setSheet(v) { ctl.sheet = THREE.MathUtils.clamp(v, BOAT.boomMin, 90); ui.sheet.value = Math.round(ctl.sheet); ctl.autoSheet = false; ui.autoSheet.checked = false; $('t-auto').classList.remove('active'); }
function setWindFrom(v) { ctl.windFrom = ((v % 360) + 360) % 360; ui.windFrom.value = Math.round(ctl.windFrom); }
function setAutoSheet(v) { if (v && (raceLocked() || lessons.run.status === 'running')) { toast('Автошкот недоступен в уроках и гонке'); v = false; } ctl.autoSheet = v; ui.autoSheet.checked = v; $('t-auto').classList.toggle('active', v); }

const raceLocked = () => course.race.active && course.race.phase !== 'finished';
ui.windFrom.addEventListener('input', () => { if (raceLocked()) { ui.windFrom.value = ctl.windFrom; return; } ctl.windFrom = +ui.windFrom.value; if (devCompass.on) setCompass(false); });
ui.windSpeed.addEventListener('input', () => { if (raceLocked()) { ui.windSpeed.value = ctl.windSpeed; return; } ctl.windSpeed = +ui.windSpeed.value; });
ui.heading.addEventListener('input', () => { if (raceLocked() || lessons.run.status === 'running') { ui.heading.value = Math.round(state.heading); return; } state.heading = +ui.heading.value; state.yawRate = 0; autopilot = null; holdTarget = null; if (state.capsized) settleRig(state, ctl); });
ui.sheet.addEventListener('input', () => { setSheet(+ui.sheet.value); });
ui.rudder.addEventListener('input', () => { ctl.rudder = +ui.rudder.value; autopilot = null; holdTarget = null; });
ui.rudder.addEventListener('change', () => { if (ui.rudderReturn.checked) { ctl.rudder = 0; ui.rudder.value = 0; } });
ui.autoSheet.addEventListener('change', () => { setAutoSheet(ui.autoSheet.checked); });
ui.lockHeading.addEventListener('change', () => { ctl.lockHeading = ui.lockHeading.checked; });
// настройки паруса: авто или вручную
const trimIds = ['vang', 'cunn', 'out'];
function setAutoTrim(v) {
  ctl.autoTrim = v; $('autoTrim').checked = v; setText('trim-mode', v ? 'авто' : 'вручную');
  for (const id of trimIds) { $(id).disabled = v; if (!v) ctl[id] = state.trim[id]; }
}
$('autoTrim').addEventListener('change', (e) => setAutoTrim(e.target.checked));
// уроки сами включают ручные настройки и выставляют их: панель подстраивается под то, что стоит в управлении
function syncTrimUI() {
  $('autoTrim').checked = ctl.autoTrim; setText('trim-mode', ctl.autoTrim ? 'авто' : 'вручную');
  for (const id of trimIds) { $(id).disabled = ctl.autoTrim; if (!ctl.autoTrim) $(id).value = Math.round(ctl[id] * 100); }
  if (!ctl.autoTrim) $('trim').open = true;
}
for (const id of trimIds) $(id).addEventListener('input', (e) => { ctl[id] = +e.target.value / 100; });
$('gusts').addEventListener('change', (e) => { if (raceLocked() || lessons.run.status === 'running') { e.target.checked = false; toast('В уроках и гонке ветер ровный'); return; } ctl.gusts = e.target.checked; });

$('btn-pause').addEventListener('click', togglePause);
$('btn-reset').addEventListener('click', reset);
$('btn-tack').addEventListener('click', () => {
  if (raceLocked() || lessons.run.status === 'running') { toast('В уроках и гонке поворот делаем рулём вручную'); return; }
  const twa = norm180(ctl.windFrom - state.heading);
  if (Math.abs(twa) > 95) { // на попутных курсах — поворот фордевинд
    autopilot = { target: ctl.windFrom + 180 + (twa > 0 ? -40 : 40) };
  } else {
    // новый курс зеркален старому относительно ветра: тот же угол к ветру, но другим бортом
    autopilot = { target: ctl.windFrom + Math.sign(twa || 1) * Math.max(45, Math.abs(twa)) };
  }
  ui.lockHeading.checked = false; ctl.lockHeading = false;
});
document.querySelectorAll('#cam-seg button').forEach(b => b.addEventListener('click', () => setCamera(b.dataset.cam)));
for (const [id, key] of [['showTrue', 'trueWind'], ['showApp', 'appWind'], ['showVel', 'vel'], ['showForce', 'force'], ['showNoGo', 'noGo'], ['showStreaks', 'streaks'], ['showLabels', 'labels'], ['showSailor', 'sailor']]) {
  $(id).addEventListener('change', (e) => { show[key] = e.target.checked; if (key === 'sailor') boat.setSailor(show.sailor); });
}

// ---------- ветер по компасу устройства ----------
const devCompass = { on: false, heading: null, smooth: null };
function onOrientation(e) {
  let hd = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) hd = e.webkitCompassHeading; // iOS
  else if (e.absolute && typeof e.alpha === 'number') hd = (360 - e.alpha) % 360; // Android
  else if (typeof e.alpha === 'number') hd = (360 - e.alpha) % 360;
  if (hd === null) return;
  // учёт поворота экрана
  const so = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  devCompass.heading = ((hd + so) % 360 + 360) % 360;
}
async function setCompass(on) {
  if (on && raceLocked()) { toast('Во время гонки ветер фиксирован'); on = false; }
  if (on) {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') throw new Error('denied');
      }
      if (!('DeviceOrientationEvent' in window)) throw new Error('unsupported');
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
      window.addEventListener('deviceorientation', onOrientation, true);
      devCompass.on = true; devCompass.heading = null; devCompass.smooth = null;
      $('compassState').textContent = '— ждём данные компаса…';
    } catch (err) {
      devCompass.on = false;
      $('compassState').textContent = err.message === 'denied' ? '— нет разрешения на датчики' : '— компас недоступен на этом устройстве';
    }
  } else {
    window.removeEventListener('deviceorientationabsolute', onOrientation, true);
    window.removeEventListener('deviceorientation', onOrientation, true);
    devCompass.on = false; $('compassState').textContent = '';
  }
  $('compassWind').checked = devCompass.on;
  $('t-compass').classList.toggle('active', devCompass.on);
}
$('compassWind').addEventListener('change', (e) => setCompass(e.target.checked));
$('t-compass').addEventListener('click', () => setCompass(!devCompass.on));
function updateCompass(dt) {
  if (!devCompass.on || devCompass.heading === null) return;
  if (devCompass.smooth === null) devCompass.smooth = devCompass.heading;
  devCompass.smooth = ((devCompass.smooth + norm180(devCompass.heading - devCompass.smooth) * Math.min(1, dt * 6)) % 360 + 360) % 360;
  setWindFrom(devCompass.smooth);
  $('compassState').textContent = `— ${Math.round(devCompass.smooth)}°`;
}
$('btn-panel').addEventListener('click', () => $('panel').classList.toggle('open'));
$('hud').addEventListener('click', () => { $('hud').classList.toggle('min'); layoutDirty = true; });

// ---------- сенсорное управление ----------
// встроенные браузеры (Telegram, VK, Instagram) тянут страницу при вертикальном свайпе — глушим жесты вне прокручиваемой панели
const panelEl = $('panel');
document.addEventListener('touchmove', (e) => {
  if (panelEl.contains(e.target)) return;
  if (e.cancelable) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
let padActive = false;
function bindPad(el, thumb, horizontal, onValue, onRelease, holds = false) {
  const track = el.querySelector('.pad-track');
  let id = null;
  const apply = (e) => {
    const r = track.getBoundingClientRect();
    const th = thumb.offsetWidth || 36;
    if (horizontal) { const half = r.width / 2 - th / 2; onValue(THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / half, -1, 1)); }
    else { const usable = r.height - th; onValue(THREE.MathUtils.clamp((e.clientY - r.top - th / 2) / usable, 0, 1)); }
  };
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); el.classList.add('active'); if (holds) padActive = true; apply(e); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) apply(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; el.classList.remove('active'); if (holds) padActive = false; onRelease && onRelease(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
bindPad($('t-rudder'), $('t-rudder-thumb'), true, (k) => setRudder(k * 35), null, true);
bindPad($('t-sheet'), $('t-sheet-thumb'), false, (k) => setSheet(BOAT.boomMin + k * (90 - BOAT.boomMin)));
$('t-pause').addEventListener('click', togglePause);
$('t-cam').addEventListener('click', () => { setCamera(CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]); });
// из кокпита взгляд поворачивается перетаскиванием
canvas.addEventListener('pointerdown', (e) => { if (camMode === 'cockpit') { look.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => {
  if (camMode !== 'cockpit' || !look.drag || look.drag.id !== e.pointerId) return;
  look.yaw = THREE.MathUtils.clamp(look.yaw + (e.clientX - look.drag.x) * 0.006, -2.7, 2.7);
  look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - look.drag.y) * 0.005, -1.0, 1.0);
  look.drag.x = e.clientX; look.drag.y = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { look.drag = null; });
$('t-tack').addEventListener('click', () => $('btn-tack').click());
$('t-auto').addEventListener('click', () => setAutoSheet(!ctl.autoSheet));
$('t-panel').addEventListener('click', () => $('panel').classList.toggle('open'));
$('t-windChip').addEventListener('click', () => $('panel').classList.add('open'));
$('t-windL').addEventListener('click', () => setWindFrom(ctl.windFrom - 10));
$('t-windR').addEventListener('click', () => setWindFrom(ctl.windFrom + 10));
// закрыть шторку тапом по сцене
canvas.addEventListener('pointerdown', () => $('panel').classList.remove('open'));
const padGeom = { tw: 36, trackW: 200, tsz: 36, trackH: 100, left: '', top: '' };
const thumbR = $('t-rudder-thumb'), thumbS = $('t-sheet-thumb');
function measurePads() {
  padGeom.tw = thumbR.offsetWidth || 36; padGeom.trackW = thumbR.parentElement.clientWidth || 200;
  padGeom.tsz = thumbS.offsetHeight || 36; padGeom.trackH = thumbS.parentElement.clientHeight || 100;
}
function updateTouch() {
  const left = (50 + ctl.rudder / 35 * 50 * (1 - padGeom.tw / Math.max(padGeom.tw, padGeom.trackW))).toFixed(2) + '%';
  if (left !== padGeom.left) { padGeom.left = left; thumbR.style.left = left; }
  const usable = Math.max(1, padGeom.trackH - padGeom.tsz);
  const top = (padGeom.tsz / 2 + Math.max(0, ctl.sheetShown - BOAT.boomMin) / (90 - BOAT.boomMin) * usable).toFixed(1) + 'px';
  if (top !== padGeom.top) { padGeom.top = top; thumbS.style.top = top; }
}

function togglePause() {
  ctl.paused = !ctl.paused;
  $('btn-pause').textContent = ctl.paused ? 'Продолжить' : 'Пауза';
  $('btn-pause').classList.toggle('active', ctl.paused);
  $('t-pause').classList.toggle('active', ctl.paused);
}
function reset() {
  const s = createState();
  Object.assign(state, s); holdTarget = null;
  state.heading = 90; ctl.rudder = 0; ui.rudder.value = 0; autopilot = null;
  ctl.sheet = 45; ui.sheet.value = 45; settleRig(state, ctl);
  if (camMode !== 'free') setCamera(camMode);
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyC') setCamera(CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]);
  if (e.code === 'KeyV') { const v = !show.trueWind; for (const k of ['trueWind', 'appWind', 'vel', 'force']) show[k] = v; ['showTrue', 'showApp', 'showVel', 'showForce'].forEach(id => $(id).checked = v); }
  if (e.code === 'KeyT') $('btn-tack').click();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function handleKeys(dt) {
  const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
  const inS = keys.ArrowUp || keys.KeyW, outS = keys.ArrowDown || keys.KeyS;
  if (left || right) { autopilot = null; ctl.rudder = THREE.MathUtils.clamp(ctl.rudder + (right ? 1 : -1) * 70 * dt, -35, 35); ui.rudder.value = Math.round(ctl.rudder); }
  else if (ui.rudderReturn.checked && !autopilot && !padActive && document.activeElement !== ui.rudder) {
    if (ui.holdCourse.checked && !ctl.paused && !ctl.lockHeading && !state.capsized) {
      // матрос удерживает курс: видно, какой руль нужен, чтобы лодка не приводилась
      if (holdTarget === null) holdTarget = state.heading + state.yawRate * 0.35;
      const err = norm180(holdTarget - state.heading);
      if (Math.abs(err) > 50) holdTarget = state.heading;
      const want = THREE.MathUtils.clamp(err * 1.3 - state.yawRate * 0.4, -25, 25);
      ctl.rudder += (want - ctl.rudder) * Math.min(1, dt * 8);
    } else {
      const k = Math.min(1, dt * 5); ctl.rudder += (0 - ctl.rudder) * k; if (Math.abs(ctl.rudder) < 0.3) ctl.rudder = 0;
    }
    ui.rudder.value = Math.round(ctl.rudder);
  }
  if (left || right || padActive || autopilot || document.activeElement === ui.rudder || ctl.lockHeading || state.capsized) holdTarget = null;
  if (inS || outS) { ctl.autoSheet = false; ui.autoSheet.checked = false; ctl.sheet = THREE.MathUtils.clamp(ctl.sheet + (outS ? 1 : -1) * 40 * dt, BOAT.boomMin, 90); ui.sheet.value = Math.round(ctl.sheet); }
}

// ---------- тренировка: уроки, гонка, рекорды ----------
let toastTimer = 0;
function toast(text, big = false, ms = 2200) {
  const el = $('toast'); el.textContent = text; el.className = 'toast' + (big ? ' big' : ''); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const tb = { bar: $('trainbar'), tag: $('tb-tag'), title: $('tb-title'), time: $('tb-time'), goal: $('tb-goal'), fill: $('tb-fill'), note: $('tb-note'), next: $('tb-next'), retry: $('tb-retry'), exit: $('tb-exit') };
let mode = 'free'; // free | lesson | race
const passed = new Set(JSON.parse(localStorage.getItem('laser3d.passed') || '[]'));
function savePassed() { try { localStorage.setItem('laser3d.passed', JSON.stringify([...passed])); } catch (e) {} }
function renderLessonList() {
  const box = $('lesson-list'); box.innerHTML = '';
  let group = null;
  LESSONS.forEach((L, i) => {
    if (L.group && L.group !== group) { group = L.group; const hd = document.createElement('div'); hd.className = 'lesson-group'; hd.textContent = group; box.appendChild(hd); }
    const b = document.createElement('button'); b.className = 'lesson' + (passed.has(L.id) ? ' passed' : '') + (mode === 'lesson' && lessons.run.index === i ? ' active' : '');
    b.innerHTML = `<span class="n">${passed.has(L.id) ? '✓' : i + 1}</span><span>${L.title}</span>`;
    b.addEventListener('click', () => { startLesson(i); $('panel').classList.remove('open'); });
    box.appendChild(b);
  });
}
let gustsBefore = null;
function resetForTraining() {
  const s = createState(); Object.assign(state, s); holdTarget = null; physAcc = 0;
  if (gustsBefore === null) gustsBefore = ctl.gusts;
  ctl.gusts = false; $('gusts').checked = false;
  ctl.rudder = 0; ui.rudder.value = 0; autopilot = null; setCompass(false);
  ctl.lockHeading = false; ui.lockHeading.checked = false; setAutoSheet(false);
  if (ctl.paused) togglePause();
}
function startLesson(i) {
  if (course.race.active) course.stop();
  resetForTraining();
  mode = 'lesson';
  lessons.start(i, state, ctl);
  const L = lessons.run.lesson;
  course.showCourse(!!L.usesCourse);
  ui.sheet.value = ctl.sheet; ui.windFrom.value = ctl.windFrom; ui.windSpeed.value = ctl.windSpeed;
  tb.bar.hidden = false; tb.bar.className = 'trainbar'; tb.next.hidden = true;
  tb.tag.textContent = `УРОК ${i + 1}/${LESSONS.length}`; tb.title.textContent = L.title; tb.goal.textContent = L.goal; tb.time.textContent = ''; tb.note.textContent = ''; tb.fill.style.width = '0%';
  renderLessonList(); setCamera(camMode === 'free' ? 'chase' : camMode); lastHeading = state.heading; showGoal(9000);
}
function startRace() {
  lessons.stop(ctl);
  resetForTraining();
  mode = 'race';
  course.start(state, ctl);
  ui.sheet.value = ctl.sheet; ui.windFrom.value = ctl.windFrom; ui.windSpeed.value = ctl.windSpeed;
  tb.bar.hidden = false; tb.bar.className = 'trainbar'; tb.next.hidden = true;
  tb.tag.textContent = 'ГОНКА'; tb.title.textContent = 'Два буя'; tb.goal.textContent = 'Обогни оранжевый буй (110 м против ветра): пройди выше него и вернись с другой стороны. Финиш между синими буями.';
  tb.note.textContent = ''; tb.fill.style.width = '0%'; tb.time.textContent = '';
  renderLessonList(); setCamera(camMode === 'free' ? 'chase' : camMode); lastHeading = state.heading; showGoal(6000);
  toast('3', true, 900);
}
function exitTraining() {
  lessons.stop(ctl); course.stop(); mode = 'free';
  if (gustsBefore !== null) { ctl.gusts = gustsBefore; $('gusts').checked = ctl.gusts; gustsBefore = null; }
  tb.bar.hidden = true; renderLessonList();
}
let goalTimer = 0;
function showGoal(ms = 7000) { tb.bar.classList.add('show-goal'); clearTimeout(goalTimer); if (ms) goalTimer = setTimeout(() => tb.bar.classList.remove('show-goal'), ms); }
$('trainbar').querySelector('.tb-main').addEventListener('click', () => { if (tb.bar.classList.contains('show-goal')) { clearTimeout(goalTimer); tb.bar.classList.remove('show-goal'); } else showGoal(0); });
tb.exit.addEventListener('click', exitTraining);
tb.retry.addEventListener('click', () => { if (mode === 'race') startRace(); else if (mode === 'lesson') startLesson(lessons.run.index); });
tb.next.addEventListener('click', () => {
  if (mode === 'lesson') { const i = lessons.run.index + 1; if (i < LESSONS.length) startLesson(i); else startRace(); }
  else startRace();
});
$('btn-race').addEventListener('click', () => { startRace(); $('panel').classList.remove('open'); });
$('btn-course').addEventListener('click', () => {
  // свободная тренировка на трассе: буи видны, лодка на старте, ветер с севера, без таймера
  lessons.stop(ctl); course.stop(); mode = 'free'; tb.bar.hidden = true;
  const s = createState(); Object.assign(state, s);
  state.x = 0; state.z = 12; state.heading = 45; state.vf = 1.5; holdTarget = null; settleRig(state, ctl);
  ctl.windFrom = 0; ui.windFrom.value = 0; ctl.rudder = 0; ui.rudder.value = 0; autopilot = null; setCompass(false);
  if (ctl.paused) togglePause();
  course.showCourse(true); renderLessonList();
  setCamera(camMode === 'free' ? 'chase' : camMode); lastHeading = state.heading;
  $('panel').classList.remove('open');
  toast('Буи на воде: оранжевый в 110 м против ветра, синие ворота у старта', false, 3500);
});
$('t-train').addEventListener('click', () => { $('panel').classList.add('open'); $('card-train').scrollIntoView({ block: 'start' }); });
renderLessonList();

// таблица лидеров
let top = [];
function renderTop() {
  $('lb-best').textContent = top.length ? `${fmtTime(top[0].time)} · ${top[0].name}` : 'Рекордов пока нет';
  $('lb-scope').textContent = isShared ? '· общая' : '· на этом устройстве';
  const ol = $('lb-ol'); ol.innerHTML = '';
  const me = savedName();
  top.forEach((e) => { const li = document.createElement('li'); li.innerHTML = `${e.name}<span>${fmtTime(e.time)}</span>`; if (me && e.name === me) li.classList.add('me'); ol.appendChild(li); });
  if (!top.length) { const li = document.createElement('li'); li.textContent = 'Пройди гонку первым!'; li.style.listStyle = 'none'; li.style.marginLeft = '-22px'; ol.appendChild(li); }
}
$('lb-chip').addEventListener('click', () => { $('lb-list').hidden = !$('lb-list').hidden; });
loadTop().then((t) => { top = t; renderTop(); });
function askName(time) {
  const modal = $('name-modal'), input = $('name-input');
  $('modal-time').textContent = fmtTime(time); input.value = savedName(); modal.hidden = false; setTimeout(() => input.focus(), 50);
  const done = async (save) => {
    modal.hidden = true; okB.removeEventListener('click', onOk); skipB.removeEventListener('click', onSkip);
    if (save) { const name = input.value.trim() || 'Без имени'; rememberName(name); top = await submit(name, time); renderTop(); $('lb-list').hidden = false; toast('Записано в топ-10'); }
  };
  const okB = $('name-ok'), skipB = $('name-skip');
  const onOk = () => done(true), onSkip = () => done(false);
  okB.addEventListener('click', onOk); skipB.addEventListener('click', onSkip);
  input.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
}
let wasCapsized = false;
function updateTraining(out, dt, t) {
  if (out.capsized && !wasCapsized) { audio.splash(); toast('ОВЕРКИЛЬ', true, 2500); if (mode === 'lesson' && lessons.run.status === 'running') { lessons.run.status = 'failed'; lessons.run.fail = 'Оверкиль: крен стал критическим. В порыве травите шкот и приводитесь, откренивайте заранее.'; tb.bar.classList.add('fail'); tb.note.textContent = lessons.run.fail; } }
  wasCapsized = !!out.capsized;
  if (mode === 'race') {
    const r = course.race;
    if (r.phase === 'countdown') {
      ctl.paused = true;
      const n = Math.ceil(r.countdown); tb.time.textContent = String(n);
      if (n !== updateTraining.lastN) { updateTraining.lastN = n; if (n > 0) toast(String(n), true, 900); }
    }
    const ev = course.update(state, ctl, dt, t);
    if (ev === 'go') { ctl.paused = false; toast('СТАРТ!', true, 1200); $('btn-pause').textContent = 'Пауза'; $('t-pause').classList.remove('active'); }
    if (ev === 'rounded') toast('Буй обогнут! Теперь по ветру, финиш между синими буями', false, 2800);
    if (ev === 'notRounded') toast('Буй не обогнут: пройдите выше него и вернитесь с другой стороны', false, 3200);
    if (ev === 'missedGate') toast('Мимо ворот: финиш между синими буями', false, 2800);
    if (r.phase === 'leg1' || r.phase === 'leg2') {
      tb.time.textContent = fmtTime(r.t);
      tb.note.textContent = `${r.phase === 'leg1' ? 'К оранжевому бую' : 'К финишным воротам'} · ${Math.round(r.dist)} м · пеленг ${Math.round(r.bearing)}°`;
      const legLen = 110; const p = r.phase === 'leg1' ? 0.5 * (1 - Math.min(1, r.dist / legLen)) : 0.5 + 0.5 * (1 - Math.min(1, r.dist / legLen));
      tb.fill.style.width = (p * 100).toFixed(1) + '%';
    }
    if (ev === 'finish') {
      tb.bar.classList.add('done'); tb.fill.style.width = '100%'; tb.time.textContent = fmtTime(r.result);
      const rec = isRecord(top, r.result);
      tb.note.textContent = rec ? 'Финиш! Это результат уровня топ-10.' : `Финиш! До топ-10 не хватило ${fmtTime(r.result - top[top.length - 1].time)}.`;
      tb.next.hidden = false; tb.next.textContent = 'Ещё раз';
      toast('ФИНИШ ' + fmtTime(r.result), true, 2500);
      if (rec) setTimeout(() => askName(r.result), 1500);
    }
  } else if (mode === 'lesson') {
    const run = lessons.run;
    const ev = lessons.update(out, state, ctl, dt, course);
    if (run.status === 'running') { tb.fill.style.width = (run.progress * 100).toFixed(1) + '%'; tb.note.textContent = run.note; tb.time.textContent = fmtTime(run.el); }
    if (ev === 'done') {
      tb.bar.classList.add('done'); tb.fill.style.width = '100%'; tb.note.textContent = '✓ Урок пройден'; tb.next.hidden = false;
      tb.next.textContent = run.index + 1 < LESSONS.length ? 'Дальше →' : 'К гонке →';
      passed.add(run.lesson.id); savePassed(); renderLessonList(); toast('Урок пройден', true, 1600);
    }
    if (ev === 'fail') { tb.bar.classList.add('fail'); tb.note.textContent = run.fail; }
  }
}
// отладочный доступ: состояние и перемотка времени (используется автотестами)
window.__sim = { get level() { return level; }, prefs, camera, controls, setCamera, get camT() { return camTargetOffset; }, boat, audio, get look() { return look; }, state, ctl, course, lessons, startRace, startLesson, renderer, scene, env, get dpr() { return dpr; }, warp: (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) simulate(1 / 60); } };

// ---------- камера ----------
const camOffset = new THREE.Vector3();
const camTargetOffset = new THREE.Vector3(0, 0.9, 0);
let lastHeading = state.heading;
function boatForward() { const p = state.heading * DEG; return new THREE.Vector3(Math.sin(p), 0, -Math.cos(p)); }
function boatStarboard() { const p = state.heading * DEG; return new THREE.Vector3(Math.cos(p), 0, Math.sin(p)); }
const look = { yaw: 0, pitch: -0.1, drag: null };       // взгляд из кокпита относительно носа лодки
const baseFov = () => { const a = canvas.clientWidth / Math.max(1, canvas.clientHeight); return camMode === 'cockpit' ? (a < 0.9 ? 92 : 74) : (a < 0.9 ? 68 : 50); };
const CAM_ORDER = ['chase', 'top', 'side', 'cockpit', 'free'];
const eye = new THREE.Vector3(), eyeTo = new THREE.Vector3(), eyeLocal = new THREE.Vector3(); let eyeInit = false;
function setCamera(mode) {
  const was = camMode;
  camMode = mode;
  const cockpit = mode === 'cockpit';
  controls.enabled = !cockpit; boat.setHead(!cockpit); compass.userData.setNearLabels(!cockpit); eyeInit = false;
  camera.near = cockpit ? 0.04 : 0.1; camera.fov = baseFov(); camera.updateProjectionMatrix(); layoutDirty = true;
  if (cockpit) { look.yaw = 0; look.pitch = -0.1; document.querySelectorAll('#cam-seg button').forEach(b => b.classList.toggle('active', b.dataset.cam === mode)); return; }
  if (was === 'cockpit' && mode === 'free') mode = 'chase', camMode = 'free';
  document.querySelectorAll('#cam-seg button').forEach(b => b.classList.toggle('active', b.dataset.cam === camMode));
  const f = boatForward(), s = boatStarboard();
  const off = new THREE.Vector3();
  if (mode === 'chase') off.copy(f).multiplyScalar(-9.5).addScaledVector(s, -3.5 * state.side).setY(4.2);
  else if (mode === 'top') off.set(0, 17, 0.03);
  else if (mode === 'side') off.copy(s).multiplyScalar(-11 * state.side).addScaledVector(f, -1).setY(2.6);
  else off.copy(camera.position).sub(controls.target);
  camOffset.copy(off);
  lastHeading = state.heading;
  const target = boat.root.position.clone().add(camTargetOffset);
  camera.position.copy(target).add(off);
  controls.target.copy(target);
}
const camT = new THREE.Vector3(), camO = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
function updateCamera(dt) {
  if (camMode === 'cockpit') {
    // глаза матроса: положение головы сглаживается, горизонт остаётся ровным, а лодка кренится вокруг
    // Положение головы сглаживается в системе самой лодки, а не в мире: камера жёстко едет вместе с корпусом.
    // Если сглаживать в мире, камера отстаёт от лодки на переменную величину, и всё вблизи дрожит.
    boat.headWorld(eyeTo); eyeTo.y += 0.05;
    boat.heelG.updateWorldMatrix(true, false); boat.heelG.worldToLocal(eyeTo);
    if (!eyeInit) { eyeLocal.copy(eyeTo); eyeInit = true; } else eyeLocal.lerp(eyeTo, 1 - Math.exp(-dt * 10));
    boat.heelG.localToWorld(eye.copy(eyeLocal));
    const a = (90 - state.heading) * DEG + look.yaw, cp = Math.cos(look.pitch);
    camera.position.copy(eye);
    camT.set(eye.x + Math.cos(a) * cp, eye.y + Math.sin(look.pitch), eye.z - Math.sin(a) * cp);
    camera.up.set(0, 1, 0); camera.lookAt(camT);
    return;
  }
  const target = camT.copy(boat.root.position).add(camTargetOffset);
  const off = camO.copy(camera.position).sub(controls.target);
  if (camMode === 'chase' || camMode === 'side') {
    const dh = norm180(state.heading - lastHeading) * DEG;
    off.applyAxisAngle(camUp, -dh);
  }
  lastHeading = state.heading;
  controls.target.copy(target);
  camera.position.copy(target).add(off);
  controls.update();
}
setCamera('chase');

// ---------- панель: вывод ----------
let uiAcc = 0;
const elCache = new Map(), textCache = new Map();
const el = (id) => { let e = elCache.get(id); if (!e) { e = document.getElementById(id); elCache.set(id, e); } return e; };
function setText(id, text) { if (textCache.get(id) !== text) { textCache.set(id, text); el(id).textContent = text; } }
let narrow = window.innerWidth < 420;
function updateUI(out, dt) {
  uiAcc += dt; if (uiAcc < 0.1) return; uiAcc = 0;
  setText('v-windFrom', `${Math.round(ctl.windFrom)}°` + (ctl.gusts && Math.abs(out.windFrom - ctl.windFrom) > 2 ? ` (сейчас ${(Math.round(norm360(out.windFrom)) % 360)}°)` : ''));
  setText('v-windName', compassName(ctl.windFrom));
  setText('v-windSpeed', `${fmt(ctl.windSpeed, 1)} уз` + (ctl.gusts ? ` (сейчас ${fmt(out.windKn, 1)})` : ''));
  setText('v-heading', `${Math.round(state.heading)}°`);
  setText('v-twa', `${Math.round(Math.abs(out.TWA))}° к ветру`);
  if (document.activeElement !== ui.heading) ui.heading.value = Math.round(state.heading);
  if ($('autoTrim').checked !== ctl.autoTrim) syncTrimUI();
  if (mode === 'lesson' && +ui.windSpeed.value !== ctl.windSpeed) ui.windSpeed.value = ctl.windSpeed;
  for (const id of trimIds) {
    const pc = Math.round((ctl.autoTrim ? state.trim[id] : ctl[id]) * 100);
    setText('v-' + id, pc + '%'); if (ctl.autoTrim && document.activeElement !== el(id)) el(id).value = pc;
  }
  setText('v-sheet', `${Math.round(out.sheet)}°` + (ctl.autoSheet ? ' (авто)' : ''));
  if (ctl.autoSheet) ui.sheet.value = Math.round(out.sheet);
  const r = Math.round(ctl.rudder);
  setText('v-rudder', r === 0 ? 'прямо' : `${Math.abs(r)}° ${r > 0 ? 'вправо →' : '← влево'}`);
  setText('t-rudder-val', r === 0 ? 'прямо' : `${Math.abs(r)}° ${r > 0 ? 'вправо' : 'влево'}`);
  setText('t-sheet-val', `${Math.round(out.sheet)}°` + (ctl.autoSheet ? ' авто' : ''));
  setText('t-windChip', `Ветер ${(Math.round(norm360(out.windFrom)) % 360)}° ${compassName(out.windFrom)} · ${fmt(out.windKn, 0)} уз`);
  if (document.activeElement !== ui.rudder) ui.rudder.value = r;

  setText('pos-name', out.pos.name);
  setText('tack-name', narrow ? `${out.tack} · ${Math.round(out.twaAbs)}° к ветру` : `${out.tack} · ${out.pos.desc} · ${Math.round(out.twaAbs)}° к ветру`);
  // подсказка меняется не чаще, чем раз в 0.6 с, чтобы не мигала при быстрых действиях
  if (out.hint !== updateUI.pendingHint) { updateUI.pendingHint = out.hint; updateUI.pendingSince = performance.now(); }
  if (out.hint !== updateUI.shownHint && performance.now() - updateUI.pendingSince > 600) {
    updateUI.shownHint = out.hint; const hint = el('hint'); hint.textContent = out.hint; hint.className = 'hint ' + out.hintClass;
  }

  setText('s-speed', `${fmt(out.speedKn)} уз`);
  setText('speed-big', fmt(out.speedKn));
  const vmgTxt = `${fmt(Math.abs(out.vmgKn))} ${out.twaAbs < 90 ? 'к ветру' : 'по ветру'}`;
  setText('vmg-big', vmgTxt);
  setText('s-vmg', `${fmt(Math.abs(out.vmgKn))} уз ${out.twaAbs < 90 ? 'к ветру' : 'по ветру'}`);
  setText('s-aws', `${fmt(out.AWS / KN, 1)} уз · ${Math.round(out.awaAbs)}°`);
  setText('s-aoa', `${Math.round(out.aoa)}°`);
  setText('s-heel', `${Math.round(Math.abs(state.heel))}° ${state.heel > 0.5 ? 'на левый борт' : state.heel < -0.5 ? 'на правый борт' : ''}`);
  setText('s-leeway', `${fmt(Math.abs(out.leeway), 1)}°`);
  const sailTxt = `${out.sailState} · ${Math.round(out.Fmag)} Н`;
  if (textCache.get('s-sail') !== sailTxt + out.sailClass) { textCache.set('s-sail', sailTxt + out.sailClass); const sail = el('s-sail'); sail.textContent = sailTxt; sail.className = out.sailClass; }
}

// ---------- цикл ----------
const clock = new THREE.Clock();
let t = 0;
let labelK = 1;
let lastOffsetY = null;
let hudVisible = true;
// Раскладка пересчитывается только когда что-то изменило размер (окно, шапка, пульт), а не каждый кадр
var layoutDirty = true;      // var: флаг выставляется и из функций, объявленных выше по файлу
const markLayout = () => { layoutDirty = true; };
window.addEventListener('resize', markLayout); window.addEventListener('orientationchange', markLayout);
if ('ResizeObserver' in window) { const ro = new ResizeObserver(markLayout); ro.observe($('topbar')); ro.observe($('touch')); ro.observe(canvas); ro.observe($('hud')); }
setInterval(markLayout, 1500); // страховка для браузеров без ResizeObserver и для смены классов
function layoutOverlays(w, h) {
  narrow = w < 420;
  measurePads();
  const topbarBottom = $('topbar').getBoundingClientRect().bottom;
  // лодка — в центре свободной области между шапкой и сенсорным пультом
  let offY = 0;
  if (w < 900 || w / h < 0.9) {
    const touch = $('touch'); const tr = touch.getBoundingClientRect();
    const bottom = (getComputedStyle(touch).display !== 'none' && tr.height > 0) ? tr.top : h;
    offY = Math.round(THREE.MathUtils.clamp(h / 2 - (topbarBottom + bottom) / 2, -h * 0.2, h * 0.3));
  }
  if (offY !== lastOffsetY) {
    lastOffsetY = offY;
    if (offY) camera.setViewOffset(w, h, 0, offY, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  // подписи в сцене держат размер в пикселях; на узком экране они чуть мельче
  const k = 2 * Math.tan(camera.fov * DEG / 2) / h * (w < 600 ? 0.82 : 1);
  if (Math.abs(k - labelK) > labelK * 0.01) {
    labelK = k; setLabelScale(compass, k);
    for (const a of Object.values(arrows)) a.setLabelScale(k);
  }
  const hud = $('hud');
  if (w < 900) { hud.style.top = Math.round(topbarBottom + 8) + 'px'; $('lb').style.top = hud.style.top; }
  else { hud.style.top = ''; $('lb').style.top = ''; }
  hudVisible = getComputedStyle(hud).display !== 'none' && !hud.classList.contains('min');
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = baseFov();
    lastOffsetY = null;            // смещение кадра зависит от размера — пересчитать
    camera.updateProjectionMatrix();
  }
  layoutOverlays(w, h);
}
// Адаптивное разрешение: если кадры идут медленно, плавно снижаем плотность пикселей; при запасе — возвращаем
const perf = { acc: 0, n: 0, slow: 0, fast: 0, cap: QUALITY.maxDpr, fps: 0 };
const fx = { level: QUALITY.fx };                    // читают эффекты сцены: брызги, пена, отражение
function setLevel(name) {
  level = name; QUALITY = LEVELS[name]; fx.level = QUALITY.fx;
  dpr = QUALITY.maxDpr; perf.cap = dpr; perf.slow = 0; perf.fast = 0;
  if (sun.shadow.mapSize.x !== QUALITY.shadow) {
    sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  layoutDirty = true; showQuality(); showFps();
}
function showQuality() {
  for (const b of $('q-seg').children) b.classList.toggle('active', b.dataset.q === prefs.quality);
  setText('q-now', prefs.quality === 'auto' ? `сейчас ${LEVEL_NAME[level]}` : '');
}
function showFps() {
  const el = $('fps'); el.hidden = !prefs.fps;
  if (prefs.fps) setText('fps', `${Math.round(perf.fps)} к/с · ${LEVEL_NAME[level]} · ×${dpr}`);
}
function adaptQuality(rawDt) {
  if (document.hidden || rawDt > 0.25) return;      // вкладка была свёрнута — не считаем
  perf.acc += rawDt; perf.n++;
  if (perf.acc < 1) return;
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0; perf.fps = 1 / avg;
  if (avg > 1 / 42) { perf.slow++; perf.fast = 0; } else if (avg < 1 / 56) { perf.fast++; perf.slow = 0; } else { perf.slow = 0; perf.fast = 0; }
  if (perf.slow >= 2 && dpr > QUALITY.minDpr) {
    perf.cap = Math.min(perf.cap, dpr);              // выше этого уровня больше не поднимаемся без долгого запаса
    dpr = Math.max(QUALITY.minDpr, +(dpr - 0.25).toFixed(2)); perf.slow = 0; layoutDirty = true;
  } else if (perf.slow >= 4 && prefs.quality === 'auto' && level !== 'low') {
    setLevel(level === 'high' ? 'med' : 'low');      // плотность уже минимальная, а кадров мало: снимаем эффекты
  } else if (perf.fast >= 8 && dpr < perf.cap - 0.01) {
    dpr = Math.min(perf.cap, +(dpr + 0.25).toFixed(2)); perf.fast = 0; layoutDirty = true;
  }
  if (prefs.fps) showFps();
}
$('q-seg').addEventListener('click', (e) => {
  const q = e.target.dataset && e.target.dataset.q; if (!q) return;
  prefs.quality = q; savePrefs(); setLevel(q === 'auto' ? autoLevel : q);
});
$('soundOn').checked = prefs.sound;
$('soundOn').addEventListener('change', (e) => { prefs.sound = e.target.checked; savePrefs(); audio.setEnabled(prefs.sound); });
$('showFps').checked = prefs.fps;
$('showFps').addEventListener('change', (e) => { prefs.fps = e.target.checked; savePrefs(); showFps(); });
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

let mapAcc = 1, physAcc = 0, lastGybeSeen = -1;
// Один шаг модели: управление, среда, физика, положение объектов сцены. Не рисует.
function simulate(dt) {
  t += dt;
  handleKeys(dt);
  updateCompass(dt);

  // автопилот (оверштаг / фордевинд)
  if (autopilot) {
    const err = norm180(autopilot.target - state.heading);
    ctl.rudder = THREE.MathUtils.clamp(err * 1.4 - state.yawRate * 0.4, -30, 30);
    ui.rudder.value = Math.round(ctl.rudder);
    if (Math.abs(err) < 2.5 && Math.abs(state.yawRate) < 6) { autopilot = null; ctl.rudder = 0; ui.rudder.value = 0; }
  }

  // физика с фиксированным шагом 120 Гц: поведение лодки не зависит от частоты кадров
  env.update(dt, state.x, state.z, ctl.windFrom, ctl.windSpeed, ctl.gusts, ctl.paused);
  physAcc = Math.min(physAcc + dt, PHYS_DT * 8);
  let out = state.out;
  while (physAcc >= PHYS_DT) { out = step(state, ctl, PHYS_DT, env); physAcc -= PHYS_DT; }
  if (!out || out.AWS === undefined) out = step(state, ctl, 0, env);
  if (state.lastGybe.time !== lastGybeSeen) {
    lastGybeSeen = state.lastGybe.time;
    if (state.lastGybe.kick > 0.8) audio.thud(state.lastGybe.kick);
    if (state.lastGybe.kick > 1.6) toast(state.lastGybe.kick > 2.8 ? 'Гик ударил! Перед поворотом подбирайте шкот' : 'Гик перелетел', false, 2200);
  }
  updateTraining(out, dt, t);

  // сцена
  boat.update(state, out, ctl, dt, t, env);
  water.userData.update(t, Math.round(state.x), Math.round(state.z), ctl.windFrom * DEG);
  compass.userData.update(state.x, state.z, out.windFrom);
  compass.userData.setNoGo(show.noGo);
  streaks.visible = show.streaks;
  if (show.streaks) streaks.userData.update(ctl.paused ? 0 : dt, state.x, state.z, out.Wx, out.Wz, ctl.windSpeed);
  wake.userData.update(ctl.paused || out.capsized ? 0 : dt, state.x, state.z, out.fx, out.fz, out.sx, out.sz, state.vf);
  if (fx.level >= 1) {
    const e = sprayE; e.x = state.x; e.z = state.z; e.fx = out.fx; e.fz = out.fz; e.sx = out.sx; e.sz = out.sz; e.vx = out.Vx; e.vz = out.Vz;
    e.wx = out.Wx; e.wz = out.Wz; e.heave = boat.sea.heave; e.sf = boat.sea.sf; e.speed = out.capsized ? 0 : Math.max(0, state.vf);
    spray.userData.update(ctl.paused ? 0 : dt, e, canvas.height / (2 * Math.tan(camera.fov * DEG / 2)));
  } else if (spray.visible) { spray.userData.clear(); spray.visible = false; }
  clouds.position.set(state.x, 0, state.z);
  sky.position.set(state.x, 0, state.z);
  shore.position.set(state.x, 0, state.z);
  sun.position.copy(boat.root.position).addScaledVector(sunDir, 40);
  sun.target.position.copy(boat.root.position);
  return out;
}
function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  adaptQuality(rawDt);
  if (layoutDirty) { layoutDirty = false; resize(); }
  const dt = Math.min(0.05, rawDt);
  const out = simulate(dt);

  // стрелки
  const center = tmpC.copy(boat.root.position); center.y = 0.95 + boat.heelG.position.y;
  const WS = 0.5; // м на 1 м/с ветра
  const endAt = (v, vx, vz, R) => { const L = Math.hypot(vx, vz) || 1; return v.set(center.x - vx / L * R, center.y, center.z - vz / L * R); };
  const vec = camMode !== 'cockpit';
  arrows.trueWind.setVisible(show.trueWind && vec, show.labels);
  arrows.trueWind.set(tmpB.set(center.x - out.Wx * WS, center.y, center.z - out.Wz * WS), endAt(tmpA, out.Wx, out.Wz, 1.0), `Ветер ${fmt(out.windKn, 0)} уз`, dt);
  arrows.appWind.setVisible(show.appWind && vec, show.labels);
  const appY = center.y + 1.45;
  const appFrom = tmpB.set(center.x - out.Ax * WS, appY, center.z - out.Az * WS);
  const appTo = endAt(tmpA, out.Ax, out.Az, 0.6); appTo.y = appY;
  arrows.appWind.set(appFrom, appTo, `Вымпельный ${fmt(out.AWS / KN, 0)} уз`, dt);
  arrows.vel.setVisible(show.vel && vec, show.labels);
  arrows.vel.set(center, tmpA.set(center.x + out.Vx * 1.3, center.y, center.z + out.Vz * 1.3), `${fmt(out.speedKn)} уз`, dt);
  arrows.force.setVisible(show.force && vec, show.labels);
  const fs = 0.012;
  const fOrigin = tmpB.set(center.x + out.fx * 0.3, center.y + 0.75, center.z + out.fz * 0.3);
  arrows.force.set(fOrigin, tmpA.set(fOrigin.x + out.forceWorldX * fs, fOrigin.y, fOrigin.z + out.forceWorldZ * fs), `${Math.round(out.Fmag)} Н`, dt);

  sound.aws = out.AWS; sound.speed = out.capsized ? 0 : state.vf; sound.luff = out.luffing && !out.capsized ? 1 : 0; sound.sheet = state.sheetNow; sound.paused = ctl.paused;
  sound.slam = Math.max(0, env.heightAt(state.x + out.fx * 2, state.z + out.fz * 2) - boat.sea.heave - boat.sea.sf * 2 - 0.02);
  audio.update(dt, sound);
  ctl.sheetShown = out.sheet;
  updateTouch();
  updateCamera(dt);
  updateUI(out, dt);
  mapAcc += dt;
  if (hudVisible && mapAcc >= 0.05) { mapAcc = 0; drawMinimap(state, out, ctl, show, course.group.visible ? { marks: [{ ...course.marks.W, color: '#ff5700', active: course.race.phase === 'leg1' }, { ...course.marks.G1, color: '#0047ff', active: course.race.phase === 'leg2' }, { ...course.marks.G2, color: '#0047ff', active: course.race.phase === 'leg2' }] } : null); }
  // отражение лодки в воде: только на высоком качестве
  const WU = water.userData.uniforms;
  if (fx.level >= 2) {
    if (!reflection) { reflection = makeBoatReflection(isTouch ? 384 : 512); WU.tReflect.value = reflection.target.texture; WU.uReflectM.value = reflection.matrix; }
    WU.uReflectOn.value = reflection.render(renderer, scene, camera, state.x, boat.sea.heave, state.z) ? 1 : 0;
  } else WU.uReflectOn.value = 0;
  renderer.render(scene, camera);
}

showQuality(); showFps();
frame();
requestAnimationFrame(() => $('loading').classList.add('hide'));
initAnalytics();
