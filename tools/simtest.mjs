// Проверка физики без браузера: node tools/simtest.mjs
// Печатает установившиеся режимы, баланс руля, разгон, уроки, повороты и время круга автопилота.
import { createState, defaultControls, step, norm180, optimalSheet, PHYS_DT, KN } from '../js/physics.js';
const DT = PHYS_DT;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mk(setup) { const s = createState(), c = defaultControls(); c.gusts = false; s.vs = 0; setup(s, c); return [s, c]; }
function steer(s, c, target, lim = 18) { const err = norm180(target - s.heading); c.rudder = clamp(err * 1.2 - s.yawRate * 0.35, -lim, lim); }
const f = (v, d = 1) => v.toFixed(d);

console.log('— Установившиеся режимы (рулевой держит курс, шкот как указан) —');
function steady(label, wind, hdg, sheet, T = 50) {
  const [s, c] = mk((s, c) => { c.windSpeed = wind; s.heading = hdg; c.sheet = sheet; });
  let out, helm = 0, n = 0;
  for (let i = 0; i < T / DT; i++) { steer(s, c, hdg); out = step(s, c, DT); if (i > (T - 10) / DT) { helm += s.rudder; n++; } }
  console.log(label.padEnd(28), 'ход', f(out.speedKn), 'уз | VMG', f(Math.abs(out.vmgKn)), '| крен', f(Math.abs(s.heel), 0), '| хайк', f(s.hike, 2), '| атака', f(out.aoa, 0), '| дрейф', f(Math.abs(out.leeway)), '° | руль', f(helm / n), '° |', out.sailState, s.capsized ? 'ОВЕРКИЛЬ' : '');
}
steady('бейдевинд 45° 6 уз', 6, 45, 15); steady('бейдевинд 45° 10 уз', 10, 45, 15); steady('бейдевинд 45° 16 уз', 16, 45, 15); steady('бейдевинд 45° 22 уз', 22, 45, 15);
steady('бейдевинд 45° 22 уз шк.28', 22, 45, 28); steady('перебран 45° 10 уз шк.0', 10, 45, 0);
steady('галфвинд 12 уз шк.45', 12, 90, 45); steady('бакштаг 135° 12 уз шк.90', 12, 135, 90); steady('бакштаг 135° 20 уз шк.90', 20, 135, 90);
steady('фордевинд 12 уз', 12, 178, 90); steady('фордевинд 20 уз', 20, 178, 90);

console.log('— Без рулевого (руль в центре): куда лодку ведёт сама —');
for (const [label, wind, hdg, sheet] of [['бейдевинд шк.15', 10, 45, 15], ['бейдевинд шк.5 (перебран)', 10, 45, 5], ['галфвинд шк.45', 10, 90, 45], ['фордевинд шк.90', 10, 170, 90]]) {
  const [s, c] = mk((s, c) => { c.windSpeed = wind; s.heading = hdg; c.sheet = sheet; s.vf = 2; });
  for (let i = 0; i < 6 / DT; i++) step(s, c, DT);
  console.log(label.padEnd(28), 'за 6 с курс', hdg, '→', f(s.heading, 0), '(к ветру = уменьшение при ветре с 0°)');
}

console.log('— Разгон с места, галфвинд 10 уз —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 90; c.sheet = 45; s.vf = 0; });
  let t3 = null, maxLee = 0, drift = 0;
  for (let i = 0; i < 20 / DT; i++) { steer(s, c, 90); const o = step(s, c, DT); maxLee = Math.max(maxLee, Math.abs(s.vs)); if (t3 === null && o.speedKn >= 3) t3 = i * DT; }
  console.log('3 уз через', t3 === null ? '—' : f(t3) + ' с', '| макс. боковой снос', f(maxLee, 2), 'м/с | снесло под ветер на', f(Math.abs(s.z), 1), 'м за 20 с'); }

