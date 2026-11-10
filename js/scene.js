import * as THREE from 'three';
import { WAVE_GLSL, GUST_GLSL, floatOnWaves } from './env.js';

const DEG = Math.PI / 180;
// детерминированный генератор для процедурных текстур
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- небо ----------
// Цвет дымки у горизонта: тот же, что у тумана сцены, чтобы дальняя вода уходила в небо без шва.
export const HAZE = '#d3e0ec';
// Небо по мотивам рассеяния в атмосфере: тёмная синева в зените, светлеет и белеет к горизонту,
// у солнца тёплый ореол, под 90° к солнцу небо глубже. Ниже горизонта — толща воды (видна сквозь воду).
export function makeSky(sunDir, mirror = false) {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { mirror: { value: mirror ? 1 : 0 }, sun: { value: sunDir.clone().normalize() }, haze: { value: new THREE.Color(HAZE).convertLinearToSRGB() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sun, haze; uniform float mirror; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir);
        // для карты отражений нижняя полусфера повторяет верхнюю: пологая вода отражает небо у горизонта, а не «дно»
        if (mirror > 0.5) d.y = abs(d.y) * 0.85 + 0.03;
        float h = max(d.y, 0.0), mu = dot(d, sun), mp = max(mu, 0.0);
        float g = pow(1.0 - h, 3.0);
        vec3 c = mix(vec3(0.090, 0.275, 0.720), vec3(0.560, 0.755, 0.940), g);
        c *= 0.88 + 0.13 * mu * mu;
        c += vec3(1.0, 0.86, 0.66) * (0.10 * pow(mp, 6.0) + 0.20 * pow(mp, 48.0));
        c = mix(c, haze + vec3(0.07, 0.035, 0.0) * pow(mp, 3.0), pow(1.0 - h, 11.0) * 0.86);
        c += vec3(1.0, 0.97, 0.90) * smoothstep(0.99950, 0.99985, mu) * 2.0;
        if (mirror < 0.5) c = mix(c, vec3(0.020, 0.105, 0.185), smoothstep(0.0, -0.05, d.y));
        // лёгкий шум против полос на плавном градиенте
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
        gl_FragColor = vec4(c, 1.0); }`
  });
  return new THREE.Mesh(geo, mat);
}

// ---------- дальний берег ----------
// Полоса холмов на горизонте с одной стороны акватории. Стоит «в бесконечности»: едет вместе с лодкой.
export function makeShore() {
  const W = 2048, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = rng(77);
  const layer = (color, base, amp, rough, from, to) => {
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
    g.fillStyle = color; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) {
      const u = x / W, a = u * Math.PI * 2;
      // берег занимает часть круга: к краям сектора холмы сходят в воду
      const sect = Math.max(0, Math.min(1, (u - from) / 0.07)) * Math.max(0, Math.min(1, (to - u) / 0.07));
      const s = sect * sect * (3 - 2 * sect);
      const hh = base + amp * (0.5 + 0.28 * Math.sin(a * 5 + ph[0]) + 0.16 * Math.sin(a * 13 + ph[1]) + 0.08 * Math.sin(a * 31 + ph[2])) + rough * Math.sin(a * 190 + ph[3]) * Math.sin(a * 77 + ph[0]);
      g.lineTo(x, H - Math.max(0, hh * s));
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  layer('rgba(150,176,198,0.95)', 5, 44, 0.0, 0.52, 0.98);     // дальние сопки в дымке
  layer('rgba(112,146,160,0.97)', 3, 26, 0.6, 0.48, 0.90);     // ближняя гряда
  layer('rgba(84,122,118,1.0)', 2, 13, 1.0, 0.56, 0.84);       // лес у воды
  // у самой воды берег тонет в дымке
  const fade = g.createLinearGradient(0, H - 7, 0, H); fade.addColorStop(0, 'rgba(211,224,236,0)'); fade.addColorStop(1, 'rgba(211,224,236,0.85)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = fade; g.fillRect(0, H - 7, W, 7);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
  const R = 880, HT = 52;
  const geo = new THREE.CylinderGeometry(R, R, HT, 96, 1, true); geo.translate(0, HT / 2 - 0.5, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  mesh.renderOrder = 2; mesh.frustumCulled = false;
  return mesh;
}

// ---------- облака ----------
// Текстура собирается попиксельно: чисто белый цвет и плавная прозрачность.
// (Градиенты холста на части телефонов дают цветную рябь.)
function makeCloudTexture(seed) {
  const W = 256, H = 128, rnd = rng(seed);
  const acc = new Float32Array(W * H);
  for (let b = 0; b < 16; b++) {
    const cx = 44 + rnd() * 168, cy = 46 + rnd() * 40, r = 20 + rnd() * 30, gain = 0.55 + rnd() * 0.4;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
      const f = 1 - d * d; acc[y * W + x] += gain * f * f;
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = Math.round(255 * Math.min(0.92, acc[i]) ); }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return tex;
}
export function makeClouds() {
  const texs = [makeCloudTexture(11), makeCloudTexture(47), makeCloudTexture(93)];
  const rnd = rng(7);
  const group = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, opacity: 0.55 + rnd() * 0.35, depthWrite: false }));
    const a = rnd() * Math.PI * 2, r = 150 + rnd() * 450;
    m.position.set(Math.cos(a) * r, 60 + rnd() * 70, Math.sin(a) * r);
    const s = 90 + rnd() * 160; m.scale.set(s, s * 0.45, 1);
    group.add(m);
  }
  return group;
}

// ---------- вода ----------
function makeWaterNormalMap() {
  const N = 256, rnd = rng(3);
  const h = new Float32Array(N * N);
  const waves = [];
  for (let k = 0; k < 7; k++) waves.push({ a: rnd() * Math.PI * 2, f: Math.round(2 + rnd() * 9), p: rnd() * 6, amp: 1 / (k + 1.5) });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 0; const x = i / N, y = j / N;
    for (const w of waves) v += w.amp * Math.sin((Math.round(Math.cos(w.a) * w.f) * x + Math.round(Math.sin(w.a) * w.f) * y) * Math.PI * 2 + w.p);
    h[j * N + i] = v;
  }
  const data = new Uint8Array(N * N * 4);
  const str = 0.18;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = h[j * N + (i + N - 1) % N], r = h[j * N + (i + 1) % N], u = h[((j + N - 1) % N) * N + i], d = h[((j + 1) % N) * N + i];
    const nx = -(r - l) * str, ny = -(d - u) * str, nz = 1;
    const len = Math.hypot(nx, ny, nz); const k = (j * N + i) * 4;
    data[k] = (nx / len * 0.5 + 0.5) * 255; data[k + 1] = (ny / len * 0.5 + 0.5) * 255; data[k + 2] = (nz / len * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
// Сетка воды: густая у лодки (ячейка ~0.4 м), редкая вдали; внешние кольца уходят к горизонту.
function buildWaterGeometry(R, N, a, RF, NO, tile) {
  const half = N / 2 + NO, n1 = 2 * half + 1;
  const coord = new Float32Array(n1);
  for (let i = 0; i < n1; i++) {
    const k = Math.abs(i - half), u = Math.min(1, k / (N / 2));
    let x = R * (a * u + (1 - a) * u * u * u);
    if (k > N / 2) x = R * Math.pow(RF / R, (k - N / 2) / NO);
    coord[i] = i < half ? -x : x;
  }
  const pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2);
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const x = coord[i], z = coord[j], k = j * n1 + i;
    pos[k * 3] = x; pos[k * 3 + 2] = z; nor[k * 3 + 1] = 1;
    uv[k * 2] = x / tile; uv[k * 2 + 1] = -z / tile;
  }
  const M = n1 - 1, idx = new Uint16Array(M * M * 6); let o = 0;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const p = j * n1 + i, q = p + 1, r = p + n1, s = r + 1;
    idx[o++] = p; idx[o++] = r; idx[o++] = q; idx[o++] = q; idx[o++] = r; idx[o++] = s;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RF * 1.5);
  return g;
}

export function makeWater(env) {
  const TILE = 6.667;
  const geo = buildWaterGeometry(300, 128, 0.08, 1500, 8, TILE);
  const nmap = makeWaterNormalMap();
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.13, metalness: 0.0, normalMap: nmap, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.9,
    transparent: true, opacity: 1,
  });
  const U = {
    uDeep: { value: new THREE.Color('#0f4d78') }, uScatter: { value: new THREE.Color('#1f8f97') },
    uRipple: { value: new THREE.Vector2() }, tReflect: { value: null }, uReflectM: { value: new THREE.Matrix4() }, uReflectOn: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, env.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAVE_GLSL + GUST_GLSL + '\nuniform mat4 uReflectM; varying float vWave; varying float vGust; varying vec2 vWXZ; varying vec4 vRefl;')
      .replace('#include <beginnormal_vertex>', `
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 whg = waveHG(wp0.xz);
        vec3 objectNormal = normalize(vec3(-whg.y, 1.0, -whg.z));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += whg.x; vWave = whg.x / uAmpTotal; vGust = gustV(wp0.xz); vWXZ = wp0.xz;
        vRefl = uReflectM * vec4(wp0.x, 0.0, wp0.z, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGustOn, uWhitecap, uBoatWash, uReflectOn; uniform vec2 uPivot, uBoatFwd; uniform vec3 uDeep, uScatter; uniform sampler2D tReflect; uniform vec2 uRipple;
        varying float vWave; varying float vGust; varying vec2 vWXZ; varying vec4 vRefl;
        float gP, gL, foamE, fresW;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // порыв (>0) — пятно тёмной ряби с заметной границей; затишье (<0) — светлее и глаже
        gP = smoothstep(0.12, 0.55, vGust) * uGustOn; gL = smoothstep(0.15, 0.6, -vGust) * uGustOn;
        // три слоя шума под разными углами и в разном масштабе, чтобы пятна пены не выстраивались в полосы
        vec2 q1 = vec2(vWXZ.x * 0.82 + vWXZ.y * 0.57, vWXZ.y * 0.82 - vWXZ.x * 0.57), q2 = vec2(vWXZ.x * 0.34 - vWXZ.y * 0.94, vWXZ.y * 0.34 + vWXZ.x * 0.94);
        float nA = texture2D(normalMap, q1 * 0.23).r, nB = texture2D(normalMap, q2 * 0.11 + 0.37).g, nC = texture2D(normalMap, vWXZ.yx * 0.47 + 0.11).g;
        float crest = smoothstep(0.25, 0.75, vWave);
        float nz = (nA - 0.5) * 0.48 + (nB - 0.5) * 0.40 + (nC - 0.5) * 0.12;      // шум около нуля, размах ~±0.08
        // барашки: мелкие пятна пены на вершинах гребней
        foamE = min(1.0, uWhitecap * 3.0) * smoothstep(0.90, 1.18, crest + nz * 6.0 - (1.0 - uWhitecap) * 0.55);
        // пена у ватерлинии: корпус режет воду, полоса шире и плотнее на ходу и у носа
        vec2 rB = vWXZ - uPivot; float bf = dot(rB, uBoatFwd), bs = dot(rB, vec2(-uBoatFwd.y, uBoatFwd.x));
        float hw = bf > -0.6 ? 0.66 * sqrt(max(0.0, 1.0 - pow(clamp((bf + 0.6) / 2.75, 0.0, 1.0), 2.2))) : 0.66 - 0.16 * pow((-0.6 - bf) / 1.5, 2.0);
        float dH = max(abs(bs) - hw, max(-2.12 - bf, bf - 2.16));
        float bowK = smoothstep(-0.6, 1.9, bf), washK = uBoatWash * (0.22 + 0.78 * bowK) * smoothstep(-2.3, -1.5, bf);
        float band = 0.03 + 0.17 * washK;
        float wl = smoothstep(-0.12, -0.01, dH) * (1.0 - smoothstep(band * 0.25, band, dH));
        float nW = texture2D(normalMap, vWXZ * 1.3 + 0.3).r * 0.6 + nC * 0.4;
        float foamW = wl * smoothstep(0.80 - 0.50 * washK, 0.92 - 0.42 * washK, nW + 0.30 * (1.0 - clamp(dH / band, 0.0, 1.0)));
        foamE = max(foamE, foamW * 0.9);
        // толща воды: отвесно — тёмная синева, гребни просвечивают бирюзой, сильнее против солнца
        vec3 vdirW = normalize(vViewPosition);
        float ndv = clamp(dot(normalize(vNormal), vdirW), 0.0, 1.0);
        fresW = pow(1.0 - ndv, 4.0);
        float sunBack = 0.5;
        #if NUM_DIR_LIGHTS > 0
          sunBack = clamp(0.35 + 0.65 * dot(-vdirW, directionalLights[0].direction), 0.0, 1.0);
        #endif
        float sss = smoothstep(0.55, 1.0, vWave) * (0.2 + 0.8 * sunBack) * smoothstep(0.03, 0.14, uAmpTotalF);
        vec3 body = mix(uDeep, uScatter, clamp(0.05 + 0.22 * sss, 0.0, 1.0));
        body *= 1.0 - 0.36 * gP; body *= 1.0 + 0.14 * gL;
        diffuseColor.rgb = mix(body, vec3(0.93, 0.96, 0.98), foamE);
        diffuseColor.a = clamp(mix(0.80, 0.99, fresW * 2.5) + foamE, 0.0, 1.0);`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        // второй слой: мелкая рябь идёт под углом к крупной и быстрее — от неё блики рассыпаются искрами
        vec2 uvD = vec2(vNormalMapUv.x * 0.80 - vNormalMapUv.y * 0.60, vNormalMapUv.x * 0.60 + vNormalMapUv.y * 0.80) * 4.3 + uRipple;
        vec3 mapD = texture2D( normalMap, uvD ).xyz * 2.0 - 1.0;
        mapN = normalize(vec3(mapN.xy + mapD.xy * (0.9 + 0.6 * gP - 0.4 * gL), mapN.z));`))
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.30 * gP - 0.08 * gL + 0.6 * foamE, 0.04, 1.0);`)
      // солнечная дорожка: с настоящими уклонами волн блик широкий — ограничиваем, чтобы не выгорал в белое
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular = min(reflectedLight.directSpecular * 0.22, vec3(0.9));`)
      // вода в основном отражает небо, поэтому пятно порыва затемняем уже после расчёта света
      .replace('#include <opaque_fragment>', `
        // небо в ряби: грани, отвёрнутые от зрителя, светлеют. К горизонту вода уходит в цвет неба.
        float sheen = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += vec3(0.26, 0.42, 0.62) * sheen * 0.5 * (1.0 - foamE);
        outgoingLight *= (1.0 - 0.30 * gP * (1.0 - foamE)) * (1.0 + 0.10 * gL);
        if (uReflectOn > 0.5) {
          // отражение лодки: картинка из зеркальной камеры, смещённая рябью
          // чем сильнее волнение, тем сильнее отражение рвётся рябью и тем оно слабее
          float chop = smoothstep(0.02, 0.16, uAmpTotalF);
          vec2 ruv = vRefl.xy / vRefl.w, rd = normal.xy * (0.05 + 0.10 * chop);
          vec4 rc = 0.5 * (texture2D(tReflect, ruv + rd) + texture2D(tReflect, ruv + rd * vec2(-0.6, 1.7) + vec2(0.0, 0.004)));
          outgoingLight = mix(outgoingLight, rc.rgb, rc.a * (0.20 + 0.55 * fresW) * (1.0 - 0.7 * chop) * (1.0 - foamE) * (1.0 - 0.5 * gP));
        }
        #include <opaque_fragment>`)
      .replace('uniform float uGustOn, uWhitecap,', 'uniform float uAmpTotalF; uniform float uGustOn, uWhitecap,');
    sh.uniforms.uAmpTotalF = env.uniforms.uAmpTotal;
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.uniforms = U;
  mesh.userData.update = (t, bx, bz, windDir) => {
    mesh.position.set(bx, 0, bz);
    const wx = Math.sin(windDir), wz = -Math.cos(windDir);
    nmap.offset.set(bx / TILE + wx * t * 0.045, -bz / TILE - wz * t * 0.045);
    // мелкую рябь несёт ветром быстрее; сдвиг берётся по модулю, чтобы не терять точность
    const k = t * 0.19; U.uRipple.value.set((wx * 0.8 + wz * 0.6) * k % 1, (-wz * 0.8 + wx * 0.6) * k % 1);
  };
  return mesh;
}

