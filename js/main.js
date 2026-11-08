import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoat, HULL } from './boat.js';
import { makeSky, makeClouds, makeWater, makeCompassRing, VectorArrow, makeWindStreaks, makeWake, setLabelScale } from './scene.js';
import { createState, defaultControls, step, norm180, compassName, optimalSheet, KN } from './physics.js';
import { createMinimap } from './hud.js';
import { createCourse, fmtTime } from './course.js';
import { LESSONS, createLessonRunner } from './lessons.js';
import { loadTop, isRecord, submit, rememberName, savedName, isShared } from './leaderboard.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

// ---------- рендер ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#bfd8ee', 120, 520);
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
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 5; sun.shadow.camera.far = 90;
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.HemisphereLight('#bcd7f5', '#1b4a70', 0.9));

// окружение для отражений (простая градиентная сцена)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(makeSky());
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
}

const sky = makeSky(); scene.add(sky);
const clouds = makeClouds(); scene.add(clouds);
const water = makeWater(); scene.add(water);
const compass = makeCompassRing(); scene.add(compass);
const streaks = makeWindStreaks(); scene.add(streaks);
const wake = makeWake(); scene.add(wake);
// фиксированный порядок прозрачных слоёв: вода → кильватер → компас (иначе сортировка по расстоянию даёт мерцание)
water.renderOrder = 1;
wake.traverse((o) => { if (o.isMesh) o.renderOrder = 2; });
compass.traverse((o) => { if (o.isMesh || o.isLine || o.isLineSegments) o.renderOrder = 3; });
streaks.renderOrder = 4;

const boat = createBoat(); scene.add(boat.root);

const arrows = {
  trueWind: new VectorArrow(scene, 'rgb(0,71,255)', 'Истинный ветер'),
  appWind: new VectorArrow(scene, 'rgb(141,176,255)', 'Вымпельный ветер'),
  vel: new VectorArrow(scene, 'rgb(255,255,255)', 'Скорость лодки'),
  force: new VectorArrow(scene, 'rgb(255,87,0)', 'Сила на парусе'),
};
arrows.trueWind.labelAt = 0.0; arrows.trueWind.labelLift = 0.45;
arrows.appWind.labelAt = 0.4; arrows.appWind.labelLift = 0.5;
arrows.vel.labelAt = 1.0; arrows.vel.labelLift = 0.45;
arrows.force.labelAt = 1.0; arrows.force.labelLift = 0.45;

const course = createCourse(scene);
const lessons = createLessonRunner();

// ---------- состояние ----------
const state = createState();
const ctl = defaultControls();
ctl.heading = state.heading;
const isTouch = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
const show = { trueWind: true, appWind: true, vel: true, force: true, noGo: true, streaks: true, labels: !isTouch, sailor: true };
$('showLabels').checked = show.labels;
let camMode = 'chase';
const keys = {};
let autopilot = null; // { target }
const drawMinimap = createMinimap($('minimap'));

// ---------- UI ----------
const ui = {
  windFrom: $('windFrom'), windSpeed: $('windSpeed'), heading: $('heading'), sheet: $('sheet'), rudder: $('rudder'),
  autoSheet: $('autoSheet'), lockHeading: $('lockHeading'), rudderReturn: $('rudderReturn'),
};
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
function setRudder(v) { ctl.rudder = THREE.MathUtils.clamp(v, -35, 35); ui.rudder.value = Math.round(ctl.rudder); autopilot = null; }
function setSheet(v) { ctl.sheet = THREE.MathUtils.clamp(v, 0, 90); ui.sheet.value = Math.round(ctl.sheet); ctl.autoSheet = false; ui.autoSheet.checked = false; $('t-auto').classList.remove('active'); }
function setWindFrom(v) { ctl.windFrom = ((v % 360) + 360) % 360; ui.windFrom.value = Math.round(ctl.windFrom); }
function setAutoSheet(v) { if (v && (raceLocked() || lessons.run.status === 'running')) { toast('Автошкот недоступен в уроках и гонке'); v = false; } ctl.autoSheet = v; ui.autoSheet.checked = v; $('t-auto').classList.toggle('active', v); }

