// Трасса: наветренный буй и финишные ворота из двух буёв. Гонка на время.
import * as THREE from 'three';
import { floatOnWaves } from './env.js';
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

function makeMark(color, ringR, env) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.3, 24), mat);
  body.position.y = 0.55; body.castShadow = true;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  top.position.y = 1.2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), new THREE.MeshStandardMaterial({ color: '#dddddd' }));
  pole.position.y = 2.3;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  flag.position.set(0.45, 3.1, 0);
  // световой столб и кольцо для «следующего» знака
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 7;
  const ringGeo = new THREE.RingGeometry(ringR - 0.25, ringR, 96); ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, floatOnWaves(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }), env, 0.07));
  ring.frustumCulled = false;
  beam.renderOrder = 3; ring.renderOrder = 3;
  const bob = new THREE.Group(); bob.add(body, top, pole, flag, beam);   // качается на волне; кольцо лежит на воде отдельно
  g.add(bob); g.add(ring);
  g.userData = { body, beam, ring, flag, bob };
  return g;
}

export function createCourse(scene, env) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const mW = makeMark('#ff5700', 5, env);
  mW.position.set(COURSE.windward.x, 0, COURSE.windward.z); group.add(mW);
  const gates = COURSE.gate.map((p) => { const m = makeMark('#0047ff', 1.6, env); m.position.set(p.x, 0, p.z); group.add(m); return m; });
  // финишная линия между буями ворот
  const lineLen = COURSE.gate[1].x - COURSE.gate[0].x - 1.2;
  const lineGeo = new THREE.PlaneGeometry(lineLen, 0.35, 48, 1); lineGeo.rotateX(-Math.PI / 2);
  const finishLine = new THREE.Mesh(lineGeo, floatOnWaves(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), env, 0.07));
  finishLine.frustumCulled = false; finishLine.renderOrder = 3; group.add(finishLine);
  const marks3d = [mW, ...gates];

  const race = {
    active: false, phase: 'idle', // idle | countdown | leg1 | leg2 | finished
    t: 0, countdown: 0, best: null, result: null,
    target: null, dist: 0, bearing: 0,
    above: null,                  // с какой стороны буя лодка ушла выше него (для честного огибания)
    prevZ: 0,
  };

  function setHighlight(which) {
    mW.userData.beam.visible = which === 'W'; mW.userData.ring.visible = which === 'W';
    for (const m of gates) { m.userData.beam.visible = which === 'F'; m.userData.ring.visible = false; }
    finishLine.visible = which === 'F';
  }

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
      m.userData.flag.rotation.y = fl;
      // буй качается на волне
      const bx = m.position.x, bz = m.position.z, h0 = env.heightAt(bx, bz, 3.5);
      m.userData.bob.position.y = h0 * 0.85;
      m.userData.bob.rotation.z = (env.heightAt(bx + 0.6, bz, 3.5) - h0) * 0.9; m.userData.bob.rotation.x = -(env.heightAt(bx, bz + 0.6, 3.5) - h0) * 0.9;
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

  return { group, race, start, stop, update, showCourse, marks3d, finishLine,
    marks: { W: COURSE.windward, L: COURSE.finish, G1: COURSE.gate[0], G2: COURSE.gate[1] } };
}
