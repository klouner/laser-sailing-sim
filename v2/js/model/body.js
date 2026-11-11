// Фигура матроса: манекен из вылепленных сегментов. Торс и жилет — оболочки по кольцам вдоль позвоночника,
// руки и ноги — жёсткие сегменты с суставами, кисти сжаты в кулак вокруг того, что держат, ботинки с подошвой.
// Каждый сегмент один раз считается в своих осях, а каждый кадр переносится на место по суставам из расчёта позы.
// Голова, кепка и очки — отдельные неподвижные формы. От графического движка модуль не зависит.
import { V3, smoothstep } from '../vec.js';

export const THIGH = 0.44, SHIN = 0.43, ARM1 = 0.30, ARM2 = 0.28, NECK_T = 0.47;
const FORE = 0.2;                     // от локтя до запястья
const C = {
  pants: [0.05, 0.055, 0.066], pad: [0.17, 0.18, 0.2], pipe: [0.03, 0.08, 0.3], top: [0.018, 0.05, 0.14], topTrim: [0.55, 0.56, 0.58],
  vest: [0.95, 0.17, 0.012], vestDark: [0.022, 0.022, 0.026], refl: [0.6, 0.61, 0.63],
  skin: [0.58, 0.31, 0.19], glove: [0.045, 0.045, 0.052], gloveGrey: [0.2, 0.21, 0.23],
  boot: [0.02, 0.02, 0.023], sole: [0.42, 0.42, 0.42], hair: [0.05, 0.034, 0.024], lips: [0.44, 0.17, 0.13], cap: [0.86, 0.86, 0.86], capBlue: [0.0, 0.07, 0.6],
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const TAU = Math.PI * 2;
// сечение: суперэллипс со своей глубиной спереди и сзади; угол 0 — вбок (+x), четверть оборота — вперёд (+z)
const sec = (rx, rzF, rzB = rzF, n = 2) => (a) => {
  const c = Math.cos(a), s = Math.sin(a), e = 2 / n;
  return [rx * Math.sign(c) * Math.pow(Math.abs(c), e), (s > 0 ? rzF : rzB) * Math.sign(s) * Math.pow(Math.abs(s), e)];
};
const round = (r) => sec(r, r, r, 2);

export function makeBody() {
  const tx = [], ty = [], tz = [], col = [], idx = [];
  const nV = () => tx.length;
  // Оболочка по опорным кольцам: { y, s: сечение, c: цвет или функция от угла и высоты }.
  // Между опорными кольцами вставляются промежуточные по плавной кривой, торцы скругляются;
  // пара колец ближе 12 мм остаётся как есть: так задаются резкие границы цвета и ступеньки.
  function loft(rings, S, sub = 3) {
    const v0 = nV(), ev = rings.map((r) => { const q = []; for (let j = 0; j < S; j++) { const p = r.s(j / S * TAU); q.push(p[0] + (r.ox || 0), p[1] + (r.oz || 0)); } return q; });
    const small = (i) => Math.abs(ev[i][0]) < 0.002, out = [];
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    for (let i = 0; i < rings.length; i++) {
      out.push({ y: rings[i].y, p: ev[i], c: rings[i].c });
      if (i === rings.length - 1) break;
      const n = rings[i + 1].y - rings[i].y > 0.012 ? sub : 1, A = ev[i], B = ev[i + 1];
      const P0 = i > 0 && !small(i - 1) && rings[i].y - rings[i - 1].y > 0.012 ? ev[i - 1] : A, P3 = i + 2 < rings.length && !small(i + 2) && rings[i + 2].y - rings[i + 1].y > 0.012 ? ev[i + 2] : B;
      for (let k = 1; k < n; k++) {
        const t = k / n, q = new Array(S * 2);
        for (let m = 0; m < S * 2; m++) {
          if (small(i)) q[m] = A[m] + (B[m] - A[m]) * Math.sqrt(1 - (1 - t) * (1 - t));
          else if (small(i + 1)) q[m] = B[m] + (A[m] - B[m]) * Math.sqrt(1 - t * t);
          else q[m] = cr(P0[m], A[m], B[m], P3[m], t);
        }
        out.push({ y: rings[i].y + (rings[i + 1].y - rings[i].y) * t, p: q, c: t < 0.5 ? rings[i].c : rings[i + 1].c });
      }
    }
    for (const r of out) for (let j = 0; j < S; j++) {
      const c = typeof r.c === 'function' ? r.c(j / S * TAU, r.y) : r.c;
      tx.push(r.p[j * 2]); ty.push(r.y); tz.push(r.p[j * 2 + 1]); col.push(c[0], c[1], c[2], 1);
    }
    for (let i = 0; i < out.length - 1; i++) for (let j = 0; j < S; j++) { const a = v0 + i * S + j, b = v0 + i * S + (j + 1) % S, c = a + S, d = b + S; idx.push(a, c, b, b, c, d); }
    loft.ys = out.map((r) => r.y);
    return v0;
  }
  // трубка вдоль ломаной в осях сегмента: pts — [[x,y,z],...], rad и цвет по номеру кольца
  function tube(pts, rad, S, colAt) {
    const v0 = nV(), T = new V3(), U = new V3(1, 0, 0), V = new V3(), a = new V3(), b = new V3();
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      T.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
      U.addScaledVector(T, -U.dot(T)); if (U.lengthSq() < 1e-8) U.set(T.y, -T.x, 0); U.normalize(); V.crossVectors(U, T);
      const r = rad(i), c = colAt(i);
      for (let j = 0; j < S; j++) { const an = j / S * TAU, cs = Math.cos(an) * r, sn = Math.sin(an) * r; tx.push(pts[i][0] + U.x * cs + V.x * sn); ty.push(pts[i][1] + U.y * cs + V.y * sn); tz.push(pts[i][2] + U.z * cs + V.z * sn); col.push(c[0], c[1], c[2], 1); }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < S; j++) { const p = v0 + i * S + j, q = v0 + i * S + (j + 1) % S, c = p + S, d = q + S; idx.push(p, c, q, q, c, d); }
    return v0;
  }
  const ball = (r, c, S = 14, k = 1) => { const rings = []; for (let i = 0; i <= 10; i++) { const t = i / 10 * Math.PI; rings.push({ y: -r * Math.cos(t) * k, s: round(Math.max(0.0006, r * Math.sin(t))), c }); } return loft(rings, S, 1); };
  const part = (build) => { const v0 = nV(); build(); return { v0, n: nV() - v0 }; };
  const tip = 0.0008;

  // ---- торс: таз, талия, грудь, плечи, шея; кольца заданы расстоянием от таза ----
  const ST = 28;
  const pantsTop = (a) => C.pants, shirt = (a) => C.top;
  const TORSO = [
    { y: -0.118, s: round(tip), c: C.pants }, { y: -0.105, s: sec(0.10, 0.075, 0.085, 2.4), c: C.pants }, { y: -0.07, s: sec(0.155, 0.105, 0.125, 2.5), c: C.pants },
    { y: -0.02, s: sec(0.174, 0.112, 0.128, 2.4), c: C.pants }, { y: 0.04, s: sec(0.170, 0.108, 0.115, 2.3), c: C.pants }, { y: 0.078, s: sec(0.158, 0.103, 0.104, 2.2), c: C.pants },
    { y: 0.082, s: sec(0.156, 0.102, 0.103, 2.2), c: C.top }, { y: 0.14, s: sec(0.150, 0.100, 0.100, 2.2), c: C.top }, { y: 0.22, s: sec(0.160, 0.112, 0.104, 2.3), c: C.top },
    { y: 0.30, s: sec(0.172, 0.126, 0.110, 2.3), c: C.top }, { y: 0.38, s: sec(0.178, 0.122, 0.112, 2.3), c: C.top }, { y: 0.428, s: sec(0.170, 0.104, 0.102, 2.2), c: C.top },
    { y: 0.462, s: sec(0.138, 0.086, 0.092, 2.1), c: C.top }, { y: 0.492, s: sec(0.098, 0.070, 0.078, 2), c: C.top }, { y: 0.512, s: sec(0.070, 0.062, 0.068, 2), c: C.top }, { y: 0.518, s: sec(0.064, 0.059, 0.065, 2), c: C.topTrim },
    { y: 0.524, s: sec(0.058, 0.056, 0.061, 2), c: C.skin }, { y: 0.555, s: sec(0.055, 0.055, 0.058, 2), c: C.skin }, { y: 0.585, s: sec(0.052, 0.052, 0.05, 2), c: C.skin }, { y: 0.60, s: round(tip), c: C.skin },
  ];
  // жилет: объёмный, с тёмными боками, молнией спереди и светоотражающей полосой
  const vestCol = (band) => (a) => { const s = Math.sin(a), c = Math.cos(a); if (Math.abs(c) > 0.86) return C.vestDark; if (s > 0.985) return C.vestDark; return band ? C.refl : C.vest; };
  const VEST = [
    { y: 0.098, s: sec(0.150, 0.100, 0.100, 2.2), c: C.vestDark }, { y: 0.104, s: sec(0.176, 0.126, 0.124, 2.6), c: C.vestDark }, { y: 0.125, s: sec(0.180, 0.132, 0.127, 2.6), c: vestCol(false) },
    { y: 0.20, s: sec(0.186, 0.142, 0.130, 2.6), c: vestCol(false) }, { y: 0.285, s: sec(0.194, 0.153, 0.134, 2.6), c: vestCol(false) }, { y: 0.288, s: sec(0.195, 0.154, 0.134, 2.6), c: vestCol(true) },
    { y: 0.312, s: sec(0.197, 0.155, 0.135, 2.6), c: vestCol(true) }, { y: 0.315, s: sec(0.197, 0.155, 0.135, 2.6), c: vestCol(false) }, { y: 0.385, s: sec(0.198, 0.148, 0.136, 2.6), c: vestCol(false) },
    { y: 0.432, s: sec(0.186, 0.124, 0.120, 2.4), c: vestCol(false) }, { y: 0.462, s: sec(0.150, 0.100, 0.104, 2.2), c: vestCol(false) }, { y: 0.488, s: sec(0.112, 0.080, 0.088, 2.1), c: C.vestDark }, { y: 0.497, s: sec(0.094, 0.068, 0.076, 2.1), c: C.vestDark },
  ];
  const torsoV = loft(TORSO, ST), torsoT = loft.ys, vestV = loft(VEST, ST), vestT = loft.ys;

  // ---- сегменты рук и ног в своих осях: y вдоль кости от верхнего сустава, z вперёд ----
  const SL = 18, limbs = [0, 1].map((i) => {
    const m = i ? -1 : 1;                         // вторая рука и нога зеркальны
    const upper = part(() => loft([
      { y: -0.035, s: round(tip), c: C.top }, { y: -0.02, s: round(0.05), c: C.top }, { y: 0.02, s: sec(0.057, 0.06), c: C.top }, { y: 0.09, s: sec(0.053, 0.057), c: C.top },
      { y: 0.17, s: sec(0.047, 0.05), c: C.top }, { y: 0.25, s: round(0.043), c: C.top }, { y: 0.30, s: round(0.041), c: C.top }, { y: 0.315, s: round(tip), c: C.top }], SL));
    const delt = part(() => ball(0.064, C.top, 14, 0.9)), elbow = part(() => ball(0.0425, C.top, 14));
    // предплечье: рукав до запястья, дальше манжета перчатки
    const fore = part(() => loft([
      { y: -0.012, s: round(tip), c: C.top }, { y: 0, s: round(0.04), c: C.top }, { y: 0.045, s: sec(0.044, 0.047), c: C.top }, { y: 0.11, s: sec(0.039, 0.042), c: C.top },
      { y: 0.163, s: sec(0.031, 0.029), c: C.top }, { y: 0.168, s: sec(0.0335, 0.031), c: C.glove }, { y: 0.19, s: sec(0.033, 0.028), c: C.glove }, { y: 0.21, s: sec(0.029, 0.021), c: C.glove }], SL));
    // кисть в перчатке: ладонь и пальцы, согнутые вокруг того, что держат; ось хвата — x, предмет проходит через (y, z) = (0.02, 0.027)
    const palmCol = (a) => mix(C.glove, C.gloveGrey, smoothstep(Math.sin(a), 0.1, 0.6));
    const hand = part(() => {
      loft([{ y: -0.078, s: sec(0.028, 0.021), c: C.glove }, { y: -0.055, s: sec(0.034, 0.019, 0.018, 2.6), c: C.glove }, { y: -0.025, s: sec(0.043, 0.017, 0.017, 2.8), c: palmCol },
        { y: 0.008, s: sec(0.046, 0.015, 0.017, 2.8), c: palmCol }, { y: 0.03, s: sec(0.044, 0.012, 0.015, 2.8), c: palmCol }, { y: 0.04, s: sec(0.036, 0.006, 0.008, 2.8), c: C.glove }, { y: 0.045, s: round(tip), c: C.glove }], 14, 2);
      const yc = 0.018, zc = 0.027, R = 0.0285, a0 = Math.atan2(0.004 - zc, 0.037 - yc);
      [-0.0345, -0.0115, 0.0115, 0.0345].forEach((x, f) => {
        const len = (f === 3 ? 3.5 : f === 0 ? 3.9 : 4.15), pts = [], n = 12, r0 = f === 3 ? 0.0088 : 0.01;
        for (let k = 0; k <= n; k++) { const al = a0 + len * k / n; pts.push([x * m, yc + R * Math.cos(al), zc + R * Math.sin(al)]); }
        // суставы пальцев чуть толще фаланг
        tube(pts, (k) => (k === n ? tip : r0 * (1 - 0.14 * k / n) * (1 + 0.1 * Math.pow(Math.cos(k / n * Math.PI * 3), 8))), 8, () => C.glove);
      });
      // большой палец ложится поверх остальных
      tube([[0.044 * m, -0.032, 0.004], [0.051 * m, -0.02, 0.012], [0.053 * m, -0.008, 0.024], [0.048 * m, 0.004, 0.038], [0.037 * m, 0.012, 0.049], [0.022 * m, 0.017, 0.056], [0.008 * m, 0.02, 0.058]], (k) => (k === 6 ? tip : 0.0122 - 0.0006 * k), 8, () => C.glove);
    });
    // гидроштаны: наколенник спереди овалом, по наружному шву кант
    const pants = (a) => (Math.abs(Math.cos(a)) > 0.985 ? C.pipe : C.pants);
    const thighCol = (a, y) => mix(pants(a), C.pad, smoothstep(Math.sin(a), 0.1, 0.5) * smoothstep(y, 0.3, 0.37));
    const kneeCol = (a) => mix(C.pants, C.pad, smoothstep(Math.sin(a), 0.1, 0.5));
    const shinCol = (a, y) => mix(pants(a), C.pad, smoothstep(Math.sin(a), 0.1, 0.5) * (1 - smoothstep(y, 0.05, 0.12)));
    const thigh = part(() => loft([
      { y: -0.06, s: round(tip), c: C.pants }, { y: -0.04, s: sec(0.066, 0.07), c: C.pants }, { y: 0.0, s: sec(0.088, 0.092), c: thighCol }, { y: 0.09, s: sec(0.088, 0.093), c: thighCol },
      { y: 0.21, s: sec(0.077, 0.081), c: thighCol }, { y: 0.32, s: sec(0.064, 0.067), c: thighCol }, { y: 0.40, s: sec(0.057, 0.061), c: thighCol }, { y: 0.44, s: sec(0.054, 0.058), c: thighCol }, { y: 0.455, s: round(tip), c: C.pad }], SL));
    const knee = part(() => ball(0.0565, kneeCol, 14));
    const shin = part(() => loft([
      { y: -0.013, s: round(tip), c: C.pad }, { y: 0, s: sec(0.054, 0.056), c: shinCol }, { y: 0.06, s: sec(0.054, 0.052, 0.058), c: shinCol },
      { y: 0.14, s: sec(0.054, 0.047, 0.064), c: shinCol }, { y: 0.25, s: sec(0.045, 0.042, 0.05), c: shinCol }, { y: 0.30, s: sec(0.041, 0.04, 0.044), c: shinCol },
      { y: 0.305, s: sec(0.044, 0.043, 0.047), c: C.boot }, { y: 0.38, s: sec(0.041, 0.041, 0.044), c: C.boot }, { y: 0.44, s: sec(0.04, 0.042, 0.046), c: C.boot }], SL));
    // ботинок: начало в голеностопе, z к носку, y вверх; подошва плоская и светлая
    const foot = part(() => {
      const v0 = nV(), S = 18, R = [[-0.074, tip, -0.04, -0.045], [-0.066, 0.03, -0.005, -0.074], [-0.035, 0.041, 0.03, -0.078], [0.015, 0.045, 0.022, -0.078], [0.065, 0.048, -0.012, -0.078],
        [0.115, 0.05, -0.03, -0.078], [0.16, 0.046, -0.04, -0.077], [0.19, 0.034, -0.05, -0.075], [0.203, tip, -0.06, -0.066]];
      for (const [z, rx, top, bot] of R) for (let j = 0; j < S; j++) {
        const a = j / S * TAU, c = Math.cos(a), s = Math.sin(a), e = 2 / 3.2, ry = (top - bot) / 2;
        tx.push(rx * Math.sign(c) * Math.pow(Math.abs(c), e)); ty.push((top + bot) / 2 + ry * Math.sign(s) * Math.pow(Math.abs(s), e)); tz.push(z);
        const cc = s < -0.6 ? C.sole : C.boot; col.push(cc[0], cc[1], cc[2], 1);
      }
      for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < S; j++) { const a = v0 + i * S + j, b = v0 + i * S + (j + 1) % S, c = a + S, d = b + S; idx.push(a, b, c, b, d, c); }
    });
    return { upper, delt, elbow, fore, hand, thigh, knee, shin, foot };
  });

  const N = nV(), X = Float32Array.from(tx), Y = Float32Array.from(ty), Z = Float32Array.from(tz);
  const pos = new Float32Array(N * 3);
  // сегмент встаёт на место: начало O и три оси; sy растягивает его вдоль кости
  function place(p, O, ax, ay, az, sy = 1) {
    for (let k = p.v0, e = p.v0 + p.n, o = k * 3; k < e; k++, o += 3) {
      const x = X[k], y = Y[k] * sy, z = Z[k];
      pos[o] = O.x + ax.x * x + ay.x * y + az.x * z; pos[o + 1] = O.y + ax.y * x + ay.y * y + az.y * z; pos[o + 2] = O.z + ax.z * x + ay.z * y + az.z * z;
    }
  }
  function collapse(p, O) { for (let o = p.v0 * 3, e = (p.v0 + p.n) * 3; o < e; o += 3) { pos[o] = O.x; pos[o + 1] = O.y; pos[o + 2] = O.z; } }
  const ax = new V3(), ay = new V3(), az = new V3(), bx = new V3(), by = new V3(), bz = new V3(), t1 = new V3(), t2 = new V3(), O = new V3(), W = new V3();
  // ось, перпендикулярная dir, ближайшая к want; запасной вариант — alt
  function perp(out, want, dir, alt) {
    out.copy(want).addScaledVector(dir, -want.dot(dir));
    if (out.lengthSq() < 1e-6) { out.copy(alt).addScaledVector(dir, -alt.dot(dir)); if (out.lengthSq() < 1e-6) out.set(dir.y, -dir.x, 0.01); }
    return out.normalize();
  }

  // торс: dir — позвоночник от таза, shoulders — линия плеч, front — куда смотрит грудь, neck — куда идёт шея;
  // hide — вид из глаз: всё выше плеч убирается
  function torso(hip, dir, shoulders, hide, neck, front) {
    perp(ax, shoulders, dir, front); az.crossVectors(ax, dir);
    if (az.dot(front) < 0) { ax.multiplyScalar(-1); az.multiplyScalar(-1); }
    for (const [v0, T] of [[torsoV, torsoT], [vestV, vestT]]) {
      for (let i = 0, o = v0 * 3, k = v0; i < T.length; i++) {
        const t = T[i];
        // вид из глаз: шея и воротник не рисуются, срез на уровне плеч
        const cut = hide && t > 0.455;
        O.copy(hip).addScaledVector(dir, Math.min(t, cut ? 0.455 : NECK_T)); if (t > NECK_T && !cut) O.addScaledVector(neck, t - NECK_T);
        for (let j = 0; j < ST; j++, k++, o += 3) {
          if (cut) { pos[o] = O.x; pos[o + 1] = O.y; pos[o + 2] = O.z; continue; }
          const x = X[k], z = Z[k];
          pos[o] = O.x + ax.x * x + az.x * z; pos[o + 1] = O.y + ax.y * x + az.y * z; pos[o + 2] = O.z + ax.z * x + az.z * z;
        }
      }
    }
  }
  // рука: плечо, локоть, точка хвата; grip — ось того, что зажато в кулаке; hideUpper — вид из глаз, плечо не рисуется
  function arm(i, sh, el, hd, grip, hideUpper, pole) {
    const L = limbs[i];
    t1.subVectors(el, sh); t2.subVectors(hd, el);
    const l1 = t1.length() || 1e-4, l2 = t2.length() || 1e-4;
    bx.crossVectors(t1, t2); if (bx.lengthSq() < 1e-8) bx.copy(pole); bx.normalize();          // ось локтя
    // кисть: предмет проходит сквозь кулак, запястье продолжает предплечье
    by.copy(t2).multiplyScalar(1 / l2); perp(ax, grip, by, bx); az.crossVectors(ax, by);
    if (az.dot(bx) < 0 && Math.abs(az.dot(bx)) > 0.2) { ax.multiplyScalar(-1); az.multiplyScalar(-1); }
    O.copy(hd).addScaledVector(by, -0.02).addScaledVector(az, -0.027); place(L.hand, O, ax, by, az);
    W.copy(O).addScaledVector(by, -0.07);
    // предплечье от локтя к запястью
    ay.subVectors(W, el); const lf = ay.length() || 1e-4; ay.multiplyScalar(1 / lf); perp(ax, bx, ay, pole); az.crossVectors(ax, ay);
    place(L.fore, el, ax, ay, az, lf / FORE); place(L.elbow, el, ax, ay, az);
    if (hideUpper) { collapse(L.upper, el); collapse(L.delt, el); return; }
    ay.copy(t1).multiplyScalar(1 / l1); perp(ax, bx, ay, pole); az.crossVectors(ax, ay);
    place(L.upper, sh, ax, ay, az, l1 / ARM1); place(L.delt, sh, ax, ay, az);
  }
  // нога: тазобедренный сустав, колено, голеностоп, носок
  function leg(i, hj, kn, an, toe, pole) {
    const L = limbs[i];
    t1.subVectors(kn, hj); t2.subVectors(an, kn);
    const l1 = t1.length() || 1e-4, l2 = t2.length() || 1e-4;
    // куда смотрит колено: в сторону, в которую оно отошло от прямой «бедро — стопа»
    W.subVectors(an, hj); const k = t1.dot(W) / Math.max(1e-6, W.lengthSq());
    bz.copy(kn).sub(hj).addScaledVector(W, -k); if (bz.lengthSq() < 4e-4) bz.copy(pole);
    ay.copy(t1).multiplyScalar(1 / l1); perp(az, bz, ay, pole); ax.crossVectors(ay, az);
    place(L.thigh, hj, ax, ay, az, l1 / THIGH);
    by.copy(t2).multiplyScalar(1 / l2); perp(az, bz, by, pole); ax.crossVectors(by, az);
    place(L.shin, kn, ax, by, az, l2 / SHIN); place(L.knee, kn, ax, by, az);
    // стопа: носок туда, куда сказано, подъём — вдоль голени
    bz.subVectors(toe, an).normalize(); by.multiplyScalar(-1); perp(ay, by, bz, az); ax.crossVectors(ay, bz);
    place(L.foot, an, ax, ay, bz);
  }
  return { positions: pos, colors: Float32Array.from(col), indices: new Uint32Array(idx), torso, arm, leg, begin() {} };
}

