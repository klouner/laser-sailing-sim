// Физика швертбота «Лазер»: упрощённая, но качественно верная.
// Оси лодки: x — вперёд (нос), z — правый борт. Курс/направления — компасные, в градусах, по часовой.
export const KN = 0.514444;           // м/с в одном узле
const DEG = Math.PI / 180;

export const BOAT = {
  mass: 140,        // корпус 59 кг + матрос ~80 кг
  sailArea: 7.06,   // м²
  rhoAir: 1.225,
  ceHeight: 2.2,    // высота центра парусности над ватерлинией, м
  rudderRate: 110,  // максимальная скорость перекладки руля, град/с
  rudderStall: 22,  // угол, после которого перо срывает поток, град
};
export const PHYS_DT = 1 / 120;       // фиксированный шаг интегрирования, с

export function norm180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
export function norm360(a) { return ((a % 360) + 360) % 360; }

// Коэффициенты подъёмной силы и сопротивления паруса от угла атаки (град).
export function sailCoeffs(aoa) {
  const a = Math.min(90, Math.max(0, aoa));
  const s = Math.sin(a * DEG), c = Math.cos(a * DEG);
  // до срыва (≤28°): крыло; после — пластина: нормальная сила N≈1.3, CL=N·cosα, CD=N·sinα; между 28° и 40° плавный переход
  const clWing = 1.55 * Math.sin((Math.min(a, 28) / 28) * Math.PI / 2);
  const cdWing = 0.08 + 0.9 * s * s;
  const N = 1.3;
  const clPlate = N * c, cdPlate = 0.08 + N * s;
  const t = a <= 28 ? 0 : Math.min(1, (a - 28) / 12);
  const k = t * t * (3 - 2 * t);
  return { CL: clWing * (1 - k) + clPlate * k, CD: cdWing * (1 - k) + cdPlate * k };
}

export function createState() {
  return {
    x: 0, z: 0,            // позиция, м (мир: x — восток, z — юг; север = -z)
    heading: 90,           // курс, град
    vf: 1.5,               // скорость вперёд, м/с
    vs: 0,                 // боковая скорость (дрейф), м/с, + к правому борту
    yawRate: 0,            // град/с
    heel: 0,               // крен, град (+ = крен на левый борт)
    boom: -45,             // фактический угол гика, град (+ = гик по правому борту)
    side: 1,               // откуда ветер: +1 правый борт, -1 левый
    rudder: 0,             // фактический угол руля (с инерцией перекладки)
    hike: 0,               // откренивание экипажа 0..1 (реакция на крен)
    board: 1,              // шверт: 1 — опущен, 0.5 — наполовину поднят
    capsized: 0,           // таймер оверкиля (0 — нет)
    heelKick: 0,           // затухающий кренящий толчок от перелёта гика, град
    gybe: null,            // незавершённый перелёт гика { travel }
    lastGybe: { time: -1, kick: 0 }, // последний удар гика (для подсказки)
    gust: { speed: 0, dir: 0, t: 0, seed: Math.random() * 1000 },
    time: 0,
    out: {},
  };
}

