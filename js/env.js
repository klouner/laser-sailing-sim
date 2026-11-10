// Среда: волны и порывы ветра. Одни и те же формулы считаются в JS (физика, качка лодки, буи)
// и в шейдерах (вода, пена, всё, что лежит на воде), поэтому видимое совпадает с действующим.
import * as THREE from 'three';

const TAU = Math.PI * 2, DEG = Math.PI / 180, G = 9.81;
const wrap = (a) => a - TAU * Math.floor(a / TAU);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Волны: длина (м), доля амплитуды, отклонение от направления ветра (град), дальность затухания (м).
// Короткие волны гасятся вдали от лодки: там сетка воды редкая и не может их показать без ряби.
const WAVES = [
  { L: 11.0, a: 0.46, off: -8, f0: 150, f1: 290 },
  { L: 6.3, a: 0.28, off: 14, f0: 60, f1: 120 },
  { L: 3.7, a: 0.16, off: -22, f0: 24, f1: 48 },
  { L: 2.1, a: 0.10, off: 31, f0: 11, f1: 24 },
];
// Порывы: крупные пятна, которые несёт ветром. Вектор — волновое число (рад/м), доля амплитуды.
const GUSTS = [
  { L: 95, dir: 20, a: 0.5 }, { L: 57, dir: 115, a: 0.3 }, { L: 150, dir: 70, a: 0.2 },
];
const SHIFTS = [{ L: 210, dir: 50, a: 0.6 }, { L: 130, dir: 150, a: 0.4 }];

export const WAVE_GLSL = /* glsl */`
uniform vec2 uWaveDir[4]; uniform float uWaveK[4]; uniform float uWaveAmp[4]; uniform float uWavePhase[4]; uniform vec2 uWaveFade[4];
uniform vec2 uPivot; uniform float uAmpTotal;
uniform vec2 uBoatFwd; uniform vec3 uBoatPlane; uniform float uBoatMask;
// высота волны и её уклон в мировой точке p (xz). Под корпусом вода прижимается к плоскости лодки.
vec3 waveHG(vec2 p) {
  vec2 r = p - uPivot; float d = length(r);
  float h = 0.0; vec2 g = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float f = 1.0 - smoothstep(uWaveFade[i].x, uWaveFade[i].y, d);
    float ph = uWaveK[i] * dot(uWaveDir[i], r) + uWavePhase[i];
    h += f * uWaveAmp[i] * sin(ph);
    g += f * uWaveAmp[i] * uWaveK[i] * cos(ph) * uWaveDir[i];
  }
  float bf = dot(r, uBoatFwd), bs = dot(r, vec2(-uBoatFwd.y, uBoatFwd.x));
  float e = length(vec2(bf / 2.45, bs / 0.95));
  float m = uBoatMask * (1.0 - smoothstep(0.7, 1.25, e));
  float hp = uBoatPlane.x + uBoatPlane.y * bf + uBoatPlane.z * bs;
  return vec3(mix(h, hp, m), g * (1.0 - m));
}
`;
const GUST_GLSL = /* glsl */`
uniform vec2 uGustQ[3]; uniform float uGustAmp[3]; uniform float uGustPhase[3];
float gustV(vec2 p) { vec2 r = p - uPivot; float g = 0.0; for (int i = 0; i < 3; i++) g += uGustAmp[i] * sin(dot(uGustQ[i], r) + uGustPhase[i]); return g; }
`;

