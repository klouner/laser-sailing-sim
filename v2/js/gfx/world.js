// Сцена: движок, небо, океан, свет, тени, отражение лодки, пена, постобработка.
// Лодку и всё остальное сюда добавляет main.js; этот модуль про мир вокруг.
import * as B from 'babylon';
import { NW } from '../env.js';
import { SKY_VERT, SKY_FRAG, SKY_UNIFORMS, OCEAN_VERT, OCEAN_FRAG, OCEAN_UNIFORMS, OCEAN_SAMPLERS, FOAM_FRAG } from './shaders.js';

const DEG = Math.PI / 180;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Время суток: высота солнца и цвета неба. Цвета линейные.
export const SKIES = {
  day: { name: 'День', elev: 46, zenith: [0.075, 0.24, 0.66], horizon: [0.46, 0.66, 0.90], haze: [0.72, 0.82, 0.92], sun: [3.3, 3.1, 2.75], cloud: 0.4, deep: [0.012, 0.085, 0.16], scatter: [0.03, 0.34, 0.38], ambient: 0.9 },
  morning: { name: 'Утро', elev: 17, zenith: [0.10, 0.25, 0.60], horizon: [0.66, 0.68, 0.72], haze: [0.86, 0.80, 0.74], sun: [3.2, 2.5, 1.75], cloud: 0.34, deep: [0.012, 0.075, 0.14], scatter: [0.05, 0.30, 0.32], ambient: 0.75 },
  sunset: { name: 'Закат', elev: 6, zenith: [0.07, 0.13, 0.36], horizon: [0.86, 0.42, 0.22], haze: [0.95, 0.52, 0.30], sun: [3.4, 1.7, 0.7], cloud: 0.42, deep: [0.014, 0.05, 0.10], scatter: [0.10, 0.20, 0.20], ambient: 0.55 },
  overcast: { name: 'Пасмурно', elev: 38, zenith: [0.30, 0.34, 0.40], horizon: [0.52, 0.56, 0.60], haze: [0.60, 0.64, 0.68], sun: [0.9, 0.9, 0.9], cloud: 0.95, deep: [0.02, 0.06, 0.09], scatter: [0.04, 0.16, 0.17], ambient: 1.15 },
};
const SUN_AZIMUTH = 35;           // откуда светит солнце, компасный пеленг

// ---------- процедурные текстуры ----------
// Плавный шум, который стыкуется сам с собой: три независимых слоя в каналах R, G, B
function makeNoiseTexture(scene) {
  const N = 256, G = 32, data = new Uint8Array(N * N * 4);
  for (let ch = 0; ch < 3; ch++) {
    const rnd = rng(11 + ch * 97), lat = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) lat[i] = rnd();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * G, fy = y / N * G, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = lat[y0 % G * G + x0 % G], b = lat[y0 % G * G + (x0 + 1) % G], c = lat[(y0 + 1) % G * G + x0 % G], d = lat[(y0 + 1) % G * G + (x0 + 1) % G];
      data[(y * N + x) * 4 + ch] = Math.round(255 * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty));
    }
  }
  for (let i = 0; i < N * N; i++) data[i * 4 + 3] = 255;
  const t = B.RawTexture.CreateRGBATexture(data, N, N, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 4;
  return t;
}
// Карта нормалей ряби: полсотни волн случайных направлений и длин. Волновые числа целые, поэтому текстура
// стыкуется сама с собой, а из-за числа волн в ней не видно ни полос, ни повтора.
function makeRippleTexture(scene) {
  const N = 256, rnd = rng(3), h = new Float32Array(N * N), ws = [];
  for (let k = 0; k < 56; k++) {
    const kx = Math.round((rnd() * 2 - 1) * 26), ky = Math.round((rnd() * 2 - 1) * 26), m = Math.hypot(kx, ky);
    if (m < 2.5) { k--; continue; }
    ws.push({ kx, ky, p: rnd() * Math.PI * 2, amp: Math.pow(m, -1.15) });
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 0; const x = i / N * Math.PI * 2, y = j / N * Math.PI * 2;
    for (const w of ws) v += w.amp * Math.sin(w.kx * x + w.ky * y + w.p);
    h[j * N + i] = v;
  }
  const data = new Uint8Array(N * N * 4), str = 1.5;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = h[j * N + (i + N - 1) % N], r = h[j * N + (i + 1) % N], u = h[((j + N - 1) % N) * N + i], d = h[((j + 1) % N) * N + i];
    const nx = -(r - l) * str, ny = -(d - u) * str, len = Math.hypot(nx, ny, 1), k = (j * N + i) * 4;
    data[k] = (nx / len * 0.5 + 0.5) * 255; data[k + 1] = (ny / len * 0.5 + 0.5) * 255; data[k + 2] = (1 / len * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const t = B.RawTexture.CreateRGBATexture(data, N, N, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8;
  return t;
}
// Окружение для отражений на лодке: небольшой куб с градиентом неба и цветом воды снизу
function makeEnvCube(scene, sky) {
  const S = 32, faces = [];
  const dirs = [(u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1]];
  const enc = (c) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2));
  for (let f = 0; f < 6; f++) {
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = dirs[f]((x + 0.5) / S * 2 - 1, (y + 0.5) / S * 2 - 1), L = Math.hypot(d[0], d[1], d[2]), dy = d[1] / L, k = (y * S + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v;
        if (dy >= 0) { const t = Math.pow(1 - dy, 3.2); v = sky.zenith[c] + (sky.horizon[c] - sky.zenith[c]) * t; v += (sky.haze[c] - v) * Math.pow(1 - dy, 12) * 0.85; }
        else { const t = Math.min(1, -dy * 4); v = sky.haze[c] * 0.55 + (sky.deep[c] * 2.2 - sky.haze[c] * 0.55) * t; }
        data[k + c] = enc(v * 0.85);
      }
      data[k + 3] = 255;
    }
    faces.push(data);
  }
  const t = new B.RawCubeTexture(scene, faces, S, B.Constants.TEXTUREFORMAT_RGBA, B.Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  t.gammaSpace = true;
  return t;
}

