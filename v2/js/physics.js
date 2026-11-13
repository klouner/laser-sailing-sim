// Физика швертбота «Лазер» (ILCA 7): твёрдое тело с четырьмя степенями свободы.
//   ход u, дрейф v, поворот r, крен p — с массами и моментами инерции;
//   парус, шверт и руль — крылья со своим углом атаки и срывом потока;
//   гик качается на мачте сам и упирается в шкот; экипаж — подвижный груз.
// Оси лодки: x — вперёд (нос), z — правый борт. Курс и направления — компасные, градусы по часовой.
// Крен heel > 0 — на левый борт. Угол гика boom > 0 — гик по правому борту.
export const KN = 0.514444;           // м/с в одном узле
const DEG = Math.PI / 180, G = 9.81;
export const PHYS_DT = 1 / 120;       // фиксированный шаг интегрирования, с

export const BOAT = {
  mass: 140,          // корпус с вооружением 60 кг + матрос 80 кг
  crewMass: 80,
  mU: 140 * 1.08,     // масса с присоединённой водой по ходу
  mV: 140 * 1.45,     // и поперёк
  Izz: 175,           // момент инерции при повороте, кг·м²
  Ixx: 150,           // момент инерции при крене, кг·м²
  sailArea: 7.06, rhoAir: 1.225, rhoWater: 1025,
  mastX: 1.12,        // мачта от центра масс, м
  ceArm: 1.1,         // центр парусности от мачты вдоль гика, м
  ceHeight: 2.35,     // и над ватерлинией, м
  boomI: 14,          // момент инерции гика с парусом вокруг мачты, кг·м²
  // шверт и руль: положение по длине, площадь, наклон кривой подъёмной силы (1/рад), максимум, сопротивление, заглубление
  board: { x: 0.50, area: 0.28, slope: 4.2, clMax: 1.0, cd0: 0.012, kInd: 0.084, depth: 0.42 },
  rudder: { x: -2.15, area: 0.11, slope: 4.4, clMax: 1.05, cd0: 0.014, kInd: 0.071, depth: 0.32 },
  rudderRate: 160,    // скорость перекладки руля, град/с
  crewYMax: 1.05,     // центр тяжести матроса от ДП при полном откренивании, м
  crewSpeed: 1.4,     // скорость перемещения матроса поперёк лодки, м/с
  windageF: 0.55, windageS: 1.5, // парусность корпуса, матроса и рангоута: Cd·A спереди и сбоку, м²
  windageX: 0.5,      // её центр впереди центра масс (мачта стоит в носу), м
  boomMin: 8,         // ближе к диаметральной плоскости гик не выбрать: блоки шкота сходятся, град
  boomWeight: 45,     // момент веса гика с парусом при крене, Н·м
};

export function norm180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
export function norm360(a) { return ((a % 360) + 360) % 360; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Парус: коэффициенты от угла атаки (град). До срыва (~24°) — крыло с индуктивным сопротивлением, после — пластина.
export function sailCoeffs(aoa) {
  const a = clamp(aoa, 0, 90), s = Math.sin(a * DEG), c = Math.cos(a * DEG);
  const clWing = 1.5 * Math.sin((Math.min(a, 24) / 24) * Math.PI / 2);
  const cdWing = 0.08 + clWing * clWing / 7.5;        // мачта, щель под гиком и твист съедают качество
  const clPlate = 1.35 * c, cdPlate = 0.08 + 1.25 * s * s;
  const k = smooth(24, 36, a);
  return { CL: clWing * (1 - k) + clPlate * k, CD: cdWing * (1 - k) + cdPlate * k };
}

// Сопротивление корпуса на ровном киле, Н: трение по ITTC-57 плюс волновое; после 4 м/с — глиссирование.
const R_V = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0];
const R_N = [0, 1.7, 7, 17, 34, 62, 100, 135, 160, 195, 225, 258, 295, 380];
export function hullResistance(v) {
  const a = Math.abs(v);
  for (let i = 1; i < R_V.length; i++) if (a <= R_V[i]) return R_N[i - 1] + (R_N[i] - R_N[i - 1]) * (a - R_V[i - 1]) / (R_V[i] - R_V[i - 1]);
  return R_N[R_N.length - 1] * (a / 10) * (a / 10);
}
// Плечо остойчивости формы, м: широкий плоский корпус быстро набирает момент, после входа палубы в воду — теряет.
function GZ(phi) {
  const a = Math.abs(phi), s = Math.sign(phi), A1 = 25 * DEG, A2 = 78 * DEG;
  if (a <= A1) return s * 0.30 * Math.sin(a / A1 * Math.PI / 2);
  if (a < A2) return s * 0.30 * Math.cos((a - A1) / (A2 - A1) * Math.PI / 2);
  return -s * 0.05;
}

