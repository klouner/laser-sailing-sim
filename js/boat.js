import * as THREE from 'three';

const DEG = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);

// ---------- геометрия корпуса (лофт по шпангоутам) ----------
// x — вдоль корпуса (нос +): полуширина по планширю, высота планширя, высота киля, «плоскость» днища
const STATIONS = [
  //   x,     hw,   sheer,  keel,   flat
  [-2.10, 0.555, 0.270,  0.060, 0.70],
  [-1.80, 0.625, 0.278, -0.045, 0.62],
  [-1.40, 0.672, 0.288, -0.120, 0.56],
  [-0.90, 0.695, 0.300, -0.150, 0.55],
  [-0.30, 0.695, 0.315, -0.160, 0.57],
  [ 0.30, 0.676, 0.335, -0.152, 0.63],
  [ 0.90, 0.618, 0.365, -0.122, 0.82],
  [ 1.40, 0.505, 0.405, -0.062, 1.20],
  [ 1.80, 0.335, 0.448,  0.030, 1.65],
  [ 2.05, 0.150, 0.485,  0.175, 2.10],
  [ 2.13, 0.000, 0.505,  0.420, 2.40],
];
export const HULL = { xStern: -2.10, xBow: 2.13, mastX: 1.12 };

function makeCurve(col) {
  const pts = STATIONS.map(s => new THREE.Vector3(s[0], s[col], 0));
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}
const curves = { hw: makeCurve(1), sheer: makeCurve(2), keel: makeCurve(3), flat: makeCurve(4) };
function stationAt(u) {
  const a = curves.hw.getPoint(u), b = curves.sheer.getPoint(u), c = curves.keel.getPoint(u), d = curves.flat.getPoint(u);
  return { x: a.x, hw: Math.max(0, a.y), sheer: b.y, keel: c.y, flat: Math.max(0.3, d.y) };
}
export function deckHeightAt(x) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (stationAt(m).x < x) lo = m; else hi = m; }
  return stationAt((lo + hi) / 2);
}
function sectionPoint(st, t) {
  const th = t * Math.PI / 2;
  const z = st.hw * Math.sin(th);
  const c = Math.pow(Math.max(0, Math.cos(th)), st.flat);
  const y = st.sheer - (st.sheer - st.keel) * c;
  return new THREE.Vector3(st.x, y, z);
}

function buildHullGeometry() {
  const NX = 84, NT = 36;
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NT; j++) {
      const p = sectionPoint(st, -1 + 2 * j / NT);
      pos.push(p.x, p.y, p.z); uv.push(i / NX, j / NT);
    }
  }
  const row = NT + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const st0 = stationAt(0);
  const center = pos.length / 3;
  pos.push(st0.x, (st0.sheer + st0.keel) / 2, 0); uv.push(0, 0.5);
  for (let j = 0; j < NT; j++) idx.push(center, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Кокпит
const COCKPIT = { xFront: 0.50, xBack: -1.05, wFront: 0.98, wBack: 0.80, depth: 0.20, r: 0.22 };
function cockpitHalfWidth(x) {
  const t = (COCKPIT.xFront - x) / (COCKPIT.xFront - COCKPIT.xBack);
  return (COCKPIT.wFront + (COCKPIT.wBack - COCKPIT.wFront) * t) / 2;
}
function cockpitSDF(x, z) {
  // отрицательно внутри; скруглённые углы
  if (x > COCKPIT.xFront + 0.3 || x < COCKPIT.xBack - 0.3) return 1;
  const hw = cockpitHalfWidth(THREE.MathUtils.clamp(x, COCKPIT.xBack, COCKPIT.xFront));
  const cx = (COCKPIT.xFront + COCKPIT.xBack) / 2, hx = (COCKPIT.xFront - COCKPIT.xBack) / 2;
  const dx = Math.abs(x - cx) - (hx - COCKPIT.r), dz = Math.abs(z) - (hw - COCKPIT.r);
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0) - COCKPIT.r;
}

