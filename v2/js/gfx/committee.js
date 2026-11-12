// Судейский катер: стоит на якоре у правого конца стартовой линии и подаёт сигналы флагами.
// Корпус с килем и скулой, рубка, сигнальная мачта с реем, кормовой флаг, кранцы, леера, якорный канат,
// на корме учебное хозяйство: запасные знаки, флаги в стойке, доска со схемой дистанции, рупор, аптечка.
// Всё собирается из формул и простых тел; детали одного материала склеиваются в одну сетку.
import * as B from 'babylon';
import { V3, computeNormals } from '../vec.js';
import { makeBody, buildHead } from '../model/body.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvasTex(scene, name, w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new B.DynamicTexture(name, c, scene, true); t.update(true); t.anisotropicFilteringLevel = 4; return t;
}
function flagTexture(scene, kind) {
  return canvasTex(scene, 'flag' + kind, 192, 128, (g) => {
    if (kind === 'P') { g.fillStyle = '#0a3ea8'; g.fillRect(0, 0, 192, 128); g.fillStyle = '#fff'; g.fillRect(58, 38, 76, 52); }
    else if (kind === 'X') { g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 128); g.fillStyle = '#0a3ea8'; g.fillRect(76, 0, 40, 128); g.fillRect(0, 44, 192, 40); }
    else if (kind === 'line') { g.fillStyle = '#ff5a00'; g.fillRect(0, 0, 192, 128); }
    else if (kind === 'rus') { g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 43); g.fillStyle = '#0039a6'; g.fillRect(0, 43, 192, 43); g.fillStyle = '#d52b1e'; g.fillRect(0, 86, 192, 42); }
    else {                                            // флаг класса: красный знак лазера на белом
      g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 128); g.strokeStyle = '#d21f1f'; g.lineWidth = 7; g.lineCap = 'round';
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(96 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); g.lineTo(96 + Math.cos(a) * (i % 2 ? 34 : 46), 64 + Math.sin(a) * (i % 2 ? 34 : 46)); g.stroke(); }
    }
  });
}

