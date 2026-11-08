// Уроки: постановка ситуации + проверка цели
import { KN } from './physics.js';

export const LESSONS = [
  {
    id: 'irons', title: 'Выход из левентика',
    goal: 'Лодка почти носом в ветер и теряет ход. Переложи руль, увались от ветра до 45° и разгонись до 2 узлов, пока ход не пропал.',
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.heading = 8; state.vf = 0.9; state.vs = 0; ctl.sheet = 25; },
    check(out, state, el) {
      if (state.vf < 0.15 && el > 1.5) return { fail: 'Ход пропал — лодка встала в левентик. В жизни тут пришлось бы «отрабатывать» парусом назад. Попробуй ещё раз, действуй рулём сразу.' };
      const p = Math.min(1, Math.max(0, (out.twaAbs - 8) / 37)) * 0.6 + Math.min(1, out.speedKn / 2) * 0.4;
      return { progress: p, done: out.twaAbs >= 45 && out.speedKn >= 2 };
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
      if (state.vf < 0.3 && el > 2) return { fail: 'Застрял в левентике — поворот надо делать решительно, с ходом, руль на 25–30°. Ещё раз!' };
      const crossed = out.TWA > 0; // ветер теперь справа
      const p = crossed ? 0.6 + 0.4 * Math.min(1, out.speedKn / 2) : 0.6 * Math.min(1, Math.max(0, (out.twaAbs < 45 ? 45 - out.twaAbs : 0) / 45));
      return { progress: p, done: crossed && out.twaAbs >= 40 && out.twaAbs <= 65 && out.speedKn >= 2, note: crossed ? 'Галс сменён — разгоняйся' : 'Приводись к ветру и проходи через левентик' };
    },
  },
  {
    id: 'gybe', title: 'Поворот фордевинд',
    goal: 'Идёшь бакштагом левым галсом. Уваливайся, пока ветер не перейдёт через корму и гик не перелетит, затем ляг в бакштаг правым галсом (130–160°) с ходом 2 узла.',
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
    setup(state, ctl) { ctl.windFrom = 0; ctl.windSpeed = 10; state.x = 0; state.z = 0; state.heading = 45; state.vf = 2; ctl.sheet = 15; },
    check(out, state, el, mem, course) {
      const d = Math.hypot(course.marks.W.x - state.x, course.marks.W.z - state.z);
      mem.d0 = mem.d0 || d;
      return { progress: Math.min(1, 1 - d / mem.d0), done: d < 8, note: `До буя ${Math.round(d)} м · VMG ${Math.abs(out.vmgKn).toFixed(1)} уз` };
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
  }
  function stop(ctl) { if (run.lesson && run.lesson.teardown) run.lesson.teardown(ctl); run.status = 'idle'; run.lesson = null; run.index = -1; }
  function update(out, state, ctl, dt, course) {
    if (run.status !== 'running' || ctl.paused) return null;
    run.el += dt;
    const r = run.lesson.check(out, state, run.el, run.mem, course);
    if (r.fail) { run.status = 'failed'; run.fail = r.fail; return 'fail'; }
    run.progress = r.progress || 0; run.note = r.note || '';
    if (r.done) { run.status = 'done'; if (run.lesson.teardown) run.lesson.teardown(ctl); return 'done'; }
    return null;
  }
  return { run, start, stop, update };
}
