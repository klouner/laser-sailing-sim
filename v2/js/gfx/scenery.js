// Акватория вокруг дистанции: берег с холмами, посёлок с причалом и яхтами, маяк на островке, чайки.
// Всё строится из формул при загрузке, файлов моделей нет. Берег стоит на месте: лодка ходит в бухте перед ним.
import * as B from 'babylon';
import { SKY_GLSL, SKY_UNIFORMS } from './shaders.js';

const DEG = Math.PI / 180;
const VERT = /* glsl */`
precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec4 color;
uniform mat4 world; uniform mat4 viewProjection;
varying vec3 vW; varying vec3 vN; varying vec4 vC;
void main() { vec4 w = world * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(world) * normal); vC = color; gl_Position = viewProjection * w; }
`;
// Цвет вершины — цвет поверхности; альфа меньше единицы помечает то, что светится само: окна (0.5) и лампу маяка (0).
const FRAG = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN; varying vec4 vC;
uniform vec3 uCam; uniform vec2 uGlow;          // x — проблеск маяка 0..1, y — сумерки 0..1
${SKY_GLSL}
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, uSunDir), 0.0), up = n.y * 0.5 + 0.5;
  vec3 col = vC.rgb * (uSunCol * 0.42 * d + uHorizon * (0.2 + 0.3 * up) + uZenith * 0.2 * up);
  float e = 1.0 - vC.a;
  col += e > 0.75 ? vec3(1.0, 0.86, 0.55) * (0.6 + 14.0 * uGlow.x) : vC.rgb * e * (0.4 + 7.0 * uGlow.y);
  vec3 toP = vW - uCam; float dist = length(toP);
  // та же дымка, что на воде: вдали всё уходит в цвет неба над горизонтом
  float fog = 1.0 - exp(-pow(dist / 2700.0, 1.5));
  col = mix(col, skyColor(normalize(vec3(toP.x, 0.012 * dist, toP.z)), 0.0, 0.0), fog * (e > 0.75 ? 0.5 : 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

// плавный шум: одна и две координаты
const hash = (x, y = 0) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const sm = (t) => t * t * (3 - 2 * t);
function noise1(x) { const i = Math.floor(x), f = sm(x - i); return hash(i) * (1 - f) + hash(i + 1) * f; }
function noise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
  return (hash(i, j) * (1 - fx) + hash(i + 1, j) * fx) * (1 - fy) + (hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx) * fy;
}
const fbm2 = (x, y) => noise2(x, y) * 0.55 + noise2(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + noise2(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
const step01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Берег: дуга от запада через север к юго-востоку. th — пеленг в градусах, r — расстояние от центра дистанции.
const TH0 = -100, TH1 = 128, DEPTH = 2100;
const shoreR = (th) => 720 + 260 * noise1(th * 0.045 + 3.1) + 120 * noise1(th * 0.13 + 8.0) - 150 * Math.exp(-Math.pow((th - 62) / 9, 2));   // у посёлка мыс
function landH(th, r) {
  const t = (r - shoreR(th)) / DEPTH; if (t <= 0) return -2.5;
  const edge = step01(TH0, TH0 + 14, th) * step01(TH1, TH1 - 14, th);           // к краям дуги берег сходит в воду
  const ridge = 0.35 + 0.65 * noise1(th * 0.035 + 1.7), bumps = fbm2(th * 0.09, t * 6);
  const plain = 5.5 * step01(0, 0.035, t), hills = (50 + 190 * ridge) * step01(0.05, 0.75, t) * (0.45 + 0.75 * bumps);
  return (plain + hills) * edge - 2.5 * (1 - edge);
}
const polar = (th, r) => [r * Math.sin(th * DEG), -r * Math.cos(th * DEG)];

export function createScenery(world) {
  const scene = world.scene;
  B.Effect.ShadersStore.scenery2VertexShader = VERT; B.Effect.ShadersStore.scenery2FragmentShader = FRAG;
  const mat = new B.ShaderMaterial('scenery', scene, { vertex: 'scenery2', fragment: 'scenery2' }, { attributes: ['position', 'normal', 'color'], uniforms: ['world', 'viewProjection', 'uCam', 'uGlow', ...SKY_UNIFORMS], samplers: ['uNoise'] });
  mat.backFaceCulling = false; mat.setTexture('uNoise', world.noiseTex);
  world.skyMats.push(mat);

  // ---- рельеф ----
  { const NA = 230, NR = 28, pos = [], col = [], idx = [], row = NR + 1;
    const SAND = [0.50, 0.44, 0.32], GRASS = [0.17, 0.25, 0.09], WOOD = [0.055, 0.115, 0.05], ROCK = [0.27, 0.25, 0.23], FIELD = [0.33, 0.31, 0.13];
    for (let i = 0; i <= NA; i++) {
      const th = TH0 + (TH1 - TH0) * i / NA, r0 = shoreR(th);
      for (let k = 0; k <= NR; k++) {
        const t = Math.pow(k / NR, 1.5), r = r0 - 12 + t * DEPTH, h = k === 0 ? -3 : landH(th, r), [x, z] = polar(th, r);
        pos.push(x, h, z);
        const wood = step01(0.42, 0.6, fbm2(th * 0.3 + 4, t * 14 + 2)), field = step01(0.62, 0.7, noise2(th * 0.2 + 9, t * 9));
        let c = GRASS.map((g, q) => g + (WOOD[q] - g) * wood); c = c.map((g, q) => g + (FIELD[q] - g) * field * (1 - wood));
        const rock = step01(170, 250, h), sand = 1 - step01(1.2, 4.5, h);
        c = c.map((g, q) => (g + (ROCK[q] - g) * rock) * (1 - sand) + SAND[q] * sand);
        col.push(c[0], c[1], c[2], 1);
      }
    }
    for (let i = 0; i < NA; i++) for (let k = 0; k < NR; k++) { const a = i * row + k, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c); }
    const m = new B.Mesh('land', scene), vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.colors = col; vd.normals = [];
    B.VertexData.ComputeNormals(pos, idx, vd.normals);
    for (let i = 1; i < vd.normals.length; i += 3) if (vd.normals[i] < 0) { vd.normals[i - 1] *= -1; vd.normals[i] *= -1; vd.normals[i + 1] *= -1; }
    vd.applyToMesh(m); m.material = mat; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }

  // ---- постройки, причал, яхты, маяк: примитивы, покрашенные по вершинам и склеенные в одну сетку ----
  const parts = [];
  const paint = (m, rgb, a = 1) => { const n = m.getTotalVertices(), c = new Float32Array(n * 4); for (let i = 0; i < n; i++) { c[i * 4] = rgb[0]; c[i * 4 + 1] = rgb[1]; c[i * 4 + 2] = rgb[2]; c[i * 4 + 3] = a; } m.setVerticesData(B.VertexBuffer.ColorKind, c); parts.push(m); return m; };
  const box = (w, h, d, x, y, z, rot, rgb, a) => { const m = B.CreateBox('b', { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); m.rotation.y = rot; return paint(m, rgb, a); };
  const cyl = (d0, d1, h, x, y, z, rgb, a, seg = 14) => { const m = B.CreateCylinder('c', { diameterBottom: d0, diameterTop: d1, height: h, tessellation: seg }, scene); m.position.set(x, y, z); return paint(m, rgb, a); };
  const WHITE = [0.72, 0.71, 0.67], RED = [0.5, 0.06, 0.04], ROOF = [0.36, 0.11, 0.06], DARK = [0.05, 0.055, 0.06], WOODC = [0.25, 0.19, 0.13], GLASS = [0.9, 0.75, 0.4];
  // посёлок на мысу
  { let seed = 1; const rnd = () => hash(seed++, 7.3);
    for (let i = 0; i < 34; i++) {
      const th = 50 + rnd() * 26, r = shoreR(th) + 35 + rnd() * 260, [x, z] = polar(th, r), y = landH(th, r);
      const w = 8 + rnd() * 9, d = 7 + rnd() * 5, h = 4.5 + rnd() * 5, rot = rnd() * Math.PI, wall = rnd() < 0.3 ? [0.6, 0.5, 0.36] : WHITE;
      box(w, h, d, x, y + h / 2 - 0.5, z, rot, wall);
      box(w * 0.5, h * 0.22, d * 1.01, x, y + h * 0.5, z, rot, GLASS, 0.5);                     // полоса окон
      const roof = B.CreateCylinder('r', { diameter: d * 1.25, height: w * 1.06, tessellation: 3 }, scene);
      roof.rotation.set(0, rot, Math.PI / 2); roof.position.set(x, y + h - 0.5 + d * 0.16, z); roof.scaling.x = 0.55; paint(roof, rnd() < 0.5 ? ROOF : [0.2, 0.2, 0.22]);
    }
    // церковь с колокольней: ориентир на берегу
    const [cx, cz] = polar(66, shoreR(66) + 150), cy = landH(66, shoreR(66) + 150);
    box(11, 9, 20, cx, cy + 4, cz, 0.4, WHITE); cyl(5, 5, 20, cx + 8, cy + 9.5, cz - 6, WHITE); cyl(5.6, 0.2, 9, cx + 8, cy + 24, cz - 6, [0.16, 0.24, 0.2], 1, 8);
    // причал и яхты у него
    const thP = 60, rP = shoreR(thP), [px, pz] = polar(thP, rP - 55), ang = Math.PI / 2 - (thP + 180) * DEG;
    box(130, 0.5, 5, px, 1.5, pz, ang, WOODC);
    for (let i = 0; i < 9; i++) { const [qx, qz] = polar(thP, rP - 115 + i * 14); cyl(0.5, 0.5, 4, qx + 2.4 * Math.cos(thP * DEG), 0.2, qz + 2.4 * Math.sin(thP * DEG), DARK, 1, 6); }
    for (let i = 0; i < 9; i++) {
      const s = i % 2 ? 1 : -1, [qx, qz] = polar(thP, rP - 110 + Math.floor(i / 2) * 20 + rnd() * 5);
      const ox = s * (8 + rnd() * 2) * Math.cos(thP * DEG), oz = s * (8 + rnd() * 2) * Math.sin(thP * DEG), L = 8 + rnd() * 5;
      box(L, 1.5, 2.8, qx + ox, 0.5, qz + oz, ang + 0.05 * s, rnd() < 0.3 ? [0.04, 0.07, 0.2] : WHITE); box(L * 0.4, 0.9, 2.0, qx + ox, 1.6, qz + oz, ang, WHITE);
      cyl(0.16, 0.1, L * 1.25, qx + ox, 1.2 + L * 0.62, qz + oz, [0.6, 0.6, 0.6], 1, 6);
    } }
  // маяк на островке к северо-западу
  const LH = polar(-26, 520);
  { const [x, z] = LH;
    const rock = B.CreateSphere('rock', { diameter: 70, segments: 10 }, scene); rock.scaling.set(1, 0.11, 0.7); rock.position.set(x, -0.6, z); rock.rotation.y = 0.6; paint(rock, [0.2, 0.19, 0.18]);
    const rock2 = B.CreateSphere('rock2', { diameter: 34, segments: 8 }, scene); rock2.scaling.set(1, 0.16, 0.8); rock2.position.set(x + 30, -0.8, z + 10); paint(rock2, [0.17, 0.16, 0.15]);
    cyl(7.4, 6.6, 6, x, 5.5, z, RED); cyl(6.6, 5.9, 6, x, 11.5, z, WHITE); cyl(5.9, 5.2, 6, x, 17.5, z, RED); cyl(5.2, 4.6, 6, x, 23.5, z, WHITE);
    cyl(6.6, 6.6, 0.5, x, 26.7, z, DARK); cyl(3.4, 3.4, 3.4, x, 28.6, z, GLASS, 0, 10); cyl(4.2, 0.3, 2.6, x, 31.6, z, RED, 1, 10);
    box(9, 4.5, 6.5, x - 9, 4.2, z + 3, 0.3, WHITE); box(9.6, 0.5, 7, x - 9, 6.7, z + 3, 0.3, ROOF); }
  for (const m of parts) m.computeWorldMatrix(true);
  const props = B.Mesh.MergeMeshes(parts, true, true); props.material = mat; props.isPickable = false; props.alwaysSelectAsActiveMesh = true;

  // ---- чайки: кружат у маяка, у причала и неподалёку от лодки ----
  const gullMat = new B.StandardMaterial('gull', scene); gullMat.disableLighting = true; gullMat.emissiveColor = new B.Color3(0.82, 0.84, 0.86); gullMat.backFaceCulling = false;
  const wing = (s) => { const m = new B.Mesh('wing', scene), vd = new B.VertexData(); vd.positions = [0, 0, 0, 0.16, 0, s * 0.02, -0.02, 0.03, s * 0.42, -0.12, 0, s * 0.62, -0.14, 0, s * 0.02]; vd.indices = [0, 1, 2, 0, 2, 4, 2, 3, 4]; vd.applyToMesh(m); m.material = gullMat; m.isPickable = false; m.setEnabled(false); return m; };
  const wingL = wing(-1), wingR = wing(1), gulls = [];
  const homes = [{ x: LH[0], z: LH[1], y: 30, r: 45 }, { x: polar(60, shoreR(60) - 60)[0], z: polar(60, shoreR(60) - 60)[1], y: 16, r: 40 }, { boat: true, y: 13, r: 22 }, { boat: true, y: 20, r: 38 }];
  for (let i = 0; i < 9; i++) {
    const n = new B.TransformNode('gull', scene), a = wingL.clone('gl'), b = wingR.clone('gr'); a.parent = b.parent = n; a.setEnabled(true); b.setEnabled(true); n.scaling.setAll(1.7);
    gulls.push({ n, a, b, home: homes[i % homes.length], ph: hash(i, 3) * 6.28, sp: 0.16 + 0.1 * hash(i, 5), rk: 0.7 + 0.6 * hash(i, 9), fl: 3 + 2 * hash(i, 11), cx: 0, cz: 0 });
  }

  const glow = new B.Vector2();
  // t — время, с; bx, bz — лодка
  function update(t, dt, bx, bz) {
    mat.setVector3('uCam', world.camera.position);
    const sky = world.state.sky, night = sky ? Math.min(1, Math.max(0, (14 - sky.elev) / 8)) + (sky.cloud > 0.8 ? 0.35 : 0) : 0;
    const ph = (t % 5) / 5, flash = Math.pow(Math.max(0, 1 - Math.abs(ph - 0.5) * 9), 2);      // проблеск раз в пять секунд
    glow.set(flash * (0.25 + 0.75 * night), night); mat.setVector2('uGlow', glow);
    for (const g of gulls) {
      const h = g.home, k = Math.min(1, dt * 0.5);
      g.cx += ((h.boat ? bx : h.x) - g.cx) * (h.boat ? k : 1); g.cz += ((h.boat ? bz : h.z) - g.cz) * (h.boat ? k : 1);
      const a = g.ph + t * g.sp, r = h.r * g.rk * (1 + 0.25 * Math.sin(t * 0.13 + g.ph));
      g.n.position.set(g.cx + Math.cos(a) * r, h.y + 3 * Math.sin(t * 0.21 + g.ph * 2), g.cz + Math.sin(a) * r);
      g.n.rotation.y = -a - Math.PI / 2; g.n.rotation.x = 0.35;                                 // летит по касательной, чуть накренившись в круг
      // машет несколько раз и планирует
      const cyc = (t * 0.22 + g.ph) % 1, flap = cyc < 0.45 ? Math.sin(t * g.fl * 2.2 + g.ph) * 0.55 : 0.12;
      g.a.rotation.x = flap; g.b.rotation.x = -flap;
    }
  }
  return { update, lighthouse: { x: LH[0], z: LH[1] } };
}