export function makeCommittee(world) {
  const scene = world.scene, node = new B.TransformNode('rc', scene), bob = new B.TransformNode('rcBob', scene); bob.parent = node;
  const pbr = (name, rough, metal = 0, rgb = [1, 1, 1]) => { const m = new B.PBRMaterial(name, scene); m.albedoColor = new B.Color3(rgb[0], rgb[1], rgb[2]); m.roughness = rough; m.metallic = metal; return m; };
  const paintM = pbr('rcPaint', 0.55), hullM = pbr('rcHull', 0.4), glassM = pbr('rcGlass', 0.12, 0.3, [0.015, 0.025, 0.035]), steelM = pbr('rcSteel', 0.3, 1, [0.75, 0.77, 0.8]);
  hullM.backFaceCulling = false; hullM.twoSidedLighting = true;
  const reg = (m, mat, cast = true) => { m.material = mat; m.parent = bob; m.isPickable = false; if (m.getVerticesData(B.VertexBuffer.ColorKind)) m.useVertexColors = true; world.addBoatMesh(m, { cast, receive: true, reflect: true }); return m; };
  const lists = { paint: [], glass: [], steel: [] };
  const add = (m, kind, rgb) => {
    if (kind === 'paint') { const n = m.getTotalVertices(), c = new Float32Array(n * 4); for (let i = 0; i < n; i++) { c[i * 4] = rgb[0]; c[i * 4 + 1] = rgb[1]; c[i * 4 + 2] = rgb[2]; c[i * 4 + 3] = 1; } m.setVerticesData(B.VertexBuffer.ColorKind, c); }
    lists[kind].push(m); return m;
  };
  const box = (w, h, d, x, y, z, rgb, kind = 'paint', rot) => { const m = B.CreateBox('b', { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); return add(m, kind, rgb); };
  const cyl = (d0, d1, h, x, y, z, rgb, kind = 'paint', rot, seg = 12) => { const m = B.CreateCylinder('c', { diameterBottom: d0, diameterTop: d1, height: h, tessellation: seg }, scene); m.position.set(x, y, z); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); return add(m, kind, rgb); };
  const tor = (d, th, x, y, z, rgb, rot, kind = 'paint') => { const m = B.CreateTorus('t', { diameter: d, thickness: th, tessellation: 20 }, scene); m.position.set(x, y, z); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); return add(m, kind, rgb); };
  // пруток между двумя точками: леера, стойки, канаты
  const rod = (a, b, r, rgb, kind = 'steel') => {
    const d = new B.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); d.scaleInPlace(1 / L);
    const m = B.CreateCylinder('r', { diameter: r * 2, height: L, tessellation: 8 }, scene); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const axis = B.Vector3.Cross(B.Vector3.Up(), d);
    m.rotationQuaternion = axis.lengthSquared() < 1e-9 ? B.Quaternion.Identity() : B.Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, d.y))));
    return add(m, kind, rgb);
  };
  const WHITE = [0.82, 0.83, 0.84], NAVY = [0.02, 0.045, 0.115], RED = [0.5, 0.035, 0.025], TEAK = [0.4, 0.27, 0.16], ORANGE = [0.95, 0.2, 0.01], BLACK = [0.02, 0.02, 0.024], CREAM = [0.72, 0.68, 0.55], GREY = [0.3, 0.31, 0.33];

  // ---- корпус: киль, скула, развал бортов; ватерлиния красная, над ней белая полоса, борт синий, планширь белый ----
  const L = 8.6, NXh = 40, D = 1.0;
  const st = (u) => {
    const hw = 1.42 * (u < 0.4 ? 0.86 + 0.14 * Math.sin(u / 0.4 * Math.PI / 2) : Math.pow(Math.max(0, 1 - Math.pow((u - 0.4) / 0.6, 2.3)), 0.62));
    return { x: -L / 2 + L * u, hw, sheer: 1.04 + 0.5 * Math.pow(u, 2.4), keel: -0.55 + 0.95 * Math.pow(sm(0.7, 1, u), 1.4), chine: -0.02 + 0.55 * u * u * u, cw: hw * (0.84 - 0.2 * u * u) };
  };
  { const pos = [], col = [], idx = [], rows = [];
    // строки полусечения: 0 — киль, 3 — скула, дальше борт по высотам границ цвета
    const half = (s) => { const r = [];
      for (let k = 0; k <= 3; k++) { const q = k / 3; r.push([s.cw * q, s.keel + (s.chine - s.keel) * Math.pow(q, 1.15), RED]); }
      const at = (y, c) => { const q = Math.min(1, Math.max(0, (y - s.chine) / (s.sheer - s.chine))); r.push([s.cw + (s.hw - s.cw) * Math.pow(q, 0.8), s.chine + (s.sheer - s.chine) * q, c]); };
      at(0.07, RED); at(0.075, WHITE); at(0.2, WHITE); at(0.205, NAVY); at(s.sheer - 0.13, NAVY); at(s.sheer - 0.125, WHITE); at(s.sheer, WHITE); return r; };
    for (let i = 0; i <= NXh; i++) { const s = st(i / NXh), h = half(s), row = [];
      for (let k = h.length - 1; k >= 0; k--) row.push([s.x, h[k][1], -h[k][0], h[k][2]]);
      for (let k = 1; k < h.length; k++) row.push([s.x, h[k][1], h[k][0], h[k][2]]);
      rows.push(row); }
    const NR = rows[0].length;
    for (const r of rows) for (const p of r) { pos.push(p[0], p[1], p[2]); col.push(p[3][0], p[3][1], p[3][2], 1); }
    for (let i = 0; i < NXh; i++) for (let j = 0; j < NR - 1; j++) { const a = i * NR + j, b = a + 1, c = a + NR, d = c + 1; idx.push(a, b, c, b, d, c); }
    // транец
    const c0 = pos.length / 3; pos.push(-L / 2, 0.4, 0); col.push(NAVY[0], NAVY[1], NAVY[2], 1);
    const t0 = pos.length / 3; for (let j = 0; j < NR; j++) { pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); const c = rows[0][j][3]; col.push(c[0], c[1], c[2], 1); }
    for (let j = 0; j < NR - 1; j++) idx.push(c0, t0 + j, t0 + j + 1);
    idx.push(c0, t0 + NR - 1, t0);                                   // верхний клин транца: от планширя до планширя
    // палуба: настил чуть ниже планширя
    const d0 = pos.length / 3;
    for (let i = 0; i <= NXh; i++) { const s = st(i / NXh), y = s.sheer - 0.07; for (const z of [-0.97, 0.97]) { pos.push(s.x, y, s.hw * z); col.push(TEAK[0], TEAK[1], TEAK[2], 1); } }
    for (let i = 0; i < NXh; i++) { const a = d0 + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const m = new B.Mesh('rcHull', scene), vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.colors = col; vd.normals = []; B.VertexData.ComputeNormals(pos, idx, vd.normals); vd.applyToMesh(m);
    reg(m, hullM); }
  const hwAt = (x) => st((x + L / 2) / L).hw, sheerAt = (x) => st((x + L / 2) / L).sheer;

  // ---- рубка ----
  const CX = 0.4, CL = 2.3, CW = 1.9, y0 = D - 0.03;
  box(CL, 0.58, CW, CX, y0 + 0.29, 0, WHITE);
  box(CL - 0.06, 0.5, CW - 0.06, CX, y0 + 0.83, 0, null, 'glass');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.09, 0.52, 0.09, CX + sx * (CL / 2 - 0.045), y0 + 0.83, sz * (CW / 2 - 0.045), WHITE);
  for (const sz of [-1, 1]) box(0.07, 0.52, 0.06, CX + 0.1, y0 + 0.83, sz * (CW / 2 - 0.03), WHITE);
  box(0.06, 0.52, 0.07, CX + CL / 2 - 0.03, y0 + 0.83, 0, WHITE);
  box(CL + 0.02, 0.08, CW + 0.02, CX, y0 + 1.12, 0, WHITE);
  box(CL + 0.5, 0.06, CW + 0.34, CX - 0.05, y0 + 1.19, 0, WHITE);                       // крыша с козырьком
  box(0.03, 0.9, 0.62, CX - CL / 2 - 0.016, y0 + 0.5, 0.35, GREY);                       // дверь
  const roofY = y0 + 1.22;
  cyl(0.5, 0.42, 0.13, CX + 0.55, roofY + 0.19, 0, WHITE, 'paint', null, 20); cyl(0.07, 0.07, 0.14, CX + 0.55, roofY + 0.07, 0, GREY);       // радар
  for (const sz of [-1, 1]) cyl(0.17, 0.05, 0.3, CX + 0.95, roofY + 0.09, sz * 0.3, RED, 'paint', [0, 0, -Math.PI / 2]);                   // сигнальные рожки
  cyl(0.13, 0.13, 0.12, CX + 0.2, roofY + 0.1, -0.6, null, 'steel'); cyl(0.014, 0.008, 1.7, CX - 0.6, roofY + 0.85, 0.8, BLACK);            // прожектор, антенна
  box(0.1, 0.07, 0.05, CX + 0.6, roofY + 0.03, CW / 2 + 0.12, [0.03, 0.5, 0.1]); box(0.1, 0.07, 0.05, CX + 0.6, roofY + 0.03, -CW / 2 - 0.12, [0.7, 0.03, 0.02]);   // ходовые огни
  rod([CX - 0.9, roofY + 0.04, -0.7], [CX + 0.9, roofY + 0.04, -0.78], 0.016, null);                                                       // отпорный крюк на крыше
  // спасательные круги на бортах рубки
  for (const sz of [-1, 1]) { tor(0.56, 0.1, CX - 0.7, y0 + 0.36, sz * (CW / 2 + 0.05), ORANGE, [Math.PI / 2, 0, 0]); for (const a of [0, 1, 2, 3]) box(0.11, 0.11, 0.12, CX - 0.7 + 0.28 * Math.cos(a * Math.PI / 2 + 0.78), y0 + 0.36 + 0.28 * Math.sin(a * Math.PI / 2 + 0.78), sz * (CW / 2 + 0.05), WHITE); }
  // название на рубке
  { const tex = canvasTex(scene, 'rcName', 768, 128, (g, w, h) => { g.fillStyle = '#d6d8da'; g.fillRect(0, 0, w, h); g.textBaseline = 'middle'; g.font = '800 76px Inter, Arial, sans-serif'; g.fillStyle = '#0047ff'; g.fillText('>>>', 24, h / 2 + 2); g.font = 'italic 700 70px Inter, Arial, sans-serif'; g.fillStyle = '#101214'; g.fillText('СИЛА ВЕТРА', 190, h / 2 + 4); });
    const nm = pbr('rcNameM', 0.55); nm.albedoTexture = tex; nm.backFaceCulling = false;
    for (const sz of [-1, 1]) { const p = B.CreatePlane('name', { width: 1.3, height: 0.22 }, scene); p.position.set(CX + 0.35, y0 + 0.3, sz * (CW / 2 + 0.006)); p.rotation.y = sz > 0 ? 0 : Math.PI; reg(p, nm, false); } }
  // доска со схемой дистанции на задней стенке рубки
  { const tex = canvasTex(scene, 'rcBoard', 512, 384, (g, w, h) => {
      g.fillStyle = '#f2f3f0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a8d90'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      g.strokeStyle = '#1b2f8f'; g.fillStyle = '#1b2f8f'; g.lineWidth = 5; g.font = '700 30px Arial, sans-serif';
      g.beginPath(); g.moveTo(60, 50); g.lineTo(60, 120); g.stroke(); g.beginPath(); g.moveTo(60, 128); g.lineTo(48, 104); g.lineTo(72, 104); g.fill(); g.fillText('ВЕТЕР', 84, 96);
      g.fillStyle = '#e2470a'; g.beginPath(); g.arc(256, 70, 14, 0, 7); g.fill(); g.beginPath(); g.arc(150, 320, 12, 0, 7); g.fill(); g.fillStyle = '#1b2f8f'; g.fillRect(350, 308, 34, 22);
      g.setLineDash([12, 9]); g.strokeStyle = '#1b2f8f'; g.beginPath(); g.moveTo(162, 320); g.lineTo(350, 320); g.stroke();
      g.setLineDash([]); g.strokeStyle = '#c21d1d'; g.lineWidth = 4; g.beginPath(); g.moveTo(250, 316); g.lineTo(330, 240); g.lineTo(200, 160); g.lineTo(290, 96); g.lineTo(256, 52); g.lineTo(226, 74); g.lineTo(240, 300); g.stroke();
      g.fillStyle = '#101214'; g.font = '700 26px Arial, sans-serif'; g.fillText('1', 280, 62); g.fillText('СТАРТ · ФИНИШ', 150, 360); });
    const bm = pbr('rcBoardM', 0.7); bm.albedoTexture = tex; bm.backFaceCulling = false;
    const p = B.CreatePlane('board', { width: 0.8, height: 0.6 }, scene); p.position.set(CX - CL / 2 - 0.02, y0 + 0.62, -0.45); p.rotation.y = -Math.PI / 2; reg(p, bm, false);
    box(0.03, 0.66, 0.86, CX - CL / 2 - 0.012, y0 + 0.62, -0.45, GREY); }

  // ---- сигнальная мачта с реем ----
  const MX = CX - 0.75, MTOP = roofY + 4.3, YARD = roofY + 3.5;
  cyl(0.1, 0.07, MTOP - roofY, MX, (MTOP + roofY) / 2, 0, WHITE, 'paint', null, 10);
  cyl(0.05, 0.05, 3.1, MX, YARD, 0, WHITE, 'paint', [Math.PI / 2, 0, 0], 8);
  for (const sz of [-1, 1]) { rod([MX, YARD + 0.5, 0], [MX, YARD, sz * 1.5], 0.006, null); rod([MX, YARD, sz * 1.5], [MX - 0.1, roofY, sz * 0.95], 0.005, null); }      // топенанты и фалы
  cyl(0.06, 0.06, 0.04, MX, MTOP + 0.03, 0, BLACK); cyl(0.09, 0.09, 0.06, MX, MTOP + 0.3, 0, WHITE); cyl(0.012, 0.012, 0.3, MX, MTOP + 0.16, 0, BLACK);    // топовый огонь

  // ---- леера: носовой релинг и поручни по корме ----
  { const rail = (xs, h) => { for (const sz of [-1, 1]) { let prev = null; for (const x of xs) { const z = sz * (hwAt(x) - 0.07), y = sheerAt(x) - 0.06, top = [x, y + h, z * 0.97]; rod([x, y, z], top, 0.014, null); if (prev) { rod(prev, top, 0.016, null); rod([prev[0], prev[1] - h * 0.5, prev[2]], [top[0], top[1] - h * 0.5, top[2]], 0.008, null); } prev = top; } } };
    rail([1.75, 2.4, 3.0, 3.55, 3.95, 4.22], 0.62); rail([-4.15, -3.4, -2.6, -1.8, -1.0], 0.6);
    rod([4.22, sheerAt(4.22) + 0.56, -0.05], [4.22, sheerAt(4.22) + 0.56, 0.05], 0.016, null);
    rod([-4.15, sheerAt(-4.15) + 0.54, -(hwAt(-4.15) - 0.07) * 0.97], [-4.15, sheerAt(-4.15) + 0.54, (hwAt(-4.15) - 0.07) * 0.97], 0.016, null); }
  // утки и якорь с канатом: катер стоит на якоре, канат уходит в воду перед носом
  for (const [x, sz] of [[3.3, 1], [3.3, -1], [-3.7, 1], [-3.7, -1]]) box(0.22, 0.05, 0.05, x, sheerAt(x) - 0.02, sz * (hwAt(x) - 0.2), null, 'steel');
  box(0.3, 0.06, 0.12, 4.12, sheerAt(4.1) - 0.02, 0, null, 'steel');
  rod([4.25, sheerAt(4.2) - 0.02, 0], [9.4, -1.2, 0], 0.022, CREAM, 'paint');
  // кранцы по бортам
  for (const x of [-2.9, -0.6, 2.0]) for (const sz of [-1, 1]) { const z = sz * (hwAt(x) + 0.13), y = 0.62; const f = B.CreateCapsule('f', { radius: 0.13, height: 0.62, tessellation: 12 }, scene); f.position.set(x, y, z); add(f, 'paint', WHITE); cyl(0.275, 0.275, 0.07, x, y + 0.2, z, NAVY); rod([x, y + 0.3, z], [x, sheerAt(x) + 0.5, sz * (hwAt(x) - 0.07)], 0.009, CREAM, 'paint'); }
  // подвесной мотор
  box(0.5, 0.52, 0.4, -4.62, 1.28, 0, BLACK); box(0.52, 0.06, 0.42, -4.62, 1.2, 0, WHITE); box(0.16, 1.25, 0.2, -4.62, 0.42, 0, GREY); box(0.3, 0.06, 0.34, -4.62, -0.15, 0, GREY); box(0.3, 0.4, 0.5, -4.36, 0.9, 0, GREY);

  // ---- учебное хозяйство на корме ----
  const dk = D - 0.03;
  { const m = B.CreateCapsule('mark', { radius: 0.3, height: 1.15, tessellation: 16 }, scene); m.position.set(-3.0, dk + 0.31, 0.72); m.rotation.z = Math.PI / 2; add(m, 'paint', ORANGE); }       // запасной знак-цилиндр
  cyl(0.9, 0.0, 0.95, -3.35, dk + 0.47, -0.72, [0.85, 0.62, 0.02], 'paint', [0, 0.5, 0], 4);                                                 // знак-пирамида
  tor(0.5, 0.06, -3.75, dk + 0.04, -0.05, CREAM); tor(0.42, 0.06, -3.75, dk + 0.1, -0.05, CREAM);                                           // бухта каната
  box(0.3, 0.36, 0.18, -3.95, dk + 0.18, 0.95, [0.6, 0.03, 0.02]); cyl(0.06, 0.06, 0.04, -3.86, dk + 0.38, 0.95, BLACK);                    // канистра
  // стойка с флагами у рубки: запасные сигналы свёрнуты
  box(0.14, 0.4, 0.5, CX - CL / 2 - 0.1, dk + 0.2, 0.85, GREY);
  [[0.04, 0.24, 0.66], [0.85, 0.85, 0.85], [0.75, 0.05, 0.04], [0.85, 0.7, 0.02]].forEach((c, i) => { const z = 0.67 + i * 0.12; rod([CX - CL / 2 - 0.1, dk + 0.1, z], [CX - CL / 2 - 0.22, dk + 1.35, z + 0.03], 0.012, CREAM, 'paint'); rod([CX - CL / 2 - 0.16, dk + 0.7, z + 0.015], [CX - CL / 2 - 0.22, dk + 1.33, z + 0.03], 0.035, c, 'paint'); });
  // аптечка на стенке рубки и рупор на крыше
  box(0.05, 0.24, 0.32, CX - CL / 2 - 0.03, y0 + 0.85, 0.72, WHITE); box(0.012, 0.14, 0.045, CX - CL / 2 - 0.058, y0 + 0.85, 0.72, RED); box(0.012, 0.045, 0.14, CX - CL / 2 - 0.058, y0 + 0.85, 0.72, RED);
  cyl(0.26, 0.07, 0.34, CX - 0.85, roofY + 0.14, 0.45, WHITE, 'paint', [0, 0, Math.PI / 2], 16); cyl(0.07, 0.07, 0.12, CX - 0.62, roofY + 0.14, 0.45, RED, 'paint', [0, 0, Math.PI / 2]);
  // стопка спасательных жилетов
  box(0.5, 0.1, 0.36, -2.25, dk + 0.05, 1.0, ORANGE); box(0.48, 0.1, 0.34, -2.23, dk + 0.15, 1.01, [0.9, 0.55, 0.02], 'paint', [0, 0.12, 0]); box(0.46, 0.1, 0.33, -2.26, dk + 0.25, 0.99, ORANGE, 'paint', [0, -0.1, 0]);
  // сумка-холодильник и ящик с бутылками: после гонки
  box(0.52, 0.34, 0.34, -1.45, dk + 0.17, -0.98, [0.03, 0.2, 0.62]); box(0.54, 0.05, 0.36, -1.45, dk + 0.365, -0.98, WHITE); rod([-1.62, dk + 0.4, -0.98], [-1.28, dk + 0.4, -0.98], 0.012, GREY, 'paint');
  box(0.44, 0.2, 0.3, -2.05, dk + 0.1, -1.0, [0.72, 0.5, 0.04]);
  const bottle = (x, y, z) => { cyl(0.064, 0.064, 0.16, x, y + 0.08, z, [0.16, 0.07, 0.015], 'paint', null, 10); cyl(0.064, 0.028, 0.045, x, y + 0.182, z, [0.16, 0.07, 0.015], 'paint', null, 10); cyl(0.028, 0.028, 0.05, x, y + 0.23, z, [0.16, 0.07, 0.015], 'paint', null, 8); cyl(0.032, 0.032, 0.012, x, y + 0.26, z, [0.8, 0.62, 0.1], 'paint', null, 8); cyl(0.066, 0.066, 0.06, x, y + 0.09, z, [0.85, 0.82, 0.7], 'paint', null, 10); };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) bottle(-2.2 + i * 0.1, dk + 0.06, -1.09 + j * 0.09);
  bottle(-1.56, dk + 0.39, -1.02); bottle(-1.36, dk + 0.39, -0.93);

  // ---- склейка по материалам ----
  for (const [kind, mat] of [['paint', paintM], ['glass', glassM], ['steel', steelM]]) {
    const list = lists[kind]; if (!list.length) continue;
    for (const m of list) m.computeWorldMatrix(true);
    reg(B.Mesh.MergeMeshes(list, true, true), mat);
  }

  // ---- судья на корме: стоит лицом к линии, в руке сигнальный рожок ----
  { const body = makeBody(), P = (x, y, z) => new V3(x, y, z), px = -2.35, pz = -0.3, hy = dk + 0.94;
    const hip = P(px, hy, pz), up = P(0, 1, 0), shoulders = P(1, 0, 0), front = P(0, 0, -1);
    body.torso(hip, up, shoulders, false, up, front, 0.012);
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const hj = P(px + s * 0.1, hy - 0.03, pz), an = P(px + s * 0.13, dk + 0.078, pz + 0.02), kn = P(px + s * 0.115, hy - 0.46, pz - 0.05);
      body.leg(i, hj, kn, an, P(an.x + s * 0.04, an.y, an.z - 0.19), front);
      const sh = P(px + s * 0.165, hy + 0.42, pz);
      if (s < 0) body.arm(i, sh, P(sh.x - 0.05, sh.y - 0.27, sh.z - 0.08), P(sh.x - 0.04, sh.y - 0.5, sh.z - 0.2), shoulders, false, shoulders);
      else body.arm(i, sh, P(sh.x + 0.07, sh.y - 0.16, sh.z - 0.24), P(sh.x + 0.02, sh.y + 0.06, sh.z - 0.38), up, false, shoulders);
    }
    const flip = (idx) => { const o = idx.slice(); for (let i = 0; i < o.length; i += 3) { const q = o[i + 1]; o[i + 1] = o[i + 2]; o[i + 2] = q; } return o; };
    const mk = (name, d, mat, parent) => { const m = new B.Mesh(name, scene), vd = new B.VertexData(); vd.positions = d.positions; vd.indices = flip(d.indices); if (d.colors) vd.colors = d.colors; vd.normals = computeNormals(d.positions, d.indices, new Float32Array(d.positions.length)); vd.applyToMesh(m); reg(m, mat); if (parent) m.parent = parent; return m; };
    const bodyM = pbr('rcBody', 0.74); mk('judge', body, bodyM);
    const H = buildHead(), hg = new B.TransformNode('judgeHead', scene); hg.parent = bob; hg.position.set(px, hy + 0.655, pz - 0.02); hg.rotation.y = Math.PI / 2;
    const capM = pbr('rcCap', 0.8, 0, [0.9, 0.2, 0.15]); capM.backFaceCulling = false; capM.twoSidedLighting = true; const glM = pbr('rcGl', 0.18, 0.6, [0.005, 0.005, 0.006]); glM.backFaceCulling = false;
    mk('judgeSkin', H.skin, bodyM, hg); mk('judgeCap', H.cap, capM, hg); mk('judgeGlasses', H.glasses, glM, hg);
    // рожок в поднятой руке
    const horn = B.CreateCylinder('horn', { diameterBottom: 0.05, diameterTop: 0.11, height: 0.2, tessellation: 12 }, scene); horn.position.set(px + 0.185, hy + 0.56, pz - 0.4); horn.rotation.x = -1.1;
    const hornM = pbr('rcHorn', 0.5, 0, [0.6, 0.04, 0.03]); reg(horn, hornM); }

  // ---- флаги: сигнальные на рее, оранжевый на топе мачты, государственный на кормовом флагштоке ----
  const mkFlag = (kind, w, h) => {
    const g = new B.TransformNode('fl' + kind, scene); g.parent = bob;
    const mat = pbr('fm' + kind, 0.9); mat.albedoTexture = flagTexture(scene, kind); mat.backFaceCulling = false; mat.twoSidedLighting = true;
    // полотнище из полос: волна идёт от древка к свободному краю
    const N = 12, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) { pos.push(-w * i / N, h / 2, 0, -w * i / N, -h / 2, 0); uv.push(i / N, 1, i / N, 0); }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const m = new B.Mesh('flag', scene), vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.normals = []; B.VertexData.ComputeNormals(pos, idx, vd.normals); vd.applyToMesh(m, true);
    m.material = mat; m.parent = g; m.isPickable = false; world.addBoatMesh(m, { cast: false, receive: false, reflect: true });
    return { g, m, pos: new Float32Array(pos), w, N, up: 0 };
  };
  const F = { line: mkFlag('line', 0.95, 0.65), cls: mkFlag('cls', 1.05, 0.7), P: mkFlag('P', 1.05, 0.7), X: mkFlag('X', 1.05, 0.7), rus: mkFlag('rus', 1.15, 0.77) };
  F.line.g.position.set(MX, MTOP - 0.45, 0); F.cls.g.position.set(MX, YARD, -1.3); F.P.g.position.set(MX, YARD, 1.3); F.X.g.position.set(MX, YARD, 0.6);
  // кормовой флагшток с наклоном назад
  { const a = [-4.2, sheerAt(-4.2) - 0.05, 0.55], b = [-4.75, sheerAt(-4.2) + 1.75, 0.55]; const s = rod(a, b, 0.018, null); lists.steel.length = 0; reg(s, steelM); const k = B.CreateSphere('knob', { diameter: 0.07, segments: 8 }, scene); k.position.set(b[0], b[1] + 0.02, b[2]); reg(k, steelM);
    F.rus.g.position.set(b[0] + 0.13, b[1] - 0.42, b[2]); }
  F.line.up = 1; F.rus.up = 1;
  // флаги смотрят по ветру, поднимаются и спускаются по фалу, полощут
  function setFlags(fl, t, windFrom) {
    const yawW = Math.PI / 2 - (windFrom + 180) * Math.PI / 180 - node.rotation.y;      // куда дует, в осях катера
    for (const k of ['line', 'cls', 'P', 'X', 'rus']) {
      const f = F[k], always = k === 'line' || k === 'rus', want = always ? 1 : fl[k] ? 1 : 0;
      f.up += (want - f.up) * 0.08; f.g.setEnabled(f.up > 0.02);
      if (!always) f.g.position.y = roofY + 0.5 + (YARD - 0.42 - roofY - 0.5) * f.up;
      f.g.rotation.y = yawW + Math.PI;
      const amp = k === 'rus' ? 1.25 : 1;
      for (let i = 0; i <= f.N; i++) { const u = i / f.N, z = amp * (0.09 * u * Math.sin(t * 9 - u * 7 + k.length) + 0.05 * u * Math.sin(t * 5.3 + u * 4)); f.pos[i * 6 + 2] = z; f.pos[i * 6 + 5] = z; }
      f.m.updateVerticesData(B.VertexBuffer.PositionKind, f.pos, false, false);
    }
  }
  return { node, bob, setFlags, waveL: 7, setEnabled: (v) => node.setEnabled(v) };
}
