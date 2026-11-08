// Упрощённая, но качественно верная физика швертбота «Лазер».
// Оси лодки: x — вперёд (нос), z — правый борт. Курс/направления — компасные, в градусах, по часовой.
export const KN = 0.514444;           // м/с в одном узле
const DEG = Math.PI / 180;

export const BOAT = {
  mass: 140,        // корпус 59 кг + матрос ~80 кг
  sailArea: 7.06,   // м²
  rhoAir: 1.225,
  ceHeight: 2.2,    // высота центра парусности над ватерлинией, м
};

export function norm180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
export function norm360(a) { return ((a % 360) + 360) % 360; }

// Коэффициенты подъёмной силы и сопротивления паруса от угла атаки (град).
export function sailCoeffs(aoa) {
  const a = Math.min(90, Math.max(0, aoa));
  let CL;
  if (a <= 28) CL = 1.55 * Math.sin((a / 28) * Math.PI / 2);
  else CL = 1.55 * Math.cos(((a - 28) / 62) * Math.PI / 2);
  const s = Math.sin(a * DEG);
  const CD = 0.08 + 1.25 * s * s;
  return { CL, CD };
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
    time: 0,
    // выходные величины (заполняются в step)
    out: {},
  };
}

export const defaultControls = () => ({
  windFrom: 0, windSpeed: 10, sheet: 45, rudder: 0,
  lockHeading: false, autoSheet: false, paused: false,
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

// Оптимальный ограничитель шкота для текущего вымпельного ветра
export function optimalSheet(awaAbs) {
  if (awaAbs > 135) return 90;
  return Math.min(90, Math.max(0, awaAbs - 17));
}

export function step(state, ctl, dt) {
  const psi = state.heading * DEG;
  // орты лодки в мире (x — восток, z — юг)
  const fx = Math.sin(psi), fz = -Math.cos(psi);     // вперёд
  const sx = Math.cos(psi), sz = Math.sin(psi);      // правый борт

  const Vw = ctl.windSpeed * KN;
  const phi = ctl.windFrom * DEG;
  const wfx = Math.sin(phi), wfz = -Math.cos(phi);   // единичный вектор «откуда»
  const Wx = -Vw * wfx, Wz = -Vw * wfz;              // скорость ветра (куда дует)

  const Vx = state.vf * fx + state.vs * sx;
  const Vz = state.vf * fz + state.vs * sz;

  // вымпельный ветер
  const Ax = Wx - Vx, Az = Wz - Vz;
  const AWS = Math.hypot(Ax, Az);
  const afF = -(Ax * fx + Az * fz);   // компонента «откуда» вдоль носа
  const afS = -(Ax * sx + Az * sz);   // компонента «откуда» к правому борту
  let AWA = Math.atan2(afS, afF) / DEG;             // + ветер справа
  const TWA = norm180(ctl.windFrom - state.heading);
  const awaAbs = Math.abs(AWA);

  if (awaAbs > 0.5 && AWS > 0.05) state.side = AWA >= 0 ? 1 : -1;
  const side = state.side;

  // гик: уходит под ветер до ограничителя шкота
  const sheet = ctl.autoSheet ? optimalSheet(awaAbs) : ctl.sheet;
  const boomMag = Math.min(sheet, awaAbs);
  const boomTarget = -side * boomMag;
  const luffing = awaAbs < sheet + 1.5 && AWS > 0.3;
  const aoa = Math.max(0, awaAbs - boomMag);

  // силы на парусе
  const q = 0.5 * BOAT.rhoAir * AWS * AWS;
  const { CL, CD } = sailCoeffs(aoa);
  let Ff = 0, Fs = 0;
  if (AWS > 0.05) {
    const flF = -afF / AWS, flS = -afS / AWS;     // направление потока
    let lF = -flS, lS = flF;                      // перпендикуляр
    if (lS * (-side) < 0) { lF = -lF; lS = -lS; } // подъёмная сила — под ветер
    const clEff = luffing ? CL * 0.05 : CL;
    const cdEff = luffing ? 0.12 : CD;
    Ff = q * BOAT.sailArea * (clEff * lF + cdEff * flF);
    Fs = q * BOAT.sailArea * (clEff * lS + cdEff * flS);
  }

  // сопротивление корпуса: вязкостное + горб волнового сопротивления у «скорости корпуса»
  const v = state.vf;
  const hump = Math.exp(-Math.pow((Math.abs(v) - 2.9) / 0.75, 2));
  const rudderDrag = 1 + 0.5 * Math.abs(ctl.rudder) / 35;
  const k2 = (9 + 22 * hump) * rudderDrag;
  const dragF = -(6 * v + k2 * v * Math.abs(v));
  const aF = (Ff + dragF) / BOAT.mass;
  const aS = (Fs - 900 * state.vs) / BOAT.mass;

  if (!ctl.paused) {
    state.vf += aF * dt;
    if (state.vf < 0) state.vf = 0;
    state.vs += aS * dt;

    // поворот: руль работает на ходу; накренённая лодка приводится
    let yaw = 0;
    if (!ctl.lockHeading) {
      yaw = ctl.rudder * (0.42 * state.vf + 0.03);
      yaw += side * 0.08 * Math.abs(state.heel) * Math.min(1, state.vf / 0.8);
    }
    state.yawRate += (yaw - state.yawRate) * Math.min(1, dt * 6);
    state.heading = norm360(state.heading + state.yawRate * dt);

    // крен: боковая сила × плечо, матрос откренивает
    const heelTarget = -side * Math.min(42, Math.abs(Fs) * 0.075);
    state.heel += (heelTarget - state.heel) * Math.min(1, dt * 1.8);

    // гик с задержкой (перелёт при повороте фордевинд)
    state.boom += (boomTarget - state.boom) * Math.min(1, dt * 5);

    state.x += Vx * dt;
    state.z += Vz * dt;
    state.time += dt;
  }

  const twaAbs = Math.abs(TWA);
  const pos = pointOfSail(twaAbs);
  const speedKn = state.vf / KN;
  const vmgKn = speedKn * Math.cos(TWA * DEG);
  const leeway = Math.atan2(state.vs, Math.max(0.2, state.vf)) / DEG;

  // оценка настройки паруса
  let sailState, sailClass, hint, hintClass;
  if (pos.key === 'irons' && state.vf < 0.6) {
    sailState = 'не работает'; sailClass = 'bad';
    hint = 'Лодка в левентике: парус полощет, хода нет. Переложите руль, чтобы увалиться от ветра, и подберите шкот.'; hintClass = 'bad';
  } else if (pos.key === 'irons') {
    sailState = 'полощет'; sailClass = 'bad';
    hint = 'Курс слишком острый — вы в мёртвой зоне. Уваливайтесь (отворачивайте от ветра) минимум на 45°.'; hintClass = 'bad';
  } else if (awaAbs > 135) {
    if (sheet < 75) { sailState = 'недотравлен'; sailClass = 'warn'; hint = 'Попутный ветер: потравите шкот до упора, чтобы парус встал поперёк ветра.'; hintClass = 'warn'; }
    else { sailState = 'работает как парашют'; sailClass = 'good'; hint = twaAbs > 165 ? 'Фордевинд. Осторожно: при заходе ветра за корму гик резко перелетит (поворот фордевинд).' : 'Бакштаг/фордевинд: парус полностью раскрыт, тянет сопротивлением.'; hintClass = twaAbs > 165 ? 'warn' : 'good'; }
  } else if (luffing || aoa < 5) {
    sailState = 'заполаскивает'; sailClass = 'bad';
    hint = 'Парус заполаскивает — шкот перетравлен. Подберите шкот (W / ↑), пока передняя шкаторина не наполнится.'; hintClass = 'bad';
  } else if (aoa < 11) {
    sailState = 'недобран'; sailClass = 'warn';
    hint = 'Парус наполнен, но угол атаки мал. Подберите шкот ещё немного — тяга вырастет.'; hintClass = 'warn';
  } else if (aoa <= 26) {
    sailState = 'оптимально'; sailClass = 'good';
    hint = pos.key === 'closehauled' ? 'Отличная настройка. Это лавировка: так лодка максимально быстро идёт против ветра.' : 'Отличная настройка паруса: угол атаки в рабочем диапазоне.'; hintClass = 'good';
  } else if (aoa <= 40) {
    sailState = 'перебран'; sailClass = 'warn';
    hint = 'Шкот перебран: поток срывается, крен растёт, а тяга падает. Потравите шкот (S / ↓).'; hintClass = 'warn';
  } else {
    sailState = 'срыв потока'; sailClass = 'bad';
    hint = 'Парус стоит почти поперёк ветра — срыв потока. Потравите шкот, пока угол атаки не станет 15–20°.'; hintClass = 'bad';
  }

  state.out = {
    AWS, AWA, TWA, twaAbs, awaAbs, aoa, sheet, boomTarget, luffing,
    Ff, Fs, Fmag: Math.hypot(Ff, Fs), CL, CD, q,
    speedKn, vmgKn, leeway, pos, tack: side > 0 ? 'правый галс' : 'левый галс',
    tackShort: side > 0 ? 'ПРАВЫЙ' : 'ЛЕВЫЙ',
    sailState, sailClass, hint, hintClass,
    Vx, Vz, Wx, Wz, Ax, Az, fx, fz, sx, sz,
    forceWorldX: Ff * fx + Fs * sx, forceWorldZ: Ff * fz + Fs * sz,
  };
  return state.out;
}
