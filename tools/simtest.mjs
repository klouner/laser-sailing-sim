// Проверка физики без браузера: node tools/simtest.mjs
// Печатает установившиеся режимы, баланс руля, разгон, выход из левентика, повороты и время круга автопилота.
import { createState, defaultControls, step, settleRig, norm180, optimalSheet, PHYS_DT, KN } from '../js/physics.js';
const DT = PHYS_DT;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mk(setup) { const s = createState(), c = defaultControls(); c.gusts = false; setup(s, c); settleRig(s, c); return [s, c]; }
function steer(s, c, target, lim = 30) { const err = norm180(target - s.heading); c.rudder = clamp(err * 1.3 - s.yawRate * 0.4, -lim, lim); }
const f = (v, d = 1) => v.toFixed(d);

console.log('— Установившиеся режимы (рулевой держит курс) —');
function steady(label, wind, hdg, sheet, T = 60) {
  const [s, c] = mk((s, c) => { c.windSpeed = wind; s.heading = hdg; c.sheet = sheet === 'auto' ? 30 : sheet; if (sheet === 'auto') c.autoSheet = true; });
  let out, helm = 0, n = 0, caps = false, maxHeel = 0;
  for (let i = 0; i < T / DT; i++) { steer(s, c, hdg); out = step(s, c, DT); if (s.capsized) caps = true; if (i > (T - 10) / DT) { helm += s.rudder; n++; maxHeel = Math.max(maxHeel, Math.abs(s.heel)); } }
  console.log(label.padEnd(26), 'ход', f(out.speedKn).padStart(5), 'уз | VMG', f(Math.abs(out.vmgKn)), '| крен', f(s.heel, 0).padStart(3), '| матрос', f(s.crewY, 2).padStart(5), 'м | атака', f(out.aoa, 0).padStart(2), '| дрейф', f(Math.abs(out.leeway)), '° | руль', f(helm / n).padStart(5), '° | бок.сила', f(Math.abs(out.Fs), 0).padStart(3), 'Н |', out.sailState, caps ? '(БЫЛ ОВЕРКИЛЬ)' : '');
  return out;
}
for (const w of [6, 10, 14, 18]) steady(`бейдевинд 45°, ${w} уз, авто`, w, 45, 'auto');
steady('бейдевинд 45°, 22 уз, шк.15', 22, 45, 15); steady('бейдевинд 45°, 22 уз, шк.30', 22, 45, 30);
for (const w of [6, 10, 14, 18]) steady(`галфвинд 90°, ${w} уз, авто`, w, 90, 'auto');
for (const w of [6, 10, 14, 20]) steady(`бакштаг 135°, ${w} уз`, w, 135, 'auto');
for (const w of [6, 10, 14, 20]) steady(`фордевинд 172°, ${w} уз`, w, 172, 90);

console.log('— Лучший курс на лавировке, 10 уз: VMG по углам —');
{ let line = ''; for (const a of [38, 42, 46, 50, 55, 60]) { const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = a; c.autoSheet = true; }); let o; for (let i = 0; i < 40 / DT; i++) { steer(s, c, a); o = step(s, c, DT); } line += `${a}°: ${f(o.speedKn)}/${f(o.vmgKn, 2)}  `; } console.log(line); }

console.log('— Без рулевого (руль в центре), 10 уз: куда лодку ведёт за 6 с —');
for (const [label, hdg, sheet] of [['бейдевинд шк.15', 45, 15], ['бейдевинд шк.4 (перебран)', 45, 4], ['галфвинд шк.45', 90, 45], ['галфвинд шк.80 (перетравлен)', 90, 80]]) {
  const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = hdg; c.sheet = sheet; s.vf = 2; });
  for (let i = 0; i < 6 / DT; i++) step(s, c, DT);
  console.log(label.padEnd(30), 'курс', hdg, '→', f(s.heading, 0), norm180(s.heading - hdg) < 0 ? '(привелась)' : '(увалилась)');
}

console.log('— Разгон с места, галфвинд 10 уз —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 90; c.sheet = 45; s.vf = 0; });
  let t3 = null, maxLee = 0, z0 = s.z;
  for (let i = 0; i < 20 / DT; i++) { steer(s, c, 90); const o = step(s, c, DT); maxLee = Math.max(maxLee, Math.abs(s.vs)); if (t3 === null && o.speedKn >= 3) t3 = i * DT; }
  console.log('3 уз через', t3 === null ? '—' : f(t3) + ' с', '| макс. боковой снос', f(maxLee, 2), 'м/с | снесло под ветер на', f(Math.abs(s.z - z0), 1), 'м за 20 с'); }

