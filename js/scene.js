import * as THREE from 'three';
import { WAVE_GLSL, GUST_GLSL, floatOnWaves } from './env.js';

const DEG = Math.PI / 180;
// детерминированный генератор для процедурных текстур
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- небо ----------
export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#3f7fd6') }, mid: { value: new THREE.Color('#9fc7ef') }, bot: { value: new THREE.Color('#dfeaf3') }, sun: { value: new THREE.Vector3(0.4, 0.5, -0.7).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, mid, bot, sun; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.1, 1.0);
        vec3 c = h < 0.15 ? mix(bot, mid, smoothstep(-0.1,0.15,h)) : mix(mid, top, smoothstep(0.15,0.9,h));
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += vec3(1.0,0.95,0.8) * pow(s, 400.0) * 1.5 + vec3(1.0,0.9,0.7) * pow(s, 12.0) * 0.25;
        // лёгкий шум против полос на плавном градиенте
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
        gl_FragColor = vec4(c, 1.0); }`
  });
  return new THREE.Mesh(geo, mat);
}

// ---------- облака ----------
// Текстура собирается попиксельно: чисто белый цвет и плавная прозрачность.
// (Градиенты холста на части телефонов дают цветную рябь.)
function makeCloudTexture(seed) {
  const W = 256, H = 128, rnd = rng(seed);
  const acc = new Float32Array(W * H);
  for (let b = 0; b < 16; b++) {
    const cx = 44 + rnd() * 168, cy = 46 + rnd() * 40, r = 20 + rnd() * 30, gain = 0.55 + rnd() * 0.4;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
      const f = 1 - d * d; acc[y * W + x] += gain * f * f;
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = Math.round(255 * Math.min(0.92, acc[i]) ); }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return tex;
}
export function makeClouds() {
  const texs = [makeCloudTexture(11), makeCloudTexture(47), makeCloudTexture(93)];
  const rnd = rng(7);
  const group = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, opacity: 0.55 + rnd() * 0.35, depthWrite: false }));
    const a = rnd() * Math.PI * 2, r = 150 + rnd() * 450;
    m.position.set(Math.cos(a) * r, 60 + rnd() * 70, Math.sin(a) * r);
    const s = 90 + rnd() * 160; m.scale.set(s, s * 0.45, 1);
    group.add(m);
  }
  return group;
}

// ---------- вода ----------
function makeWaterNormalMap() {
  const N = 256, rnd = rng(3);
  const h = new Float32Array(N * N);
  const waves = [];
  for (let k = 0; k < 7; k++) waves.push({ a: rnd() * Math.PI * 2, f: Math.round(2 + rnd() * 9), p: rnd() * 6, amp: 1 / (k + 1.5) });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 0; const x = i / N, y = j / N;
    for (const w of waves) v += w.amp * Math.sin((Math.round(Math.cos(w.a) * w.f) * x + Math.round(Math.sin(w.a) * w.f) * y) * Math.PI * 2 + w.p);
    h[j * N + i] = v;
  }
  const data = new Uint8Array(N * N * 4);
  const str = 0.18;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = h[j * N + (i + N - 1) % N], r = h[j * N + (i + 1) % N], u = h[((j + N - 1) % N) * N + i], d = h[((j + 1) % N) * N + i];
    const nx = -(r - l) * str, ny = -(d - u) * str, nz = 1;
    const len = Math.hypot(nx, ny, nz); const k = (j * N + i) * 4;
    data[k] = (nx / len * 0.5 + 0.5) * 255; data[k + 1] = (ny / len * 0.5 + 0.5) * 255; data[k + 2] = (nz / len * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
// Сетка воды: густая у лодки (ячейка ~0.4 м), редкая вдали. Вдвое меньше треугольников, чем у равномерной.
function buildWaterGeometry(R, N, a) {
  const map = (u) => R * (a * u + (1 - a) * u * u * u);
  const n1 = N + 1, pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = map(-1 + 2 * i / N), z = map(-1 + 2 * j / N), k = j * n1 + i;
    pos[k * 3] = x; pos[k * 3 + 2] = z; nor[k * 3 + 1] = 1;
    uv[k * 2] = x / (2 * R) + 0.5; uv[k * 2 + 1] = -z / (2 * R) + 0.5;
  }
  const idx = new Uint16Array(N * N * 6); let o = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = j * n1 + i, q = p + 1, r = p + n1, s = r + 1;
    idx[o++] = p; idx[o++] = r; idx[o++] = q; idx[o++] = q; idx[o++] = r; idx[o++] = s;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.5);
  return g;
}

export function makeWater(env) {
  const R = 300, SIZE = 2 * R, REPEAT = 90;
  const geo = buildWaterGeometry(R, 128, 0.08);
  const nmap = makeWaterNormalMap();
  nmap.repeat.set(REPEAT, REPEAT);
  const mat = new THREE.MeshStandardMaterial({
    color: '#1b5e8f', roughness: 0.26, metalness: 0.05, normalMap: nmap, normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true, opacity: 0.94,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, env.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAVE_GLSL + GUST_GLSL + '\nvarying float vWave; varying float vGust; varying vec2 vWXZ;')
      .replace('#include <beginnormal_vertex>', `
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 whg = waveHG(wp0.xz);
        vec3 objectNormal = normalize(vec3(-whg.y, 1.0, -whg.z));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += whg.x; vWave = whg.x / uAmpTotal; vGust = gustV(wp0.xz); vWXZ = wp0.xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGustOn; uniform float uWhitecap; varying float vWave; varying float vGust; varying vec2 vWXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // порыв (>0) — пятно тёмной ряби с заметной границей; затишье (<0) — светлее и глаже
        float gP = smoothstep(0.12, 0.55, vGust) * uGustOn, gL = smoothstep(0.15, 0.6, -vGust) * uGustOn;
        float gE = gP - gL;
        // барашки: мелкие пятна пены на вершинах гребней
        // три слоя шума под разными углами и в разном масштабе, чтобы пятна пены не выстраивались в полосы
        vec2 q1 = vec2(vWXZ.x * 0.82 + vWXZ.y * 0.57, vWXZ.y * 0.82 - vWXZ.x * 0.57), q2 = vec2(vWXZ.x * 0.34 - vWXZ.y * 0.94, vWXZ.y * 0.34 + vWXZ.x * 0.94);
        float nA = texture2D(normalMap, q1 * 0.23).r, nB = texture2D(normalMap, q2 * 0.11 + 0.37).g, nC = texture2D(normalMap, vWXZ.yx * 0.47 + 0.11).g;
        float crest = smoothstep(0.25, 0.75, vWave);
        float nz = (nA - 0.5) * 0.48 + (nB - 0.5) * 0.40 + (nC - 0.5) * 0.12;      // шум около нуля, размах ~±0.08
        float foamE = min(1.0, uWhitecap * 3.0) * smoothstep(0.90, 1.18, crest + nz * 6.0 - (1.0 - uWhitecap) * 0.55);
        diffuseColor.rgb *= 1.0 - 0.36 * gP;
        diffuseColor.rgb *= 1.0 + 0.14 * gL;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98), foamE);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.30 * gP - 0.10 * gL + 0.6 * foamE, 0.04, 1.0);`)
      // вода в основном отражает небо, поэтому пятно порыва затемняем уже после расчёта света
      // солнечная дорожка: с настоящими уклонами волн блик стал широким — ограничиваем, чтобы не выгорал в белое
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular = min(reflectedLight.directSpecular * 0.35, vec3(0.55));`)
      .replace('#include <opaque_fragment>', `outgoingLight *= (1.0 - 0.30 * gP * (1.0 - foamE)) * (1.0 + 0.10 * gL);
        #include <opaque_fragment>`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.update = (t, bx, bz, windDir) => {
    mesh.position.set(bx, 0, bz);
    const wx = Math.sin(windDir), wz = -Math.cos(windDir);
    nmap.offset.set(bx / SIZE * REPEAT + wx * t * 0.045, -bz / SIZE * REPEAT - wz * t * 0.045);
  };
  return mesh;
}

