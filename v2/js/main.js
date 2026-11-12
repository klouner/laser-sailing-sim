// Лазер 3D, версия 2: приложение. Сцену рисует Babylon.js (js/gfx), физика и логика общие с первой версией.
import { createWorld, SKIES } from './gfx/world.js';
import { createBoat } from './gfx/boat.js';
import { createCameraRig, createLabels, VectorArrow, createSpray } from './gfx/view.js';
import { V3, clamp } from './vec.js';
import { createState, defaultControls, step, settleRig, norm180, norm360, compassName, optimalSheet, KN, PHYS_DT, BOAT } from './physics.js';
import { createMinimap } from './hud.js';
import { createCourse, fmtTime } from './course.js';
import { createEnvironment } from './env.js';
import { LESSONS, createLessonRunner } from './lessons.js';
import { loadTop, isRecord, submit, rememberName, savedName, isShared } from './leaderboard.js';
import { initAnalytics } from './analytics.js';
import { createAudio } from './audio.js';
import { targetSpeed } from './polar.js';
import { createScenery } from './gfx/scenery.js';
import { createFleet } from './fleet.js';

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
const prefs = { quality: 'auto', fps: false, sound: true, sky: 'morning', fleet: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('laser3d2.view3') || '{}')); } catch (e) {}
if (!LEVELS[prefs.quality]) prefs.quality = 'auto';
const savePrefs = () => { try { localStorage.setItem('laser3d2.view3', JSON.stringify(prefs)); } catch (e) {} };
const audio = createAudio(), sound = { aws: 0, speed: 0, luff: 0, sheet: 45, slam: 0, paused: false };
audio.setEnabled(false);
// звук можно включить только из обработчика действия пользователя: первое касание или клавиша
const unlockAudio = () => { if (prefs.sound) audio.setEnabled(true); };
window.addEventListener('pointerdown', unlockAudio, { passive: true }); window.addEventListener('keydown', unlockAudio);
const autoLevel = isTouch ? 'med' : 'high';
let level = prefs.quality === 'auto' ? autoLevel : prefs.quality;
let QUALITY = LEVELS[level];
// сглаживание задаётся один раз при создании контекста; остальное меняется на лету
const world = createWorld(canvas, { antialias: level !== 'low' && !(isTouch && DEVICE_DPR >= 2) });
let dpr = QUALITY.maxDpr;
world.engine.setHardwareScalingLevel(1 / dpr);
const scenery = createScenery(world);
if (!SKIES[prefs.sky]) prefs.sky = 'morning';
world.setSky(prefs.sky);
const camera = world.camera;
// статистика: что сейчас на экране, читается раз в 30 секунд
const stats = initAnalytics({ gl: world.engine._gl, state: () => ({ app: 'v2', fps: Math.round(perf.fps), quality: level, mode: mode === 'lesson' && lessons.run.lesson ? 'lesson:' + lessons.run.lesson.id : mode, cam: camMode }) });

const env = createEnvironment();   // волны и порывы: общие для физики, качки и шейдеров
const boat = createBoat(world, env);
const spray = createSpray(world, env);
const sprayE = { x: 0, z: 0, fx: 0, fz: -1, sx: 1, sz: 0, vx: 0, vz: 0, heave: 0, sf: 0, speed: 0 };
const labels = createLabels(world, $('labels'));
const compassL = ['С', 'В', 'Ю', 'З'].map((n) => labels.add('wl-c', n));
const noGoL = labels.add('wl-nogo', 'МЁРТВАЯ ЗОНА'), windL = labels.add('wl-wind', 'ВЕТЕР');

const arrows = {
  trueWind: new VectorArrow(world, labels, [0.0, 0.1, 1.2], 'wl-true'),
  appWind: new VectorArrow(world, labels, [0.28, 0.45, 1.2], 'wl-app'),
  vel: new VectorArrow(world, labels, [1.15, 1.15, 1.15], 'wl-vel'),
  force: new VectorArrow(world, labels, [1.3, 0.12, 0.0], 'wl-force'),
};
arrows.trueWind.labelAt = 0.0; arrows.trueWind.labelLift = 0.3;
arrows.appWind.labelAt = 0.4; arrows.appWind.labelLift = 0.3;
arrows.vel.labelAt = 1.0; arrows.vel.labelLift = 0.3;
arrows.force.labelAt = 1.0; arrows.force.labelLift = 0.3;

const course = createCourse(world, env);
const fleet = createFleet(world, env);
course.showCourse(true);                      // знаки и судейский катер стоят на воде всегда: акватория живая
const lessons = createLessonRunner();

