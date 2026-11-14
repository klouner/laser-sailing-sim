// Живой сайт: обе версии грузятся без ошибок. Запросы к серверу статистики блокируются, чтобы не оставлять следов.
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, url, opt] of [['v2 компьютер', 'https://klouner.github.io/laser-sailing-sim/v2/', { viewport: { width: 1280, height: 800 } }], ['v2 телефон', 'https://klouner.github.io/laser-sailing-sim/v2/', { ...devices['iPhone 13'], deviceScaleFactor: 1 }], ['v1 компьютер', 'https://klouner.github.io/laser-sailing-sim/', { viewport: { width: 1280, height: 800 } }]]) {
    const ctx = await browser.newContext(opt), page = await ctx.newPage(), errors = []; let blocked = 0;
    await page.route(/sh38\.ru/, (r) => { blocked++; r.abort(); });
    page.on('pageerror', e => errors.push(e.message.slice(0, 160))); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-50)); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(9000);
    const info = await page.evaluate(() => ({ ver: (document.getElementById('ver') || {}).textContent, loadingHidden: (document.getElementById('loading') || { classList: { contains: () => true } }).classList.contains('hide'), sim: !!window.__sim, moving: window.__sim ? +window.__sim.state.out.speedKn.toFixed(1) : null, og: (document.querySelector('meta[property="og:image"]') || {}).content || null, title: document.title }));
    console.log(name, JSON.stringify(info), 'заблокировано запросов статистики:', blocked, '| ответы с ошибкой:', bad.join(', ') || 'нет', '| ошибки:', errors.join(' | ') || 'нет');
    await ctx.close();
  }
  await browser.close();
})();