// Сетка воды: густая у лодки, редкая вдали, внешние кольца уходят к горизонту
function buildOceanGrid(scene, R, N, a, RF, NO) {
  const half = N / 2 + NO, n1 = 2 * half + 1, coord = new Float32Array(n1);
  for (let i = 0; i < n1; i++) {
    const k = Math.abs(i - half), u = Math.min(1, k / (N / 2));
    let x = R * (a * u + (1 - a) * u * u * u);
    if (k > N / 2) x = R * Math.pow(RF / R, (k - N / 2) / NO);
    coord[i] = i < half ? -x : x;
  }
  const pos = new Float32Array(n1 * n1 * 3), idx = new Uint32Array((n1 - 1) * (n1 - 1) * 6);
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) { const k = (j * n1 + i) * 3; pos[k] = coord[i]; pos[k + 2] = coord[j]; }
  let o = 0;
  for (let j = 0; j < n1 - 1; j++) for (let i = 0; i < n1 - 1; i++) { const p = j * n1 + i, q = p + 1, r = p + n1, s = r + 1; idx[o++] = p; idx[o++] = r; idx[o++] = q; idx[o++] = q; idx[o++] = r; idx[o++] = s; }
  const mesh = new B.Mesh('ocean', scene), vd = new B.VertexData();
  vd.positions = pos; vd.indices = idx; vd.applyToMesh(mesh);
  mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false;
  return mesh;
}