console.log('— Урок 1: выход из левентика —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 8; s.vf = 0.9; c.sheet = 25; });
  let done = null, o;
  for (let i = 0; i < 40 / DT; i++) { steer(s, c, 55, 20); o = step(s, c, DT); if (done === null && o.twaAbs >= 45 && o.speedKn >= 2) done = i * DT; }
  console.log('пройден за', done === null ? 'НЕ ПРОЙДЕН' : f(done) + ' с', '| итог: курс', f(s.heading, 0), 'ход', f(o.speedKn)); }

console.log('— Оверштаг 45°→315°, 10 уз —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 45; s.vf = 2.2; c.sheet = 15; s.side = -1; });
  for (let i = 0; i < 6 / DT; i++) { steer(s, c, 45); step(s, c, DT); }
  let minV = 9, tDone = null, o;
  for (let i = 0; i < 25 / DT; i++) { steer(s, c, 315, 20); o = step(s, c, DT); minV = Math.min(minV, o.speedKn); if (tDone === null && o.TWA > 40 && o.speedKn > 2) tDone = i * DT; }
  console.log('готов через', tDone === null ? 'НЕ ВЫШЕЛ' : f(tDone) + ' с', '| мин. ход в повороте', f(minV), 'уз'); }

console.log('— Поворот фордевинд —');
for (const [wind, sheet] of [[10, 90], [10, 40], [18, 90], [18, 40], [24, 90]]) {
  const [s, c] = mk((s, c) => { c.windSpeed = wind; s.heading = 160; s.vf = 2.5; c.sheet = sheet; s.side = -1; });
  for (let i = 0; i < 8 / DT; i++) { steer(s, c, 160); step(s, c, DT); }
  let maxHeel = 0, caps = false;
  for (let i = 0; i < 10 / DT; i++) { steer(s, c, 200, 15); step(s, c, DT); maxHeel = Math.max(maxHeel, Math.abs(s.heel)); if (s.capsized) caps = true; }
  console.log(`ветер ${wind} уз, шкот ${sheet}°:`.padEnd(26), 'удар', f(s.lastGybe.kick, 0), '° | макс. крен', f(maxHeel, 0), '°', caps ? '→ ОВЕРКИЛЬ' : ''); }

console.log('— Гонка автопилотом: старт (0,12), буй (0,−110), финиш в воротах z=0 —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; c.windFrom = 0; s.x = 0; s.z = 12; s.heading = 45; s.vf = 1.5; c.sheet = 20; });
  let t = 0, phase = 1, tgt = 45, tacks = 0;
  while (t < 600) {
    if (phase === 1) {
      const dz = s.z - (-116), lay = Math.abs(dz) * 1.0;          // лейлайн 45°
      if (tgt === 45 && s.x > Math.min(40, lay)) { tgt = 315; tacks++; } else if (tgt === 315 && s.x < -Math.min(40, lay)) { tgt = 45; tacks++; }
      if (s.z < -116) { phase = 2; }
      c.sheet = optimalSheet(Math.abs(s.out.AWA ?? 30));
    } else if (phase === 2) { tgt = s.x > 4 ? 250 : s.x < -4 ? 110 : 180; if (Math.abs(s.x) > 3 && s.z < -116) tgt = s.x > 0 ? 270 : 90; if (s.z > -112) phase = 3; c.sheet = optimalSheet(Math.abs(s.out.AWA ?? 90)); }
    else { const want = Math.atan2(0 - s.x, -(6 - s.z)) * 180 / Math.PI; tgt = (want + 360) % 360; c.sheet = optimalSheet(Math.abs(s.out.AWA ?? 150)); if (s.z >= 0) break; }
    steer(s, c, tgt, 18); step(s, c, DT); t += DT;
  }
  console.log('время круга', f(t), 'с (' + Math.floor(t / 60) + ':' + f(t % 60).padStart(4, '0') + ') | поворотов оверштаг', tacks, '| финиш x =', f(s.x)); }
