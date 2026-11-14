// node snap.js <desk|Имя устройства> <имя> "<js>" [wait ms]
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const dev = process.argv[2];
  const ctx = await browser.newContext(dev === 'desk' ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { ...devices[dev], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/docs\.google\.com|google\.com\/forms/, (r) => r.abort());
  const errors = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/ERR_FAILED/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => { if (!/Failed to fetch/.test(e.message)) errors.push('pageerror: ' + e.message); });
  await page.goto((process.env.ROOT || 'http://localhost:8765/') + (process.env.Q || ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  if (process.env.HIDE) await page.addStyleTag({ content: '#app > *:not(canvas){display:none!important}' });
  let res = null;
  if (process.argv[4]) res = await page.evaluate(process.argv[4]);
  await page.waitForTimeout(+process.argv[5] || 2500);
  if (process.env.POST) res = await page.evaluate(process.env.POST);
  if (errors.length) console.log('ERR before shot:\n' + errors.slice(0, 6).join('\n').slice(0, 3000));
  await page.screenshot({ path: `${__dirname}/out/${process.argv[3]}.png`, timeout: 90000 });
  console.log(JSON.stringify(res));
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