// ---------- состояние ----------
const state = createState();
state.x = -6; state.z = 24;                    // под стартовой линией
const ctl = defaultControls();
settleRig(state, ctl);
ctl.heading = state.heading;
const show = { trueWind: true, appWind: true, vel: true, force: true, noGo: true, labels: !isTouch, sailor: true };
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
function setRudder(v) { ctl.rudder = clamp(v, -35, 35); ui.rudder.value = Math.round(ctl.rudder); autopilot = null; holdTarget = null; }
function setSheet(v) { ctl.sheet = clamp(v, BOAT.boomMin, 90); ui.sheet.value = Math.round(ctl.sheet); ctl.autoSheet = false; ui.autoSheet.checked = false; $('t-auto').classList.remove('active'); }
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
$('rollTack').addEventListener('change', (e) => { ctl.rollTack = e.target.checked; });
$('autoRight').addEventListener('change', (e) => { ctl.autoRight = e.target.checked; });
$('btn-bow').addEventListener('click', () => { if (state.capsized && !state.righting) ctl.swimBow = !ctl.swimBow; });
$('btn-tack').addEventListener('click', () => {
  if (state.capsized) { if (!state.righting) ctl.rightBoat = true; return; }
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
for (const [id, key] of [['showTrue', 'trueWind'], ['showApp', 'appWind'], ['showVel', 'vel'], ['showForce', 'force'], ['showNoGo', 'noGo'], ['showLabels', 'labels'], ['showSailor', 'sailor']]) {
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
    if (horizontal) { const half = r.width / 2 - th / 2; onValue(clamp((e.clientX - (r.left + r.width / 2)) / half, -1, 1)); }
    else { const usable = r.height - th; onValue(clamp((e.clientY - r.top - th / 2) / usable, 0, 1)); }
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
$('t-tack').addEventListener('click', () => { if (state.capsized && state.out.mastUpwind && !ctl.swimBow) ctl.swimBow = true; else $('btn-tack').click(); });
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
  state.x = -6; state.z = 24; state.heading = 90; ctl.rudder = 0; ui.rudder.value = 0; autopilot = null;
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
  if (e.code === 'KeyG') $('btn-bow').click();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function handleKeys(dt) {
  const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
  const inS = keys.ArrowUp || keys.KeyW, outS = keys.ArrowDown || keys.KeyS;
  if (left || right) { autopilot = null; ctl.rudder = clamp(ctl.rudder + (right ? 1 : -1) * 70 * dt, -35, 35); ui.rudder.value = Math.round(ctl.rudder); }
  else if (ui.rudderReturn.checked && !autopilot && !padActive && document.activeElement !== ui.rudder) {
    if (ui.holdCourse.checked && !ctl.paused && !ctl.lockHeading && !state.capsized) {
      // матрос удерживает курс: видно, какой руль нужен, чтобы лодка не приводилась
      if (holdTarget === null) holdTarget = state.heading + state.yawRate * 0.35;
      const err = norm180(holdTarget - state.heading);
      if (Math.abs(err) > 50) holdTarget = state.heading;
      const want = clamp(err * 1.3 - state.yawRate * 0.4, -25, 25);
      ctl.rudder += (want - ctl.rudder) * Math.min(1, dt * 8);
    } else {
      const k = Math.min(1, dt * 5); ctl.rudder += (0 - ctl.rudder) * k; if (Math.abs(ctl.rudder) < 0.3) ctl.rudder = 0;
    }
    ui.rudder.value = Math.round(ctl.rudder);
  }
  if (left || right || padActive || autopilot || document.activeElement === ui.rudder || ctl.lockHeading || state.capsized) holdTarget = null;
  if (inS || outS) { ctl.autoSheet = false; ui.autoSheet.checked = false; ctl.sheet = clamp(ctl.sheet + (outS ? 1 : -1) * 40 * dt, BOAT.boomMin, 90); ui.sheet.value = Math.round(ctl.sheet); }
}

// ---------- тренировка: уроки, гонка, рекорды ----------
let toastTimer = 0, capUI = false;
const COARSE = matchMedia('(pointer: coarse)').matches;      // телефон или планшет: клавиш нет, в подсказках называются кнопки
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
  stats.track('lesson', { id: lessons.run.lesson.id, result: 'start' });
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
  stats.track('race', { result: 'start' });
  course.start(state, ctl, $('fullStart').checked);
  ui.sheet.value = ctl.sheet; ui.windFrom.value = ctl.windFrom; ui.windSpeed.value = ctl.windSpeed;
  tb.bar.hidden = false; tb.bar.className = 'trainbar'; tb.next.hidden = true;
  tb.tag.textContent = 'ГОНКА'; tb.title.textContent = 'Старт по флагам'; tb.goal.textContent = 'Идёт стартовая процедура. Сигналы: флаг класса, флаг «П», флаг «П» долой, старт. Линия между оранжевым знаком и мачтой судейского катера. В момент сигнала корпус должен быть под линией: иначе флаг «X», и придётся вернуться. Время идёт от сигнала. Обогни наветренный знак в 110 м и финишируй через ту же линию.';
  tb.note.textContent = ''; tb.fill.style.width = '0%'; tb.time.textContent = '';
  renderLessonList(); setCamera(camMode === 'free' ? 'chase' : camMode); lastHeading = state.heading; showGoal(6000);
}
function exitTraining() {
  lessons.stop(ctl); course.stop(); course.showCourse(true); mode = 'free';
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
  lessons.stop(ctl); course.stop(); course.showCourse(true); mode = 'free'; tb.bar.hidden = true;
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
  if (out.capsized && !wasCapsized) { audio.splash(); toast('ОВЕРКИЛЬ', true, 2500); if (mode === 'lesson' && lessons.run.status === 'running' && !lessons.run.lesson.allowCapsize) { lessons.run.status = 'failed'; stats.track('lesson', { id: lessons.run.lesson.id, result: 'failed', why: 'capsize' }); lessons.run.fail = 'Оверкиль: крен стал критическим. В порыве травите шкот и приводитесь, откренивайте заранее.'; tb.bar.classList.add('fail'); tb.note.textContent = lessons.run.fail; } }
  wasCapsized = !!out.capsized;
  if (wasCapsized !== capUI) { capUI = wasCapsized; $('btn-bow').hidden = !capUI; $('btn-tack').textContent = capUI ? 'Встать на шверт' : 'Оверштаг'; $('btn-tack').classList.toggle('accent', capUI); $('t-tack').querySelector('.tx').textContent = capUI ? 'На шверт' : 'Оверштаг'; if (!capUI) ctl.swimBow = false; }
  $('btn-bow').classList.toggle('on', !!ctl.swimBow);
  if (mode === 'race') {
    const r = course.race;
    const ev = course.update(state, ctl, dt, t);
    if (ev === 'warning') { audio.horn(); toast('Предупреждение: флаг класса поднят', false, 3000); }
    if (ev === 'prep') { audio.horn(); toast('Подготовительный: флаг «П» поднят', false, 3000); }
    if (ev === 'oneMin') { audio.horn(true); toast(r.seq > 100 ? 'Минута до старта: флаг «П» долой' : 'Флаг «П» долой: скоро старт', false, 3000); }
    if (ev === 'go') { audio.horn(); toast('СТАРТ!', true, 1400); }
    if (ev === 'ocs') { audio.horn(); setTimeout(() => audio.horn(), 900); toast('ФАЛЬСТАРТ: флаг «X»', true, 2600); }
    if (ev === 'ocsClear') toast('Вернулся за линию. Стартуй заново', false, 2600);
    if (ev === 'missedLine') toast('Мимо линии: старт между знаком и катером', false, 2800);
    if (ev === 'started') toast(r.startDelay < 2 ? `Отличный старт: ${r.startDelay.toFixed(1)} с после сигнала` : `Линия пройдена через ${r.startDelay.toFixed(1)} с после сигнала`, false, 3000);
    if (r.phase === 'prestart' || (r.phase === 'leg1' && !r.started)) {
      const tt = Math.max(0, r.toStart), bias = norm180(state.out.windFrom - 0);
      tb.time.textContent = r.phase === 'prestart' ? fmtTime(tt).replace(/\.\d$/, '') : fmtTime(r.t);
      const edge = Math.abs(bias) < 2 ? 'линия ровная' : `выгоднее край ${bias > 0 ? 'у катера' : 'у знака'} (${Math.abs(Math.round(bias))}°)`;
      const d = r.lineDist, lt = r.lineTime;
      const where = d < 0 ? `ЗА ЛИНИЕЙ на ${(-d).toFixed(0)} м` : `до линии ${d.toFixed(0)} м` + (isFinite(lt) && lt < 99 ? `, дойдёшь за ${lt.toFixed(0)} с` : '');
      tb.note.textContent = r.phase === 'prestart' ? `${r.stage === 1 ? 'Флаги: класс и «П»' : 'Флаг: класс'} · ${where} · ${edge}` : (r.ocs ? 'Фальстарт: вернись за линию целиком' : `Старт дан! ${where}`);
      tb.fill.style.width = (r.phase === 'prestart' ? (1 - tt / r.seq) * 12 : 12).toFixed(1) + '%';
    }
    if (ev === 'rounded') toast('Знак обогнут! Теперь по ветру, финиш между знаком и катером', false, 2800);
    if (ev === 'notRounded') toast('Знак не обогнут: пройдите выше него и вернитесь с другой стороны', false, 3200);
    if (ev === 'missedGate') toast('Мимо линии: финиш между знаком и катером', false, 2800);
    if ((r.phase === 'leg1' && r.started) || r.phase === 'leg2') {
      tb.time.textContent = fmtTime(r.t);
      tb.note.textContent = `${r.phase === 'leg1' ? 'К наветренному знаку' : 'К финишной линии'} · ${Math.round(r.dist)} м · пеленг ${Math.round(r.bearing)}°`;
      const legLen = 110; const p = r.phase === 'leg1' ? 0.12 + 0.44 * (1 - Math.min(1, r.dist / legLen)) : 0.56 + 0.44 * (1 - Math.min(1, r.dist / legLen));
      tb.fill.style.width = (p * 100).toFixed(1) + '%';
    }
    if (ev === 'finish') {
      tb.bar.classList.add('done'); tb.fill.style.width = '100%'; tb.time.textContent = fmtTime(r.result);
      const rec = isRecord(top, r.result);
      tb.note.textContent = rec ? 'Финиш! Это результат уровня топ-10.' : `Финиш! До топ-10 не хватило ${fmtTime(r.result - top[top.length - 1].time)}.`;
      tb.next.hidden = false; tb.next.textContent = 'Ещё раз';
      toast('ФИНИШ ' + fmtTime(r.result), true, 2500);
      stats.track('race', { result: 'finish', time: Math.round(r.result * 10) / 10 });
      if (rec) setTimeout(() => askName(r.result), 1500);
    }
  } else if (mode === 'lesson') {
    course.update(state, ctl, dt, t);
    const run = lessons.run;
    const ev = lessons.update(out, state, ctl, dt, course);
    if (run.status === 'running') { tb.fill.style.width = (run.progress * 100).toFixed(1) + '%'; tb.note.textContent = run.note; tb.time.textContent = fmtTime(run.el); }
    if (ev === 'done') {
      tb.bar.classList.add('done'); tb.fill.style.width = '100%'; tb.note.textContent = '✓ Урок пройден'; tb.next.hidden = false;
      tb.next.textContent = run.index + 1 < LESSONS.length ? 'Дальше →' : 'К гонке →';
      passed.add(run.lesson.id); savePassed(); renderLessonList(); toast('Урок пройден', true, 1600);
      stats.track('lesson', { id: run.lesson.id, result: 'done', sec: Math.round(run.el) });
    }
    if (ev === 'fail') { tb.bar.classList.add('fail'); tb.note.textContent = run.fail; stats.track('lesson', { id: run.lesson.id, result: 'failed', sec: Math.round(run.el) }); }
  } else course.update(state, ctl, dt, t);       // знаки качаются на волне, флаги полощут
}
// отладочный доступ: состояние и перемотка времени (используется автотестами)
window.__sim = { fleet, scenery, get level() { return level; }, prefs, stats, world, camera, get rig() { return rig; }, setCamera, boat, audio, get look() { return rig.look; }, state, ctl, course, lessons, startRace, startLesson, env, get dpr() { return dpr; }, warp: (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) simulate(1 / 60); } };

// ---------- камера ----------
const rig = createCameraRig(world, canvas, boat);
const baseFov = () => { const a = canvas.clientWidth / Math.max(1, canvas.clientHeight); return camMode === 'cockpit' ? (a < 0.9 ? 92 : 74) : (a < 0.9 ? 66 : 48); };
const CAM_ORDER = ['chase', 'top', 'side', 'cockpit', 'free'];
let lastHeading = state.heading;
function setCamera(mode) {
  camMode = mode;
  rig.setMode(mode, state.heading, state.side || 1);
  camera.fov = baseFov() * DEG; layoutDirty = true;
  document.querySelectorAll('#cam-seg button').forEach(b => b.classList.toggle('active', b.dataset.cam === camMode));
}
function updateCamera(dt) { rig.update(dt, state); }
setCamera('chase');
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !/[?&]nointro/.test(location.search)) rig.intro();

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
  if ($('autoRight').checked !== (ctl.autoRight !== false)) $('autoRight').checked = ctl.autoRight !== false;
  if ($('rollTack').checked !== (ctl.rollTack !== false)) $('rollTack').checked = ctl.rollTack !== false;
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
    updateUI.shownHint = out.hint; const hint = el('hint'); hint.textContent = COARSE ? out.hint.replace(/ \((G|T)\)/g, '').replace('вставайте на шверт', 'жмите «На шверт»').replace('Вставайте на шверт', 'Жмите «На шверт»').replace('разверните нос к ветру', 'нажмите «На шверт» один раз: матрос развернёт нос к ветру') : out.hint; hint.className = 'hint ' + out.hintClass;
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
  // целевая скорость по поляре: насколько хорошо лодка идёт для этого курса и ветра
  if (out.twaAbs < 36 || out.capsized) setText('s-target', '—');
  else { const tg = targetSpeed(out.windKn, out.twaAbs), pc = Math.round(clamp(out.speedKn / Math.max(0.3, tg), 0, 1.3) * 100); setText('s-target', `${pc}% · цель ${fmt(tg)} уз`); }
  // заход ветра от среднего направления: лифт позволяет идти острее, хедер заставляет уваливаться
  const sh = Math.round(norm180(out.windFrom - ctl.windFrom));
  if (!ctl.gusts || Math.abs(sh) < 2) setText('s-shift', 'ровно');
  else setText('s-shift', `${Math.abs(sh)}° ${sh * state.side > 0 ? '· лифт' : '· хедер'}`);
  const sailTxt = `${out.sailState} · ${Math.round(out.Fmag)} Н`;
  if (textCache.get('s-sail') !== sailTxt + out.sailClass) { textCache.set('s-sail', sailTxt + out.sailClass); const sail = el('s-sail'); sail.textContent = sailTxt; sail.className = out.sailClass; }
}