export function createWorld(canvas, { antialias = true } = {}) {
  const engine = new B.Engine(canvas, antialias, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance', alpha: false }, false);
  const scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;              // те же оси, что в физике: x на восток, y вверх, z на юг
  scene.clearColor = new B.Color4(0.5, 0.7, 0.9, 1);
  scene.skipPointerMovePicking = true; scene.autoClearDepthAndStencil = true;

  const camera = new B.TargetCamera('cam', new B.Vector3(-8, 4.5, 6), scene);
  camera.minZ = 0.1; camera.maxZ = 14000; camera.fov = 50 * DEG;
  scene.activeCamera = camera;

  // ---- свет ----
  const sunDir = new B.Vector3(0, 1, 0);
  const sun = new B.DirectionalLight('sun', new B.Vector3(0, -1, 0), scene);
  const hemi = new B.HemisphericLight('sky', new B.Vector3(0, 1, 0), scene);
  hemi.specular = new B.Color3(0, 0, 0);
  const shadowGen = new B.ShadowGenerator(2048, sun);
  shadowGen.usePercentageCloserFiltering = true; shadowGen.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.003; shadowGen.normalBias = 0.035; shadowGen.darkness = 0.12;
  sun.autoUpdateExtends = true; sun.autoCalcShadowZBounds = true; sun.shadowOrthoScale = 0.08;

  // ---- небо ----
  const noiseTex = makeNoiseTexture(scene), rippleTex = makeRippleTexture(scene);
  B.Effect.ShadersStore.sky2VertexShader = SKY_VERT; B.Effect.ShadersStore.sky2FragmentShader = SKY_FRAG;
  const skyMat = new B.ShaderMaterial('sky', scene, { vertex: 'sky2', fragment: 'sky2' }, { attributes: ['position'], uniforms: ['world', 'viewProjection', 'uDeepFar', ...SKY_UNIFORMS], samplers: ['uNoise'] });
  skyMat.backFaceCulling = false; skyMat.disableDepthWrite = true;
  skyMat.setTexture('uNoise', noiseTex);
  const skyDome = B.CreateSphere('sky', { diameter: 12000, segments: 24 }, scene);
  skyDome.material = skyMat; skyDome.isPickable = false; skyDome.alwaysSelectAsActiveMesh = true;

  // ---- вода ----
  B.Effect.ShadersStore.ocean2VertexShader = OCEAN_VERT; B.Effect.ShadersStore.ocean2FragmentShader = OCEAN_FRAG;
  const oceanMat = new B.ShaderMaterial('ocean', scene, { vertex: 'ocean2', fragment: 'ocean2' }, { attributes: ['position'], uniforms: OCEAN_UNIFORMS, samplers: OCEAN_SAMPLERS, needAlphaBlending: true });
  oceanMat.backFaceCulling = false;
  const ocean = buildOceanGrid(scene, 300, 128, 0.08, 5200, 10);
  ocean.material = oceanMat; ocean.alphaIndex = 0;
  oceanMat.setTexture('uNoise', noiseTex); oceanMat.setTexture('uNormalTex', rippleTex);

  // ---- пена от лодки: две текстуры по очереди читают друг друга ----
  const FOAM_SIZE = 48, FOAM_RES = 512;
  const halfFloat = engine.getCaps().textureHalfFloatRender && engine.getCaps().textureHalfFloatLinearFiltering;
  const mkFoam = (name) => {
    const t = new B.ProceduralTexture(name, FOAM_RES, { fragmentSource: FOAM_FRAG }, scene, null, false, false, halfFloat ? B.Constants.TEXTURETYPE_HALF_FLOAT : B.Constants.TEXTURETYPE_UNSIGNED_BYTE);
    t.refreshRate = 1; t.wrapU = t.wrapV = B.Texture.CLAMP_ADDRESSMODE; return t;
  };
  const foamA = mkFoam('foamA'), foamB = mkFoam('foamB');
  foamA.setTexture('uPrev', foamB); foamB.setTexture('uPrev', foamA);
  oceanMat.setTexture('uFoamTex', foamB);
  const foam = { cx: 0, cz: 0, texel: FOAM_SIZE / FOAM_RES, shift: new B.Vector2(), zero: new B.Vector2(0, 0), step: new B.Color4(), boat: new B.Color4(), boatP: new B.Color4(), boat2: new B.Color4(9, 9, 1, 0), boatP2: new B.Color4(0.04, 0.015, 0, 0), on: true };

  // ---- тень лодки на воде: силуэт, снятый из положения солнца ----
  const sunCam = new B.FreeCamera('sunCam', new B.Vector3(0, 40, 0), scene, false);
  sunCam.mode = B.Camera.ORTHOGRAPHIC_CAMERA; sunCam.minZ = 1; sunCam.maxZ = 120;
  const SH = 11; sunCam.orthoLeft = -SH; sunCam.orthoRight = SH; sunCam.orthoTop = SH; sunCam.orthoBottom = -SH;
  const shadowMask = new B.RenderTargetTexture('shadowMask', 512, scene, { generateMipMaps: false, generateDepthBuffer: true });
  shadowMask.activeCamera = sunCam; shadowMask.clearColor = new B.Color4(0, 0, 0, 0); shadowMask.renderList = []; shadowMask.ignoreCameraViewport = true;
  shadowMask.wrapU = shadowMask.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  scene.customRenderTargets.push(shadowMask);
  oceanMat.setTexture('uShadowMask', shadowMask);
  const shadowM = new B.Matrix();

  // ---- отражение лодки ----
  const mirror = new B.MirrorTexture('mirror', { ratio: 0.5 }, scene, false);
  mirror.mirrorPlane = new B.Plane(0, -1, 0, 0); mirror.clearColor = new B.Color4(0, 0, 0, 0); mirror.renderList = [];
  mirror.activeCamera = camera;        // иначе отражение снимется камерой предыдущего прохода, то есть «из солнца»
  scene.customRenderTargets.push(mirror);
  oceanMat.setTexture('uMirror', mirror);

  // ---- постобработка ----
  const pipeline = new B.DefaultRenderingPipeline('main', true, scene, [camera]);
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES; ip.exposure = 1.25; ip.contrast = 1.1;
  ip.vignetteEnabled = true; ip.vignetteWeight = 0.9; ip.vignetteStretch = 0.2; ip.vignetteColor = new B.Color4(0, 0, 0, 0);
  pipeline.bloomEnabled = true; pipeline.bloomThreshold = 1.7; pipeline.bloomWeight = 0.28; pipeline.bloomKernel = 56; pipeline.bloomScale = 0.5;
  pipeline.fxaaEnabled = true;

  // ---- время суток ----
  const state = { sky: null, skyKey: '', cloudX: 0, cloudZ: 0, flipMirror: 0, flipShadow: 0, fx: { shadow: true, mirror: true, foam: true, bloom: true } };
  const v3 = (a) => new B.Vector3(a[0], a[1], a[2]);
  let envCube = null;
  const skyMats = [skyMat, oceanMat];           // материалы, которым нужны цвета неба; берег добавляет сюда свой
  function setSky(key) {
    const s = SKIES[key] || SKIES.day; state.sky = s; state.skyKey = key;
    const az = SUN_AZIMUTH * DEG, el = s.elev * DEG;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sun.direction.copyFrom(sunDir).scaleInPlace(-1);
    const lum = Math.max(s.sun[0], s.sun[1], s.sun[2]);
    sun.diffuse = new B.Color3(s.sun[0] / lum, s.sun[1] / lum, s.sun[2] / lum); sun.specular = sun.diffuse; sun.intensity = lum * 0.50;
    const amb = (c) => 0.55 * (s.horizon[c] * 0.75 + s.zenith[c] * 0.25) + 0.45 * (s.horizon[0] + s.horizon[1] + s.horizon[2]) / 3;
    hemi.diffuse = new B.Color3(amb(0), amb(1), amb(2));
    hemi.groundColor = new B.Color3(s.deep[0] * 2 + 0.03, s.deep[1] * 2 + 0.03, s.deep[2] * 2 + 0.03); hemi.intensity = 0.42 * s.ambient;
    for (const m of skyMats) {
      m.setVector3('uSunDir', sunDir); m.setVector3('uSunCol', v3(s.sun)); m.setVector3('uZenith', v3(s.zenith)); m.setVector3('uHorizon', v3(s.horizon)); m.setVector3('uHaze', v3(s.haze));
    }
    skyMat.setVector3('uDeepFar', new B.Vector3(s.deep[0] * 1.4 + s.haze[0] * 0.12, s.deep[1] * 1.4 + s.haze[1] * 0.12, s.deep[2] * 1.4 + s.haze[2] * 0.12));
    oceanMat.setVector3('uDeep', v3(s.deep)); oceanMat.setVector3('uScatter', v3(s.scatter));
    if (envCube) envCube.dispose();
    envCube = makeEnvCube(scene, s); scene.environmentTexture = envCube; scene.environmentIntensity = 0.40 * s.ambient;
  }
  setSky('day');

  // ---- регистрация мешей лодки: кто отбрасывает тень и кто отражается ----
  function addBoatMesh(mesh, { cast = true, receive = true, reflect = true } = {}) {
    if (cast) { shadowGen.addShadowCaster(mesh, false); shadowMask.renderList.push(mesh); }
    if (receive) mesh.receiveShadows = true;
    if (reflect) mirror.renderList.push(mesh);
  }

  // ---- кадр ----
  const U = { compass: new B.Vector4(0, 0, 3.6, 1), windMark: new B.Vector4(0, -1, 1, 1), ripple: new B.Vector4(), line: new B.Vector4(), foamWin: new B.Vector4(), sea: new B.Vector4(), fx: new B.Vector4(1, 1, 0, 0), screen: new B.Vector2(1, 1), cloud: new B.Vector3(), pivot: new B.Vector2(), fwd: new B.Vector2(), plane: new B.Vector3() };
  const marks = new Array(16).fill(0), markCol = new Array(16).fill(0);
  let ripT = 0;
  // f: { dt, paused, x, z, fx, fz, speed, capsized, windFrom (град), windKn, compass 0..1, noGo, arrow, marks: [{x,z,r,a,color:[r,g,b]}] }
  function update(env, f) {
    const dt = f.paused ? 0 : f.dt, s = state.sky;
    const wa = (f.windFrom + 180) * DEG, wx = Math.sin(wa), wz = -Math.cos(wa);
    // небо и вода стоят вокруг камеры; сетка воды переезжает целыми метрами, волны при этом считаются в мировых координатах
    skyDome.position.copyFrom(camera.position); skyDome.position.y = 0;
    ocean.position.set(Math.round(f.x), 0, Math.round(f.z));
    state.cloudX += wx * dt * 0.0016; state.cloudZ += wz * dt * 0.0016;
    U.cloud.set(state.cloudX % 1, state.cloudZ % 1, s.cloud);
    skyMat.setVector3('uCloudP', U.cloud); oceanMat.setVector3('uCloudP', U.cloud);
    // волны
    U.pivot.set(env.pivotX, env.pivotZ); U.fwd.set(env.boat.fx, env.boat.fz); U.plane.set(env.boat.heave, env.boat.sf, env.boat.ss);
    oceanMat.setArray2('uWaveDir', env.u.dir); oceanMat.setArray4('uWaveP', env.u.p); oceanMat.setArray2('uWaveFade', env.u.fade);
    oceanMat.setArray2('uGustQ', env.u.gustQ); oceanMat.setArray2('uGustP', env.u.gustP);
    oceanMat.setVector2('uPivot', U.pivot); oceanMat.setVector2('uBoatFwd', U.fwd); oceanMat.setVector3('uBoatPlane', U.plane); oceanMat.setFloat('uBoatMask', env.boat.mask);
    // рябь едет по ветру; сдвиг считается от опорной точки, которая сама едет с лодкой
    ripT += dt;
    const px = env.pivotX, pz = env.pivotZ, k1 = ripT * 0.05, k2 = ripT * 0.21;
    U.ripple.set((px * 0.105 + wx * k1) % 1, (pz * 0.105 + wz * k1) % 1, ((px * 0.8 - pz * 0.6) * 0.41 + (wx * 0.8 - wz * 0.6) * k2) % 1, ((px * 0.6 + pz * 0.8) * 0.41 + (wx * 0.6 + wz * 0.8) * k2) % 1);
    oceanMat.setVector4('uRipple', U.ripple);
    U.sea.set(env.whitecap, env.gustOn, f.windKn, env.ampTotal); oceanMat.setVector4('uSea', U.sea);
    oceanMat.setVector3('uCam', camera.position);
    U.screen.set(engine.getRenderWidth(), engine.getRenderHeight()); oceanMat.setVector2('uScreen', U.screen);
    // разметка
    U.compass.set(f.x, f.z, 3.6, f.compass); oceanMat.setVector4('uCompass', U.compass);
    const wf = f.windFrom * DEG; U.windMark.set(Math.sin(wf), -Math.cos(wf), f.noGo ? 1 : 0, f.arrow ? 1 : 0); oceanMat.setVector4('uWindMark', U.windMark);
    for (let i = 0; i < 4; i++) {
      const m = f.marks && f.marks[i];
      marks[i * 4] = m ? m.x : 0; marks[i * 4 + 1] = m ? m.z : 0; marks[i * 4 + 2] = m ? m.r : 1; marks[i * 4 + 3] = m ? m.a : 0;
      markCol[i * 4] = m ? m.color[0] : 0; markCol[i * 4 + 1] = m ? m.color[1] : 0; markCol[i * 4 + 2] = m ? m.color[2] : 0; markCol[i * 4 + 3] = 1;
    }
    oceanMat.setArray4('uMarks', marks); oceanMat.setArray4('uMarkCol', markCol);
    const ln = f.line; U.line.set(ln ? ln.x0 : 0, ln ? ln.z0 : 0, ln ? ln.x1 : 1, ln ? ln.z1 : 0); oceanMat.setVector4('uLine', U.line); oceanMat.setFloat('uLineA', ln ? ln.a : 0);

    // пена: окно едет за лодкой целыми текселями
    const tx = foam.texel, cx = Math.round(f.x / tx) * tx, cz = Math.round(f.z / tx) * tx;
    let sx = (cx - foam.cx) / FOAM_SIZE, sz = (cz - foam.cz) / FOAM_SIZE;
    if (Math.abs(sx) > 0.5 || Math.abs(sz) > 0.5) { sx = 2; sz = 2; }        // лодку переставили: след стирается
    foam.cx = cx; foam.cz = cz; foam.shift.set(sx, sz);
    // два шага симуляции за кадр: затухание и размытие поделены пополам
    const life = 5.5, decay = dt > 0 ? Math.exp(-dt / life / 2) : 1;
    foam.step.set(decay, dt > 0 ? 0.0012 : 0, dt > 0 ? 0.11 : 0, 1 / FOAM_RES);
    const sp = f.capsized ? 0 : Math.abs(f.speed);
    foam.boat.set((f.x - cx) / FOAM_SIZE + 0.5, (f.z - cz) / FOAM_SIZE + 0.5, f.fx, f.fz);
    const bow = Math.min(1, Math.max(0, (sp - 0.8) / 2.6)), stern = Math.min(1, Math.max(0, (sp - 0.4) / 2.2));
    foam.boatP.set(2.12 / FOAM_SIZE, 0.7 / FOAM_SIZE, dt > 0 ? bow * 0.7 : 0, dt > 0 ? stern * 0.55 : 0);
    // след ближайшего соперника, если он в окне пены
    const w2 = f.wake2, sp2 = w2 ? Math.abs(w2.speed) : 0;
    if (w2) foam.boat2.set((w2.x - cx) / FOAM_SIZE + 0.5, (w2.z - cz) / FOAM_SIZE + 0.5, w2.fx, w2.fz); else foam.boat2.set(9, 9, 1, 0);
    foam.boatP2.set(2.12 / FOAM_SIZE, 0.7 / FOAM_SIZE, w2 && dt > 0 ? Math.min(1, Math.max(0, (sp2 - 0.8) / 2.6)) * 0.7 : 0, w2 && dt > 0 ? Math.min(1, Math.max(0, (sp2 - 0.4) / 2.2)) * 0.55 : 0);
    for (const t of [foamA, foamB]) { t.setColor4('uStep', foam.step); t.setColor4('uBoat', foam.boat); t.setColor4('uBoatP', foam.boatP); t.setColor4('uBoat2', foam.boat2); t.setColor4('uBoatP2', foam.boatP2); }
    foamA.setVector2('uShift', foam.shift); foamB.setVector2('uShift', foam.zero);
    U.foamWin.set(cx, cz, FOAM_SIZE, state.fx.foam ? 1 : 0); oceanMat.setVector4('uFoamWin', U.foamWin);

    // свет и тени стоят вокруг лодки
    sun.position.set(f.x + sunDir.x * 40, sunDir.y * 40 + 1, f.z + sunDir.z * 40);
    sunCam.position.set(f.x + sunDir.x * 50, sunDir.y * 50 + 0.5, f.z + sunDir.z * 50);
    sunCam.setTarget(new B.Vector3(f.x, 0.5, f.z));
    sunCam.getViewMatrix().multiplyToRef(sunCam.getProjectionMatrix(), shadowM);
    oceanMat.setMatrix('uShadowM', shadowM);
    mirror.mirrorPlane.d = env.boat.heave;
    U.fx.set(state.fx.shadow ? 1 : 0, state.fx.mirror ? 1 : 0, state.flipMirror, state.flipShadow); oceanMat.setVector4('uFx', U.fx);
  }

  // Уровень эффектов: 0 — без отражения, пены и свечения; 1 — пена, свечение, тень на воде; 2 — ещё и отражение лодки
  function setEffects(level, shadowSize) {
    state.fx.mirror = level >= 2; state.fx.foam = level >= 1; state.fx.shadow = level >= 1; state.fx.bloom = level >= 1;
    pipeline.bloomEnabled = state.fx.bloom;
    mirror.refreshRate = state.fx.mirror ? 1 : 0; shadowMask.refreshRate = state.fx.shadow ? 1 : 0;
    foamA.refreshRate = foamB.refreshRate = state.fx.foam ? 1 : 0;
    if (shadowSize && shadowGen.mapSize !== shadowSize) shadowGen.mapSize = shadowSize;
  }

  return { B, engine, scene, camera, skyMats, sun, sunDir, shadowGen, pipeline, ocean, oceanMat, skyDome, mirror, shadowMask, noiseTex, state, setSky, addBoatMesh, update, setEffects, render: () => scene.render() };
}
