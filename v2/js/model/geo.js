// Геометрия лодки: обводы корпуса, палуба с кокпитом, шверт и руль, канаты.
// Всё считается в осях лодки: x вперёд к носу, y вверх, z к правому борту; ноль по высоте — ватерлиния.
// Наружу отдаются массивы вершин, от графического движка модуль не зависит.
import { V3, clamp, smoothstep, catmull } from '../vec.js';

// ---------- размеры ----------
// Лазер (ILCA 7): длина 4,23 м, ширина 1,37 м, парус 7,06 м²: передняя шкаторина 5,13, нижняя 2,74, задняя 5,57 м.
export const HULL = { xStern: -2.10, xBow: 2.13, mastX: 1.12, beam: 1.37 };
export const RIG = {
  MAST_H: 5.74,        // топ мачты над палубой
  RAKE: 0.30,          // на сколько топ отнесён в корму
  BOOM_H: 0.50,        // вертлюг гика над палубой
  BOOM_L: 2.84,        // длина гика
  CLEW: 2.70,          // шкотовый угол от мачты при набитой оттяжке
  LUFF0: 0.535,        // галсовый угол над палубой
  HEAD: 5.665,         // фаловый угол над палубой
};
export const COCKPIT = { xFront: 0.14, xBack: -1.16, wFront: 0.98, wBack: 0.80, depth: 0.21, r: 0.2 };
export const TRUNK_X = 0.45;       // шверт стоит сразу перед кокпитом

// шпангоуты: x, полуширина по планширю, высота планширя, высота киля, полнота днища
const STATIONS = [
  [-2.10, 0.548, 0.270, 0.060, 0.70],
  [-1.80, 0.617, 0.278, -0.045, 0.62],
  [-1.40, 0.662, 0.288, -0.120, 0.56],
  [-0.90, 0.685, 0.300, -0.150, 0.55],
  [-0.30, 0.685, 0.315, -0.160, 0.57],
  [0.30, 0.666, 0.335, -0.152, 0.63],
  [0.90, 0.609, 0.365, -0.122, 0.82],
  [1.40, 0.498, 0.405, -0.062, 1.20],
  [1.80, 0.330, 0.448, 0.030, 1.65],
  [2.05, 0.148, 0.485, 0.175, 2.10],
  [2.13, 0.000, 0.505, 0.420, 2.40],
];
const COL = [0, 1, 2, 3, 4].map((c) => STATIONS.map((s) => s[c]));
export function stationAt(u) {
  return { x: catmull(COL[0], u), hw: Math.max(0, catmull(COL[1], u)), sheer: catmull(COL[2], u), keel: catmull(COL[3], u), flat: Math.max(0.3, catmull(COL[4], u)) };
}
export function stationAtX(x) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (catmull(COL[0], m) < x) lo = m; else hi = m; }
  return stationAt((lo + hi) / 2);
}
const crownAt = (x) => 0.03 + 0.03 * smoothstep(x, 0.5, 1.6);     // погибь палубы; в носу выше
export const deckAt = (x) => { const s = stationAtX(x); return s.sheer + crownAt(x); };   // высота палубы по оси лодки
function sectionPoint(st, t, out) {
  const th = t * Math.PI / 2, c = Math.pow(Math.max(0, Math.cos(th)), st.flat);
  return out.set(st.x, st.sheer - (st.sheer - st.keel) * c, st.hw * Math.sin(th));
}
export function cockpitHalfWidth(x) {
  const t = clamp((COCKPIT.xFront - x) / (COCKPIT.xFront - COCKPIT.xBack), 0, 1);
  return (COCKPIT.wFront + (COCKPIT.wBack - COCKPIT.wFront) * t) / 2;
}
// расстояние до края кокпита: отрицательное внутри; углы скруглены
export function cockpitSDF(x, z) {
  const cx = (COCKPIT.xFront + COCKPIT.xBack) / 2, hx = (COCKPIT.xFront - COCKPIT.xBack) / 2, hz = cockpitHalfWidth(x), r = COCKPIT.r;
  const qx = Math.abs(x - cx) - (hx - r), qz = Math.abs(z) - (hz - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
export const FLOOR_Y = deckAt(-0.2) - COCKPIT.depth + 0.01;

// ---------- корпус ----------
export function buildHull() {
  const NX = 96, NT = 40, row = NT + 1, p = new V3();
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NT; j++) { sectionPoint(st, -1 + 2 * j / NT, p); pos.push(p.x, p.y, p.z); uv.push(i / NX, j / NT); }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) { const a = i * row + j, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
  // транец: свои вершины, чтобы грань была плоской с чёткой кромкой; верх повторяет погибь палубы
  const st0 = stationAt(0), ring0 = pos.length / 3;
  for (let j = 0; j <= NT; j++) { pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); uv.push(0.001, 0.5); }
  const NC = 12;
  for (let q = 1; q < NC; q++) { const t = 1 - 2 * q / NC; pos.push(st0.x, st0.sheer + crownAt(st0.x) * (1 - t * t), st0.hw * t); uv.push(0.001, 0.5); }
  const center = pos.length / 3, nRing = NT + NC;
  pos.push(st0.x, (st0.sheer + st0.keel) / 2, 0); uv.push(0.001, 0.5);
  for (let j = 0; j < nRing; j++) idx.push(center, ring0 + j, ring0 + (j + 1) % nRing);
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

// ---------- палуба с кокпитом ----------
export function buildDeck() {
  const NX = 190, NZ = 60, row = NZ + 1;
  const pos = [], col = [], uv = [], idx = [];
  const cDeck = [0.80, 0.82, 0.84], cGrip = [0.56, 0.60, 0.65], cPit = [0.50, 0.54, 0.59], cWall = [0.68, 0.71, 0.75];
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX), crown = crownAt(st.x);
    for (let j = 0; j <= NZ; j++) {
      const t = -1 + 2 * j / NZ, z = st.hw * t * 0.996;
      let y = st.sheer + crown * (1 - t * t), c = cDeck;
      const d = cockpitSDF(st.x, z);
      if (d < 0) {
        // стенки кокпита с плавным сопряжением и плоский пол
        const wall = smoothstep(-d, 0, 0.055);
        y = st.sheer + crown * (1 - t * t) * (1 - wall) + (0.01 - COCKPIT.depth) * wall;
        c = wall > 0.92 ? cPit : cWall;
      } else if (d > 0.03 && Math.abs(z) > st.hw * 0.55 && st.x < 0.35 && st.x > -1.35) c = cGrip;   // противоскользящие боковые палубы
      pos.push(st.x, y, z); col.push(c[0], c[1], c[2], 1); uv.push(st.x * 3, z * 3);
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = i * row + j, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c); }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

