// Лодка в сцене: материалы, сборка из деталей, парус, снасти, матрос и обновление каждый кадр.
// Формы считают js/model/geo.js и js/model/sailor.js; здесь они превращаются в сетки Babylon.js.
import * as B from 'babylon';
import { V3, clamp, DEG, computeNormals, smoothstep } from '../vec.js';
import { HULL, RIG, COCKPIT, TRUNK_X, FLOOR_Y, deckAt, stationAtX, cockpitHalfWidth, cockpitSDF, buildHull, buildDeck, gunwalePath, buildFoil, makeTube, makeRope } from '../model/geo.js';
import { createSailor } from '../model/sailor.js';

const { MAST_H, RAKE, BOOM_H, BOOM_L, CLEW, LUFF0, HEAD } = RIG;

// ---------- текстуры ----------
function hullTexture(scene) {
  const W = 2048, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, W, H);
  // надпись на обоих бортах; на левом она повёрнута, чтобы читалась снаружи
  const draw = (cx, cy, rot) => {
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.fillStyle = '#101214'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = 'italic 700 46px Inter, Arial, sans-serif';
    g.fillText('СИЛА', -150, 0); g.fillText('ВЕТРА', 160, 0);
    g.font = '800 50px Inter, Arial, sans-serif'; g.fillText('>>>', 0, -2);
    g.restore();
  };
  draw(W * 0.6, H * 0.065, 0); draw(W * 0.6, H * 0.935, Math.PI);
  const t = new B.DynamicTexture('hullTex', c, scene, true); t.update(true); t.anisotropicFilteringLevel = 8;
  return t;
}

// Плоская форма паруса в осях гика: x от мачты назад (отрицательный), y вверх от палубы.
const SAIL = (() => {
  const tackY = LUFF0, headY = HEAD, clewX = -CLEW, clewY = BOOM_H + 0.04;
  const luffX = (y) => -RAKE * y / MAST_H;
  // u — от передней шкаторины (0) к задней (1), v — от гика (0) к топу (1)
  function flat(u, v, out) {
    const ly = tackY + (headY - tackY) * v, lx = luffX(ly);
    // задняя шкаторина: от шкотового угла к фаловому с небольшим серпом, который держат три латы
    const hx = luffX(headY) - 0.06, roach = 0.11 * Math.sin(Math.PI * Math.pow(v, 0.9)) * (1 - 0.25 * v);
    const ex0 = clewX + (hx - clewX) * v, ey0 = clewY + (headY - clewY) * v;
    const nx = -(headY - clewY), ny = (hx - clewX), nl = Math.hypot(nx, ny);
    const ex = ex0 + nx / nl * roach, ey = ey0 + ny / nl * roach;
    // нижняя шкаторина чуть провисает под гик
    const foot = -0.035 * Math.sin(Math.PI * u) * (1 - v) * (1 - v) * (1 - v);
    out.x = lx + (ex - lx) * u; out.y = ly + (ey - ly) * u + foot; out.chord = Math.hypot(ex - lx, ey - ly);
    return out;
  }
  return { flat, tackY, headY, clewX, clewY, xmin: clewX - 0.14, w: CLEW + 0.2, ymin: BOOM_H - 0.05, h: headY - BOOM_H + 0.15, luffX };
})();
function sailTexture(scene, mirror) {
  const W = 1024, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x - SAIL.xmin) / SAIL.w * W, Y = (y) => (1 - (y - SAIL.ymin) / SAIL.h) * H, px = W / SAIL.w;
  if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
  g.fillStyle = '#f3f2ee'; g.fillRect(0, 0, W, H);
  const p = { x: 0, y: 0, chord: 0 }, q = { x: 0, y: 0, chord: 0 };
  // чёрная вставка у топа
  g.fillStyle = '#0b0c0e'; g.beginPath();
  for (let i = 0; i <= 20; i++) { SAIL.flat(i / 20, 0.775, p); g.lineTo(X(p.x), Y(p.y)); }
  for (let j = 0; j <= 10; j++) { SAIL.flat(1, 0.775 + 0.225 * j / 10, p); g.lineTo(X(p.x), Y(p.y)); }
  for (let j = 10; j >= 0; j--) { SAIL.flat(0, 0.775 + 0.225 * j / 10, p); g.lineTo(X(p.x), Y(p.y)); }
  g.closePath(); g.fill();
  // швы полотнищ: идут поперёк задней шкаторины
  g.strokeStyle = 'rgba(60,66,74,0.34)'; g.lineWidth = 2.2;
  for (const v of [0.13, 0.27, 0.41, 0.55, 0.68]) { g.beginPath(); SAIL.flat(0, v + 0.035, p); SAIL.flat(1, v, q); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(q.x), Y(q.y)); g.stroke(); }
  // латы: три кармана у задней шкаторины
  g.strokeStyle = 'rgba(40,44,50,0.55)'; g.lineWidth = 7;
  for (const [v, len] of [[0.30, 0.62], [0.54, 0.62], [0.76, 0.42]]) {
    SAIL.flat(1, v, p); SAIL.flat(1 - len / Math.max(0.3, p.chord), v + 0.012, q);
    g.beginPath(); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(q.x), Y(q.y)); g.stroke();
  }
  // окно
  g.fillStyle = 'rgba(120,160,200,0.78)'; g.strokeStyle = 'rgba(50,60,72,0.7)'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(X(-1.32), Y(BOOM_H + 0.86), 0.62 * px, 0.56 * (H / SAIL.h), 10); g.fill(); g.stroke();
  // усиления углов
  g.fillStyle = 'rgba(200,203,208,0.9)';
  for (const [u, v, r] of [[0, 0, 0.3], [1, 0, 0.34], [0.5, 1, 0.26]]) { SAIL.flat(u, v, p); g.beginPath(); g.arc(X(p.x), Y(p.y), r * px, 0, Math.PI * 2); g.fill(); }
  // надписи: рисуются так, чтобы читались с той стороны, с которой видна эта текстура
  const text = (str, x, y, size, color, weight = 700, italic = false) => {
    g.save(); g.translate(X(x), Y(y)); if (mirror) g.scale(-1, 1);
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(size * px)}px Inter, Arial, sans-serif`; g.fillText(str, 0, 0); g.restore();
  };
  text('>>>', -1.18, BOOM_H + 2.62, 0.5, '#0047ff', 800);
  text('СИЛА ВЕТРА', -1.2, BOOM_H + 2.22, 0.2, '#101214', 700, true);
  text('RUS 214538', -1.12, BOOM_H + 1.72, 0.2, '#d21f1f', 700);
  // номер в круге на чёрной вставке
  SAIL.flat(0.42, 0.865, p);
  g.strokeStyle = '#f3f2ee'; g.lineWidth = 6; g.beginPath(); g.arc(X(p.x), Y(p.y), 0.15 * px, 0, Math.PI * 2); g.stroke();
  text('5', p.x, p.y - 0.005, 0.2, '#f3f2ee', 600);
  const t = new B.DynamicTexture(mirror ? 'sailBack' : 'sailFront', c, scene, true); t.update(true); t.anisotropicFilteringLevel = 8;
  return t;
}

// ---------- подводная часть: всё, что ниже воды у лодки, уходит в цвет толщи ----------
class SinkPlugin extends B.MaterialPluginBase {
  constructor(material, env) { super(material, 'Sink', 210, { SINK: false }); this.env = env; this._enable(true); }
  prepareDefines(defines) { defines.SINK = true; }
  getClassName() { return 'SinkPlugin'; }
  getUniforms() { return { ubo: [{ name: 'uSinkA', size: 4, type: 'vec4' }, { name: 'uSinkB', size: 4, type: 'vec4' }], fragment: '#ifdef SINK\nuniform vec4 uSinkA; uniform vec4 uSinkB;\n#endif' }; }
  bindForSubMesh(ubo) { const b = this.env.boat; ubo.updateFloat4('uSinkA', b.heave, b.sf, b.ss, 0); ubo.updateFloat4('uSinkB', this.env.pivotX, this.env.pivotZ, b.fx, b.fz); }
  getCustomCode(type) {
    return type !== 'fragment' ? null : { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef SINK
      vec2 rS = vPositionW.xz - uSinkB.xy; float bfS = dot(rS, uSinkB.zw), bsS = dot(rS, vec2(-uSinkB.w, uSinkB.z));
      float depthS = uSinkA.x + uSinkA.y * bfS + uSinkA.z * bsS - vPositionW.y;
      float kS = 1.0 - exp(-max(depthS, 0.0) * 2.4);
      finalColor.rgb = mix(finalColor.rgb, vec3(0.012, 0.085, 0.15), kS * 0.9);
#endif` };
  }
}

