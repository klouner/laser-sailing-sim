import * as THREE from 'three';

const DEG = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);

// ---------- геометрия корпуса (лофт по шпангоутам) ----------
// x — вдоль корпуса (нос +): полуширина по планширю, высота планширя, высота киля, «плоскость» днища
const STATIONS = [
  //   x,     hw,   sheer,  keel,   flat
  [-2.10, 0.555, 0.270,  0.060, 0.70],
  [-1.80, 0.625, 0.278, -0.045, 0.62],
  [-1.40, 0.672, 0.288, -0.120, 0.56],
  [-0.90, 0.695, 0.300, -0.150, 0.55],
  [-0.30, 0.695, 0.315, -0.160, 0.57],
  [ 0.30, 0.676, 0.335, -0.152, 0.63],
  [ 0.90, 0.618, 0.365, -0.122, 0.82],
  [ 1.40, 0.505, 0.405, -0.062, 1.20],
  [ 1.80, 0.335, 0.448,  0.030, 1.65],
  [ 2.05, 0.150, 0.485,  0.175, 2.10],
  [ 2.13, 0.000, 0.505,  0.420, 2.40],
];
export const HULL = { xStern: -2.10, xBow: 2.13, mastX: 1.12 };

function makeCurve(col) {
  const pts = STATIONS.map(s => new THREE.Vector3(s[0], s[col], 0));
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}
const curves = { hw: makeCurve(1), sheer: makeCurve(2), keel: makeCurve(3), flat: makeCurve(4) };
function stationAt(u) {
  const a = curves.hw.getPoint(u), b = curves.sheer.getPoint(u), c = curves.keel.getPoint(u), d = curves.flat.getPoint(u);
  return { x: a.x, hw: Math.max(0, a.y), sheer: b.y, keel: c.y, flat: Math.max(0.3, d.y) };
}
export function deckHeightAt(x) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (stationAt(m).x < x) lo = m; else hi = m; }
  return stationAt((lo + hi) / 2);
}
function sectionPoint(st, t) {
  const th = t * Math.PI / 2;
  const z = st.hw * Math.sin(th);
  const c = Math.pow(Math.max(0, Math.cos(th)), st.flat);
  const y = st.sheer - (st.sheer - st.keel) * c;
  return new THREE.Vector3(st.x, y, z);
}

function buildHullGeometry() {
  const NX = 84, NT = 36;
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NT; j++) {
      const p = sectionPoint(st, -1 + 2 * j / NT);
      pos.push(p.x, p.y, p.z); uv.push(i / NX, j / NT);
    }
  }
  const row = NT + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const st0 = stationAt(0);
  const center = pos.length / 3;
  pos.push(st0.x, (st0.sheer + st0.keel) / 2, 0); uv.push(0, 0.5);
  for (let j = 0; j < NT; j++) idx.push(center, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Кокпит
const COCKPIT = { xFront: 0.50, xBack: -1.05, wFront: 0.98, wBack: 0.80, depth: 0.20, r: 0.22 };
function cockpitHalfWidth(x) {
  const t = (COCKPIT.xFront - x) / (COCKPIT.xFront - COCKPIT.xBack);
  return (COCKPIT.wFront + (COCKPIT.wBack - COCKPIT.wFront) * t) / 2;
}
function cockpitSDF(x, z) {
  // отрицательно внутри; скруглённые углы
  if (x > COCKPIT.xFront + 0.3 || x < COCKPIT.xBack - 0.3) return 1;
  const hw = cockpitHalfWidth(THREE.MathUtils.clamp(x, COCKPIT.xBack, COCKPIT.xFront));
  const cx = (COCKPIT.xFront + COCKPIT.xBack) / 2, hx = (COCKPIT.xFront - COCKPIT.xBack) / 2;
  const dx = Math.abs(x - cx) - (hx - COCKPIT.r), dz = Math.abs(z) - (hw - COCKPIT.r);
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0) - COCKPIT.r;
}

function buildDeckGeometry() {
  const NX = 170, NZ = 56;
  const pos = [], idx = [], uv = [], col = [];
  const cDeck = new THREE.Color('#eef1f4'), cPit = new THREE.Color('#cfd6dd'), cSide = new THREE.Color('#e4e9ee');
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NZ; j++) {
      const t = -1 + 2 * j / NZ;
      const z = st.hw * t * 0.998;
      // палуба: небольшая погибь, в носу выше (горб у степса)
      const crown = 0.03 + 0.03 * THREE.MathUtils.smoothstep(st.x, 0.5, 1.6);
      let y = st.sheer + crown * (1 - t * t);
      let c = cDeck;
      const d = cockpitSDF(st.x, z);
      if (d < 0) {
        // стенки кокпита с плавным сопряжением и плоский пол
        const wall = THREE.MathUtils.smoothstep(-d, 0, 0.06);
        y = st.sheer + 0.01 - COCKPIT.depth * wall;
        c = wall > 0.9 ? cPit : cSide;
      } else if (Math.abs(z) > st.hw * 0.72 && st.x < 1.2 && st.x > -1.9) {
        c = cSide; // противоскользящие боковые палубы
      }
      pos.push(st.x, y, z); uv.push(st.x * 1.5, z * 1.5); col.push(c.r, c.g, c.b);
    }
  }
  const row = NZ + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sheerCurve() {
  const pts = [];
  const N = 70;
  for (let i = 0; i <= N; i++) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.012, st.hw)); }
  for (let i = N - 1; i >= 1; i--) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.012, -st.hw)); }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// ---------- текстуры ----------
function makeNonSkidTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 215 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- рангоут и форма паруса ----------
export const RIG = { MAST_H: 5.10, RAKE: 0.14, BOOM_H: 0.58, BOOM_L: 2.74, CLEW: 2.60 };
const SAIL = (() => {
  const tack = new THREE.Vector3(0.0, RIG.BOOM_H + 0.03, 0);
  const head = new THREE.Vector3(-RIG.RAKE * (RIG.MAST_H - 0.05) / RIG.MAST_H, RIG.MAST_H - 0.05, 0);
  const clew = new THREE.Vector3(-RIG.CLEW, RIG.BOOM_H + 0.03, 0);
  const leechDir = head.clone().sub(clew).normalize();
  const roachOut = new THREE.Vector3(-leechDir.y, leechDir.x, 0).normalize(); if (roachOut.x > 0) roachOut.negate();
  // плоская развёртка: u — от мачты к задней шкаторине, v — от гика к фаловому углу → (x, y) в метрах
  const flat = (u, v) => {
    const lx = tack.x + (head.x - tack.x) * v, ly = tack.y + (head.y - tack.y) * v;
    const roach = 0.24 * Math.sin(Math.PI * Math.pow(v, 0.9)) * (1 - 0.2 * v);
    const ex = clew.x + (head.x - clew.x) * v + roachOut.x * roach;
    const ey = clew.y + (head.y - clew.y) * v + roachOut.y * roach;
    return { x: lx + (ex - lx) * u, y: ly + (ey - ly) * u, chord: Math.hypot(ex - lx, ey - ly) };
  };
  let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const p = flat(i / 40, j / 40); xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  xmin -= 0.03; xmax += 0.03; ymin -= 0.03; ymax += 0.03;
  return { tack, head, clew, leechDir, roachOut, flat, xmin, xmax, ymin, ymax, w: xmax - xmin, h: ymax - ymin };
})();

function chevrons(g, x, y, h, color, gap) {
  g.save(); g.translate(x, y); g.strokeStyle = color; g.lineWidth = h * 0.3; g.lineJoin = 'miter'; g.lineCap = 'butt'; g.miterLimit = 8;
  for (let i = 0; i < 3; i++) { const x0 = i * gap; g.beginPath(); g.moveTo(x0, -h / 2); g.lineTo(x0 + h * 0.55, 0); g.lineTo(x0, h / 2); g.stroke(); }
  g.restore();
}

