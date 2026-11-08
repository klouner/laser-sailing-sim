// Трасса из двух буёв и гонка на время
import * as THREE from 'three';
import { KN, norm180 } from './physics.js';

export const COURSE = {
  windward: { x: 0, z: -110, name: 'наветренный буй' },
  leeward: { x: 0, z: 0, name: 'подветренный буй' },
  roundR: 8,        // радиус «огибания», м
  start: { x: -14, z: 8, heading: 45 },
  windFrom: 0, windSpeed: 10,
};

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function makeMark(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.3, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), body.material);
  top.position.y = 1.2; g.add(top);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), new THREE.MeshStandardMaterial({ color: '#dddddd' }));
  pole.position.y = 2.3; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  flag.position.set(0.45, 3.1, 0); g.add(flag);
  // световой столб и кольцо для «следующего» буя
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 7; g.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(COURSE.roundR - 0.3, COURSE.roundR, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.14; g.add(ring);
  beam.renderOrder = 3; ring.renderOrder = 3;
  g.userData = { body, beam, ring, flag };
  return g;
}

export function createCourse(scene) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const mW = makeMark('#ff5700'), mL = makeMark('#0047ff');
  mW.position.set(COURSE.windward.x, 0, COURSE.windward.z);
  mL.position.set(COURSE.leeward.x, 0, COURSE.leeward.z);
  group.add(mW); group.add(mL);

  const race = {
    active: false, phase: 'idle', // idle | countdown | leg1 | leg2 | finished
    t: 0, countdown: 0, best: null, result: null,
    target: null, dist: 0, bearing: 0,
  };

  function setHighlight(which) {
    for (const [m, on] of [[mW, which === 'W'], [mL, which === 'L']]) {
      m.userData.beam.visible = on; m.userData.ring.visible = on;
    }
  }

  function start(state, ctl) {
    race.active = true; race.phase = 'countdown'; race.countdown = 3; race.countdownEnd = performance.now() + 3000; race.t = 0; race.result = null;
    group.visible = true;
    state.x = COURSE.start.x; state.z = COURSE.start.z; state.heading = COURSE.start.heading;
    state.vf = 1.5; state.vs = 0; state.yawRate = 0; state.heel = 0;
    ctl.windFrom = COURSE.windFrom; ctl.windSpeed = COURSE.windSpeed; ctl.sheet = 20;
    ctl.autoSheet = false; ctl.lockHeading = false; ctl.paused = false; ctl.rudder = 0;
    setHighlight('W');
  }
  function stop() { race.active = false; race.phase = 'idle'; group.visible = false; }
  function showCourse(v) { group.visible = v; if (v && !race.active) setHighlight(null); }

  function update(state, ctl, dt, t) {
    // анимация флажков
    const fl = 0.25 * Math.sin(t * 4);
    mW.userData.flag.rotation.y = fl; mL.userData.flag.rotation.y = fl;
    if (!race.active) return null;
    let event = null;
    if (race.phase === 'countdown') {
      race.countdown = (race.countdownEnd - performance.now()) / 1000;
      if (race.countdown <= 0) { race.phase = 'leg1'; event = 'go'; }
      return event;
    }
    if (race.phase === 'finished') return null;
    if (!ctl.paused) race.t += dt;
    const target = race.phase === 'leg1' ? COURSE.windward : COURSE.leeward;
    const dx = target.x - state.x, dz = target.z - state.z;
    race.dist = Math.hypot(dx, dz);
    race.bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
    race.target = target;
    if (race.dist < COURSE.roundR) {
      if (race.phase === 'leg1') { race.phase = 'leg2'; setHighlight('L'); event = 'rounded'; }
      else { race.phase = 'finished'; race.result = race.t; setHighlight(null); event = 'finish'; if (race.best === null || race.t < race.best) race.best = race.t; }
    }
    return event;
  }

  return { group, race, start, stop, update, showCourse, marks: { W: COURSE.windward, L: COURSE.leeward } };
}
