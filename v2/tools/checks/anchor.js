// Стоит ли узор воды на месте: лодку переставляют на метр при остановленном времени и смотрят, на сколько сдвинулась вода на экране
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
  await page.route(/sh38\.ru/, r => r.abort());
  await page.goto('http://localhost:8765/v2/?nointro', { waitUntil: 'load' }); await page.waitForTimeout(5000);
  await page.evaluate(() => { const s = __sim; s.world.setSky('day'); s.fleet.setEnabled(false); s.ctl.gusts = false; s.ctl.windSpeed = 11; s.state.x = 200; s.state.z = 200; s.warp(3); s.ctl.paused = true; s.warp(0.05);
    for (const k of ['showTrue','showApp','showVel','showForce','showNoGo','showLabels','showSailor']) { const e = document.getElementById(k); if (e && e.checked) e.click(); }
    for (const id of ['panel','hud','lb','labels','topbar','touch']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    s.rig.place(0.01, 9, 0.01, 0); s.warp(0.05); });
  await page.waitForTimeout(1500); await page.screenshot({ path: __dirname + '/out/anc_a.png' });
  console.log('камера до', await page.evaluate(() => [__sim.camera.position.x.toFixed(2), __sim.camera.position.z.toFixed(2), __sim.state.x.toFixed(2)].join(' ')));
  await page.evaluate(() => { const s = __sim; s.state.x += 1; s.warp(0.05); });
  await page.waitForTimeout(800); console.log('камера после', await page.evaluate(() => [__sim.camera.position.x.toFixed(2), __sim.camera.position.z.toFixed(2), __sim.state.x.toFixed(2)].join(' ')));
  await page.waitForTimeout(1500); await page.screenshot({ path: __dirname + '/out/anc_b.png' });
  await browser.close();
})();
