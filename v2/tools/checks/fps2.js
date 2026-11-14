const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const path of ['', 'v2/']) for (const [label, opt] of [['desktop 1000x700', { viewport: { width: 1000, height: 700 } }], ['Pixel 7', { ...devices['Pixel 7'], deviceScaleFactor: 1 }]]) {
    const ctx = await browser.newContext(opt); const page = await ctx.newPage();
    await page.route(/docs\.google\.com|sh38\.ru/, (r) => r.abort());
    await page.goto((process.env.ROOT || 'http://localhost:8765/') + path, { waitUntil: 'load' }); await page.waitForTimeout(5000);
    const r = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res((n / 5).toFixed(1) + ' к/с, уровень ' + window.__sim.level); }; requestAnimationFrame(f); }));
    console.log((path || 'v1/').padEnd(4), label.padEnd(18), r);
    await ctx.close();
  }
  await browser.close();
})();
