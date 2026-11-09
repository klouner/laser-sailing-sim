// Простая статистика: «открытие» при загрузке и «сеанс» с длительностью (в секундах активного времени) при уходе.
// Отправка — в Google Форму через sendBeacon/fetch no-cors, без cookies и без сторонних скриптов.
import { ANALYTICS } from './config.js';

export function initAnalytics() {
  if (!ANALYTICS || !ANALYTICS.action) return;
  const ua = navigator.userAgent;
  const device = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mobi/.test(ua) ? 'Mobile' : 'Desktop';
  const w = Math.round(screen.width), h = Math.round(screen.height);
  const devStr = `${device} ${w}x${h}${/Telegram|TelegramBot|VKAndroidApp|VKClient|Instagram|FBAN|FBAV/.test(ua) ? ' webview' : ''}`;
  const send = (event, duration, beacon) => {
    const fd = new FormData();
    fd.append(ANALYTICS.eventEntry, event);
    fd.append(ANALYTICS.durationEntry, String(Math.round(duration)));
    if (ANALYTICS.deviceEntry) fd.append(ANALYTICS.deviceEntry, devStr);
    if (beacon && navigator.sendBeacon) { try { if (navigator.sendBeacon(ANALYTICS.action, fd)) return; } catch (e) {} }
    try { fetch(ANALYTICS.action, { method: 'POST', mode: 'no-cors', body: fd, keepalive: true }); } catch (e) {}
  };
  // активное время: считаем только пока вкладка видима
  let active = 0, last = performance.now(), visible = document.visibilityState === 'visible', sentSession = false;
  const tick = () => { const now = performance.now(); if (visible) active += (now - last) / 1000; last = now; };
  document.addEventListener('visibilitychange', () => { tick(); visible = document.visibilityState === 'visible'; if (!visible) flush(false); else sentSession = false; });
  const flush = (final) => { tick(); if (active < 2) return; if (sentSession && !final) return; sentSession = true; send('сеанс', active, true); };
  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('beforeunload', () => flush(true));
  // контрольная точка каждые 5 минут — на случай, если уход страницы не поймаем (например, убили webview)
  setInterval(() => { tick(); if (visible && active > 30) { send('сеанс', active, false); sentSession = true; } }, 5 * 60 * 1000);
  send('открытие', 0, false);
}
