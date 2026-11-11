// Звук лодки. Всё синтезируется на лету из шума и пары генераторов: файлов нет.
// Браузер разрешает звук только после действия пользователя, поэтому start() зовётся из обработчика касания или клавиши.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function createAudio() {
  let ctx = null, master = null, enabled = true, level = 0;
  const N = {};                       // узлы графа
  const st = { flog: 0, lap: 0, sheetAcc: 0, lastSheet: null, lastSlam: 0, slamWas: 0, t: 0 };

  function noiseBuffer(sec) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  // непрерывный шум через фильтр с управляемой громкостью
  function band(buf, type, freq, q, offset) {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start(0, offset);
    return { f, g };
  }
  function start() {
    if (ctx) { if (ctx.state === 'suspended' && enabled) ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    N.buf = noiseBuffer(2.5);
    N.wind = band(N.buf, 'bandpass', 420, 0.5, 0);        // ветер в ушах
    N.rig = band(N.buf, 'bandpass', 2100, 9, 0.7);        // свист в такелаже в свежий ветер
    N.water = band(N.buf, 'lowpass', 700, 0.4, 1.3);      // вода вдоль борта
    N.hiss = band(N.buf, 'bandpass', 3200, 0.6, 1.9);     // шипение на глиссировании
    N.flog = band(N.buf, 'bandpass', 620, 0.7, 0.4);      // полоскание паруса
    if (ctx.state === 'suspended') ctx.resume();
  }
  const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);

  // короткий всплеск шума: удар волны в нос, оверкиль
  function burst(freq, dur, gain, type = 'lowpass') {
    if (!ctx || !enabled) return;
    const src = ctx.createBufferSource(); src.buffer = N.buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.6;
    const g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 2, dur + 0.05);
  }
  // удар гика: глухой низкий стук и щелчок
  function thud(strength) {
    if (!ctx || !enabled) return;
    const k = clamp(strength / 3.5, 0.15, 1), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.75 * k, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
    burst(1800, 0.09, 0.3 * k, 'bandpass');
  }
  // щелчок храповика блока при выборе шкота
  function click() { burst(4200, 0.03, 0.07, 'highpass'); }
  // судейский гудок: два чуть расстроенных пилообразных тона через фильтр
  function horn(long = false) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, dur = long ? 1.5 : 0.6, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.03); g.gain.setValueAtTime(0.5, t + dur - 0.08); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    for (const hz of [311, 392]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
    f.connect(g); g.connect(master);
  }
  function splash() { burst(900, 0.9, 0.55); burst(2600, 0.5, 0.2, 'bandpass'); }

  // s: { aws — вымпельный ветер, м/с; speed — ход, м/с; luff — 0..1; sheet — текущий угол шкота; slam — волна над носом, м; paused }
  function update(dt, s) {
    if (!ctx) return;
    const want = enabled && !s.paused && !document.hidden ? 1 : 0;
    level += (want - level) * Math.min(1, dt * 4);
    set(master.gain, 0.55 * level, 0.1);
    if (ctx.state !== 'running') return;
    st.t += dt;
    const w = clamp(s.aws / 14, 0, 1.3), sp = Math.abs(s.speed);
    // ветер: громкость растёт примерно как квадрат скорости, тон поднимается; медленные «вдохи» от порывов
    const breath = 0.85 + 0.15 * Math.sin(st.t * 0.9) * Math.sin(st.t * 0.37 + 1);
    set(N.wind.g.gain, (0.012 + 0.42 * Math.pow(w, 1.7)) * breath);
    set(N.wind.f.frequency, 260 + s.aws * 46, 0.3);
    set(N.rig.g.gain, 0.05 * clamp((s.aws - 8.5) / 7, 0, 1) * breath);
    set(N.rig.f.frequency, 1700 + s.aws * 60, 0.3);
    // вода: на малом ходу плеск о борт, на ходу ровный шум, на глиссировании добавляется шипение
    st.lap += dt * (1.3 + sp * 0.5);
    const lap = Math.pow(0.5 + 0.5 * Math.sin(st.lap * 2.1) * Math.sin(st.lap * 0.73), 2);
    const run = Math.pow(clamp(sp / 4.5, 0, 1), 1.3);
    set(N.water.g.gain, 0.03 * lap * (1 - run) + 0.34 * run, 0.06);
    set(N.water.f.frequency, 420 + sp * 330, 0.2);
    set(N.hiss.g.gain, 0.085 * clamp((sp - 3.2) / 2.5, 0, 1));
    // полоскание: частые неровные хлопки, тем громче, чем свежее ветер
    st.flog += dt * (6 + s.aws * 0.9);
    const flap = Math.abs(Math.sin(st.flog * Math.PI)) * (0.55 + 0.45 * Math.sin(st.flog * 2.7 + 1.3));
    set(N.flog.g.gain, s.luff * clamp(s.aws / 9, 0.15, 1.2) * 0.42 * Math.max(0, flap), 0.012);
    set(N.flog.f.frequency, 480 + 240 * flap, 0.03);
    // храповик: щелчок на каждые 5° выбранного шкота
    if (st.lastSheet !== null && s.sheet < st.lastSheet) { st.sheetAcc += st.lastSheet - s.sheet; if (st.sheetAcc > 5) { st.sheetAcc = 0; click(); } }
    st.lastSheet = s.sheet;
    // удар волны в нос
    if (s.slam > 0.05 && st.slamWas <= 0.05 && sp > 1.5 && st.t - st.lastSlam > 0.5) { st.lastSlam = st.t; burst(700 + sp * 120, 0.45, clamp(0.12 + s.slam * 1.6, 0, 0.45)); }
    st.slamWas = s.slam;
  }
  function setEnabled(v) { enabled = v; if (v) start(); }
  return { start, update, thud, splash, horn, setEnabled, get running() { return !!ctx && ctx.state === 'running'; } };
}