// Крыло в воде. (ux, uz) — скорость крыла сквозь воду в осях лодки, (cx, cz) — куда смотрит носик профиля.
// Результат кладётся в F: сила на лодку (fx, fz) и угол атаки alpha (рад, со знаком).
const F = { fx: 0, fz: 0, alpha: 0, stalled: false };
function foil(ux, uz, cx, cz, f, area, rho) {
  const V2 = ux * ux + uz * uz;
  if (V2 < 1e-6 || area <= 0) { F.fx = 0; F.fz = 0; F.alpha = 0; F.stalled = false; return F; }
  const V = Math.sqrt(V2);
  let rev = 1;
  if (ux * cx + uz * cz < 0) { cx = -cx; cz = -cz; rev = 0.5; }       // задний ход: профиль идёт хвостом вперёд
  const sn = clamp((ux * cz - uz * cx) / V, -1, 1), alpha = Math.asin(sn), a = Math.abs(alpha), sg = Math.sign(alpha);
  const aStall = f.clMax / f.slope;
  const clPre = Math.min(f.slope * a, f.clMax), cdPre = f.cd0 + f.kInd * clPre * clPre;
  const t = smooth(aStall, aStall + 6 * DEG, a);
  const cl = (clPre * (1 - t) + Math.sin(2 * a) * 0.95 * t) * rev;
  const cd = cdPre * (1 - t) + (f.cd0 + 1.9 * sn * sn) * t;
  const q = 0.5 * rho * area * V2;
  F.fx = q * (cl * sg * (-uz / V) - cd * ux / V);
  F.fz = q * (cl * sg * (ux / V) - cd * uz / V);
  F.alpha = alpha; F.stalled = a > aStall + 2 * DEG;
  return F;
}

export function createState() {
  return {
    x: 0, z: 0,            // позиция, м (мир: x — восток, z — юг; север = −z)
    heading: 90,           // курс, град
    vf: 1.5,               // скорость вперёд, м/с (назад — отрицательная)
    vs: 0,                 // боковая скорость (дрейф), м/с, + к правому борту
    yawRate: 0,            // угловая скорость поворота, град/с, + вправо
    heel: 0,               // крен, град, + на левый борт
    rollRate: 0,           // угловая скорость крена, град/с
    boom: 45,              // угол гика, град, + по правому борту
    boomRate: 0,           // угловая скорость гика, рад/с
    sheetNow: 45,          // сколько шкота выбрано на самом деле (ограничитель гика), град
    side: -1,              // откуда ветер: +1 правый борт, −1 левый
    sailSide: -1,          // в какую сторону выгнут парус (плавно)
    rudder: 0,             // угол руля, град, + поворот вправо
    crewY: -0.5,           // центр тяжести матроса поперёк лодки, м, + правый борт
    depower: 0,            // на сколько автошкот потравил парус, чтобы снять перегруз, град
    twist: 0, rollAmp: 0, rollPhase: 0, trim: { vang: 0.5, cunn: 0, out: 0.45 },   // настройки паруса сейчас: оттяжка гика, каннингхэм, оттяжка шкотового угла
    taut: 1,               // натянут ли шкот: 1 — гик упёрся и парус держит форму, 0 — гик болтается свободно
    heelMoment: 0,         // сглаженный кренящий момент, как его чувствует матрос, Н·м
    hike: 0,               // откренивание 0..1 (для фигуры матроса)
    board: 1,              // шверт: 1 — опущен
    capsized: 0,           // таймер оверкиля (0 — нет)
    capsizeSide: 1,
    righting: 0,           // таймер подъёма лодки (0 — лежит)
    flop: -10,             // когда лодку перебросило при подъёме мачтой на ветер
    capsizes: 0,           // сколько раз подряд лодка легла
    rt: 0, rtSide: 0, rtT: 0, rtGain: 0,   // поворот с перекатом: фаза, с какого галса, таймер
    lastGybe: { time: -1, kick: 0, crossed: false }, // последний удар гика в шкот и был ли это перелёт с борта на борт
    stopSide: 1,           // на каком борту гик в последний раз упирался в шкот
    gust: { speed: 0, dir: 0, seed: Math.random() * 1000 },
    time: 0,
    out: {},
  };
}

export const defaultControls = () => ({
  windFrom: 0, windSpeed: 10, sheet: 45, rudder: 0,
  lockHeading: false, autoSheet: false, paused: false, gusts: true,
  autoTrim: true, vang: 0.5, cunn: 0, out: 0.45,   // настройки паруса: авто или вручную, 0..1
  rollTack: true,          // матрос делает оверштаг с перекатом
  autoRight: true,         // после переворота матрос сам разворачивает и поднимает лодку
  rightBoat: false,        // команда «встать на шверт» (разовая)
  swimBow: false,          // матрос в воде разворачивает лодку носом к ветру
});

export function pointOfSail(twaAbs) {
  if (twaAbs < 42) return { key: 'irons', name: 'Левентик', desc: 'мёртвая зона' };
  if (twaAbs < 60) return { key: 'closehauled', name: 'Крутой бейдевинд', desc: 'лавировка' };
  if (twaAbs < 80) return { key: 'closereach', name: 'Бейдевинд', desc: 'против ветра' };
  if (twaAbs < 100) return { key: 'beam', name: 'Галфвинд', desc: 'ветер в борт' };
  if (twaAbs < 150) return { key: 'broad', name: 'Бакштаг', desc: 'попутно-боковой' };
  return { key: 'run', name: 'Фордевинд', desc: 'ветер в корму' };
}

export function compassName(deg) {
  const names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return names[Math.round(norm360(deg) / 45) % 8];
}

export function optimalSheet(awaAbs) {
  if (awaAbs > 135) return 90;
  return clamp(awaAbs - 16, BOAT.boomMin, 90);
}