function buildDeckGeometry() {
  const NX = 170, NZ = 56;
  const pos = [], idx = [], uv = [], col = [];
  const cDeck = new THREE.Color('#eef1f4'), cPit = new THREE.Color('#cfd6dd'), cSide = new THREE.Color('#e4e9ee');
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NZ; j++) {
      const t = -1 + 2 * j / NZ;
      const z = st.hw * t * 0.998;
      // палуба: небольшая погибь, в носу выше (горб у степса)
      const crown = 0.03 + 0.03 * THREE.MathUtils.smoothstep(st.x, 0.5, 1.6);
      let y = st.sheer + crown * (1 - t * t);
      let c = cDeck;
      const d = cockpitSDF(st.x, z);
      if (d < 0) {
        // стенки кокпита с плавным сопряжением и плоский пол
        const wall = THREE.MathUtils.smoothstep(-d, 0, 0.06);
        y = st.sheer + 0.01 - COCKPIT.depth * wall;
        c = wall > 0.9 ? cPit : cSide;
      } else if (Math.abs(z) > st.hw * 0.72 && st.x < 1.2 && st.x > -1.9) {
        c = cSide; // противоскользящие боковые палубы
      }
      pos.push(st.x, y, z); uv.push(st.x * 1.5, z * 1.5); col.push(c.r, c.g, c.b);
    }
  }
  const row = NZ + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sheerCurve() {
  const pts = [];
  const N = 70;
  for (let i = 0; i <= N; i++) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.012, st.hw)); }
  for (let i = N - 1; i >= 1; i--) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.012, -st.hw)); }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// ---------- текстуры ----------
function makeNonSkidTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 215 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Парус: u — от мачты (0) к задней шкаторине (1), v — от гика (0) к фаловому углу (1)
function makeSailTexture() {
  const S = 2048;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const U = (u) => u * S, V = (v) => (1 - v) * S;
  g.fillStyle = '#f4f3ee'; g.fillRect(0, 0, S, S);
  // лёгкая неравномерность ткани
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(0,0,0,${0.008 + Math.random() * 0.012})`;
    g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 200 + Math.random() * 400, 60 + Math.random() * 120, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  // швы полотнищ: перпендикулярно задней шкаторине (слегка наклонены вверх к мачте)
  g.strokeStyle = 'rgba(90,90,90,0.28)'; g.lineWidth = 3;
  for (let v = 0.1; v < 1; v += 0.1) { g.beginPath(); g.moveTo(U(1), V(v)); g.lineTo(U(0), V(v + 0.085)); g.stroke(); }
  // латы: 4 штуки
  g.strokeStyle = 'rgba(60,60,60,0.55)'; g.lineWidth = 9;
  for (const v of [0.24, 0.44, 0.63, 0.82]) { g.beginPath(); g.moveTo(U(1), V(v)); g.lineTo(U(0.6), V(v + 0.03)); g.stroke(); }
  // усиления: галсовый, шкотовый, фаловый углы — синие
  g.fillStyle = '#2b4ea3';
  g.beginPath(); g.moveTo(U(0), V(0)); g.lineTo(U(0.2), V(0)); g.lineTo(U(0), V(0.17)); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(U(1), V(0)); g.lineTo(U(0.82), V(0)); g.lineTo(U(1), V(0.14)); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(U(0), V(1)); g.lineTo(U(1), V(1)); g.lineTo(U(0), V(0.92)); g.closePath(); g.fill();
  // окно
  g.fillStyle = 'rgba(170,200,225,0.75)'; g.strokeStyle = 'rgba(70,90,110,0.5)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(U(0.5), V(0.05)); g.lineTo(U(0.78), V(0.05)); g.lineTo(U(0.78), V(0.145)); g.lineTo(U(0.5), V(0.16)); g.closePath(); g.fill(); g.stroke();
  // номер
  g.save(); g.translate(U(0.42), V(0.5)); g.rotate(-0.06);
  g.fillStyle = '#1f2a44'; g.font = 'bold 230px Inter, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('211777', 0, 0); g.restore();
  // эмблема
  g.save(); g.translate(U(0.3), V(0.72)); g.strokeStyle = '#c0282e'; g.lineWidth = 6; g.lineCap = 'round';
  for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, r0 = 14 + (i % 2) * 20, r1 = 60 + (i % 3) * 20; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// ---------- вспомогательные ----------
function limb(mat, r) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 1, 10), mat); cyl.position.y = 0.5; cyl.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat); cap.castShadow = true;
  g.add(cyl); g.add(cap);
  g.userData.set = (a, b) => { const d = b.clone().sub(a); const L = d.length(); g.position.copy(a); g.quaternion.setFromUnitVectors(Y, d.normalize()); cyl.scale.y = L; cyl.position.y = L / 2; };
  return g;
}
function rope(parent, mat, r = 0.0075) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.castShadow = true; parent.add(mesh);
  return (points) => {
    const path = new THREE.CurvePath();
    for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
    const g = new THREE.TubeGeometry(path, (points.length - 1) * 4, r, 6, false);
    mesh.geometry.dispose(); mesh.geometry = g;
  };
}
function foilShape(chordTop, chordTip, depth, sweep, tipRound = 0.5) {
  // планформа пера в плоскости XY: вершина у оси поворота (0,0), перо вниз (−y), задняя кромка −x
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-chordTop, 0);
  s.lineTo(-chordTop - sweep, -depth + chordTip * tipRound);
  s.quadraticCurveTo(-chordTop - sweep + chordTip * 0.1, -depth, -sweep - chordTip * 0.5, -depth);
  s.quadraticCurveTo(-sweep + chordTip * 0.05, -depth, -sweep, -depth + chordTip * tipRound);
  s.lineTo(0, 0);
  return s;
}
function foilMesh(shape, thickness, mat) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.35, bevelSize: 0.012, bevelSegments: 3, steps: 1 });
  g.translate(0, 0, -thickness / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}

// ---------- сборка лодки ----------
export function createBoat() {
  const root = new THREE.Group();
  const heelG = new THREE.Group();
  root.add(heelG);

  const matHull = new THREE.MeshPhysicalMaterial({ color: '#f7f8fa', roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const matDeck = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeNonSkidTexture(), roughness: 0.85 });
  const matAlu = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.9, roughness: 0.3 });
  const matAluDark = new THREE.MeshStandardMaterial({ color: '#5b6068', metalness: 0.85, roughness: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.55 });
  const matFoil = new THREE.MeshPhysicalMaterial({ color: '#eef0f2', roughness: 0.3, clearcoat: 0.5 });
  const matRope = new THREE.MeshStandardMaterial({ color: '#e5e9ef', roughness: 0.9 });
  const matRopeRed = new THREE.MeshStandardMaterial({ color: '#d94848', roughness: 0.9 });
  const matRopeBlue = new THREE.MeshStandardMaterial({ color: '#3b5fc0', roughness: 0.9 });
  const matRubber = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.7 });

  const hull = new THREE.Mesh(buildHullGeometry(), matHull);
  hull.castShadow = true; hull.receiveShadow = true; heelG.add(hull);
  const deck = new THREE.Mesh(buildDeckGeometry(), matDeck);
  deck.castShadow = true; deck.receiveShadow = true; heelG.add(deck);
  const rail = new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(), 300, 0.02, 10, true), matRubber);
  rail.castShadow = true; heelG.add(rail);

  const deckAt = (x) => deckHeightAt(x).sheer;
  const floorY = deckAt(-0.2) - COCKPIT.depth + 0.01;

  // ----- шверт и колодец -----
  const trunkX = 0.80, trunkTop = deckAt(trunkX) + 0.06;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.05, 0.075), matDark);
  trunk.position.set(trunkX, deckAt(trunkX) + 0.035, 0); heelG.add(trunk);
  const board = foilMesh(foilShape(0.40, 0.26, 1.15, 0.03, 0.45), 0.022, matFoil);
  board.position.set(trunkX + 0.2, trunkTop + 0.28, 0); heelG.add(board);
  const boardTop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.03), matFoil);
  boardTop.position.set(trunkX, trunkTop + 0.29, 0); heelG.add(boardTop);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), matRubber);
  handle.position.set(trunkX, trunkTop + 0.34, 0); heelG.add(handle);
  // амортизатор шверта (резинка к носу)
  const bungee = rope(heelG, matDark, 0.005);
  bungee([new THREE.Vector3(trunkX, trunkTop + 0.3, 0), new THREE.Vector3(1.75, deckAt(1.75) + 0.04, 0)]);

  // ----- кокпит -----
  const strapMat = new THREE.MeshStandardMaterial({ color: '#2f3640', roughness: 0.95 });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.012, 0.09), strapMat);
  strap.position.set(-0.28, floorY + 0.075, 0); heelG.add(strap);
  for (const x of [0.25, -0.82]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.1), matAlu); eye.position.set(x, floorY + 0.01, 0); heelG.add(eye); }
  // блок гика-шкота со стопором
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 18), matDark);
  block.position.set(0.0, floorY + 0.06, 0); heelG.add(block);
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.05), matAluDark);
  cleat.position.set(0.0, floorY + 0.12, 0); heelG.add(cleat);
  const blockTop = new THREE.Vector3(0.0, floorY + 0.15, 0);
  // утки и ручки шкотов на палубе у кокпита
  for (const s of [-1, 1]) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), matAluDark);
    cl.position.set(0.72, deckAt(0.72) + 0.045, s * 0.26); heelG.add(cl);
  }
  // нос: скоба и буксирный конец
  const bowEye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16), matAlu);
  bowEye.position.set(2.02, deckAt(2.02) + 0.04, 0); bowEye.rotation.y = Math.PI / 2; heelG.add(bowEye);
  // погон гика-шкота на корме
  const sternY = deckAt(-1.98);
  for (const s of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.04), matAluDark);
    fl.position.set(-1.98, sternY + 0.05, s * 0.47); heelG.add(fl);
  }
  const traveler = rope(heelG, matRope, 0.006);
  const travP = new THREE.Vector3(-1.98, sternY + 0.045, 0);
  traveler([new THREE.Vector3(-1.98, sternY + 0.06, -0.47), travP, new THREE.Vector3(-1.98, sternY + 0.06, 0.47)]);
  const travBlock = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), matDark);
  travBlock.position.copy(travP).add(new THREE.Vector3(0, 0.03, 0)); heelG.add(travBlock);

  // ----- рангоут (вращается в степсе) -----
  const rig = new THREE.Group();
  const mastBase = new THREE.Vector3(HULL.mastX, deckAt(HULL.mastX), 0);
  rig.position.copy(mastBase); heelG.add(rig);
  const MAST_H = 5.10, RAKE = 0.14, BOOM_H = 0.58, BOOM_L = 2.74, CLEW = 2.60;
  const mastTilt = Math.atan2(RAKE, MAST_H);
  const mastAt = (h) => new THREE.Vector3(-RAKE * h / MAST_H, h, 0);
  // нижнее колено (открытое, алюминий)
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, BOOM_H + 0.35, 20), matAlu);
  lower.position.copy(mastAt((BOOM_H + 0.3) / 2 - 0.3)); lower.rotation.z = mastTilt; lower.castShadow = true; rig.add(lower);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.05, 20), matDark); collar.position.y = 0.025; rig.add(collar);
  // карман передней шкаторины: верх мачты скрыт в парусе
  const sleeveLen = MAST_H - BOOM_H - 0.08;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.046, sleeveLen, 18), new THREE.MeshStandardMaterial({ color: '#f1f0ea', roughness: 0.9 }));
  sleeve.position.copy(mastAt(BOOM_H + 0.05 + sleeveLen / 2)); sleeve.rotation.z = mastTilt; sleeve.castShadow = true; rig.add(sleeve);
  const mastTopCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 12), matDark);
  mastTopCap.position.copy(mastAt(MAST_H)); mastTopCap.rotation.z = mastTilt; rig.add(mastTopCap);

  // гик
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, BOOM_L, 16), matAlu);
  boom.rotation.z = Math.PI / 2; boom.position.set(-BOOM_L / 2 + 0.03, BOOM_H, 0); boom.castShadow = true; rig.add(boom);
  const gooseneck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.06), matDark);
  gooseneck.position.set(-0.01, BOOM_H, 0); rig.add(gooseneck);
  const boomEndFit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), matDark);
  boomEndFit.rotation.z = Math.PI / 2; boomEndFit.position.set(-BOOM_L + 0.03, BOOM_H, 0); rig.add(boomEndFit);
  // блоки на гике
  const boomBlockEnd = new THREE.Vector3(-BOOM_L + 0.10, BOOM_H - 0.05, 0);
  const boomBlockMid = new THREE.Vector3(-1.25, BOOM_H - 0.05, 0);
  for (const p of [boomBlockEnd, boomBlockMid]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), matDark); b.position.copy(p); rig.add(b); }
  // оттяжка гика (ванг) с талями
  const vangA = new THREE.Vector3(-0.02, 0.16, 0), vangB = new THREE.Vector3(-0.68, BOOM_H - 0.03, 0);
  const vangRope = rope(rig, matDark, 0.012); vangRope([vangA, vangB]);
  const vangBlock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.04), matAluDark);
  vangBlock.position.copy(vangA).lerp(vangB, 0.5); vangBlock.quaternion.setFromUnitVectors(Y, vangB.clone().sub(vangA).normalize()); rig.add(vangBlock);
  // шкот-оттяжка (каннингем) и оттяжка шкотового угла
  const cunn = rope(rig, matRopeRed, 0.005); cunn([new THREE.Vector3(-0.03, 0.15, 0.02), new THREE.Vector3(-0.055, BOOM_H + 0.28, 0.02)]);
  const outhaul = rope(rig, matRopeBlue, 0.005); outhaul([new THREE.Vector3(-0.1, BOOM_H + 0.03, 0), new THREE.Vector3(-CLEW, BOOM_H + 0.03, 0)]);

  // парус
  const NU = 22, NV = 32;
  const sailGeo = new THREE.BufferGeometry();
  const sailPos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const sailUV = new Float32Array((NU + 1) * (NV + 1) * 2);
  const sailIdx = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { const k = i * (NV + 1) + j; sailUV[k * 2] = i / NU; sailUV[k * 2 + 1] = j / NV; }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1; sailIdx.push(a, b, c, b, d, c); }
  sailGeo.setAttribute('position', new THREE.BufferAttribute(sailPos, 3));
  sailGeo.setAttribute('uv', new THREE.BufferAttribute(sailUV, 2));
  sailGeo.setIndex(sailIdx);
  const sailTex = makeSailTexture();
  const sailTexBack = sailTex.clone(); sailTexBack.wrapS = THREE.RepeatWrapping; sailTexBack.repeat.x = -1; sailTexBack.offset.x = 1;
  const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.FrontSide, roughness: 0.92 }));
  const sailBack = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ map: sailTexBack, side: THREE.BackSide, roughness: 0.92 }));
  sail.castShadow = true; sail.receiveShadow = true; rig.add(sail); rig.add(sailBack);
  // ликтрос задней шкаторины
  const leechRope = rope(rig, new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.9 }), 0.006);

  const tack = new THREE.Vector3(0.0, BOOM_H + 0.03, 0);
  const head = mastAt(MAST_H - 0.05);
  const clew = new THREE.Vector3(-CLEW, BOOM_H + 0.03, 0);
  const leechDir = head.clone().sub(clew).normalize();
  const roachOut = new THREE.Vector3(-leechDir.y, leechDir.x, 0).normalize(); if (roachOut.x > 0) roachOut.negate();

  // флюгарка
  const windex = new THREE.Group(); windex.position.copy(mastAt(MAST_H + 0.04));
  const wShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.28, 6), matAlu); wShaft.position.y = 0.14; windex.add(wShaft);
  const wArrow = new THREE.Group(); wArrow.position.y = 0.28;
  const redM = new THREE.MeshStandardMaterial({ color: '#ef4444' });
  const wBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.012), redM); wBody.position.x = 0.1; wArrow.add(wBody);
  const wTip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 8), redM); wTip.rotation.z = -Math.PI / 2; wTip.position.x = 0.35; wArrow.add(wTip);
  const wFin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.005), redM); wFin.position.x = -0.1; wArrow.add(wFin);
  windex.add(wArrow); rig.add(windex);

  // гика-шкот (обновляется каждый кадр)
  const sheetRope = rope(heelG, matRope, 0.008);

  // ----- руль -----
  const rudderPivot = new THREE.Group();
  const transomY = deckAt(HULL.xStern);
  rudderPivot.position.set(HULL.xStern - 0.03, transomY, 0); heelG.add(rudderPivot);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.30, 0.08), matDark);
  stock.position.set(-0.06, -0.04, 0); rudderPivot.add(stock);
  const blade = foilMesh(foilShape(0.30, 0.17, 0.98, 0.26, 0.5), 0.022, matFoil);
  blade.position.set(-0.02, 0.0, 0); rudderPivot.add(blade);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.95, 10), matAluDark);
  tiller.rotation.z = Math.PI / 2; tiller.position.set(0.44, 0.12, 0); rudderPivot.add(tiller);
  const extPivot = new THREE.Group(); extPivot.position.set(0.9, 0.125, 0); rudderPivot.add(extPivot);
  const extension = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.1, 8), matAlu);
  extension.rotation.z = -Math.PI / 2; extension.position.x = 0.55; extPivot.add(extension);
  const extGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8), matRubber);
  extGrip.rotation.z = -Math.PI / 2; extGrip.position.x = 0.98; extPivot.add(extGrip);
  for (const y of [-0.02, 0.17]) { const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.09), matAlu); pin.position.set(HULL.xStern - 0.01, transomY + y, 0); heelG.add(pin); }

  // ----- матрос -----
  const skin = new THREE.MeshStandardMaterial({ color: '#c99474', roughness: 0.75 });
  const suit = new THREE.MeshStandardMaterial({ color: '#1c2430', roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: '#f26b21', roughness: 0.7 });
  const sailor = new THREE.Group(); heelG.add(sailor);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.26, 8, 16), vest); torso.scale.set(1.25, 1, 0.85); torso.castShadow = true; sailor.add(torso);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), suit); hips.scale.set(1.1, 0.8, 1); hips.castShadow = true; sailor.add(hips);
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin); headM.castShadow = true; sailor.add(headM);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.8 })); sailor.add(cap);
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 16, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#f8fafc' })); sailor.add(visor);
  const thighL = limb(suit, 0.075), thighR = limb(suit, 0.075), shinL = limb(suit, 0.06), shinR = limb(suit, 0.06);
  const upArmA = limb(suit, 0.05), foreArmA = limb(skin, 0.042), upArmB = limb(suit, 0.05), foreArmB = limb(skin, 0.042);
  const handA = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin), handB = handA.clone();
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.09), suit), footR = footL.clone();
  [thighL, thighR, shinL, shinR, upArmA, foreArmA, upArmB, foreArmB, handA, handB, footL, footR].forEach(o => sailor.add(o));
  const handSheet = rope(heelG, matRope, 0.008);

  // ---------- обновление ----------
  let flutterPhase = 0;
  const P = {
    hip: new THREE.Vector3(), shoulder: new THREE.Vector3(), headP: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(),
    elbowA: new THREE.Vector3(), handA: new THREE.Vector3(), elbowB: new THREE.Vector3(), handB: new THREE.Vector3(), tmp: new THREE.Vector3(),
  };
  const sailorState = { hike: 0, side: 1 };

  function updateSail(out, dt) {
    const side = out.side, aoa = out.aoa;
    const luff = out.luffing ? 1 : Math.max(0, 1 - aoa / 6);
    flutterPhase += dt * (6 + out.AWS * 1.2);
    const power = Math.min(1, out.q / 60);
    const camberFrac = 0.025 + 0.085 * Math.min(1, aoa / 14) * (0.4 + 0.6 * power);
    const twist = 10 * DEG * (0.3 + 0.7 * Math.min(1, out.AWS / 6));
    const pa = sailPos;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const lx = tack.x + (head.x - tack.x) * v, ly = tack.y + (head.y - tack.y) * v;
        const roach = 0.24 * Math.sin(Math.PI * Math.pow(v, 0.9)) * (1 - 0.2 * v);
        const ex = clew.x + (head.x - clew.x) * v + roachOut.x * roach;
        const ey = clew.y + (head.y - clew.y) * v + roachOut.y * roach;
        const x = lx + (ex - lx) * u, y = ly + (ey - ly) * u;
        const chord = Math.hypot(ex - lx, ey - ly);
        const shape = Math.sin(Math.PI * Math.pow(u, 0.82));
        let z = -side * camberFrac * chord * shape * (1 - 0.35 * v);
        z += -side * Math.sin(twist * v) * chord * u * 0.35 * power;
        if (luff > 0) {
          const fl = luff * 0.11 * Math.sin(flutterPhase * 1.3 + u * 7 + v * 3) * Math.pow(u, 0.7) * (0.3 + 0.7 * (1 - v * 0.5));
          z = z * (1 - 0.8 * luff) + fl * Math.min(1, out.AWS / 3);
        }
        // у мачты парус огибает карман
        z += -side * 0.03 * Math.exp(-u * 12);
        const k = (i * (NV + 1) + j) * 3;
        pa[k] = x; pa[k + 1] = y; pa[k + 2] = z;
      }
    }
    sailGeo.attributes.position.needsUpdate = true;
    sailGeo.computeVertexNormals();
    const leech = [];
    for (let j = 0; j <= NV; j += 4) { const k = (NU * (NV + 1) + j) * 3; leech.push(new THREE.Vector3(pa[k], pa[k + 1], pa[k + 2])); }
    leechRope(leech);
  }

  function updateSailor(state, dt) {
    const side = state.side;
    sailorState.hike += (Math.min(1, Math.abs(state.heel) / 16) - sailorState.hike) * Math.min(1, dt * 3);
    const h = sailorState.hike;
    const dy = deckAt(-0.35);
    P.hip.set(-0.35, dy + 0.05, side * (0.42 + 0.22 * h));
    const theta = 0.38 + 0.85 * h; // наклон корпуса наружу (сидя на борту)
    const dir = P.tmp.set(-0.08, Math.cos(theta), side * Math.sin(theta)).normalize();
    P.shoulder.copy(P.hip).addScaledVector(dir, 0.46);
    P.headP.copy(P.shoulder).addScaledVector(dir, 0.2).add(new THREE.Vector3(0.04, 0.0, -side * 0.03));
    // туловище
    torso.position.copy(P.hip).lerp(P.shoulder, 0.58); torso.quaternion.setFromUnitVectors(Y, dir); torso.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
    hips.position.copy(P.hip);
    headM.position.copy(P.headP); cap.position.copy(P.headP).add(new THREE.Vector3(0, 0.02, 0)); visor.position.copy(P.headP).add(new THREE.Vector3(0.1, 0.045, 0));
    // ноги: колени у кромки кокпита, стопы под ремнём
    for (const [thigh, shin, foot, off] of [[thighL, shinL, footL, 0.11], [thighR, shinR, footR, -0.11]]) {
      P.knee.set(-0.33 + off * 0.5, dy + 0.14 - 0.04 * h, side * (0.16 - 0.04 * h) + off * 0.35);
      P.foot.set(-0.3 + off * 0.9, floorY + 0.05, -side * 0.02 + off * 0.45);
      thigh.userData.set(P.hip.clone().add(new THREE.Vector3(0, -0.03, off * 0.8)), P.knee);
      shin.userData.set(P.knee, P.foot);
      foot.position.copy(P.foot); foot.rotation.set(0, side > 0 ? -0.3 : 0.3, 0);
    }
    // руки: задняя — румпель-удлинитель, передняя — шкот
    const shA = P.shoulder.clone().add(new THREE.Vector3(-0.13, 0, side * 0.02));
    const shB = P.shoulder.clone().add(new THREE.Vector3(0.13, 0, side * 0.02));
    P.handA.set(-0.9, dy + 0.25 + 0.12 * h, side * (0.3 + 0.2 * h));
    P.handB.set(0.05, dy + 0.36 - 0.05 * h, side * (0.2 + 0.15 * h));
    P.elbowA.copy(shA).lerp(P.handA, 0.5).add(new THREE.Vector3(0, -0.08, side * 0.12));
    P.elbowB.copy(shB).lerp(P.handB, 0.5).add(new THREE.Vector3(0.05, -0.1, side * 0.1));
    upArmA.userData.set(shA, P.elbowA); foreArmA.userData.set(P.elbowA, P.handA); handA.position.copy(P.handA);
    upArmB.userData.set(shB, P.elbowB); foreArmB.userData.set(P.elbowB, P.handB); handB.position.copy(P.handB);
    // удлинитель румпеля — в заднюю руку
    const local = rudderPivot.worldToLocal(heelG.localToWorld(P.handA.clone()));
    const d = local.sub(extPivot.position);
    extPivot.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    // шкот от блока в переднюю руку
    handSheet([blockTop, P.handB.clone().add(new THREE.Vector3(0, -0.02, 0))]);
  }

  function update(state, out, ctl, dt, t) {
    out.side = state.side;
    root.position.set(state.x, 0, state.z);
    root.rotation.y = Math.PI / 2 - state.heading * DEG;
    const bob = Math.sin(t * 1.3) * 0.015 + Math.sin(t * 2.1 + 1) * 0.01;
    heelG.rotation.x = -state.heel * DEG;
    heelG.rotation.z = (Math.sin(t * 0.9) * 0.8 - Math.min(2.5, state.vf * 0.9)) * DEG;
    heelG.position.y = bob;

    rig.rotation.y = -state.boom * DEG;
    windex.rotation.y = -out.AWA * DEG - rig.rotation.y;
    updateSail(out, dt);

    // гика-шкот: нок гика → погон → середина гика → блок в кокпите
    const bEnd = boomBlockEnd.clone().applyAxisAngle(Y, rig.rotation.y).add(mastBase);
    const bMid = boomBlockMid.clone().applyAxisAngle(Y, rig.rotation.y).add(mastBase);
    sheetRope([bEnd, travP.clone().add(new THREE.Vector3(0, 0.03, 0)), bMid, blockTop]);

    rudderPivot.rotation.y = ctl.rudder * DEG;
    if (sailor.visible) updateSailor(state, dt);
  }

  return { root, heelG, rig, update, setSailor: (v) => { sailor.visible = v; handSheet([blockTop, blockTop.clone().add(new THREE.Vector3(0, 0.001, 0))]); }, MAST_H, BOOM_H };
}