// ---------- голова, кепка, очки ----------
// Оси головы: x — лицо, y — макушка, z — правое ухо. Центр в середине черепа, на уровне ушей.
const HA = 0.098, HB = 0.116, HC = 0.079;
function skull(dx, dy, dz, out, face = true) {
  const r = 1 / Math.hypot(dx / HA, dy / HB, dz / HC);
  let x = dx * r, y = dy * r, z = dz * r;
  if (dx < 0) x *= 1.06;                                              // затылок
  const low = smoothstep(-dy, 0.12, 0.9), f = smoothstep(dx, 0.5, 0.9);
  z *= 1 - 0.3 * low;                                                 // челюсть уже черепа
  if (dx > 0) x += 0.018 * smoothstep(-dy, 0.4, 0.82) * smoothstep(dx, 0.0, 0.5);   // подбородок вперёд
  if (face) {
    x += f * 0.021 * Math.exp(-Math.pow(dz / 0.15, 2) - Math.pow((dy + 0.13) / 0.2, 2));          // спинка носа
    x += f * 0.011 * Math.exp(-Math.pow(dz / 0.1, 2) - Math.pow((dy + 0.24) / 0.07, 2));          // кончик
    x += f * 0.005 * Math.exp(-Math.pow(dz / 0.5, 2) - Math.pow((dy - 0.16) / 0.07, 2));          // надбровье
    x -= f * 0.006 * Math.exp(-Math.pow((Math.abs(dz) - 0.34) / 0.14, 2) - Math.pow((dy - 0.05) / 0.09, 2));   // глазницы
    x += f * 0.004 * Math.exp(-Math.pow(dz / 0.22, 2) - Math.pow((dy + 0.44) / 0.05, 2));         // губы
    x -= f * 0.003 * Math.exp(-Math.pow(dz / 0.2, 2) - Math.pow((dy + 0.56) / 0.04, 2));          // ямка под губой
  }
  out[0] = x; out[1] = y; out[2] = z; return out;
}
// точка черепа на высоте y по азимуту phi (0 — лицо)
function skullAt(phi, y, out) {
  let lo = 0.02, hi = Math.PI - 0.02;
  for (let i = 0; i < 22; i++) { const th = (lo + hi) / 2; skull(Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi), out, false); if (out[1] > y) lo = th; else hi = th; }
  return out;
}
export function buildHead() {
  const p = [0, 0, 0];
  // кожа и волосы
  const NT = 26, NP = 36, pos = [], col = [], idx = [];
  for (let i = 0; i <= NT; i++) for (let j = 0; j < NP; j++) {
    const th = 0.02 + (Math.PI - 0.04) * i / NT, ph = j / NP * TAU, dx = Math.sin(th) * Math.cos(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(ph);
    skull(dx, dy, dz, p); pos.push(p[0], p[1], p[2]);
    const hair = dx < 0.22 - 0.35 * Math.max(0, dy) && dy > -0.38 - 0.5 * Math.max(0, -dx - 0.3) && !(Math.abs(dz) > 0.8 && dy < 0.1 && dx > -0.25);
    const lips = dx > 0.75 && Math.abs(dz) < 0.2 && dy < -0.415 && dy > -0.475;
    const c = lips ? C.lips : hair ? C.hair : C.skin; col.push(c[0], c[1], c[2], 1);
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) { const a = i * NP + j, b = i * NP + (j + 1) % NP, c = a + NP, d = b + NP; idx.push(a, b, c, b, d, c); }
  // уши
  for (const s of [-1, 1]) {
    const v0 = pos.length / 3, R = 6, S = 8;
    for (let i = 0; i <= R; i++) for (let j = 0; j < S; j++) { const t = i / R * Math.PI, a = j / S * TAU, rr = Math.sin(t); pos.push(-0.006 + 0.013 * rr * Math.cos(a) - 0.004 * Math.cos(t), -0.006 + 0.028 * Math.cos(t), s * (0.077 + 0.007 * rr * Math.abs(Math.sin(a)) + 0.004 * rr)); col.push(C.skin[0], C.skin[1], C.skin[2], 1); }
    for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) { const a = v0 + i * S + j, b = v0 + i * S + (j + 1) % S, c = a + S, d = b + S; if (s > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
  }
  const skin = { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx) };

  // кепка: купол по черепу и козырёк; сидит чуть ниже на лбу, чем на затылке
  const cp = [], cc = [], ci = [], rimY = (ph) => 0.026 + 0.02 * Math.cos(ph), CR = 9;
  for (let i = 0; i <= CR; i++) for (let j = 0; j < NP; j++) {
    const ph = j / NP * TAU, yTop = HB * 0.999, y = yTop + (rimY(ph) - yTop) * Math.pow(i / CR, 1.4);
    skullAt(ph, y, p); const k = 1.05; cp.push(p[0] * k, p[1] * k + 0.004, p[2] * k);
    const band = i >= CR - 1 ? C.capBlue : C.cap; cc.push(band[0], band[1], band[2], 1);
  }
  for (let i = 0; i < CR; i++) for (let j = 0; j < NP; j++) { const a = i * NP + j, b = i * NP + (j + 1) % NP, c = a + NP, d = b + NP; ci.push(a, b, c, b, d, c); }
  { const v0 = cp.length / 3, NB = 16, RB = 4, span = 1.2;
    for (let j = 0; j <= NB; j++) {
      const ph = -span + 2 * span * j / NB, u = ph / span; skullAt(ph, rimY(ph), p);
      const ix = p[0] * 1.05, iy = p[1] * 1.05 + 0.004, iz = p[2] * 1.05, len = 0.082 * Math.pow(Math.max(0, 1 - u * u), 0.55);
      for (let k = 0; k <= RB; k++) { const t = k / RB; cp.push(ix + len * t, iy - 0.016 * t - 0.01 * t * t * (1 - u * u) - 0.012 * u * u * t, iz * (1 + 0.1 * t)); const c = k === RB ? C.capBlue : C.cap; cc.push(c[0], c[1], c[2], 1); }
    }
    for (let j = 0; j < NB; j++) for (let k = 0; k < RB; k++) { const a = v0 + j * (RB + 1) + k, b = a + 1, c = a + RB + 1, d = c + 1; ci.push(a, c, b, b, c, d); } }
  const cap = { positions: new Float32Array(cp), colors: new Float32Array(cc), indices: new Uint32Array(ci) };

  // очки: полоса по лицу с двумя линзами, переносицей и дужками до ушей
  const gp = [], gi = [], NG = 44, spanG = 1.75;
  for (let j = 0; j <= NG; j++) {
    const ph = -spanG + 2 * spanG * j / NG, a = Math.abs(ph);
    const lens = smoothstep(a, 0.1, 0.26) * (1 - smoothstep(a, 0.82, 1.08)), arm = smoothstep(a, 0.95, 1.15);
    const hh = 0.0045 + 0.0165 * lens, y0 = 0.024 - 0.006 * lens + 0.004 * arm, k = 1.105 - 0.075 * smoothstep(a, 0.7, 1.3);
    for (const s of [1, -1]) { skullAt(ph, y0 + s * hh, p); gp.push(p[0] * k + 0.002 * (1 - arm), y0 + s * hh, p[2] * k); }
  }
  for (let j = 0; j < NG; j++) { const a = j * 2, b = a + 1, c = a + 2, d = a + 3; gi.push(a, c, b, b, c, d); }
  const glasses = { positions: new Float32Array(gp), indices: new Uint32Array(gi) };
  return { skin, cap, glasses };
}