console.log('— Левентик: шкот потравлен, на заднем ходу руль наоборот, после 40° шкот подобран —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 3; s.vf = 0.0; c.sheet = 60; });
  let minU = 0, tOut = null, o;
  for (let i = 0; i < 40 / DT; i++) { const t = i * DT;
    c.rudder = s.vf < -0.05 ? -30 : 30;
    if (o && o.twaAbs > 40 && s.vf > -0.05) { c.sheet = 25; c.rudder = clamp(norm180(55 - s.heading) * 1.3 - s.yawRate * 0.4, -30, 30); }
    o = step(s, c, DT); minU = Math.min(minU, s.vf); if (tOut === null && o.twaAbs >= 45 && o.speedKn >= 2) tOut = t; }
  console.log('задний ход до', f(minU / KN), 'уз | вышла из левентика и набрала 2 уз через', tOut === null ? 'НЕ ВЫШЛА' : f(tOut) + ' с', '| курс', f(s.heading, 0)); }

console.log('— Оверштаг 45°→315°, 10 уз —');
for (const lim of [15, 30]) { const [s, c] = mk((s, c) => { c.windSpeed = 10; s.heading = 45; s.vf = 2.2; c.sheet = 14; });
  for (let i = 0; i < 8 / DT; i++) { steer(s, c, 45); step(s, c, DT); }
  let minV = 9, tDone = null, o, maxR = 0;
  for (let i = 0; i < 25 / DT; i++) { steer(s, c, 315, lim); o = step(s, c, DT); minV = Math.min(minV, o.speedKn); maxR = Math.max(maxR, Math.abs(s.yawRate)); if (tDone === null && o.TWA > 40 && o.speedKn > 2.5) tDone = i * DT; }
  console.log(`руль до ${lim}°:`, 'снова на ходу через', tDone === null ? 'НЕ ВЫШЛА' : f(tDone) + ' с', '| мин. ход', f(minV), 'уз | макс. скорость поворота', f(maxR, 0), '°/с'); }

console.log('— Поворот фордевинд 160°→200° —');
for (const [wind, sheet] of [[10, 90], [10, 40], [16, 90], [16, 40], [22, 90]]) {
  const [s, c] = mk((s, c) => { c.windSpeed = wind; s.heading = 160; s.vf = 2.5; c.sheet = sheet; });
  for (let i = 0; i < 8 / DT; i++) { steer(s, c, 160); step(s, c, DT); }
  let maxHeel = 0, caps = false, maxYaw = 0;
  for (let i = 0; i < 10 / DT; i++) { steer(s, c, 200, 20); step(s, c, DT); maxHeel = Math.max(maxHeel, Math.abs(s.heel)); maxYaw = Math.max(maxYaw, Math.abs(s.yawRate)); if (s.capsized) caps = true; }
  console.log(`ветер ${wind} уз, шкот ${sheet}°:`.padEnd(26), 'гик пришёл со скоростью', f(s.lastGybe.kick), 'рад/с | макс. крен', f(maxHeel, 0), '°', caps ? '→ ОВЕРКИЛЬ' : ''); }

console.log('— Гонка автопилотом: старт (0,12), буй (0,−110), финиш в воротах z=0 —');
{ const [s, c] = mk((s, c) => { c.windSpeed = 10; c.windFrom = 0; s.x = 0; s.z = 12; s.heading = 45; s.vf = 1.5; c.sheet = 20; });
  c.autoSheet = true;
  let t = 0, phase = 1, tgt = 45, tacks = 0;
  while (t < 600) {
    if (phase === 1) {
      const lay = Math.abs(s.z + 116);
      if (tgt === 45 && s.x > Math.min(40, lay)) { tgt = 315; tacks++; } else if (tgt === 315 && s.x < -Math.min(40, lay)) { tgt = 45; tacks++; }
      if (s.z < -116) phase = 2;
    } else if (phase === 2) { tgt = s.x > 4 ? 250 : s.x < -4 ? 110 : 180; if (Math.abs(s.x) > 3 && s.z < -116) tgt = s.x > 0 ? 270 : 90; if (s.z > -112) phase = 3; }
    else { tgt = (Math.atan2(0 - s.x, -(6 - s.z)) * 180 / Math.PI + 360) % 360; if (s.z >= 0) break; }
    steer(s, c, tgt, 28); step(s, c, DT); t += DT;
  }
  console.log('время круга', f(t), 'с (' + Math.floor(t / 60) + ':' + f(t % 60).padStart(4, '0') + ') | поворотов оверштаг', tacks, '| финиш x =', f(s.x), s.capsized ? '| оверкиль' : ''); }