const raceLocked = () => course.race.active && course.race.phase !== 'finished';
ui.windFrom.addEventListener('input', () => { if (raceLocked()) { ui.windFrom.value = ctl.windFrom; return; } ctl.windFrom = +ui.windFrom.value; if (devCompass.on) setCompass(false); });
ui.windSpeed.addEventListener('input', () => { if (raceLocked()) { ui.windSpeed.value = ctl.windSpeed; return; } ctl.windSpeed = +ui.windSpeed.value; });
ui.heading.addEventListener('input', () => { if (raceLocked() || lessons.run.status === 'running') { ui.heading.value = Math.round(state.heading); return; } state.heading = +ui.heading.value; state.yawRate = 0; autopilot = null; });
ui.sheet.addEventListener('input', () => { setSheet(+ui.sheet.value); });
ui.rudder.addEventListener('input', () => { ctl.rudder = +ui.rudder.value; autopilot = null; });
ui.rudder.addEventListener('change', () => { if (ui.rudderReturn.checked) { ctl.rudder = 0; ui.rudder.value = 0; } });
ui.autoSheet.addEventListener('change', () => { setAutoSheet(ui.autoSheet.checked); });
ui.lockHeading.addEventListener('change', () => { ctl.lockHeading = ui.lockHeading.checked; });