export function createBoat(world, env) {
  const scene = world.scene;
  // ---- узлы ----
  const root = new B.TransformNode('boat', scene);
  const heelG = new B.TransformNode('heel', scene); heelG.parent = root;       // крен и подъём на волне
  const hull = new B.TransformNode('trim', scene); hull.parent = heelG;         // дифферент; оси лодки
  const mastBase = new V3(HULL.mastX, deckAt(HULL.mastX), 0);
  const rig = new B.TransformNode('rig', scene); rig.parent = hull; rig.position.set(mastBase.x, mastBase.y, mastBase.z);

  // ---- материалы ----
  const pbr = (name, rgb, rough, metal = 0) => { const m = new B.PBRMaterial(name, scene); m.albedoColor = new B.Color3(rgb[0], rgb[1], rgb[2]); m.roughness = rough; m.metallic = metal; return m; };
  const matHull = pbr('hull', [1, 1, 1], 0.24); matHull.albedoTexture = hullTexture(scene);
  matHull.clearCoat.isEnabled = true; matHull.clearCoat.intensity = 0.7; matHull.clearCoat.roughness = 0.12;
  const matDeck = pbr('deck', [1, 1, 1], 0.72);
  const matGel = pbr('gel', [0.92, 0.93, 0.94], 0.3);
  const matFoil = pbr('foil', [0.9, 0.91, 0.92], 0.28); matFoil.clearCoat.isEnabled = true; matFoil.clearCoat.intensity = 0.5;
  const matAlu = pbr('alu', [0.72, 0.74, 0.77], 0.36, 1);
  const matAluDark = pbr('aluDark', [0.20, 0.21, 0.23], 0.42, 1);
  const matDark = pbr('dark', [0.016, 0.018, 0.022], 0.5);
  const matRubber = pbr('rubber', [0.03, 0.034, 0.04], 0.7);
  const matRope = pbr('rope', [0.82, 0.84, 0.87], 0.92);
  const matRopeRed = pbr('ropeRed', [0.7, 0.07, 0.07], 0.92);
  const matRopeBlue = pbr('ropeBlue', [0.05, 0.12, 0.55], 0.92);
  const matSleeve = pbr('sleeve', [0.88, 0.88, 0.85], 0.9);
  const matSkin = pbr('skin', [0.58, 0.31, 0.19], 0.62);
  const matCap = pbr('cap', [0.9, 0.9, 0.9], 0.8);
  const matGlass = pbr('glass', [0.005, 0.005, 0.006], 0.18, 0.6);
  const matBody = pbr('body', [1, 1, 1], 0.74);
  const matGreen = pbr('ttG', [0.03, 0.55, 0.14], 0.9), matRed = pbr('ttR', [0.85, 0.06, 0.06], 0.9);
  try { new SinkPlugin(matHull, env); new SinkPlugin(matFoil, env); } catch (e) { console.warn('подводный оттенок отключён:', e.message); }

  // ---- сборка ----
  const statics = [];                                       // неподвижные детали: потом склеиваются по материалам
  function mesh(name, data, mat, parent, { updatable = false, cast = true, receive = true, reflect = true } = {}) {
    const m = new B.Mesh(name, scene), vd = new B.VertexData();
    // Формы считаются с обходом против часовой стрелки, а движок в этой системе координат ждёт обратный:
    // порядок вершин в треугольниках переворачивается, нормали при этом остаются наружу.
    const idx = data.indices.slice();
    for (let i = 0; i < idx.length; i += 3) { const q = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = q; }
    vd.positions = data.positions; vd.indices = idx;
    if (data.uvs) vd.uvs = data.uvs; if (data.colors) vd.colors = data.colors;
    vd.normals = computeNormals(data.positions, data.indices, new Float32Array(data.positions.length));
    vd.applyToMesh(m, updatable);
    m.material = mat; m.parent = parent; m.isPickable = false; m.alwaysSelectAsActiveMesh = true;
    if (data.colors) m.useVertexColors = true;
    world.addBoatMesh(m, { cast, receive, reflect });
    return m;
  }
  // деталь из стандартной формы; pos и rot в осях родителя
  function part(m, mat, parent, pos, rot) {
    m.material = mat; m.parent = parent; m.isPickable = false;
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    statics.push(m); return m;
  }
  const box = (w, h, d) => B.CreateBox('b', { width: w, height: h, depth: d }, scene);
  const cyl = (r0, r1, h, seg = 14) => B.CreateCylinder('c', { diameterBottom: r0 * 2, diameterTop: r1 * 2, height: h, tessellation: seg }, scene);
  const sph = (r, seg = 12) => B.CreateSphere('s', { diameter: r * 2, segments: seg }, scene);
  const tor = (R, r) => B.CreateTorus('t', { diameter: R * 2, thickness: r * 2, tessellation: 18 }, scene);
  // динамическая трубка или канат
  function dyn(name, tube, mat, parent, opts = {}) {
    const m = mesh(name, tube, mat, parent, { updatable: true, ...opts }), nrm = new Float32Array(tube.positions.length);
    return { mesh: m, upload() { m.updateVerticesData(B.VertexBuffer.PositionKind, tube.positions, false, false); m.updateVerticesData(B.VertexBuffer.NormalKind, computeNormals(tube.positions, tube.indices, nrm), false, false); } };
  }

  // корпус и палуба
  mesh('hull', buildHull(), matHull, hull);
  mesh('deck', buildDeck(), matDeck, hull);
  { const pts = gunwalePath(), tube = makeTube(pts.length, 8, false); tube.set(pts, 0.016); mesh('gunwale', tube, matGel, hull); }

  // шверт с колодцем
  const trunkTop = deckAt(TRUNK_X) + 0.06, BOARD_DOWN = trunkTop + 0.02, BOARD_LIFT = 0.5, BOARD_AFT = TRUNK_X - 0.2;
  part(box(0.50, 0.05, 0.075), matDark, hull, [TRUNK_X, deckAt(TRUNK_X) + 0.035, 0]);
  const board = mesh('board', buildFoil(0.40, 0.30, 1.30, 0.03, 0.075), matFoil, hull); board.position.set(TRUNK_X + 0.2, BOARD_DOWN, 0);
  const boardTop = new B.TransformNode('boardTop', scene); boardTop.parent = hull;
  { const a = box(0.42, 0.04, 0.034); a.material = matFoil; a.parent = boardTop; a.position.y = 0.01; world.addBoatMesh(a);
    const b = tor(0.05, 0.011); b.material = matRubber; b.parent = boardTop; b.position.y = 0.06; b.rotation.x = Math.PI / 2; world.addBoatMesh(b); }
  const bungee = makeRope(2, 4, 5), bungeePts = [new V3(TRUNK_X, BOARD_DOWN + 0.02, 0), new V3(1.78, deckAt(1.78) + 0.03, 0)];
  const bungeeM = dyn('bungee', bungee, matDark, hull, { cast: false });

  // кокпит: ремень откренивания, блок шкота, самоотливной клапан
  part(box(1.0, 0.012, 0.055), matRubber, hull, [-0.52, FLOOR_Y + 0.07, 0]);
  for (const x of [-0.02, -1.02]) part(box(0.05, 0.07, 0.07), matDark, hull, [x, FLOOR_Y + 0.035, 0]);
  const blockTop = new V3(-0.12, FLOOR_Y + 0.17, 0);
  part(cyl(0.012, 0.012, 0.12, 8), matAlu, hull, [-0.12, FLOOR_Y + 0.06, 0]);
  part(cyl(0.038, 0.038, 0.03, 16), matDark, hull, [-0.12, FLOOR_Y + 0.14, 0], [Math.PI / 2, 0, 0]);
  part(box(0.11, 0.012, 0.07), matAluDark, hull, [-1.02, FLOOR_Y + 0.008, 0.18]);
  // палуба: поручни на баке, рым, утки и блоки у мачты, погон
  for (const s of [-1, 1]) {
    const z = s * 0.34, x0 = 0.62, x1 = 1.12, y0 = stationAtX(0.87).sheer + 0.05;
    part(cyl(0.011, 0.011, x1 - x0, 8), matDark, hull, [(x0 + x1) / 2, y0 + 0.03, z], [0, 0, Math.PI / 2]);
    for (const x of [x0 + 0.03, x1 - 0.03]) part(cyl(0.012, 0.012, 0.04, 8), matDark, hull, [x, y0 + 0.012, z]);
  }
  part(tor(0.022, 0.006), matAlu, hull, [2.0, deckAt(2.0) + 0.012, 0], [0, 0, Math.PI / 2]);
  part(box(0.16, 0.012, 0.10), matAluDark, hull, [HULL.mastX - 0.22, deckAt(HULL.mastX - 0.22) + 0.006, 0]);
  for (const s of [-1, 1]) { part(box(0.05, 0.022, 0.02), matDark, hull, [HULL.mastX - 0.25, deckAt(HULL.mastX - 0.25) + 0.02, s * 0.03]); part(cyl(0.014, 0.014, 0.014, 10), matDark, hull, [HULL.mastX - 0.12, deckAt(HULL.mastX - 0.12) + 0.014, s * 0.05]); }
  part(cyl(0.06, 0.07, 0.04, 20), matDark, hull, [HULL.mastX, mastBase.y + 0.02, 0]);
  const travX = -1.80, travY = deckAt(travX) + 0.012;
  for (const s of [-1, 1]) part(box(0.045, 0.024, 0.03), matDark, hull, [-1.94, deckAt(-1.94) - 0.004, s * 0.43]);
  part(box(0.06, 0.022, 0.03), matDark, hull, [-1.42, deckAt(-1.42) + 0.012, 0]);
  part(cyl(0.012, 0.012, 0.012, 8), matDark, hull, [HULL.xStern + 0.004, 0.2, 0.3], [0, 0, Math.PI / 2]);      // сливная пробка

  // ---- рангоут ----
  const mastAt = (h, out) => out.set(-RAKE * h / MAST_H, h, 0);
  const tilt = Math.atan2(RAKE, MAST_H);
  { const h = LUFF0 + 0.3, m = cyl(0.033, 0.032, h + 0.3, 18); part(m, matAlu, rig, [-RAKE * (h / 2 - 0.15) / MAST_H, h / 2 - 0.15, 0], [0, 0, tilt]); }
  // карман мачты: мачта выше гика спрятана в парус; гнётся вместе с ней
  const SLV_N = 22, sleeve = makeTube(SLV_N, 10), slvPts = []; for (let i = 0; i < SLV_N; i++) slvPts.push(new V3());
  const sleeveM = dyn('sleeve', sleeve, matSleeve, rig);
  const mastTop = new B.TransformNode('mastTop', scene); mastTop.parent = rig;
  { const cap = cyl(0.034, 0.02, 0.1, 12); cap.material = matDark; cap.parent = mastTop; world.addBoatMesh(cap); }
  // флюгарка
  const windex = new B.TransformNode('windex', scene); windex.parent = mastTop; windex.position.y = 0.06;
  { const add = (m, pos, rot) => { m.material = matRed; m.parent = windex; m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); world.addBoatMesh(m, { receive: false }); };
    const sh = cyl(0.004, 0.004, 0.3, 6); sh.material = matAlu; sh.parent = mastTop; sh.position.y = 0.2; world.addBoatMesh(sh, { receive: false });
    windex.position.y = 0.35;
    add(box(0.42, 0.012, 0.012), [0.1, 0, 0]); add(cyl(0.03, 0.0, 0.1, 8), [0.35, 0, 0], [0, 0, -Math.PI / 2]); add(box(0.1, 0.07, 0.005), [-0.1, 0, 0]); }
  // гик
  part(cyl(0.027, 0.027, BOOM_L, 16), matAlu, rig, [-BOOM_L / 2 + 0.03, BOOM_H, 0], [0, 0, Math.PI / 2]);
  part(box(0.07, 0.07, 0.06), matAluDark, rig, [-0.035, BOOM_H, 0]);
  part(sph(0.03), matDark, rig, [-BOOM_L + 0.03, BOOM_H, 0]);
  const boomBlockEnd = new V3(-BOOM_L + 0.12, BOOM_H - 0.075, 0), boomBlockMid = new V3(-1.24, BOOM_H - 0.075, 0);
  for (const b of [boomBlockEnd, boomBlockMid]) { part(cyl(0.03, 0.03, 0.024, 14), matDark, rig, [b.x, b.y, 0], [Math.PI / 2, 0, 0]); part(box(0.014, 0.05, 0.014), matAlu, rig, [b.x, BOOM_H - 0.04, 0]); }
  // оттяжка гика: от обуха у палубы к гику, с блоками
  { const a = new V3(-0.03, 0.10, 0), b = new V3(-0.72, BOOM_H - 0.03, 0), t = makeRope(2, 2, 5); t.set([a, b], null, 0.006); mesh('vang', t, matRope, rig, { cast: false });
    for (const k of [0.34, 0.62]) part(box(0.085, 0.05, 0.03), matAluDark, rig, [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0], [0, 0, Math.atan2(b.y - a.y, b.x - a.x)]); }
  // оттяжка шкотового угла вдоль гика и каннингхэм вдоль мачты
  { const t = makeRope(2, 2, 4); t.set([new V3(-0.1, BOOM_H + 0.034, 0), new V3(-CLEW, BOOM_H + 0.034, 0)], null, 0.004); mesh('outhaul', t, matRopeBlue, rig, { cast: false }); }
  { const t = makeRope(2, 2, 4); t.set([new V3(-0.045, LUFF0 + 0.2, 0.012), new V3(-0.05, 0.03, 0.03)], null, 0.004); mesh('cunn', t, matRopeRed, rig, { cast: false }); }

  // ---- парус ----
  const NU = 24, NV = 40, nSail = (NU + 1) * (NV + 1);
  const sailPos = new Float32Array(nSail * 3), sailNrm = new Float32Array(nSail * 3), sailUV = new Float32Array(nSail * 2), sailIdx = [];
  const sailFlat = new Float32Array(nSail * 3), sailShape = new Float32Array(NU + 1), fp = { x: 0, y: 0, chord: 0 };
  for (let i = 0; i <= NU; i++) {
    sailShape[i] = Math.sin(Math.PI * Math.pow(i / NU, 0.8));
    for (let j = 0; j <= NV; j++) {
      const k = i * (NV + 1) + j; SAIL.flat(i / NU, j / NV, fp);
      sailFlat[k * 3] = fp.x; sailFlat[k * 3 + 1] = fp.y; sailFlat[k * 3 + 2] = fp.chord;
      sailUV[k * 2] = (fp.x - SAIL.xmin) / SAIL.w; sailUV[k * 2 + 1] = (fp.y - SAIL.ymin) / SAIL.h;
      sailPos[k * 3] = fp.x; sailPos[k * 3 + 1] = fp.y;
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1; sailIdx.push(a, b, c, b, d, c); }
  const sailData = { positions: sailPos, indices: new Uint32Array(sailIdx), uvs: sailUV };
  const mkSailMat = (name, tex, front) => {
    const m = pbr(name, [1, 1, 1], 0.86); m.albedoTexture = tex; m.backFaceCulling = true; m.cullBackFaces = front; m.twoSidedLighting = true;
    // парус просвечивает: теневая сторона получает часть прошедшего сквозь ткань света
    m.subSurface.isTranslucencyEnabled = true; m.subSurface.translucencyIntensity = 0.55; m.subSurface.minimumThickness = 0.2; m.subSurface.maximumThickness = 0.2;
    m.subSurface.tintColor = new B.Color3(1, 0.98, 0.94);
    return m;
  };
  const sailA = mesh('sailA', sailData, mkSailMat('sailF', sailTexture(scene, true), true), rig, { updatable: true });
  const sailB = mesh('sailB', sailData, mkSailMat('sailB', sailTexture(scene, false), false), rig, { updatable: true, cast: false, reflect: false });
  // колдунчики: три пары на парусе
  const telltales = [];
  for (const [u, v] of [[0.26, 0.28], [0.28, 0.5], [0.3, 0.7]]) for (const sgn of [-1, 1]) {
    const r = makeRope(3, 3, 4);
    telltales.push({ u, v, sgn, r, pts: [new V3(), new V3(), new V3()], m: dyn('tt', r, sgn > 0 ? matGreen : matRed, rig, { cast: false, reflect: false }), phase: Math.random() * 6 });
  }

  // ---- шкот, погон ----
  const sheet = makeRope(6, 6, 6), sheetPts = [0, 1, 2, 3, 4, 5].map(() => new V3()), sheetSags = [0, 0, 0, 0, 0];
  const sheetM = dyn('sheet', sheet, matRope, hull, { cast: false });
  const trav = makeRope(4, 3, 5), travPts = [new V3(-1.94, deckAt(-1.94) + 0.012, -0.43), new V3(), new V3(-1.94, deckAt(-1.94) + 0.012, 0.43), new V3(-1.42, deckAt(-1.42) + 0.03, 0)];
  const travM = dyn('trav', trav, matRopeBlue, hull, { cast: false });
  const travBlock = cyl(0.026, 0.026, 0.022, 12); travBlock.material = matDark; travBlock.parent = hull; travBlock.rotation.x = Math.PI / 2; world.addBoatMesh(travBlock);
  const handSheet = makeRope(2, 6, 5), handPts = [new V3(), new V3()];
  const handM = dyn('handSheet', handSheet, matRope, hull, { cast: false });

  // ---- руль ----
  const transomY = deckAt(HULL.xStern);
  const rudderPivot = new B.TransformNode('rudder', scene); rudderPivot.parent = hull; rudderPivot.position.set(HULL.xStern - 0.035, transomY, 0);
  { const blade = mesh('blade', buildFoil(0.27, 0.19, 0.96, 0.16, 0.075), matFoil, rudderPivot); blade.position.set(0.035, -0.02, 0);
    part(box(0.13, 0.26, 0.05), matAluDark, rudderPivot, [-0.03, -0.02, 0]);
    part(cyl(0.016, 0.014, 1.06, 10), matAlu, rudderPivot, [0.46, 0.105, 0], [0, 0, Math.PI / 2 - 0.02]); }
  for (const y of [-0.03, 0.16]) part(box(0.05, 0.03, 0.09), matAlu, hull, [HULL.xStern - 0.012, transomY - 0.2 + y, 0]);
  const TILLER_END = new V3(0.99, 0.116, 0), EXT_LEN = 1.08;
  const ext = makeTube(4, 8), extPts = [new V3(), new V3(), new V3(), new V3()];
  const extM = dyn('ext', ext, matDark, hull);

  // ---- матрос ----
  const sailorG = new B.TransformNode('sailor', scene); sailorG.parent = hull;
  const sailor = createSailor({ deckAt, cockpitHalfWidth, cockpitSDF, COCKPIT, FLOOR_Y });
  const bodyM = mesh('body', sailor, matBody, sailorG, { updatable: true }), bodyNrm = new Float32Array(sailor.positions.length);
  const headG = new B.TransformNode('head', scene); headG.parent = sailorG;
  { const add = (m, mat, pos, scale, rot) => { m.material = mat; m.parent = headG; m.position.set(pos[0], pos[1], pos[2]); if (scale) m.scaling.set(scale[0], scale[1], scale[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.isPickable = false; world.addBoatMesh(m); return m; };
    add(sph(0.102, 18), matSkin, [0, 0, 0], [1, 1.1, 0.94]);
    add(sph(0.02, 8), matSkin, [0.1, -0.012, 0]);
    for (const s of [-1, 1]) add(sph(0.022, 8), matSkin, [0, 0, s * 0.097]);
    add(B.CreateSphere('cap', { diameter: 0.216, segments: 18, slice: 0.5 }, scene), matCap, [0, 0.028, 0], [1, 0.92, 0.96]);
    add(B.CreateCylinder('visor', { diameter: 0.21, height: 0.01, tessellation: 20, arc: 0.5 }, scene), matCap, [0.055, 0.034, 0], [1, 1, 0.9], [0, Math.PI / 2, 0]);
    add(box(0.03, 0.036, 0.172), matGlass, [0.086, 0.012, 0]); }

  // неподвижные детали склеиваются по материалу и родителю: меньше вызовов отрисовки
  { const groups = new Map();
    for (const m of statics) { const key = m.parent.name + '|' + m.material.name; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(m); }
    for (const list of groups.values()) {
      const parent = list[0].parent, mat = list[0].material;
      for (const m of list) m.computeWorldMatrix(true);
      const merged = list.length > 1 ? B.Mesh.MergeMeshes(list, true, true) : list[0];
      merged.material = mat; merged.setParent(parent); merged.isPickable = false; merged.alwaysSelectAsActiveMesh = true;
      world.addBoatMesh(merged);
    } }

  // ---------- обновление ----------
  const sea = { heave: 0, sf: 0, ss: 0 };
  const sheetState = { slack: 0, ease: 0 };
  let flutter = 0, mastBend = 0, boardUp = 0, sailorOn = true, firstPerson = false;
  const bendAt = (v) => mastBend * v * v;
  const tmp = new V3(), tmp2 = new V3(), pivotHull = new V3(), ctx = { boomRot: 0, mastBase, BOOM_H, BOOM_L, boardUp: 0, boardAft: BOARD_AFT, pivotHull, blockTop, boomBlockMid, extLen: EXT_LEN, ease: 0, slack: 0 };
  const api = { holdPose: false, pose: sailor.pose, root, heelG, hull, rig, sea, MAST_H, BOOM_H };

  function updateSail(out, dt, state) {
    const side = state.sailSide, aoa = out.aoa;
    // полное заполаскивание (шкот перетравлен) — полощет весь парус, сильнее у задней шкаторины;
    // малый угол атаки — пузырь у передней шкаторины
    const full = out.luffing ? 1 : 0, partial = out.luffing ? 0 : Math.max(0, 1 - aoa / 7);
    flutter += dt * (6 + out.AWS * 1.2);
    const power = Math.min(1, out.q / 60), wind = Math.min(1, out.AWS / 3);
    const camber = 0.03 + 0.09 * Math.min(1, aoa / 14) * (0.4 + 0.6 * power);
    // настройки: оттяжка шкотового угла убирает пузо внизу, каннингхэм уплощает верх и уводит пузо вперёд, оттяжка гика гнёт мачту
    const tr = out.trim || state.trim, boomMag = Math.min(90, Math.abs(state.boom));
    const sheetPull = state.taut * clamp(1 - (boomMag - 8) / 25, 0, 1) * Math.min(1, out.Fmag / 150);
    mastBend += ((0.04 + 0.16 * Math.max(tr.vang, sheetPull) + 0.06 * tr.cunn) - mastBend) * Math.min(1, dt * 2);
    const lowK = (0.55 + 0.9 * (1 - tr.out)) * (1 - 0.8 * mastBend), topK = (1 - 0.35 * tr.cunn) * (1 - 1.4 * mastBend);
    const twist = (out.twist || 0) * DEG * 1.1, draft = 0.8 - 0.14 * tr.cunn;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, shape = Math.sin(Math.PI * Math.pow(u, draft));
      for (let j = 0; j <= NV; j++) {
        const v = j / NV, k = (i * (NV + 1) + j) * 3;
        const x = sailFlat[k], y = sailFlat[k + 1], chord = sailFlat[k + 2];
        let z = -side * camber * chord * shape * (1 - 0.35 * v) * (lowK + (topK - lowK) * v);
        // твист: верх паруса развёрнут под ветер сильнее, чем гик
        const tw = twist * Math.pow(v, 1.2), xr = u * chord;
        z += -side * Math.sin(tw) * xr * 0.85 * (0.35 + 0.65 * power);
        let dx = xr * (1 - Math.cos(tw)) * 0.85;
        if (full > 0) {
          const amp = (0.25 + 0.75 * u) * (0.45 + 0.55 * (1 - v * 0.5));
          const fl = 0.11 * Math.sin(flutter * 1.3 + u * 7 + v * 3) + 0.045 * Math.sin(flutter * 2.9 - u * 13 + v * 5.5);
          z = z * 0.2 + fl * amp * wind;
        } else if (partial > 0) {
          z += side * partial * 0.07 * Math.sin(flutter * 1.7 + v * 4) * Math.exp(-u * 5) * (1 - 0.3 * v) * wind;
        }
        // изгиб мачты уносит назад переднюю шкаторину; считается в метрах от мачты, поэтому топ идёт вместе с мачтой
        const wB = Math.max(0, 1 - xr / 2.7);
        sailPos[k] = x + dx - bendAt(v) * wB * wB; sailPos[k + 1] = y; sailPos[k + 2] = z;
      }
    }
    computeNormals(sailPos, sailData.indices, sailNrm);
    for (const m of [sailA, sailB]) { m.updateVerticesData(B.VertexBuffer.PositionKind, sailPos, false, false); m.updateVerticesData(B.VertexBuffer.NormalKind, sailNrm, false, false); }
    // карман мачты идёт по передней шкаторине
    for (let i = 0; i < SLV_N; i++) { const f = i / (SLV_N - 1), h = LUFF0 - 0.05 + (HEAD + 0.05 - LUFF0 + 0.05) * f, v = clamp((h - LUFF0) / (HEAD - LUFF0), 0, 1); slvPts[i].set(-RAKE * h / MAST_H - bendAt(v), h, 0); }
    sleeve.set(slvPts, (i) => 0.047 - 0.017 * i / (SLV_N - 1)); sleeveM.upload();
    mastTop.position.set(-RAKE - mastBend, MAST_H, 0);
    // колдунчики: наветренный дёргается вверх при малом угле атаки, подветренный обвисает при срыве
    for (const t of telltales) {
      const i = Math.round(t.u * NU), j = Math.round(t.v * NV), k = (i * (NV + 1) + j) * 3;
      const base = t.pts[0].set(sailPos[k], sailPos[k + 1], sailPos[k + 2] + t.sgn * 0.02);
      const windward = t.sgn === Math.sign(side || 1);
      const stream = windward ? (aoa >= 8 && !out.luffing ? 1 : 0) : (aoa <= 26 && !out.luffing ? 1 : 0);
      const wig = Math.sin(flutter * 2.2 + t.phase), len = 0.26;
      const lift = windward ? (1 - stream) * (0.6 + 0.4 * wig) : 0, droop = !windward ? (1 - stream) * (0.5 + 0.3 * wig) : 0;
      t.pts[1].set(base.x - len * 0.5, base.y + len * 0.5 * (lift - droop) + 0.02 * wig * stream, base.z + t.sgn * 0.02 * stream * wig);
      t.pts[2].set(base.x - len * (0.3 + 0.7 * stream), base.y + len * (lift * 0.9 - droop * 0.9) + 0.03 * wig * stream, base.z + t.sgn * 0.04 * stream * Math.sin(flutter * 2.2 + t.phase + 1));
      t.r.set(t.pts, null, 0.004); t.m.upload();
    }
  }

  function update(state, out, ctl, dt, t, env) {
    root.position.set(state.x, 0, state.z);
    root.rotation.y = Math.PI / 2 - state.heading * DEG;
    // Лодка идёт по волнам: высота и уклоны воды берутся из той же формулы, что рисует море
    const fx = out.fx, fz = out.fz, sx = out.sx, sz = out.sz, x = state.x, z = state.z, ML = 3.2;
    const hB = env.heightAt(x + fx * 1.7, z + fz * 1.7, ML), hS = env.heightAt(x - fx * 1.7, z - fz * 1.7, ML);
    const hR = env.heightAt(x + sx * 0.5, z + sz * 0.5, ML), hL = env.heightAt(x - sx * 0.5, z - sz * 0.5, ML), hC = env.heightAt(x, z, ML);
    const kk = Math.min(1, dt * 7);
    sea.heave += ((hB + hS + hR + hL + 2 * hC) / 6 - sea.heave) * kk;
    sea.sf += ((hB - hS) / 3.4 - sea.sf) * kk; sea.ss += ((hR - hL) / 1.0 - sea.ss) * kk;
    env.setBoatPlane(fx, fz, sea.heave, sea.sf, sea.ss, 1);
    env.setBoatWash(out.capsized ? 0 : clamp((Math.abs(state.vf) - 0.4) / 3.2, 0, 1));
    heelG.rotation.x = -state.heel * DEG - Math.atan(sea.ss) * 0.55;
    hull.rotation.z = Math.atan(sea.sf) - Math.min(2.5, state.vf * 0.9) * DEG;         // на ходу лёгкий дифферент на корму
    heelG.position.y = sea.heave;

    rig.rotation.y = state.boom * DEG;       // гик на правом борту при положительном угле
    windex.rotation.y = -out.AWA * DEG - rig.rotation.y;
    updateSail(out, dt, state);

    // гика-шкот: погон → блок на ноке гика → погон → вдоль гика к среднему блоку → блок в кокпите
    const rot = rig.rotation.y;
    const load = state.taut * clamp(out.Fmag / 90, 0, 1);
    sheetState.slack += ((1 - load) - sheetState.slack) * Math.min(1, dt * 3);
    sheetState.ease += (out.sheet / 90 - sheetState.ease) * Math.min(1, dt * 3);
    const sl = sheetState.slack;
    // каретка погона уходит под ветер вслед за гиком
    const tz = clamp(Math.sin(rot) * 0.9, -0.32, 0.32) * (0.4 + 0.6 * load);
    travPts[1].set(travX, travY + 0.035 + 0.03 * load, tz);
    trav.set(travPts, null, 0.004); travM.upload();
    travBlock.position.set(travX, travY + 0.06 + 0.03 * load, tz);
    sheetPts[0].set(travX, travY + 0.07 + 0.03 * load, tz + 0.015);
    sheetPts[1].copy(boomBlockEnd).rotY(rot).add(mastBase);
    sheetPts[2].set(travX, travY + 0.07 + 0.03 * load, tz - 0.015);
    sheetPts[3].copy(boomBlockEnd); sheetPts[3].x += 0.09; sheetPts[3].rotY(rot).add(mastBase);
    sheetPts[4].copy(boomBlockMid).rotY(rot).add(mastBase);
    sheetPts[5].copy(blockTop);
    sheetSags[0] = sheetSags[1] = 0.01 + 0.14 * sl; sheetSags[2] = 0.02 + 0.16 * sl; sheetSags[3] = 0.02 + 0.22 * sl; sheetSags[4] = 0;
    sheet.set(sheetPts, sheetSags, 0.0075); sheetM.upload();

    rudderPivot.rotation.y = state.rudder * DEG;
    boardUp = (1 - state.board) * BOARD_LIFT;
    board.position.y = BOARD_DOWN + boardUp; boardTop.position.set(TRUNK_X, BOARD_DOWN + boardUp, 0);
    bungeePts[0].y = BOARD_DOWN + 0.02 + boardUp; bungee.set(bungeePts, null, 0.005); bungeeM.upload();

    // матрос
    const show = sailorOn && !out.capsized;
    bodyM.setEnabled(show); headG.setEnabled(show && !firstPerson); handM.mesh.setEnabled(show); extM.mesh.setEnabled(true);
    pivotHull.copy(TILLER_END).rotY(state.rudder * DEG); pivotHull.x += HULL.xStern - 0.035; pivotHull.y += transomY;
    let tip = tmp.set(pivotHull.x + EXT_LEN * 0.6, pivotHull.y + 0.02, pivotHull.z);
    if (show) {
      ctx.boomRot = rot; ctx.boardUp = boardUp; ctx.ease = sheetState.ease; ctx.slack = sheetState.slack;
      const r = sailor.update(state, api.holdPose ? 0 : dt, out, ctx);
      bodyM.updateVerticesData(B.VertexBuffer.PositionKind, sailor.positions, false, false);
      bodyM.updateVerticesData(B.VertexBuffer.ColorKind, sailor.colors, false, false);
      bodyM.updateVerticesData(B.VertexBuffer.NormalKind, computeNormals(sailor.positions, sailor.indices, bodyNrm), false, false);
      headG.position.set(r.head.x, r.head.y, r.head.z); headG.rotation.set(0, r.headYaw, r.headTilt);
      tip = r.extTip;
      handPts[0].copy(blockTop); handPts[1].copy(r.sheetEnd); handSheet.set(handPts, [r.sheetSag], 0.008); handM.upload();
    }
    // удлинитель румпеля: от конца румпеля к руке, ближе к руке утолщение рукоятки
    extPts[0].copy(pivotHull); extPts[3].copy(tip); extPts[1].copy(pivotHull).lerp(tip, 0.78); extPts[2].copy(pivotHull).lerp(tip, 0.8);
    ext.set(extPts, (i) => (i < 2 ? 0.008 : 0.013)); extM.upload();
  }

  const headLocal = new B.Vector3();
  api.update = update;
  api.setSailor = (v) => { sailorOn = v; };
  api.setHead = (v) => { firstPerson = !v; sailor.setFirstPerson(!v); };
  // положение глаз матроса в осях лодки и перевод из осей лодки в мир
  api.eyeLocal = (v) => v.copyFrom(headG.position);
  api.toWorld = (v, out) => B.Vector3.TransformCoordinatesToRef(v, hull.computeWorldMatrix(true), out);
  api.deckY = () => mastBase.y;
  return api;
}
