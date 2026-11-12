// Трасса: наветренный знак и линия старта и финиша между знаком и судейским катером. Гонка со стартовой процедурой.
// Сами знаки рисует js/gfx/view.js; кольца и финишная линия рисуются прямо на воде в шейдере океана.
import { makeMark } from './gfx/view.js';
import { makeCommittee } from './gfx/committee.js';
import { settleRig } from './physics.js';

export const COURSE = {
  windward: { x: 0, z: -110, name: 'наветренный знак' },
  gate: [{ x: -16, z: 0 }, { x: 16, z: 0 }],    // стартовая и финишная линия: слева знак, справа судейский катер
  finish: { x: 0, z: 0, name: 'финишная линия' },
  start: { x: 24, z: 34, heading: 285 },        // предстартовая зона под линией
  windFrom: 0, windSpeed: 10,
};
// Стартовая процедура по правилу 26: предупреждение (флаг класса), подготовительный (флаг «П»), минута (флаг «П» долой),
// старт (флаг класса долой). На регате это 5, 4, 1 и 0 минут; в учебной процедуре те же сигналы уложены в минуту.
const STAGES = ['warning', 'prep', 'oneMin', 'go'];

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

export function createCourse(world, env) {
  const ORANGE = [1.0, 0.1, 0.0];
  const mW = makeMark(world, ORANGE); mW.node.position.set(COURSE.windward.x, 0, COURSE.windward.z);
  const pin = makeMark(world, ORANGE); pin.node.position.set(COURSE.gate[0].x, 0, COURSE.gate[0].z);
  // катер стоит на якоре носом к ветру; линия идёт от знака к его мачте с оранжевым флагом
  const rc = makeCommittee(world); rc.node.position.set(COURSE.gate[1].x + 1.5, 0, COURSE.gate[1].z + 0.35);
  const marks3d = [mW, pin, rc];
  const hl = { which: null };
  const obstacle = { x: 0, z: 0, heading: 0, capsized: 0, big: true };      // катер как препятствие для соперников
  const group = { _v: false, get visible() { return this._v; }, set visible(v) { this._v = v; for (const m of marks3d) m.setEnabled(v); } };
  group.visible = false;

  const race = {
    active: false, phase: 'idle', // idle | prestart | leg1 | leg2 | finished
    t: 0, best: null, result: null, seq: 60, toStart: 0, stage: -1,
    flags: { cls: false, P: false, X: false }, ocs: false, started: false, startDelay: 0,
    target: null, dist: 0, bearing: 0, lineDist: 0, lineTime: Infinity,
    above: null,                  // с какой стороны знака лодка ушла выше него (для честного огибания)
    prevZ: 0, prevBow: 0,
  };

  function setHighlight(which) { hl.which = which; mW.beam.setEnabled(which === 'W'); pin.beam.setEnabled(false); }
  // разметка на воде для шейдера океана: кольцо у знака, к которому идём, и линия старта и финиша
  const rings = [{ x: COURSE.windward.x, z: COURSE.windward.z, r: 5, a: 0, color: [1.6, 0.35, 0.0] }];
  const line = { x0: COURSE.gate[0].x + 0.6, z0: COURSE.gate[0].z, x1: COURSE.gate[1].x - 0.3, z1: COURSE.gate[1].z, a: 0 };
  function overlay() {
    rings[0].a = group.visible && hl.which === 'W' ? 0.55 : 0;
    line.a = group.visible && (hl.which === 'F' || hl.which === 'S' || (race.active && !race.started)) ? 0.6 : 0;
    return { rings, line };
  }

  // full — полная процедура 5-4-1-0; иначе учебная, одна минута
  function start(state, ctl, full = false) {
    race.active = true; race.phase = 'prestart'; race.seq = full ? 300 : 60; race.toStart = race.seq; race.stage = -1; race.t = 0; race.result = null;
    race.above = null; race.ocs = false; race.started = false; race.startDelay = 0; race.flags.cls = race.flags.P = race.flags.X = false;
    group.visible = true;
    // ветер каждый раз чуть другой: один край линии оказывается выгоднее
    ctl.windFrom = (Math.round((Math.random() * 2 - 1) * 8) + 360) % 360; ctl.windSpeed = COURSE.windSpeed; ctl.sheet = 35;
    state.x = COURSE.start.x; state.z = COURSE.start.z; state.heading = COURSE.start.heading;
    state.vf = 1.5; state.vs = 0; state.yawRate = 0; state.heel = 0;
    race.prevZ = state.z; race.prevBow = state.z;
    ctl.autoSheet = false; ctl.lockHeading = false; ctl.paused = false; ctl.rudder = 0;
    settleRig(state, ctl);
    rc.node.rotation.y = Math.PI / 2 - ctl.windFrom * Math.PI / 180;
    setHighlight('S');
  }
  function stop() { race.active = false; race.phase = 'idle'; group.visible = false; race.flags.cls = race.flags.P = race.flags.X = false; }
  function showCourse(v) { group.visible = v; if (v && !race.active) setHighlight(null); }

  function update(state, ctl, dt, t) {
    const fl = 0.25 * Math.sin(t * 4);
    if (group.visible) {
      for (const m of marks3d) {
        if (m.flagG) m.flagG.rotation.y = fl;
        // знаки и катер качаются на волне
        const bx = m.node.position.x, bz = m.node.position.z, h0 = env.heightAt(bx, bz, m.waveL || 3), k = m.waveL ? 0.5 : 0.9;
        m.bob.position.y = h0 * 0.85;
        m.bob.rotation.z = (env.heightAt(bx + 0.6, bz, m.waveL || 3) - h0) * k; m.bob.rotation.x = -(env.heightAt(bx, bz + 0.6, m.waveL || 3) - h0) * k;
      }
      rc.setFlags(race.flags, t, ctl.windFrom);
      // навал на судейский катер: его корпус не пускает лодку, удар гасит ход
      const a = rc.node.rotation.y, ax = Math.cos(a), az = -Math.sin(a), dx = state.x - rc.node.position.x, dz = state.z - rc.node.position.z;
      const u = Math.max(-3.7, Math.min(3.7, dx * ax + dz * az)), nx = dx - ax * u, nz = dz - az * u, d = Math.hypot(nx, nz), R = 2.05;
      obstacle.x = rc.node.position.x; obstacle.z = rc.node.position.z; obstacle.heading = 90 - a * 180 / Math.PI;
      if (d < R && !(state.capsized > 0)) { const k = (R - d) / (d || 1); state.x += nx * k; state.z += nz * k; if (!api.touching) { state.vf *= 0.4; api.hit = true; } api.touching = true; } else api.touching = false;
    }
    if (!race.active) return null;
    let event = null;
    const psi = state.heading * Math.PI / 180, fz = -Math.cos(psi), fx = Math.sin(psi);
    const bowZ = state.z + fz * 2.1, sternZ = state.z - fz * 2.1, bowX = state.x + fx * 2.1;
    const g0 = COURSE.gate[0], g1 = COURSE.gate[1], between = bowX > g0.x && bowX < g1.x;
    // до линии по перпендикуляру и через сколько секунд нос её пересечёт на этом ходу
    race.lineDist = bowZ; const vz = -(state.out.Vz || 0); race.lineTime = bowZ > 0 && vz > 0.15 ? bowZ / vz : Infinity;
    if (race.phase === 'finished') return null;
    if (race.phase === 'prestart') {
      if (!ctl.paused) race.toStart -= dt;
      const T = race.seq, tt = race.toStart, stage = tt > T * 0.8 ? 0 : tt > T * 0.2 ? 1 : tt > 0 ? 2 : 3;
      if (stage !== race.stage) {
        race.stage = stage; event = STAGES[stage];
        race.flags.cls = stage < 3; race.flags.P = stage === 1;
        if (stage === 3) {
          race.phase = 'leg1'; race.t = 0; setHighlight('W');
          // часть корпуса за линией в момент сигнала: одиночный отзыв, флаг «X»
          if ((bowZ < 0 || sternZ < 0) && between) { race.ocs = true; race.flags.X = true; event = 'ocs'; }
        }
      }
      race.prevZ = state.z; race.prevBow = bowZ;
      return event;
    }
    if (!ctl.paused) race.t += dt;
    const target = race.phase === 'leg1' ? COURSE.windward : COURSE.finish;
    const dx = target.x - state.x, dz = target.z - state.z;
    race.dist = Math.hypot(dx, dz);
    race.bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
    race.target = target;
    if (!race.started) {
      if (race.ocs) { if (bowZ > 0 && sternZ > 0) { race.ocs = false; race.flags.X = false; event = 'ocsClear'; } }
      else if (race.prevBow >= 0 && bowZ < 0) {
        if (between) { race.started = true; race.startDelay = race.t; event = 'started'; }
        else event = 'missedLine';
      }
      if (race.t > 240 && race.flags.X) race.flags.X = false;       // флаг «X» держат не дольше четырёх минут
    } else if (race.phase === 'leg1') {
      // Огибание: лодка должна пройти выше знака (севернее) с одной стороны и вернуться ниже с другой.
      const mz = COURSE.windward.z, sideX = Math.sign(state.x - COURSE.windward.x) || 1;
      if (race.prevZ >= mz && state.z < mz) race.above = sideX;                    // ушла выше знака
      else if (race.prevZ < mz && state.z >= mz) {                                 // вернулась ниже
        if (race.above !== null && sideX !== race.above) { race.phase = 'leg2'; setHighlight('F'); event = 'rounded'; }
        else { race.above = null; event = 'notRounded'; }
      }
    } else {
      // Финиш: нос пересекает линию сверху вниз (по ветру) между знаком и катером
      if (race.prevBow < 0 && bowZ >= 0) {
        if (between) {
          race.phase = 'finished'; race.result = race.t; setHighlight(null); event = 'finish';
          if (race.best === null || race.t < race.best) race.best = race.t;
        } else event = 'missedGate';
      }
    }
    race.prevZ = state.z; race.prevBow = bowZ;
    return event;
  }

  const api = { group, race, start, stop, update, showCourse, marks3d, overlay, obstacle, hit: false, touching: false,
    marks: { W: COURSE.windward, L: COURSE.finish, G1: COURSE.gate[0], G2: COURSE.gate[1] } };
  return api;
}
