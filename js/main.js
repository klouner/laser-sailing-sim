import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoat, HULL } from './boat.js';
import { makeSky, makeClouds, makeWater, makeCompassRing, VectorArrow, makeWindStreaks, makeWake } from './scene.js';
import { createState, defaultControls, step, norm180, compassName, optimalSheet, KN } from './physics.js';
import { createMinimap } from './hud.js';

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

const boat = createBoat(); scene.add(boat.root);

const arrows = {
  trueWind: new VectorArrow(scene, 'rgb(59,130,246)', 'Истинный ветер'),
  appWind: new VectorArrow(scene, 'rgb(14,165,233)', 'Вымпельный ветер'),
  vel: new VectorArrow(scene, 'rgb(34,197,94)', 'Скорость лодки'),
  force: new VectorArrow(scene, 'rgb(249,115,22)', 'Сила на парусе'),
};
arrows.trueWind.labelAt = 0.0; arrows.trueWind.labelLift = 0.45;
arrows.appWind.labelAt = 0.4; arrows.appWind.labelLift = 0.5;
arrows.vel.labelAt = 1.0; arrows.vel.labelLift = 0.45;
arrows.force.labelAt = 1.0; arrows.force.labelLift = 0.45;

// ---------- состояние ----------
const state = createState();
const ctl = defaultControls();
ctl.heading = state.heading;
const show = { trueWind: true, appWind: true, vel: true, force: true, noGo: true, streaks: true };
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
function setAutoSheet(v) { ctl.autoSheet = v; ui.autoSheet.checked = v; $('t-auto').classList.toggle('active', v); }

ui.windFrom.addEventListener('input', () => { ctl.windFrom = +ui.windFrom.value; });
ui.windSpeed.addEventListener('input', () => { ctl.windSpeed = +ui.windSpeed.value; });
ui.heading.addEventListener('input', () => { state.heading = +ui.heading.value; state.yawRate = 0; autopilot = null; });
ui.sheet.addEventListener('input', () => { setSheet(+ui.sheet.value); });
ui.rudder.addEventListener('input', () => { ctl.rudder = +ui.rudder.value; autopilot = null; });
ui.rudder.addEventListener('change', () => { if (ui.rudderReturn.checked) { ctl.rudder = 0; ui.rudder.value = 0; } });
ui.autoSheet.addEventListener('change', () => { setAutoSheet(ui.autoSheet.checked); });
ui.lockHeading.addEventListener('change', () => { ctl.lockHeading = ui.lockHeading.checked; });

$('btn-pause').addEventListener('click', togglePause);
$('btn-reset').addEventListener('click', reset);
$('btn-tack').addEventListener('click', () => {
  const twa = norm180(ctl.windFrom - state.heading);
  if (Math.abs(twa) > 95) { // на попутных курсах — поворот фордевинд
    autopilot = { target: ctl.windFrom + 180 + (twa > 0 ? 40 : -40) };
  } else {
    autopilot = { target: ctl.windFrom - Math.sign(twa || 1) * Math.max(45, Math.abs(twa)) };
  }
  ui.lockHeading.checked = false; ctl.lockHeading = false;
});
document.querySelectorAll('#cam-seg button').forEach(b => b.addEventListener('click', () => setCamera(b.dataset.cam)));
for (const [id, key] of [['showTrue', 'trueWind'], ['showApp', 'appWind'], ['showVel', 'vel'], ['showForce', 'force'], ['showNoGo', 'noGo'], ['showStreaks', 'streaks']]) {
  $(id).addEventListener('change', (e) => { show[key] = e.target.checked; });
}
$('btn-panel').addEventListener('click', () => $('panel').classList.toggle('open'));
$('hud').addEventListener('click', () => $('hud').classList.toggle('min'));

// ---------- сенсорное управление ----------
let padActive = false;
function bindPad(el, thumb, horizontal, onValue, onRelease, holds = false) {
  const track = el.querySelector('.pad-track');
  let id = null;
  const apply = (e) => {
    const r = track.getBoundingClientRect();
    if (horizontal) { const half = r.width / 2 - 24; onValue(THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / half, -1, 1)); }
    else { const usable = r.height - 48; onValue(THREE.MathUtils.clamp((e.clientY - r.top - 24) / usable, 0, 1)); }
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
  const th = $('t-rudder-thumb'); th.style.left = (50 + ctl.rudder / 35 * 50 * (1 - 48 / Math.max(48, th.parentElement.clientWidth))) + '%';
  const ts = $('t-sheet-thumb'); const trk = ts.parentElement; const usable = Math.max(1, trk.clientHeight - 48);
  ts.style.top = (24 + ctl.sheetShown / 90 * usable) + 'px';
}

function togglePause() {
  ctl.paused = !ctl.paused;
  $('btn-pause').textContent = ctl.paused ? '▶ Продолжить' : '⏸ Пауза';
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
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; const portrait = w / h < 0.9; camera.fov = portrait ? 68 : 50;
    if (portrait) camera.setViewOffset(w, h, 0, Math.round(h * 0.14), w, h); else camera.clearViewOffset();
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
  const center = boat.root.position.clone(); center.y = 0.75;
  const WS = 0.5; // м на 1 м/с ветра
  arrows.trueWind.setVisible(show.trueWind);
  arrows.trueWind.set(tmpB.set(center.x - out.Wx * WS, 0.75, center.z - out.Wz * WS), center, `Истинный ветер ${fmt(ctl.windSpeed, 0)} уз`, dt);
  arrows.appWind.setVisible(show.appWind);
  const appFrom = new THREE.Vector3(center.x - out.Ax * WS, 2.3, center.z - out.Az * WS);
  const appTo = new THREE.Vector3(center.x, 2.3, center.z);
  arrows.appWind.set(appFrom, appTo, `Вымпельный ${fmt(out.AWS / KN, 0)} уз · ${Math.round(out.awaAbs)}°`, dt);
  arrows.vel.setVisible(show.vel);
  arrows.vel.set(center, new THREE.Vector3(center.x + out.Vx * 1.3, 0.75, center.z + out.Vz * 1.3), `Скорость ${fmt(out.speedKn)} уз`, dt);
  arrows.force.setVisible(show.force);
  const fs = 0.012;
  const fOrigin = boat.root.position.clone().add(boatForward().multiplyScalar(0.1)); fOrigin.y = 1.6;
  arrows.force.set(fOrigin, new THREE.Vector3(fOrigin.x + out.forceWorldX * fs, 1.6, fOrigin.z + out.forceWorldZ * fs), `Сила ${Math.round(out.Fmag)} Н`, dt);

  ctl.sheetShown = out.sheet;
  updateTouch();
  updateCamera(dt);
  updateUI(out, dt);
  drawMinimap(state, out, ctl, show);
  renderer.render(scene, camera);
}

frame();
requestAnimationFrame(() => $('loading').classList.add('hide'));
