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
    if (m === 'chase') setOffset(fx * -9.6 + sx * -4.4 * side, 2.2, fz * -9.6 + sz * -4.4 * side);
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
    const k = 1 - Math.exp(-dt * (rig.introT > 0 ? 0.85 : 12)); if (rig.introT > 0) rig.introT -= dt;
    orb.az += (orb.azT - orb.az) * k; orb.el += (orb.elT - orb.el) * k; orb.dist += (orb.distT - orb.dist) * k;
    // свободное место на экране бывает выше центра (на телефоне снизу управление): цель сдвигается, чтобы лодка была в нём
    const shift = rig.screenShift * 2 * Math.tan(cam.fov / 2) * orb.dist;
    tgt.set(st.x, rig.targetY - shift, st.z);
    const ce = Math.cos(orb.el);
    cam.position.set(st.x + orb.dist * ce * Math.cos(orb.az), rig.targetY - shift + orb.dist * Math.sin(orb.el), st.z + orb.dist * ce * Math.sin(orb.az));
    cam.upVector.set(0, 1, 0); cam.setTarget(tgt);
  };
  // Заставка: камера начинает издалека, низко над водой, и за несколько секунд облетает лодку до обычного места
  rig.intro = () => { orb.az = orb.azT + 2.3; orb.el = 0.05; orb.dist = orb.distT * 2.3; rig.introT = 6; };
  // положение камеры относительно лодки напрямую (для проверок)
  rig.place = (dx, dy, dz, ty = rig.targetY) => { rig.introT = 0; rig.mode = 'free'; rig.targetY = ty; setOffset(dx, dy - ty, dz); };

  // управление: один палец или мышь вращают, колесо и щипок приближают; из кокпита перетаскивание поворачивает взгляд
  const ptrs = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { if (!rig.enabled) return; rig.introT = 0; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { canvas.setPointerCapture(e.pointerId); } catch (er) {} pinch = 0; });
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