export function createEnvironment() {
  const waves = WAVES.map((w) => ({ ...w, k: TAU / w.L, omega: Math.sqrt(G * TAU / w.L), phase: Math.random() * TAU, dx: 0, dz: -1, amp: 0 }));
  const mkCell = (c) => ({ qx: Math.sin(c.dir * DEG) * TAU / c.L, qz: -Math.cos(c.dir * DEG) * TAU / c.L, a: c.a, phase: Math.random() * TAU });
  const gusts = GUSTS.map(mkCell), shifts = SHIFTS.map(mkCell);
  const env = {
    pivotX: 0, pivotZ: 0, ampTotal: 0.05, waveAngle: null, whitecap: 0, gustOn: 0,
    gustSpeed: 0, gustDir: 0,       // порыв и заход ветра в точке лодки, −1..1
    boat: { fx: 0, fz: -1, heave: 0, sf: 0, ss: 0, mask: 1 },
  };
  const U = env.uniforms = {
    uWaveDir: { value: waves.map(() => new THREE.Vector2(0, -1)) },
    uWaveK: { value: waves.map((w) => w.k) },
    uWaveAmp: { value: waves.map(() => 0) },
    uWavePhase: { value: waves.map((w) => w.phase) },
    uWaveFade: { value: waves.map((w) => new THREE.Vector2(w.f0, w.f1)) },
    uPivot: { value: new THREE.Vector2() },
    uAmpTotal: { value: 0.05 },
    uBoatFwd: { value: new THREE.Vector2(0, -1) }, uBoatPlane: { value: new THREE.Vector3() }, uBoatMask: { value: 1 },
    uGustQ: { value: gusts.map((g) => new THREE.Vector2(g.qx, g.qz)) },
    uGustAmp: { value: gusts.map((g) => g.a) },
    uGustPhase: { value: gusts.map((g) => g.phase) },
    uGustOn: { value: 0 }, uWhitecap: { value: 0 },
  };

  // Высота воды в мировой точке (без «прижатия» под корпусом). minL — учитывать только волны не короче minL.
  env.heightAt = (x, z, minL = 0) => {
    const rx = x - env.pivotX, rz = z - env.pivotZ, d = Math.hypot(rx, rz);
    let h = 0;
    for (const w of waves) {
      if (w.L < minL) continue;
      const f = 1 - smooth(w.f0, w.f1, d);
      if (f > 0) h += f * w.amp * Math.sin(w.k * (w.dx * rx + w.dz * rz) + w.phase);
    }
    return h;
  };
  const cellAt = (cells, rx, rz) => { let g = 0; for (const c of cells) g += c.a * Math.sin(c.qx * rx + c.qz * rz + c.phase); return g; };
  env.gustAt = (x, z) => cellAt(gusts, x - env.pivotX, z - env.pivotZ);

  // Шаг среды. windFromDeg — откуда ветер; boat — положение лодки; paused — время стоит.
  env.update = (dt, bx, bz, windFromDeg, windKn, gustsOn, paused) => {
    // перенос опорной точки в лодку: фазы пересчитываются так, чтобы поле не изменилось
    const sx = bx - env.pivotX, sz = bz - env.pivotZ;
    for (const w of waves) w.phase += w.k * (w.dx * sx + w.dz * sz);
    for (const c of gusts) c.phase += c.qx * sx + c.qz * sz;
    for (const c of shifts) c.phase += c.qx * sx + c.qz * sz;
    env.pivotX = bx; env.pivotZ = bz;
    // волны идут по ветру; при смене ветра разворачиваются постепенно
    const to = (windFromDeg + 180) * DEG;
    if (env.waveAngle === null) env.waveAngle = to;
    let da = to - env.waveAngle; da = Math.atan2(Math.sin(da), Math.cos(da));
    env.waveAngle += da * Math.min(1, dt * 0.35);
    const sea = Math.min(1, Math.max(0, (windKn - 3) / 20));
    const ampT = 0.018 + 0.21 * Math.pow(sea, 1.15);
    env.ampTotal += (ampT - env.ampTotal) * Math.min(1, dt * 0.25);
    const step = paused ? 0 : dt;
    const wx = Math.sin(to), wz = -Math.cos(to), ws = windKn * 0.5144;   // скорость ветра, м/с
    waves.forEach((w, i) => {
      const a = env.waveAngle + w.off * DEG;
      w.dx = Math.sin(a); w.dz = -Math.cos(a); w.amp = env.ampTotal * w.a;
      w.phase = wrap(w.phase - w.omega * step);
      U.uWaveDir.value[i].set(w.dx, w.dz); U.uWaveAmp.value[i] = w.amp; U.uWavePhase.value[i] = w.phase;
    });
    // пятна порывов несёт ветром (чуть медленнее самого ветра)
    const adv = 0.7 * ws * step;
    gusts.forEach((c, i) => { c.phase = wrap(c.phase - (c.qx * wx + c.qz * wz) * adv); U.uGustPhase.value[i] = c.phase; });
    for (const c of shifts) c.phase = wrap(c.phase - (c.qx * wx + c.qz * wz) * adv);
    env.gustOn += ((gustsOn ? 1 : 0) - env.gustOn) * Math.min(1, dt * 1.5);
    env.whitecap = smooth(11, 19, windKn);
    env.gustSpeed = cellAt(gusts, 0, 0); env.gustDir = cellAt(shifts, 0, 0);
    U.uPivot.value.set(bx, bz); U.uAmpTotal.value = Math.max(0.01, env.ampTotal);
    U.uGustOn.value = env.gustOn; U.uWhitecap.value = env.whitecap;
  };
  // Плоскость лодки: вода под корпусом прижимается к ней, чтобы гребни не проходили сквозь кокпит
  env.setBoatPlane = (fx, fz, heave, slopeFwd, slopeStbd, mask = 1) => {
    U.uBoatFwd.value.set(fx, fz); U.uBoatPlane.value.set(heave, slopeFwd, slopeStbd); U.uBoatMask.value = mask;
  };
  return env;
}

// Делает материал «лежащим на воде»: вершины поднимаются по волнам. Геометрия должна быть в плоскости XZ
// (мировая ось Y — вверх), у объекта допустимы только перенос и поворот вокруг Y.
export function floatOnWaves(material, env, lift = 0.05) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, env.uniforms);
    sh.uniforms.uLift = { value: lift };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAVE_GLSL + '\nuniform float uLift;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 wpF = (modelMatrix * vec4(transformed, 1.0)).xyz;
        transformed.y += waveHG(wpF.xz).x + uLift;`);
  };
  material.customProgramCacheKey = () => 'floatOnWaves';
  return material;
}
export { GUST_GLSL };