// Текстура паруса рисуется в реальных метрах (без искажений): холст = габарит плоского паруса.
// Дизайн по мотивам парусов «Силы ветра»: белое полотно, чёрная верхняя панель, номер в кружке, мелкие >>>
function makeSailTexture() {
  const H = 2048, K = H / SAIL.h, W = Math.round(SAIL.w * K);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x - SAIL.xmin) * K, Yc = (y) => (SAIL.ymax - y) * K; // метры → пиксели
  const P = (x, y) => [X(x), Yc(y)];
  g.fillStyle = '#f3f2ed'; g.fillRect(0, 0, W, H);
  // лёгкая фактура ткани
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  // точки на шкаторинах
  const luff = (v) => SAIL.flat(0, v), leech = (v) => SAIL.flat(1, v);
  // швы полотнищ: перпендикулярно задней шкаторине, шаг ~0.5 м
  const perp = new THREE.Vector2(-SAIL.leechDir.y, SAIL.leechDir.x); if (perp.x > 0) perp.negate(); // в сторону мачты
  g.strokeStyle = 'rgba(70,70,70,0.22)'; g.lineWidth = 2.5;
  for (let s = 0.5; s < 5.2; s += 0.5) {
    const L = SAIL.clew.clone().addScaledVector(SAIL.leechDir, s);
    g.beginPath(); g.moveTo(...P(L.x, L.y)); g.lineTo(...P(L.x + perp.x * 4, L.y + perp.y * 4)); g.stroke();
  }
  // чёрная верхняя панель: граница перпендикулярна задней шкаторине, выше — всё чёрное
  const cut = SAIL.clew.clone().addScaledVector(SAIL.leechDir, 3.65);
  const A = { x: cut.x - perp.x * 1.0, y: cut.y - perp.y * 1.0 };   // за задней шкаториной
  const B = { x: cut.x + perp.x * 4.0, y: cut.y + perp.y * 4.0 };   // за мачтой
  g.fillStyle = '#141414';
  g.beginPath(); g.moveTo(...P(A.x, A.y)); g.lineTo(...P(B.x, B.y)); g.lineTo(...P(B.x, B.y + 8)); g.lineTo(...P(A.x, A.y + 8)); g.closePath(); g.fill();
  // номер в кружке у задней шкаторины панели (истинный круг)
  const num = SAIL.clew.clone().addScaledVector(SAIL.leechDir, 4.1).addScaledVector(new THREE.Vector3(perp.x, perp.y, 0), 0.34);
  g.save(); g.translate(...P(num.x, num.y));
  g.strokeStyle = '#ffffff'; g.lineWidth = 0.014 * K; g.beginPath(); g.arc(0, 0, 0.17 * K, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff'; g.font = `500 ${Math.round(0.23 * K)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('5', 0, 0.012 * K); g.restore();
  // >>> у мачты в панели
  const ch = luff(0.86);
  g.save(); g.translate(...P(ch.x - 0.08, ch.y)); g.rotate(-0.08); chevrons(g, 0, 0, 0.11 * K, '#ffffff', 0.095 * K); g.restore();
  // латы: перпендикулярно задней шкаторине
  const batten = (s, len, color, wpx) => { const L = SAIL.clew.clone().addScaledVector(SAIL.leechDir, s); g.strokeStyle = color; g.lineWidth = wpx; g.beginPath(); g.moveTo(...P(L.x, L.y)); g.lineTo(...P(L.x + perp.x * len, L.y + perp.y * len)); g.stroke(); };
  batten(1.2, 0.95, 'rgba(60,60,60,0.5)', 0.02 * K); batten(2.25, 0.85, 'rgba(60,60,60,0.5)', 0.02 * K); batten(3.2, 0.7, 'rgba(60,60,60,0.5)', 0.02 * K); batten(4.3, 0.5, 'rgba(255,255,255,0.4)', 0.018 * K);
  // усиления углов
  g.fillStyle = 'rgba(120,120,120,0.35)';
  g.beginPath(); g.moveTo(...P(SAIL.tack.x, SAIL.tack.y)); g.lineTo(...P(SAIL.tack.x - 0.45, SAIL.tack.y)); g.lineTo(...P(SAIL.tack.x, SAIL.tack.y + 0.5)); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(...P(SAIL.clew.x, SAIL.clew.y)); g.lineTo(...P(SAIL.clew.x + 0.45, SAIL.clew.y)); g.lineTo(...P(SAIL.clew.x + 0.1, SAIL.clew.y + 0.5)); g.closePath(); g.fill();
  // окно: прямоугольник 0.75 × 0.45 м над гиком
  const wx = SAIL.clew.x + 0.55, wy = SAIL.tack.y + 0.22;
  g.fillStyle = 'rgba(170,200,225,0.75)'; g.strokeStyle = 'rgba(70,90,110,0.5)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(...P(wx, wy)); g.lineTo(...P(wx + 0.75, wy)); g.lineTo(...P(wx + 0.75, wy + 0.45)); g.lineTo(...P(wx, wy + 0.45)); g.closePath(); g.fill(); g.stroke();
  // эмблема класса — маленькая красная
  const em = SAIL.flat(0.3, 0.55);
  g.save(); g.translate(...P(em.x, em.y)); g.strokeStyle = '#c0282e'; g.lineWidth = 0.008 * K; g.lineCap = 'round';
  for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, r0 = (0.02 + (i % 2) * 0.025) * K, r1 = (0.07 + (i % 3) * 0.02) * K; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// Накладка с надписью «СИЛА >>> ВЕТРА» на скуле у носа: тонкий лоскут, повторяющий форму борта
function makeBrandDecalTexture() {
  const W = 1900, H = 440;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#141414'; g.font = '600 190px Inter, Arial, sans-serif'; g.textBaseline = 'middle';
  try { g.letterSpacing = '12px'; } catch (e) {}
  g.textAlign = 'right'; g.fillText('СИЛА', W / 2 - 230, H / 2);
  g.textAlign = 'left'; g.fillText('ВЕТРА', W / 2 + 230, H / 2);
  chevrons(g, W / 2 - 150, H / 2, 130, '#141414', 110);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
function makeHullDecal(side, tex) {
  const xa = 0.85, xb = 1.80, NX = 24, NY = 8;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const x = xa + (xb - xa) * i / NX;
    const st = deckHeightAt(x);
    const yTop = st.sheer - 0.07, yBot = Math.max(st.keel + 0.03, st.sheer - 0.29);
    for (let j = 0; j <= NY; j++) {
      const y = yBot + (yTop - yBot) * j / NY;
      const ratio = THREE.MathUtils.clamp((st.sheer - y) / Math.max(1e-3, st.sheer - st.keel), 1e-4, 1);
      const t = (2 / Math.PI) * Math.acos(Math.pow(ratio, 1 / st.flat));
      const p = sectionPoint(st, side * t);
      pos.push(p.x, p.y, p.z + side * 0.006);
      uv.push(i / NX, j / NY);
    }
  }
  const row = NY + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) { const a = i * row + j, b2 = a + 1, c2 = a + row, d2 = c2 + 1; idx.push(a, b2, c2, b2, d2, c2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const t2 = side < 0 ? (() => { const t = tex.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; return t; })() : tex;
  const mat = new THREE.MeshStandardMaterial({ map: t2, transparent: true, roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  return new THREE.Mesh(g, mat);
}

// ---------- вспомогательные ----------
function limb(mat, r) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 1, 10), mat); cyl.position.y = 0.5; cyl.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat); cap.castShadow = true;
  g.add(cyl); g.add(cap);
  g.userData.set = (a, b) => { const d = b.clone().sub(a); const L = d.length(); g.position.copy(a); g.quaternion.setFromUnitVectors(Y, d.normalize()); cyl.scale.y = L; cyl.position.y = L / 2; };
  return g;
}
// Трос: ломаная по точкам; sags[i] — провисание i-го отрезка (м, вниз по y)
function rope(parent, mat, r = 0.0075) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.castShadow = true; parent.add(mesh);
  return (points, sags = null) => {
    const path = new THREE.CurvePath();
    let segs = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], c = points[i + 1], s = sags ? (sags[i] || 0) : 0;
      if (s > 0.004) {
        const ctrl = a.clone().lerp(c, 0.5); ctrl.y -= 2 * s; // квадратичная Безье: провис в середине = s
        path.add(new THREE.QuadraticBezierCurve3(a, ctrl, c)); segs += 8;
      } else { path.add(new THREE.LineCurve3(a, c)); segs += 2; }
    }
    const g = new THREE.TubeGeometry(path, segs, r, 6, false);
    mesh.geometry.dispose(); mesh.geometry = g;
  };
}
function foilShape(chordTop, chordTip, depth, sweep, tipRound = 0.5) {
  // планформа пера в плоскости XY: вершина у оси поворота (0,0), перо вниз (−y), задняя кромка −x
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-chordTop, 0);
  s.lineTo(-chordTop - sweep, -depth + chordTip * tipRound);
  s.quadraticCurveTo(-chordTop - sweep + chordTip * 0.1, -depth, -sweep - chordTip * 0.5, -depth);
  s.quadraticCurveTo(-sweep + chordTip * 0.05, -depth, -sweep, -depth + chordTip * tipRound);
  s.lineTo(0, 0);
  return s;
}
function foilMesh(shape, thickness, mat) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.35, bevelSize: 0.012, bevelSegments: 3, steps: 1 });
  g.translate(0, 0, -thickness / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}

