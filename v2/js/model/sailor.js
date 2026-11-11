// Матрос: тело одной оболочкой и расчёт поз. Позы перенесены из первой версии тренажёра без изменений в логике:
// посадка по положению центра тяжести из физики, откренивание, пригибание под гиком, переход на другой борт,
// перехват рук после поворота. От графического движка модуль не зависит: наружу отдаются массивы вершин.
import { V3, clamp, smoothstep, DEG } from '../vec.js';

// торс: [расстояние вдоль корпуса от таза, полуширина по линии плеч, полутолщина, цвет]
const TORSO_RINGS = [
  [-0.125, 0.002, 0.002, 'pants'], [-0.10, 0.115, 0.095, 'pants'], [-0.04, 0.182, 0.150, 'pants'], [0.02, 0.182, 0.150, 'pants'], [0.058, 0.170, 0.120, 'pants'],
  [0.064, 0.166, 0.112, 'top'], [0.10, 0.160, 0.104, 'top'], [0.134, 0.160, 0.104, 'top'],
  [0.140, 0.186, 0.130, 'vest'], [0.186, 0.196, 0.137, 'vest'], [0.190, 0.202, 0.142, 'trim'], [0.216, 0.205, 0.144, 'trim'], [0.220, 0.200, 0.140, 'vest'],
  [0.335, 0.216, 0.149, 'vest'], [0.415, 0.207, 0.143, 'vest'], [0.452, 0.165, 0.118, 'vest'],
  [0.458, 0.150, 0.100, 'top'], [0.492, 0.085, 0.070, 'top'], [0.500, 0.056, 0.056, 'skin'], [0.585, 0.050, 0.050, 'skin'], [0.60, 0.002, 0.002, 'skin'],
];
// конечность: путь из четырёх точек (плечо, локоть, запястье, кончики пальцев или бедро, колено, щиколотка, носок)
const ARM_SPEC = { rad: [[0, 0.060], [1, 0.047], [1.9, 0.036], [2.3, 0.045], [3, 0.036]], split: 1.93, a: 'top', b: 'glove', f1: 0.07, f2: 0.02 };
const LEG_SPEC = { rad: [[0, 0.092], [1, 0.066], [1.92, 0.047], [2.25, 0.053], [3, 0.046]], split: 1.82, a: 'pants', b: 'boot', f1: 0.09, f2: 0.045 };
const LIMB_RINGS = 3 + 2 + 5 + 2 + 4 + 2 + 2, SIDES = 12, NECK_T = 0.47;
const COLORS = { pants: [0.012, 0.014, 0.02], top: [0.02, 0.045, 0.11], vest: [1.0, 0.13, 0.0], trim: [0.012, 0.012, 0.012], skin: [0.58, 0.31, 0.19], glove: [0.016, 0.016, 0.016], boot: [0.016, 0.016, 0.018] };
const THIGH = 0.44, SHIN = 0.43, ARM1 = 0.30, ARM2 = 0.28;

