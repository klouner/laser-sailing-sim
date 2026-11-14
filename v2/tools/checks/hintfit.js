// Самые длинные подсказки на узких телефонах: помещаются ли целиком
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const src = require('fs').readFileSync('' + require('path').join(__dirname, '../../js/physics.js') + '', 'utf8');
  const hints = ['Идёте «за ветер» на 25°: ветер заходит со стороны гика, поток по парусу идёт от задней шкаторины к мачте. Так спускаются по волне. Предел около 28°: туже оттяжка гика, дальше можно зайти.',
    'Оверкиль, мачта лежит на ветер. Если поднять лодку сейчас, её перебросит на другой борт. Сначала разверните нос к ветру (G), затем вставайте на шверт (T).',
    'Потравите шкот: с выбранным шкотом лодка ляжет снова. Оверкиль, мачта лежит под ветер. Вставайте на шверт (T): лодка поднимется.',
    'Лодку перебросило: мачта лежала на ветер, и он подхватил парус на подъёме. Теперь мачта под ветром, можно вставать на шверт.',
    'Лодку раскачивает: оттяжка гика отпущена, верх паруса ушёл вперёд мачты. Набейте оттяжку или подберите шкот до 70–80°.',
    'Поворот с перекатом: матрос остаётся на старом борту и валит лодку на себя, пока нос проходит ветер.'];
  for (const [w, h] of [[320, 568], [360, 640], [390, 664]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
    await page.route(/sh38\.ru/, r => r.abort()); await page.goto('http://localhost:8765/v2/?nointro', { waitUntil: 'load' }); await page.waitForTimeout(4000);
    const r = await page.evaluate((hints) => { __sim.ctl.paused = true; const el = document.getElementById('hint'); return hints.map(t => { el.textContent = t; return (el.scrollHeight > el.clientHeight + 1 ? 'ОБРЕЗАНА ' : 'ок ') + t.length; }); }, hints);
    const tb = await page.evaluate(() => Math.round(document.getElementById('topbar').getBoundingClientRect().bottom));
    console.log(`${w}px: ${r.join(', ')} | низ верхней плашки с самой длинной: ${tb}px из ${h}`);
    await page.close();
  }
  await browser.close();
})();