export const defaultControls = () => ({
  windFrom: 0, windSpeed: 10, sheet: 45, rudder: 0,
  lockHeading: false, autoSheet: false, paused: false, gusts: true,
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
  return Math.min(90, Math.max(0, awaAbs - 17));
}

// Порывы и заходы ветра: плавный шум из нескольких синусоид
function gustNoise(t, seed) {
  const s = Math.sin(t * 0.21 + seed) * 0.5 + Math.sin(t * 0.47 + seed * 1.7) * 0.3 + Math.sin(t * 1.1 + seed * 0.3) * 0.2;
  const d = Math.sin(t * 0.13 + seed * 2.1) * 0.6 + Math.sin(t * 0.33 + seed * 0.7) * 0.4;
  return { speed: s, dir: d }; // примерно −1..1
}

// Один шаг физики. env (необязательно) — порыв в точке лодки: { gustSpeed, gustDir } в диапазоне −1..1.
export function step(state, ctl, dt, env = null) {
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
  const Vw = windKn * KN;
  const phi = windFrom * DEG;
  const wfx = Math.sin(phi), wfz = -Math.cos(phi);
  const Wx = -Vw * wfx, Wz = -Vw * wfz;

  const Vx = state.vf * fx + state.vs * sx;
  const Vz = state.vf * fz + state.vs * sz;

  // ---- вымпельный ветер ----
  const Ax = Wx - Vx, Az = Wz - Vz;
  const AWS = Math.hypot(Ax, Az);
  const afF = -(Ax * fx + Az * fz);
  const afS = -(Ax * sx + Az * sz);
  const AWA = Math.atan2(afS, afF) / DEG;
  const TWA = norm180(windFrom - state.heading);
  const awaAbs = Math.abs(AWA);

  const prevSide = state.side;
  if (awaAbs > 0.5 && AWS > 0.05) state.side = AWA >= 0 ? 1 : -1;
  const side = state.side;

  // ---- гик и угол атаки ----
  const sheet = ctl.autoSheet ? optimalSheet(awaAbs) : ctl.sheet;
  const boomMag = Math.min(sheet, awaAbs);
  const boomTarget = -side * boomMag;
  const luffing = awaAbs < sheet + 1.5 && AWS > 0.3;
  const aoa = Math.max(0, awaAbs - boomMag);
  const q = 0.5 * BOAT.rhoAir * AWS * AWS;

  // ветер перешёл через корму: гик начинает перелёт на другой борт
  if (prevSide !== side && awaAbs > 100 && !state.capsized) state.gybe = { travel: Math.abs(boomTarget - state.boom) };
  // пока гик в полёте, парус почти не тянет
  const transit = state.gybe ? Math.min(1, Math.abs(boomTarget - state.boom) / Math.max(20, state.gybe.travel)) : 0;
  const sailPower = 1 - 0.85 * transit;

  // ---- силы на парусе (накренённый парус теряет эффективную площадь) ----
  const heelRad = Math.abs(state.heel) * DEG;
  const heelEff = Math.pow(Math.cos(heelRad), 1.3);
  const { CL, CD } = sailCoeffs(aoa);
  let Ff = 0, Fs = 0, yawSail = 0;
  if (AWS > 0.05) {
    const flF = -afF / AWS, flS = -afS / AWS;        // направление потока
    // подъёмная сила ⊥ потоку, направлена в сторону подветренной поверхности паруса
    const bm = boomMag * DEG, bz = -side;               // гик вынесен под ветер
    const cF = -Math.cos(bm), cS = bz * Math.sin(bm);    // хорда паруса (от мачты к шкотовому углу)
    let nF = -cS, nS = cF;
    if (nF * afF + nS * afS > 0) { nF = -nF; nS = -nS; }
    let lF = -flS, lS = flF;
    if (lF * nF + lS * nS < 0) { lF = -lF; lS = -lS; }
    const clEff = luffing ? CL * 0.05 : CL;
    const cdEff = luffing ? 0.12 : CD;
    const k = q * BOAT.sailArea * heelEff * sailPower;
    Ff = k * (clEff * lF + cdEff * flF);
    Fs = k * (clEff * lS + cdEff * flS);
    // Руление парусом: центр парусности относительно центра бокового сопротивления.
    // Подобранный парус (ЦП в корме) приводит лодку, вынесенный за борт гик разворачивает её тягой на плече.
    const ceX = 1.0 - 1.05 * Math.cos(bm);            // вперёд от ЦБС, м
    const ceZ = bz * 1.05 * Math.sin(bm);             // к правому борту, м
    yawSail = 0.02 * (ceX * Fs - ceZ * Ff);           // град/с, + = вправо
  }

  // ---- руль: инерция перекладки и срыв потока на больших углах ----
  const dr = ctl.rudder - state.rudder;
  const maxStep = BOAT.rudderRate * dt;
  state.rudder += Math.max(-maxStep, Math.min(maxStep, dr));
  const rAbs = Math.abs(state.rudder), ST = BOAT.rudderStall;
  const rudderEff = Math.sign(state.rudder) * (rAbs <= ST ? rAbs : ST - (rAbs - ST) * 0.55);
  const rudderStalled = rAbs > ST + 2;

  // ---- шверт: на попутных курсах приподнят ----
  const twaAbs0 = Math.abs(TWA);
  const boardTarget = twaAbs0 > 150 ? 0.45 : twaAbs0 > 110 ? 0.7 : 1;
  state.board += (boardTarget - state.board) * Math.min(1, dt * 0.8);

  // ---- сопротивление корпуса ----
  const v = state.vf;
  const hump = Math.exp(-Math.pow((Math.abs(v) - 2.9) / 0.75, 2));
  const rudderDrag = 1 + 0.35 * Math.pow(rAbs / 35, 2) + (rAbs > ST ? 1.1 * Math.pow((rAbs - ST) / (35 - ST), 2) : 0);
  const heelDrag = 1 + 0.8 * Math.pow(Math.abs(state.heel) / 30, 2);     // накренённый корпус тормозит
  const k2 = (9 + 22 * hump) * rudderDrag * heelDrag;
  const leewayDrag = 60 * state.vs * state.vs;                           // дрейф тоже стоит скорости
  const dragF = -(6 * v + k2 * v * Math.abs(v) + leewayDrag * Math.sign(v || 1));
  const aF = (Ff + dragF) / (BOAT.mass * 1.15);                          // с присоединённой массой воды
  // Боковое сопротивление: шверт и руль — это крылья, они держат только на ходу (сила ∝ скорости хода).
  // Без хода остаётся лишь сопротивление корпуса, и лодку сносит боком.
  const foil = 600 * Math.abs(v) * (0.35 + 0.65 * state.board) * (1 - 0.35 * Math.pow(Math.abs(state.heel) / 45, 2));
  const latK = 140 + 180 * Math.abs(state.vs) + foil;
  const aS = (Fs - latK * state.vs) / BOAT.mass;

  // ---- экипаж: откренивание ----
  const hikeTarget = Math.min(1, Math.max(0, (Math.abs(Fs) - 50) / 170));
  const capsized = state.capsized > 0;

  if (!ctl.paused && !capsized) {
    state.vf += aF * dt;
    if (state.vf < 0) state.vf = 0;
    state.vs += aS * dt;

    state.hike += (hikeTarget - state.hike) * Math.min(1, dt * 2.5);

    let yaw = 0;
    if (!ctl.lockHeading) {
      yaw = rudderEff * (0.42 * state.vf + 0.03);
      yaw += side * 0.10 * Math.abs(state.heel) * Math.min(1, state.vf / 0.8); // накренённая лодка приводится
      yaw += yawSail;
    }
    state.yawRate += (yaw - state.yawRate) * Math.min(1, dt * 6);
    state.heading = norm360(state.heading + state.yawRate * dt);

    state.boom += (boomTarget - state.boom) * Math.min(1, dt * 5);
    // гик долетел: удар по крену и рывок к ветру, тем сильнее, чем длиннее полёт и свежее ветер
    if (state.gybe && Math.abs(boomTarget - state.boom) < 0.2 * Math.max(20, state.gybe.travel)) {
      const kick = Math.min(60, 0.0062 * q * state.gybe.travel);
      state.heelKick += side * kick;
      if (!ctl.lockHeading) state.yawRate += side * kick * 0.9;
      state.lastGybe = { time: state.time, kick };
      state.gybe = null;
    }
    state.heelKick *= Math.exp(-dt / 0.6);

    // крен: кренящий момент против восстанавливающего (корпус + матрос)
    const righting = 1 + 1.25 * state.hike;
    const heelMag = Math.min(80, Math.abs(Fs) * 0.11 / righting);
    const heelTarget = side * heelMag + state.yawRate * 0.15 + state.heelKick * 3.0;
    state.heel += (heelTarget - state.heel) * Math.min(1, dt * 1.6);
    if (Math.abs(state.heel) > 58) state.capsized = 0.01;

    state.x += Vx * dt;
    state.z += Vz * dt;
    state.time += dt;
  } else if (!ctl.paused && capsized) {
    // оверкиль: лодка лежит на борту, останавливается, через 4 с матрос ставит её на ровный киль
    state.capsized += dt;
    state.gybe = null; state.heelKick = 0;
    state.vf *= Math.max(0, 1 - dt * 2); state.vs *= Math.max(0, 1 - dt * 2);
    state.heel += (side * 82 - state.heel) * Math.min(1, dt * 2);
    state.boom += (boomTarget - state.boom) * Math.min(1, dt * 5);
    if (state.capsized > 4) { state.capsized = 0; state.heel = side * 10; state.heading = norm360(windFrom + side * 70); state.hike = 0; state.yawRate = 0; }
    state.time += dt;
  }

  const twaAbs = Math.abs(TWA);
  const pos = pointOfSail(twaAbs);
  const speedKn = state.vf / KN;
  const vmgKn = speedKn * Math.cos(TWA * DEG);
  const leeway = Math.atan2(state.vs, Math.max(0.2, state.vf)) / DEG;
  const overpowered = Math.abs(state.heel) > 26 && state.hike > 0.95;
  const sliding = Math.abs(state.vs) > 0.3 && state.vf < 0.8 && Math.abs(Fs) > 40;

  let sailState, sailClass, hint, hintClass;
  if (capsized) {
    sailState = 'оверкиль'; sailClass = 'bad';
    hint = 'Оверкиль! В порыве нужно резко потравить шкот и привестись. Матрос ставит лодку на ровный киль…'; hintClass = 'bad';
  } else if (pos.key === 'irons' && state.vf < 0.6) {
    sailState = 'не работает'; sailClass = 'bad';
    hint = 'Левентик: парус полощет, хода нет. Переложите руль, увалитесь от ветра и подберите шкот.'; hintClass = 'bad';
  } else if (pos.key === 'irons') {
    sailState = 'полощет'; sailClass = 'bad';
    hint = 'Курс слишком острый, вы в мёртвой зоне. Уваливайтесь от ветра минимум на 45°.'; hintClass = 'bad';
  } else if (overpowered) {
    sailState = 'перегружен'; sailClass = 'bad';
    hint = 'Перегруз: матрос откренивает до предела, крен растёт. Потравите шкот или приведитесь, иначе оверкиль.'; hintClass = 'bad';
  } else if (rudderStalled && state.vf > 0.8) {
    sailState = 'руль тормозит'; sailClass = 'warn';
    hint = 'Руль переложен слишком круто: перо срывает поток и тормозит. Достаточно 15–20°, поворачивайте плавно.'; hintClass = 'warn';
  } else if (sliding) {
    sailState = 'сносит боком'; sailClass = 'warn';
    hint = 'Нет хода: шверт не держит, лодку сносит боком. Чуть увалитесь и потравите шкот, чтобы разогнаться.'; hintClass = 'warn';
  } else if (awaAbs > 135) {
    if (sheet < 75) { sailState = 'недотравлен'; sailClass = 'warn'; hint = 'Попутный ветер: потравите шкот до упора, чтобы парус встал поперёк ветра.'; hintClass = 'warn'; }
    else { sailState = 'работает как парашют'; sailClass = 'good'; hint = twaAbs > 165 ? 'Фордевинд: матрос у центра, шверт приподнят. Перед поворотом подберите шкот, иначе гик ударит.' : 'Бакштаг: парус раскрыт до упора и тянет сопротивлением, шверт приподнят.'; hintClass = twaAbs > 165 ? 'warn' : 'good'; }
  } else if (luffing || aoa < 5) {
    sailState = 'заполаскивает'; sailClass = 'bad';
    hint = 'Парус заполаскивает у передней шкаторины: шкот перетравлен. Подберите шкот, пока он не наполнится.'; hintClass = 'bad';
  } else if (aoa < 11) {
    sailState = 'недобран'; sailClass = 'warn';
    hint = 'Угол атаки мал: наветренный колдунчик дёргается вверх. Подберите шкот ещё немного.'; hintClass = 'warn';
  } else if (aoa <= 26) {
    sailState = 'оптимально'; sailClass = 'good';
    hint = pos.key === 'closehauled'
      ? (state.hike > 0.5 ? 'Лавировка: матрос откренивает прямыми ногами, лодка идёт плоско. Так быстрее всего против ветра.' : 'Лавировка в слабый ветер: матрос ближе к центру, лёгкий крен под ветер держит форму паруса.')
      : 'Отличная настройка: оба колдунчика тянутся назад.'; hintClass = 'good';
  } else if (sheet >= 88 && aoa > 26) {
    sailState = 'вынесен до упора'; sailClass = 'good';
    hint = 'Бакштаг: гик до упора, парус тянет сопротивлением. Матрос на наветренном борту, в глиссировании в корме.'; hintClass = 'good';
  } else if (aoa <= 40) {
    sailState = 'перебран'; sailClass = 'warn';
    hint = 'Шкот перебран: подветренный колдунчик обвис, поток срывается, лодка приводится. Потравите шкот.'; hintClass = 'warn';
  } else {
    sailState = 'срыв потока'; sailClass = 'bad';
    hint = 'Срыв потока: парус почти поперёк ветра. Потравите шкот до угла атаки 15–20°.'; hintClass = 'bad';
  }

  state.out = {
    AWS, AWA, TWA, twaAbs, awaAbs, aoa, sheet, boomTarget, luffing, overpowered, capsized, rudderStalled, sliding,
    windKn, windFrom, gustSpeed: state.gust.speed, gustDir: state.gust.dir,
    Ff, Fs, Fmag: Math.hypot(Ff, Fs), CL, CD, q, yawSail,
    speedKn, vmgKn, leeway, pos, tack: side > 0 ? 'правый галс' : 'левый галс',
    tackShort: side > 0 ? 'ПРАВЫЙ' : 'ЛЕВЫЙ', sideChanged: prevSide !== side,
    sailState, sailClass, hint, hintClass,
    Vx, Vz, Wx, Wz, Ax, Az, fx, fz, sx, sz,
    forceWorldX: Ff * fx + Fs * sx, forceWorldZ: Ff * fz + Fs * sz,
  };
  return state.out;
}