// ---------- брызги из-под носа ----------
// Капли летят по баллистике, их сносит ветром. Больше всего брызг, когда нос врезается в волну на ходу.
export function makeSpray(env, n = 420) {
  const pos = new Float32Array(n * 3), aux = new Float32Array(n * 2), vel = new Float32Array(n * 3), life = new Float32Array(n), span = new Float32Array(n), size = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aux', new THREE.BufferAttribute(aux, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute vec2 aux; uniform float uScale; varying float vA;
      void main(){ vA = aux.x; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, aux.y * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = vA * (1.0 - smoothstep(0.25, 1.0, d)); if (a < 0.01) discard; gl_FragColor = vec4(0.95, 0.975, 1.0, a); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  let next = 0, acc = 0, alive = 0;
  const rnd = Math.random;
  // e: { x, z, fx, fz, sx, sz, vx, vz — лодка; wx, wz — ветер, м/с; heave, sf — плоскость воды под лодкой; speed — ход, м/с }
  pts.userData.update = (dt, e, pxScale) => {
    mat.uniforms.uScale.value = pxScale;
    if (dt > 0 && e) {
      const bowX = e.x + e.fx * 2.0, bowZ = e.z + e.fz * 2.0, bowY = e.heave + e.sf * 2.0;
      const slam = Math.max(0, env.heightAt(bowX, bowZ) - bowY - 0.02);          // волна выше носа: удар
      const rate = Math.max(0, e.speed - 2.3) * 55 + slam * e.speed * 1300;
      acc = Math.min(70, acc + rate * dt);
      const power = Math.min(1.6, 0.35 + e.speed * 0.14 + slam * 6);
      while (acc >= 1) {
        acc -= 1;
        const k = next; next = (next + 1) % n;
        const sd = rnd() < 0.5 ? -1 : 1, back = rnd() * 0.5, out = (0.5 + rnd() * 1.6) * power;
        pos[k * 3] = bowX - e.fx * back + e.sx * sd * (0.05 + back * 0.3); pos[k * 3 + 1] = bowY + 0.05 + rnd() * 0.1; pos[k * 3 + 2] = bowZ - e.fz * back + e.sz * sd * (0.05 + back * 0.3);
        vel[k * 3] = e.vx * 0.55 + e.sx * sd * out + e.fx * (rnd() - 0.3) * 0.8;
        vel[k * 3 + 1] = (0.9 + rnd() * 2.3) * power;
        vel[k * 3 + 2] = e.vz * 0.55 + e.sz * sd * out + e.fz * (rnd() - 0.3) * 0.8;
        span[k] = life[k] = 0.5 + rnd() * 0.6; size[k] = 0.016 + rnd() * rnd() * 0.05;
      }
    }
    alive = 0;
    for (let k = 0; k < n; k++) {
      if (life[k] <= 0) { aux[k * 2] = 0; continue; }
      if (dt > 0) {
        const o = k * 3, drag = Math.min(1, dt * 1.3);
        vel[o] += ((e ? e.wx : 0) - vel[o]) * drag; vel[o + 2] += ((e ? e.wz : 0) - vel[o + 2]) * drag; vel[o + 1] -= 9.81 * dt;
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
        life[k] -= dt;
        if (vel[o + 1] < 0 && pos[o + 1] < env.heightAt(pos[o], pos[o + 2]) - 0.02) life[k] = 0;
      }
      const f = Math.max(0, life[k] / span[k]);
      aux[k * 2] = Math.min(1, f * 2.2) * 0.6; aux[k * 2 + 1] = size[k] * (1.8 - 0.8 * f);
      alive++;
    }
    pts.visible = alive > 0;
    geo.attributes.position.needsUpdate = true; geo.attributes.aux.needsUpdate = true;
  };
  pts.userData.clear = () => { life.fill(0); acc = 0; };
  return pts;
}

// ---------- отражение лодки в воде ----------
// Зеркальная камера под водой рисует только лодку (слой 1) в небольшую текстуру; вода подмешивает её по Френелю.
export function makeBoatReflection(size = 512) {
  const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(1);
  const matrix = new THREE.Matrix4();
  const N = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), C = new THREE.Vector3(), V = new THREE.Vector3(), L = new THREE.Vector3(), T = new THREE.Vector3(), R = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), clear = new THREE.Color();
  // (px, h0, pz) — точка на поверхности воды у лодки. Возвращает false, если камера под водой.
  function render(renderer, scene, camera, px, h0, pz) {
    P.set(px, h0, pz); C.setFromMatrixPosition(camera.matrixWorld);
    V.subVectors(P, C); if (V.dot(N) > 0) return false;
    V.reflect(N).negate().add(P);
    R.extractRotation(camera.matrixWorld);
    L.set(0, 0, -1).applyMatrix4(R).add(C);
    T.subVectors(P, L).reflect(N).negate().add(P);
    cam.position.copy(V); cam.up.set(0, 1, 0).applyMatrix4(R).reflect(N); cam.lookAt(T);
    cam.far = camera.far; cam.updateMatrixWorld(); cam.projectionMatrix.copy(camera.projectionMatrix);
    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // ближняя плоскость отсечения совмещается с водой: подводная часть лодки в отражение не попадает
    plane.setFromNormalAndCoplanarPoint(N, P).applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pe = cam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pe[8]) / pe[0]; q.y = (Math.sign(clip.y) + pe[9]) / pe[5]; q.z = -1; q.w = (1 + pe[10]) / pe[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pe[2] = clip.x; pe[6] = clip.y; pe[10] = clip.z + 1 - 0.003; pe[14] = clip.w;
    const rt = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate, alpha = renderer.getClearAlpha(), fog = scene.fog;
    renderer.getClearColor(clear);
    renderer.shadowMap.autoUpdate = false; scene.fog = null;
    renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(rt); renderer.setClearColor(clear, alpha); renderer.shadowMap.autoUpdate = auto; scene.fog = fog;
    return true;
  }
  return { target, matrix, render };
}

