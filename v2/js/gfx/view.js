// То, что стоит между сценой и интерфейсом: камера, стрелки векторов с подписями, буквы компаса, знаки трассы, брызги.
import * as B from 'babylon';
import { V3, clamp, DEG } from '../vec.js';

// ---------- камера ----------
// Одна камера на все виды: вокруг лодки (за лодкой, сверху, сбоку, свободно) и из глаз матроса.
export function createCameraRig(world, canvas, boat) {
  const cam = world.camera;
  const orb = { az: 2.6, el: 0.42, dist: 10.5, azT: 2.6, elT: 0.42, distT: 10.5 };   // положение камеры вокруг цели: текущее и желаемое
  const rig = { mode: 'chase', look: { yaw: 0, pitch: -0.1 }, targetY: 2.0, screenShift: 0, lastHeading: null, enabled: true };
  const eyeLocal = new B.Vector3(), eyeTo = new B.Vector3(), eye = new B.Vector3(), tgt = new B.Vector3(); let eyeInit = false;

  function setOffset(x, y, z, snap = true) {
    orb.distT = Math.hypot(x, y, z); orb.elT = Math.asin(y / orb.distT); orb.azT = Math.atan2(z, x);
    if (snap) { orb.dist = orb.distT; orb.el = orb.elT; orb.az = orb.azT; }
  }
  // f — вектор носа, s — вектор правого борта, side — с какого борта ветер
  rig.setMode = (mode, heading, side) => {
    const was = rig.mode; rig.mode = mode;
    const p = heading * DEG, fx = Math.sin(p), fz = -Math.cos(p), sx = -fz, sz = fx;
    const cockpit = mode === 'cockpit';
    boat.setHead(!cockpit); eyeInit = false; cam.minZ = cockpit ? 0.04 : 0.1;
    if (cockpit) { rig.look.yaw = 0; rig.look.pitch = -0.1; return; }
    if (mode === 'free' && was !== 'cockpit') { rig.lastHeading = heading; return; }
    const m = mode === 'free' ? 'chase' : mode;
    if (m === 'chase') setOffset(fx * -12.5 + sx * -4.6 * side, 3.6, fz * -12.5 + sz * -4.6 * side);
    else if (m === 'top') setOffset(0.02, 21, 0.03);
    else if (m === 'side') setOffset(sx * -14.5 * side + fx * -1, 1.4, sz * -14.5 * side + fz * -1);
    rig.lastHeading = heading;
  };
  rig.update = (dt, st) => {
    if (rig.mode === 'cockpit') {
      // Положение головы сглаживается в осях самой лодки: камера жёстко едет вместе с корпусом и не дрожит
      boat.eyeLocal(eyeTo); eyeTo.y += 0.05;
      if (!eyeInit) { eyeLocal.copyFrom(eyeTo); eyeInit = true; } else B.Vector3.LerpToRef(eyeLocal, eyeTo, 1 - Math.exp(-dt * 10), eyeLocal);
      boat.toWorld(eyeLocal, eye);
      const a = (90 - st.heading) * DEG + rig.look.yaw, cp = Math.cos(rig.look.pitch);
      cam.position.copyFrom(eye);
      tgt.set(eye.x + Math.cos(a) * cp, eye.y + Math.sin(rig.look.pitch), eye.z - Math.sin(a) * cp);
      cam.upVector.set(0, 1, 0); cam.setTarget(tgt);
      return;
    }
    if (rig.lastHeading === null) rig.lastHeading = st.heading;
    if (rig.mode === 'chase' || rig.mode === 'side') {
      // камера поворачивается вместе с лодкой
      const dh = (((st.heading - rig.lastHeading) % 360 + 540) % 360 - 180) * DEG;
      orb.az += dh; orb.azT += dh;
    }
    rig.lastHeading = st.heading;
    const k = 1 - Math.exp(-dt * 12);
    orb.az += (orb.azT - orb.az) * k; orb.el += (orb.elT - orb.el) * k; orb.dist += (orb.distT - orb.dist) * k;
    // свободное место на экране бывает выше центра (на телефоне снизу управление): цель сдвигается, чтобы лодка была в нём
    const shift = rig.screenShift * 2 * Math.tan(cam.fov / 2) * orb.dist;
    tgt.set(st.x, rig.targetY - shift, st.z);
    const ce = Math.cos(orb.el);
    cam.position.set(st.x + orb.dist * ce * Math.cos(orb.az), rig.targetY - shift + orb.dist * Math.sin(orb.el), st.z + orb.dist * ce * Math.sin(orb.az));
    cam.upVector.set(0, 1, 0); cam.setTarget(tgt);
  };
  // положение камеры относительно лодки напрямую (для проверок)
  rig.place = (dx, dy, dz, ty = rig.targetY) => { rig.mode = 'free'; rig.targetY = ty; setOffset(dx, dy - ty, dz); };

  // управление: один палец или мышь вращают, колесо и щипок приближают; из кокпита перетаскивание поворачивает взгляд
  const ptrs = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { if (!rig.enabled) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { canvas.setPointerCapture(e.pointerId); } catch (er) {} pinch = 0; });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      if (rig.mode === 'cockpit') { rig.look.yaw = clamp(rig.look.yaw + dx * 0.006, -2.7, 2.7); rig.look.pitch = clamp(rig.look.pitch + dy * 0.005, -1.0, 1.0); }
      else { orb.azT += dx * 0.0065; orb.elT = clamp(orb.elT + dy * 0.005, 0.035, Math.PI / 2 - 0.03); if (rig.mode === 'top') rig.mode = 'free'; rig.onUser && rig.onUser(); }
    } else if (ptrs.size === 2 && rig.mode !== 'cockpit') {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) orb.distT = clamp(orb.distT * pinch / d, 3, 70);
      pinch = d;
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (rig.mode === 'cockpit') return; e.preventDefault(); orb.distT = clamp(orb.distT * Math.exp(e.deltaY * 0.0012), 3, 70); }, { passive: false });
  rig.orb = orb;
  return rig;
}

