import * as THREE from 'three';
import { sinkInWater } from './env.js';

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

const DECK_CROWN = 0.03;      // погибь палубы в корме и у кокпита, м
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
  // транец: отдельные вершины (плоская грань с чёткой кромкой), лицом в корму
  const st0 = stationAt(0);
  const ring0 = pos.length / 3;
  for (let j = 0; j <= NT; j++) { pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); uv.push(0, j / NT); }
  // верхняя кромка транца идёт по погиби палубы, от правого борта к левому: между транцем и палубой нет щели
  const NC = 12;
  for (let q = 1; q < NC; q++) { const t = 1 - 2 * q / NC; pos.push(st0.x, st0.sheer + DECK_CROWN * (1 - t * t), st0.hw * t); uv.push(0, 0.5); }
  const center = pos.length / 3, nRing = NT + NC;
  pos.push(st0.x, (st0.sheer + st0.keel) / 2, 0); uv.push(0, 0.5);
  for (let j = 0; j < nRing; j++) idx.push(center, ring0 + j, ring0 + (j + 1) % nRing);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Кокпит
const COCKPIT = { xFront: 0.14, xBack: -1.16, wFront: 0.98, wBack: 0.80, depth: 0.20, r: 0.22 };
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
      const crown = DECK_CROWN + 0.03 * THREE.MathUtils.smoothstep(st.x, 0.5, 1.6);
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
  for (let i = N - 1; i >= 0; i--) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.012, -st.hw)); }
  // по корме брус идёт вдоль кромки палубы с её погибью; точки у углов стоят часто, чтобы угол не срезало
  const s0 = stationAt(0);
  for (const t of [-0.97, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 0.97]) pts.push(new THREE.Vector3(s0.x, s0.sheer + 0.012 + DECK_CROWN * (1 - t * t), s0.hw * t));
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
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
function makeSailTexture(mirrorGlyphs = false) {
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
  const perp = new THREE.Vector2(-SAIL.leechDir.y, SAIL.leechDir.x); if (perp.x < 0) perp.negate(); // внутрь паруса, к мачте
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
  g.save(); g.translate(...P(num.x, num.y)); if (mirrorGlyphs) g.scale(-1, 1);
  g.strokeStyle = '#ffffff'; g.lineWidth = 0.014 * K; g.beginPath(); g.arc(0, 0, 0.17 * K, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff'; g.font = `500 ${Math.round(0.23 * K)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('5', 0, 0.012 * K); g.restore();
  // >>> у мачты в панели
  const ch = luff(0.86);
  g.save(); g.translate(...P(ch.x - 0.08, ch.y)); g.rotate(-0.08); if (mirrorGlyphs) { g.translate(0.19 * K, 0); g.scale(-1, 1); } chevrons(g, 0, 0, 0.11 * K, '#ffffff', 0.095 * K); g.restore();
  // латы: перпендикулярно задней шкаторине
  // латкарманы: две тонкие строчки по краям кармана шириной 5 см
  const batten = (s, len, color) => {
    const L = SAIL.clew.clone().addScaledVector(SAIL.leechDir, s);
    const nx = -perp.y, ny = perp.x; // поперёк кармана
    g.strokeStyle = color; g.lineWidth = 0.004 * K;
    for (const o of [-0.025, 0.025]) { g.beginPath(); g.moveTo(...P(L.x + nx * o, L.y + ny * o)); g.lineTo(...P(L.x + perp.x * len + nx * o, L.y + perp.y * len + ny * o)); g.stroke(); }
    g.beginPath(); g.moveTo(...P(L.x + perp.x * len + nx * 0.025, L.y + perp.y * len + ny * 0.025)); g.lineTo(...P(L.x + perp.x * len - nx * 0.025, L.y + perp.y * len - ny * 0.025)); g.stroke();
  };
  batten(1.2, 0.95, 'rgba(70,70,70,0.35)'); batten(2.25, 0.85, 'rgba(70,70,70,0.35)'); batten(3.2, 0.7, 'rgba(70,70,70,0.35)'); batten(4.3, 0.5, 'rgba(255,255,255,0.3)');
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
// Сегмент конечности от сустава a к суставу b: радиус r0 у начала, r1 у конца
// ---------- тело матроса: одна оболочка ----------
// Торс, руки и ноги — одна сетка с цветом в вершинах. Каждый кадр кольца оболочки переставляются по суставам,
// которые даёт кинематика: в локтях и коленях получается плавный сгиб без шаров-шарниров. Число вершин постоянно.
const BODY_SIDES = 12;
// торс: [расстояние вдоль корпуса от таза, полуширина по линии плеч, полутолщина, цвет]
const TORSO_RINGS = [
  [-0.125, 0.002, 0.002, 'pants'], [-0.10, 0.115, 0.095, 'pants'], [-0.04, 0.182, 0.150, 'pants'], [0.02, 0.182, 0.150, 'pants'], [0.058, 0.170, 0.120, 'pants'],
  [0.064, 0.166, 0.112, 'top'], [0.10, 0.160, 0.104, 'top'], [0.134, 0.160, 0.104, 'top'],
  [0.140, 0.186, 0.130, 'vest'], [0.186, 0.196, 0.137, 'vest'], [0.190, 0.202, 0.142, 'trim'], [0.216, 0.205, 0.144, 'trim'], [0.220, 0.200, 0.140, 'vest'],
  [0.335, 0.216, 0.149, 'vest'], [0.415, 0.207, 0.143, 'vest'], [0.452, 0.165, 0.118, 'vest'],
  [0.458, 0.150, 0.100, 'top'], [0.492, 0.085, 0.070, 'top'], [0.500, 0.056, 0.056, 'skin'], [0.585, 0.050, 0.050, 'skin'], [0.60, 0.002, 0.002, 'skin'],
];
// конечность: путь из четырёх точек (плечо, локоть, запястье, кончики пальцев или бедро, колено, щиколотка, носок).
// rad — радиус по пути: [координата пути 0..3, радиус]; split — с какой координаты начинается перчатка или ботинок.
const ARM_SPEC = { rad: [[0, 0.060], [1, 0.047], [1.9, 0.036], [2.3, 0.045], [3, 0.036]], split: 1.93, a: 'top', b: 'glove', f1: 0.07, f2: 0.02 };
const LEG_SPEC = { rad: [[0, 0.092], [1, 0.066], [1.92, 0.047], [2.25, 0.053], [3, 0.046]], split: 1.82, a: 'pants', b: 'boot', f1: 0.09, f2: 0.045 };
const LIMB_RINGS = 3 + 2 + 5 + 2 + 4 + 2 + 2;
const NECK_T = 0.47;       // выше этой отметки торса начинается шея
function makeBody(colors) {
  const S = BODY_SIDES, nRings = TORSO_RINGS.length + 4 * LIMB_RINGS, nV = nRings * S;
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3), idx = [];
  const C = {}; for (const k in colors) C[k] = new THREE.Color(colors[k]);
  // каждая часть — свой отрезок колец; между частями треугольников нет
  const parts = [TORSO_RINGS.length, LIMB_RINGS, LIMB_RINGS, LIMB_RINGS, LIMB_RINGS];
  let r0 = 0;
  for (const n of parts) {
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < S; j++) {
      const a = (r0 + i) * S + j, b = (r0 + i) * S + (j + 1) % S, c = a + S, d = b + S;
      idx.push(a, b, c, b, d, c);
    }
    r0 += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76 }));
  mesh.castShadow = true; mesh.frustumCulled = false;
  const cs = [], sn = []; for (let j = 0; j < S; j++) { cs.push(Math.cos(j / S * Math.PI * 2)); sn.push(Math.sin(j / S * Math.PI * 2)); }
  let ring = 0, hidden = 0;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), c0 = new THREE.Vector3(), d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), d3 = new THREE.Vector3();
  const A1 = new THREE.Vector3(), A2 = new THREE.Vector3(), B1 = new THREE.Vector3(), B2 = new THREE.Vector3(), tmp = new THREE.Vector3();
  // кольцо с центром c, осями n и b, радиусами ra и rb, цветом color
  function put(c, n, b, ra, rb, color) {
    let o = ring * S * 3;
    for (let j = 0; j < S; j++, o += 3) {
      const x = cs[j] * ra, y = sn[j] * rb;
      pos[o] = c.x + n.x * x + b.x * y; pos[o + 1] = c.y + n.y * x + b.y * y; pos[o + 2] = c.z + n.z * x + b.z * y;
      col[o] = color.r; col[o + 1] = color.g; col[o + 2] = color.b;
    }
    ring++;
  }
  const radAt = (spec, w) => { const r = spec.rad; for (let i = 1; i < r.length; i++) if (w <= r[i][0]) { const u = (w - r[i - 1][0]) / (r[i][0] - r[i - 1][0]); return r[i - 1][1] + (r[i][1] - r[i - 1][1]) * Math.max(0, u); } return r[r.length - 1][1]; };
  // кольцо конечности: касательная t задана, нормаль переносится с предыдущего кольца без закручивания
  function limbRing(c, t, w, spec, hide, scale = 1) {
    N.addScaledVector(t, -N.dot(t)); if (N.lengthSq() < 1e-8) N.set(t.y, -t.x, 0); N.normalize();
    B.crossVectors(t, N);
    const r = hide ? 0.0005 : radAt(spec, w) * scale;
    // скрытые кольца стягиваются в центр первого видимого: срез получается плоским, без острия
    if (!hide && hidden > 0) { for (let o = (ring - hidden) * S * 3; o < ring * S * 3; o += 3) { pos[o] = c.x; pos[o + 1] = c.y; pos[o + 2] = c.z; } hidden = 0; }
    if (hide) hidden++;
    put(c, N, B, r, r, C[w < spec.split ? spec.a : spec.b]);
  }
  // hideTo — координата пути, до которой часть скрыта (вид из глаз: плечо и верх руки не рисуются)
  function limb(p0, p1, p2, p3, spec, pole, hideTo = -1) {
    d1.subVectors(p1, p0); const L1 = d1.length() || 1e-4; d1.divideScalar(L1);
    d2.subVectors(p2, p1); const L2 = d2.length() || 1e-4; d2.divideScalar(L2);
    d3.subVectors(p3, p2); const L3 = d3.length() || 1e-4; d3.divideScalar(L3);
    const f1 = Math.min(spec.f1, L1 * 0.45, L2 * 0.4), f2 = Math.min(spec.f2, L2 * 0.4, L3 * 0.45);
    A1.copy(p1).addScaledVector(d1, -f1); A2.copy(p1).addScaledVector(d2, f1);       // скругление первого сустава
    B1.copy(p2).addScaledVector(d2, -f2); B2.copy(p2).addScaledVector(d3, f2);       // и второго
    N.crossVectors(d1, d2); if (N.lengthSq() < 1e-6) N.copy(pole);                    // ось сгиба: кольца не закручиваются
    const hid = (w) => w < hideTo; hidden = 0;
    const rs = radAt(spec, 0);
    // закруглённое начало
    limbRing(c0.copy(p0).addScaledVector(d1, -rs * 0.7), d1, 0, spec, hid(0), 0.03);
    limbRing(c0.copy(p0).addScaledVector(d1, -rs * 0.4), d1, 0, spec, hid(0), 0.78);
    limbRing(c0.copy(p0), d1, 0, spec, hid(0));
    for (const u of [0.5, 1]) limbRing(c0.copy(p0).lerp(A1, u), d1, u * (1 - f1 / L1), spec, hid(u * (1 - f1 / L1)));
    for (const t of [0.2, 0.4, 0.6, 0.8, 1]) {
      const k = 1 - t;
      c0.set(k * k * A1.x + 2 * k * t * p1.x + t * t * A2.x, k * k * A1.y + 2 * k * t * p1.y + t * t * A2.y, k * k * A1.z + 2 * k * t * p1.z + t * t * A2.z);
      T.copy(d1).lerp(d2, t).normalize();
      const w = 1 + (t - 0.5) * 0.3; limbRing(c0, T, w, spec, hid(w));
    }
    for (const u of [0.5, 1]) { const w = 1.15 + u * (0.85 - f2 / L2); limbRing(c0.copy(A2).lerp(B1, u), d2, w, spec, hid(w)); }
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const k = 1 - t;
      c0.set(k * k * B1.x + 2 * k * t * p2.x + t * t * B2.x, k * k * B1.y + 2 * k * t * p2.y + t * t * B2.y, k * k * B1.z + 2 * k * t * p2.z + t * t * B2.z);
      T.copy(d2).lerp(d3, t).normalize();
      limbRing(c0, T, 2 + (t - 0.5) * 0.2, spec, false);
    }
    for (const u of [0.5, 1]) limbRing(c0.copy(B2).lerp(p3, u), d3, 2.1 + u * 0.9, spec, false);
    const re = radAt(spec, 3);
    limbRing(c0.copy(p3).addScaledVector(d3, re * 0.45), d3, 3, spec, false, 0.75);
    limbRing(c0.copy(p3).addScaledVector(d3, re * 0.75), d3, 3, spec, false, 0.03);
  }
  // торс: жёсткий, вдоль dir от таза; ax — линия плеч
  // neck — куда идёт шея от плеч: голова может быть поднята относительно линии корпуса
  function torso(hip, dir, ax, hide, neck = dir) {
    N.copy(ax).addScaledVector(dir, -ax.dot(dir)).normalize(); B.crossVectors(dir, N);
    for (const [t, a, b, c] of TORSO_RINGS) {
      tmp.copy(hip).addScaledVector(dir, hide ? 0 : Math.min(t, NECK_T));
      if (!hide && t > NECK_T) tmp.addScaledVector(neck, t - NECK_T);
      put(tmp, N, B, hide ? 0.0005 : a, hide ? 0.0005 : b, C[c]);
    }
  }
  return {
    mesh, torso, limb,
    begin() { ring = 0; },
    end() { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals(); },
  };
}

