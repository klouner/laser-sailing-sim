// node v2shot.js <путь?запрос> <имя> [js до снимка] [ожидание мс] [ШxВ]
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const [W, H] = (process.argv[6] || '1280x800').split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  await page.route(/sh38\.ru|docs\.google\.com/, (r) => r.abort());
  const errors = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 700)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 700)));
  await page.goto((process.env.BASE || 'http://localhost:8765/v2/') + (process.argv[2] || "?nointro"), { waitUntil: 'load' });
  await page.waitForTimeout(+process.argv[5] || 6000);
  let res = null; if (process.argv[4]) { try { res = await page.evaluate(process.argv[4]); } catch (e) { res = 'EVAL ' + e.message.slice(0, 300); } await page.waitForTimeout(2500); }
  await page.screenshot({ path: `${__dirname}/out/${process.argv[3] || 'v2'}.png`, timeout: 120000 });
  if (res !== null) console.log(JSON.stringify(res));
  console.log(errors.length ? [...new Set(errors)].slice(0, 8).join('\n') : 'no errors');
  await browser.close();
})();
