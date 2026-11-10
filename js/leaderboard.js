// Таблица лидеров: localStorage по умолчанию; общий вариант — свой сервер (server/) либо публичный JSON-блоб (jsonblob.com)
import { LEADERBOARD_URL, GFORM } from './config.js';

const KEY = 'laser3d.leaderboard.v2', NAME_KEY = 'laser3d.name';
const sortTrim = (list, n = 10) => (Array.isArray(list) ? list : []).filter(e => e && typeof e.time === 'number' && e.time > 20 && e.time < 3600).sort((a, b) => a.time - b.time).slice(0, n);
const isBlob = /jsonblob\.com\/api\/jsonBlob\//.test(LEADERBOARD_URL);
export const isShared = !!LEADERBOARD_URL || !!GFORM;

// ---- Google Форма + Таблица ----
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (cell !== '' || row.length) { row.push(cell); rows.push(row); } row = []; cell = ''; if (ch === '\r' && text[i + 1] === '\n') i++; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// Формат строки рекорда: в текстовой колонке «Имя» — «Имя | 151.2 §2».
// Время дублируется в имени, потому что Google определяет колонку «Время» как числовую и отбрасывает текстовые значения.
// §2 — версия физики: после изменения модели лодки старые результаты несравнимы и в таблицу не попадают.
const TAG = '§2';
async function gformGet() {
  const q = encodeURIComponent(`select A,B where B ends with '${TAG}'`);
  const r = await fetch(GFORM.csv + (GFORM.csv.includes('?') ? '&' : '?') + 'tq=' + q + '&_=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('csv ' + r.status);
  const rows = parseCSV(await r.text());
  const list = [];
  for (const row of rows.slice(1)) {
    let cell = String(row[1] || '').trim();
    if (!cell.endsWith(TAG) || cell.startsWith('#')) continue;
    cell = cell.slice(0, -TAG.length).trim();
    const sep = cell.lastIndexOf('|'); if (sep < 0) continue;
    const time = parseFloat(cell.slice(sep + 1).trim().replace(',', '.'));
    if (isNaN(time)) continue;
    list.push({ name: cell.slice(0, sep).trim().slice(0, 18) || 'Без имени', time, date: String(row[0] || '').slice(0, 10) });
  }
  return sortTrim(list, 50);
}
async function gformSubmit(entry) {
  const fd = new FormData();
  fd.append(GFORM.nameEntry, `${entry.name.replace(/[|§#]/g, ' ').trim()} | ${entry.time} ${TAG}`);
  if (GFORM.timeEntry) fd.append(GFORM.timeEntry, String(entry.time).replace('.', ','));
  await fetch(GFORM.action, { method: 'POST', mode: 'no-cors', body: fd });
  await new Promise(res => setTimeout(res, 1800));
  try { const list = await gformGet(); if (!list.some(e => e.name === entry.name && Math.abs(e.time - entry.time) < 0.05)) list.push(entry); return sortTrim(list); } catch (e) { return null; }
}

async function blobGet() {
  const r = await fetch(LEADERBOARD_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error('blob get ' + r.status);
  return sortTrim(await r.json(), 50);
}
async function blobPut(list) {
  const r = await fetch(LEADERBOARD_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(list) });
  if (!r.ok) throw new Error('blob put ' + r.status);
  return sortTrim(list);
}
function localGet() { try { return sortTrim(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return []; } }
function localAdd(entry) {
  let list = []; try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
  list.push(entry); list = sortTrim(list);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  return list;
}

export async function loadTop() {
  if (GFORM) { try { return (await gformGet()).slice(0, 10); } catch (e) { /* локально */ } }
  if (LEADERBOARD_URL) {
    try {
      if (isBlob) return (await blobGet()).slice(0, 10);
      const r = await fetch(LEADERBOARD_URL + '/top', { cache: 'no-store' }); if (r.ok) return sortTrim(await r.json());
    } catch (e) { /* падаем на локальную */ }
  }
  return localGet();
}
export function isRecord(top, time) { return top.length < 10 || time < top[top.length - 1].time; }
export async function submit(name, time) {
  const entry = { name: String(name).slice(0, 18) || 'Без имени', time: Math.round(time * 10) / 10, date: new Date().toISOString().slice(0, 10) };
  if (GFORM) { try { const r = await gformSubmit(entry); if (r) return r; } catch (e) { /* локально */ } }
  if (LEADERBOARD_URL) {
    try {
      if (isBlob) { const cur = await blobGet(); cur.push(entry); return await blobPut(sortTrim(cur, 50)); }
      const r = await fetch(LEADERBOARD_URL + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
      if (r.ok) return sortTrim(await r.json());
    } catch (e) { /* локально */ }
  }
  return localAdd(entry);
}
export function rememberName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }
export function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