// кромка палубы по кругу: по ней идёт буртик
export function gunwalePath() {
  const pts = [], N = 80;
  for (let i = 0; i <= N; i++) { const st = stationAt(i / N); pts.push(new V3(st.x, st.sheer + 0.006, st.hw)); }
  for (let i = N - 1; i >= 0; i--) { const st = stationAt(i / N); pts.push(new V3(st.x, st.sheer + 0.006, -st.hw)); }
  const s0 = stationAt(0);
  for (const t of [-0.97, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 0.97]) pts.push(new V3(s0.x, s0.sheer + 0.006 + crownAt(s0.x) * (1 - t * t), s0.hw * t));
  pts.push(pts[0].clone());
  return pts;
}

// ---------- шверт и руль ----------
// Перо с крыловым профилем: верх в начале координат, перо уходит вниз, задняя кромка в сторону −x.
export function buildFoil(chordTop, chordTip, span, sweep, thick = 0.09) {
  const NS = 22, NP = 9, pos = [], idx = [];
  const yt = (x) => 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  const ring = 2 * NP;
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, tip = Math.max(0, (s - 0.86) / 0.14);
    const chord = (chordTop + (chordTip - chordTop) * s) * Math.sqrt(Math.max(0.02, 1 - tip * tip * 0.96));
    const le = -sweep * s - (chordTop + (chordTip - chordTop) * s - chord) * 0.35;      // к законцовке хорда сходится
    for (let k = 0; k < ring; k++) {
      const a = k < NP ? k / NP : (ring - k) / NP, side = k < NP ? 1 : -1;               // от носика к хвосту и обратно
      const xc = a * a;                                                                    // у носика точки чаще
      pos.push(le - chord * xc, -span * s, side * yt(xc) * chord);
    }
  }
  for (let i = 0; i < NS; i++) for (let k = 0; k < ring; k++) { const a = i * ring + k, b = i * ring + (k + 1) % ring, c = a + ring, d = b + ring; idx.push(a, b, c, b, d, c); }
  const top = pos.length / 3; pos.push(-chordTop * 0.4, 0, 0);
  for (let k = 0; k < ring; k++) idx.push(top, (k + 1) % ring, k);
  const bot = pos.length / 3; pos.push(-sweep - chordTip * 0.4, -span, 0);
  for (let k = 0; k < ring; k++) idx.push(bot, NS * ring + k, NS * ring + (k + 1) % ring);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// ---------- трубка по точкам: канаты, буртик, карман мачты ----------
