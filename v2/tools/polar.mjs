// Строит поляру лодки по той же физике, что работает на сайте: установившаяся скорость на каждом курсе и ветре.
// Запуск: node v2/tools/polar.mjs > v2/js/polar.js
import { createState, defaultControls, step, settleRig, norm180, KN } from '../js/physics.js';
const DT = 1 / 120, TWS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22], TWA = [38, 42, 46, 52, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 178];
const rows = [];
for (const w of TWS) {
  const row = [];
  for (const a of TWA) {
    const s = createState(), c = defaultControls(); c.gusts = false; c.windSpeed = w; c.autoSheet = true; s.heading = a; s.vf = 2; settleRig(s, c);
    let sum = 0, n = 0, caps = false, o;
    for (let i = 0; i < 50 / DT; i++) {
      const e = norm180(a - s.heading); c.rudder = Math.max(-25, Math.min(25, e * 1.3 - s.yawRate * 0.4));
      o = step(s, c, DT); if (s.capsized) caps = true;
      if (i > 38 / DT) { sum += o.speedKn; n++; }
    }
    row.push(caps ? 0 : Math.round(sum / n * 100) / 100);
  }
  // где автоматический матрос не удержал лодку, значение берётся по соседним курсам
  for (let j = 0; j < row.length; j++) if (!row[j]) { let l = j - 1, r = j + 1; while (r < row.length && !row[r]) r++; const a = row[l], b = r < row.length ? row[r] : a; row[j] = Math.round((a + (b - a) * (j - l) / (r - l)) * 100) / 100; }
  rows.push(row);
}
console.log(`// Поляра лодки: целевая скорость в узлах по силе ветра и курсу к истинному ветру.
// Файл создан скриптом tools/polar.mjs по физике из physics.js; после изменения физики его надо пересобрать.
export const POLAR = { tws: ${JSON.stringify(TWS)}, twa: ${JSON.stringify(TWA)}, kn: [\n${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')},\n] };
// Целевая скорость для ветра windKn и курса twaAbs (градусы к истинному ветру): линейная интерполяция по таблице
export function targetSpeed(windKn, twaAbs) {
  const P = POLAR, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const find = (arr, v) => { let i = 0; while (i < arr.length - 2 && v > arr[i + 1]) i++; return [i, cl((v - arr[i]) / (arr[i + 1] - arr[i]), 0, 1)]; };
  const [i, u] = find(P.tws, cl(windKn, P.tws[0], P.tws[P.tws.length - 1])), [j, v] = find(P.twa, cl(twaAbs, P.twa[0], P.twa[P.twa.length - 1]));
  const a = P.kn[i][j], b = P.kn[i][j + 1], c = P.kn[i + 1][j], d = P.kn[i + 1][j + 1];
  return (a + (b - a) * v) * (1 - u) + (c + (d - c) * v) * u;
}`);