$('btn-pause').addEventListener('click', togglePause);
$('btn-reset').addEventListener('click', reset);
$('btn-tack').addEventListener('click', () => {
  if (raceLocked() || lessons.run.status === 'running') { toast('В уроках и гонке поворот делаем рулём вручную'); return; }
  const twa = norm180(ctl.windFrom - state.heading);
  if (Math.abs(twa) > 95) { // на попутных курсах — поворот фордевинд
    autopilot = { target: ctl.windFrom + 180 + (twa > 0 ? 40 : -40) };
  } else {
    autopilot = { target: ctl.windFrom - Math.sign(twa || 1) * Math.max(45, Math.abs(twa)) };
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
$('hud').addEventListener('click', () => $('hud').classList.toggle('min'));

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
bindPad($('t-sheet'), $('t-sheet-thumb'), false, (k) => setSheet(k * 90));
$('t-pause').addEventListener('click', togglePause);
$('t-cam').addEventListener('click', () => { const order = ['chase', 'top', 'side', 'free']; setCamera(order[(order.indexOf(camMode) + 1) % 4]); });
$('t-tack').addEventListener('click', () => $('btn-tack').click());
$('t-auto').addEventListener('click', () => setAutoSheet(!ctl.autoSheet));
$('t-panel').addEventListener('click', () => $('panel').classList.toggle('open'));
$('t-windChip').addEventListener('click', () => $('panel').classList.add('open'));
$('t-windL').addEventListener('click', () => setWindFrom(ctl.windFrom - 10));
$('t-windR').addEventListener('click', () => setWindFrom(ctl.windFrom + 10));
// закрыть шторку тапом по сцене
canvas.addEventListener('pointerdown', () => $('panel').classList.remove('open'));
function updateTouch() {
  const th = $('t-rudder-thumb'); const tw = th.offsetWidth || 36; th.style.left = (50 + ctl.rudder / 35 * 50 * (1 - tw / Math.max(tw, th.parentElement.clientWidth))) + '%';
  const ts = $('t-sheet-thumb'); const trk = ts.parentElement; const tsz = ts.offsetHeight || 36; const usable = Math.max(1, trk.clientHeight - tsz);
  ts.style.top = (tsz / 2 + ctl.sheetShown / 90 * usable) + 'px';
}

function togglePause() {
  ctl.paused = !ctl.paused;
  $('btn-pause').textContent = ctl.paused ? 'Продолжить' : 'Пауза';
  $('btn-pause').classList.toggle('active', ctl.paused);
  $('t-pause').textContent = ctl.paused ? '▶' : '⏸';
  $('t-pause').classList.toggle('active', ctl.paused);
}
function reset() {
  const s = createState();
  Object.assign(state, s);
  state.heading = 90; ctl.rudder = 0; ui.rudder.value = 0; autopilot = null;
  ctl.sheet = 45; ui.sheet.value = 45;
  if (camMode !== 'free') setCamera(camMode);
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyC') { const order = ['chase', 'top', 'side', 'free']; setCamera(order[(order.indexOf(camMode) + 1) % 4]); }
  if (e.code === 'KeyV') { const v = !show.trueWind; for (const k of ['trueWind', 'appWind', 'vel', 'force']) show[k] = v; ['showTrue', 'showApp', 'showVel', 'showForce'].forEach(id => $(id).checked = v); }
  if (e.code === 'KeyT') $('btn-tack').click();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function handleKeys(dt) {
  const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
  const inS = keys.ArrowUp || keys.KeyW, outS = keys.ArrowDown || keys.KeyS;
  if (left || right) { autopilot = null; ctl.rudder = THREE.MathUtils.clamp(ctl.rudder + (right ? 1 : -1) * 70 * dt, -35, 35); ui.rudder.value = Math.round(ctl.rudder); }
  else if (ui.rudderReturn.checked && !autopilot && !padActive && document.activeElement !== ui.rudder) {
    const k = Math.min(1, dt * 5); ctl.rudder += (0 - ctl.rudder) * k; if (Math.abs(ctl.rudder) < 0.3) ctl.rudder = 0; ui.rudder.value = Math.round(ctl.rudder);
  }
  if (inS || outS) { ctl.autoSheet = false; ui.autoSheet.checked = false; ctl.sheet = THREE.MathUtils.clamp(ctl.sheet + (outS ? 1 : -1) * 40 * dt, 0, 90); ui.sheet.value = Math.round(ctl.sheet); }
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
  LESSONS.forEach((L, i) => {
    const b = document.createElement('button'); b.className = 'lesson' + (passed.has(L.id) ? ' passed' : '') + (mode === 'lesson' && lessons.run.index === i ? ' active' : '');
    b.innerHTML = `<span class="n">${passed.has(L.id) ? '✓' : i + 1}</span><span>${L.title}</span>`;
    b.addEventListener('click', () => { startLesson(i); $('panel').classList.remove('open'); });
    box.appendChild(b);
  });
}
function resetForTraining() {
  const s = createState(); Object.assign(state, s);
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
  tb.tag.textContent = 'ГОНКА'; tb.title.textContent = 'Два буя'; tb.goal.textContent = 'Обогни оранжевый наветренный буй (110 м против ветра) и вернись к синему. Таймер пошёл после отсчёта.';
  tb.note.textContent = ''; tb.fill.style.width = '0%'; tb.time.textContent = '';
  renderLessonList(); setCamera(camMode === 'free' ? 'chase' : camMode); lastHeading = state.heading; showGoal(6000);
  toast('3', true, 900);
}
function exitTraining() {
  lessons.stop(ctl); course.stop(); mode = 'free';
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
$('btn-course').addEventListener('click', () => { course.showCourse(!course.group.visible); });
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
function updateTraining(out, dt, t) {
  if (mode === 'race') {
    const r = course.race;
    if (r.phase === 'countdown') {
      ctl.paused = true;
      const n = Math.ceil(r.countdown); tb.time.textContent = String(n);
      if (n !== updateTraining.lastN) { updateTraining.lastN = n; if (n > 0) toast(String(n), true, 900); }
    }
    const ev = course.update(state, ctl, dt, t);
    if (ev === 'go') { ctl.paused = false; toast('СТАРТ!', true, 1200); $('btn-pause').textContent = 'Пауза'; $('t-pause').textContent = '⏸'; }
    if (ev === 'rounded') toast('Буй обогнут — теперь вниз, к синему', false, 2500);
    if (r.phase === 'leg1' || r.phase === 'leg2') {
      tb.time.textContent = fmtTime(r.t);
      tb.note.textContent = `${r.phase === 'leg1' ? 'К оранжевому бую' : 'К синему бую'} · ${Math.round(r.dist)} м · пеленг ${Math.round(r.bearing)}°`;
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
window.__sim = { state, ctl, course, lessons, startRace, startLesson };

// ---------- камера ----------
const camOffset = new THREE.Vector3();
const camTargetOffset = new THREE.Vector3(0, 0.9, 0);
let lastHeading = state.heading;
function boatForward() { const p = state.heading * DEG; return new THREE.Vector3(Math.sin(p), 0, -Math.cos(p)); }
function boatStarboard() { const p = state.heading * DEG; return new THREE.Vector3(Math.cos(p), 0, Math.sin(p)); }
function setCamera(mode) {
  camMode = mode;
  document.querySelectorAll('#cam-seg button').forEach(b => b.classList.toggle('active', b.dataset.cam === mode));
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
function updateCamera(dt) {
  const target = boat.root.position.clone().add(camTargetOffset);
  let off = camera.position.clone().sub(controls.target);
  if (camMode === 'chase' || camMode === 'side') {
    const dh = norm180(state.heading - lastHeading) * DEG;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), -dh);
  }
  lastHeading = state.heading;
  controls.target.copy(target);
  camera.position.copy(target).add(off);
  controls.update();
}
setCamera('chase');

// ---------- панель: вывод ----------
let uiAcc = 0;
function updateUI(out, dt) {
  uiAcc += dt; if (uiAcc < 0.1) return; uiAcc = 0;
  $('v-windFrom').textContent = `${Math.round(ctl.windFrom)}°`;
  $('v-windName').textContent = compassName(ctl.windFrom);
  $('v-windSpeed').textContent = `${fmt(ctl.windSpeed, 1)} уз`;
  $('v-heading').textContent = `${Math.round(state.heading)}°`;
  $('v-twa').textContent = `${Math.round(Math.abs(out.TWA))}° к ветру`;
  if (document.activeElement !== ui.heading) ui.heading.value = Math.round(state.heading);
  $('v-sheet').textContent = `${Math.round(out.sheet)}°` + (ctl.autoSheet ? ' (авто)' : '');
  if (ctl.autoSheet) ui.sheet.value = Math.round(out.sheet);
  const r = Math.round(ctl.rudder);
  $('v-rudder').textContent = r === 0 ? 'прямо' : `${Math.abs(r)}° ${r > 0 ? 'вправо →' : '← влево'}`;
  $('t-rudder-val').textContent = r === 0 ? 'прямо' : `${Math.abs(r)}° ${r > 0 ? 'вправо' : 'влево'}`;
  $('t-sheet-val').textContent = `${Math.round(out.sheet)}°` + (ctl.autoSheet ? ' авто' : '');
  $('t-windChip').textContent = `Ветер ${Math.round(ctl.windFrom)}° ${compassName(ctl.windFrom)} · ${fmt(ctl.windSpeed, 0)} уз`;
  if (document.activeElement !== ui.rudder) ui.rudder.value = r;

  $('pos-name').textContent = out.pos.name;
  $('tack-name').textContent = `${out.tack} · ${out.pos.desc} · ${Math.round(out.twaAbs)}° к ветру`;
  const hint = $('hint'); hint.textContent = out.hint; hint.className = 'hint ' + out.hintClass;

  $('s-speed').textContent = `${fmt(out.speedKn)} уз`;
  $('speed-big').textContent = fmt(out.speedKn);
  $('vmg-big').textContent = `${fmt(Math.abs(out.vmgKn))} ${out.twaAbs < 90 ? 'к ветру' : 'по ветру'}`;
  const vmg = out.vmgKn;
  $('s-vmg').textContent = `${fmt(Math.abs(vmg))} уз ${out.twaAbs < 90 ? 'к ветру' : 'по ветру'}`;
  $('s-aws').textContent = `${fmt(out.AWS / KN, 1)} уз · ${Math.round(out.awaAbs)}°`;
  $('s-aoa').textContent = `${Math.round(out.aoa)}°`;
  $('s-heel').textContent = `${Math.round(Math.abs(state.heel))}° ${state.heel > 0.5 ? 'на левый борт' : state.heel < -0.5 ? 'на правый борт' : ''}`;
  $('s-leeway').textContent = `${fmt(Math.abs(out.leeway), 1)}°`;
  const sail = $('s-sail'); sail.textContent = `${out.sailState} · ${Math.round(out.Fmag)} Н`; sail.className = out.sailClass;
}

// ---------- цикл ----------
const clock = new THREE.Clock();
let t = 0;
let labelK = 1;
let lastOffsetY = -1;
function layoutOverlays(w) {
  // лодка — в центре свободной области между шапкой и сенсорным пультом
  const h = canvas.clientHeight;
  if (w < 900 || w / h < 0.9) {
    const top = $('topbar').getBoundingClientRect().bottom;
    const touch = $('touch'); const tr = touch.getBoundingClientRect();
    const bottom = (getComputedStyle(touch).display !== 'none' && tr.height > 0) ? tr.top : h;
    const centerY = (top + bottom) / 2;
    const offY = Math.round(THREE.MathUtils.clamp(h / 2 - centerY, -h * 0.2, h * 0.3));
    if (offY !== lastOffsetY) { lastOffsetY = offY; camera.setViewOffset(w, h, 0, offY, w, h); camera.updateProjectionMatrix(); }
  } else if (lastOffsetY !== 0) { lastOffsetY = 0; camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  const k = THREE.MathUtils.clamp(w / 1100, 0.5, 1);
  if (Math.abs(k - labelK) > 0.01) {
    labelK = k; setLabelScale(compass, k);
    for (const a of Object.values(arrows)) a.setLabelScale(k);
  }
  const hud = $('hud');
  if (w < 900) { const r = $('topbar').getBoundingClientRect(); hud.style.top = Math.round(r.bottom + 8) + 'px'; $('lb').style.top = hud.style.top; }
  else { hud.style.top = ''; $('lb').style.top = ''; }
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  layoutOverlays(w);
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; const portrait = w / h < 0.9; camera.fov = portrait ? 68 : 50;
    if (portrait) camera.setViewOffset(w, h, 0, Math.round(h * 0.07), w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  resize();
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  handleKeys(dt);
  updateCompass(dt);

  // автопилот (оверштаг / фордевинд)
  if (autopilot) {
    const err = norm180(autopilot.target - state.heading);
    ctl.rudder = THREE.MathUtils.clamp(err * 1.6, -35, 35);
    ui.rudder.value = Math.round(ctl.rudder);
    if (Math.abs(err) < 2.5 && Math.abs(state.yawRate) < 6) { autopilot = null; ctl.rudder = 0; ui.rudder.value = 0; }
  }

  // физика с подшагами
  let out;
  const sub = 3;
  for (let i = 0; i < sub; i++) out = step(state, ctl, dt / sub);
  updateTraining(out, dt, t);

  // сцена
  boat.update(state, out, ctl, dt, t);
  water.userData.update(t, Math.round(state.x), Math.round(state.z), ctl.windFrom * DEG);
  compass.userData.update(state.x, state.z, ctl.windFrom);
  compass.userData.setNoGo(show.noGo);
  streaks.visible = show.streaks;
  if (show.streaks) streaks.userData.update(ctl.paused ? 0 : dt, state.x, state.z, out.Wx, out.Wz, ctl.windSpeed);
  const stern = tmpA.set(HULL.xStern + 0.2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), boat.root.rotation.y).add(boat.root.position);
  wake.userData.update(ctl.paused ? 0 : dt, stern.x, stern.z, state.vf, state.heading * DEG);
  clouds.position.set(state.x, 0, state.z);
  sky.position.set(state.x, 0, state.z);
  sun.position.copy(boat.root.position).addScaledVector(sunDir, 40);
  sun.target.position.copy(boat.root.position);

  // стрелки
  const center = boat.root.position.clone(); center.y = 0.95;
  const WS = 0.5; // м на 1 м/с ветра
  const endAt = (vx, vz, R) => { const L = Math.hypot(vx, vz) || 1; return new THREE.Vector3(center.x - vx / L * R, center.y, center.z - vz / L * R); };
  arrows.trueWind.setVisible(show.trueWind, show.labels);
  arrows.trueWind.set(tmpB.set(center.x - out.Wx * WS, center.y, center.z - out.Wz * WS), endAt(out.Wx, out.Wz, 1.0), `Ветер ${fmt(ctl.windSpeed, 0)} уз`, dt);
  arrows.appWind.setVisible(show.appWind, show.labels);
  const appFrom = new THREE.Vector3(center.x - out.Ax * WS, 2.4, center.z - out.Az * WS);
  const appTo = endAt(out.Ax, out.Az, 0.6); appTo.y = 2.4; appFrom.y = 2.4;
  arrows.appWind.set(appFrom, appTo, `Вымпельный ${fmt(out.AWS / KN, 0)} уз`, dt);
  arrows.vel.setVisible(show.vel, show.labels);
  arrows.vel.set(center, new THREE.Vector3(center.x + out.Vx * 1.3, center.y, center.z + out.Vz * 1.3), `${fmt(out.speedKn)} уз`, dt);
  arrows.force.setVisible(show.force, show.labels);
  const fs = 0.012;
  const fOrigin = boat.root.position.clone().add(boatForward().multiplyScalar(0.3)); fOrigin.y = 1.7;
  arrows.force.set(fOrigin, new THREE.Vector3(fOrigin.x + out.forceWorldX * fs, 1.7, fOrigin.z + out.forceWorldZ * fs), `${Math.round(out.Fmag)} Н`, dt);

  ctl.sheetShown = out.sheet;
  updateTouch();
  updateCamera(dt);
  updateUI(out, dt);
  drawMinimap(state, out, ctl, show, course.group.visible ? { marks: [{ ...course.marks.W, color: '#ff5700', active: course.race.phase === 'leg1' }, { ...course.marks.L, color: '#0047ff', active: course.race.phase === 'leg2' }] } : null);
  renderer.render(scene, camera);
}

frame();
requestAnimationFrame(() => $('loading').classList.add('hide'));
