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
};

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

export function step(state, ctl, dt) {
  const psi = state.heading * DEG;
  const fx = Math.sin(psi), fz = -Math.cos(psi);     // вперёд
  const sx = Math.cos(psi), sz = Math.sin(psi);      // правый борт

  // ---- ветер с порывами ----
  let windKn = ctl.windSpeed, windFrom = ctl.windFrom;
  if (ctl.gusts) {
    const g = gustNoise(state.time, state.gust.seed);
    state.gust.speed = g.speed; state.gust.dir = g.dir;
    windKn = Math.max(1, ctl.windSpeed * (1 + 0.22 * g.speed));
    windFrom = ctl.windFrom + 9 * g.dir;
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

  // ---- силы на парусе (с учётом крена: наклонённый парус теряет эффективную площадь) ----
  const heelRad = Math.abs(state.heel) * DEG;
  const heelEff = Math.pow(Math.cos(heelRad), 1.3);
  const q = 0.5 * BOAT.rhoAir * AWS * AWS;
  const { CL, CD } = sailCoeffs(aoa);
  let Ff = 0, Fs = 0;
  if (AWS > 0.05) {
    const flF = -afF / AWS, flS = -afS / AWS;        // направление потока
    // подъёмная сила ⊥ потоку, направлена в сторону подветренной поверхности паруса (нормаль к хорде, «от ветра»)
    const bm = boomMag * DEG, bz = -side;               // гик вынесен под ветер
    const cF = -Math.cos(bm), cS = bz * Math.sin(bm);    // хорда паруса (от мачты к шкотовому углу)
    let nF = -cS, nS = cF;                                // нормаль к хорде
    if (nF * afF + nS * afS > 0) { nF = -nF; nS = -nS; }  // выбираем подветренную нормаль
    let lF = -flS, lS = flF;
    if (lF * nF + lS * nS < 0) { lF = -lF; lS = -lS; }
    const clEff = luffing ? CL * 0.05 : CL;
    const cdEff = luffing ? 0.12 : CD;
    Ff = q * BOAT.sailArea * heelEff * (clEff * lF + cdEff * flF);
    Fs = q * BOAT.sailArea * heelEff * (clEff * lS + cdEff * flS);
  }

  // ---- руль с инерцией перекладки ----
  const dr = ctl.rudder - state.rudder;
  const maxStep = BOAT.rudderRate * dt;
  state.rudder += Math.max(-maxStep, Math.min(maxStep, dr));

  // ---- шверт: на попутных курсах приподнимаем (меньше смоченная поверхность, меньше «зацеп») ----
  const twaAbs0 = Math.abs(TWA);
  const boardTarget = twaAbs0 > 150 ? 0.45 : twaAbs0 > 110 ? 0.7 : 1;
  state.board += (boardTarget - state.board) * Math.min(1, dt * 0.8);

  // ---- сопротивление корпуса ----
  const v = state.vf;
  const hump = Math.exp(-Math.pow((Math.abs(v) - 2.9) / 0.75, 2));
  const rudderDrag = 1 + 0.6 * Math.abs(state.rudder) / 35;
  const heelDrag = 1 + 0.8 * Math.pow(Math.abs(state.heel) / 30, 2);     // накренённый корпус тормозит
  const k2 = (9 + 22 * hump) * rudderDrag * heelDrag;
  const dragF = -(6 * v + k2 * v * Math.abs(v));
  const aF = (Ff + dragF) / BOAT.mass;
  const latK = 900 * (0.4 + 0.6 * state.board) * (1 - 0.5 * Math.pow(Math.abs(state.heel) / 45, 2)); // крен и поднятый шверт → больше дрейф
  const aS = (Fs - latK * state.vs) / BOAT.mass;

  // ---- экипаж: откренивание ----
  // матрос вывешивается пропорционально кренящей силе; его момент держит лодку плоской до ~Fs≈220 Н
  const hikeTarget = Math.min(1, Math.max(0, (Math.abs(Fs) - 50) / 170));
  const capsized = state.capsized > 0;

  if (!ctl.paused && !capsized) {
    state.vf += aF * dt;
    if (state.vf < 0) state.vf = 0;
    state.vs += aS * dt;

    state.hike += (hikeTarget - state.hike) * Math.min(1, dt * 2.5);

    let yaw = 0;
    if (!ctl.lockHeading) {
      yaw = state.rudder * (0.42 * state.vf + 0.03);
      yaw += side * 0.10 * Math.abs(state.heel) * Math.min(1, state.vf / 0.8); // накренённая лодка приводится
    }
    state.yawRate += (yaw - state.yawRate) * Math.min(1, dt * 6);
    state.heading = norm360(state.heading + state.yawRate * dt);

    // крен: кренящий момент против восстанавливающего (корпус + матрос)
    const righting = 1 + 1.25 * state.hike;                 // откренивание экипажа усиливает остойчивость
    const heelMag = Math.min(80, Math.abs(Fs) * 0.11 / righting);
    const heelTarget = -side * heelMag + (-state.yawRate * 0.15); // центробежный крен при повороте
    state.heel += (heelTarget - state.heel) * Math.min(1, dt * 1.6);
    if (Math.abs(state.heel) > 58) state.capsized = 0.01;

    state.boom += (boomTarget - state.boom) * Math.min(1, dt * 5);

    state.x += Vx * dt;
    state.z += Vz * dt;
    state.time += dt;
  } else if (!ctl.paused && capsized) {
    // оверкиль: лодка лежит на борту, останавливается, через 4 с матрос ставит её на ровный киль
    state.capsized += dt;
    state.vf *= Math.max(0, 1 - dt * 2); state.vs *= Math.max(0, 1 - dt * 2);
    state.heel += (-side * 82 - state.heel) * Math.min(1, dt * 2);
    state.boom += (boomTarget - state.boom) * Math.min(1, dt * 5);
    if (state.capsized > 4) { state.capsized = 0; state.heel = -side * 10; state.heading = norm360(windFrom + side * 70); state.hike = 0; }
    state.time += dt;
  }

  const twaAbs = Math.abs(TWA);
  const pos = pointOfSail(twaAbs);
  const speedKn = state.vf / KN;
  const vmgKn = speedKn * Math.cos(TWA * DEG);
  const leeway = Math.atan2(state.vs, Math.max(0.2, state.vf)) / DEG;
  const overpowered = Math.abs(state.heel) > 26 && state.hike > 0.95;

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
  } else if (awaAbs > 135) {
    if (sheet < 75) { sailState = 'недотравлен'; sailClass = 'warn'; hint = 'Попутный ветер: потравите шкот до упора, чтобы парус встал поперёк ветра.'; hintClass = 'warn'; }
    else { sailState = 'работает как парашют'; sailClass = 'good'; hint = twaAbs > 165 ? 'Фордевинд: матрос у центра, шверт приподнят. Осторожно: гик может перелететь.' : 'Бакштаг: парус раскрыт до упора и тянет сопротивлением, шверт приподнят.'; hintClass = twaAbs > 165 ? 'warn' : 'good'; }
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
    hint = 'Шкот перебран: подветренный колдунчик обвис, поток срывается, крен растёт. Потравите шкот.'; hintClass = 'warn';
  } else {
    sailState = 'срыв потока'; sailClass = 'bad';
    hint = 'Срыв потока: парус почти поперёк ветра. Потравите шкот до угла атаки 15–20°.'; hintClass = 'bad';
  }

  state.out = {
    AWS, AWA, TWA, twaAbs, awaAbs, aoa, sheet, boomTarget, luffing, overpowered, capsized,
    windKn, windFrom, gustSpeed: state.gust.speed, gustDir: state.gust.dir,
    Ff, Fs, Fmag: Math.hypot(Ff, Fs), CL, CD, q,
    speedKn, vmgKn, leeway, pos, tack: side > 0 ? 'правый галс' : 'левый галс',
    tackShort: side > 0 ? 'ПРАВЫЙ' : 'ЛЕВЫЙ', sideChanged: prevSide !== side,
    sailState, sailClass, hint, hintClass,
    Vx, Vz, Wx, Wz, Ax, Az, fx, fz, sx, sz,
    forceWorldX: Ff * fx + Fs * sx, forceWorldZ: Ff * fz + Fs * sz,
  };
  return state.out;
}