// Ставит гик под ветер, а матроса на наветренный борт: вызывается после того, как лодку переставили.
// Настройки паруса, которые выставил бы опытный матрос: 0 — отпущено, 1 — набито до упора.
// Оттяжка гика держит гик внизу и не даёт верху паруса раскрыться, каннингхэм уплощает верх,
// оттяжка шкотового угла (аутхол) убирает пузо внизу.
export function autoTrim(windKn, twaAbs, o) {
  const breeze = smooth(8, 18, windKn), off = smooth(60, 115, twaAbs);
  o.vang = (0.35 + 0.55 * breeze) * (1 - off) + (0.6 + 0.25 * smooth(6, 12, windKn) + 0.1 * smooth(14, 24, windKn)) * off;   // на попутных оттяжку добивают уже в средний ветер, иначе раскачает
  o.cunn = breeze * (1 - off);
  o.out = (0.45 + 0.45 * breeze) * (1 - off) + 0.25 * off;
  return o;
}
const TRIM_T = { vang: 0, cunn: 0, out: 0 };

export function settleRig(state, ctl) {
  const twa = norm180(ctl.windFrom - state.heading);
  state.side = twa >= 0 ? 1 : -1; state.sailSide = state.side;
  state.sheetNow = ctl.sheet;
  state.boom = -state.side * Math.min(ctl.sheet, Math.abs(twa)); state.boomRate = 0;
  state.crewY = state.side * 0.5; state.heelMoment = 0; state.depower = 0; state.taut = 1;
  state.heel = 0; state.rollRate = 0; state.yawRate = 0; state.vs = 0;
  state.rudder = 0; state.capsized = 0; state.righting = 0; state.rt = 0; state.lastGybe = { time: -1, kick: 0, crossed: false }; state.stopSide = Math.sign(state.boom) || 1; state.rollAmp = 0;
}

// Запасной порыв без привязки к месту (для проверок без сцены)
function gustNoise(t, seed) {
  const s = Math.sin(t * 0.21 + seed) * 0.5 + Math.sin(t * 0.47 + seed * 1.7) * 0.3 + Math.sin(t * 1.1 + seed * 0.3) * 0.2;
  const d = Math.sin(t * 0.13 + seed * 2.1) * 0.6 + Math.sin(t * 0.33 + seed * 0.7) * 0.4;
  return { speed: s, dir: d };
}