// ---------- подписи поверх сцены ----------
// Обычные элементы страницы, привязанные к точкам в мире: чёткие при любом разрешении и в стиле интерфейса.
export function createLabels(world, layer) {
  const items = [], vp = new B.Viewport(0, 0, 1, 1), p = new B.Vector3(), out = new B.Vector3(), ident = B.Matrix.Identity();
  function add(cls, text) {
    const el = document.createElement('div'); el.className = 'wl ' + cls; el.textContent = text; el.style.display = 'none'; layer.appendChild(el);
    const it = { el, x: 0, y: 0, z: 0, on: false, text, shown: false };
    it.set = (x, y, z) => { it.x = x; it.y = y; it.z = z; };
    it.setText = (t) => { if (t !== it.text) { it.text = t; el.textContent = t; } };
    items.push(it); return it;
  }
  function update() {
    const w = layer.clientWidth, h = layer.clientHeight, tm = world.scene.getTransformMatrix();
    for (const it of items) {
      let vis = it.on;
      if (vis) {
        B.Vector3.ProjectToRef(p.set(it.x, it.y, it.z), ident, tm, vp, out);
        vis = out.z > 0 && out.z < 1 && out.x > -0.1 && out.x < 1.1 && out.y > -0.1 && out.y < 1.1;
        if (vis) it.el.style.transform = `translate(${(out.x * w).toFixed(1)}px,${(out.y * h).toFixed(1)}px) translate(-50%,-50%)`;
      }
      if (vis !== it.shown) { it.shown = vis; it.el.style.display = vis ? '' : 'none'; }
    }
  }
  return { add, update };
}

// ---------- стрелка вектора ----------
const _dir = new B.Vector3(), _up = new B.Vector3(0, 1, 0);
export class VectorArrow {
  constructor(world, labels, rgb, cls) {
    const scene = world.scene;
    const mat = new B.StandardMaterial('arrow', scene); mat.disableLighting = true; mat.emissiveColor = new B.Color3(rgb[0], rgb[1], rgb[2]); mat.alpha = 0.95;
    this.node = new B.TransformNode('arrow', scene); this.node.rotationQuaternion = new B.Quaternion();
    this.shaft = B.CreateCylinder('sh', { diameter: 2, height: 1, tessellation: 14 }, scene);
    this.head = B.CreateCylinder('hd', { diameterBottom: 2, diameterTop: 0, height: 1, tessellation: 20 }, scene);
    for (const m of [this.shaft, this.head]) { m.material = mat; m.parent = this.node; m.isPickable = false; }
    this.label = labels.add('wl-vec ' + cls, '');
    this.labelAt = 0.5; this.labelLift = 0.3; this.visible = true; this.showLabel = true; this._since = 1;
  }
  // from → to в мировых координатах
  set(from, to, text, dt = 0, thickness = 1) {
    _dir.set(to.x - from.x, to.y - from.y, to.z - from.z); const len = _dir.length();
    const on = len >= 0.25 && this.visible;
    this.node.setEnabled(on); this.label.on = on && this.showLabel;
    if (!on) return;
    _dir.scaleInPlace(1 / len);
    const r = 0.018 * thickness, headLen = Math.min(0.42, len * 0.3), headR = 0.065 * thickness, shaftLen = len - headLen;
    this.node.position.set(from.x, from.y, from.z);
    B.Quaternion.FromUnitVectorsToRef(_up, _dir, this.node.rotationQuaternion);
    this.shaft.scaling.set(r, shaftLen, r); this.shaft.position.y = shaftLen / 2;
    this.head.scaling.set(headR, headLen, headR); this.head.position.y = shaftLen + headLen / 2;
    const a = this.labelAt;
    this.label.set(from.x + (to.x - from.x) * a, from.y + (to.y - from.y) * a + this.labelLift, from.z + (to.z - from.z) * a);
    this._since += dt;
    if (text && this._since > 0.25) { this._since = 0; this.label.setText(text); }
  }
  setVisible(v, labels = true) { this.visible = v; this.showLabel = labels; if (!v) { this.node.setEnabled(false); this.label.on = false; } }
}