// ---------- текстовые спрайты ----------
export function makeTextSprite(text, { color = '#ffffff', bg = 'rgba(12,12,12,0.85)', size = 44, scale = 1 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `600 ${size}px Inter, Arial, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = size + 28;
  g.font = `600 ${size}px Inter, Arial, sans-serif`;
  g.fillStyle = bg;
  const r = 16; g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  const k = 0.012 * scale;
  sp.scale.set(c.width * k, c.height * k, 1);
  sp.userData.baseScale = sp.scale.clone();
  sp.renderOrder = 10;
  return sp;
}
// масштаб всех текстовых спрайтов внутри объекта (для узких экранов)
export function setLabelScale(obj, k) {
  obj.traverse((o) => { if (o.isSprite && o.userData.baseScale) o.scale.copy(o.userData.baseScale).multiplyScalar(k); });
}

// ---------- компасное кольцо на воде ----------
// Все плоские элементы лежат на волнах: геометрия в плоскости XZ, вершины поднимаются по той же формуле, что и вода.
const flatMat = (color, opacity, env, lift) => floatOnWaves(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }), env, lift);
export function makeCompassRing(env) {
  const g = new THREE.Group();
  const R = 3.6, LIFT = 0.07;
  const ringGeo = new THREE.RingGeometry(R - 0.12, R, 160); ringGeo.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(ringGeo, flatMat('#ffffff', 0.6, env, LIFT)));
  // риски каждые 10°
  const tickPts = [];
  for (let b = 0; b < 360; b += 10) {
    const a = (90 - b) * DEG, len = b % 90 === 0 ? 0.45 : b % 30 === 0 ? 0.3 : 0.15;
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12), 0, -Math.sin(a) * (R - 0.12)));
    tickPts.push(new THREE.Vector3(Math.cos(a) * (R - 0.12 - len), 0, -Math.sin(a) * (R - 0.12 - len)));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), floatOnWaves(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }), env, LIFT)));
  const names = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]];
  const labels = [];
  for (const [n, b] of names) {
    const sp = makeTextSprite(n, { size: 56, bg: 'rgba(12,12,12,0.7)', scale: 0.45 });
    const a = (90 - b) * DEG;
    sp.position.set(Math.cos(a) * (R + 0.45), 0.3, -Math.sin(a) * (R + 0.45));
    g.add(sp); labels.push(sp);
  }
  // мёртвая зона — сектор ±42°
  const wedgeGeo = new THREE.RingGeometry(0.15, R - 0.15, 40, 10, -42 * DEG, 84 * DEG); wedgeGeo.rotateX(-Math.PI / 2);
  const wedge = new THREE.Mesh(wedgeGeo, flatMat('#ff3b30', 0.22, env, LIFT - 0.01));
  const wedgeG = new THREE.Group(); wedgeG.add(wedge);
  const wedgeLabel = makeTextSprite('МЁРТВАЯ ЗОНА', { color: '#ffffff', size: 36, scale: 0.45 });
  wedgeLabel.position.set(R * 0.7, 0.25, 0); wedgeG.add(wedgeLabel);
  g.add(wedgeG);
  // стрелка ветра на кольце (остриём к центру)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(-0.9, 0.5); shape.lineTo(-0.9, 0.18); shape.lineTo(-2.4, 0.18); shape.lineTo(-2.4, -0.18); shape.lineTo(-0.9, -0.18); shape.lineTo(-0.9, -0.5); shape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(shape); arrowGeo.rotateZ(Math.PI); arrowGeo.rotateX(-Math.PI / 2); arrowGeo.translate(R + 0.25, 0, 0);
  const arrowG = new THREE.Group(); arrowG.add(new THREE.Mesh(arrowGeo, flatMat('#0047ff', 0.9, env, LIFT + 0.08)));
  const windLabel = makeTextSprite('ВЕТЕР', { color: '#ffffff', bg: 'rgba(0,71,255,0.9)', size: 44, scale: 0.4 });
  windLabel.position.set(R + 3.1, 0.35, 0); arrowG.add(windLabel);
  g.add(arrowG);

  g.userData.update = (bx, bz, windFromDeg) => {
    g.position.x = bx; g.position.z = bz;
    // направление «откуда» — ветер в мировых координатах: bearing b → (sin b, -cos b); в плоскости XZ угол вокруг y: rotation.y = π/2 - b
    const rot = Math.PI / 2 - windFromDeg * DEG;
    wedgeG.rotation.y = rot;
    arrowG.rotation.y = rot;
    g.position.y = env.ampTotal * 0.5;      // подписи приподнимаются вместе с волнением
  };
  g.userData.setNoGo = (v) => { wedgeG.visible = v; };
  // вблизи (вид из кокпита) подписи на воде закрывают обзор
  g.userData.setNearLabels = (v) => { wedgeLabel.visible = v; windLabel.visible = v; };
  return g;
}

// ---------- объёмная стрелка вектора с подписью ----------
const _unitY = new THREE.Vector3(0, 1, 0), _arrowDir = new THREE.Vector3();
export class VectorArrow {
  constructor(scene, color, label) {
    this.color = color;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, emissive: color, emissiveIntensity: 0.12, transparent: true, opacity: 0.92 });
    this.group = new THREE.Group();
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), mat);   // масштабируется
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24), mat);
    this.group.add(this.shaft); this.group.add(this.head);
    scene.add(this.group);
    this.canvas = document.createElement("canvas"); this.canvas.width = 420; this.canvas.height = 72;
    this.ctx = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.label.scale.set(420 * 0.0062, 72 * 0.0062, 1); this.label.userData.baseScale = this.label.scale.clone(); this.label.renderOrder = 10;
    this.labelAt = 0.5; this.labelLift = 0.35; this.labelScale = 1;
    this._text = null; this._since = 1;
    scene.add(this.label);
    this.visible = true; this.showLabel = true;
    this.draw(label);
  }
  draw(text) {
    const g = this.ctx, c = this.canvas;
    g.clearRect(0, 0, c.width, c.height);
    g.font = "600 38px Inter, Arial, sans-serif";
    const w = Math.min(c.width, Math.ceil(g.measureText(text).width) + 34);
    g.fillStyle = this.color; g.globalAlpha = 0.9;
    g.beginPath(); g.roundRect((c.width - w) / 2, 4, w, 64, 14); g.fill();
    const rgb = this.color.match(/\d+/g).map(Number); const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    g.globalAlpha = 1; g.fillStyle = lum > 0.6 ? "#111111" : "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 38);
    this.tex.needsUpdate = true; this._text = text;
  }
  // from → to (мировые координаты)
  set(from, to, text, dt = 0, thickness = 1) {
    const dir = _arrowDir.copy(to).sub(from); const len = dir.length();
    if (len < 0.25 || !this.visible) { this.group.visible = false; this.label.visible = false; return; }
    this.group.visible = true; this.label.visible = this.showLabel;
    dir.normalize();
    const r = 0.018 * thickness, headLen = Math.min(0.42, len * 0.3), headR = 0.065 * thickness;
    this.group.position.copy(from);
    this.group.quaternion.setFromUnitVectors(_unitY, dir);
    const shaftLen = len - headLen;
    this.shaft.scale.set(r, shaftLen, r); this.shaft.position.y = shaftLen / 2;
    this.head.scale.set(headR, headLen, headR); this.head.position.y = shaftLen + headLen / 2;
    this.label.position.copy(from).lerp(to, this.labelAt); this.label.position.y += this.labelLift * this.labelScale;
    this._since += dt;
    if (text && text !== this._text && this._since > 0.25) { this._since = 0; this.draw(text); }
  }
  setLabelScale(k) { this.labelScale = k; this.label.scale.copy(this.label.userData.baseScale).multiplyScalar(k); }
  setVisible(v, labels = true) { this.visible = v; this.showLabel = labels; if (!v) { this.group.visible = false; this.label.visible = false; } }
}

// ---------- струи ветра ----------
export function makeWindStreaks(count = 220) {
  const pos = new Float32Array(count * 2 * 3);
  const col = new Float32Array(count * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  const pts = [];
  const BOX = 34;
  for (let i = 0; i < count; i++) pts.push({ x: (Math.random() - .5) * 2 * BOX, y: 0.4 + Math.random() * 7, z: (Math.random() - .5) * 2 * BOX, ph: Math.random() * 10 });
  for (let i = 0; i < count; i++) { col.set([1, 1, 1], i * 6); col.set([0.6, 0.78, 0.95], i * 6 + 3); }
  lines.userData.update = (dt, bx, bz, Wx, Wz, speedKn) => {
    const len = 0.9 + speedKn * 0.16;
    const spd = Math.hypot(Wx, Wz) || 0.0001; const ux = Wx / spd, uz = Wz / spd;
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      p.x += Wx * dt * 1.1; p.z += Wz * dt * 1.1;
      let rx = p.x - bx, rz = p.z - bz;
      if (rx > BOX) { p.x -= 2 * BOX; p.z = bz + (Math.random() - .5) * 2 * BOX; } else if (rx < -BOX) { p.x += 2 * BOX; p.z = bz + (Math.random() - .5) * 2 * BOX; }
      if (rz > BOX) { p.z -= 2 * BOX; p.x = bx + (Math.random() - .5) * 2 * BOX; } else if (rz < -BOX) { p.z += 2 * BOX; p.x = bx + (Math.random() - .5) * 2 * BOX; }
      const w = Math.sin(p.ph + p.x * 0.3) * 0.15;
      pos[i * 6] = p.x; pos[i * 6 + 1] = p.y + w; pos[i * 6 + 2] = p.z;
      pos[i * 6 + 3] = p.x - ux * len; pos[i * 6 + 4] = p.y + w; pos[i * 6 + 5] = p.z - uz * len;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return lines;
}

// ---------- след на воде: кильватерная струя и усы от носа ----------
function makeFoamTexture() {
  // полупрозрачная пена: вытянутые вдоль хода струйки, между ними вода
  const W = 256, H = 32, rnd = rng(21);
  const acc = new Float32Array(W * H);
  for (let i = 0; i < 150; i++) {
    const bx = rnd() * W, by = 3 + rnd() * (H - 6), rx = 5 + rnd() * 22, ry = 0.9 + rnd() * 2.6, g = 0.35 + rnd() * 0.6;
    for (let y = Math.max(0, Math.floor(by - ry)); y <= Math.min(H - 1, Math.ceil(by + ry)); y++) for (let q = Math.floor(bx - rx); q <= Math.ceil(bx + rx); q++) {
      const x = ((q % W) + W) % W, d = Math.hypot((q - bx) / rx, (y - by) / ry); if (d < 1) acc[y * W + x] += g * (1 - d * d);
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = Math.sin(Math.PI * (y + 0.5) / H);
    const k = (y * W + x) * 4; data[k] = 255; data[k + 1] = 255; data[k + 2] = 255; data[k + 3] = Math.round(255 * Math.min(1, 0.07 + acc[y * W + x] * 0.8) * edge * edge);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
// Лента из точек следа: новые точки добавляются по мере хода, старые расплываются и гаснут
class Ribbon {
  constructor(n, material, { life, w0, w1, spacing }) {
    this.n = n; this.life = life; this.w0 = w0; this.w1 = w1; this.spacing = spacing;
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n).fill(1e9); this.str = new Float32Array(n); this.u = new Float32Array(n);
    this.head = 0; this.count = 0; this.dist = 0;
    this.pos = new Float32Array(n * 2 * 3); this.uv = new Float32Array(n * 2 * 2); this.col = new Float32Array(n * 2 * 4).fill(1);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  idx(i) { return (this.head - 1 - i + this.n * 2) % this.n; }   // i = 0 — самая свежая точка
  // источник следа в точке (x, z); точки расходятся со скоростью (vx, vz)
  track(x, z, vx, vz, strength) {
    // самая свежая точка «живая» и идёт вместе с источником; когда источник уходит от последней
    // закреплённой точки дальше шага, живая закрепляется и начинает стареть, а за источником идёт новая
    const push = () => {
      const k = this.head; this.head = (this.head + 1) % this.n; this.count = Math.min(this.n, this.count + 1);
      this.px[k] = x; this.pz[k] = z; this.vx[k] = vx; this.vz[k] = vz; this.age[k] = 0; this.str[k] = strength; this.u[k] = this.dist * 0.2;
    };
    if (this.count === 0) { this.ax = x; this.az = z; push(); return; }
    const k0 = this.idx(0), d = Math.hypot(x - this.ax, z - this.az);
    this.px[k0] = x; this.pz[k0] = z; this.age[k0] = 0; this.str[k0] = strength; this.vx[k0] = vx; this.vz[k0] = vz; this.u[k0] = (this.dist + d) * 0.2;
    if (d > this.spacing) { this.dist += d; this.ax = x; this.az = z; push(); }
  }
  update(dt) {
    const { n, pos, uv, col } = this;
    const damp = Math.exp(-dt * 1.1);
    for (let i = 1; i < this.count; i++) { const k = this.idx(i); this.age[k] += dt; this.px[k] += this.vx[k] * dt; this.pz[k] += this.vz[k] * dt; this.vx[k] *= damp; this.vz[k] *= damp; }
    for (let i = 0; i < n; i++) {
      const live = i < this.count, k = this.idx(live ? i : Math.max(0, this.count - 1));
      const kp = this.idx(Math.max(0, Math.min(this.count - 1, i - 1))), kn = this.idx(Math.max(0, Math.min(this.count - 1, i + 1)));
      let tx = this.px[kp] - this.px[kn], tz = this.pz[kp] - this.pz[kn]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const f = Math.min(1, this.age[k] / this.life);
      const w = (this.w0 + (this.w1 - this.w0) * Math.sqrt(f)) * 0.5;
      const a = live && this.count > 1 ? this.str[k] * (1 - f) * (1 - f) * Math.min(1, i * 0.6 + 0.25) : 0;
      const o = i * 6, x = this.px[k], z = this.pz[k];
      pos[o] = x - tz * w; pos[o + 2] = z + tx * w; pos[o + 3] = x + tz * w; pos[o + 5] = z - tx * w;
      uv[i * 4] = this.u[k]; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = this.u[k]; uv[i * 4 + 3] = 1;
      col[i * 8 + 3] = a; col[i * 8 + 7] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
  clear() { this.count = 0; this.age.fill(1e9); }
}
export function makeWake(env) {
  const g = new THREE.Group();
  const foam = makeFoamTexture();
  const mat = () => floatOnWaves(new THREE.MeshBasicMaterial({ color: '#ffffff', map: foam, transparent: true, depthWrite: false, vertexColors: true, side: THREE.DoubleSide }), env, 0.06);
  const stern = new Ribbon(72, mat(), { life: 7, w0: 0.45, w1: 2.6, spacing: 0.35 });
  const bowL = new Ribbon(30, mat(), { life: 2.6, w0: 0.16, w1: 0.9, spacing: 0.3 });
  const bowR = new Ribbon(30, mat(), { life: 2.6, w0: 0.16, w1: 0.9, spacing: 0.3 });
  for (const r of [stern, bowL, bowR]) g.add(r.mesh);
  let lastX = null, lastZ = null;
  // (x, z) — лодка; (fx, fz) — нос, (sx, sz) — правый борт; speed — ход, м/с
  g.userData.update = (dt, x, z, fx, fz, sx, sz, speed) => {
    if (lastX !== null && Math.hypot(x - lastX, z - lastZ) > 5) { stern.clear(); bowL.clear(); bowR.clear(); }  // лодку переставили
    lastX = x; lastZ = z;
    if (dt > 0) {
      const sS = Math.min(1, Math.max(0, (speed - 0.3) / 2.0)) * 0.8;
      const sB = Math.min(1, Math.max(0, (speed - 0.9) / 2.0)) * 1.0;
      stern.track(x - fx * 2.0, z - fz * 2.0, 0, 0, sS);
      const out = 0.34 * speed;      // усы расходятся под углом Кельвина (~19°)
      bowL.track(x + fx * 1.55 - sx * 0.28, z + fz * 1.55 - sz * 0.28, -sx * out, -sz * out, sB);
      bowR.track(x + fx * 1.55 + sx * 0.28, z + fz * 1.55 + sz * 0.28, sx * out, sz * out, sB);
      stern.update(dt); bowL.update(dt); bowR.update(dt);
    }
  };
  return g;
}
