import * as THREE from 'three';

const DEG = Math.PI / 180;

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
        gl_FragColor = vec4(c, 1.0); }`
  });
  return new THREE.Mesh(geo, mat);
}

// ---------- облака ----------
export function makeClouds() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 22 + Math.random() * 28;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  const group = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55 + Math.random() * 0.35, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 450;
    m.position.set(Math.cos(a) * r, 60 + Math.random() * 70, Math.sin(a) * r);
    const s = 90 + Math.random() * 160; m.scale.set(s, s * 0.45, 1);
    group.add(m);
  }
  return group;
}

// ---------- вода ----------
function makeWaterNormalMap() {
  const N = 256;
  const h = new Float32Array(N * N);
  const waves = [];
  for (let k = 0; k < 7; k++) waves.push({ a: Math.random() * Math.PI * 2, f: 2 + Math.random() * 9, p: Math.random() * 6, amp: 1 / (k + 1.5) });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 0; const x = i / N, y = j / N;
    for (const w of waves) v += w.amp * Math.sin((Math.cos(w.a) * x + Math.sin(w.a) * y) * w.f * Math.PI * 2 + w.p);
    h[j * N + i] = v;
  }
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d'); const img = g.createImageData(N, N);
  const str = 0.18;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = h[j * N + (i + N - 1) % N], r = h[j * N + (i + 1) % N], u = h[((j + N - 1) % N) * N + i], d = h[((j + 1) % N) * N + i];
    const nx = -(r - l) * str, ny = -(d - u) * str, nz = 1;
    const len = Math.hypot(nx, ny, nz); const k = (j * N + i) * 4;
    img.data[k] = (nx / len * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / len * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / len * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeWater() {
  const SIZE = 600, REPEAT = 90;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 180, 180);
  geo.rotateX(-Math.PI / 2);
  const nmap = makeWaterNormalMap();
  nmap.repeat.set(REPEAT, REPEAT);
  const mat = new THREE.MeshStandardMaterial({
    color: '#1b5e8f', roughness: 0.28, metalness: 0.05, normalMap: nmap, normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true, opacity: 0.94,
  });
  mat.userData.uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mat.userData.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;
        float wv = 0.0;
        wv += 0.06 * sin(dot(wp.xz, vec2(0.9, 0.35)) * 0.9 + uTime * 1.4);
        wv += 0.04 * sin(dot(wp.xz, vec2(-0.5, 0.8)) * 1.7 + uTime * 2.1);
        wv += 0.025 * sin(dot(wp.xz, vec2(0.3, -0.95)) * 3.1 + uTime * 2.9);
        transformed.y += wv;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.SIZE = SIZE; mesh.userData.REPEAT = REPEAT;
  mesh.userData.update = (t, bx, bz, windDir) => {
    mat.userData.uTime.value = t;
    mesh.position.set(bx, 0, bz);
    const wx = Math.sin(windDir), wz = -Math.cos(windDir);
    nmap.offset.set(bx / SIZE * REPEAT + wx * t * 0.045, -bz / SIZE * REPEAT - wz * t * 0.045);
  };
  return mesh;
}

// ---------- текстовые спрайты ----------
export function makeTextSprite(text, { color = '#ffffff', bg = 'rgba(10,16,28,0.72)', size = 44, scale = 1 } = {}) {
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
  sp.renderOrder = 10;
  return sp;
}

// ---------- компасное кольцо на воде ----------
export function makeCompassRing() {
  const g = new THREE.Group();
  g.position.y = 0.03;
  const R = 3.6;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R, 128), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; g.add(ring);
  // риски каждые 30°
  const tickPts = [];
  for (let b = 0; b < 360; b += 10) {
    const a = (90 - b) * DEG, len = b % 90 === 0 ? 0.45 : b % 30 === 0 ? 0.3 : 0.15;
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12), 0, -Math.sin(a) * (R - 0.12)));
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12 - len), 0, -Math.sin(a) * (R - 0.12 - len)));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 })));
  const names = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]];
  for (const [n, b] of names) {
    const sp = makeTextSprite(n, { size: 56, bg: 'rgba(10,16,28,0.5)', scale: 0.45 });
    const a = (90 - b) * DEG;
    sp.position.set(Math.cos(a) * (R + 0.45), 0.2, -Math.sin(a) * (R + 0.45));
    g.add(sp);
  }
  // мёртвая зона — сектор ±42°
  const wedge = new THREE.Mesh(new THREE.CircleGeometry(R - 0.15, 48, -42 * DEG, 84 * DEG), new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  wedge.rotation.x = -Math.PI / 2;
  const wedgeG = new THREE.Group(); wedgeG.add(wedge);
  const wedgeLabel = makeTextSprite('мёртвая зона', { color: '#fecaca', size: 40, scale: 0.45 });
  wedgeLabel.position.set(R * 0.7, 0.12, 0); wedgeG.add(wedgeLabel);
  g.add(wedgeG);
  // стрелка ветра на кольце (куда дует)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(-0.9, 0.5); shape.lineTo(-0.9, 0.18); shape.lineTo(-2.4, 0.18); shape.lineTo(-2.4, -0.18); shape.lineTo(-0.9, -0.18); shape.lineTo(-0.9, -0.5); shape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  arrow.rotation.x = -Math.PI / 2;
  const arrowG = new THREE.Group(); arrowG.add(arrow);
  arrow.position.x = R + 0.25;
  arrow.rotation.z = Math.PI; // остриё к центру
  const windLabel = makeTextSprite('ВЕТЕР', { color: '#bfdbfe', size: 44, scale: 0.4 });
  windLabel.position.set(R + 3.1, 0.2, 0); arrowG.add(windLabel);
  g.add(arrowG);

  g.userData.update = (bx, bz, windFromDeg) => {
    g.position.x = bx; g.position.z = bz;
    // направление «откуда» — ветер в мировых координатах: bearing b → (sin b, -cos b); в плоскости XZ угол вокруг y: rotation.y = π/2 - b
    const rot = Math.PI / 2 - windFromDeg * DEG;
    wedgeG.rotation.y = rot;
    arrowG.rotation.y = rot;
  };
  g.userData.setNoGo = (v) => { wedgeG.visible = v; };
  return g;
}

// ---------- стрелка вектора с подписью ----------
export class VectorArrow {
  constructor(scene, color, label) {
    this.color = color;
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color, 0.5, 0.3);
    this.arrow.cone.material.depthTest = false; this.arrow.line.material.depthTest = false;
    this.arrow.cone.renderOrder = 9; this.arrow.line.renderOrder = 9;
    // подпись: фиксированный холст, перерисовывается при смене текста
    this.canvas = document.createElement("canvas"); this.canvas.width = 420; this.canvas.height = 72;
    this.ctx = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.label.scale.set(420 * 0.0062, 72 * 0.0062, 1); this.label.renderOrder = 10;
    this.labelAt = 0.5; this.labelLift = 0.35;
    this.base = label; this._text = null; this._since = 1;
    scene.add(this.arrow); scene.add(this.label);
    this.visible = true;
    this.draw(label);
  }
  draw(text) {
    const g = this.ctx, c = this.canvas;
    g.clearRect(0, 0, c.width, c.height);
    g.font = "600 38px Inter, Arial, sans-serif";
    const w = Math.min(c.width, Math.ceil(g.measureText(text).width) + 34);
    g.fillStyle = this.color; g.globalAlpha = 0.9;
    g.beginPath(); g.roundRect((c.width - w) / 2, 4, w, 64, 14); g.fill();
    g.globalAlpha = 1; g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 38);
    this.tex.needsUpdate = true; this._text = text;
  }
  // from → to (мировые координаты); text — подпись (обновляется не чаще 4 раз/с)
  set(from, to, text, dt = 0) {
    const dir = to.clone().sub(from); const len = dir.length();
    if (len < 0.15 || !this.visible) { this.arrow.visible = false; this.label.visible = false; return; }
    this.arrow.visible = true; this.label.visible = true;
    this.arrow.position.copy(from);
    this.arrow.setDirection(dir.normalize());
    this.arrow.setLength(len, Math.min(0.6, len * 0.3), Math.min(0.35, len * 0.18));
    this.label.position.copy(from).lerp(to, this.labelAt); this.label.position.y += this.labelLift;
    this._since += dt;
    if (text && text !== this._text && this._since > 0.25) { this._since = 0; this.draw(text); }
  }
  setVisible(v) { this.visible = v; if (!v) { this.arrow.visible = false; this.label.visible = false; } }
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

// ---------- кильватерный след ----------
function foamTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function makeWake(n = 64) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const foam = foamTexture();
  const items = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', map: foam, transparent: true, opacity: 0, depthWrite: false }));
    m.position.y = 0.02; m.visible = false; g.add(m); items.push({ m, age: 99, size: 1 });
  }
  let acc = 0, k = 0;
  g.userData.update = (dt, sternX, sternZ, speed, heading) => {
    acc += dt;
    if (speed > 0.6 && acc > 0.1) {
      acc = 0; const it = items[k]; k = (k + 1) % n;
      it.age = 0; it.size = 0.9 + speed * 0.3; it.m.visible = true;
      it.m.position.x = sternX + (Math.random() - .5) * 0.3; it.m.position.z = sternZ + (Math.random() - .5) * 0.3;
      it.m.rotation.y = -heading;
    }
    for (const it of items) {
      if (!it.m.visible) continue;
      it.age += dt;
      const life = 3.2;
      if (it.age > life) { it.m.visible = false; continue; }
      const f = it.age / life;
      const s = it.size * (1 + f * 2.2);
      it.m.scale.set(s, 1, s * 0.6);
      it.m.material.opacity = 0.42 * (1 - f) * (1 - f);
    }
  };
  return g;
}