// ---------- знаки трассы ----------
export function makeMark(world, rgb) {
  const scene = world.scene, node = new B.TransformNode('mark', scene), bob = new B.TransformNode('bob', scene); bob.parent = node;
  const mat = new B.PBRMaterial('mark', scene); mat.albedoColor = new B.Color3(rgb[0], rgb[1], rgb[2]); mat.roughness = 0.5; mat.metallic = 0;
  const white = new B.PBRMaterial('markW', scene); white.albedoColor = new B.Color3(0.85, 0.85, 0.85); white.roughness = 0.6; white.metallic = 0; white.backFaceCulling = false;
  const add = (m, mt, y, parent = bob) => { m.material = mt; m.parent = parent; m.position.y = y; m.isPickable = false; world.addBoatMesh(m, { cast: false, receive: false, reflect: true }); return m; };
  add(B.CreateCylinder('b', { diameterBottom: 1.1, diameterTop: 1.0, height: 1.3, tessellation: 24 }, scene), mat, 0.55);
  add(B.CreateSphere('t', { diameter: 1.0, segments: 16, slice: 0.5 }, scene), mat, 1.2);
  add(B.CreateCylinder('p', { diameter: 0.06, height: 2.2, tessellation: 8 }, scene), white, 2.3);
  const flagG = new B.TransformNode('flag', scene); flagG.parent = bob; flagG.position.y = 3.1;
  const flag = add(B.CreatePlane('f', { width: 0.9, height: 0.6 }, scene), white, 0, flagG); flag.position.x = 0.45;
  // световой столб над знаком, к которому надо идти
  const beamMat = new B.StandardMaterial('beam', scene); beamMat.disableLighting = true; beamMat.emissiveColor = new B.Color3(rgb[0], rgb[1], rgb[2]); beamMat.alpha = 0.16; beamMat.backFaceCulling = false; beamMat.disableDepthWrite = true;
  const beam = B.CreateCylinder('beam', { diameterBottom: 2.4, diameterTop: 1.2, height: 14, tessellation: 24, cap: B.Mesh.NO_CAP }, scene);
  beam.material = beamMat; beam.parent = bob; beam.position.y = 7; beam.isPickable = false;
  return { node, bob, flagG, beam, setEnabled: (v) => node.setEnabled(v) };
}

// ---------- брызги из-под носа ----------
export function createSpray(world, env) {
  const scene = world.scene, c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const tex = new B.DynamicTexture('sprayTex', c, scene, false); tex.update(true); tex.hasAlpha = true;
  const ps = new B.ParticleSystem('spray', 500, scene);
  ps.particleTexture = tex; ps.emitter = new B.Vector3(0, 0, 0);
  ps.minEmitBox = new B.Vector3(-0.15, 0, -0.15); ps.maxEmitBox = new B.Vector3(0.15, 0.1, 0.15);
  ps.color1 = new B.Color4(1, 1, 1, 0.75); ps.color2 = new B.Color4(0.9, 0.95, 1, 0.55); ps.colorDead = new B.Color4(1, 1, 1, 0);
  ps.minSize = 0.03; ps.maxSize = 0.12; ps.minLifeTime = 0.45; ps.maxLifeTime = 1.0;
  ps.gravity = new B.Vector3(0, -9.81, 0); ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.minEmitPower = 1; ps.maxEmitPower = 1; ps.updateSpeed = 1 / 60; ps.emitRate = 0;
  ps.start();
  // e: { x, z, fx, fz, sx, sz, vx, vz, heave, sf, speed }
  function update(dt, e, on) {
    if (!on || dt <= 0) { ps.emitRate = 0; ps.updateSpeed = dt > 0 ? dt : 0; return; }
    ps.updateSpeed = dt;
    const bx = e.x + e.fx * 2.0, bz = e.z + e.fz * 2.0, by = e.heave + e.sf * 2.0;
    const slam = Math.max(0, env.heightAt(bx, bz) - by - 0.02);                  // волна выше носа: удар
    ps.emitRate = Math.min(420, Math.max(0, e.speed - 2.3) * 55 + slam * e.speed * 1300);
    const pw = Math.min(1.6, 0.35 + e.speed * 0.14 + slam * 6);
    ps.emitter.set(bx - e.fx * 0.2, by + 0.08, bz - e.fz * 0.2);
    const vx = e.vx * 0.55, vz = e.vz * 0.55, o = 1.6 * pw;
    ps.direction1.set(vx - e.sx * o - e.fx * 0.3, 0.9 * pw, vz - e.sz * o - e.fz * 0.3);
    ps.direction2.set(vx + e.sx * o + e.fx * 0.5, 3.0 * pw, vz + e.sz * o + e.fz * 0.5);
  }
  return { update, ps };
}

export { V3 };
