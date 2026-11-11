// Уроки: постановка ситуации + проверка цели
import { KN, settleRig, norm180 } from './physics.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pc = (x) => Math.round(x * 100) + '%';
// сколько секунд подряд выполняется условие ok
function hold(mem, el, ok) { const dt = el - (mem.last === undefined ? el : mem.last); mem.last = el; mem.hold = ok ? (mem.hold || 0) + dt : 0; return mem.hold; }

export const LESSONS = [
  {
    id: 'irons', group: 'Основы', title: 'Выход из левентика',
    goal: 'Лодка стоит носом в ветер. Потрави шкот и дождись заднего хода. На заднем ходу руль работает наоборот: переложи его и держи, пока нос не уйдёт от ветра на 45°. Потом подбери шкот и разгонись до 2 узлов.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 4; state.vf = 0; state.vs = 0; ctl.sheet = 30; },
    check(out, state, el) {
      const p = Math.min(1, Math.max(0, (out.twaAbs - 4) / 41)) * 0.6 + Math.min(1, Math.max(0, out.speedKn) / 2) * 0.4;
      const note = out.sternway ? 'Задний ход: руль работает наоборот, держи его переложенным' : out.twaAbs < 40 ? (out.sheet < 50 ? 'Потрави шкот, пусть лодку понесёт назад' : 'Жди заднего хода и перекладывай руль') : 'Нос ушёл от ветра: руль прямо, подбирай шкот';
      return { progress: p, done: out.twaAbs >= 45 && out.speedKn >= 2, note };
    },
  },
  {
    id: 'trim', title: 'Настройка шкота',
    goal: 'Шкот полностью потравлен, парус полощет. Подбирай шкот, пока угол атаки не станет 12–25°, и удержи его 3 секунды.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 90; state.vf = 1.0; ctl.sheet = 90; ctl.lockHeading = true; },
    check(out, state, el, mem) {
      const ok = out.aoa >= 12 && out.aoa <= 25 && !out.luffing;
      mem.hold = ok ? (mem.hold || 0) + el - (mem.last || el) : 0; mem.last = el;
      return { progress: Math.min(1, (mem.hold || 0) / 3), done: (mem.hold || 0) >= 3, note: ok ? 'Так держать…' : out.aoa < 12 ? 'Подбери шкот' : 'Перебрал — потрави' };
    },
    teardown(ctl) { ctl.lockHeading = false; },
  },
  {
    id: 'tack', title: 'Оверштаг',
    goal: 'Идёшь в бейдевинд левым галсом. Поверни носом через ветер и ляг в бейдевинд правым галсом (40–65° к ветру), сохранив ход 2 узла.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 45; state.vf = 2.5; ctl.sheet = 15; state.side = -1; },
    check(out, state, el) {
      if (state.vf < 0.2 && el > 3) return { fail: 'Застрял в левентике. Поворот делают с хода: руль перекладывают плавно, но решительно, до 25–30°, и не выпрямляют, пока нос не пройдёт ветер. Ещё раз!' };
      const crossed = out.TWA > 0; // ветер теперь справа
      const p = crossed ? 0.6 + 0.4 * Math.min(1, out.speedKn / 2) : 0.6 * Math.min(1, Math.max(0, (out.twaAbs < 45 ? 45 - out.twaAbs : 0) / 45));
      return { progress: p, done: crossed && out.twaAbs >= 40 && out.twaAbs <= 65 && out.speedKn >= 2, note: crossed ? 'Галс сменён — разгоняйся' : 'Приводись к ветру и проходи через левентик' };
    },
  },
  {
    id: 'gybe', title: 'Поворот фордевинд',
    goal: 'Идёшь бакштагом левым галсом. Подбери шкот наполовину, увались, чтобы ветер перешёл через корму и гик перелетел, затем потрави шкот и ляг в бакштаг правым галсом (130–160°) с ходом 2 узла.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 150; state.vf = 2.5; ctl.sheet = 80; state.side = -1; },
    check(out, state, el) {
      const crossed = out.TWA > 0;
      const p = crossed ? 0.6 + 0.4 * Math.min(1, out.speedKn / 2) : 0.6 * Math.min(1, Math.max(0, (out.twaAbs - 150) / 30));
      return { progress: p, done: crossed && out.twaAbs >= 130 && out.twaAbs <= 160 && out.speedKn >= 2 && Math.abs(state.heel) < 25, note: crossed ? 'Гик перелетел — выровняй курс' : 'Уваливайся плавно, следи за гиком' };
    },
  },
  {
    id: 'beat', title: 'Лавировка к бую',
    goal: 'Наветренный буй в 110 м прямо против ветра. Дойди до него галсами: держи 45° к ветру, меняй галс оверштагом. Следи за VMG.',
    usesCourse: 'W',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.x = 0; state.z = 12; state.heading = 45; state.vf = 2; ctl.sheet = 15; },
    check(out, state, el, mem, course) {
      const d = Math.hypot(course.marks.W.x - state.x, course.marks.W.z - state.z);
      mem.d0 = mem.d0 || d;
      return { progress: Math.min(1, 1 - d / mem.d0), done: d < 8, note: `До буя ${Math.round(d)} м · VMG ${Math.abs(out.vmgKn).toFixed(1)} уз` };
    },
  },
  {
    id: 'stop', group: 'Мастерство', title: 'Остановка у буя',
    goal: 'Подойди к оранжевому бую и остановись рядом: ближе 6 м, ход меньше 0,7 узла, две секунды. Тормозят парусом: потрави шкот, чтобы он заполоскал, и приведись носом к ветру. Так подходят к причалу и к человеку за бортом.',
    usesCourse: 'W',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 9; state.x = -50; state.z = -92; state.heading = 70; state.vf = 2.2; ctl.sheet = 30; },
    check(out, state, el, mem, course) {
      const d = Math.hypot(course.marks.W.x - state.x, course.marks.W.z - state.z);
      mem.d0 = mem.d0 || d;
      const t = hold(mem, el, d < 6 && Math.abs(out.speedKn) < 0.7);
      const note = d > 25 ? `До буя ${Math.round(d)} м: иди полным ходом`
        : d >= 6 ? `До буя ${Math.round(d)} м · ход ${out.speedKn.toFixed(1)} уз: пора тормозить, трави шкот`
        : Math.abs(out.speedKn) >= 0.7 ? `Ты у буя, но ход ещё ${out.speedKn.toFixed(1)} уз: приведись носом к ветру` : 'Стоим у буя…';
      return { progress: 0.7 * clamp01(1 - (d - 6) / (mem.d0 - 6)) + 0.3 * clamp01(t / 2), done: t >= 2, note };
    },
  },
  {
    id: 'gust', group: 'Мастерство', title: 'Порывы',
    goal: 'Идёшь в бейдевинд, ветер порывистый: от 10 до 19 узлов. Продержись 40 секунд с креном не больше 18°, не уваливаясь и не теряя ход. В порыв трави шкот и чуть приводись, порыв прошёл — добирай обратно.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 45; state.vf = 2.5; ctl.sheet = 15; state.side = -1; },
    check(out, state, el, mem, course, ctl) {
      // порыв раз в 11 секунд: нарастает за полторы, держится четыре, спадает за две
      const ph = (el % 11) / 11, up = clamp01((ph - 0.22) / 0.14), down = clamp01((ph - 0.72) / 0.18);
      const g = up * up * (3 - 2 * up) * (1 - down * down * (3 - 2 * down));
      ctl.windSpeed = Math.round((10 + 9 * g) * 2) / 2;
      const dt = el - (mem.last === undefined ? el : mem.last); mem.last = el;
      const heelOk = Math.abs(state.heel) <= 18, courseOk = out.twaAbs < 72, speedOk = out.speedKn > 2;
      if (heelOk && courseOk && speedOk) mem.t = (mem.t || 0) + dt;
      const note = !heelOk ? 'Крен больше 18°: трави шкот!' : !courseOk ? 'Не уваливайся: держи бейдевинд' : !speedOk ? 'Мало хода: добери шкот'
        : g > 0.4 ? `Порыв ${ctl.windSpeed} уз: трави и чуть приводись` : 'Затишье: добери шкот обратно';
      return { progress: clamp01((mem.t || 0) / 40), done: (mem.t || 0) >= 40, note };
    },
    teardown(ctl) { ctl.windSpeed = 10; },
  },
  {
    id: 'trimsail', group: 'Мастерство', title: 'Настройки паруса',
    goal: 'Курс и шкот держит матрос, твоё дело — настройки паруса (панель, раздел «Настройки паруса»). Ветер слабый, а парус набит в доску: отпусти каннингхэм и оттяжку шкотового угла, парусу нужно пузо. Потом ветер усилится, и всё придётся набить обратно.',
    setup(state, ctl) {
      ctl.windFrom = 0; ctl.windSpeed = 5; state.heading = 48; state.vf = 1.2; ctl.sheet = 15; state.side = -1;
      ctl.lockHeading = true; ctl.autoSheet = true; ctl.autoTrim = false; ctl.vang = 0.85; ctl.cunn = 1; ctl.out = 1;
      state.trim.vang = 0.85; state.trim.cunn = 1; state.trim.out = 1;
    },
    check(out, state, el, mem, course, ctl) {
      const tr = state.trim;
      if (!mem.phase2) {
        const t = hold(mem, el, tr.cunn < 0.25 && tr.out < 0.45);
        if (t >= 2) { mem.phase2 = true; mem.hold = 0; ctl.windSpeed = 17; }
        return { progress: 0.5 * clamp01(((1 - tr.cunn) / 0.75 + (1 - tr.out) / 0.55) / 2), note: `Слабый ветер · ход ${out.speedKn.toFixed(1)} уз · каннингхэм ${pc(tr.cunn)}, оттяжка шк. угла ${pc(tr.out)}: отпускай` };
      }
      const t = hold(mem, el, tr.cunn > 0.7 && tr.out > 0.75 && tr.vang > 0.6);
      return { progress: 0.5 + 0.5 * clamp01((tr.cunn / 0.7 + tr.out / 0.75 + tr.vang / 0.6) / 3) * (t >= 2 ? 1 : 0.9), done: t >= 2,
        note: `Ветер 17 уз, крен ${Math.round(Math.abs(state.heel))}° · каннингхэм ${pc(tr.cunn)}, оттяжка шк. угла ${pc(tr.out)}, оттяжка гика ${pc(tr.vang)}: набивай` };
    },
    teardown(ctl) { ctl.lockHeading = false; ctl.autoSheet = false; ctl.autoTrim = true; ctl.windSpeed = 10; },
  },
  {
    id: 'roll', group: 'Мастерство', title: 'Раскачка на фордевинде',
    goal: 'Свежий ветер в корму, оттяжка гика отпущена: верх паруса ушёл вперёд мачты, и лодку раскачивает с борта на борт. Успокой её: набей оттяжку гика (панель, «Настройки паруса») или подбери шкот до 70°. Удержи фордевинд без раскачки 6 секунд.',
    setup(state, ctl) {
      ctl.windFrom = 0; ctl.windSpeed = 20; state.heading = 176; state.vf = 4; ctl.sheet = 90; state.side = -1;
      ctl.autoTrim = false; ctl.vang = 0.05; ctl.cunn = 0; ctl.out = 0.3; state.trim.vang = 0.05; state.trim.cunn = 0; state.trim.out = 0.3;
    },
    check(out, state, el, mem) {
      if (!mem.init) { mem.init = true; state.rollAmp = 1; }       // урок начинается уже с раскачкой
      const onRun = out.twaAbs > 150, calm = out.rolling < 0.15 && Math.abs(state.heel) < 14;
      const t = hold(mem, el, onRun && calm && out.speedKn > 4);
      const note = !onRun ? 'Держи фордевинд: ветер должен дуть в корму' : !calm ? 'Раскачивает: набей оттяжку гика или подбери шкот до 70°' : 'Успокоилась, держи курс…';
      return { progress: 0.4 * clamp01(1 - out.rolling) + 0.6 * clamp01(t / 6), done: t >= 6, note };
    },
    teardown(ctl) { ctl.autoTrim = true; ctl.windSpeed = 10; },
  },
  {
    id: 'start', group: 'Мастерство', title: 'Старт по сигналу',
    goal: 'До сигнала 30 секунд. Стартовая линия идёт от оранжевого знака к мачте судейского катера, пересекать её надо против ветра. Рассчитай подход: пересеки линию в первые 5 секунд после сигнала и на ходу, не меньше 3 узлов. Раньше сигнала нельзя: это фальстарт. Время тянут, потравив шкот.',
    usesCourse: 'W',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.x = 22; state.z = 24; state.heading = 315; state.vf = 2; ctl.sheet = 18; state.side = 1; },
    check(out, state, el, mem, course) {
      const T = 30, g1 = course.marks.G1, g2 = course.marks.G2, xMin = Math.min(g1.x, g2.x), xMax = Math.max(g1.x, g2.x), zLine = g1.z;
      const z = state.z - zLine, was = mem.z === undefined ? z : mem.z; mem.z = z;
      if (was > 0 && z <= 0) {                                   // пересёк линию с подветренной стороны
        if (state.x < xMin - 0.5 || state.x > xMax + 0.5) return { fail: 'Прошёл мимо линии: она между знаком и катером. Ещё раз!' };
        if (el < T) return { fail: `Фальстарт: линия пересечена за ${(T - el).toFixed(1)} с до сигнала. Время тянут у линии: потрави шкот и стой, добирай за несколько секунд до сигнала.` };
        if (el > T + 5) return { fail: `Опоздал на ${(el - T).toFixed(1)} с. Держись ближе к линии и начинай разгон заранее.` };
        if (out.speedKn < 3) return { fail: `Линию пересёк вовремя, но без хода: ${out.speedKn.toFixed(1)} уз. Разгон начинают за 5–7 секунд до сигнала.` };
        return { progress: 1, done: true, note: `Старт через ${(el - T).toFixed(1)} с после сигнала, ход ${out.speedKn.toFixed(1)} уз` };
      }
      if (el > T + 12) return { fail: 'Старт пропущен: линия так и не пересечена. Ещё раз!' };
      const note = el < T ? `До сигнала ${Math.ceil(T - el)} с · до линии ${Math.max(0, Math.round(z))} м · ход ${out.speedKn.toFixed(1)} уз` : `СТАРТ! Пересекай линию · прошло ${(el - T).toFixed(1)} с`;
      return { progress: 0.85 * clamp01(el / T), note };
    },
  },
  {
    id: 'rolltack', group: 'Мастерство', title: 'Поворот с перекатом',
    goal: 'Слабый ветер, 7 узлов: обычный оверштаг съедает ход. Гонщики делают перекат: пока нос идёт к ветру, матрос остаётся на старом борту и валит лодку на себя, а на новом галсе переходит и резко выпрямляет её. Мачта проходит сквозь воздух, и парус даёт толчок. Матрос сделает перекат сам. Твоя часть: войти в поворот с хода плавным рулём и на новом галсе вернуть две трети скорости за 16 секунд.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 7; state.heading = 46; state.vf = 1.9; ctl.sheet = 13; state.side = -1; ctl.rollTack = true; },
    check(out, state, el, mem) {
      if (mem.s0 === undefined) { mem.s0 = state.side; mem.v0 = 0; }
      if (mem.t0 === undefined) {
        if (state.side === mem.s0 && out.twaAbs > 38) mem.v0 = Math.max(mem.v0 * 0.995, out.speedKn);
        if (out.twaAbs < 20) mem.t0 = el;
        if (el > 40) return { fail: 'Поворот так и не начат. Разгонись в бейдевинд и плавно переложи руль к ветру.' };
        return { progress: 0.1, note: `Разгон: ${out.speedKn.toFixed(1)} уз. Когда лодка пойдёт ровно, плавно приводись и поворачивай` };
      }
      const t = el - mem.t0;
      if (out.rollTack) mem.rolled = true;
      if (state.side !== mem.s0 && out.twaAbs > 36) {
        const k = out.speedKn / Math.max(1, mem.v0);
        if (k >= 0.66) return { progress: 1, done: true, note: `Поворот за ${t.toFixed(1)} с, скорость на выходе ${out.speedKn.toFixed(1)} из ${mem.v0.toFixed(1)} уз${mem.rolled ? ', с перекатом' : ''}` };
        if (t > 16) return { fail: `За 16 секунд вернулось только ${pc(k)} скорости. Не дёргай руль: резкая перекладка тормозит. На новом галсе сразу подбери шкот и уваливайся до 45° к ветру.` };
        return { progress: 0.4 + 0.6 * clamp01(k / 0.66), note: `Новый галс: ${out.speedKn.toFixed(1)} уз из ${mem.v0.toFixed(1)}. Подбирай шкот, разгоняйся` };
      }
      if (t > 18) return { fail: 'Лодка встала носом к ветру. В поворот входят с хода и руль держат до нового галса.' };
      return { progress: 0.25, note: out.rollTack ? 'Перекат: матрос валит лодку на себя' : 'Держи руль, нос идёт через ветер' };
    },
  },
  {
    id: 'bylee', group: 'Мастерство', title: 'Фордевинд «за ветер»',
    goal: 'На фордевинде лазер быстрее и устойчивее, когда ветер заходит чуть со стороны гика: поток идёт по парусу от задней шкаторины к мачте, колдунчики смотрят вперёд. Это называют «идти за ветер». Гик сейчас на правом борту. Увались вправо так, чтобы зайти за ветер на 10–25°, и продержись 10 секунд. Зайдёшь дальше — заднюю шкаторину заломит и гик перебросит.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 11; state.heading = 172; state.vf = 3; ctl.sheet = 88; state.side = -1; },
    check(out, state, el, mem) {
      if (mem.b0 === undefined) mem.b0 = Math.sign(state.boom) || 1;
      if (Math.sign(state.boom) !== mem.b0 && Math.abs(state.boom) > 20) return { fail: 'Гик перебросило: зашёл за ветер слишком далеко. Держи 10–25° и следи за задней шкаториной.' };
      const ok = out.byLee >= 10 && out.byLee <= 27, t = hold(mem, el, ok);
      const note = out.byLee < 2 ? 'Ветер пока с наветренной стороны: уваливайся вправо, за линию ветра' : out.byLee < 10 ? `За ветер ${Math.round(out.byLee)}°: ещё немного` : ok ? `За ветер ${Math.round(out.byLee)}°: держи… ${t.toFixed(0)} из 10 с` : `За ветер ${Math.round(out.byLee)}°: слишком далеко, приведись`;
      return { progress: clamp01(t / 10), done: t >= 10, note };
    },
  },
  {
    id: 'capsize', group: 'Мастерство', title: 'Подъём после переворота', allowCapsize: true,
    goal: 'Лодка лежит на борту, мачта смотрит на ветер. Если встать на шверт сейчас, ветер подхватит парус на подъёме и перебросит лодку на другой борт. Сначала разверни её носом к ветру: клавиша G или кнопка «Нос к ветру». Потрави шкот. Затем вставай на шверт: клавиша T. Подними лодку с первого раза и набери 2 узла.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 14; state.heading = 90; state.vf = 0; ctl.sheet = 30; state.side = -1; ctl.autoRight = false; },
    check(out, state, el, mem) {
      if (!mem.init) { mem.init = true; state.capsized = 0.01; state.capsizeSide = 1; state.righting = 0; state.capsizes = 1; state.vf = 0; }
      if (state.capsizes > 1) return { fail: mem.up ? 'Лодка легла снова: шкот был выбран, и парус сразу набрал ветер. Перед подъёмом шкот травят.' : 'Лодку перебросило: мачта лежала на ветер. Сначала разверни нос к ветру, потом вставай на шверт.' };
      if (!state.capsized) mem.up = true;
      if (el > 90) return { fail: 'Слишком долго: в холодной воде счёт идёт на минуты. Ещё раз!' };
      const note = state.righting ? 'Лодка встаёт…' : state.capsized ? (out.mastUpwind ? 'Мачта на ветер: разверни нос к ветру (G)' : 'Мачта под ветром: потрави шкот и вставай на шверт (T)') : `Лодка на ровном киле: набери ход, ${out.speedKn.toFixed(1)} из 2 уз`;
      return { progress: state.capsized ? (out.mastUpwind ? 0.1 : 0.4) : 0.6 + 0.4 * clamp01(out.speedKn / 2), done: mem.up && out.speedKn >= 2, note };
    },
    teardown(ctl) { ctl.autoRight = true; ctl.swimBow = false; },
  },
  {
    id: 'spin', group: 'Мастерство', title: 'Штрафной оборот 720°',
    goal: 'За нарушение правил в гонке лодка делает два полных оборота в одну сторону: два оверштага и два фордевинда подряд. Сделай 720° быстрее чем за минуту и не перевернись. В оверштаг входи с хода, перед фордевиндом подбирай шкот.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 9; state.heading = 60; state.vf = 2.5; ctl.sheet = 22; state.side = -1; },
    check(out, state, el, mem) {
      const d = norm180(state.heading - (mem.h === undefined ? state.heading : mem.h)); mem.h = state.heading;
      mem.acc = (mem.acc || 0) + d;
      const turned = Math.abs(mem.acc);
      if (el > 60) return { fail: `Минута вышла: пройдено ${Math.round(turned)}° из 720°. Обороты крутят без пауз, руль держат переложенным, а шкот всё время работает.` };
      return { progress: clamp01(turned / 720), done: turned >= 720, note: `Пройдено ${Math.round(turned)}° из 720° · осталось ${Math.ceil(60 - el)} с` };
    },
  },
];

