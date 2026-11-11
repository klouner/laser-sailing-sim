// Среда: волны и порывы ветра. Одни и те же формулы считаются здесь (физика, качка лодки, буи)
// и в шейдере океана (js/gfx/shaders.js), поэтому видимое совпадает с действующим.
// Волны трохоидальные (волны Герстнера): частица воды ходит по кругу, гребень от этого острый, ложбина плоская.

const TAU = Math.PI * 2, DEG = Math.PI / 180, G = 9.81;
const wrap = (a) => a - TAU * Math.floor(a / TAU);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const NW = 6;
// Длина при свежем ветре (м), доля амплитуды, отклонение от направления ветра (град), дальность затухания (м).
// Короткие волны гасятся вдали от лодки: там сетка воды редкая и показать их не может.
const WAVES = [
  { L: 15.0, a: 0.33, off: -6, f0: 420, f1: 900 },
  { L: 10.2, a: 0.24, off: 13, f0: 220, f1: 460 },
  { L: 6.6, a: 0.17, off: -21, f0: 90, f1: 190 },
  { L: 4.2, a: 0.12, off: 29, f0: 42, f1: 90 },
  { L: 2.8, a: 0.08, off: -37, f0: 22, f1: 46 },
  { L: 1.8, a: 0.06, off: 46, f0: 12, f1: 26 },
];
// Порывы: крупные пятна, которые несёт ветром. Заходы: ещё крупнее.
const GUSTS = [{ L: 95, dir: 20, a: 0.5 }, { L: 57, dir: 115, a: 0.3 }, { L: 150, dir: 70, a: 0.2 }];
const SHIFTS = [{ L: 210, dir: 50, a: 0.6 }, { L: 130, dir: 150, a: 0.4 }];

export function createEnvironment() {
  const waves = WAVES.map((w) => ({ ...w, k: TAU / w.L, omega: 0, phase: Math.random() * TAU, dx: 0, dz: -1, amp: 0, hor: 0 }));
  const mkCell = (c) => ({ qx: Math.sin(c.dir * DEG) * TAU / c.L, qz: -Math.cos(c.dir * DEG) * TAU / c.L, a: c.a, phase: Math.random() * TAU });
  const gusts = GUSTS.map(mkCell), shifts = SHIFTS.map(mkCell);
  const env = {
    pivotX: 0, pivotZ: 0, ampTotal: 0.04, sea: 0.3, sharp: 0.6, waveAngle: null, whitecap: 0, gustOn: 0,
    gustSpeed: 0, gustDir: 0,       // порыв и заход ветра в точке лодки, −1..1
    boat: { fx: 0, fz: -1, heave: 0, sf: 0, ss: 0, mask: 1, wash: 0 },
    // массивы для шейдера: обновляются на месте
    u: {
      dir: new Array(NW * 2).fill(0), p: new Array(NW * 4).fill(0), fade: waves.flatMap((w) => [w.f0, w.f1]),
      gustQ: gusts.flatMap((g) => [g.qx, g.qz]), gustP: new Array(3 * 2).fill(0),
    },
  };

  // Высота воды в мировой точке. minL — учитывать только волны не короче minL (качке лодки рябь не нужна).
  // Гребни смещены по горизонтали, поэтому сначала ищется исходная точка поверхности: двух шагов хватает.
  env.heightAt = (x, z, minL = 0) => {
    let px = x - env.pivotX, pz = z - env.pivotZ;
    const tx = px, tz = pz;
    let h = 0;
    for (let it = 0; it < 3; it++) {
      const d = Math.hypot(px, pz);
      let ox = 0, oz = 0; h = 0;
      for (const w of waves) {
        if (w.L0 < minL) continue;
        const f = 1 - smooth(w.f0, w.f1, d); if (f <= 0) continue;
        const th = w.k * (w.dx * px + w.dz * pz) + w.phase, c = Math.cos(th);
        ox += w.dx * w.hor * f * c; oz += w.dz * w.hor * f * c; h += w.amp * f * Math.sin(th);
      }
      if (it < 2) { px = tx - ox; pz = tz - oz; }
    }
    return h;
  };
  const cellAt = (cells, rx, rz) => { let g = 0; for (const c of cells) g += c.a * Math.sin(c.qx * rx + c.qz * rz + c.phase); return g; };
  env.gustAt = (x, z) => cellAt(gusts, x - env.pivotX, z - env.pivotZ);

  env.update = (dt, bx, bz, windFromDeg, windKn, gustsOn, paused) => {
    // опорная точка переезжает в лодку: фазы пересчитываются так, чтобы поле не изменилось
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
    const k = Math.min(1, dt * 0.25);
    env.sea += (Math.min(1, Math.max(0, (windKn - 2) / 21)) - env.sea) * k;
    env.ampTotal = 0.012 + 0.31 * Math.pow(env.sea, 1.25);
    env.sharp += ((0.7 + 1.9 * smooth(5, 18, windKn)) - env.sharp) * k;
    const lenK = 0.5 + 0.5 * env.sea;                                  // в слабый ветер волна короче
    const step = paused ? 0 : dt;
    const wx = Math.sin(to), wz = -Math.cos(to), ws = windKn * 0.5144;
    const U = env.u;
    waves.forEach((w, i) => {
      const a = env.waveAngle + w.off * DEG;
      w.dx = Math.sin(a); w.dz = -Math.cos(a);
      w.L0 = w.L * lenK; w.k = TAU / w.L0; w.omega = Math.sqrt(G * w.k);
      w.amp = env.ampTotal * w.a; w.hor = w.amp * env.sharp;
      w.phase = wrap(w.phase - w.omega * step);
      U.dir[i * 2] = w.dx; U.dir[i * 2 + 1] = w.dz;
      U.p[i * 4] = w.k; U.p[i * 4 + 1] = w.amp; U.p[i * 4 + 2] = w.hor; U.p[i * 4 + 3] = w.phase;
    });
    // пятна порывов несёт ветром (чуть медленнее самого ветра)
    const adv = 0.7 * ws * step;
    gusts.forEach((c, i) => { c.phase = wrap(c.phase - (c.qx * wx + c.qz * wz) * adv); U.gustP[i * 2] = c.a; U.gustP[i * 2 + 1] = c.phase; });
    for (const c of shifts) c.phase = wrap(c.phase - (c.qx * wx + c.qz * wz) * adv);
    env.gustOn += ((gustsOn ? 1 : 0) - env.gustOn) * Math.min(1, dt * 1.5);
    env.whitecap = smooth(10, 19, windKn);
    env.gustSpeed = cellAt(gusts, 0, 0); env.gustDir = cellAt(shifts, 0, 0);
  };
  // Плоскость лодки: вода под корпусом прижимается к ней, чтобы гребни не проходили сквозь кокпит
  env.setBoatPlane = (fx, fz, heave, slopeFwd, slopeStbd, mask = 1) => { const b = env.boat; b.fx = fx; b.fz = fz; b.heave = heave; b.sf = slopeFwd; b.ss = slopeStbd; b.mask = mask; };
  env.setBoatWash = (v) => { env.boat.wash = v; };
  env.update(0, 0, 0, 0, 10, false, true);
  return env;
}
