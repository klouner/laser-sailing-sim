// Cloudflare Worker для общей таблицы лидеров «Лазер 3D».
// Деплой: создайте Worker, привяжите KV namespace с именем TOP, вставьте этот код.
// Затем укажите адрес воркера в js/config.js (LEADERBOARD_URL).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const list = JSON.parse((await env.TOP.get('list')) || '[]');
    if (url.pathname === '/top') return json(list.slice(0, 10));
    if (url.pathname === '/submit' && req.method === 'POST') {
      let e; try { e = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const time = Number(e.time), name = String(e.name || '').replace(/[<>]/g, '').trim().slice(0, 18) || 'Без имени';
      if (!(time > 20 && time < 3600)) return json({ error: 'bad time' }, 400);
      list.push({ name, time: Math.round(time * 10) / 10, date: new Date().toISOString().slice(0, 10) });
      list.sort((a, b) => a.time - b.time);
      const trimmed = list.slice(0, 50);
      await env.TOP.put('list', JSON.stringify(trimmed));
      return json(trimmed.slice(0, 10));
    }
    return json({ error: 'not found' }, 404);
  },
};
