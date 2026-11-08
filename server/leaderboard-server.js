#!/usr/bin/env node
// Сервер таблицы лидеров «Лазер 3D». Node.js 18+, без зависимостей.
// Хранит результаты в JSON-файле. Эндпоинты: GET /top, POST /submit {name,time}, GET /health
// Запуск: PORT=8787 DATA=/var/lib/laser-leaderboard/top.json node leaderboard-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const DATA = process.env.DATA || path.join(__dirname, 'top.json');
const ORIGIN = process.env.ORIGIN || '*';          // можно ограничить: https://klouner.github.io
const MAX_KEEP = 100;

let list = [];
try { list = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { list = []; }
function save() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 0));
  fs.renameSync(tmp, DATA);
}

// простой лимит: не чаще 1 записи в 10 секунд с одного адреса
const lastSubmit = new Map();

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors }); res.end(JSON.stringify(data)); };
const top10 = () => list.slice(0, 10);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/health') return send(res, 200, { ok: true, count: list.length });
  if (url.pathname === '/top' && req.method === 'GET') return send(res, 200, top10());
  if (url.pathname === '/submit' && req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const now = Date.now();
    if (lastSubmit.get(ip) && now - lastSubmit.get(ip) < 10000) return send(res, 429, { error: 'too fast' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      let e; try { e = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
      const time = Number(e.time);
      const name = String(e.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Без имени';
      if (!(time > 20 && time < 3600)) return send(res, 400, { error: 'bad time' });
      lastSubmit.set(ip, now);
      list.push({ name, time: Math.round(time * 10) / 10, date: new Date().toISOString().slice(0, 10) });
      list.sort((a, b) => a.time - b.time);
      list = list.slice(0, MAX_KEEP);
      try { save(); } catch (err) { console.error('save failed', err); }
      return send(res, 200, top10());
    });
    return;
  }
  send(res, 404, { error: 'not found' });
});
server.listen(PORT, '127.0.0.1', () => console.log(`leaderboard on http://127.0.0.1:${PORT}, data: ${DATA}`));