// Один шаг. env (необязательно) — среда: порыв в точке лодки { gustSpeed, gustDir } и высота волны heightAt(x, z, minL).
export function step(state, ctl, dt, env = null) {
  const B = BOAT;
  const psi = state.heading * DEG;
  const fx = Math.sin(psi), fz = -Math.cos(psi);     // вперёд
  const sx = Math.cos(psi), sz = Math.sin(psi);      // правый борт

  // ---- ветер с порывами ----
  let windKn = ctl.windSpeed, windFrom = ctl.windFrom;
  if (ctl.gusts) {
    let gs, gd;
    if (env) { gs = env.gustSpeed; gd = env.gustDir; }
    else { const g = gustNoise(state.time, state.gust.seed); gs = g.speed; gd = g.dir; }
    state.gust.speed = gs; state.gust.dir = gd;
    windKn = Math.max(1, ctl.windSpeed * (1 + 0.22 * gs));
    windFrom = ctl.windFrom + 9 * gd;
  } else { state.gust.speed = 0; state.gust.dir = 0; }
  const Vw = windKn * KN, phiW = windFrom * DEG;
  const Wx = -Vw * Math.sin(phiW), Wz = Vw * Math.cos(phiW);          // куда дует, мир
  const Wf = Wx * fx + Wz * fz, Ws = Wx * sx + Wz * sz;               // и в осях лодки

  let u = state.vf, v = state.vs, r = state.yawRate * DEG, p = state.rollRate * DEG;
  const phi = state.heel * DEG, cph = Math.cos(phi), sph = Math.sin(phi);
  const Vx = u * fx + v * sx, Vz = u * fz + v * sz;

  // ---- вымпельный ветер в центре масс (для приборов) ----
  const aF0 = Wf - u, aS0 = Ws - v;
  const AWS = Math.hypot(aF0, aS0);
  const AWA = Math.atan2(-aS0, -aF0) / DEG;                           // откуда, + справа
  const TWA = norm180(windFrom - state.heading);
  const awaAbs = Math.abs(AWA), twaAbs = Math.abs(TWA);
  // С какого борта ветер. На полных курсах галс определяет гик: вымпельный ветер гуляет через корму
  // то слева, то справа, а матрос от этого не пересаживается, он сидит напротив гика.
  if (awaAbs > 0.5 && AWS > 0.05) state.side = awaAbs > 110 && Math.abs(state.boom) > 15 ? -Math.sign(state.boom) : (AWA >= 0 ? 1 : -1);
  const side = state.side;

  // ---- шкот и руль доходят до заданного не мгновенно ----
  // Автошкот ведёт себя как опытный матрос: когда откренивать уже нечем, травит шкот, чтобы лодка шла ровно
  if (ctl.autoSheet && !ctl.paused) {
    const over = Math.abs(state.heel) - 9, maxed = state.hike > 0.9;
    if (over > 0 && maxed) state.depower += Math.min(30, 4 + over * 2.5) * dt;
    else if (Math.abs(state.heel) < 6 || !maxed) state.depower -= 5 * dt;
    state.depower = clamp(state.depower, 0, 45);
  } else if (!ctl.autoSheet) state.depower = 0;
  // на фордевинде в свежий ветер гик чуть не доводят до упора: так верх паруса не уходит вперёд мачты
  const sheetCmd = ctl.autoSheet ? (awaAbs > 135 ? 90 - 8 * smooth(8, 16, windKn) : clamp(optimalSheet(awaAbs) - 0.38 * (state.twist || 0) + state.depower, B.boomMin, 90)) : Math.max(B.boomMin, ctl.sheet);
  const capsized = state.capsized > 0;
  if (!ctl.paused) {
    const ds = sheetCmd - state.sheetNow;
    state.sheetNow += clamp(ds, -55 * dt, 130 * dt);                  // выбирать тяжелее, чем травить
    state.rudder += clamp(ctl.rudder - state.rudder, -B.rudderRate * dt, B.rudderRate * dt);
    const boardTarget = twaAbs > 150 ? 0.45 : twaAbs > 110 ? 0.7 : 1;  // на попутных курсах шверт приподнят
    state.board += (boardTarget - state.board) * Math.min(1, dt * 0.8);
  }

  // ---- парус: угол атаки от настоящего положения гика ----
  const beta = state.boom * DEG, cb = Math.cos(beta), sb = Math.sin(beta);
  const xce = B.mastX - cb * B.ceArm, zce = sb * B.ceArm - B.ceHeight * sph;   // центр парусности; при крене уходит под ветер
  const aF = Wf - (u - r * zce), aS = Ws - (v + r * xce - p * B.ceHeight * cph);
  const aws = Math.hypot(aF, aS), q = 0.5 * B.rhoAir * aws * aws;
  const bF = -cb, bS = sb;                                            // хорда: от мачты к шкотовому углу
  const alphaS = Math.atan2(bF * aS - bS * aF, bF * aF + bS * aS);    // угол атаки со знаком, + ветер в правую сторону паруса
  const aAbs = Math.abs(alphaS) / DEG, aEff = aAbs > 90 ? 180 - aAbs : aAbs;
  // твист: пока шкот выбран, гик вниз тянет он сам; чем дальше гик вытравлен, тем больше работа оттяжки
  const tr = state.trim;
  const ease = clamp((Math.abs(state.boom) - B.boomMin) / (90 - B.boomMin), 0, 1);
  const twist = (2 + 4 * tr.cunn + (1 - 0.85 * tr.vang) * 24 * Math.pow(ease, 0.7)) * smooth(0.5, 4, aws);
  state.twist = twist;
  const aoa = Math.max(0, aEff - 0.38 * twist);                      // средний угол атаки по высоте паруса: его показывают колдунчики
  let Ff = 0, Fs = 0, boomMoment = 0, sailK = 0, topPast = 0, lee = 0, leeLimit = 40;
  const { CL, CD } = sailCoeffs(aEff);
  // настройки паруса доходят до заданных плавно
  if (ctl.autoTrim !== false) autoTrim(ctl.windSpeed, twaAbs, TRIM_T); else { TRIM_T.vang = ctl.vang; TRIM_T.cunn = ctl.cunn; TRIM_T.out = ctl.out; }
  if (!ctl.paused) { const kt = Math.min(1, dt * 1.2); tr.vang += (TRIM_T.vang - tr.vang) * kt; tr.cunn += (TRIM_T.cunn - tr.cunn) * kt; tr.out += (TRIM_T.out - tr.out) * kt; }
  const depth = 1 - tr.out, ceK = 1 - 0.09 * tr.cunn;
  if (aws > 0.05) {
    const ahF = aF / aws, ahS = aS / aws;                             // направление потока
    const hold = 0.3 + 0.7 * state.taut;                              // пока гик не упёрся в шкот, парус болтается и толком не тянет
    const kA = q * B.sailArea * Math.pow(Math.max(0, cph), 1.3);      // накренённый парус теряет площадь
    for (let i = 0; i < 2; i++) {
      // нижняя полоса: 62% площади, стоит как гик, её пузо задаёт оттяжка шкотового угла;
      // верхняя: 38% площади, раскрыта на угол твиста, её уплощает каннингхэм
      const bi = beta + (i ? Math.sign(state.boom || 1) * twist * DEG : 0), cF = -Math.cos(bi), cS = Math.sin(bi);
      const al = Math.abs(Math.atan2(cF * aS - cS * aF, cF * aF + cS * aS)) / DEG, ae = al > 90 ? 180 - al : al;
      const c = i ? sailCoeffs(ae) : { CL, CD };
      let nF = -cS, nS = cF; if (nF * ahF + nS * ahS < 0) { nF = -nF; nS = -nS; }  // нормаль к парусу под ветер
      let lF = -ahS, lS = ahF; if (lF * nF + lS * nS < 0) { lF = -lF; lS = -lS; }  // подъёмная сила — под ветер
      const fill = smooth(1.5, 6, ae);                                // ниже ~5° парус не наполняется и полощет
      const back = al > 90 ? 0.8 : 1;                                 // ветер с задней шкаторины: парус работает хуже, но работает
      const wing = 1 - smooth(24, 36, ae);                            // настройки формы работают, пока парус — крыло
      const shape = i ? 1 - 0.18 * tr.cunn * wing : 1 + (0.22 * depth - 0.12) * wing;
      const dragK = 1 + (i ? -0.14 * tr.cunn : 0.36 * (depth - 0.55)) * wing;   // пузатый парус тянет сильнее, но и тормозит сильнее
      const cl = c.CL * fill * back * hold * shape, cd = (c.CD * dragK * fill + 0.10 * (1 - fill)) * (0.6 + 0.4 * hold);
      const k = kA * (i ? 0.38 : 0.62);
      const f = k * (cl * lF + cd * ahF), s = k * (cl * lS + cd * ahS);
      Ff += f; Fs += s; sailK -= s * (i ? 3.33 : 1.75) * ceK;         // плечо крена у верхней полосы почти вдвое больше
      boomMoment += 0.85 * B.ceArm * (f * sb + s * cb) * (i ? 0.8 : 1.12);
    }
    // Ветер зашёл с подветренной стороны (идём «под ветер»): задняя шкаторина заламывается,
    // парус теряет тягу и перебрасывается на другой борт
    // Чем дальше вынесен гик и чем туже оттяжка, тем дальше «за ветер» можно зайти, пока шкаторина держит.
    if (awaAbs > 90 && Math.sign(AWA) === Math.sign(state.boom) && Math.abs(state.boom) > 3) {
      lee = 180 - awaAbs; leeLimit = clamp(Math.abs(state.boom) - 66, 5, 24) * (0.6 + 0.4 * tr.vang) + 16;
      const flip = smooth(leeLimit - 16, leeLimit, lee), drop = smooth(leeLimit - 6, leeLimit, lee);
      Ff *= 1 - 0.6 * drop; Fs *= 1 - 0.6 * drop;
      boomMoment = boomMoment * (1 - flip) - Math.sign(state.boom) * flip * q * B.sailArea * 0.35 * B.ceArm;
    }
  }
  boomMoment -= B.boomWeight * sph * cb;                              // при крене гик тянет вниз собственный вес
  // в слабый ветер на попутном курсе парус не держит гик: матрос выносит его рукой
  { const press = q * B.sailArea; if (awaAbs > 110 && state.sheetNow > 55 && press < 25) boomMoment += (Math.abs(state.boom) > 20 ? Math.sign(state.boom) : -side) * 30 * (1 - press / 25); }
  const luffing = aEff < 5 && AWS > 0.3 && Math.abs(Math.abs(state.boom) - state.sheetNow) > 1.2;

  // ---- шверт и руль ----
  const bd = B.board, rd = B.rudder, imm = 0.35 + 0.65 * state.board;
  foil(u, v + r * bd.x + p * bd.depth * imm, 1, 0, bd, bd.area * imm, B.rhoWater);
  const Xb = F.fx, Yb = F.fz, alphaB = F.alpha, boardStalled = F.stalled;
  const dl = state.rudder * DEG;
  // руль работает в потоке, уже отклонённом швертом: дрейф он чувствует примерно вполовину
  foil(u, 0.45 * v + r * rd.x + p * rd.depth, Math.cos(dl), -Math.sin(dl), rd, rd.area, B.rhoWater);
  const Xr = F.fx, Yr = F.fz, alphaR = F.alpha, rudderStalled = F.stalled && Math.abs(u) > 0.8;

  // ---- корпус ----
  const heelDrag = 1 + 0.6 * Math.pow(state.heel / 30, 2);
  const Rh = -Math.sign(u) * hullResistance(u) * heelDrag * (u < 0 ? 1.3 : 1);
  const Yh = -(40 * v + 260 * v * Math.abs(v));
  // демпфирование; накренённый корпус приводится. На глиссировании в воде остаётся только корма,
  // и приводящий момент с ростом скорости больше не растёт
  const Nh = -(60 * r + 320 * r * Math.abs(r)) + 80 * u * Math.min(Math.abs(u), 3.2) * sph;
  // парусность корпуса, матроса и рангоута
  const wq = 0.5 * B.rhoAir * AWS;
  const Xw = wq * B.windageF * aF0, Yw = wq * B.windageS * aS0;
  // волна: лодку тянет с переднего склона и тормозит на подъёме
  let Xwave = 0;
  if (env && env.heightAt && !ctl.paused) {
    const hB = env.heightAt(state.x + fx * 1.7, state.z + fz * 1.7, 3.5), hS = env.heightAt(state.x - fx * 1.7, state.z - fz * 1.7, 3.5);
    Xwave = -B.mass * G * 0.45 * (hB - hS) / 3.4;
  }

  // ---- суммы сил и моментов ----
  const X = Ff + Xb + Xr + Rh + Xw + Xwave;
  const Yf = Fs + Yb + Yr + Yh + Yw;
  const N = xce * Fs - zce * Ff + bd.x * Yb + rd.x * Yr + Nh + B.windageX * Yw;
  // Раскачка на фордевинде: когда оттяжка отпущена, верх паруса уходит вперёд мачты, поток срывается
  // то с передней, то с задней шкаторины и качает лодку с борта на борт в такт её собственной качке.
  topPast = smooth(96, 114, Math.abs(state.boom) + twist) * smooth(120, 160, awaAbs) * state.taut;
  state.rollPhase += dt * 2 * Math.PI / 2.1;
  // раскачка нарастает за несколько секунд: есть время заметить и исправить
  if (!ctl.paused) state.rollAmp += (topPast - state.rollAmp) * Math.min(1, dt / (topPast > state.rollAmp ? 7 : 1.5));
  const rollK = state.rollAmp * q * B.sailArea * 3.33 * 0.17 * Math.sin(state.rollPhase);
  const Kext = sailK + rollK + Yb * bd.depth * imm + Yr * rd.depth;            // кренящий момент, + на левый борт

  if (!ctl.paused && !capsized) {
    // ---- матрос: держит лодку ровно, в слабый ветер даёт небольшой крен под ветер ----
    state.heelMoment += (Kext - state.heelMoment) * Math.min(1, dt / 0.35);
    const light = clamp(1 - Math.abs(state.heelMoment) / 220, 0, 1);
    // в слабый ветер против ветра — небольшой крен под ветер (парус держит форму), на попутных — на ветер (лодка идёт без руля)
    const run = smooth(110, 150, twaAbs);
    let phiT = side * DEG * (5 * light * (1 - run) - 6 * run);
    // Поворот с перекатом. Пока лодка приводится, матрос остаётся на старом наветренном борту и валит её на себя;
    // нос проходит ветер, парус наполняется на новом галсе с креном под ветер; тогда матрос переходит и резко
    // выпрямляет лодку. Мачта при этом идёт сквозь воздух и парус даёт толчок: лодка выходит из поворота с ходом.
    if (!state.rt && ctl.rollTack !== false && twaAbs < 20 && twaAbs > 2 && Math.sign(state.yawRate) === Math.sign(TWA) && Math.abs(state.yawRate) > 8 && u > 0.9) {
      state.rt = 1; state.rtSide = side; state.rtT = 0;
    }
    let crewK = 1;
    if (state.rt) {
      state.rtT += dt;
      const amp = (6 + 11 * (1 - smooth(7, 18, windKn))) * DEG;        // в слабый ветер перекат глубже
      if (state.rt === 1 && side !== state.rtSide) state.rt = 2;
      if (state.rt === 2 && twaAbs > 9 && Math.sign(state.boom) === state.rtSide && Math.abs(state.boom) > 5) { state.rt = 3; state.rtT = 0; }
      if (state.rt < 3) phiT = -state.rtSide * amp; else crewK = 2;
      if ((state.rt === 3 && (state.rtT > 2.2 || Math.abs(phi - phiT) < 3 * DEG)) || state.rtT > 6 || (state.rt === 1 && (state.rtT > 3.5 || twaAbs > 50))) state.rt = 0;
    }
    // на фордевинде матрос сидит у центра и гасит качку хуже, чем вися на борту
    let yT = (state.heelMoment - B.mass * G * GZ(phiT)) / (B.crewMass * G) + 1.2 * crewK * (phi - phiT) + (0.45 - 0.08 * run) * p;
    yT = clamp(yT, -B.crewYMax, B.crewYMax);
    const dy = (yT - state.crewY) * Math.min(1, dt / 0.22);
    state.crewY += clamp(dy, -B.crewSpeed * crewK * dt, B.crewSpeed * crewK * dt);
    state.hike = clamp((Math.abs(state.crewY) - 0.45) / 0.6, 0, 1);

    // ---- интегрирование ----
    // качку гасит и сам корпус: чем быстрее идёт лодка, тем сильнее вода держит днище
    const K = Kext - B.mass * G * GZ(phi) - B.crewMass * G * state.crewY * cph - (70 + 26 * Math.min(Math.abs(u), 7)) * p;
    u += (X / B.mU + v * r) * dt;
    v += (Yf / B.mV - u * r) * dt;
    if (ctl.lockHeading) r = 0; else r += (N / B.Izz) * dt;
    p += (K / B.Ixx) * dt;
    let heel = phi + p * dt;
    state.heading = norm360(state.heading + r * dt / DEG);

    // ---- гик: качается под ветром и упирается в шкот ----
    // парус, идущий сквозь воздух вместе с гиком, сильно гасит его качание
    let w = state.boomRate + (boomMoment - (5 + 3.2 * aws) * state.boomRate - 9 * state.boomRate * Math.abs(state.boomRate)) / B.boomI * dt;
    let bm = state.boom + w * dt / DEG;
    const lim = Math.max(B.boomMin, state.sheetNow);
    const pressing = Math.abs(bm) >= lim - 0.3 && boomMoment * Math.sign(bm) > 0;
    state.taut += ((pressing ? 1 : 0) - state.taut) * Math.min(1, dt / (pressing ? 0.08 : 0.25));
    if (Math.abs(bm) > lim) {
      const outward = Math.sign(bm) * w;
      if (outward > 1.2) {                                            // гик с разгона упёрся в шкот: рывок передаётся корпусу
        if (!ctl.lockHeading) r -= B.boomI * w / B.Izz * 0.9;
        // перелёт — это когда гик упёрся в шкот не на том борту, где упирался в прошлый раз
        state.lastGybe = { time: state.time, kick: outward, crossed: Math.sign(bm) !== state.stopSide };
      }
      state.stopSide = Math.sign(bm);
      bm = Math.sign(bm) * lim; if (outward > 0) w = 0;
    }
    state.boom = bm; state.boomRate = w;
    state.sailSide += (Math.sign(alphaS || side) - state.sailSide) * Math.min(1, dt * 10);

    if (Math.abs(heel) > 72 * DEG) { state.capsized = 0.01; state.capsizeSide = Math.sign(heel); state.righting = 0; state.rt = 0; state.capsizes = state.time - state.flop < 6 ? state.capsizes + 1 : 1; }
    state.vf = u; state.vs = v; state.yawRate = r / DEG; state.heel = heel / DEG; state.rollRate = p / DEG;
    state.x += Vx * dt; state.z += Vz * dt; state.time += dt;
  } else if (!ctl.paused && capsized) {
    // Оверкиль. Лодка лежит на борту, её несёт по ветру. Чтобы поднять, матрос встаёт на шверт.
    // Если мачта лежит на ветер, при подъёме ветер подхватывает парус и перебрасывает лодку на другой борт:
    // сначала её надо развернуть носом к ветру.
    state.capsized += dt;
    const k = Math.max(0, 1 - dt * 2);
    state.vf *= k; state.vs *= k; state.yawRate *= k; state.rollRate = 0; state.boomRate = 0; state.rt = 0;
    state.x += Wx * 0.035 * dt; state.z += Wz * 0.035 * dt;
    const mastToWind = -state.capsizeSide === Math.sign(TWA) && twaAbs > 32 && twaAbs < 150;
    if (state.righting > 0) {
      const T = 2.3;
      state.righting += dt;
      state.heel = state.capsizeSide * (86 - 79 * smooth(0, T, state.righting));
      // парус поднимается из воды, ветер давит на него и уводит нос: лодка встаёт уже не в левентике
      if (!state.rightBad && twaAbs < 52) state.heading = norm360(state.heading - (Math.sign(TWA) || 1) * 12 * dt);
      if (state.righting >= T) {
        state.righting = 0;
        if (state.rightBad) {                                         // ветер подхватил парус: лодку перебросило
          state.capsizeSide = -state.capsizeSide; state.capsized = 0.01; state.flop = state.time; state.capsizes++;
        } else {
          const tw = norm180(windFrom - state.heading), sd = tw >= 0 ? 1 : -1, sh = ctl.autoSheet ? 75 : Math.max(B.boomMin, ctl.sheet);
          state.capsized = 0; state.side = sd; state.sailSide = sd; state.sheetNow = Math.max(sh, 60);
          state.boom = -sd * Math.min(state.sheetNow, Math.abs(tw)); state.boomRate = 0; state.taut = 0; state.stopSide = Math.sign(state.boom) || 1;
          state.crewY = sd * 0.35; state.heelMoment = 0; state.depower = ctl.autoSheet ? 30 : 0;
          state.heel = state.capsizeSide * 7; state.rollRate = -state.capsizeSide * 10; state.vf = 0.2; state.vs = 0; state.yawRate = 0; state.rollAmp = 0;
          state.flop = state.time - 3;
        }
      }
    } else {
      state.heel += (state.capsizeSide * 86 - state.heel) * Math.min(1, dt * 2.5);
      const auto = ctl.autoRight !== false && state.capsized > 2.2;
      if (((ctl.swimBow && twaAbs > 26) || (auto && mastToWind)) && twaAbs > 12) state.heading = norm360(state.heading + Math.sign(TWA) * 17 * dt);
      else ctl.swimBow = false;
      if (ctl.rightBoat || (auto && !mastToWind && state.capsized > 3.2)) { state.righting = 0.001; state.rightBad = mastToWind; ctl.swimBow = false; }
    }
    ctl.rightBoat = false;
    state.time += dt;
  }

  // ---- приборы и подсказки ----
  const pos = pointOfSail(twaAbs);
  const speedKn = state.vf / KN;
  const vmgKn = speedKn * Math.cos(TWA * DEG);
  const leeway = Math.atan2(state.vs, Math.max(0.2, Math.abs(state.vf))) / DEG;
  const heelAbs = Math.abs(state.heel);
  const overpowered = heelAbs > 20 && state.hike > 0.95;
  const sternway = state.vf < -0.12;
  const sliding = boardStalled && Math.abs(Fs) > 40 && Math.abs(state.vf) < 1.2;
  const sheet = sheetCmd;

  let sailState, sailClass, hint, hintClass;
  const capNow = state.capsized > 0;
  const mastUpwind = capNow && -state.capsizeSide === Math.sign(TWA) && twaAbs > 32 && twaAbs < 150;
  if (capNow) {
    sailState = 'оверкиль'; sailClass = 'bad'; hintClass = 'bad';
    if (state.righting > 0) hint = state.rightBad ? 'Лодка встаёт, но мачта шла на ветер: сейчас ветер подхватит парус…' : 'Матрос на шверте: лодка встаёт парусом под ветер. Шкот потравлен, гик свободен.';
    else if (state.time - state.flop < 5) hint = 'Лодку перебросило: мачта лежала на ветер, и он подхватил парус на подъёме. Теперь мачта под ветром, можно вставать на шверт.';
    else if (mastUpwind) hint = 'Оверкиль, мачта лежит на ветер. Если поднять лодку сейчас, её перебросит на другой борт. Сначала разверните нос к ветру (G), затем вставайте на шверт (T).';
    else hint = (ctl.autoSheet || ctl.sheet > 45 ? '' : 'Потравите шкот: с выбранным шкотом лодка ляжет снова. ') + 'Оверкиль, мачта лежит под ветер. Вставайте на шверт (T): лодка поднимется.';
  } else if (sternway) {
    sailState = 'задний ход'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Задний ход: руль работает наоборот. Переложите его туда, куда хотите увести корму, и нос уйдёт от ветра.';
  } else if (pos.key === 'irons' && state.vf < 0.6) {
    sailState = 'не работает'; sailClass = 'bad'; hintClass = 'bad';
    hint = 'Левентик: парус полощет, хода нет. Лодку понесёт назад: тогда руль сработает наоборот и развернёт нос от ветра.';
  } else if (pos.key === 'irons') {
    sailState = 'полощет'; sailClass = 'bad'; hintClass = 'bad';
    hint = 'Курс слишком острый, вы в мёртвой зоне. Уваливайтесь от ветра минимум на 45°.';
  } else if (overpowered) {
    sailState = 'перегружен'; sailClass = 'bad'; hintClass = 'bad';
    hint = 'Перегруз: матрос откренивает до предела, крен растёт. Потравите шкот или приведитесь, иначе оверкиль.';
    if (ctl.autoTrim === false && (tr.cunn < 0.5 || tr.out < 0.6)) hint = 'Перегруз: парус слишком пузатый для такого ветра. Набейте каннингхэм и оттяжку шкотового угла, потравите шкот.';
  } else if (rudderStalled) {
    sailState = 'руль сорвал поток'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Руль переложен слишком резко: перо сорвало поток и тормозит. Перекладывайте плавнее, лодка успеет пойти за рулём.';
  } else if (sliding) {
    sailState = 'сносит боком'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Мало хода: шверт сорвал поток, лодку несёт боком. Чуть увалитесь и потравите шкот, чтобы разогнаться.';
  } else if (state.rt) {
    sailState = 'перекат'; sailClass = 'good'; hintClass = 'good';
    hint = state.rt < 3 ? 'Поворот с перекатом: матрос остаётся на старом борту и валит лодку на себя, пока нос проходит ветер.' : 'Перекат: матрос перешёл и резко выпрямляет лодку. Мачта идёт сквозь воздух, парус даёт толчок.';
  } else if (lee > 4 && !capNow) {
    const near = lee > leeLimit - 12;
    sailState = 'за ветер ' + Math.round(lee) + '°'; sailClass = near ? 'warn' : 'good'; hintClass = sailClass;
    hint = near ? `Идёте «за ветер» на ${Math.round(lee)}°: задняя шкаторина вот-вот заломится и гик перебросит. Приведитесь или делайте поворот сами.`
      : `Идёте «за ветер» на ${Math.round(lee)}°: ветер заходит со стороны гика, поток по парусу идёт от задней шкаторины к мачте. Так спускаются по волне. Предел около ${Math.round(leeLimit - 8)}°: туже оттяжка гика, дальше можно зайти.`;
  } else if (awaAbs > 135 && state.rollAmp > 0.3) {
    sailState = 'раскачивает'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Лодку раскачивает: оттяжка гика отпущена, верх паруса ушёл вперёд мачты. Набейте оттяжку или подберите шкот до 70–80°.';
  } else if (awaAbs > 135) {
    if (sheet < 75) { sailState = 'недотравлен'; sailClass = 'warn'; hint = 'Попутный ветер: потравите шкот до упора, чтобы парус встал поперёк ветра.'; hintClass = 'warn'; }
    else { sailState = 'работает как парашют'; sailClass = 'good'; hint = twaAbs > 165 ? 'Фордевинд: матрос у центра, шверт приподнят. Перед поворотом подберите шкот, иначе гик ударит.' : 'Бакштаг: парус раскрыт до упора и тянет сопротивлением, шверт приподнят.'; hintClass = twaAbs > 165 ? 'warn' : 'good'; }
  } else if (luffing || aoa < 5) {
    sailState = 'заполаскивает'; sailClass = 'bad'; hintClass = 'bad';
    hint = 'Парус заполаскивает у передней шкаторины: шкот перетравлен. Подберите шкот, пока он не наполнится.';
  } else if (aoa < 10) {
    sailState = 'недобран'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Угол атаки мал: наветренный колдунчик дёргается вверх. Подберите шкот ещё немного.';
  } else if (aoa <= 23 && ctl.autoTrim === false && windKn < 7 && twaAbs < 80 && (tr.out > 0.7 || tr.cunn > 0.5)) {
    sailState = 'слишком плоский'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Слабый ветер, а парус набит в доску. Отпустите каннингхэм и оттяжку шкотового угла: парусу нужно пузо.';
  } else if (aoa <= 23) {
    sailState = 'оптимально'; sailClass = 'good'; hintClass = 'good';
    hint = pos.key === 'closehauled'
      ? (state.hike > 0.5 ? 'Лавировка: матрос откренивает прямыми ногами, лодка идёт плоско. Так быстрее всего против ветра.' : 'Лавировка в слабый ветер: матрос ближе к центру, лёгкий крен под ветер держит форму паруса.')
      : 'Отличная настройка: оба колдунчика тянутся назад.';
  } else if (sheet >= 88 && aoa > 23) {
    sailState = 'вынесен до упора'; sailClass = 'good'; hintClass = 'good';
    hint = 'Бакштаг: гик до упора, парус тянет сопротивлением. Матрос на наветренном борту, в глиссировании в корме.';
  } else if (aoa <= 38) {
    sailState = 'перебран'; sailClass = 'warn'; hintClass = 'warn';
    hint = 'Шкот перебран: подветренный колдунчик обвис, поток срывается, лодка приводится. Потравите шкот.';
  } else {
    sailState = 'срыв потока'; sailClass = 'bad'; hintClass = 'bad';
    hint = 'Срыв потока: парус почти поперёк ветра. Потравите шкот до угла атаки 15–20°.';
  }

  state.out = {
    AWS, AWA, TWA, twaAbs, awaAbs, aoa, sheet, sheetNow: state.sheetNow, luffing, overpowered, capsized: capNow, rudderStalled, sliding, sternway,
    byLee: lee, leeLimit, rollTack: state.rt, righting: state.righting, mastUpwind,
    windKn, windFrom, gustSpeed: state.gust.speed, gustDir: state.gust.dir,
    Ff, Fs, Fmag: Math.hypot(Ff, Fs), CL, CD, q, twist, trim: tr, rolling: state.rollAmp, alphaB: alphaB / DEG, alphaR: alphaR / DEG, Yb, Yr, Kext,
    speedKn, vmgKn, leeway, pos, tack: side > 0 ? 'правый галс' : 'левый галс',
    tackShort: side > 0 ? 'ПРАВЫЙ' : 'ЛЕВЫЙ',
    sailState, sailClass, hint, hintClass,
    Vx, Vz, Wx, Wz, Ax: Wx - Vx, Az: Wz - Vz, fx, fz, sx, sz,
    forceWorldX: Ff * fx + Fs * sx, forceWorldZ: Ff * fz + Fs * sz,
  };
  return state.out;
}