// ---------- судейский катер с сигнальными флагами ----------
function flagTexture(scene, kind) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 128; const g = c.getContext('2d');
  if (kind === 'P') { g.fillStyle = '#0a3ea8'; g.fillRect(0, 0, 192, 128); g.fillStyle = '#fff'; g.fillRect(58, 38, 76, 52); }
  else if (kind === 'X') { g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 128); g.fillStyle = '#0a3ea8'; g.fillRect(76, 0, 40, 128); g.fillRect(0, 44, 192, 40); }
  else if (kind === 'line') { g.fillStyle = '#ff5a00'; g.fillRect(0, 0, 192, 128); }
  else {                                              // флаг класса: красный знак лазера на белом
    g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 128); g.strokeStyle = '#d21f1f'; g.lineWidth = 7; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(96 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); g.lineTo(96 + Math.cos(a) * (i % 2 ? 34 : 46), 64 + Math.sin(a) * (i % 2 ? 34 : 46)); g.stroke(); }
  }
  const t = new B.DynamicTexture('flag' + kind, c, scene, true); t.update(true); return t;
}
export function makeCommittee(world) {
  const scene = world.scene, node = new B.TransformNode('rc', scene), bob = new B.TransformNode('rcBob', scene); bob.parent = node;
  const pbr = (name, rgb, rough) => { const m = new B.PBRMaterial(name, scene); m.albedoColor = new B.Color3(rgb[0], rgb[1], rgb[2]); m.roughness = rough; m.metallic = 0; return m; };
  const navy = pbr('rcHull', [0.02, 0.05, 0.13], 0.35), white = pbr('rcWhite', [0.8, 0.81, 0.82], 0.5), glass = pbr('rcGlass', [0.02, 0.03, 0.04], 0.15), wood = pbr('rcDeck', [0.42, 0.3, 0.2], 0.8), red = pbr('rcRed', [0.5, 0.03, 0.02], 0.6);
  const reg = (m, mat, parent = bob) => { m.material = mat; m.parent = parent; m.isPickable = false; world.addBoatMesh(m, { cast: true, receive: true, reflect: true }); return m; };
  // корпус: обводы по шпангоутам, нос на +x
  { const L = 7.6, NXh = 26, NT = 14, pos = [], idx = [], row = NT + 1;
    for (let i = 0; i <= NXh; i++) {
      const u = i / NXh, x = -L / 2 + L * u, hw = 1.3 * Math.pow(Math.max(0, 1 - Math.pow(u, 2.6)), 0.75) * (0.86 + 0.14 * Math.min(1, u * 4)), sheer = 0.95 + 0.4 * u * u, keel = -0.45 + 0.5 * Math.pow(u, 5);
      for (let j = 0; j <= NT; j++) { const t = -1 + 2 * j / NT, a = Math.abs(t); pos.push(x, sheer - (sheer - keel) * Math.pow(1 - a, 1.5), hw * Math.sign(t) * Math.pow(a, 0.62)); }
    }
    for (let i = 0; i < NXh; i++) for (let j = 0; j < NT; j++) { const a = i * row + j, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c); }
    const base = pos.length / 3;                       // палуба и транец
    for (let i = 0; i <= NXh; i++) { const k = i * row * 3; pos.push(pos[k], pos[k + 1], pos[k + 2], pos[k + NT * 3], pos[k + NT * 3 + 1], pos[k + NT * 3 + 2]); }
    for (let i = 0; i < NXh; i++) { const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    const tb0 = pos.length / 3; for (let j = 0; j <= NT; j++) pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); pos.push(-L / 2, 0.6, 0);
    for (let j = 0; j < NT; j++) idx.push(tb0 + NT + 1, tb0 + j + 1, tb0 + j);
    const m = new B.Mesh('rcHull', scene), vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.normals = []; B.VertexData.ComputeNormals(pos, idx, vd.normals); vd.applyToMesh(m);
    navy.backFaceCulling = false; navy.twoSidedLighting = true; reg(m, navy); }
  const box = (w, h, d, mat, x, y, z = 0) => { const m = reg(B.CreateBox('b', { width: w, height: h, depth: d }, scene), mat); m.position.set(x, y, z); return m; };
  const cyl = (d, h, mat, x, y, z = 0) => { const m = reg(B.CreateCylinder('c', { diameter: d, height: h, tessellation: 10 }, scene), mat); m.position.set(x, y, z); return m; };
  box(7.0, 0.05, 2.1, wood, -0.3, 1.0);                             // настил
  box(2.6, 1.25, 1.9, white, -0.5, 1.62); box(2.66, 0.42, 1.96, glass, -0.5, 1.86); box(3.0, 0.08, 2.2, white, -0.5, 2.28);   // рубка, остекление, крыша
  box(0.5, 0.12, 2.5, red, -3.6, 0.82);                              // привальный брус кормы
  for (const z of [-1, 1]) for (const x of [-3.2, -1.9, 1.0, 2.2]) cyl(0.035, 0.75, white, x, 1.4, z * (x > 1.5 ? 0.85 : 1.15));
  // мачта с реем: на нём поднимают сигналы; оранжевый флаг на мачте задаёт конец линии
  const mastX = 1.0;
  cyl(0.07, 5.2, white, mastX, 3.6); const yard = cyl(0.045, 2.8, white, mastX, 5.3); yard.rotation.x = Math.PI / 2;
  const mkFlag = (kind, w, h) => {
    const g = new B.TransformNode('fl' + kind, scene); g.parent = bob;
    const mat = new B.PBRMaterial('fm' + kind, scene); mat.albedoTexture = flagTexture(scene, kind); mat.roughness = 0.9; mat.metallic = 0; mat.backFaceCulling = false; mat.twoSidedLighting = true;
    // полотнище из полос: волна идёт от древка к свободному краю
    const N = 10, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) { pos.push(-w * i / N, h / 2, 0, -w * i / N, -h / 2, 0); uv.push(i / N, 1, i / N, 0); }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const m = new B.Mesh('flag', scene), vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.normals = []; B.VertexData.ComputeNormals(pos, idx, vd.normals); vd.applyToMesh(m, true);
    m.material = mat; m.parent = g; m.isPickable = false; world.addBoatMesh(m, { cast: false, receive: false, reflect: true });
    return { g, m, pos: new Float32Array(pos), w, N, up: 0 };
  };
  const F = { line: mkFlag('line', 1.0, 0.7), cls: mkFlag('cls', 1.1, 0.75), P: mkFlag('P', 1.1, 0.75), X: mkFlag('X', 1.1, 0.75) };
  F.line.g.position.set(mastX, 6.0, 0); F.cls.g.position.set(mastX, 4.4, -1.25); F.P.g.position.set(mastX, 4.4, 1.25); F.X.g.position.set(mastX, 4.4, 0.45);
  F.line.up = 1;
  // флаги смотрят по ветру, поднимаются и спускаются по фалу, полощут
  function setFlags(fl, t, windFrom) {
    const yawW = Math.PI / 2 - (windFrom + 180) * Math.PI / 180 - node.rotation.y;      // куда дует, в осях катера
    for (const k of ['line', 'cls', 'P', 'X']) {
      const f = F[k], want = k === 'line' ? 1 : fl[k] ? 1 : 0;
      f.up += (want - f.up) * 0.08; f.g.setEnabled(f.up > 0.02);
      if (k !== 'line') f.g.position.y = 2.5 + 2.3 * f.up;
      f.g.rotation.y = yawW + Math.PI;
      for (let i = 0; i <= f.N; i++) { const u = i / f.N, z = 0.09 * u * Math.sin(t * 9 - u * 7 + k.length) + 0.05 * u * Math.sin(t * 5.3 + u * 4); f.pos[i * 6 + 2] = z; f.pos[i * 6 + 5] = z; }
      f.m.updateVerticesData(B.VertexBuffer.PositionKind, f.pos, false, false);
    }
  }
  return { node, bob, setFlags, waveL: 7, setEnabled: (v) => node.setEnabled(v) };
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
