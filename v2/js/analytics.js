// Статистика посещений. События уходят на свой сервер (API в js/config.js): открытие страницы с описанием
// устройства, отметка каждые 30 секунд, уход, результаты уроков и гонки. IP сервер записывает сам.
// Без cookies и сторонних скриптов. Контракт сервера описан в server/STATS_SERVER.md.
import { API } from './config.js';

const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
// посетитель узнаётся по случайному номеру в памяти браузера; сеанс — одна загрузка страницы
function visitorId() {
  try { let v = localStorage.getItem('laser3d.vid'); if (!v) { v = uuid(); localStorage.setItem('laser3d.vid', v); } return v; }
  catch (e) { return 'nostore-' + uuid().slice(0, 28); }
}
export const VID = visitorId(), SID = uuid();

const cut = (s, n) => String(s == null ? '' : s).slice(0, n);
const PING_SEC = 30, MAX_BYTES = 3900;

function browserName(ua) {
  const m = ua.match(/(YaBrowser|EdgA|EdgiOS|Edg|OPR|SamsungBrowser|FxiOS|Firefox|CriOS|Chrome)\/(\d+)/) || (/Safari\//.test(ua) && ua.match(/(Version)\/(\d+)/));
  if (!m) return '';
  const names = { YaBrowser: 'Яндекс', EdgA: 'Edge', EdgiOS: 'Edge', Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung', FxiOS: 'Firefox', CriOS: 'Chrome', Version: 'Safari' };
  return `${names[m[1]] || m[1]} ${m[2]}`;
}
function platformOf(ua) {
  let m;
  if ((m = ua.match(/(iPhone|iPad|iPod).*? OS (\d+[_\d]*)/))) return ['iOS', m[2].replace(/_/g, '.'), m[1]];
  if ((m = ua.match(/Android (\d+[.\d]*)/))) { const d = ua.match(/Android [^;)]*; ([^;)]+?)(?: Build|\))/); return ['Android', m[1], d ? d[1].trim() : '']; }
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) return ['Windows', m[1], ''];
  if ((m = ua.match(/Mac OS X (\d+[_\d]*)/))) return ['macOS', m[1].replace(/_/g, '.'), ''];
  if (/Linux/.test(ua)) return ['Linux', '', ''];
  return ['', '', ''];
}
function gpuOf(gl) {
  try {
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return cut((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '', 160);
  } catch (e) { return ''; }
}
// Описание устройства. Точную модель отдают только браузеры на Chromium (в основном Android); iPhone модель не сообщает.
async function deviceInfo(gl) {
  const ua = navigator.userAgent;
  const [platform, platformVersion, model] = platformOf(ua);
  const d = {
    ua: cut(ua, 300), platform, platformVersion, model, browser: browserName(ua),
    screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    gpu: gpuOf(gl), lang: cut(navigator.language, 20), ref: cut(document.referrer, 200), utm: cut(location.search, 200),
    webview: /Telegram|VKAndroidApp|VKClient|Instagram|FBAN|FBAV|; wv\)/.test(ua), touch: window.matchMedia('(pointer: coarse)').matches,
  };
  try { d.tz = cut(Intl.DateTimeFormat().resolvedOptions().timeZone, 60); } catch (e) { d.tz = ''; }
  try {
    const uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
      const hi = await Promise.race([uad.getHighEntropyValues(['model', 'platformVersion']), new Promise((res) => setTimeout(() => res(null), 800))]);
      if (hi) { if (hi.model) d.model = cut(hi.model, 80); if (hi.platformVersion) d.platformVersion = cut(hi.platformVersion, 40); if (hi.platform) d.platform = cut(hi.platform, 40); }
    }
  } catch (e) { /* остаётся то, что прочитано из строки браузера */ }
  return d;
}

// gl — контекст WebGL (для названия видеокарты); state() — что сейчас на экране: { fps, quality, mode, cam }
export function initAnalytics({ gl = null, state = null } = {}) {
  const noop = { track() {} };
  if (!API || !API.base) return noop;
  const url = API.base + API.event;
  let seq = 0, active = 0, last = performance.now(), visible = document.visibilityState === 'visible', lastSent = -1;
  const tick = () => { const now = performance.now(); if (visible) active += (now - last) / 1000; last = now; };
  function track(type, data = {}) {
    tick();
    const ev = { v: 1, app: 'v2', vid: VID, sid: SID, type, t: Math.round(active), seq: seq++, ...data };
    let body = JSON.stringify(ev);
    if (new Blob([body]).size > MAX_BYTES) { delete ev.ua; delete ev.ref; delete ev.utm; body = JSON.stringify(ev); }
    lastSent = active;
    // строка уходит как text/plain: такой запрос браузер отправляет без предварительного OPTIONS
    try { if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return; } catch (e) { /* пробуем fetch */ }
    try { fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {}); } catch (e) {}
  }
  const now = () => { try { return state ? state() : {}; } catch (e) { return {}; } };
  document.addEventListener('visibilitychange', () => {
    tick(); visible = document.visibilityState === 'visible';
    if (!visible && active - lastSent > 2) track('close', now());
  });
  window.addEventListener('pagehide', () => { if (active - lastSent > 2) track('close', now()); });
  setInterval(() => { tick(); if (visible && active - lastSent >= PING_SEC - 1) track('ping', now()); }, 5000);
  deviceInfo(gl).then((d) => track('open', d), () => track('open', {}));
  // Самопроверка: адрес с ?debug=1 шлёт пробное событие обычным запросом и показывает на экране, что ответил сервер
  if (/[?&]debug=1/.test(location.search)) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99;background:#000;border:1px solid #fff;color:#fff;padding:14px 18px;font:500 14px/1.5 Inter,Arial,sans-serif;max-width:86vw;text-align:center';
    box.textContent = 'Статистика: проверяю связь с сервером…'; document.body.appendChild(box);
    box.addEventListener('click', () => box.remove());
    const body = JSON.stringify({ v: 1, vid: VID, sid: SID, type: 'debug', t: 0, seq: seq++ });
    fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
      .then((r) => { box.textContent = `Статистика: сервер ответил ${r.status}${r.status === 204 ? ', всё работает' : ''}. Посетитель ${VID.slice(0, 8)}. Нажмите, чтобы закрыть.`; })
      .catch((e) => { box.textContent = `Статистика: запрос до сервера не дошёл (${e.message}). Скорее всего, его режет блокировщик или сеть. Нажмите, чтобы закрыть.`; });
  }
  return { track };
}
