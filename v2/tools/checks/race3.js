const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errors = [];
  await page.route(/sh38\.ru|docs\.google\.com/, (r) => r.abort());
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto((process.env.BASE || 'http://localhost:8765/v2/'), { waitUntil: 'load' }); await page.waitForTimeout(6000);
  const ev = (f, a) => page.evaluate(f, a);
  const R = () => ev(() => { const r = __sim.course.race; return { phase: r.phase, stage: r.stage, toStart: +r.toStart.toFixed(1), flags: JSON.stringify(r.flags), ocs: r.ocs, started: r.started, t: +r.t.toFixed(1), note: document.getElementById('tb-note').textContent, time: document.getElementById('tb-time').textContent, wind: __sim.ctl.windFrom }; });
  const out = {};
  await ev(() => { __sim.startRace(); __sim.ctl.paused = false; __sim.ctl.autoSheet = true; __sim.warp(1); }); out.a_warning = await R();
  await ev(() => __sim.warp(13)); out.b_prep = await R();
  // встать за линией к моменту сигнала: фальстарт
  await ev(() => { const s = __sim.state; __sim.warp(36); __sim.warp(10.7); s.x = 0; s.z = -3; s.heading = 0; s.vf = 0; __sim.warp(0.5); }); out.c_gun = await R();
  await page.screenshot({ path: __dirname + '/out/v2race_ocs.png' });
  await ev(() => { const s = __sim.state; s.x = 0; s.z = 8; s.heading = 0; s.vf = 0; __sim.warp(0.1); }); out.d_back = await R();
  await ev(() => { const s = __sim.state; s.z = -4; __sim.warp(0.1); }); out.e_started = await R();
  const tp = (x, z) => ev(([x, z]) => { const s = __sim.state; s.x = x; s.z = z; s.vf = 0; __sim.warp(0.05); }, [x, z]);
  await tp(-10, -105); await tp(-10, -115); await tp(10, -115); await tp(10, -105); out.f_round = (await R()).phase;
  await tp(30, -5); await tp(30, 3); out.g_miss = (await R()).phase;
  await tp(0, -8); await ev(() => { const s = __sim.state; s.heading = 180; s.z = 4; __sim.warp(0.05); }); await page.waitForTimeout(2500); out.h_fin = await R();
  out.modal = await ev(() => !document.getElementById('name-modal').hidden);
  if (out.modal) { await page.fill('#name-input', 'Тест'); await page.click('#name-ok'); await page.waitForTimeout(500); }
  // уроки
  const n = await ev(() => __sim.lessons ? document.querySelectorAll('#lesson-list > *').length : 0); out.lessonEls = n;
  for (const id of ['rolltack', 'bylee', 'capsize', 'start']) {
    out['L_' + id] = await ev((id) => { const L = __sim.lessons, list = [...document.querySelectorAll('#lesson-list button, #lesson-list .lesson')]; let idx = -1; for (let i = 0; i < 20; i++) { __sim.startLesson(i); if (!L.run.lesson) break; if (L.run.lesson.id === id) { idx = i; break; } }
      if (idx < 0) return 'нет урока';
      __sim.warp(2);
      if (id === 'capsize') { const c = __sim.ctl, s = __sim.state; const a = { cap: s.capsized > 0, up: s.out.mastUpwind }; c.swimBow = true; __sim.warp(8); a.afterSwim = { hd: Math.round(s.heading), up: s.out.mastUpwind, swim: c.swimBow }; c.sheet = 80; c.rightBoat = true; __sim.warp(4); a.righted = !s.capsized; c.sheet = 40; __sim.warp(1); for (let i = 0; i < 25 && L.run.status === 'running'; i++) { __sim.warp(1); } a.status = L.run.status; a.note = L.run.note || L.run.fail; a.v = +s.out.speedKn.toFixed(1); a.hd = Math.round(s.heading); return a; }
      if (id === 'bylee') { const c = __sim.ctl, s = __sim.state; for (let i = 0; i < 1500 && L.run.status === 'running'; i++) { const e = ((195 - s.heading + 540) % 360) - 180; c.rudder = Math.max(-25, Math.min(25, e * 1.3 - s.yawRate * 0.4)); __sim.warp(1 / 60); } return { status: L.run.status, note: L.run.note || L.run.fail, lee: Math.round(s.out.byLee) }; }
      if (id === 'rolltack') { const c = __sim.ctl, s = __sim.state; let tgt = 46, seen = 0; for (let i = 0; i < 2400 && L.run.status === 'running'; i++) { if (i === 480) tgt = 314; const e = ((tgt - s.heading + 540) % 360) - 180; c.rudder = Math.max(-25, Math.min(25, e * 1.3 - s.yawRate * 0.4)); if (i > 480 && s.side > 0) c.sheet = 13; seen = Math.max(seen, s.rt); __sim.warp(1 / 60); } return { status: L.run.status, note: L.run.note || L.run.fail, rt: seen }; }
      return { status: L.run.status, note: L.run.note };
    }, id);
  }
  for (const k in out) console.log(k, JSON.stringify(out[k]));
  console.log(errors.length ? 'ERRORS: ' + [...new Set(errors)].join(' | ') : 'no errors');
  await browser.close();
})();
