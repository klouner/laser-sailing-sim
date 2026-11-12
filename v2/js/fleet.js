// Соперники: три лазера ходят по дистанции сами. Физика у них та же, что у лодки ученика, шкотом и
// откренкой управляет тот же автоматический матрос; рулит простой штурман: лавировка по лэйлайнам к наветренному
// знаку, спуск к линии и снова наверх. В гонке они проходят стартовую процедуру и стартуют по сигналу.
import { createBoat } from './gfx/boat.js';
import { createState, defaultControls, step, settleRig, norm180, PHYS_DT } from './physics.js';
import { COURSE } from './course.js';

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NUMS = [['208815', '3'], ['199240', '8'], ['216307', '12']];

export function createFleet(world, env, n = 3) {
  const boats = [];
  let enabled = true, wasRace = false;
  for (let i = 0; i < n; i++) {
    const gfx = createBoat(world, env, { player: false, num: NUMS[i][0], bow: NUMS[i][1], res: 0.5 });
    const state = createState(), ctl = defaultControls(); ctl.gusts = false; ctl.autoSheet = true;
    boats.push({ gfx, state, ctl, i, num: NUMS[i][0], leg: 'up', tack: i % 2 ? 1 : -1, lastTack: -99, acc: 0, go: 10 + 3 * i, gateX: -8 + 8 * i });
  }
  const put = (b, x, z, heading, leg, windFrom) => {
    const s = b.state; Object.assign(s, createState()); s.x = x; s.z = z; s.heading = (heading + 360) % 360; s.vf = 2;
    b.ctl.windFrom = windFrom; b.leg = leg; b.lastTack = -99; b.acc = 0; settleRig(s, b.ctl);
  };
  // свободное плавание: лодки разнесены по дистанции
  function spread(windFrom) {
    put(boats[0], -22, -40, windFrom - 45, 'up', windFrom); boats[0].tack = 1;
    if (boats[1]) { put(boats[1], 12, -78, windFrom + 172, 'down', windFrom); }
    if (boats[2]) { put(boats[2], 30, 44, windFrom + 45, 'up', windFrom); boats[2].tack = -1; }
  }
  // перед стартом: в зоне под линией, ходят вдоль неё
  function prestart(windFrom) {
    boats.forEach((b, i) => { put(b, -18 + 14 * i, 20 + 5 * i, windFrom + (i % 2 ? 80 : -80), 'pre', windFrom); b.go = 9 + 2.5 * i + Math.random() * 3; b.dir = i % 2 ? 1 : -1; });
  }
  spread(0);

  // Расстояние между осями двух корпусов (отрезки длиной 3,4 м) и направление от второго к первому
  const HL = 1.7, sep = { d: 99, nx: 0, nz: 1 };
  function hullGap(a, o) {
    const pa = a.heading * DEG, po = o.heading * DEG, ax = Math.sin(pa), az = -Math.cos(pa), ox = Math.sin(po), oz = -Math.cos(po);
    let best = 1e9, bx = 0, bz = 0;
    // достаточно сравнить концы и середину каждой оси с другой осью
    for (const [P, D, Q, E, sgn] of [[a, [ax, az], o, [ox, oz], 1], [o, [ox, oz], a, [ax, az], -1]]) for (const t of [-HL, 0, HL]) {
      const px = P.x + D[0] * t, pz = P.z + D[1] * t, u = clamp((px - Q.x) * E[0] + (pz - Q.z) * E[1], -HL, HL), dx = px - (Q.x + E[0] * u), dz = pz - (Q.z + E[1] * u), d = Math.hypot(dx, dz);
      if (d < best) { best = d; bx = dx * sgn; bz = dz * sgn; }
    }
    sep.d = best; const l = Math.hypot(bx, bz) || 1; sep.nx = bx / l; sep.nz = bz / l; return sep;
  }
  // уклонение: если другая лодка близко и по курсу, соперник отворачивает от неё
  function avoid(b, others) {
    const s = b.state, p = s.heading * DEG, fx = Math.sin(p), fz = -Math.cos(p); let bias = 0;
    for (const o of others) {
      if (o === s) continue;
      const dx = o.x - s.x, dz = o.z - s.z, d = Math.hypot(dx, dz); if (d > 13 || d < 0.01) continue;
      const ahead = (dx * fx + dz * fz) / d, side = dx * (-fz) + dz * fx;        // side > 0 — другая лодка справа по борту
      if (ahead < -0.25) continue;
      bias += -Math.sign(side || 1) * 38 * (1 - d / 13) * (0.4 + 0.6 * Math.max(0, ahead));
    }
    return clamp(bias, -45, 45);
  }
  function steer(b, windFrom, race, others) {
    const s = b.state, W = COURSE.windward; let target;
    if (b.leg === 'pre') {
      // ходят галфвиндом вдоль линии и ждут; за несколько секунд до сигнала идут на линию правым галсом
      if (!race || race.phase !== 'prestart' || race.toStart < b.go) { b.leg = 'up'; b.tack = 1; b.lastTack = s.time; }
      if (s.x > 13) b.dir = -1; else if (s.x < -13) b.dir = 1;
      target = windFrom + b.dir * 88 + clamp((s.z - (20 + 4 * b.i)) * 2, -25, 25) * b.dir;
      if (s.z < 6) target = windFrom + b.dir * 150;                          // слишком близко к линии: уйти вниз
    } else if (b.leg === 'up') {
      // точка чуть выше знака: подход правым галсом, знак остаётся слева
      const dx = W.x - 3 - s.x, dz = W.z - 7 - s.z, rel = norm180(Math.atan2(dx, -dz) / DEG - windFrom);
      if (s.time - b.lastTack > 8) {
        if (b.tack > 0 && rel > 41) { b.tack = -1; b.lastTack = s.time; } else if (b.tack < 0 && rel < -41) { b.tack = 1; b.lastTack = s.time; }
      }
      target = windFrom - b.tack * 44;
      if (Math.hypot(dx, dz) < 7 || s.z < W.z - 12) { b.leg = 'down'; b.gateX = -10 + Math.random() * 20; }
    } else {
      const dx = b.gateX - s.x, dz = 14 - s.z;
      target = Math.atan2(dx, -dz) / DEG;
      // чистый фордевинд неустойчив: держат бакштаг ближе к ветру градусов на пятнадцать
      const rel = norm180(target - (windFrom + 180)); if (Math.abs(rel) < 12) target = windFrom + 180 + (rel >= 0 ? 12 : -12);
      if (s.z > 10 || Math.hypot(dx, dz) < 6) { b.leg = 'up'; b.tack = s.x > 0 ? 1 : -1; b.lastTack = s.time; }
    }
    // до сигнала за линию не выходят: встают носом к ветру
    if (race && race.phase === 'prestart' && b.leg === 'up' && s.z < 4.5) target = windFrom;
    const e = norm180(target + avoid(b, others) - s.heading);
    b.ctl.rudder = Math.abs(e) > 18 ? Math.sign(e) * Math.min(38, Math.atan2(Math.abs(s.yawRate) * DEG * 2.15, Math.max(0.3, s.vf)) / DEG + 12) : clamp(e * 1.3 - s.yawRate * 0.4, -26, 26);
  }

  const others = [], near = { x: 0, z: 0, fx: 0, fz: 1, speed: 0 };
  let frame = 0, contact = null, contactAt = -99;
  // race — состояние гонки из course.js; player — состояние лодки ученика
  function update(dt, t, windFrom, windKn, race, paused, player) {
    api.wake = null; api.contact = null;
    if (!enabled) return;
    frame++; others.length = 0; others.push(player); for (const b of boats) others.push(b.state);
    let nearD = 24;
    const racing = !!(race && race.active);
    if (racing && race.phase === 'prestart' && !wasRace) prestart(windFrom);
    if (!racing && wasRace) spread(windFrom);
    wasRace = racing;
    for (const b of boats) {
      b.ctl.windFrom = windFrom; b.ctl.windSpeed = windKn; b.ctl.paused = false;
      if (!paused) {
        b.acc = Math.min(b.acc + dt, 0.1);
        while (b.acc >= PHYS_DT) { steer(b, windFrom, racing ? race : null, others); step(b.state, b.ctl, PHYS_DT, null); b.acc -= PHYS_DT; }
        // лодка, ушедшая далеко, возвращается на дистанцию
        if (Math.abs(b.state.x) > 160 || b.state.z > 120 || b.state.z < -220) put(b, -20 + 20 * b.i, 30, windFrom - 45, 'up', windFrom);
      }
      b.touchNow = false;
      // корпуса не проходят друг сквозь друга: соперника отодвигает; касание с лодкой ученика сообщается наружу
      if (!paused) for (const o of others) {
        if (o === b.state || o.capsized > 0 || b.state.capsized > 0) continue;
        if (Math.abs(o.x - b.state.x) > 6 || Math.abs(o.z - b.state.z) > 6) continue;
        const g = hullGap(b.state, o);
        if (g.d < 1.25) {
          const push = (1.25 - g.d) * (o === player ? 1 : 0.5);
          b.state.x += g.nx * push; b.state.z += g.nz * push;
          if (!b.touching) b.state.vf *= 0.75;                         // удар гасит ход один раз, а не всё время, пока корпуса рядом
          b.touchNow = true;
          if (o === player && t - contactAt > 5) { contactAt = t; api.contact = b.num; }
        }
      }
      const d = Math.hypot(b.state.x - player.x, b.state.z - player.z);
      if (d < nearD && !b.state.capsized) { nearD = d; near.x = b.state.x; near.z = b.state.z; near.fx = b.state.out.fx; near.fz = b.state.out.fz; near.speed = b.state.vf; api.wake = near; }
      // далёкие лодки перестраивают парус, снасти и матроса не каждый кадр
      b.touching = b.touchNow;
      const every = api.economy ? (d < 30 ? 2 : 5) : (d < 30 ? 1 : d < 80 ? 2 : 4), full = (frame + b.i) % every === 0;
      b.gfx.update(b.state, b.state.out, b.ctl, paused ? 0 : dt + (full ? b.lagSum || 0 : 0), t, env, !full);
      b.lagSum = full ? 0 : (b.lagSum || 0) + dt;
    }
  }
  function setEnabled(v) { enabled = v; for (const b of boats) b.gfx.root.setEnabled(v); }
  // первый кадр: у лодок должен быть посчитан state.out
  for (const b of boats) step(b.state, b.ctl, PHYS_DT, null);
  const api = { boats, update, setEnabled, wake: null, contact: null, economy: false, get enabled() { return enabled; } };
  return api;
}