function makeBody() {
  const S = SIDES, nRings = TORSO_RINGS.length + 4 * LIMB_RINGS, nV = nRings * S;
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 4).fill(1), idx = [];
  let r0 = 0;
  for (const n of [TORSO_RINGS.length, LIMB_RINGS, LIMB_RINGS, LIMB_RINGS, LIMB_RINGS]) {
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < S; j++) { const a = (r0 + i) * S + j, b = (r0 + i) * S + (j + 1) % S, c = a + S, d = b + S; idx.push(a, b, c, b, d, c); }
    r0 += n;
  }
  const cs = [], sn = []; for (let j = 0; j < S; j++) { cs.push(Math.cos(j / S * Math.PI * 2)); sn.push(Math.sin(j / S * Math.PI * 2)); }
  let ring = 0, hidden = 0;
  const T = new V3(), N = new V3(), Bn = new V3(), c0 = new V3(), d1 = new V3(), d2 = new V3(), d3 = new V3();
  const A1 = new V3(), A2 = new V3(), B1 = new V3(), B2 = new V3(), tmp = new V3();
  function put(c, n, b, ra, rb, color) {
    let o = ring * S * 3, oc = ring * S * 4;
    for (let j = 0; j < S; j++, o += 3, oc += 4) {
      const x = cs[j] * ra, y = sn[j] * rb;
      pos[o] = c.x + n.x * x + b.x * y; pos[o + 1] = c.y + n.y * x + b.y * y; pos[o + 2] = c.z + n.z * x + b.z * y;
      col[oc] = color[0]; col[oc + 1] = color[1]; col[oc + 2] = color[2];
    }
    ring++;
  }
  const radAt = (spec, w) => { const r = spec.rad; for (let i = 1; i < r.length; i++) if (w <= r[i][0]) { const u = (w - r[i - 1][0]) / (r[i][0] - r[i - 1][0]); return r[i - 1][1] + (r[i][1] - r[i - 1][1]) * Math.max(0, u); } return r[r.length - 1][1]; };
  // кольцо конечности: нормаль переносится с предыдущего кольца без закручивания
  function limbRing(c, t, w, spec, hide, scale = 1) {
    N.addScaledVector(t, -N.dot(t)); if (N.lengthSq() < 1e-8) N.set(t.y, -t.x, 0); N.normalize();
    Bn.crossVectors(t, N);
    const r = hide ? 0.0005 : radAt(spec, w) * scale;
    // скрытые кольца стягиваются в центр первого видимого: срез получается плоским
    if (!hide && hidden > 0) { for (let o = (ring - hidden) * S * 3; o < ring * S * 3; o += 3) { pos[o] = c.x; pos[o + 1] = c.y; pos[o + 2] = c.z; } hidden = 0; }
    if (hide) hidden++;
    put(c, N, Bn, r, r, COLORS[w < spec.split ? spec.a : spec.b]);
  }
  // hideTo — координата пути, до которой часть скрыта (вид из глаз: плечо и верх руки не рисуются)
  function limb(p0, p1, p2, p3, spec, pole, hideTo = -1) {
    d1.subVectors(p1, p0); const L1 = d1.length() || 1e-4; d1.multiplyScalar(1 / L1);
    d2.subVectors(p2, p1); const L2 = d2.length() || 1e-4; d2.multiplyScalar(1 / L2);
    d3.subVectors(p3, p2); const L3 = d3.length() || 1e-4; d3.multiplyScalar(1 / L3);
    const f1 = Math.min(spec.f1, L1 * 0.45, L2 * 0.4), f2 = Math.min(spec.f2, L2 * 0.4, L3 * 0.45);
    A1.copy(p1).addScaledVector(d1, -f1); A2.copy(p1).addScaledVector(d2, f1);
    B1.copy(p2).addScaledVector(d2, -f2); B2.copy(p2).addScaledVector(d3, f2);
    N.crossVectors(d1, d2); if (N.lengthSq() < 1e-6) N.copy(pole);
    const hid = (w) => w < hideTo; hidden = 0;
    const rs = radAt(spec, 0);
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
  // торс: жёсткий, вдоль dir от таза; ax — линия плеч; neck — куда идёт шея
  function torso(hip, dir, ax, hide, neck) {
    N.copy(ax).addScaledVector(dir, -ax.dot(dir)).normalize(); Bn.crossVectors(dir, N);
    for (const [t, a, b, c] of TORSO_RINGS) {
      tmp.copy(hip).addScaledVector(dir, hide ? 0 : Math.min(t, NECK_T));
      if (!hide && t > NECK_T) tmp.addScaledVector(neck, t - NECK_T);
      put(tmp, N, Bn, hide ? 0.0005 : a, hide ? 0.0005 : b, COLORS[c]);
    }
  }
  return { positions: pos, colors: col, indices: new Uint32Array(idx), torso, limb, begin() { ring = 0; } };
}

// Кисть не дальше вытянутой руки: цель подтягивается к плечу
function clampReach(shoulder, hand, reach) {
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y, dz = hand.z - shoulder.z, L = Math.hypot(dx, dy, dz);
  if (L > reach) { const k = reach / L; hand.set(shoulder.x + dx * k, shoulder.y + dy * k, shoulder.z + dz * k); }
}
// Двухзвенная конечность: по двум концам и длинам звеньев найти сустав, отогнутый в сторону pole
const _ax = new V3(), _pp = new V3();
function solveElbow(a, b, l1, l2, pole, out) {
  _ax.subVectors(b, a); const d = clamp(_ax.length(), 1e-4, l1 + l2 - 1e-4); _ax.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _pp.copy(pole).addScaledVector(_ax, -pole.dot(_ax)); if (_pp.lengthSq() < 1e-8) _pp.set(0, 1, 0); _pp.normalize();
  return out.copy(a).addScaledVector(_ax, x).addScaledVector(_pp, h);
}

