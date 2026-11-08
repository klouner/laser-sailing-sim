import * as THREE from 'three';

const DEG = Math.PI / 180;

// ---------- геометрия корпуса (лофт по шпангоутам) ----------
// x — вдоль корпуса (нос +), значения: полуширина по планширю, высота планширя, высота киля, «плоскость» днища
const STATIONS = [
  //   x,    hw,  sheer,  keel,  flat
  [-2.10, 0.56, 0.300,  0.070, 0.65],
  [-1.80, 0.63, 0.308, -0.040, 0.60],
  [-1.40, 0.675, 0.318, -0.120, 0.55],
  [-0.90, 0.695, 0.330, -0.150, 0.55],
  [-0.30, 0.695, 0.345, -0.160, 0.58],
  [ 0.30, 0.675, 0.365, -0.150, 0.65],
  [ 0.90, 0.615, 0.395, -0.120, 0.85],
  [ 1.40, 0.500, 0.435, -0.060, 1.20],
  [ 1.80, 0.330, 0.478,  0.030, 1.60],
  [ 2.05, 0.150, 0.515,  0.170, 2.00],
  [ 2.13, 0.000, 0.535,  0.420, 2.40],
];
export const HULL = { xStern: -2.10, xBow: 2.13, mastX: 1.12, deckAtMast: 0.405 };

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
  // бинарный поиск u по x
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (stationAt(m).x < x) lo = m; else hi = m; }
  return stationAt((lo + hi) / 2);
}
function sectionPoint(st, t) {
  // t ∈ [-1, 1]: -1 левый планширь, 0 киль, 1 правый планширь
  const th = t * Math.PI / 2;
  const z = st.hw * Math.sin(th);
  const c = Math.pow(Math.max(0, Math.cos(th)), st.flat);
  const y = st.sheer - (st.sheer - st.keel) * c;
  return new THREE.Vector3(st.x, y, z);
}