// ---------- сборка лодки ----------
export function createBoat() {
  const root = new THREE.Group();
  const heelG = new THREE.Group();
  root.add(heelG);

  const matHull = new THREE.MeshPhysicalMaterial({ color: '#f7f8fa', roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const matDeck = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeNonSkidTexture(), roughness: 0.85 });
  const matAlu = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.9, roughness: 0.3 });
  const matAluDark = new THREE.MeshStandardMaterial({ color: '#5b6068', metalness: 0.85, roughness: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.55 });
  const matFoil = new THREE.MeshPhysicalMaterial({ color: '#eef0f2', roughness: 0.3, clearcoat: 0.5 });
  const matRope = new THREE.MeshStandardMaterial({ color: '#e5e9ef', roughness: 0.9 });
  const matRopeRed = new THREE.MeshStandardMaterial({ color: '#d94848', roughness: 0.9 });
  const matRopeBlue = new THREE.MeshStandardMaterial({ color: '#3b5fc0', roughness: 0.9 });
  const matRubber = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.7 });

  const hull = new THREE.Mesh(buildHullGeometry(), matHull);
  hull.castShadow = true; hull.receiveShadow = true; heelG.add(hull);
  const deck = new THREE.Mesh(buildDeckGeometry(), matDeck);
  deck.castShadow = true; deck.receiveShadow = true; heelG.add(deck);
  const brandTex = makeBrandDecalTexture();
  heelG.add(makeHullDecal(1, brandTex)); heelG.add(makeHullDecal(-1, brandTex));
  const rail = new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(), 300, 0.02, 10, true), matRubber);
  rail.castShadow = true; heelG.add(rail);

  const deckAt = (x) => deckHeightAt(x).sheer;
  const floorY = deckAt(-0.2) - COCKPIT.depth + 0.01;

  // ----- шверт и колодец -----
  const trunkX = 0.80, trunkTop = deckAt(trunkX) + 0.06;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.05, 0.075), matDark);
  trunk.position.set(trunkX, deckAt(trunkX) + 0.035, 0); heelG.add(trunk);
  const board = foilMesh(foilShape(0.40, 0.26, 1.15, 0.03, 0.45), 0.022, matFoil);
  board.position.set(trunkX + 0.2, trunkTop + 0.28, 0); heelG.add(board);
  const boardTop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.03), matFoil);
  boardTop.position.set(trunkX, trunkTop + 0.29, 0); heelG.add(boardTop);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), matRubber);
  handle.position.set(trunkX, trunkTop + 0.34, 0); heelG.add(handle);
  // амортизатор шверта (резинка к носу)
  const bungee = rope(heelG, matDark, 0.005);
  bungee([new THREE.Vector3(trunkX, trunkTop + 0.3, 0), new THREE.Vector3(1.75, deckAt(1.75) + 0.04, 0)]);

  // ----- кокпит -----
  const strapMat = new THREE.MeshStandardMaterial({ color: '#2f3640', roughness: 0.95 });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.012, 0.09), strapMat);
  strap.position.set(-0.28, floorY + 0.075, 0); heelG.add(strap);
  for (const x of [0.25, -0.82]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.1), matAlu); eye.position.set(x, floorY + 0.01, 0); heelG.add(eye); }
  // блок гика-шкота со стопором
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 18), matDark);
  block.position.set(0.0, floorY + 0.06, 0); heelG.add(block);
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.05), matAluDark);
  cleat.position.set(0.0, floorY + 0.12, 0); heelG.add(cleat);
  const blockTop = new THREE.Vector3(0.0, floorY + 0.15, 0);
  // утки и ручки шкотов на палубе у кокпита
  for (const s of [-1, 1]) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), matAluDark);
    cl.position.set(0.72, deckAt(0.72) + 0.045, s * 0.26); heelG.add(cl);
  }
  // нос: скоба и буксирный конец
  const bowEye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16), matAlu);
  bowEye.position.set(2.02, deckAt(2.02) + 0.04, 0); bowEye.rotation.y = Math.PI / 2; heelG.add(bowEye);
  // погон гика-шкота на корме
  const sternY = deckAt(-1.98);
  for (const s of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.04), matAluDark);
    fl.position.set(-1.98, sternY + 0.05, s * 0.47); heelG.add(fl);
  }
  const traveler = rope(heelG, matRope, 0.006);
  const travP = new THREE.Vector3(-1.98, sternY + 0.045, 0);
  traveler([new THREE.Vector3(-1.98, sternY + 0.06, -0.47), travP, new THREE.Vector3(-1.98, sternY + 0.06, 0.47)]);
  const travBlock = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), matDark);
  travBlock.position.copy(travP).add(new THREE.Vector3(0, 0.03, 0)); heelG.add(travBlock);

  // ----- рангоут (вращается в степсе) -----
  const rig = new THREE.Group();
  const mastBase = new THREE.Vector3(HULL.mastX, deckAt(HULL.mastX), 0);
  rig.position.copy(mastBase); heelG.add(rig);
  const { MAST_H, RAKE, BOOM_H, BOOM_L, CLEW } = RIG;
  const mastTilt = Math.atan2(RAKE, MAST_H);
  const mastAt = (h) => new THREE.Vector3(-RAKE * h / MAST_H, h, 0);
  // нижнее колено (открытое, алюминий)
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, BOOM_H + 0.35, 20), matAlu);
  lower.position.copy(mastAt((BOOM_H + 0.3) / 2 - 0.3)); lower.rotation.z = mastTilt; lower.castShadow = true; rig.add(lower);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.05, 20), matDark); collar.position.y = 0.025; rig.add(collar);
  // карман передней шкаторины: верх мачты скрыт в парусе
  const sleeveLen = MAST_H - BOOM_H - 0.08;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.046, sleeveLen, 18), new THREE.MeshStandardMaterial({ color: '#f1f0ea', roughness: 0.9 }));
  sleeve.position.copy(mastAt(BOOM_H + 0.05 + sleeveLen / 2)); sleeve.rotation.z = mastTilt; sleeve.castShadow = true; rig.add(sleeve);
  const mastTopCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 12), matDark);
  mastTopCap.position.copy(mastAt(MAST_H)); mastTopCap.rotation.z = mastTilt; rig.add(mastTopCap);

  // гик
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, BOOM_L, 16), matAlu);
  boom.rotation.z = Math.PI / 2; boom.position.set(-BOOM_L / 2 + 0.03, BOOM_H, 0); boom.castShadow = true; rig.add(boom);
  const gooseneck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.06), matDark);
  gooseneck.position.set(-0.01, BOOM_H, 0); rig.add(gooseneck);
  const boomEndFit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), matDark);
  boomEndFit.rotation.z = Math.PI / 2; boomEndFit.position.set(-BOOM_L + 0.03, BOOM_H, 0); rig.add(boomEndFit);
  // блоки на гике
  const boomBlockEnd = new THREE.Vector3(-BOOM_L + 0.10, BOOM_H - 0.05, 0);
  const boomBlockMid = new THREE.Vector3(-1.25, BOOM_H - 0.05, 0);
  for (const p of [boomBlockEnd, boomBlockMid]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), matDark); b.position.copy(p); rig.add(b); }
  // оттяжка гика (ванг) с талями
  const vangA = new THREE.Vector3(-0.02, 0.16, 0), vangB = new THREE.Vector3(-0.68, BOOM_H - 0.03, 0);
  const vangRope = rope(rig, matDark, 0.012); vangRope([vangA, vangB]);
  const vangBlock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.04), matAluDark);
  vangBlock.position.copy(vangA).lerp(vangB, 0.5); vangBlock.quaternion.setFromUnitVectors(Y, vangB.clone().sub(vangA).normalize()); rig.add(vangBlock);
  // шкот-оттяжка (каннингем) и оттяжка шкотового угла
  const cunn = rope(rig, matRopeRed, 0.005); cunn([new THREE.Vector3(-0.03, 0.15, 0.02), new THREE.Vector3(-0.055, BOOM_H + 0.28, 0.02)]);
  const outhaul = rope(rig, matRopeBlue, 0.005); outhaul([new THREE.Vector3(-0.1, BOOM_H + 0.03, 0), new THREE.Vector3(-CLEW, BOOM_H + 0.03, 0)]);

  // парус
  const NU = 22, NV = 32;
  const sailGeo = new THREE.BufferGeometry();
  const sailPos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const sailUV = new Float32Array((NU + 1) * (NV + 1) * 2);
  const sailIdx = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { const k = i * (NV + 1) + j; const p = SAIL.flat(i / NU, j / NV); sailUV[k * 2] = (p.x - SAIL.xmin) / SAIL.w; sailUV[k * 2 + 1] = (p.y - SAIL.ymin) / SAIL.h; }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1; sailIdx.push(a, b, c, b, d, c); }
  sailGeo.setAttribute('position', new THREE.BufferAttribute(sailPos, 3));
  sailGeo.setAttribute('uv', new THREE.BufferAttribute(sailUV, 2));
  sailGeo.setIndex(sailIdx);
  const sailTex = makeSailTexture();
  const sailTexBack = sailTex.clone(); sailTexBack.wrapS = THREE.RepeatWrapping; sailTexBack.repeat.x = -1; sailTexBack.offset.x = 1;
  // лицевые грани сетки смотрят в сторону, где u растёт влево — им зеркальная текстура, обратным — прямая
  const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ map: sailTexBack, side: THREE.FrontSide, roughness: 0.92 }));
  const sailBack = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.BackSide, roughness: 0.92 }));
  sail.castShadow = true; sail.receiveShadow = true; rig.add(sail); rig.add(sailBack);
  // ликтрос задней шкаторины
  const leechRope = rope(rig, new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.9 }), 0.006);


  // флюгарка
  const windex = new THREE.Group(); windex.position.copy(mastAt(MAST_H + 0.04));
  const wShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.28, 6), matAlu); wShaft.position.y = 0.14; windex.add(wShaft);
  const wArrow = new THREE.Group(); wArrow.position.y = 0.28;
  const redM = new THREE.MeshStandardMaterial({ color: '#ef4444' });
  const wBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.012), redM); wBody.position.x = 0.1; wArrow.add(wBody);
  const wTip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 8), redM); wTip.rotation.z = -Math.PI / 2; wTip.position.x = 0.35; wArrow.add(wTip);
  const wFin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.005), redM); wFin.position.x = -0.1; wArrow.add(wFin);
  windex.add(wArrow); rig.add(windex);

  // гика-шкот (обновляется каждый кадр)
  const sheetRope = rope(heelG, matRope, 0.008);

  // ----- руль -----
  const rudderPivot = new THREE.Group();
  const transomY = deckAt(HULL.xStern);
  rudderPivot.position.set(HULL.xStern - 0.03, transomY, 0); heelG.add(rudderPivot);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.30, 0.08), matDark);
  stock.position.set(-0.06, -0.04, 0); rudderPivot.add(stock);
  const blade = foilMesh(foilShape(0.30, 0.17, 0.98, 0.26, 0.5), 0.022, matFoil);
  blade.position.set(-0.02, 0.0, 0); rudderPivot.add(blade);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.95, 10), matAluDark);
  tiller.rotation.z = Math.PI / 2; tiller.position.set(0.44, 0.12, 0); rudderPivot.add(tiller);
  const extPivot = new THREE.Group(); extPivot.position.set(0.9, 0.125, 0); rudderPivot.add(extPivot);
  const extension = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.1, 8), matAlu);
  extension.rotation.z = -Math.PI / 2; extension.position.x = 0.55; extPivot.add(extension);
  const extGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8), matRubber);
  extGrip.rotation.z = -Math.PI / 2; extGrip.position.x = 0.98; extPivot.add(extGrip);
  for (const y of [-0.02, 0.17]) { const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.09), matAlu); pin.position.set(HULL.xStern - 0.01, transomY + y, 0); heelG.add(pin); }

  // ----- матрос -----
  const skin = new THREE.MeshStandardMaterial({ color: '#c99474', roughness: 0.7 });
  const suit = new THREE.MeshStandardMaterial({ color: '#1a2029', roughness: 0.75 });
  const suitTrim = new THREE.MeshStandardMaterial({ color: '#2b3542', roughness: 0.75 });
  const vest = new THREE.MeshStandardMaterial({ color: '#ff5700', roughness: 0.65 });
  const vestTrim = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 });
  const shoe = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.9 });
  const sailor = new THREE.Group(); heelG.add(sailor);
  const addM = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; sailor.add(m); return m; };
  const pelvis = addM(new THREE.SphereGeometry(1, 16, 12), suit); pelvis.scale.set(0.2, 0.13, 0.17);
  const abdomen = addM(new THREE.CylinderGeometry(0.14, 0.16, 0.16, 16), suitTrim);
  const chest = addM(new THREE.CapsuleGeometry(0.15, 0.2, 8, 16), vest); chest.scale.set(1.25, 1, 0.8);
  const vestBand = addM(new THREE.TorusGeometry(0.17, 0.018, 8, 24), vestTrim); vestBand.scale.set(1.25, 1, 0.8);
  const shoulderL = addM(new THREE.SphereGeometry(0.075, 12, 10), vest), shoulderR = addM(new THREE.SphereGeometry(0.075, 12, 10), vest);
  const neck = addM(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin);
  const headM = addM(new THREE.SphereGeometry(0.105, 20, 16), skin);
  const cap = addM(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.8 }));
  const visor = addM(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#f4f4f4' }));
  const glasses = addM(new THREE.BoxGeometry(0.03, 0.035, 0.16), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3, metalness: 0.4 }));
  const thighL = limb(suit, 0.082), thighR = limb(suit, 0.082), shinL = limb(suitTrim, 0.065), shinR = limb(suitTrim, 0.065);
  const kneeL = addM(new THREE.SphereGeometry(0.078, 12, 10), suit), kneeR = addM(new THREE.SphereGeometry(0.078, 12, 10), suit);
  const upArmA = limb(suit, 0.052), foreArmA = limb(skin, 0.044), upArmB = limb(suit, 0.052), foreArmB = limb(skin, 0.044);
  const elbowA = addM(new THREE.SphereGeometry(0.05, 10, 8), suit), elbowB = addM(new THREE.SphereGeometry(0.05, 10, 8), suit);
  const handA = addM(new THREE.SphereGeometry(0.048, 12, 10), skin), handB = addM(new THREE.SphereGeometry(0.048, 12, 10), skin);
  handA.scale.set(1, 0.7, 1.2); handB.scale.set(1, 0.7, 1.2);
  const footL = addM(new THREE.BoxGeometry(0.24, 0.08, 0.1), shoe), footR = addM(new THREE.BoxGeometry(0.24, 0.08, 0.1), shoe);
  [thighL, thighR, shinL, shinR, upArmA, foreArmA, upArmB, foreArmB].forEach(o => sailor.add(o));
  const handSheet = rope(heelG, matRope, 0.008);

  // ---------- обновление ----------
  let flutterPhase = 0;
  const sheetState = { slack: 0, ease: 0 };
  const P = {
    hip: new THREE.Vector3(), shoulder: new THREE.Vector3(), headP: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(),
    elbowA: new THREE.Vector3(), handA: new THREE.Vector3(), elbowB: new THREE.Vector3(), handB: new THREE.Vector3(), tmp: new THREE.Vector3(),
  };
  const sailorState = { hike: 0, side: 1 };

  function updateSail(out, dt) {
    const side = out.side, aoa = out.aoa;
    const luff = out.luffing ? 1 : Math.max(0, 1 - aoa / 6);
    flutterPhase += dt * (6 + out.AWS * 1.2);
    const power = Math.min(1, out.q / 60);
    const camberFrac = 0.025 + 0.085 * Math.min(1, aoa / 14) * (0.4 + 0.6 * power);
    const twist = 10 * DEG * (0.3 + 0.7 * Math.min(1, out.AWS / 6));
    const pa = sailPos;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const fp = SAIL.flat(u, v);
        const x = fp.x, y = fp.y, chord = fp.chord;
        const shape = Math.sin(Math.PI * Math.pow(u, 0.82));
        let z = -side * camberFrac * chord * shape * (1 - 0.35 * v);
        z += -side * Math.sin(twist * v) * chord * u * 0.35 * power;
        if (luff > 0) {
          const fl = luff * 0.11 * Math.sin(flutterPhase * 1.3 + u * 7 + v * 3) * Math.pow(u, 0.7) * (0.3 + 0.7 * (1 - v * 0.5));
          z = z * (1 - 0.8 * luff) + fl * Math.min(1, out.AWS / 3);
        }
        // у мачты парус огибает карман
        z += -side * 0.03 * Math.exp(-u * 12);
        const k = (i * (NV + 1) + j) * 3;
        pa[k] = x; pa[k + 1] = y; pa[k + 2] = z;
      }
    }
    sailGeo.attributes.position.needsUpdate = true;
    sailGeo.computeVertexNormals();
    const leech = [];
    for (let j = 0; j <= NV; j += 4) { const k = (NU * (NV + 1) + j) * 3; leech.push(new THREE.Vector3(pa[k], pa[k + 1], pa[k + 2])); }
    leechRope(leech);
  }

  function updateSailor(state, dt) {
    const side = state.side;
    sailorState.hike += (Math.min(1, Math.abs(state.heel) / 16) - sailorState.hike) * Math.min(1, dt * 3);
    const h = sailorState.hike;
    const dy = deckAt(-0.35);
    // таз на кромке борта; при откренивании сдвигается наружу
    P.hip.set(-0.35, dy + 0.06, side * (0.44 + 0.2 * h));
    const theta = 0.35 + 0.9 * h; // наклон корпуса наружу
    const dir = P.tmp.set(-0.06, Math.cos(theta), side * Math.sin(theta)).normalize();
    const chestC = P.hip.clone().addScaledVector(dir, 0.34);
    P.shoulder.copy(P.hip).addScaledVector(dir, 0.5);
    P.headP.copy(P.shoulder).addScaledVector(dir, 0.2).add(new THREE.Vector3(0.03, 0.01, -side * 0.04));
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    pelvis.position.copy(P.hip); pelvis.quaternion.copy(q);
    abdomen.position.copy(P.hip).addScaledVector(dir, 0.15); abdomen.quaternion.copy(q);
    chest.position.copy(chestC); chest.quaternion.copy(q);
    vestBand.position.copy(P.hip).addScaledVector(dir, 0.27); vestBand.quaternion.copy(q); vestBand.rotateX(Math.PI / 2);
    neck.position.copy(P.shoulder).addScaledVector(dir, 0.06); neck.quaternion.copy(q);
    headM.position.copy(P.headP);
    cap.position.copy(P.headP).add(new THREE.Vector3(0, 0.025, 0)); cap.rotation.set(0, 0, -side * 0.15);
    visor.position.copy(P.headP).add(new THREE.Vector3(0.07, 0.055, 0)); visor.rotation.set(0, Math.PI / 2, 0);
    glasses.position.copy(P.headP).add(new THREE.Vector3(0.09, 0.01, 0));
    // плечи
    const shA = P.shoulder.clone().add(new THREE.Vector3(-0.17, -0.02, side * 0.01)); // заднее плечо
    const shB = P.shoulder.clone().add(new THREE.Vector3(0.17, -0.02, side * 0.01));  // переднее плечо
    shoulderL.position.copy(shA); shoulderR.position.copy(shB);
    // ноги: колени у кромки кокпита, стопы под ремнём; при откренивании ноги выпрямляются
    for (const [thigh, shin, knee, foot, off] of [[thighL, shinL, kneeL, footL, 0.11], [thighR, shinR, kneeR, footR, -0.11]]) {
      const hipJ = P.hip.clone().add(new THREE.Vector3(off * 0.9, -0.05, -side * 0.06));
      P.knee.set(-0.35 + off * 0.9, dy + 0.16 - 0.1 * h, side * (0.14 - 0.1 * h));
      P.foot.set(-0.3 + off * 0.9, floorY + 0.05, -side * 0.03);
      thigh.userData.set(hipJ, P.knee); shin.userData.set(P.knee, P.foot);
      knee.position.copy(P.knee);
      foot.position.copy(P.foot).add(new THREE.Vector3(0.04, 0, -side * 0.02)); foot.rotation.set(0, side * 0.35, 0);
    }
    // руки: задняя — румпель-удлинитель, передняя — шкот
    P.handA.set(-0.95, dy + 0.28 + 0.12 * h, side * (0.28 + 0.22 * h));
    P.handB.set(0.1, dy + 0.4 - 0.05 * h, side * (0.16 + 0.18 * h));
    P.elbowA.copy(shA).lerp(P.handA, 0.5).add(new THREE.Vector3(-0.02, -0.1, side * 0.14));
    P.elbowB.copy(shB).lerp(P.handB, 0.5).add(new THREE.Vector3(0.06, -0.12, side * 0.12));
    upArmA.userData.set(shA, P.elbowA); foreArmA.userData.set(P.elbowA, P.handA); elbowA.position.copy(P.elbowA); handA.position.copy(P.handA);
    upArmB.userData.set(shB, P.elbowB); foreArmB.userData.set(P.elbowB, P.handB); elbowB.position.copy(P.elbowB); handB.position.copy(P.handB);
    // удлинитель румпеля — в заднюю руку
    const local = rudderPivot.worldToLocal(heelG.localToWorld(P.handA.clone()));
    const d = local.sub(extPivot.position);
    extPivot.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    const extLen = THREE.MathUtils.clamp(d.length(), 0.5, 1.3);
    extension.scale.y = extLen / 1.1; extension.position.x = extLen / 2; extGrip.position.x = extLen - 0.1;
    // шкот от блока в переднюю руку: на попутных курсах матрос держит длинную слабину
    const handPt = P.handB.clone().add(new THREE.Vector3(0, -0.03, 0));
    const midY = (blockTop.y + handPt.y) / 2;
    const wantSag = 0.03 + 0.1 * sheetState.ease + 0.12 * sheetState.slack;
    const sag = Math.min(wantSag, midY - (floorY + 0.05));
    handSheet([blockTop, handPt], [Math.max(0, sag)]);
  }

  function update(state, out, ctl, dt, t) {
    out.side = state.side;
    root.position.set(state.x, 0, state.z);
    root.rotation.y = Math.PI / 2 - state.heading * DEG;
    const bob = Math.sin(t * 1.3) * 0.015 + Math.sin(t * 2.1 + 1) * 0.01;
    heelG.rotation.x = -state.heel * DEG;
    heelG.rotation.z = (Math.sin(t * 0.9) * 0.8 - Math.min(2.5, state.vf * 0.9)) * DEG;
    heelG.position.y = bob;

    rig.rotation.y = -state.boom * DEG;
    windex.rotation.y = -out.AWA * DEG - rig.rotation.y;
    updateSail(out, dt);

    // гика-шкот: блок на погоне → блок на ноке гика → обратно на погон (тали 2:1) → вдоль гика к среднему блоку → блок в кокпите
    const rot = rig.rotation.y;
    const bEnd = boomBlockEnd.clone().applyAxisAngle(Y, rot).add(mastBase);
    const bEnd2 = boomBlockEnd.clone().add(new THREE.Vector3(0.09, 0, 0)).applyAxisAngle(Y, rot).add(mastBase);
    const bMid = boomBlockMid.clone().applyAxisAngle(Y, rot).add(mastBase);
    const tv = travP.clone().add(new THREE.Vector3(0, 0.03, 0));
    // натяжение: гик упирается в ограничитель шкота и парус тянет → шкот натянут; иначе провисает
    const restrained = Math.abs(Math.abs(state.boom) - out.sheet) < 3 && !out.luffing;
    const load = restrained ? THREE.MathUtils.clamp(out.Fmag / 90, 0, 1) : 0;
    const slack = 1 - load;
    sheetState.slack += (slack - sheetState.slack) * Math.min(1, dt * 3);
    const sl = sheetState.slack;
    sheetRope(
      [tv.clone().add(new THREE.Vector3(0, 0, 0.02)), bEnd, tv.clone().add(new THREE.Vector3(0, 0, -0.02)), bEnd2, bMid, blockTop],
      [0.01 + 0.14 * sl, 0.01 + 0.14 * sl, 0.02 + 0.16 * sl, 0.02 + 0.22 * sl, 0.0]
    );

    rudderPivot.rotation.y = ctl.rudder * DEG;
    sheetState.ease += (out.sheet / 90 - sheetState.ease) * Math.min(1, dt * 3);
    if (sailor.visible) updateSailor(state, dt);
  }

  return { root, heelG, rig, update, setSailor: (v) => { sailor.visible = v; handSheet([blockTop, blockTop.clone().add(new THREE.Vector3(0, 0.001, 0))]); }, MAST_H, BOOM_H };
}