// g — геометрия лодки: { deckAt, cockpitHalfWidth, cockpitSDF, COCKPIT, FLOOR_Y }
export function createSailor(g) {
  const body = makeBody();
  const SS = { y: -0.5, x: -0.35, theta: 0.4, crouch: 0, sgn: 0, flip: 0, swap: 1, duck: 0 };
  const P = {
    hip: new V3(), ax: new V3(1, 0, 0), neck: new V3(0, 1, 0), aim: new V3(), shoulder: new V3(), headP: new V3(), knee: new V3(), tmp: new V3(),
    elbowA: new V3(), handA: new V3(), elbowB: new V3(), handB: new V3(),
  };
  const pool = []; let pi = 0;
  const tv = () => (pool[pi] || (pool[pi] = new V3()), pool[pi++]);
  const Yax = new V3(0, 1, 0);
  // результат кадра: куда поставить голову, куда смотрит удлинитель румпеля, где конец шкота в руке
  const res = { head: new V3(), headYaw: 0, headTilt: 0, headRoll: 0, extTip: new V3(), sheetEnd: new V3(), sheetSag: 0, inWater: false };
  let firstPerson = false;

  // c: { boomRot (рад), mastBase, BOOM_H, BOOM_L, boardUp, boardAft, pivotHull, blockTop, boomBlockMid (в осях гика), extLen, ease, slack }
  // Лодка лежит на борту. Сначала матрос в воде у шверта, затем стоит на шверте и держится за борт;
  // если лодку надо развернуть, плывёт у носа и тянет его к ветру. Всё считается в осях лежащей лодки.
  function capsizePose(state, c) {
    pi = 0;
    const h = state.heel * DEG, cs = Math.sign(state.heel) || 1;
    const up = tv().set(0, Math.cos(h), Math.sin(h));                 // где в осях лодки мировой верх
    const side = tv().set(0, -Math.sin(h), Math.cos(h));              // горизонталь поперёк лодки
    const swim = c.swim || (state.capsized < 1.6 && !state.righting);
    const hip = P.hip, dir = P.tmp, ax = P.ax;
    const hands = [P.handA, P.handB], feet = [tv(), tv()], pole = tv();
    body.begin();
    if (swim) {
      const bow = !!c.swim, ax0 = bow ? 2.5 : 0.25;
      hip.set(ax0, 0, 0).addScaledVector(up, -0.56).addScaledVector(side, bow ? 0 : -cs * 0.75);
      dir.copy(up); dir.x += bow ? -0.3 : 0; dir.addScaledVector(side, bow ? 0 : cs * 0.25); dir.normalize();
      if (bow) ax.copy(side); else ax.set(1, 0, 0);
      for (let i = 0; i < 2; i++) {
        const o = i ? 0.14 : -0.14;
        if (bow) hands[i].set(2.1, 0.47, 0).addScaledVector(side, o); else hands[i].set(0.45 + o, -0.25, 0).addScaledVector(up, 0.03);
        feet[i].copy(hip).addScaledVector(up, -0.8); feet[i].x += bow ? 0.25 + o : o * 1.6;
      }
      pole.set(bow ? 1 : 0, 0, 0).addScaledVector(side, bow ? 0 : -cs);
      res.headYaw = bow ? Math.PI : cs * Math.PI / 2;
    } else {
      // на шверте: ноги у самого днища, корпус навален на борт; когда лодка пошла, матрос откидывается назад
      const k = state.righting ? smoothstep(state.righting, 0.1, 1.2) : 0;
      hip.set(0.45, -0.46 - 0.25 * k, cs * 0.86);
      dir.set(0, 0.8 - 0.75 * k, cs * (0.6 + 0.35 * k)).normalize();
      ax.set(1, 0, 0);
      for (let i = 0; i < 2; i++) { const o = i ? 0.17 : -0.17; hands[i].set(0.45 + o, 0.33, cs * 0.69); feet[i].set(0.42 + o * 0.9, -0.34, cs * 0.03); }
      pole.set(0, -1, cs * 0.2);
      res.headYaw = cs * Math.PI / 2;
    }
    P.shoulder.copy(hip).addScaledVector(dir, 0.46);
    const neck = P.neck.copy(dir).lerp(up, 0.7).normalize();
    body.torso(hip, dir, ax, false, neck);
    res.head.copy(hip).addScaledVector(dir, NECK_T).addScaledVector(neck, 0.655 - NECK_T);
    res.headTilt = 0.05; res.headRoll = h; res.inWater = swim;
    for (let i = 0; i < 2; i++) {
      const o = i ? 0.165 : -0.165, sh = tv().copy(P.shoulder).addScaledVector(ax, o), hj = tv().copy(hip).addScaledVector(ax, o * 0.6);
      clampReach(sh, hands[i], ARM1 + ARM2 - 0.02); clampReach(hj, feet[i], THIGH + SHIN - 0.02);
      const el = solveElbow(sh, hands[i], ARM1, ARM2, tv().copy(up).multiplyScalar(-1), i ? P.elbowB : P.elbowA);
      const fd = tv().subVectors(hands[i], el).normalize();
      body.limb(sh, el, tv().copy(hands[i]).addScaledVector(fd, -0.05), tv().copy(hands[i]).addScaledVector(fd, 0.06), ARM_SPEC, ax);
      solveElbow(hj, feet[i], THIGH, SHIN, pole, P.knee);
      body.limb(hj, P.knee, feet[i], tv().copy(feet[i]).addScaledVector(pole, 0.19), LEG_SPEC, pole);
    }
    // после подъёма матрос оказывается на том борту, через который влез
    SS.sgn = cs; SS.y = cs * 0.5; SS.crouch = 0; SS.swap = 1; SS.flip = 0; SS.duck = 0; SS.theta = 0.3;
    res.extTip.copy(c.pivotHull); res.extTip.x += c.extLen * 0.7; res.sheetEnd.copy(c.blockTop);
    return res;
  }

  function update(state, dt, out, c) {
    if (state.capsized > 0 && Math.abs(state.heel) > 42) return capsizePose(state, c);
    res.headRoll = 0; res.inWater = false;
    pi = 0;
    const k = Math.min(1, dt * 3);
    const twa = out ? out.twaAbs : 90, spd = state.vf;
    const ay = Math.abs(state.crewY), hike = Math.min(1, Math.max(0, (ay - 0.45) / 0.6));
    const planing = Math.min(1, Math.max(0, (spd - 2.4) / 1.5));
    let tx = twa < 95 ? -0.2 - 0.25 * hike : twa < 150 ? -0.4 - 0.4 * planing : -0.3 - 0.3 * planing;   // на попутных и в глиссировании — в корму
    if (c.boardUp > 0.06) tx = Math.min(tx, -0.62);     // шверт приподнят: матрос сидит дальше от него
    // Матрос всегда сидит на борту: в слабый ветер на внутренней кромке, ноги в кокпите, корпус наклонён внутрь;
    // чем свежее, тем дальше наружу. По центру он оказывается только на миг, когда переходит на другой борт.
    const edge = g.cockpitHalfWidth(SS.x) + 0.03;
    const seat = Math.max(edge, 0.46 + 0.22 * hike);
    const ttheta = ay <= 0.45 ? -0.30 + 0.68 * (ay / 0.45) : 0.38 + 1.07 * hike;
    let wantSide = SS.sgn || state.side || 1;
    if (ay > 0.18) wantSide = Math.sign(state.crewY); else if (ay < 0.06) wantSide = state.side || wantSide;
    if (!SS.sgn) SS.sgn = wantSide;
    if (wantSide !== SS.sgn) { SS.flip += dt; if (SS.flip > 0.3) { SS.sgn = wantSide; SS.flip = 0; SS.swap = 0; } } else SS.flip = 0;
    SS.x += (tx - SS.x) * k; SS.theta += (ttheta - SS.theta) * Math.min(1, dt * 8);
    const dyS = (SS.sgn * seat - SS.y) * Math.min(1, dt * 14), maxS = 1.7 * dt;   // переход на другой борт занимает около полсекунды
    SS.y += Math.max(-maxS, Math.min(maxS, dyS));
    const sv = clamp(SS.y / (edge * 0.85), -1, 1);                  // на каком борту сидит; при переходе плавно проходит через ноль
    SS.crouch += ((1 - Math.abs(sv)) - SS.crouch) * Math.min(1, dt * 12);
    const h = Math.min(1, Math.max(0, (SS.theta - 0.38) / 1.07));   // степень откренивания 0..1
    const dy = g.deckAt(SS.x), lateral = SS.y, crouch = SS.crouch, floorY = g.FLOOR_Y;
    // Переход на другой борт: матрос разворачивается лицом к носу, пригибается под гик и проходит через кокпит
    P.hip.set(SS.x, dy + 0.07 - 0.03 * crouch, lateral);
    const theta = SS.theta * (1 - crouch) + 0.1 * crouch;
    const dir = P.tmp.set(-0.06 + 1.5 * crouch, Math.cos(theta), sv * Math.sin(theta)).normalize();
    // Гик идёт на высоте головы сидящего матроса: когда он проходит над матросом, тот пригибается
    {
      const boomY = c.mastBase.y + c.BOOM_H - 0.05, headTop = P.hip.y + 0.655 * dir.y + 0.15;
      let near = 0;
      for (const ahead of [0, 0.22]) {                               // сейчас и с упреждением: гик летит быстро
        const b = (state.boom + state.boomRate / DEG * ahead) * DEG, cb = Math.cos(b);
        const along = (c.mastBase.x - (P.hip.x + 0.25)) / Math.max(0.2, cb);
        if (cb > 0.15 && along > 0.15 && along < c.BOOM_L + 0.1) {
          const dz = Math.abs(P.hip.z + dir.z * 0.6 - along * Math.sin(b));
          near = Math.max(near, 1 - smoothstep(dz, 0.24, 0.55));
        }
      }
      const need = Math.max(0, Math.min(0.45, headTop - boomY)) * near;
      SS.duck += (need - SS.duck) * Math.min(1, dt * (need > SS.duck ? 16 : 5));
      if (SS.duck > 0.005) {
        const cc = Math.max(0.25, 1 - SS.duck / (0.655 * Math.max(0.3, dir.y)));
        dir.x += Math.tan(Math.acos(cc)) * dir.y; dir.normalize();
      }
    }
    // поднятый шверт стоит перед кокпитом: наклоняясь вперёд, матрос не достаёт до него головой
    if (c.boardUp > 0.06) {
      const maxX = (c.boardAft - 0.3 - P.hip.x) / 0.655;
      if (dir.x > maxX) { dir.x = Math.max(0, maxX); dir.normalize(); }
    }
    const duckK = Math.min(1, SS.duck / 0.12);
    P.shoulder.copy(P.hip).addScaledVector(dir, 0.46);
    // Шея: когда корпус лежит за бортом или наклонён вперёд, голова поднята и смотрит вперёд
    const lift = Math.max(h * (1 - crouch), crouch) * (1 - 0.8 * duckK);
    const neck = P.neck.copy(dir); neck.x += (0.2 * h - 0.25 * crouch) * lift; neck.y += 0.85 * lift; neck.z -= sv * 0.3 * h * (1 - crouch); neck.normalize();
    P.headP.copy(P.hip).addScaledVector(dir, NECK_T).addScaledVector(neck, 0.655 - NECK_T); P.headP.x += 0.03; P.headP.z -= sv * 0.03 * (1 - h);
    // Линия плеч: сидя — вдоль лодки, при переходе — поперёк
    const before = SS.y * SS.sgn < 0, cAx = 1 - Math.abs(sv);
    const ax = P.ax.set(1 - cAx, 0, (before ? -1 : 1) * cAx * SS.sgn).normalize();
    body.begin();
    body.torso(P.hip, dir, ax, firstPerson, neck);
    res.head.copy(P.headP); res.headYaw = sv * 0.35 * (1 - h * 0.4); res.headTilt = 0.1 + 0.14 * h;
    const shA = tv().copy(P.shoulder).addScaledVector(ax, -0.165); shA.y -= 0.02; shA.z += sv * 0.02;      // заднее плечо
    const shB = tv().copy(P.shoulder).addScaledVector(ax, 0.165); shB.y -= 0.02; shB.z += sv * 0.02;       // переднее
    // ноги: стопы под ремнём откренивания, колено сгибается вверх; чем дальше матрос вывешивается, тем прямее ноги
    const toeA = 0.5 * (1 - crouch), toeS = sv >= 0 ? -1 : 1;
    const half = g.cockpitHalfWidth(SS.x) - 0.1;
    for (const off of [0.12, -0.12]) {
      const leg = Math.sign(off) * (before ? -1 : 1) * SS.sgn;
      const poleLeg = tv().set(0.6 * crouch, 1 - 0.45 * crouch, sv * 0.25 * (1 - crouch) + leg * 1.1 * crouch);
      const hipJ = tv().copy(P.hip).addScaledVector(ax, off * 0.85); hipJ.y -= 0.03; hipJ.z -= sv * 0.07;
      const ftZ = clamp(lateral - sv * 0.62, -0.13, 0.13) - sv * 0.02 * (1 - crouch);
      const ft = tv().set(SS.x + off * 1.25 * (1 - crouch) + 0.05 + 0.08 * crouch, floorY + 0.075, ftZ * (1 - crouch) + clamp(lateral + leg * 0.3, -half, half) * crouch);
      clampReach(hipJ, ft, THIGH + SHIN - 0.015);
      solveElbow(hipJ, ft, THIGH, SHIN, poleLeg, P.knee);
      // колено не ниже палубы: бедро лежит на борту
      const deckK = g.deckAt(P.knee.x) + (g.cockpitSDF(P.knee.x, P.knee.z) < 0 ? -g.COCKPIT.depth : 0) + 0.085;
      if (P.knee.y < deckK) P.knee.y = deckK;
      const toe = tv().set(ft.x + 0.19 * crouch, ft.y + Math.sin(toeA) * 0.19 * (1 - crouch), ft.z + toeS * Math.cos(toeA) * 0.19 * (1 - crouch));
      body.limb(hipJ, P.knee, ft, toe, LEG_SPEC, poleLeg);
    }
    // руки
    const REACH = ARM1 + ARM2 - 0.02, run = twa >= 150, sm = (e0, e1, x) => smoothstep(x, e0, e1);
    const pivotHull = c.pivotHull, EXT_LEN = c.extLen;
    // Обычный хват: задняя рука держит удлинитель румпеля перед собой, у живота
    const fn = Math.sin(theta), fc = Math.cos(theta);
    const frontT = tv().copy(P.hip).addScaledVector(dir, 0.2);
    frontT.x -= 0.16; frontT.y += 0.2 * Math.max(0, fn) + 0.04; frontT.z -= sv * 0.29 * fc;
    // передняя рука: шкот; на фордевинде — участок шкота от блока к гику
    const sheetN = tv();
    if (run) { const bm = tv().copy(c.boomBlockMid).rotY(c.boomRot).add(c.mastBase); sheetN.copy(c.blockTop).lerp(bm, 0.3); }
    else sheetN.set(SS.x + 0.35, dy + 0.36 - 0.1 * h, lateral - sv * 0.05 + sv * 0.1 * h);
    // При переходе: удлинитель за спиной, со стороны нового борта; шкот в другой руке впереди
    const crossT = tv().set(SS.x - 0.28, P.hip.y + 0.2, lateral + SS.sgn * 0.25);
    const crossS = tv().set(SS.x + 0.35, dy + 0.3, lateral - SS.sgn * 0.15);
    const behind = tv().set(SS.x + 0.02, P.hip.y + 0.15, lateral + sv * 0.25).lerp(crossT, cAx);
    const sheetA = tv().set(SS.x - 0.02, dy + 0.34, lateral - sv * 0.24).lerp(crossS, cAx);
    // Перехват: задняя рука со шкотом тянется за спину и берёт удлинитель, передняя отпускает его и забирает шкот,
    // затем задняя рука проносит удлинитель над плечом вперёд
    if (!before && SS.swap < 1 && cAx < 0.25) SS.swap = Math.min(1, SS.swap + dt / 1.25);
    const sw = before ? 1 : SS.swap;
    const aim = P.aim, sheetEnd = res.sheetEnd;
    let holdA = true, poleBack = 0;
    if (before) { aim.copy(frontT).lerp(crossT, cAx); P.handB.copy(sheetN).lerp(crossS, cAx); sheetEnd.copy(P.handB); }
    else if (sw < 1) {
      const over = tv().set(SS.x - 0.36, P.hip.y + 0.78, lateral + sv * 0.08);     // над задним плечом: удлинитель встаёт торчком
      const q = sm(0.45, 1, sw), q1 = 1 - q;
      if (sw < 0.45) aim.copy(behind);
      else aim.set(q1 * q1 * behind.x + 2 * q1 * q * over.x + q * q * frontT.x, q1 * q1 * behind.y + 2 * q1 * q * over.y + q * q * frontT.y, q1 * q1 * behind.z + 2 * q1 * q * over.z + q * q * frontT.z);
      holdA = sw >= 0.34;
      sheetEnd.copy(sheetA).lerp(sheetN, sm(0.08, 0.5, sw));
      poleBack = sm(0.05, 0.3, sw) * (1 - sm(0.7, 1, sw));
    } else { aim.copy(frontT); P.handB.copy(sheetN); sheetEnd.copy(sheetN); }
    const toWant = tv().copy(aim).sub(pivotHull); const distWant = toWant.length(); toWant.normalize();
    const gripD = clamp(distWant, 0.35, EXT_LEN);
    const grip = tv().copy(pivotHull).addScaledVector(toWant, gripD);
    if (before || sw >= 1) P.handA.copy(grip);
    else {
      const gripAft = tv().copy(pivotHull).addScaledVector(toWant, Math.max(0.3, gripD - 0.2));
      if (holdA) P.handA.copy(gripAft).lerp(grip, sm(0.34, 0.5, sw)); else P.handA.copy(sheetA).lerp(gripAft, sm(0.08, 0.34, sw));
      P.handB.copy(grip).lerp(sheetN, sm(0.34, 0.58, sw));
    }
    clampReach(shA, P.handA, REACH); clampReach(shB, P.handB, REACH);
    // Шкот всегда в руке: до перехвата его держит задняя рука, она же берёт удлинитель; затем шкот забирает передняя
    if (before || sw >= 1) sheetEnd.copy(P.handB); else sheetEnd.copy(P.handA).lerp(P.handB, sm(0.30, 0.40, sw));
    // локти: обычно вниз; у руки, заведённой за спину, — наружу
    const backB = before ? 0 : (sw < 1 ? 1 - sm(0.34, 0.6, sw) : 0), outS = cAx > 0.5 ? SS.sgn : sv;
    solveElbow(shA, P.handA, ARM1, ARM2, tv().set(-1 + 0.5 * poleBack, -0.6 + 0.3 * poleBack, -sv * 0.15 * (1 - cAx) + outS * (0.9 * poleBack + (before ? 0.8 * cAx : 0))), P.elbowA);
    solveElbow(shB, P.handB, ARM1, ARM2, tv().set(0.2 + 0.1 * backB, -1 + 0.6 * backB, sv * 0.3 + outS * 0.9 * backB), P.elbowB);
    for (const [sh, el, hd] of [[shA, P.elbowA, P.handA], [shB, P.elbowB, P.handB]]) {
      const fd = tv().subVectors(hd, el).normalize();
      body.limb(sh, el, tv().copy(hd).addScaledVector(fd, -0.05), tv().copy(hd).addScaledVector(fd, 0.06), ARM_SPEC, ax, firstPerson ? 0.45 : -1);
    }
    // удлинитель румпеля направлен на точку хвата, длина постоянная
    res.extTip.copy(pivotHull).addScaledVector(toWant, EXT_LEN);
    // шкот от блока в руку
    const midY = (c.blockTop.y + sheetEnd.y) / 2, wantSag = run ? 0.02 : 0.03 + 0.1 * c.ease + 0.12 * c.slack;
    res.sheetSag = Math.max(0, Math.min(wantSag, midY - (floorY + 0.05)));
    return res;
  }
  return { positions: body.positions, colors: body.colors, indices: body.indices, pose: SS, update, setFirstPerson(v) { firstPerson = v; } };
}
