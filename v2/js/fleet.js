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
    boats.push({ gfx, state, ctl, i, leg: 'up', tack: i % 2 ? 1 : -1, lastTack: -99, acc: 0, go: 10 + 3 * i, gateX: -8 + 8 * i });
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

  function steer(b, windFrom, race) {
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
    const e = norm180(target - s.heading);
    b.ctl.rudder = clamp(e * 1.3 - s.yawRate * 0.4, -26, 26);
  }

  // race — состояние гонки из course.js; px, pz — лодка ученика
  function update(dt, t, windFrom, windKn, race, paused) {
    if (!enabled) return;
    const racing = !!(race && race.active);
    if (racing && race.phase === 'prestart' && !wasRace) prestart(windFrom);
    if (!racing && wasRace) spread(windFrom);
    wasRace = racing;
    for (const b of boats) {
      b.ctl.windFrom = windFrom; b.ctl.windSpeed = windKn; b.ctl.paused = false;
      if (!paused) {
        b.acc = Math.min(b.acc + dt, 0.1);
        while (b.acc >= PHYS_DT) { steer(b, windFrom, racing ? race : null); step(b.state, b.ctl, PHYS_DT, null); b.acc -= PHYS_DT; }
        // лодка, ушедшая далеко, возвращается на дистанцию
        if (Math.abs(b.state.x) > 160 || b.state.z > 120 || b.state.z < -220) put(b, -20 + 20 * b.i, 30, windFrom - 45, 'up', windFrom);
      }
      b.gfx.update(b.state, b.state.out, b.ctl, paused ? 0 : dt, t, env);
    }
  }
  function setEnabled(v) { enabled = v; for (const b of boats) b.gfx.root.setEnabled(v); }
  // первый кадр: у лодок должен быть посчитан state.out
  for (const b of boats) step(b.state, b.ctl, PHYS_DT, null);
  return { boats, update, setEnabled, get enabled() { return enabled; } };
}