function buildHullGeometry() {
  const NX = 56, NT = 26;
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
  // транец
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
const COCKPIT = { xFront: 0.52, xBack: -1.02, wFront: 0.98, wBack: 0.76, depth: 0.21 };
function cockpitHalfWidth(x) {
  const t = (COCKPIT.xFront - x) / (COCKPIT.xFront - COCKPIT.xBack);
  return (COCKPIT.wFront + (COCKPIT.wBack - COCKPIT.wFront) * t) / 2;
}
function inCockpit(x, z) {
  if (x > COCKPIT.xFront || x < COCKPIT.xBack) return false;
  const hw = cockpitHalfWidth(x);
  // скруглённая корма кокпита
  if (x < COCKPIT.xBack + 0.25) {
    const r = 0.25, cx = COCKPIT.xBack + r;
    const dz = Math.max(0, Math.abs(z) - (hw - r));
    const dx = cx - x;
    return dz * dz + dx * dx <= r * r || (Math.abs(z) <= hw - r);
  }
  return Math.abs(z) <= hw;
}

function buildDeckGeometry() {
  const NX = 140, NZ = 44;
  const pos = [], idx = [], uv = [], col = [];
  const cDeck = new THREE.Color('#e9e3d2'), cPit = new THREE.Color('#9fb0bf'), cWall = new THREE.Color('#d8dde3');
  for (let i = 0; i <= NX; i++) {
    const st = stationAt(i / NX);
    for (let j = 0; j <= NZ; j++) {
      const t = -1 + 2 * j / NZ;
      const z = st.hw * t * 0.995;
      let y = st.sheer + 0.035 * (1 - t * t);
      let c = cDeck;
      if (inCockpit(st.x, z)) { y = st.sheer - COCKPIT.depth; c = cPit; }
      pos.push(st.x, y, z); uv.push(i / NX, j / NZ); col.push(c.r, c.g, c.b);
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
  const N = 60;
  for (let i = 0; i <= N; i++) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.01, st.hw)); }
  for (let i = N - 1; i >= 1; i--) { const st = stationAt(i / N); pts.push(new THREE.Vector3(st.x, st.sheer + 0.01, -st.hw)); }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// ---------- текстура паруса ----------
function makeSailTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f5ee'; g.fillRect(0, 0, 1024, 1024);
  // полотнища
  g.strokeStyle = 'rgba(120,120,110,0.25)'; g.lineWidth = 2;
  for (let k = 1; k < 9; k++) { const y = 1024 - k * 1024 / 9; g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  // латы (4 у задней шкаторины)
  g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 6;
  [0.22, 0.42, 0.62, 0.82].forEach(v => { const y = 1024 * (1 - v); g.beginPath(); g.moveTo(1024 * 0.55, y); g.lineTo(1024, y); g.stroke(); });
  // номер и страна
  g.save();
  g.fillStyle = '#c2272d';
  g.font = 'bold 150px Inter, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('211 777', 560, 540);
  g.fillStyle = '#1f3a5f';
  g.font = 'bold 110px Inter, Arial, sans-serif';
  g.fillText('RUS', 560, 400);
  g.restore();
  // стилизованная эмблема
  g.save(); g.translate(300, 700);
  g.fillStyle = '#c2272d';
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 46 : 86; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- матрос ----------
function makeSailor() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#d9a883', roughness: 0.8 });
  const suit = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.7 });
  const vest = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.38, 6, 12), vest);
  torso.position.y = 0.45; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  head.position.y = 0.86; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f8fafc' }));
  cap.position.y = 0.88; g.add(cap);
  const legs = new THREE.Group();
  for (const s of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 6, 10), suit);
    thigh.rotation.x = Math.PI / 2; thigh.position.set(0, 0.12, s * 0.11); thigh.position.x = -0.28;
    legs.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 6, 10), suit);
    shin.rotation.x = Math.PI / 2 + 0.9; shin.position.set(-0.62, -0.05, s * 0.11);
    legs.add(shin);
  }
  legs.rotation.y = -Math.PI / 2; // ноги к центру лодки (вдоль -z локально → поворачиваем)
  g.add(legs);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.5, 6, 10), suit);
    arm.position.set(s * 0.05, 0.42, 0.2); arm.rotation.x = -1.1; arm.rotation.z = s * 0.3;
    g.add(arm);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.legs = legs;
  return g;
}

