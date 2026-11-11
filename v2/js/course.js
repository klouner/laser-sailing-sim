// Трасса: наветренный буй и финишные ворота из двух буёв. Гонка на время.
// Сами знаки рисует js/gfx/view.js; кольца и финишная линия рисуются прямо на воде в шейдере океана.
import { makeMark } from './gfx/view.js';
import { settleRig } from './physics.js';

export const COURSE = {
  windward: { x: 0, z: -110, name: 'наветренный буй' },
  gate: [{ x: -9, z: 0 }, { x: 9, z: 0 }],      // финишные ворота (линия восток–запад)
  finish: { x: 0, z: 0, name: 'финишные ворота' },
  start: { x: 0, z: 12, heading: 45 },          // под линией ворот
  windFrom: 0, windSpeed: 10,
};

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

export function createCourse(world, env) {
  const ORANGE = [1.0, 0.1, 0.0], BLUE = [0.0, 0.06, 1.0];
  const mW = makeMark(world, ORANGE); mW.node.position.set(COURSE.windward.x, 0, COURSE.windward.z);
  const gates = COURSE.gate.map((p) => { const m = makeMark(world, BLUE); m.node.position.set(p.x, 0, p.z); return m; });
  const marks3d = [mW, ...gates];
  const hl = { which: null };
  const group = { _v: false, get visible() { return this._v; }, set visible(v) { this._v = v; for (const m of marks3d) m.setEnabled(v); } };
  group.visible = false;

  const race = {
    active: false, phase: 'idle', // idle | countdown | leg1 | leg2 | finished
    t: 0, countdown: 0, best: null, result: null,
    target: null, dist: 0, bearing: 0,
    above: null,                  // с какой стороны буя лодка ушла выше него (для честного огибания)
    prevZ: 0,
  };

  function setHighlight(which) {
    hl.which = which;
    mW.beam.setEnabled(which === 'W'); for (const m of gates) m.beam.setEnabled(which === 'F');
  }
  // разметка на воде для шейдера океана: кольцо у знака, к которому идём, и финишная линия
  const rings = [{ x: COURSE.windward.x, z: COURSE.windward.z, r: 5, a: 0, color: [1.6, 0.35, 0.0] }];
  const line = { x0: COURSE.gate[0].x + 0.6, z0: COURSE.gate[0].z, x1: COURSE.gate[1].x - 0.6, z1: COURSE.gate[1].z, a: 0 };
  function overlay() { rings[0].a = group.visible && hl.which === 'W' ? 0.55 : 0; line.a = group.visible && hl.which === 'F' ? 0.6 : 0; return { rings, line }; }

  function start(state, ctl) {
    race.active = true; race.phase = 'countdown'; race.countdown = 3; race.countdownEnd = performance.now() + 3000; race.t = 0; race.result = null;
    race.above = null;
    group.visible = true;
    state.x = COURSE.start.x; state.z = COURSE.start.z; state.heading = COURSE.start.heading;
    state.vf = 1.5; state.vs = 0; state.yawRate = 0; state.heel = 0;
    race.prevZ = state.z;
    ctl.windFrom = COURSE.windFrom; ctl.windSpeed = COURSE.windSpeed; ctl.sheet = 20;
    ctl.autoSheet = false; ctl.lockHeading = false; ctl.paused = false; ctl.rudder = 0;
    settleRig(state, ctl);
    setHighlight('W');
  }
  function stop() { race.active = false; race.phase = 'idle'; group.visible = false; }
  function showCourse(v) { group.visible = v; if (v && !race.active) setHighlight(null); }

  function update(state, ctl, dt, t) {
    const fl = 0.25 * Math.sin(t * 4);
    if (group.visible) for (const m of marks3d) {
      m.flagG.rotation.y = fl;
      // буй качается на волне
      const bx = m.node.position.x, bz = m.node.position.z, h0 = env.heightAt(bx, bz, 3);
      m.bob.position.y = h0 * 0.85;
      m.bob.rotation.z = (env.heightAt(bx + 0.6, bz, 3) - h0) * 0.9; m.bob.rotation.x = -(env.heightAt(bx, bz + 0.6, 3) - h0) * 0.9;
    }
    if (!race.active) return null;
    let event = null;
    if (race.phase === 'countdown') {
      race.countdown = (race.countdownEnd - performance.now()) / 1000;
      race.prevZ = state.z;
      if (race.countdown <= 0) { race.phase = 'leg1'; event = 'go'; }
      return event;
    }
    if (race.phase === 'finished') return null;
    if (!ctl.paused) race.t += dt;
    const target = race.phase === 'leg1' ? COURSE.windward : COURSE.finish;
    const dx = target.x - state.x, dz = target.z - state.z;
    race.dist = Math.hypot(dx, dz);
    race.bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
    race.target = target;
    if (race.phase === 'leg1') {
      // Огибание: лодка должна пройти выше буя (севернее) с одной стороны и вернуться ниже с другой.
      const mz = COURSE.windward.z, sideX = Math.sign(state.x - COURSE.windward.x) || 1;
      if (race.prevZ >= mz && state.z < mz) race.above = sideX;                    // ушла выше буя
      else if (race.prevZ < mz && state.z >= mz) {                                 // вернулась ниже
        if (race.above !== null && sideX !== race.above) { race.phase = 'leg2'; setHighlight('F'); event = 'rounded'; }
        else { race.above = null; event = 'notRounded'; }
      }
    } else {
      // Финиш: пересечь линию ворот сверху вниз (по ветру) между синими буями
      if (race.prevZ < 0 && state.z >= 0) {
        if (state.x > COURSE.gate[0].x && state.x < COURSE.gate[1].x) {
          race.phase = 'finished'; race.result = race.t; setHighlight(null); event = 'finish';
          if (race.best === null || race.t < race.best) race.best = race.t;
        } else event = 'missedGate';
      }
    }
    race.prevZ = state.z;
    return event;
  }

  return { group, race, start, stop, update, showCourse, marks3d, overlay,
    marks: { W: COURSE.windward, L: COURSE.finish, G1: COURSE.gate[0], G2: COURSE.gate[1] } };
}