export function createLessonRunner() {
  const run = { index: -1, lesson: null, el: 0, mem: {}, status: 'idle', progress: 0, note: '', fail: '' };
  function start(i, state, ctl) {
    const L = LESSONS[i]; if (!L) return;
    if (run.lesson && run.lesson.teardown) run.lesson.teardown(ctl);
    run.index = i; run.lesson = L; run.el = 0; run.mem = {}; run.status = 'running'; run.progress = 0; run.note = ''; run.fail = '';
    ctl.autoSheet = false; ctl.lockHeading = false; ctl.paused = false; ctl.rudder = 0; state.vs = 0; state.yawRate = 0; state.heel = 0;
    L.setup(state, ctl);
    settleRig(state, ctl);
  }
  function stop(ctl) { if (run.lesson && run.lesson.teardown) run.lesson.teardown(ctl); run.status = 'idle'; run.lesson = null; run.index = -1; }
  function update(out, state, ctl, dt, course) {
    if (run.status !== 'running' || ctl.paused) return null;
    run.el += dt;
    const r = run.lesson.check(out, state, run.el, run.mem, course, ctl);
    if (r.fail) { run.status = 'failed'; run.fail = r.fail; return 'fail'; }
    run.progress = r.progress || 0; run.note = r.note || '';
    if (r.done) { run.status = 'done'; if (run.lesson.teardown) run.lesson.teardown(ctl); return 'done'; }
    return null;
  }
  return { run, start, stop, update };
}
