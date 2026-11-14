// Телефон с плотным экраном: как выглядит дальняя лодка при старой и новой плотности отрисовки
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage(); const errors = [];
  await page.route(/sh38\.ru/, r => r.abort()); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto('http://localhost:8765/v2/?nointro', { waitUntil: 'load' }); await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({ dpr: __sim.dpr, level: __sim.level, device: devicePixelRatio, up: __sim.world.state.upscaled, fxaa: __sim.world.pipeline.fxaaEnabled, sharpen: __sim.world.pipeline.sharpenEnabled }));
  console.log('по умолчанию:', JSON.stringify(info));
  await page.evaluate(() => { const s = __sim; s.world.setSky('day'); s.ctl.gusts = false; s.ctl.autoSheet = true; const b = s.fleet.boats[0].state; s.state.x = b.x + 22; s.state.z = b.z + 26; s.state.heading = 316; s.warp(3); s.ctl.paused = true; s.warp(0.05); });
  for (const [name, dpr, old] of [['old', 1.0, true], ['new', 2.0, false]]) {
    await page.evaluate(([dpr, old]) => { const s = __sim; s.forceDpr(dpr); }, [dpr, old]);
    await page.waitForTimeout(1500);
    if (old) await page.evaluate(() => { const p = __sim.world.pipeline; p.sharpenEnabled = false; p.fxaaEnabled = true; });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${__dirname}/out/sharp_${name}.png`, timeout: 120000 });
  }
  console.log(errors.length ? 'ОШИБКИ: ' + [...new Set(errors)].join(' | ') : 'ошибок нет'); await browser.close();
})();
