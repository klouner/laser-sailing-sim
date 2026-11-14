// Полный обход v2: уроки, камеры, настройки, переворот, телефон. Статистика заблокирована.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || (process.env.BASE || 'http://localhost:8765/v2/');
(async () => {
  const browser = await chromium.launch({ args: process.env.SOFT_GL === '0' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const open = async (opt) => { const ctx = await browser.newContext(opt); const page = await ctx.newPage(); const errors = [];
    await page.route(/sh38\.ru|docs\.google\.com/, (r) => r.abort());
    page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200))); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(BASE + '?nointro', { waitUntil: 'load' }); await page.waitForTimeout(6000); return { page, errors, ctx }; };
  const out = [];
  // ---- компьютер ----
  { const { page, errors, ctx } = await open({ viewport: { width: 1280, height: 800 } });
    out.push('версия: ' + await page.evaluate(() => document.getElementById('ver').textContent));
    // все уроки стартуют и идут
    const lessons = await page.evaluate(() => { const r = []; const L = __sim.lessons; for (let i = 0; i < 30; i++) { __sim.startLesson(i); if (!L.run.lesson || L.run.index !== i) break; const id = L.run.lesson.id; __sim.warp(4); r.push(`${i + 1}.${id}:${L.run.status}${isFinite(__sim.state.x + __sim.state.heel + __sim.state.vf) ? '' : ' NaN!'}`); } document.getElementById('tb-exit').click(); return r; });
    out.push(`уроков ${lessons.length}: ` + lessons.join(' '));
    // камеры
    out.push('камеры: ' + await page.evaluate(() => { const r = []; for (const m of ['chase', 'side', 'top', 'cockpit', 'free']) { try { __sim.setCamera(m); __sim.warp(0.5); const c = __sim.camera.position; r.push(m + (isFinite(c.x + c.y + c.z) ? ' ок' : ' NaN')); } catch (e) { r.push(m + ' ОШИБКА ' + e.message); } } __sim.setCamera('chase'); return r.join(', '); }));
    // небо и качество
    out.push('небо и качество: ' + await page.evaluate(async () => { const r = []; for (const b of document.querySelectorAll('#sky-seg button')) { b.click(); __sim.warp(0.2); r.push(b.dataset.sky); } for (const q of ['low', 'med', 'high', 'auto']) { document.querySelector(`button[data-q=${q}]`).click(); __sim.warp(0.2); r.push(q + ':' + __sim.level + (__sim.fleet.enabled ? '' : ' БЕЗ СОПЕРНИКОВ')); } return r.join(' '); }));
    // все галки: выключить и включить обратно
    out.push('галки: ' + await page.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('#panel input[type=checkbox]')) { if (c.id === 'compassWind' || /compass/i.test(c.id)) continue; const was = c.checked; c.click(); __sim.warp(0.1); c.click(); __sim.warp(0.1); if (c.checked !== was) return 'не вернулась: ' + c.id; n++; } return n + ' шт. переключены туда и обратно'; }));
    // ползунки
    out.push('ползунки: ' + await page.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('windFrom', 40); set('windSpeed', 14); set('sheet', 30); set('rudder', -10); __sim.warp(1); const c = __sim.ctl; const ok = c.windFrom === 40 && c.windSpeed === 14 && c.sheet === 30; set('windFrom', 0); set('windSpeed', 10); set('rudder', 0); return ok ? 'ок' : 'НЕ ПРИМЕНИЛИСЬ ' + JSON.stringify([c.windFrom, c.windSpeed, c.sheet]); }));
    // кнопки: пауза, сброс, оверштаг, фордевинд
    out.push('кнопки: ' + await page.evaluate(() => { const s = __sim, r = []; document.getElementById('btn-reset').click(); s.warp(1); r.push('сброс x=' + Math.round(s.state.x) + ' z=' + Math.round(s.state.z));
      s.ctl.gusts = false; s.ctl.autoSheet = true; s.state.heading = 45; s.warp(8); const side0 = s.state.side; document.getElementById('btn-tack').click(); s.warp(9); r.push('оверштаг: галс ' + (s.state.side !== side0 ? 'сменился' : 'НЕ СМЕНИЛСЯ') + ', курс ' + Math.round(s.state.heading));
      s.state.heading = 140; s.warp(6); const b0 = Math.sign(s.state.boom); document.getElementById('btn-tack').click(); s.warp(9); r.push('фордевинд: гик ' + (Math.sign(s.state.boom) !== b0 ? 'перелетел' : 'НЕ ПЕРЕЛЕТЕЛ') + ', курс ' + Math.round(s.state.heading) + (s.state.capsized ? ' ОВЕРКИЛЬ' : ''));
      document.getElementById('btn-pause').click(); const x0 = s.state.x; s.warp(1); r.push('пауза ' + (s.state.x === x0 ? 'держит' : 'НЕ ДЕРЖИТ')); document.getElementById('btn-pause').click(); return r.join('; '); }));
    // настоящий переворот и подъём автоматом
    out.push('переворот: ' + await page.evaluate(() => { const s = __sim, c = s.ctl; document.getElementById('btn-reset').click(); c.gusts = false; c.autoSheet = false; c.windSpeed = 30; c.sheet = 10; s.state.heading = 80; s.state.vf = 2; let tCap = null, tUp = null; for (let i = 0; i < 60 * 40; i++) { s.warp(1 / 60); if (s.state.capsized && tCap === null) tCap = i / 60; if (tCap !== null && !s.state.capsized && tUp === null) { tUp = i / 60; c.sheet = 85; c.windSpeed = 10; } } const r = `лёг через ${tCap === null ? 'НЕ ЛЁГ' : tCap.toFixed(1) + ' с'}, встал через ${tUp === null ? 'НЕ ВСТАЛ' : (tUp - tCap).toFixed(1) + ' с'}, в конце ${s.state.capsized ? 'лежит' : 'идёт ' + s.state.out.speedKn.toFixed(1) + ' уз'}`; c.windSpeed = 10; document.getElementById('btn-reset').click(); return r; }));
    // соперники: минуту ходят, не разбегаются и не ломаются
    out.push('соперники: ' + await page.evaluate(() => { const s = __sim; s.warp(90); return s.fleet.boats.map(b => `${b.num} ${b.leg} x${Math.round(b.state.x)} z${Math.round(b.state.z)} ${b.state.out.speedKn.toFixed(1)}уз${b.state.capsized ? ' лежит' : ''}${isFinite(b.state.x + b.state.z + b.state.heel) ? '' : ' NaN!'}`).join(' | '); }));
    out.push('ошибки на компьютере: ' + (errors.length ? [...new Set(errors)].join(' | ') : 'нет')); await ctx.close(); }
  // ---- телефоны ----
  for (const dev of ['Pixel 7', 'iPhone SE']) { const { page, errors, ctx } = await open({ ...devices[dev], deviceScaleFactor: 1 });
    const r = await page.evaluate(() => { const s = __sim, r = []; const vis = (id) => { const e = document.getElementById(id); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; };
      const btns = [...document.querySelectorAll('#touch button')].map(b => b.id); r.push('кнопок ' + btns.length + ', вне экрана: ' + (btns.filter(id => id && !vis(id)).join(',') || 'нет'));
      s.ctl.gusts = false; s.ctl.autoSheet = true; s.state.heading = 45; s.warp(6); const side0 = s.state.side; document.getElementById('t-tack').click(); s.warp(9); r.push('оверштаг ' + (s.state.side !== side0 ? 'ок' : 'НЕ СРАБОТАЛ'));
      const cam0 = document.querySelector('#touch') && s.rig.mode; const tc = document.getElementById('t-cam'); if (tc) { tc.click(); s.warp(0.3); r.push('камера ' + cam0 + '→' + s.rig.mode); }
      const tp = document.getElementById('t-pause'); if (tp) { tp.click(); r.push('пауза ' + (s.ctl.paused ? 'ок' : 'НЕ СРАБОТАЛА')); tp.click(); }
      const tm = document.getElementById('t-menu'); if (tm) { tm.click(); r.push('меню ' + (document.getElementById('panel').classList.contains('open') ? 'открылось' : 'НЕ ОТКРЫЛОСЬ')); }
      return r.join('; '); });
    out.push(`${dev}: ${r}; ошибки: ${errors.length ? [...new Set(errors)].join(' | ') : 'нет'}`); await ctx.close(); }
  console.log(out.join('\n')); await browser.close();
})();
