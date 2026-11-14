// Аудит обрезанного текста на мобильной вёрстке: ищем элементы, где текст не помещается
const { chromium, devices } = require('playwright');
const AUDIT = `(() => {
  const out = [];
  const els = document.querySelectorAll('#topbar *, #touch *, #panel *, #lb *, #hud *');
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const text = (el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) ? el.textContent.trim() : '';
    if (!text) continue;
    const clippedW = el.scrollWidth > el.clientWidth + 1; // текст шире элемента — даже при overflow:visible он наезжает на соседей
    const clippedH = el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible';
    const offscreen = r.right > innerWidth + 1 || r.left < -1;
    // наложение на соседа по флексу
    let overlap = false; const sib = el.nextElementSibling; if (sib && sib instanceof HTMLElement && getComputedStyle(el.parentElement).display.includes('flex')) { const r2 = sib.getBoundingClientRect(); if (r2.width && r.right > r2.left + 2 && r.top < r2.bottom && r.bottom > r2.top && getComputedStyle(el.parentElement).flexDirection !== 'column') overlap = true; }
    if (clippedW || clippedH || offscreen || overlap) out.push({ overlap, sel: el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName, text: text.slice(0, 50), clippedW, clippedH, offscreen });
  }
  return out;
})()`;
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const dev of ['iPhone SE', 'iPhone 13', 'Pixel 7', 'Galaxy S9+']) {
    const ctx = await browser.newContext({ ...devices[dev], deviceScaleFactor: 1 });
    const page = await ctx.newPage();
  await page.route(/docs\.google\.com|google\.com\/forms/, (r) => r.abort());
    await page.goto((process.env.BASE || 'http://localhost:8765/v2/'), { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    const res = {};
    res.default = await page.evaluate(AUDIT);
    await page.evaluate(() => window.__sim.startLesson(4)); await page.waitForTimeout(1200); res.lesson = await page.evaluate(AUDIT);
    await page.evaluate(() => window.__sim.startRace()); await page.waitForTimeout(1200); res.race = await page.evaluate(AUDIT);
    await page.evaluate(() => document.getElementById('panel').classList.add('open')); await page.waitForTimeout(600); res.panel = await page.evaluate(AUDIT);
    const vp = page.viewportSize();
    console.log(`== ${dev} ${vp.width}x${vp.height}`);
    for (const [k, v] of Object.entries(res)) if (v.length) console.log('  ' + k + ':', JSON.stringify(v));
    if (!Object.values(res).some(v => v.length)) console.log('  ok: ничего не обрезано');
    await ctx.close();
  }
  await browser.close();
})();