// ---------- цикл ----------
const clock = { last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } };
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
    offY = Math.round(clamp(h / 2 - (topbarBottom + bottom) / 2, -h * 0.2, h * 0.3));
  }
  if (offY !== lastOffsetY) { lastOffsetY = offY; rig.screenShift = offY / h; }
  const hud = $('hud');
  if (w < 900) { hud.style.top = Math.round(topbarBottom + 8) + 'px'; $('lb').style.top = hud.style.top; }
  else { hud.style.top = ''; $('lb').style.top = ''; }
  hudVisible = getComputedStyle(hud).display !== 'none' && !hud.classList.contains('min');
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    world.engine.setHardwareScalingLevel(1 / dpr); world.engine.resize();
    lastOffsetY = null;            // смещение кадра зависит от размера — пересчитать
  }
  camera.fov = baseFov() * DEG;
  layoutOverlays(w, h);
}
// Адаптивное разрешение: если кадры идут медленно, плавно снижаем плотность пикселей; при запасе — возвращаем
const perf = { acc: 0, n: 0, slow: 0, fast: 0, cap: QUALITY.maxDpr, fps: 0 };
const fx = { level: QUALITY.fx };                    // читают эффекты сцены: брызги, пена, отражение
function setLevel(name) {
  level = name; QUALITY = LEVELS[name]; fx.level = QUALITY.fx;
  dpr = QUALITY.maxDpr; perf.cap = dpr; perf.slow = 0; perf.fast = 0;
  world.setEffects(QUALITY.fx, QUALITY.shadow); syncFleet();
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
function showSky() { for (const b of $('sky-seg').children) b.classList.toggle('active', b.dataset.sky === prefs.sky); }
$('sky-seg').addEventListener('click', (e) => { const k = e.target.dataset && e.target.dataset.sky; if (!k) return; prefs.sky = k; savePrefs(); world.setSky(k); showSky(); });
$('soundOn').checked = prefs.sound;
// Соперники видны на любом качестве и не пропадают, когда оно снижается само: на низком их парус, снасти и матрос
// просто перестраиваются реже. Убрать их можно только галкой.
function syncFleet() { fleet.setEnabled(prefs.fleet !== false); fleet.economy = QUALITY.fx < 1; $('showFleet').checked = prefs.fleet !== false; }
$('showFleet').addEventListener('change', (e) => { prefs.fleet = e.target.checked; savePrefs(); syncFleet(); });
$('soundOn').addEventListener('change', (e) => { prefs.sound = e.target.checked; savePrefs(); audio.setEnabled(prefs.sound); });
$('showFps').checked = prefs.fps;
$('showFps').addEventListener('change', (e) => { prefs.fps = e.target.checked; savePrefs(); showFps(); });
const tmpA = new V3(), tmpB = new V3(), tmpC = new V3();

let mapAcc = 1, physAcc = 0, lastGybeSeen = -1;
// Один шаг модели: управление, среда, физика, положение объектов сцены. Не рисует.
function simulate(dt) {
  t += dt;
  handleKeys(dt);
  updateCompass(dt);

  // автопилот (оверштаг / фордевинд)
  if (autopilot) {
    const err = norm180(autopilot.target - state.heading);
    ctl.rudder = clamp(err * 1.4 - state.yawRate * 0.4, -30, 30);
    // Большой поворот: руль перекладывают плавно, вслед за кормой. Перо держится под углом около 12° к потоку,
    // чуть не доходя до срыва: так лодка поворачивает быстрее всего и меньше теряет ход.
    if (Math.abs(err) > 18) ctl.rudder = Math.sign(err) * Math.min(35, Math.atan2(Math.abs(state.yawRate) * Math.PI / 180 * 2.15, Math.max(0.3, state.vf)) * 180 / Math.PI + 12);
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
  const e = sprayE; e.x = state.x; e.z = state.z; e.fx = out.fx; e.fz = out.fz; e.sx = out.sx; e.sz = out.sz; e.vx = out.Vx; e.vz = out.Vz;
  e.heave = boat.sea.heave; e.sf = boat.sea.sf; e.speed = out.capsized ? 0 : Math.max(0, state.vf);
  spray.update(ctl.paused ? 0 : dt, e, fx.level >= 1);
  scenery.update(t, dt, state.x, state.z);
  fleet.update(dt, t, ctl.windFrom, ctl.windSpeed, course.race, ctl.paused, state, course.group.visible ? course.obstacle : null);
  if (course.hit) { course.hit = false; audio.thud(2.2); toast('Навал на судейский катер' + (course.race.active ? ': это нарушение, штрафной оборот' : ''), false, 3200); }
  if (fleet.contact) { state.vf *= 0.8; audio.thud(1.6); toast(`Касание с лодкой ${fleet.contact}` + (course.race.active ? ': по правилам это штрафной оборот' : ''), false, 3200); }
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
  if (hudVisible && mapAcc >= 0.05) { mapAcc = 0; drawMinimap(state, out, ctl, show, course.group.visible ? { marks: [{ ...course.marks.W, color: '#ff5700', active: course.race.phase === 'leg1' }, { ...course.marks.G1, color: '#ff5700', active: course.race.phase === 'leg2' }, { ...course.marks.G2, color: '#17337f', active: course.race.phase === 'leg2' }] } : null); }
  // сцена: вода, небо, свет стоят вокруг камеры и лодки
  const ov = course.overlay(), ringOn = camMode !== 'cockpit';
  world.update(env, { dt, paused: ctl.paused, x: state.x, z: state.z, fx: out.fx, fz: out.fz, speed: state.vf, capsized: !!out.capsized, wake2: fleet.wake,
    windFrom: out.windFrom, windKn: out.windKn, compass: 1, noGo: show.noGo, arrow: true, marks: ov.rings, line: ov.line });
  // подписи у компасного кольца
  const ly = boat.sea.heave + 0.12, R = 3.6;
  compassL.forEach((l, i) => { const b = i * 90 * DEG; l.on = show.labels || true; l.set(state.x + Math.sin(b) * (R + 0.42), ly, state.z - Math.cos(b) * (R + 0.42)); });
  const wf = out.windFrom * DEG, ng = (out.windFrom - 27) * DEG;
  noGoL.on = show.noGo && ringOn; noGoL.set(state.x + Math.sin(ng) * R * 0.74, ly, state.z - Math.cos(ng) * R * 0.74);
  windL.on = ringOn; windL.set(state.x + Math.sin(wf) * (R + 2.95), ly + 0.1, state.z - Math.cos(wf) * (R + 2.95));
  world.render();
  labels.update();
}

showQuality(); showFps(); showSky(); world.setEffects(QUALITY.fx, QUALITY.shadow); syncFleet();
{ const v = new URL(import.meta.url).searchParams.get('v'); if (v) $('ver').textContent = 'Версия ' + v + '.'; }
frame();
requestAnimationFrame(() => $('loading').classList.add('hide'));
