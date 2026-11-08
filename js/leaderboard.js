// Таблица лидеров: локально (localStorage) или через общий сервер (LEADERBOARD_URL)
import { LEADERBOARD_URL } from './config.js';

const KEY = 'laser3d.leaderboard', NAME_KEY = 'laser3d.name';
const sortTrim = (list) => list.filter(e => e && typeof e.time === 'number' && e.time > 20).sort((a, b) => a.time - b.time).slice(0, 10);

export async function loadTop() {
  if (LEADERBOARD_URL) {
    try { const r = await fetch(LEADERBOARD_URL + '/top', { cache: 'no-store' }); if (r.ok) return sortTrim(await r.json()); } catch (e) { /* падаем на локальную */ }
  }
  try { return sortTrim(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return []; }
}
export function isRecord(top, time) { return top.length < 10 || time < top[top.length - 1].time; }
export async function submit(name, time) {
  const entry = { name: String(name).slice(0, 18) || 'Без имени', time: Math.round(time * 10) / 10, date: new Date().toISOString().slice(0, 10) };
  if (LEADERBOARD_URL) {
    try {
      const r = await fetch(LEADERBOARD_URL + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
      if (r.ok) return sortTrim(await r.json());
    } catch (e) { /* локально */ }
  }
  let list = []; try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
  list.push(entry); list = sortTrim(list);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  return list;
}
export function rememberName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }
export function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
export const isShared = !!LEADERBOARD_URL;