// ---------- сборка лодки ----------
export function createBoat() {
  const root = new THREE.Group();           // позиция и курс
  const heelG = new THREE.Group();          // крен/дифферент
  root.add(heelG);

  const matHull = new THREE.MeshPhysicalMaterial({ color: '#f5f7fa', roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const matDeck = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const matAlu = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.85, roughness: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: '#2b3340', roughness: 0.6 });
  const matWood = new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.6 });
  const matFoil = new THREE.MeshStandardMaterial({ color: '#f0f2f4', roughness: 0.3 });
  const matRope = new THREE.LineBasicMaterial({ color: '#dfe6ee' });
  const matRopeRed = new THREE.LineBasicMaterial({ color: '#e05252' });

  const hull = new THREE.Mesh(buildHullGeometry(), matHull);
  hull.castShadow = true; hull.receiveShadow = true;
  heelG.add(hull);
  const deck = new THREE.Mesh(buildDeckGeometry(), matDeck);
  deck.castShadow = true; deck.receiveShadow = true;
  heelG.add(deck);

  // полоса на борту (ватерлиния)
  // планширь
  const rail = new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(), 240, 0.022, 10, true), new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.5 }));
  rail.castShadow = true; heelG.add(rail);

  // колодец шверта и шверт
  const trunkX = 0.78;
  const deckTrunk = deckHeightAt(trunkX).sheer;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.07), matDark);
  trunk.position.set(trunkX, deckTrunk + 0.03, 0); heelG.add(trunk);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.40, 1.45, 0.025), matFoil);
  board.position.set(trunkX, deckTrunk + 0.35 - 0.725, 0); board.castShadow = true; heelG.add(board);
  const boardHandle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16), matDark);
  boardHandle.position.set(trunkX, deckTrunk + 0.40, 0); heelG.add(boardHandle);

  // кокпит: ремни откренивания, блок гика-шкота
  const strapMat = new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.9 });
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, 0.06), strapMat);
    const y = deckHeightAt(-0.25).sheer - COCKPIT.depth + 0.07;
    strap.position.set(-0.25, y, s * 0.18); strap.rotation.x = s * 0.25; heelG.add(strap);
  }
  const floorY = deckHeightAt(-0.1).sheer - COCKPIT.depth;
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 16), matDark);
  block.position.set(-0.05, floorY + 0.06, 0); heelG.add(block);
  const blockPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8), matAlu);
  blockPost.position.set(-0.05, floorY + 0.12, 0); heelG.add(blockPost);

  // носовая скоба
  const bowEye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16), matAlu);
  bowEye.position.set(2.0, deckHeightAt(2.0).sheer + 0.04, 0); bowEye.rotation.y = Math.PI / 2; heelG.add(bowEye);

  // погон гика-шкота на корме: две утки + верёвка
  const sternSheer = deckHeightAt(-2.0).sheer;
  for (const s of [-1, 1]) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), matDark);
    cleat.position.set(-2.0, sternSheer + 0.045, s * 0.45); heelG.add(cleat);
  }
  const travPts = [new THREE.Vector3(-2.0, sternSheer + 0.06, -0.45), new THREE.Vector3(-2.0, sternSheer + 0.05, 0), new THREE.Vector3(-2.0, sternSheer + 0.06, 0.45)];
  heelG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(travPts), matRope));
  const travBlock = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), matDark);
  travBlock.position.set(-2.0, sternSheer + 0.06, 0); heelG.add(travBlock);

  // ---------- рангоут и парус (вращаются вместе на степсе) ----------
  const rig = new THREE.Group();
  const mastBase = new THREE.Vector3(HULL.mastX, deckHeightAt(HULL.mastX).sheer, 0);
  rig.position.copy(mastBase);
  heelG.add(rig);

  const MAST_H = 5.05, RAKE = 0.12, BOOM_H = 0.62, BOOM_L = 2.74, CLEW = 2.58;
  const mastGeo = new THREE.CylinderGeometry(0.024, 0.034, MAST_H + 0.3, 16);
  const mast = new THREE.Mesh(mastGeo, matAlu);
  mast.position.set(-RAKE / 2, (MAST_H + 0.3) / 2 - 0.3, 0);
  mast.rotation.z = Math.atan2(RAKE, MAST_H);
  mast.castShadow = true; rig.add(mast);
  // степс
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16), matDark);
  collar.position.y = 0.03; rig.add(collar);
  // стык колен мачты
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.12, 16), matDark);
  joint.position.set(-RAKE * (2.75 / MAST_H), 2.75, 0); rig.add(joint);

  // гик
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, BOOM_L, 14), matAlu);
  boom.rotation.z = Math.PI / 2; boom.position.set(-BOOM_L / 2 + 0.02, BOOM_H, 0);
  boom.castShadow = true; rig.add(boom);
  const gooseneck = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), matDark);
  gooseneck.position.set(0, BOOM_H, 0); rig.add(gooseneck);
  const boomEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), matDark);
  boomEnd.rotation.z = Math.PI / 2; boomEnd.position.set(-BOOM_L + 0.02, BOOM_H, 0); rig.add(boomEnd);
  // оттяжка гика (ванг)
  const vangFrom = new THREE.Vector3(-0.02, 0.18, 0), vangTo = new THREE.Vector3(-0.62, BOOM_H - 0.02, 0);
  const vang = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, vangFrom.distanceTo(vangTo), 8), matDark);
  vang.position.copy(vangFrom).lerp(vangTo, 0.5);
  vang.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vangTo.clone().sub(vangFrom).normalize());
  rig.add(vang);
  // блоки гика-шкота на гике
  for (const bx of [-BOOM_L + 0.08, -1.3]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), matDark);
    b.position.set(bx, BOOM_H - 0.045, 0); rig.add(b);
  }

  // парус — параметрическая сетка
  const NU = 18, NV = 26;
  const sailGeo = new THREE.BufferGeometry();
  const sailPos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const sailUV = new Float32Array((NU + 1) * (NV + 1) * 2);
  const sailIdx = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    const k = i * (NV + 1) + j; sailUV[k * 2] = i / NU; sailUV[k * 2 + 1] = j / NV;
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
    sailIdx.push(a, b, c, b, d, c);
  }
  sailGeo.setAttribute('position', new THREE.BufferAttribute(sailPos, 3));
  sailGeo.setAttribute('uv', new THREE.BufferAttribute(sailUV, 2));
  sailGeo.setIndex(sailIdx);
  // две стороны паруса с «правильно» читаемыми номерами: лицевая и зеркальная текстура
  const sailTex = makeSailTexture();
  const sailTexBack = sailTex.clone(); sailTexBack.wrapS = THREE.RepeatWrapping; sailTexBack.repeat.x = -1; sailTexBack.offset.x = 1;
  const sailMat = new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.FrontSide, roughness: 0.9 });
  const sailMatBack = new THREE.MeshStandardMaterial({ map: sailTexBack, side: THREE.BackSide, roughness: 0.9 });
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.castShadow = true; sail.receiveShadow = true;
  rig.add(sail);
  const sailBack = new THREE.Mesh(sailGeo, sailMatBack);
  rig.add(sailBack);
  // кромки паруса (ликтрос)
  const edgeGeo = new THREE.BufferGeometry();
  const edgePos = new Float32Array((NV + 1 + NU + 1 + NV + 1) * 3);
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  const edge = new THREE.Line(edgeGeo, new THREE.LineBasicMaterial({ color: '#9aa3ad' }));
  rig.add(edge);

  const tack = new THREE.Vector3(0.0, BOOM_H + 0.02, 0);
  const head = new THREE.Vector3(-RAKE * 0.98, MAST_H - 0.06, 0);
  const clew = new THREE.Vector3(-CLEW, BOOM_H + 0.02, 0);
  const leechDir = head.clone().sub(clew).normalize();
  const roachOut = new THREE.Vector3(-leechDir.y, leechDir.x, 0).normalize(); // перпендикуляр к задней шкаторине, наружу
  if (roachOut.x > 0) roachOut.negate();

  // флюгарка на топе
  const windex = new THREE.Group();
  windex.position.set(-RAKE, MAST_H + 0.02, 0);
  const wShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 6), matAlu); wShaft.position.y = 0.12; windex.add(wShaft);
  const wArrow = new THREE.Group(); wArrow.position.y = 0.25;
  const wBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: '#ef4444' }));
  wBody.position.x = 0.1; wArrow.add(wBody);
  const wTip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8), new THREE.MeshStandardMaterial({ color: '#ef4444' }));
  wTip.rotation.z = -Math.PI / 2; wTip.position.x = 0.35; wArrow.add(wTip);
  const wFin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.005), new THREE.MeshStandardMaterial({ color: '#ef4444' }));
  wFin.position.x = -0.1; wArrow.add(wFin);
  windex.add(wArrow);
  rig.add(windex);

  // гика-шкот: от ноков гика к погону и к блоку в кокпите (обновляется)
  const sheetGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const sheetLine = new THREE.Line(sheetGeo, matRope);
  heelG.add(sheetLine);
  // шкот к рукам матроса — отдельно
  const handGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  heelG.add(new THREE.Line(handGeo, matRopeRed));

  // ---------- руль ----------
  const rudderPivot = new THREE.Group();
  const transomY = deckHeightAt(HULL.xStern).sheer;
  rudderPivot.position.set(HULL.xStern - 0.02, transomY, 0);
  heelG.add(rudderPivot);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.07), matDark);
  stock.position.set(-0.07, -0.05, 0); rudderPivot.add(stock);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.95, 0.022), matFoil);
  blade.position.set(-0.18, -0.52, 0); blade.castShadow = true; rudderPivot.add(blade);
  const tiller = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.03, 0.035), matWood);
  tiller.position.set(0.42, 0.12, 0); rudderPivot.add(tiller);
  const extPivot = new THREE.Group(); extPivot.position.set(0.9, 0.13, 0); rudderPivot.add(extPivot);
  const extension = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.05, 8), matAlu);
  extension.rotation.z = -Math.PI / 2; extension.position.x = 0.52; extPivot.add(extension);
  const extKnob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), matDark); extKnob.position.x = 1.05; extPivot.add(extKnob);
  // петли руля на транце
  for (const y of [-0.02, 0.18]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.08), matAlu);
    pin.position.set(HULL.xStern - 0.01, transomY + y, 0); heelG.add(pin);
  }

  // ---------- матрос ----------
  const sailor = makeSailor();
  heelG.add(sailor);

  // ---------- обновление ----------
  const tmp = new THREE.Vector3();
  let flutterPhase = 0;

  function updateSail(out, dt, t) {
    const side = out.side;
    const aoa = out.aoa;
    const luff = out.luffing ? 1 : Math.max(0, 1 - aoa / 6);
    flutterPhase += dt * (6 + out.AWS * 1.2);
    const power = Math.min(1, out.q / 60);          // наполненность
    const camberFrac = 0.025 + 0.085 * Math.min(1, aoa / 14) * (0.4 + 0.6 * power);
    const twist = 10 * DEG * (0.3 + 0.7 * Math.min(1, out.AWS / 6));
    const pa = sailPos;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        // передняя шкаторина
        const lx = tack.x + (head.x - tack.x) * v, ly = tack.y + (head.y - tack.y) * v;
        // задняя шкаторина с серпом
        const roach = 0.26 * Math.sin(Math.PI * v) * (1 - 0.25 * v);
        const ex = clew.x + (head.x - clew.x) * v + roachOut.x * roach;
        const ey = clew.y + (head.y - clew.y) * v + roachOut.y * roach;
        const x = lx + (ex - lx) * u, y = ly + (ey - ly) * u;
        const chord = Math.hypot(ex - lx, ey - ly);
        // пузо паруса — под ветер; максимум ближе к передней шкаторине
        const shape = Math.sin(Math.PI * Math.pow(u, 0.82));
        let z = -side * camberFrac * chord * shape * (1 - 0.35 * v);
        // скручивание: верх уходит под ветер
        z += -side * Math.sin(twist * v) * chord * u * 0.35 * power;
        // заполаскивание
        if (luff > 0) {
          const fl = luff * 0.11 * Math.sin(flutterPhase * 1.3 + u * 7 + v * 3) * Math.pow(u, 0.7) * (0.3 + 0.7 * (1 - v * 0.5));
          z = z * (1 - 0.8 * luff) + fl * Math.min(1, out.AWS / 3);
        }
        const k = (i * (NV + 1) + j) * 3;
        pa[k] = x; pa[k + 1] = y; pa[k + 2] = z;
      }
    }
    sailGeo.attributes.position.needsUpdate = true;
    sailGeo.computeVertexNormals();
    // ликтрос
    let e = 0;
    for (let j = 0; j <= NV; j++) { const k = (0 * (NV + 1) + j) * 3; edgePos[e++] = pa[k]; edgePos[e++] = pa[k + 1]; edgePos[e++] = pa[k + 2]; }
    for (let i = 1; i <= NU; i++) { const k = (i * (NV + 1) + NV) * 3; edgePos[e++] = pa[k]; edgePos[e++] = pa[k + 1]; edgePos[e++] = pa[k + 2]; }
    for (let j = NV - 1; j >= 0; j--) { const k = (NU * (NV + 1) + j) * 3; edgePos[e++] = pa[k]; edgePos[e++] = pa[k + 1]; edgePos[e++] = pa[k + 2]; }
    edgeGeo.attributes.position.needsUpdate = true;
  }

  const sailorTarget = new THREE.Vector3(-0.3, 0, 0);
  function update(state, out, ctl, dt, t) {
    out.side = state.side;
    // позиция и курс (x — восток, z — юг; курс 0 = север = -z)
    root.position.set(state.x, 0, state.z);
    root.rotation.y = Math.PI / 2 - state.heading * DEG;
    // крен (+heel = крен на левый борт → поворот вокруг x отрицательный)
    const bob = Math.sin(t * 1.3) * 0.015 + Math.sin(t * 2.1 + 1) * 0.01;
    heelG.rotation.x = -state.heel * DEG;
    heelG.rotation.z = (Math.sin(t * 0.9) * 0.8 - Math.min(2.5, state.vf * 0.9)) * DEG; // лёгкий дифферент на корму на ходу
    heelG.position.y = bob;

    // рангоут
    rig.rotation.y = -state.boom * DEG; // boom>0 → гик по правому борту (+z)
    // флюгарка: указывает откуда вымпельный ветер (в системе лодки), компенсируем поворот мачты
    windex.rotation.y = -out.AWA * DEG * 1 - rig.rotation.y;
    updateSail(out, dt, t);

    // гика-шкот: нок гика → блок на гике → погон → блок в кокпите
    const bEnd = tmp.set(-BOOM_L + 0.08, BOOM_H - 0.06, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.rotation.y).add(mastBase);
    const bMid = new THREE.Vector3(-1.3, BOOM_H - 0.06, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.rotation.y).add(mastBase);
    const p = sheetGeo.attributes.position;
    p.setXYZ(0, bEnd.x, bEnd.y, bEnd.z);
    p.setXYZ(1, -2.0, sternSheer + 0.06, 0);
    p.setXYZ(2, bMid.x, bMid.y, bMid.z);
    p.setXYZ(3, -0.05, floorY + 0.12, 0);
    p.needsUpdate = true;

    // руль: угол в градусах, + = поворот направо
    rudderPivot.rotation.y = ctl.rudder * DEG;

    // матрос: при крене вывешивается на наветренный борт
    const side = state.side;
    const hike = Math.min(1, Math.abs(state.heel) / 14);
    const railZ = side * (0.52 + 0.22 * hike);
    sailorTarget.set(-0.35, floorY + 0.05 + (deckHeightAt(-0.35).sheer - floorY) * (0.45 + 0.55 * hike), railZ);
    sailor.position.lerp(sailorTarget, Math.min(1, dt * 4));
    sailor.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; // лицом к центру лодки
    sailor.rotation.x = 0;
    sailor.rotation.z = 0;
    sailor.rotateX(-(0.25 + 0.85 * hike));  // откидывается наружу
    sailor.userData.legs.rotation.x = 0;

    // румпель-удлинитель — к руке матроса
    const handWorld = new THREE.Vector3(-0.2, 0.55, 0).applyEuler(sailor.rotation).add(sailor.position);
    rudderPivot.worldToLocal(heelG.localToWorld(handWorld.clone()));
    const local = rudderPivot.worldToLocal(heelG.localToWorld(handWorld.clone()));
    const dir = local.sub(extPivot.position);
    extPivot.rotation.set(0, Math.atan2(-dir.z, dir.x), Math.atan2(dir.y, Math.hypot(dir.x, dir.z)));
    // шкот в руку
    const hp = handGeo.attributes.position;
    hp.setXYZ(0, -0.05, floorY + 0.12, 0);
    hp.setXYZ(1, handWorld.x, handWorld.y, handWorld.z - side * 0.1);
    hp.needsUpdate = true;
  }

  return { root, heelG, rig, update, mastTop: () => new THREE.Vector3(HULL.mastX - RAKE, mastBase.y + MAST_H, 0), BOOM_H, MAST_H };
}