// ---------- текстовые спрайты ----------
export function makeTextSprite(text, { color = '#ffffff', bg = 'rgba(12,12,12,0.85)', size = 44, scale = 1 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `600 ${size}px Inter, Arial, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = size + 28;
  g.font = `600 ${size}px Inter, Arial, sans-serif`;
  g.fillStyle = bg;
  const r = 16; g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  const k = 0.012 * scale;
  sp.scale.set(c.width * k, c.height * k, 1);
  sp.userData.baseScale = sp.scale.clone();
  sp.renderOrder = 10;
  return sp;
}
// масштаб всех текстовых спрайтов внутри объекта (для узких экранов)
export function setLabelScale(obj, k) {
  obj.traverse((o) => { if (o.isSprite && o.userData.baseScale) o.scale.copy(o.userData.baseScale).multiplyScalar(k); });
}

// ---------- компасное кольцо на воде ----------
// Все плоские элементы лежат на волнах: геометрия в плоскости XZ, вершины поднимаются по той же формуле, что и вода.
const flatMat = (color, opacity, env, lift) => floatOnWaves(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }), env, lift);
export function makeCompassRing(env) {
  const g = new THREE.Group();
  const R = 3.6, LIFT = 0.07;
  const ringGeo = new THREE.RingGeometry(R - 0.12, R, 160); ringGeo.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(ringGeo, flatMat('#ffffff', 0.6, env, LIFT)));
  // риски каждые 10°
  const tickPts = [];
  for (let b = 0; b < 360; b += 10) {
    const a = (90 - b) * DEG, len = b % 90 === 0 ? 0.45 : b % 30 === 0 ? 0.3 : 0.15;
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12), 0, -Math.sin(a) * (R - 0.12)));
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12 - len), 0, -Math.sin(a) * (R - 0.12 - len)));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), floatOnWaves(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }), env, LIFT)));
  const names = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]];
  const labels = [];
  for (const [n, b] of names) {
    const sp = makeTextSprite(n, { size: 56, bg: 'rgba(12,12,12,0.7)', scale: 0.45 });
    const a = (90 - b) * DEG;
    sp.position.set(Math.cos(a) * (R + 0.45), 0.3, -Math.sin(a) * (R + 0.45));
    g.add(sp); labels.push(sp);
  }
  // мёртвая зона — сектор ±42°
  const wedgeGeo = new THREE.RingGeometry(0.15, R - 0.15, 40, 10, -42 * DEG, 84 * DEG); wedgeGeo.rotateX(-Math.PI / 2);
  const wedge = new THREE.Mesh(wedgeGeo, flatMat('#ff3b30', 0.22, env, LIFT - 0.01));
  const wedgeG = new THREE.Group(); wedgeG.add(wedge);
  const wedgeLabel = makeTextSprite('МЁРТВАЯ ЗОНА', { color: '#ffffff', size: 36, scale: 0.45 });
  wedgeLabel.position.set(R * 0.7, 0.25, 0); wedgeG.add(wedgeLabel);
  g.add(wedgeG);
  // стрелка ветра на кольце (остриём к центру)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(-0.9, 0.5); shape.lineTo(-0.9, 0.18); shape.lineTo(-2.4, 0.18); shape.lineTo(-2.4, -0.18); shape.lineTo(-0.9, -0.18); shape.lineTo(-0.9, -0.5); shape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(shape); arrowGeo.rotateZ(Math.PI); arrowGeo.rotateX(-Math.PI / 2); arrowGeo.translate(R + 0.25, 0, 0);
  const arrowG = new THREE.Group(); arrowG.add(new THREE.Mesh(arrowGeo, flatMat('#0047ff', 0.9, env, LIFT + 0.08)));
  const windLabel = makeTextSprite('ВЕТЕР', { color: '#ffffff', bg: 'rgba(0,71,255,0.9)', size: 44, scale: 0.4 });
  windLabel.position.set(R + 3.1, 0.35, 0); arrowG.add(windLabel);
  g.add(arrowG);

  g.userData.update = (bx, bz, windFromDeg) => {
    g.position.x = bx; g.position.z = bz;
    // направление «откуда» — ветер в мировых координатах: bearing b → (sin b, -cos b); в плоскости XZ угол вокруг y: rotation.y = π/2 - b
    const rot = Math.PI / 2 - windFromDeg * DEG;
    wedgeG.rotation.y = rot;
    arrowG.rotation.y = rot;
    g.position.y = env.ampTotal * 0.5;      // подписи приподнимаются вместе с волнением
  };
  g.userData.setNoGo = (v) => { wedgeG.visible = v; };
  return g;
}

// ---------- объёмная стрелка вектора с подписью ----------
const _unitY = new THREE.Vector3(0, 1, 0), _arrowDir = new THREE.Vector3();
export class VectorArrow {
  constructor(scene, color, label) {
    this.color = color;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, emissive: color, emissiveIntensity: 0.12, transparent: true, opacity: 0.92 });
    this.group = new THREE.Group();
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), mat);   // масштабируется
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24), mat);
    this.group.add(this.shaft); this.group.add(this.head);
    scene.add(this.group);
    this.canvas = document.createElement("canvas"); this.canvas.width = 420; this.canvas.height = 72;
    this.ctx = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.label.scale.set(420 * 0.0062, 72 * 0.0062, 1); this.label.userData.baseScale = this.label.scale.clone(); this.label.renderOrder = 10;
    this.labelAt = 0.5; this.labelLift = 0.35; this.labelScale = 1;
    this._text = null; this._since = 1;
    scene.add(this.label);
    this.visible = true; this.showLabel = true;
    this.draw(label);
  }
  draw(text) {
    const g = this.ctx, c = this.canvas;
    g.clearRect(0, 0, c.width, c.height);
    g.font = "600 38px Inter, Arial, sans-serif";
    const w = Math.min(c.width, Math.ceil(g.measureText(text).width) + 34);
    g.fillStyle = this.color; g.globalAlpha = 0.9;
    g.beginPath(); g.roundRect((c.width - w) / 2, 4, w, 64, 14); g.fill();
    const rgb = this.color.match(/\d+/g).map(Number); const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    g.globalAlpha = 1; g.fillStyle = lum > 0.6 ? "#111111" : "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 38);
    this.tex.needsUpdate = true; this._text = text;
  }
  // from → to (мировые координаты)
  set(from, to, text, dt = 0, thickness = 1) {
    const dir = _arrowDir.copy(to).sub(from); const len = dir.length();
    if (len < 0.25 || !this.visible) { this.group.visible = false; this.label.visible = false; return; }
    this.group.visible = true; this.label.visible = this.showLabel;
    dir.normalize();
    const r = 0.018 * thickness, headLen = Math.min(0.42, len * 0.3), headR = 0.065 * thickness;
    this.group.position.copy(from);
    this.group.quaternion.setFromUnitVectors(_unitY, dir);
    const shaftLen = len - headLen;
    this.shaft.scale.set(r, shaftLen, r); this.shaft.position.y = shaftLen / 2;
    this.head.scale.set(headR, headLen, headR); this.head.position.y = shaftLen + headLen / 2;
    this.label.position.copy(from).lerp(to, this.labelAt); this.label.position.y += this.labelLift * this.labelScale;
    this._since += dt;
    if (text && text !== this._text && this._since > 0.25) { this._since = 0; this.draw(text); }
  }
  setLabelScale(k) { this.labelScale = k; this.label.scale.copy(this.label.userData.baseScale).multiplyScalar(k); }
  setVisible(v, labels = true) { this.visible = v; this.showLabel = labels; if (!v) { this.group.visible = false; this.label.visible = false; } }
}

// ---------- струи ветра ----------
export function makeWindStreaks(count = 220) {
  const pos = new Float32Array(count * 2 * 3);
  const col = new Float32Array(count * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  const pts = [];
  const BOX = 34;
  for (let i = 0; i < count; i++) pts.push({ x: (Math.random() - .5) * 2 * BOX, y: 0.4 + Math.random() * 7, z: (Math.random() - .5) * 2 * BOX, ph: Math.random() * 10 });
  for (let i = 0; i < count; i++) { col.set([1, 1, 1], i * 6); col.set([0.6, 0.78, 0.95], i * 6 + 3); }
  lines.userData.update = (dt, bx, bz, Wx, Wz, speedKn) => {
    const len = 0.9 + speedKn * 0.16;
    const spd = Math.hypot(Wx, Wz) || 0.0001; const ux = Wx / spd, uz = Wz / spd;
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      p.x += Wx * dt * 1.1; p.z += Wz * dt * 1.1;
      let rx = p.x - bx, rz = p.z - bz;
      if (rx > BOX) { p.x -= 2 * BOX; p.z = bz + (Math.random() - .5) * 2 * BOX; } else if (rx < -BOX) { p.x += 2 * BOX; p.z = bz + (Math.random() - .5) * 2 * BOX; }
      if (rz > BOX) { p.z -= 2 * BOX; p.x = bx + (Math.random() - .5) * 2 * BOX; } else if (rz < -BOX) { p.z += 2 * BOX; p.x = bx + (Math.random() - .5) * 2 * BOX; }
      const w = Math.sin(p.ph + p.x * 0.3) * 0.15;
      pos[i * 6] = p.x; pos[i * 6 + 1] = p.y + w; pos[i * 6 + 2] = p.z;
      pos[i * 6 + 3] = p.x - ux * len; pos[i * 6 + 4] = p.y + w; pos[i * 6 + 5] = p.z - uz * len;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return lines;
}

// ---------- след на воде: кильватерная струя и усы от носа ----------
function makeFoamTexture() {
  // полупрозрачная пена: вытянутые вдоль хода струйки, между ними вода
  const W = 256, H = 32, rnd = rng(21);
  const acc = new Float32Array(W * H);
  for (let i = 0; i < 150; i++) {
    const bx = rnd() * W, by = 3 + rnd() * (H - 6), rx = 5 + rnd() * 22, ry = 0.9 + rnd() * 2.6, g = 0.35 + rnd() * 0.6;
    for (let y = Math.max(0, Math.floor(by - ry)); y <= Math.min(H - 1, Math.ceil(by + ry)); y++) for (let q = Math.floor(bx - rx); q <= Math.ceil(bx + rx); q++) {
      const x = ((q % W) + W) % W, d = Math.hypot((q - bx) / rx, (y - by) / ry); if (d < 1) acc[y * W + x] += g * (1 - d * d);
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = Math.sin(Math.PI * (y + 0.5) / H);
    const k = (y * W + x) * 4; data[k] = 255; data[k + 1] = 255; data[k + 2] = 255; data[k + 3] = Math.round(255 * Math.min(1, 0.07 + acc[y * W + x] * 0.8) * edge * edge);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
// Лента из точек следа: новые точки добавляются по мере хода, старые расплываются и гаснут
class Ribbon {
  constructor(n, material, { life, w0, w1, spacing }) {
    this.n = n; this.life = life; this.w0 = w0; this.w1 = w1; this.spacing = spacing;
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n).fill(1e9); this.str = new Float32Array(n); this.u = new Float32Array(n);
    this.head = 0; this.count = 0; this.dist = 0;
    this.pos = new Float32Array(n * 2 * 3); this.uv = new Float32Array(n * 2 * 2); this.col = new Float32Array(n * 2 * 4).fill(1);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  idx(i) { return (this.head - 1 - i + this.n * 2) % this.n; }   // i = 0 — самая свежая точка
  // источник следа в точке (x, z); точки расходятся со скоростью (vx, vz)
  track(x, z, vx, vz, strength) {
    // самая свежая точка «живая» и идёт вместе с источником; когда источник уходит от последней
    // закреплённой точки дальше шага, живая закрепляется и начинает стареть, а за источником идёт новая
    const push = () => {
      const k = this.head; this.head = (this.head + 1) % this.n; this.count = Math.min(this.n, this.count + 1);
      this.px[k] = x; this.pz[k] = z; this.vx[k] = vx; this.vz[k] = vz; this.age[k] = 0; this.str[k] = strength; this.u[k] = this.dist * 0.2;
    };
    if (this.count === 0) { this.ax = x; this.az = z; push(); return; }
    const k0 = this.idx(0), d = Math.hypot(x - this.ax, z - this.az);
    this.px[k0] = x; this.pz[k0] = z; this.age[k0] = 0; this.str[k0] = strength; this.vx[k0] = vx; this.vz[k0] = vz; this.u[k0] = (this.dist + d) * 0.2;
    if (d > this.spacing) { this.dist += d; this.ax = x; this.az = z; push(); }
  }
  update(dt) {
    const { n, pos, uv, col } = this;
    const damp = Math.exp(-dt * 1.1);
    for (let i = 1; i < this.count; i++) { const k = this.idx(i); this.age[k] += dt; this.px[k] += this.vx[k] * dt; this.pz[k] += this.vz[k] * dt; this.vx[k] *= damp; this.vz[k] *= damp; }
    for (let i = 0; i < n; i++) {
      const live = i < this.count, k = this.idx(live ? i : Math.max(0, this.count - 1));
      const kp = this.idx(Math.max(0, Math.min(this.count - 1, i - 1))), kn = this.idx(Math.max(0, Math.min(this.count - 1, i + 1)));
      let tx = this.px[kp] - this.px[kn], tz = this.pz[kp] - this.pz[kn]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const f = Math.min(1, this.age[k] / this.life);
      const w = (this.w0 + (this.w1 - this.w0) * Math.sqrt(f)) * 0.5;
      const a = live && this.count > 1 ? this.str[k] * (1 - f) * (1 - f) * Math.min(1, i * 0.6 + 0.25) : 0;
      const o = i * 6, x = this.px[k], z = this.pz[k];
      pos[o] = x - tz * w; pos[o + 2] = z + tx * w; pos[o + 3] = x + tz * w; pos[o + 5] = z - tx * w;
      uv[i * 4] = this.u[k]; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = this.u[k]; uv[i * 4 + 3] = 1;
      col[i * 8 + 3] = a; col[i * 8 + 7] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
  clear() { this.count = 0; this.age.fill(1e9); }
}
export function makeWake(env) {
  const g = new THREE.Group();
  const foam = makeFoamTexture();
  const mat = () => floatOnWaves(new THREE.MeshBasicMaterial({ color: '#ffffff', map: foam, transparent: true, depthWrite: false, vertexColors: true, side: THREE.DoubleSide }), env, 0.06);
  const stern = new Ribbon(72, mat(), { life: 7, w0: 0.45, w1: 2.6, spacing: 0.35 });
  const bowL = new Ribbon(30, mat(), { life: 2.6, w0: 0.16, w1: 0.9, spacing: 0.3 });
  const bowR = new Ribbon(30, mat(), { life: 2.6, w0: 0.16, w1: 0.9, spacing: 0.3 });
  for (const r of [stern, bowL, bowR]) g.add(r.mesh);
  let lastX = null, lastZ = null;
  // (x, z) — лодка; (fx, fz) — нос, (sx, sz) — правый борт; speed — ход, м/с
  g.userData.update = (dt, x, z, fx, fz, sx, sz, speed) => {
    if (lastX !== null && Math.hypot(x - lastX, z - lastZ) > 5) { stern.clear(); bowL.clear(); bowR.clear(); }  // лодку переставили
    lastX = x; lastZ = z;
    if (dt > 0) {
      const sS = Math.min(1, Math.max(0, (speed - 0.3) / 2.0)) * 0.8;
      const sB = Math.min(1, Math.max(0, (speed - 0.9) / 2.0)) * 1.0;
      stern.track(x - fx * 2.0, z - fz * 2.0, 0, 0, sS);
      const out = 0.34 * speed;      // усы расходятся под углом Кельвина (~19°)
      bowL.track(x + fx * 1.55 - sx * 0.28, z + fz * 1.55 - sz * 0.28, -sx * out, -sz * out, sB);
      bowR.track(x + fx * 1.55 + sx * 0.28, z + fz * 1.55 + sz * 0.28, sx * out, sz * out, sB);
      stern.update(dt); bowL.update(dt); bowR.update(dt);
    }
  };
  return g;
}
