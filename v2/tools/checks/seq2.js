// раскадровка поворота оверштаг: кадры через полсекунды
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 560, height: 400 } })).newPage(); const errors = [];
  await page.route(/sh38\.ru|docs\.google\.com/, (r) => r.abort());
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8765/v2/?nointro', { waitUntil: 'load' }); await page.waitForTimeout(5000);
  await page.evaluate(() => { const s = __sim; s.world.setSky('day'); s.fleet.setEnabled(false); s.ctl.gusts = false; s.ctl.autoSheet = true; s.ctl.windSpeed = 9; s.ctl.paused = false; s.state.x = 60; s.state.z = 60; s.state.heading = 45; s.warp(8);
    for (const k of ['showTrue','showApp','showVel','showForce','showNoGo']) document.getElementById(k).click(); for (const id of ['panel','hud','lb','labels','topbar','touch']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.__tgt = 45; window.__adv = (sec) => { const s = __sim, n = Math.round(sec * 60); for (let i = 0; i < n; i++) { s.warp(1 / 60); } s.ctl.paused = true; };
  });
  const N = +process.argv[2] || 12;
  for (let i = 0; i < N; i++) {
    await page.evaluate((i) => { const s = __sim; s.ctl.paused = false; if (i === 1) document.getElementById('btn-tack').click(); window.__adv(0.45); const p = s.state.heading * Math.PI / 180; s.rig.place(-Math.sin(p) * 2.6 + 0.3, 1.9, Math.cos(p) * 2.6 + 0.3, 0.8); }, i);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${__dirname}/out/seq_${String(i).padStart(2, '0')}.png`, timeout: 120000 });
  }
  console.log(errors.length ? errors.join('|') : 'no errors'); await browser.close();
})();