// Число вершин постоянно: точки можно менять каждый кадр без пересоздания сетки.
export function makeTube(nRings, sides = 6, closed = false) {
  const positions = new Float32Array(nRings * sides * 3), idx = [];
  const segs = closed ? nRings : nRings - 1;
  for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides, c = ((i + 1) % nRings) * sides + j, d = ((i + 1) % nRings) * sides + (j + 1) % sides;
    idx.push(a, b, c, b, d, c);
  }
  const T = new V3(), N = new V3(), Bn = new V3(), cs = [], sn = [];
  for (let j = 0; j < sides; j++) { cs.push(Math.cos(j / sides * Math.PI * 2)); sn.push(Math.sin(j / sides * Math.PI * 2)); }
  // pts — массив V3 длиной nRings; radius — число или функция от номера кольца
  function set(pts, radius) {
    N.set(0, 0, 0);
    for (let i = 0; i < nRings; i++) {
      const a = pts[closed ? (i + nRings - 1) % nRings : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % nRings : Math.min(nRings - 1, i + 1)];
      T.subVectors(b, a); if (T.lengthSq() < 1e-12) T.set(1, 0, 0); T.normalize();
      // нормаль переносится с прошлого кольца: трубка не закручивается
      if (i === 0) { N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0); }
      N.addScaledVector(T, -N.dot(T)); if (N.lengthSq() < 1e-10) N.set(T.y, -T.x, 0); N.normalize();
      Bn.crossVectors(T, N);
      const r = typeof radius === 'function' ? radius(i) : radius, p = pts[i];
      let o = i * sides * 3;
      for (let j = 0; j < sides; j++, o += 3) {
        positions[o] = p.x + (N.x * cs[j] + Bn.x * sn[j]) * r; positions[o + 1] = p.y + (N.y * cs[j] + Bn.y * sn[j]) * r; positions[o + 2] = p.z + (N.z * cs[j] + Bn.z * sn[j]) * r;
      }
    }
  }
  return { positions, indices: new Uint32Array(idx), set, nRings };
}
// Канат через опорные точки с провисом на каждом пролёте: sags[i] — стрела провиса пролёта i в метрах.
export function makeRope(nCtrl, seg = 6, sides = 6) {
  const n = (nCtrl - 1) * seg + 1, tube = makeTube(n, sides), pts = [];
  for (let i = 0; i < n; i++) pts.push(new V3());
  function set(ctrl, sags, radius) {
    for (let s = 0; s < nCtrl - 1; s++) {
      const a = ctrl[s], b = ctrl[s + 1], sag = sags ? sags[s] || 0 : 0;
      for (let k = 0; k < seg; k++) { const t = k / seg, p = pts[s * seg + k]; p.copy(a).lerp(b, t); p.y -= sag * 4 * t * (1 - t); }
    }
    pts[n - 1].copy(ctrl[nCtrl - 1]);
    tube.set(pts, radius);
  }
  return { positions: tube.positions, indices: tube.indices, set, pts };
}

// Тело вращения по профилю [радиус, высота]
export function buildLathe(profile, sides = 20) {
  const pos = [], idx = [], n = profile.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < sides; j++) { const a = j / sides * Math.PI * 2; pos.push(profile[i][0] * Math.cos(a), profile[i][1], profile[i][0] * Math.sin(a)); }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides; idx.push(a, c, b, b, c, d); }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