// Парус просвечивает: сторона, обращённая от солнца, получает часть прошедшего сквозь ткань света
function backlit(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #if NUM_DIR_LIGHTS > 0
        totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * 0.085 * max(dot(-normal, directionalLights[0].direction), 0.0);
      #endif`);
  };
  mat.customProgramCacheKey = () => 'backlit';
  return mat;
}
// Трос фиксированной топологии: nPts опорных точек, ROPE_SUB делений на отрезок.
// Геометрия создаётся один раз, вершины пересчитываются на месте — без выделения памяти в кадре.
// sags[i] — провисание i-го отрезка (м, вниз по y). keep:false — статичный трос, его можно склеить с соседями.
const ROPE_SUB = 6, ROPE_RAD = 5;
const ROPE_COS = [], ROPE_SIN = [];
for (let j = 0; j < ROPE_RAD; j++) { ROPE_COS.push(Math.cos(j / ROPE_RAD * Math.PI * 2)); ROPE_SIN.push(Math.sin(j / ROPE_RAD * Math.PI * 2)); }
function rope(parent, mat, r = 0.0075, nPts = 2, { keep = true } = {}) {
  const rings = (nPts - 1) * ROPE_SUB + 1;
  const pos = new Float32Array(rings * ROPE_RAD * 3), nor = new Float32Array(rings * ROPE_RAD * 3), ctr = new Float32Array(rings * 3);
  const idx = [];
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < ROPE_RAD; j++) {
    const a = i * ROPE_RAD + j, b = i * ROPE_RAD + (j + 1) % ROPE_RAD, c = a + ROPE_RAD, d = b + ROPE_RAD;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false; mesh.frustumCulled = false; mesh.userData.keep = keep; parent.add(mesh);
  const update = (points, sags = null) => {
    let k = 0;
    for (let s = 0; s < nPts - 1; s++) {
      const a = points[s], c = points[s + 1], sag = sags ? (sags[s] || 0) : 0;
      const n = s === nPts - 2 ? ROPE_SUB + 1 : ROPE_SUB;
      for (let q = 0; q < n; q++) {
        const t = q / ROPE_SUB;
        ctr[k++] = a.x + (c.x - a.x) * t; ctr[k++] = a.y + (c.y - a.y) * t - 4 * sag * t * (1 - t); ctr[k++] = a.z + (c.z - a.z) * t;
      }
    }
    for (let i = 0; i < rings; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = Math.min(rings - 1, i + 1) * 3, ic = i * 3;
      let tx = ctr[i1] - ctr[i0], ty = ctr[i1 + 1] - ctr[i0 + 1], tz = ctr[i1 + 2] - ctr[i0 + 2];
      let L = Math.hypot(tx, ty, tz); if (L < 1e-7) { tx = 0; ty = 1; tz = 0; L = 1; } tx /= L; ty /= L; tz /= L;
      let ux = 0, uy = 1, uz = 0; if (Math.abs(ty) > 0.95) { ux = 1; uy = 0; }
      let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
      L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let j = 0; j < ROPE_RAD; j++) {
        const dx = nx * ROPE_COS[j] + bx * ROPE_SIN[j], dy = ny * ROPE_COS[j] + by * ROPE_SIN[j], dz = nz * ROPE_COS[j] + bz * ROPE_SIN[j];
        const o = (i * ROPE_RAD + j) * 3;
        pos[o] = ctr[ic] + dx * r; pos[o + 1] = ctr[ic + 1] + dy * r; pos[o + 2] = ctr[ic + 2] + dz * r;
        nor[o] = dx; nor[o + 1] = dy; nor[o + 2] = dz;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  };
  update.mesh = mesh;
  return update;
}
// Склейка статичных деталей группы в один меш на материал: меньше вызовов отрисовки и проходов теней.
// Не трогает меши с userData.keep и вложенные группы.
function mergeStatic(parent) {
  const groups = new Map();
  for (const ch of [...parent.children]) {
    if (!ch.isMesh || ch.userData.keep) continue;
    ch.updateMatrix();
    const g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(ch.matrix);
    const key = ch.material.uuid + (ch.castShadow ? 's' : '') + (ch.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { mat: ch.material, cast: ch.castShadow, recv: ch.receiveShadow, geos: [] });
    groups.get(key).geos.push(g);
    parent.remove(ch); ch.geometry.dispose();
  }
  for (const gr of groups.values()) {
    let n = 0; for (const g of gr.geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g of gr.geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const m = new THREE.Mesh(geo, gr.mat); m.castShadow = gr.cast; m.receiveShadow = gr.recv; m.userData.keep = true; parent.add(m);
  }
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

// ---------- кинематика рук ----------
// Кисть не дальше вытянутой руки: подтягиваем цель к плечу
function clampReach(shoulder, hand, reach) {
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y, dz = hand.z - shoulder.z, L = Math.hypot(dx, dy, dz);
  if (L > reach) { const k = reach / L; hand.set(shoulder.x + dx * k, shoulder.y + dy * k, shoulder.z + dz * k); }
  return hand;
}
// Средний сустав двухзвенной конечности (локоть, колено); pole — куда сгибается
function solveElbow(root, end, L1, L2, pole, out) {
  let dx = end.x - root.x, dy = end.y - root.y, dz = end.z - root.z, D = Math.hypot(dx, dy, dz);
  if (D < 1e-4) return out.set(root.x, root.y - L1, root.z);
  dx /= D; dy /= D; dz /= D; D = Math.min(D, L1 + L2 - 1e-3);
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D), hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pd = pole.x * dx + pole.y * dy + pole.z * dz;
  let px = pole.x - dx * pd, py = pole.y - dy * pd, pz = pole.z - dz * pd, pl = Math.hypot(px, py, pz);
  if (pl < 1e-5) { px = 0; py = -1; pz = 0; pl = 1; }
  return out.set(root.x + dx * a + px / pl * hgt, root.y + dy * a + py / pl * hgt, root.z + dz * a + pz / pl * hgt);
}

// ---------- сборка лодки ----------
export function createBoat(env0 = null) {
  const root = new THREE.Group();
  const heelG = new THREE.Group();
  root.add(heelG);

  const matHull = new THREE.MeshPhysicalMaterial({ color: '#f7f8fa', roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const matDeck = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeNonSkidTexture(), roughness: 0.85 });
  const matAlu = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.9, roughness: 0.3 });
  const matAluDark = new THREE.MeshStandardMaterial({ color: '#5b6068', metalness: 0.85, roughness: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.55 });
  const matFoil = new THREE.MeshPhysicalMaterial({ color: '#eef0f2', roughness: 0.3, clearcoat: 0.5 });
  if (env0) { sinkInWater(matHull, env0); sinkInWater(matFoil, env0); }
  const matRope = new THREE.MeshStandardMaterial({ color: '#e5e9ef', roughness: 0.9 });
  const matRopeRed = new THREE.MeshStandardMaterial({ color: '#d94848', roughness: 0.9 });
  const matRopeBlue = new THREE.MeshStandardMaterial({ color: '#3b5fc0', roughness: 0.9 });
  const matRubber = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.7 });

  const hull = new THREE.Mesh(buildHullGeometry(), matHull);
  hull.castShadow = true; hull.receiveShadow = true; hull.userData.keep = true; heelG.add(hull);
  const deck = new THREE.Mesh(buildDeckGeometry(), matDeck);
  deck.castShadow = true; deck.receiveShadow = true; deck.userData.keep = true; heelG.add(deck);
  const brandTex = makeBrandDecalTexture();
  for (const sd of [1, -1]) { const dc = makeHullDecal(sd, brandTex); dc.userData.keep = true; heelG.add(dc); }
  const rail = new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(), 300, 0.02, 10, true), matRubber);
  rail.castShadow = true; heelG.add(rail);

  const deckAt = (x) => deckHeightAt(x).sheer;
  const floorY = deckAt(-0.2) - COCKPIT.depth + 0.01;

  // ----- шверт и колодец -----
  const trunkX = 0.45, trunkTop = deckAt(trunkX) + 0.06;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.05, 0.075), matDark);
  trunk.position.set(trunkX, deckAt(trunkX) + 0.035, 0); heelG.add(trunk);
  const board = foilMesh(foilShape(0.40, 0.26, 1.15, 0.03, 0.45), 0.022, matFoil);
  board.position.set(trunkX + 0.2, trunkTop + 0.28, 0); board.userData.keep = true; heelG.add(board);
  const boardTop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.03), matFoil);
  boardTop.position.set(trunkX, trunkTop + 0.29, 0); boardTop.userData.keep = true; heelG.add(boardTop);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), matRubber);
  handle.position.set(trunkX, trunkTop + 0.34, 0); handle.userData.keep = true; heelG.add(handle);
  // амортизатор шверта (резинка к носу)
  const bungee = rope(heelG, matDark, 0.005, 2, { keep: false });
  bungee([new THREE.Vector3(trunkX, trunkTop + 0.3, 0), new THREE.Vector3(1.75, deckAt(1.75) + 0.04, 0)]);

  // ----- кокпит -----
  const strapMat = new THREE.MeshStandardMaterial({ color: '#2f3640', roughness: 0.95 });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.012, 0.09), strapMat);
  strap.position.set(-0.52, floorY + 0.075, 0); heelG.add(strap);
  for (const x of [-0.02, -1.02]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.1), matAlu); eye.position.set(x, floorY + 0.01, 0); heelG.add(eye); }
  // блок гика-шкота со стопором
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 18), matDark);
  block.position.set(-0.12, floorY + 0.06, 0); heelG.add(block);
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.05), matAluDark);
  cleat.position.set(-0.12, floorY + 0.12, 0); heelG.add(cleat);
  const blockTop = new THREE.Vector3(-0.12, floorY + 0.15, 0);
  // утки и ручки шкотов на палубе у кокпита
  for (const s of [-1, 1]) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), matAluDark);
    cl.position.set(0.45, deckAt(0.45) + 0.045, s * 0.26); heelG.add(cl);
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
  const traveler = rope(heelG, matRope, 0.006, 3, { keep: false });
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
  // Каплевидный: круглый спереди, сзади сходит на нет и поворачивается вслед за парусом.
  const SLV_H = 16, SLV_M = 11, SLV_P = SLV_M + 1, SLV_TAIL = 0.15;
  const slvY0 = BOOM_H + 0.05, slvY1 = MAST_H - 0.03;
  const slvShape = [];
  for (let m = 0; m < SLV_M; m++) { const a = (-125 + 250 * m / (SLV_M - 1)) * DEG; slvShape.push([Math.cos(a), Math.sin(a)]); }
  const slvPos = new Float32Array((SLV_H + 1) * SLV_P * 3), slvIdx = [];
  for (let i = 0; i < SLV_H; i++) for (let j = 0; j < SLV_P; j++) {
    const a = i * SLV_P + j, b = i * SLV_P + (j + 1) % SLV_P, c = a + SLV_P, d = b + SLV_P;
    slvIdx.push(a, b, c, b, d, c);
  }
  const slvGeo = new THREE.BufferGeometry();
  slvGeo.setAttribute('position', new THREE.BufferAttribute(slvPos, 3)); slvGeo.setIndex(slvIdx);
  const sleeve = new THREE.Mesh(slvGeo, new THREE.MeshStandardMaterial({ color: '#f1f0ea', roughness: 0.9, side: THREE.DoubleSide }));
  sleeve.castShadow = true; sleeve.frustumCulled = false; sleeve.userData.keep = true; rig.add(sleeve);
  // изгиб мачты: оттяжка, шкот и каннингхэм гнут топ назад, парус от этого становится площе
  let mastBend = 0;
  const bendAt = (v) => mastBend * v * v;
  // angleAt(v) — куда смотрит хвост кармана на высоте v (0 у гика, 1 у топа)
  function updateSleeve(angleAt) {
    for (let i = 0; i <= SLV_H; i++) {
      const f = i / SLV_H, h = slvY0 + (slvY1 - slvY0) * f, r = 0.046 - 0.016 * f;
      const v = Math.min(1, Math.max(0, (h - (BOOM_H + 0.03)) / (MAST_H - 0.05 - BOOM_H - 0.03))), cx = -RAKE * h / MAST_H - bendAt(v);
      const phi = angleAt(v), cs = Math.cos(phi), sn = Math.sin(phi);
      for (let j = 0; j < SLV_P; j++) {
        const lx = j < SLV_M ? slvShape[j][0] * r : -SLV_TAIL * (1 - 0.35 * f), lz = j < SLV_M ? slvShape[j][1] * r : 0;
        const o = (i * SLV_P + j) * 3;
        slvPos[o] = cx + lx * cs + lz * sn; slvPos[o + 1] = h; slvPos[o + 2] = -lx * sn + lz * cs;
      }
    }
    slvGeo.attributes.position.needsUpdate = true; slvGeo.computeVertexNormals();
  }
  updateSleeve(() => 0);
  const mastTopCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 12), matDark);
  mastTopCap.position.copy(mastAt(MAST_H)); mastTopCap.rotation.z = mastTilt; mastTopCap.userData.keep = true; rig.add(mastTopCap);

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
  const vangRope = rope(rig, matDark, 0.012, 2, { keep: false }); vangRope([vangA, vangB]);
  const vangBlock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.04), matAluDark);
  vangBlock.position.copy(vangA).lerp(vangB, 0.5); vangBlock.quaternion.setFromUnitVectors(Y, vangB.clone().sub(vangA).normalize()); rig.add(vangBlock);
  // шкот-оттяжка (каннингем) и оттяжка шкотового угла
  const cunn = rope(rig, matRopeRed, 0.005, 2, { keep: false }); cunn([new THREE.Vector3(-0.03, 0.15, 0.02), new THREE.Vector3(-0.055, BOOM_H + 0.28, 0.02)]);
  const outhaul = rope(rig, matRopeBlue, 0.005, 2, { keep: false }); outhaul([new THREE.Vector3(-0.1, BOOM_H + 0.03, 0), new THREE.Vector3(-CLEW, BOOM_H + 0.03, 0)]);

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
  // плоская форма паруса не меняется — считаем её один раз, в кадре только выгибаем
  const sailFlat = new Float32Array((NU + 1) * (NV + 1) * 3), sailShape = new Float32Array(NU + 1);
  for (let i = 0; i <= NU; i++) {
    sailShape[i] = Math.sin(Math.PI * Math.pow(i / NU, 0.82));
    for (let j = 0; j <= NV; j++) { const p = SAIL.flat(i / NU, j / NV), k = (i * (NV + 1) + j) * 3; sailFlat[k] = p.x; sailFlat[k + 1] = p.y; sailFlat[k + 2] = p.chord; }
  }
  // две текстуры: одинаковая геометрия рисунка, но глифы (цифра, шевроны) отражены — чтобы читались с обоих бортов
  const sailTex = makeSailTexture(false);
  const sailTexBack = makeSailTexture(true);
  // лицевым граням — прямые глифы, обратным — отражённые
  const sail = new THREE.Mesh(sailGeo, backlit(new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.FrontSide, roughness: 0.92, shadowSide: THREE.DoubleSide })));
  const sailBack = new THREE.Mesh(sailGeo, backlit(new THREE.MeshStandardMaterial({ map: sailTexBack, side: THREE.BackSide, roughness: 0.92 })));
  sail.castShadow = true; sail.receiveShadow = true; sail.userData.keep = true; sailBack.userData.keep = true; sail.frustumCulled = false; sailBack.frustumCulled = false; rig.add(sail); rig.add(sailBack);
  // ликтрос задней шкаторины
  const LEECH_N = NV / 4 + 1;
  const leechRope = rope(rig, new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.9 }), 0.006, LEECH_N);
  const leechPts = Array.from({ length: LEECH_N }, () => new THREE.Vector3());
  // колдунчики: пары ленточек у передней шкаторины на двух высотах (правый борт зелёный, левый красный)
  const ttG = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.9 }), ttR = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.9 });
  const telltales = [];
  for (const v of [0.3, 0.6]) for (const sgn of [1, -1]) telltales.push({ u: 0.22, v, sgn, draw: rope(rig, sgn > 0 ? ttG : ttR, 0.006, 3), phase: Math.random() * 10, pts: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] });


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
  const sheetRope = rope(heelG, matRope, 0.008, 6);
  const sheetPts = Array.from({ length: 6 }, () => new THREE.Vector3());
  const sheetSags = [0, 0, 0, 0, 0];

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
  // Фигура из сглаженных форм: торс-тело вращения, конусные конечности на шарнирах, жилет, кепка, очки, ботинки.
  const skin = new THREE.MeshStandardMaterial({ color: '#c99474', roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#1d2b45', roughness: 0.8 });   // брызгозащитная куртка
  const pants = new THREE.MeshStandardMaterial({ color: '#14181f', roughness: 0.78 });   // откреночные штаны
  const vest = new THREE.MeshStandardMaterial({ color: '#ff5700', roughness: 0.65 });
  const vestTrim = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 });
  const bootMat = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.8 });
  const sailor = new THREE.Group(); heelG.add(sailor);
  const addM = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; sailor.add(m); return m; };
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  // тело — одна оболочка; голова с кепкой и очками отдельно
  const body = makeBody({ pants: '#14181f', top: '#1d2b45', vest: '#ff5700', trim: '#141414', skin: '#c99474', glove: '#1b1b1b', boot: '#1b1b1b' });
  sailor.add(body.mesh);
  let firstPerson = false;
  const headG = new THREE.Group(); sailor.add(headG);
  const addH = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); headG.add(m); return m; };
  const headM = addH(new THREE.SphereGeometry(0.102, 22, 18), skin, 0, 0, 0); headM.scale.set(1, 1.1, 0.94); headM.castShadow = true;
  addH(new THREE.SphereGeometry(0.02, 8, 6), skin, 0.1, -0.012, 0);                                                    // нос
  for (const s of [-1, 1]) addH(new THREE.SphereGeometry(0.022, 8, 6), skin, 0.0, 0.0, s * 0.097);                     // уши
  const capDome = addH(new THREE.SphereGeometry(0.108, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat, 0, 0.028, 0); capDome.scale.set(1, 0.92, 0.96);
  const visor = addH(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 20, 1, false, 0, Math.PI), capMat, 0.055, 0.034, 0); visor.scale.set(1, 1, 0.9);
  addH(new THREE.BoxGeometry(0.03, 0.036, 0.172), new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 0.25, metalness: 0.5 }), 0.086, 0.012, 0);   // очки
  const handSheet = rope(heelG, matRope, 0.008, 2);
  const handPts = [new THREE.Vector3(), new THREE.Vector3()], handSag = [0];
  // статичные детали — в один меш на материал
  mergeStatic(heelG); mergeStatic(rig); mergeStatic(rudderPivot); mergeStatic(headG);

  // ---------- обновление ----------
  let flutterPhase = 0;
  const sheetState = { slack: 0, ease: 0 };
  const P = {
    hip: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), neck: new THREE.Vector3(0, 1, 0), aim: new THREE.Vector3(), shoulder: new THREE.Vector3(), headP: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(),
    elbowA: new THREE.Vector3(), handA: new THREE.Vector3(), elbowB: new THREE.Vector3(), handB: new THREE.Vector3(), tmp: new THREE.Vector3(),
  };

  function updateSail(out, dt, state) {
    const side = state.sailSide, aoa = out.aoa;
    // полное заполаскивание (шкот перетравлен) — полощет весь парус, сильнее у задней шкаторины;
    // малый угол атаки — «пузырь» у передней шкаторины (парус заполаскивает спереди)
    const full = out.luffing ? 1 : 0;
    const partial = out.luffing ? 0 : Math.max(0, 1 - aoa / 7);
    flutterPhase += dt * (6 + out.AWS * 1.2);
    const power = Math.min(1, out.q / 60);
    const camberFrac = 0.025 + 0.085 * Math.min(1, aoa / 14) * (0.4 + 0.6 * power);
    // настройки: оттяжка шкотового угла убирает пузо внизу, каннингхэм уплощает верх, оттяжка гика закрывает твист
    const tr = out.trim || state.trim, boomMag = Math.min(90, Math.abs(state.boom));
    const sheetPull = state.taut * THREE.MathUtils.clamp(1 - (boomMag - 8) / 25, 0, 1) * Math.min(1, out.Fmag / 150);
    const bendTo = 0.03 + 0.13 * Math.max(tr.vang, sheetPull) + 0.05 * tr.cunn;
    mastBend += (bendTo - mastBend) * Math.min(1, dt * 2);
    mastTopCap.position.x = -RAKE - mastBend; windex.position.x = -RAKE * (MAST_H + 0.04) / MAST_H - mastBend;
    const lowK = (0.55 + 0.9 * (1 - tr.out)) * (1 - 0.8 * mastBend), topK = (1 - 0.35 * tr.cunn) * (1 - 1.4 * mastBend);
    const twist = (out.twist || 0) * DEG * 1.15;
    const pa = sailPos;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const kf = (i * (NV + 1) + j) * 3;
        const x = sailFlat[kf], y = sailFlat[kf + 1], chord = sailFlat[kf + 2], shape = sailShape[i];
        let z = -side * camberFrac * chord * shape * (1 - 0.35 * v) * (lowK + (topK - lowK) * v);
        z += -side * Math.sin(twist * v) * chord * u * 0.35 * power;
        if (full > 0) {
          const fl = 0.12 * Math.sin(flutterPhase * 1.3 + u * 7 + v * 3) * (0.25 + 0.75 * u) * (0.4 + 0.6 * (1 - v * 0.5));
          z = z * 0.2 + fl * Math.min(1, out.AWS / 3);
        } else if (partial > 0) {
          const bubble = partial * 0.07 * Math.sin(flutterPhase * 1.7 + v * 4) * Math.exp(-u * 5) * (1 - 0.3 * v);
          z += side * bubble * Math.min(1, out.AWS / 3);
        }
        const k = (i * (NV + 1) + j) * 3;
        // изгиб мачты уносит назад переднюю шкаторину; чем дальше точка от мачты по хорде, тем меньше её сдвигает.
        // Считать надо в метрах, а не в долях хорды: у топа хорда сходит на нет, и весь парус там идёт вместе с мачтой.
        const wB = Math.max(0, 1 - u * chord / 2.7);
        pa[k] = x - bendAt(v) * wB * wB; pa[k + 1] = y; pa[k + 2] = z;
      }
    }
    sailGeo.attributes.position.needsUpdate = true;
    sailGeo.computeVertexNormals();
    for (let q = 0; q < LEECH_N; q++) { const k = (NU * (NV + 1) + q * 4) * 3; leechPts[q].set(pa[k], pa[k + 1], pa[k + 2]); }
    leechRope(leechPts);
    // хвост кармана мачты смотрит туда, куда уходит парус у передней шкаторины
    updateSleeve((v) => { const j = Math.round(v * NV), k0 = j * 3, k2 = (2 * (NV + 1) + j) * 3; return Math.atan2(pa[k2 + 2] - pa[k0 + 2], -(pa[k2] - pa[k0])); });
    // колдунчики: наветренный дёргается вверх при малом угле атаки, подветренный обвисает при срыве
    for (const t of telltales) {
      const i = Math.round(t.u * NU), j = Math.round(t.v * NV), k = (i * (NV + 1) + j) * 3;
      const base = t.pts[0].set(pa[k], pa[k + 1], pa[k + 2] + t.sgn * 0.025);
      const windward = t.sgn === side;              // ветер приходит со стороны side (+z = правый борт)
      const stream = windward ? (aoa >= 8 && !out.luffing ? 1 : 0) : (aoa <= 26 && !out.luffing ? 1 : 0);
      const wig = Math.sin(flutterPhase * 2.2 + t.phase);
      const len = 0.28; // вдоль хорды назад (−x)
      const lift = windward ? (1 - stream) * (0.6 + 0.4 * wig) : 0;          // наветренный поднимается
      const droop = !windward ? (1 - stream) * (0.5 + 0.3 * wig) : 0;       // подветренный обвисает
      t.pts[1].set(base.x - len * 0.5, base.y + len * 0.5 * (lift - droop) + 0.02 * wig * stream, base.z + t.sgn * 0.02 * stream * wig);
      t.pts[2].set(base.x - len * (0.3 + 0.7 * stream), base.y + len * (lift * 0.9 - droop * 0.9) + 0.03 * wig * stream, base.z + t.sgn * 0.04 * stream * Math.sin(flutterPhase * 2.2 + t.phase + 1));
      t.draw(t.pts);
    }
  }

  // ---------- техника матроса ----------
  // Поза зависит от курса, силы ветра, крена и манёвра:
  //  • лавировка в слабый ветер — сидит ближе к центру (в штиль даже под ветром, чтобы накренить лодку и наполнить парус)
  //  • лавировка в свежий ветер — откренивает: таз на планшире, ноги прямые под ремнём, корпус почти горизонтально
  //  • галфвинд/бакштаг — сидит на наветренном борту, при глиссировании смещается в корму
  //  • фордевинд — сидит у центра, корпус прямо, держит шкот у гика для быстрой реакции
  //  • оверштаг/фордевинд — переходит через лодку пригнувшись под гиком, меняя руки
  const SS = { y: -0.5, x: -0.35, theta: 0.4, crouch: 0, sgn: 0, flip: 0, swap: 1, duck: 0 };
  // временные векторы кадра: берутся из пула, память в кадре не выделяется
  const pool = []; let poolI = 0;
  const tv = () => pool[poolI++] || (pool[poolI - 1] = new THREE.Vector3());
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _xAxis = new THREE.Vector3(1, 0, 0);
  const THIGH = 0.44, SHIN = 0.43, ARM1 = 0.30, ARM2 = 0.28, EXT_LEN = 1.05;
  function updateSailor(state, dt, out) {
    // Матрос сидит там, где его держит физика: state.crewY — положение его центра тяжести поперёк лодки.
    const k = Math.min(1, dt * 3);
    const twa = out ? out.twaAbs : 90, spd = state.vf;
    const ay = Math.abs(state.crewY), hike = Math.min(1, Math.max(0, (ay - 0.45) / 0.6));
    const planing = Math.min(1, Math.max(0, (spd - 2.4) / 1.5));
    const tx = twa < 95 ? -0.2 - 0.25 * hike : twa < 150 ? -0.4 - 0.4 * planing : -0.3 - 0.3 * planing;   // на попутных и в глиссировании — в корму
    // таз: до 0.45 м матрос сидит внутри лодки, дальше — на борту и вывешивается корпусом
    // Матрос всегда сидит на борту: в слабый ветер на внутренней кромке, ноги в кокпите, корпус наклонён внутрь;
    // чем свежее, тем дальше наружу. По центру он оказывается только на миг, когда переходит на другой борт.
    const edge = cockpitHalfWidth(SS.x) + 0.03;
    const seat = Math.max(edge, 0.46 + 0.22 * hike);
    const ttheta = ay <= 0.45 ? -0.30 + 0.68 * (ay / 0.45) : 0.38 + 1.07 * hike;
    // борт: наветренный, пока физика не посадила матроса явно на другой; смена борта с короткой задержкой, без дёрганья
    // с запасом в обе стороны: около нуля матрос не мечется между бортами
    let wantSide = SS.sgn || state.side || 1;
    if (ay > 0.18) wantSide = Math.sign(state.crewY); else if (ay < 0.06) wantSide = state.side || wantSide;
    if (!SS.sgn) SS.sgn = wantSide;
    if (wantSide !== SS.sgn) { SS.flip += dt; if (SS.flip > 0.3) { SS.sgn = wantSide; SS.flip = 0; SS.swap = 0; } } else SS.flip = 0;
    SS.x += (tx - SS.x) * k; SS.theta += (ttheta - SS.theta) * Math.min(1, dt * 8);
    const dyS = (SS.sgn * seat - SS.y) * Math.min(1, dt * 14), maxS = 1.7 * dt;   // переход на другой борт занимает около полсекунды
    SS.y += Math.max(-maxS, Math.min(maxS, dyS));
    const sv = THREE.MathUtils.clamp(SS.y / (edge * 0.85), -1, 1);  // на каком борту сидит; при переходе плавно проходит через ноль
    SS.crouch += ((1 - Math.abs(sv)) - SS.crouch) * Math.min(1, dt * 12);
    const h = Math.min(1, Math.max(0, (SS.theta - 0.38) / 1.07)); // степень откренивания 0..1
    const dy = deckAt(SS.x);
    const lateral = SS.y;
    const crouch = SS.crouch;
    // Переход на другой борт: матрос разворачивается лицом к носу, пригибается под гик и проходит через кокпит
    // на согнутых ногах, колени в стороны. Рука с удлинителем румпеля остаётся позади, со стороны старого борта.
    P.hip.set(SS.x, dy + 0.07 - 0.03 * crouch, lateral);
    const theta = SS.theta * (1 - crouch) + 0.1 * crouch;
    const dir = P.tmp.set(-0.06 + 1.5 * crouch, Math.cos(theta), sv * Math.sin(theta)).normalize();
    // Гик идёт на высоте головы сидящего матроса. Когда он проходит над матросом (поворот, полощущий парус),
    // матрос пригибается: наклоняет корпус вперёд ровно настолько, чтобы голова прошла под гиком.
    {
      const boomY = mastBase.y + BOOM_H - 0.05, headTop = P.hip.y + 0.655 * dir.y + 0.15;
      let near = 0;
      for (const ahead of [0, 0.22]) {                       // сейчас и с упреждением: гик летит быстро
        const b = (state.boom + state.boomRate / DEG * ahead) * DEG, cb = Math.cos(b);
        const along = (mastBase.x - (P.hip.x + 0.25)) / Math.max(0.2, cb);      // где гик проходит над головой
        if (cb > 0.15 && along > 0.15 && along < BOOM_L + 0.1) {
          const dz = Math.abs(P.hip.z + dir.z * 0.6 - along * Math.sin(b));
          near = Math.max(near, 1 - THREE.MathUtils.smoothstep(dz, 0.24, 0.55));
        }
      }
      const need = Math.max(0, Math.min(0.45, headTop - boomY)) * near;
      SS.duck += (need - SS.duck) * Math.min(1, dt * (need > SS.duck ? 16 : 5));
      if (SS.duck > 0.005) {
        // наклон вперёд на угол, при котором голова опускается на нужную высоту
        const c = Math.max(0.25, 1 - SS.duck / (0.655 * Math.max(0.3, dir.y)));
        dir.x += Math.tan(Math.acos(c)) * dir.y; dir.normalize();
      }
    }
    const duckK = Math.min(1, SS.duck / 0.12);
    P.shoulder.copy(P.hip).addScaledVector(dir, 0.46);
    // Шея: когда корпус лежит за бортом или наклонён вперёд при переходе, голова не продолжает линию спины,
    // а поднята: матрос смотрит вперёд, на нос и парус.
    const lift = Math.max(h * (1 - crouch), crouch) * (1 - 0.8 * duckK);        // пригнувшись, голову не задирает
    const neck = P.neck.copy(dir); neck.x += (0.2 * h - 0.25 * crouch) * lift; neck.y += 0.85 * lift; neck.z -= sv * 0.3 * h * (1 - crouch); neck.normalize();
    P.headP.copy(P.hip).addScaledVector(dir, NECK_T).addScaledVector(neck, 0.655 - NECK_T); P.headP.x += 0.03; P.headP.z -= sv * 0.03 * (1 - h);
    // Линия плеч: сидя — вдоль лодки, при переходе — поперёк. Матрос поворачивается лицом к носу: плечо руки,
    // державшей румпель, идёт к новому борту. За серединой лодки эта рука уже считается передней.
    const before = SS.y * SS.sgn < 0, cAx = 1 - Math.abs(sv);
    const ax = P.ax.set(1 - cAx, 0, (before ? -1 : 1) * cAx * SS.sgn).normalize();
    body.begin();
    body.torso(P.hip, dir, ax, firstPerson, neck);
    // голова смотрит вперёд, при откренивании чуть выше, на парус
    headG.position.copy(P.headP);
    headG.rotation.set(0, sv * 0.35 * (1 - h * 0.4), 0.1 + 0.14 * h);
    // плечи
    const shA = tv().copy(P.shoulder).addScaledVector(ax, -0.165); shA.y -= 0.02; shA.z += sv * 0.02;      // заднее
    const shB = tv().copy(P.shoulder).addScaledVector(ax, 0.165); shB.y -= 0.02; shB.z += sv * 0.02;       // переднее
    // ноги: двухзвенная кинематика. Стопы под ремнём откренивания, колено сгибается вверх;
    // чем дальше матрос вывешивается, тем прямее ноги.
    const toeA = 0.5 * (1 - crouch), toeS = sv >= 0 ? -1 : 1;   // носок вверх и к середине лодки, под ремень
    const half = cockpitHalfWidth(SS.x) - 0.1;
    for (const off of [0.12, -0.12]) {
      const leg = Math.sign(off) * (before ? -1 : 1) * SS.sgn;    // при переходе ноги расставлены поперёк: каждая со своей стороны таза
      const poleLeg = tv().set(0.6 * crouch, 1 - 0.45 * crouch, sv * 0.25 * (1 - crouch) + leg * 1.1 * crouch);
      const hipJ = tv().copy(P.hip).addScaledVector(ax, off * 0.85); hipJ.y -= 0.03; hipJ.z -= sv * 0.07;
      const ftZ = THREE.MathUtils.clamp(lateral - sv * 0.62, -0.13, 0.13) - sv * 0.02 * (1 - crouch);
      const ft = tv().set(SS.x + off * 1.25 * (1 - crouch) + 0.05 + 0.08 * crouch, floorY + 0.075, ftZ * (1 - crouch) + THREE.MathUtils.clamp(lateral + leg * 0.3, -half, half) * crouch);
      clampReach(hipJ, ft, THIGH + SHIN - 0.015);
      solveElbow(hipJ, ft, THIGH, SHIN, poleLeg, P.knee);
      // колено не ниже палубы: бедро лежит на борту
      const deckK = deckAt(P.knee.x) + (cockpitSDF(P.knee.x, P.knee.z) < 0 ? -COCKPIT.depth : 0) + 0.085;
      if (P.knee.y < deckK) P.knee.y = deckK;
      const toe = tv().set(ft.x + 0.19 * crouch, ft.y + Math.sin(toeA) * 0.19 * (1 - crouch), ft.z + toeS * Math.cos(toeA) * 0.19 * (1 - crouch));
      body.limb(hipJ, P.knee, ft, toe, LEG_SPEC, poleLeg);
    }
    // руки: кисть не дальше вытянутой руки
    const REACH = ARM1 + ARM2 - 0.02;
    const run = twa >= 150;
    const sm = (e0, e1, x) => { const q = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
    const pivotHull = heelG.worldToLocal(extPivot.getWorldPosition(tv()));
    // Обычный хват: задняя рука держит удлинитель румпеля перед собой, у живота, удлинитель идёт наискось перед корпусом.
    const fn = Math.sin(theta), fc = Math.cos(theta);            // «перед» корпуса: сидя — к середине лодки, вися за бортом — вверх
    const frontT = tv().copy(P.hip).addScaledVector(dir, 0.2);
    frontT.x -= 0.16; frontT.y += 0.2 * Math.max(0, fn) + 0.04; frontT.z -= sv * 0.29 * fc;
    // передняя рука: шкот; на фордевинде — участок шкота от блока к гику
    const sheetN = tv();
    if (run) { const bm = tv().copy(boomBlockMid).applyAxisAngle(Y, rig.rotation.y).add(mastBase); sheetN.copy(blockTop).lerp(bm, 0.3); }
    else sheetN.set(SS.x + 0.35, dy + 0.36 - 0.1 * h, lateral - sv * 0.05 + sv * 0.1 * h);
    // При переходе: удлинитель за спиной, со стороны нового борта; шкот в другой руке впереди.
    const crossT = tv().set(SS.x - 0.28, P.hip.y + 0.2, lateral + SS.sgn * 0.25);
    const crossS = tv().set(SS.x + 0.35, dy + 0.3, lateral - SS.sgn * 0.15);
    // Сев на новый борт, матрос ещё держит удлинитель за спиной передней рукой, а шкот — задней перед собой.
    const behind = tv().set(SS.x + 0.02, P.hip.y + 0.15, lateral + sv * 0.25).lerp(crossT, cAx);
    const sheetA = tv().set(SS.x - 0.02, dy + 0.34, lateral - sv * 0.24).lerp(crossS, cAx);
    // Перехват: задняя рука со шкотом тянется за спину и берёт удлинитель, передняя отпускает его и забирает шкот,
    // затем задняя рука проносит удлинитель над плечом вперёд.
    if (!before && SS.swap < 1 && cAx < 0.25) SS.swap = Math.min(1, SS.swap + dt / 1.25);
    const sw = before ? 1 : SS.swap;
    const aim = P.aim, sheetEnd = tv();
    let holdA = true, poleBack = 0;
    if (before) {                                   // уходит со старого борта: румпель ещё в задней руке
      aim.copy(frontT).lerp(crossT, cAx); P.handB.copy(sheetN).lerp(crossS, cAx); sheetEnd.copy(P.handB);
    } else if (sw < 1) {
      const over = tv().set(SS.x - 0.36, P.hip.y + 0.78, lateral + sv * 0.08);     // над задним плечом: удлинитель встаёт торчком
      const g = sm(0.45, 1, sw), g1 = 1 - g;
      if (sw < 0.45) aim.copy(behind);
      else aim.set(g1 * g1 * behind.x + 2 * g1 * g * over.x + g * g * frontT.x, g1 * g1 * behind.y + 2 * g1 * g * over.y + g * g * frontT.y, g1 * g1 * behind.z + 2 * g1 * g * over.z + g * g * frontT.z);
      holdA = sw >= 0.34;
      sheetEnd.copy(sheetA).lerp(sheetN, sm(0.08, 0.5, sw));
      poleBack = sm(0.05, 0.3, sw) * (1 - sm(0.7, 1, sw));
    } else { aim.copy(frontT); P.handB.copy(sheetN); sheetEnd.copy(sheetN); }
    const toWant = tv().copy(aim).sub(pivotHull); const distWant = toWant.length(); toWant.normalize();
    const gripD = THREE.MathUtils.clamp(distWant, 0.35, EXT_LEN);
    const grip = tv().copy(pivotHull).addScaledVector(toWant, gripD);
    if (before || sw >= 1) P.handA.copy(grip);
    else {
      // задняя рука идёт от шкота к удлинителю (берётся чуть ближе к румпелю, чем передняя), потом ведёт его сама
      const gripAft = tv().copy(pivotHull).addScaledVector(toWant, Math.max(0.3, gripD - 0.2));
      if (holdA) P.handA.copy(gripAft).lerp(grip, sm(0.34, 0.5, sw)); else P.handA.copy(sheetA).lerp(gripAft, sm(0.08, 0.34, sw));
      P.handB.copy(grip).lerp(sheetN, sm(0.34, 0.58, sw));
    }
    clampReach(shA, P.handA, REACH); clampReach(shB, P.handB, REACH);
    // локти: обычно вниз; у руки, заведённой за спину, — наружу
    const backB = before ? 0 : (sw < 1 ? 1 - sm(0.34, 0.6, sw) : 0), outS = cAx > 0.5 ? SS.sgn : sv;
    solveElbow(shA, P.handA, ARM1, ARM2, tv().set(-1 + 0.5 * poleBack, -0.6 + 0.3 * poleBack, -sv * 0.15 * (1 - cAx) + outS * (0.9 * poleBack + (before ? 0.8 * cAx : 0))), P.elbowA);
    solveElbow(shB, P.handB, ARM1, ARM2, tv().set(0.2 + 0.1 * backB, -1 + 0.6 * backB, sv * 0.3 + outS * 0.9 * backB), P.elbowB);
    for (const [sh, el, hd] of [[shA, P.elbowA, P.handA], [shB, P.elbowB, P.handB]]) {
      const fd = tv().subVectors(hd, el).normalize();
      body.limb(sh, el, tv().copy(hd).addScaledVector(fd, -0.05), tv().copy(hd).addScaledVector(fd, 0.06), ARM_SPEC, ax, firstPerson ? 0.45 : -1);
    }
    body.end();
    // удлинитель румпеля направлен на точку хвата, длина постоянная
    const local = rudderPivot.worldToLocal(heelG.localToWorld(tv().copy(pivotHull).addScaledVector(toWant, EXT_LEN)));
    const d = local.sub(extPivot.position);
    extPivot.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    extension.scale.y = EXT_LEN / 1.1; extension.position.x = EXT_LEN / 2; extGrip.position.x = EXT_LEN - 0.1;

    // шкот от блока в переднюю руку
    const handPt = handPts[1].copy(sheetEnd); handPt.y -= 0.03; handPts[0].copy(blockTop);
    const midY = (blockTop.y + handPt.y) / 2;
    const wantSag = run ? 0.02 : 0.03 + 0.1 * sheetState.ease + 0.12 * sheetState.slack;
    const sag = Math.min(wantSag, midY - (floorY + 0.05));
    handSag[0] = Math.max(0, sag); handSheet(handPts, handSag);
  }

  // качка на волнах: сглаженные высота и уклоны воды под корпусом
  const sea = { heave: 0, sf: 0, ss: 0 };
  function update(state, out, ctl, dt, t, env = null) {
    poolI = 0;
    out.side = state.side;
    root.position.set(state.x, 0, state.z);
    root.rotation.y = Math.PI / 2 - state.heading * DEG;
    // Лодка идёт по волнам: высота и уклоны воды берутся из той же формулы, что рисует море.
    // Короткая рябь (короче корпуса) на качку не влияет.
    if (env) {
      const fx = out.fx, fz = out.fz, sx = out.sx, sz = out.sz, x = state.x, z = state.z, ML = 3.5;
      const hB = env.heightAt(x + fx * 1.7, z + fz * 1.7, ML), hS = env.heightAt(x - fx * 1.7, z - fz * 1.7, ML);
      const hR = env.heightAt(x + sx * 0.5, z + sz * 0.5, ML), hL = env.heightAt(x - sx * 0.5, z - sz * 0.5, ML), hC = env.heightAt(x, z, ML);
      const kk = Math.min(1, dt * 7);
      sea.heave += ((hB + hS + hR + hL + 2 * hC) / 6 - sea.heave) * kk;
      sea.sf += ((hB - hS) / 3.4 - sea.sf) * kk; sea.ss += ((hR - hL) / 1.0 - sea.ss) * kk;
      env.setBoatPlane(fx, fz, sea.heave, sea.sf, sea.ss, 1);
      env.setBoatWash(out.capsized ? 0 : THREE.MathUtils.clamp((Math.abs(state.vf) - 0.4) / 3.2, 0, 1));
    }
    heelG.rotation.x = -state.heel * DEG - Math.atan(sea.ss) * 0.55;
    heelG.rotation.z = Math.atan(sea.sf) - Math.min(2.5, state.vf * 0.9) * DEG;   // на ходу лёгкий дифферент на корму
    heelG.position.y = sea.heave;

    rig.rotation.y = state.boom * DEG; // boom>0 → гик по правому борту (+z): локальная −x при повороте на +θ уходит в +z
    windex.rotation.y = -out.AWA * DEG - rig.rotation.y; // указывает, откуда вымпельный ветер (в системе корпуса)
    updateSail(out, dt, state);

    // гика-шкот: блок на погоне → блок на ноке гика → обратно на погон (тали 2:1) → вдоль гика к среднему блоку → блок в кокпите
    const rot = rig.rotation.y;
    sheetPts[0].set(travP.x, travP.y + 0.03, travP.z + 0.02);
    sheetPts[1].copy(boomBlockEnd).applyAxisAngle(Y, rot).add(mastBase);
    sheetPts[2].set(travP.x, travP.y + 0.03, travP.z - 0.02);
    sheetPts[3].copy(boomBlockEnd); sheetPts[3].x += 0.09; sheetPts[3].applyAxisAngle(Y, rot).add(mastBase);
    sheetPts[4].copy(boomBlockMid).applyAxisAngle(Y, rot).add(mastBase);
    sheetPts[5].copy(blockTop);
    // натяжение: гик упирается в ограничитель шкота и парус тянет → шкот натянут; иначе провисает
    const load = state.taut * THREE.MathUtils.clamp(out.Fmag / 90, 0, 1);
    const slack = 1 - load;
    sheetState.slack += (slack - sheetState.slack) * Math.min(1, dt * 3);
    const sl = sheetState.slack;
    sheetSags[0] = sheetSags[1] = 0.01 + 0.14 * sl; sheetSags[2] = 0.02 + 0.16 * sl; sheetSags[3] = 0.02 + 0.22 * sl; sheetSags[4] = 0;
    sheetRope(sheetPts, sheetSags);

    rudderPivot.rotation.y = state.rudder * DEG;
    board.position.y = trunkTop + 0.28 - 0.725 + 0.725 + (1 - state.board) * 0.6; boardTop.position.y = trunkTop + 0.29 + (1 - state.board) * 0.6; handle.position.y = trunkTop + 0.34 + (1 - state.board) * 0.6;
    sheetState.ease += (out.sheet / 90 - sheetState.ease) * Math.min(1, dt * 3);
    sailor.visible = sailorEnabled && !out.capsized; handSheet.mesh.visible = sailor.visible;
    if (sailor.visible) updateSailor(state, api.holdPose ? 0 : dt, out);
  }

  let sailorEnabled = true;
  const headWorld = (v) => headG.getWorldPosition(v);
  // вид из глаз: голова и корпус матроса скрыты, руки и ноги остаются в кадре
  const setHead = (v) => { headG.visible = v; firstPerson = !v; };
  const api = { holdPose: false, pose: SS, root, heelG, rig, sea, headWorld, setHead, update, setSailor: (v) => { sailorEnabled = v; sailor.visible = v; handSheet.mesh.visible = v; }, MAST_H, BOOM_H };
  return api;
}
