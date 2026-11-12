// Шейдеры: небо, волны, океан, симуляция пены. Общие куски (небо и волны) подставляются в несколько программ:
// океан отражает ровно то небо, которое нарисовано, и качает лодку на тех же волнах.
import { NW } from '../env.js';

// ---------- небо ----------
// Цвет неба в направлении d. Рассчитан в линейном пространстве, яркость солнца выше единицы:
// дальше кадр проходит тональную компрессию и свечение.
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHaze;
uniform vec3 uCloudP;                 // сдвиг облаков по xz и покрытие 0..1
uniform sampler2D uNoise;
float cloudAt(vec3 d) {
  if (d.y < 0.03 || uCloudP.z <= 0.0) return 0.0;
  vec2 p = d.xz / (d.y + 0.22) * 0.16 + uCloudP.xy;
  float n = texture2D(uNoise, p).r * 0.56 + texture2D(uNoise, p * 2.3 + 0.37).g * 0.28 + texture2D(uNoise, p * 5.3 + 0.11).b * 0.16;
  float lo = 1.0 - uCloudP.z;
  return smoothstep(lo, lo + 0.2, n) * smoothstep(0.03, 0.16, d.y);
}
vec3 skyColor(vec3 d, float sunDisc, float cloudK) {
  float h = max(d.y, 0.0), mu = dot(d, uSunDir), mp = max(mu, 0.0);
  vec3 c = mix(uZenith, uHorizon, pow(1.0 - h, 3.2));
  c *= 0.9 + 0.12 * mu * mu;                                       // под 90° к солнцу небо глубже
  c += uSunCol * (0.03 * pow(mp, 6.0) + 0.09 * pow(mp, 40.0));     // ореол вокруг солнца
  c = mix(c, uHaze, pow(1.0 - h, 12.0) * 0.85);                    // дымка у горизонта
  float cl = cloudAt(d);
  if (cl > 0.0) {
    vec3 cc = (uHorizon * 0.55 + uSunCol * 0.22 + 0.2) * (0.85 + 0.6 * pow(mp, 3.0));
    c = mix(c, cc, cl * 0.92 * cloudK);
  }
  c += uSunCol * 16.0 * smoothstep(0.99955, 0.99985, mu) * sunDisc * (1.0 - cl);
  return c;
}
`;
export const SKY_UNIFORMS = ['uSunDir', 'uSunCol', 'uZenith', 'uHorizon', 'uHaze', 'uCloudP'];

export const SKY_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
uniform mat4 world; uniform mat4 viewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = viewProjection * world * vec4(position, 1.0); }
`;
export const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uDeepFar;
${SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d, 1.0, 1.0);
  // ниже горизонта: цвет дальней воды, чтобы за краем сетки океана не было шва
  c = mix(c, mix(uHaze, uDeepFar, smoothstep(0.0, -0.3, d.y)), smoothstep(0.0, -0.004, d.y));
  gl_FragColor = vec4(c, 1.0);
}
`;

// ---------- волны ----------
export const WAVE_GLSL = /* glsl */`
#define NW ${NW}
uniform vec2 uWaveDir[NW];
uniform vec4 uWaveP[NW];              // волновое число, амплитуда, горизонтальная амплитуда, фаза
uniform vec2 uWaveFade[NW];
uniform vec2 uPivot;
uniform vec2 uBoatFwd; uniform vec3 uBoatPlane; uniform float uBoatMask;
// под корпусом вода прижата к плоскости лодки: m — насколько, hp — высота плоскости
float boatMask(vec2 r, out float hp) {
  float bf = dot(r, uBoatFwd), bs = dot(r, vec2(-uBoatFwd.y, uBoatFwd.x));
  float e = length(vec2(bf / 2.45, bs / 0.95));
  hp = uBoatPlane.x + uBoatPlane.y * bf + uBoatPlane.z * bs;
  return uBoatMask * (1.0 - smoothstep(0.7, 1.25, e));
}
// смещение точки поверхности (для вершин)
vec3 waveDisp(vec2 p) {
  vec2 r = p - uPivot; float d = length(r); vec3 o = vec3(0.0);
  for (int i = 0; i < NW; i++) {
    float f = 1.0 - smoothstep(uWaveFade[i].x, uWaveFade[i].y, d);
    float th = uWaveP[i].x * dot(uWaveDir[i], r) + uWaveP[i].w;
    o.xz += uWaveDir[i] * (uWaveP[i].z * f * cos(th));
    o.y += uWaveP[i].y * f * sin(th);
  }
  float hp; float m = boatMask(r, hp);
  o.xz *= 1.0 - m; o.y = mix(o.y, hp, m);
  return o;
}
// высота, нормаль и якобиан (меньше единицы там, где поверхность сжата: на гребнях; по нему ложится пена)
void waveFull(vec2 p, out float height, out vec3 nrm, out float jac) {
  vec2 r = p - uPivot; float d = length(r);
  float y = 0.0; vec2 gy = vec2(0.0); float jxx = 0.0, jzz = 0.0, jxz = 0.0;
  for (int i = 0; i < NW; i++) {
    float f = 1.0 - smoothstep(uWaveFade[i].x, uWaveFade[i].y, d);
    float th = uWaveP[i].x * dot(uWaveDir[i], r) + uWaveP[i].w;
    float s = sin(th), c = cos(th), ka = uWaveP[i].x * uWaveP[i].y * f, kh = uWaveP[i].x * uWaveP[i].z * f;
    y += uWaveP[i].y * f * s;
    gy += uWaveDir[i] * (ka * c);
    jxx += kh * uWaveDir[i].x * uWaveDir[i].x * s; jzz += kh * uWaveDir[i].y * uWaveDir[i].y * s; jxz += kh * uWaveDir[i].x * uWaveDir[i].y * s;
  }
  vec3 tx = vec3(1.0 - jxx, gy.x, -jxz), tz = vec3(-jxz, gy.y, 1.0 - jzz);
  nrm = normalize(cross(tz, tx));
  jac = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  float hp; float m = boatMask(r, hp);
  vec3 pn = normalize(vec3(-(uBoatPlane.y * uBoatFwd.x - uBoatPlane.z * uBoatFwd.y), 1.0, -(uBoatPlane.y * uBoatFwd.y + uBoatPlane.z * uBoatFwd.x)));
  height = mix(y, hp, m); nrm = normalize(mix(nrm, pn, m)); jac = mix(jac, 1.0, m);
}
uniform vec2 uGustQ[3]; uniform vec2 uGustP[3];
float gustV(vec2 p) { vec2 r = p - uPivot; float g = 0.0; for (int i = 0; i < 3; i++) g += uGustP[i].x * sin(dot(uGustQ[i], r) + uGustP[i].y); return g; }
`;
export const WAVE_UNIFORMS = ['uWaveDir', 'uWaveP', 'uWaveFade', 'uPivot', 'uBoatFwd', 'uBoatPlane', 'uBoatMask', 'uGustQ', 'uGustP'];

// ---------- океан ----------
export const OCEAN_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
uniform mat4 world; uniform mat4 viewProjection;
varying vec2 vP0; varying vec3 vW;
${WAVE_GLSL}
void main() {
  vec4 w = world * vec4(position, 1.0);
  vP0 = w.xz;
  vec3 d = waveDisp(vP0);
  vW = vec3(vP0.x + d.x, d.y, vP0.y + d.z);
  gl_Position = viewProjection * vec4(vW, 1.0);
}
`;
export const OCEAN_FRAG = /* glsl */`
precision highp float;
varying vec2 vP0; varying vec3 vW;
uniform vec3 uCam; uniform vec2 uScreen;
uniform sampler2D uNormalTex; uniform sampler2D uFoamTex; uniform sampler2D uMirror; uniform sampler2D uShadowMask;
uniform vec4 uRipple;                 // сдвиги двух слоёв ряби
uniform vec4 uRipB; uniform vec4 uRipC;       // сдвиги третьего слоя ряби и шумов пены: все узоры стоят на воде, а не едут с лодкой
uniform float uDriftT;                // на сколько метров ветер снёс то, что плавает на поверхности
uniform vec4 uFoamWin;                // центр окна пены, размер, включено
uniform mat4 uShadowM; uniform vec4 uFx;      // тень на воде, отражение лодки, переворот отражения, переворот тени
uniform vec4 uSea;                    // барашки, порывы включены, ветер в узлах, суммарная амплитуда
uniform vec3 uDeep; uniform vec3 uScatter;
uniform vec4 uCompass;                // лодка xz, радиус кольца, непрозрачность
uniform vec4 uWindMark;               // откуда ветер (единичный xz), мёртвая зона видна, стрелка видна
uniform vec4 uMarks[4]; uniform vec4 uMarkCol[4];
uniform vec4 uLine; uniform float uLineA;       // финишная линия: два конца и непрозрачность
${SKY_GLSL}
${WAVE_GLSL}
void main() {
  float hgt; vec3 n; float jac; waveFull(vP0, hgt, n, jac);
  vec3 toCam = uCam - vW; float dist = length(toCam); vec3 V = toCam / dist;
  vec2 r = vW.xz - uPivot;
  float gv = gustV(vW.xz);
  float gP = smoothstep(0.12, 0.55, gv) * uSea.y, gL = smoothstep(0.15, 0.6, -gv) * uSea.y;

  // мелкая рябь: два слоя карты нормалей под углом друг к другу, едут по ветру с разной скоростью
  vec2 q2 = vec2(r.x * 0.8 - r.y * 0.6, r.x * 0.6 + r.y * 0.8);
  vec3 d1 = texture2D(uNormalTex, r * 0.105 + uRipple.xy).xyz * 2.0 - 1.0;
  vec3 d2 = texture2D(uNormalTex, q2 * 0.41 + uRipple.zw).xyz * 2.0 - 1.0;
  // кильватерный след: значение из текстуры пены нужно раньше всего остального, по нему гладится рябь
  float wake = 0.0;
  if (uFoamWin.w > 0.5) {
    vec2 fw = (vW.xz - uFoamWin.xy) / uFoamWin.z + 0.5;
    if (fw.x > 0.0 && fw.x < 1.0 && fw.y > 0.0 && fw.y < 1.0) wake = texture2D(uFoamTex, fw).r;
  }
  float trail = smoothstep(0.015, 0.2, wake);                      // взбаламученная вода за кормой: гладкая и светлая
  float rip = (0.2 + 0.75 * smoothstep(1.0, 16.0, uSea.z)) * (1.0 + 0.7 * gP - 0.55 * gL) * (1.0 - 0.72 * trail);
  vec3 d3 = texture2D(uNormalTex, vec2(r.y, -r.x) * 1.37 + uRipB.xy).xyz * 2.0 - 1.0;
  float near = 1.0 / (1.0 + dist * 0.06);
  vec2 dn = (d1.xy * 0.6 + d2.xy * 0.52 + d3.xy * 0.34 * near) * rip;
  n = normalize(vec3(n.x + dn.x, n.y, n.z + dn.y));

  float ndv = max(dot(n, V), 0.02);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // тень лодки и паруса на воде: маска, снятая из положения солнца
  float shade = 0.0;
  if (uFx.x > 0.5) {
    vec4 sp = uShadowM * vec4(vW, 1.0); vec2 su = sp.xy / sp.w * 0.5 + 0.5; su.y = mix(su.y, 1.0 - su.y, uFx.w);
    if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
      float e = 1.6 / 512.0;
      shade = 0.25 * (texture2D(uShadowMask, su + vec2(e, e)).a + texture2D(uShadowMask, su + vec2(-e, e)).a + texture2D(uShadowMask, su + vec2(e, -e)).a + texture2D(uShadowMask, su + vec2(-e, -e)).a);
      shade *= smoothstep(0.0, 0.06, su.x) * smoothstep(1.0, 0.94, su.x) * smoothstep(0.0, 0.06, su.y) * smoothstep(1.0, 0.94, su.y);
    }
  }
  float lit = 1.0 - shade;

  // отражение неба; пологие лучи не уходят под горизонт
  vec3 R = reflect(-V, n); R.y = abs(R.y) * 0.92 + 0.015; R = normalize(R);
  vec3 refl = skyColor(R, 0.0, 0.35);
  float chop = smoothstep(0.03, 0.22, uSea.w);
  if (uFx.y > 0.5) {
    // отражение лодки: зеркальный кадр, смещённый рябью; на волнении оно рвётся и слабеет
    vec2 mu = gl_FragCoord.xy / uScreen; mu.y = mix(mu.y, 1.0 - mu.y, uFx.z); mu += n.xz * (0.03 + 0.07 * chop);
    vec4 mc = texture2D(uMirror, mu);
    refl = mix(refl, mc.rgb, mc.a * (1.0 - 0.6 * chop));
  }

  // солнечная дорожка: блики на гранях ряби
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(n, H), 0.0), rough = 0.05 + 0.07 * rip, a2 = rough * rough;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float spec = a2 / (3.14159 * dd * dd) * (0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0));
  vec3 sun = uSunCol * min(spec * 0.9, 9.0) * lit * smoothstep(0.0, 0.08, uSunDir.y);

  // толща воды: отвесно тёмная синева; гребни просвечивают бирюзой, сильнее против солнца
  float sunUp = clamp(uSunDir.y * 2.0, 0.15, 1.0);
  float crest = clamp(hgt / max(uSea.w, 0.03) * 0.5 + 0.5, 0.0, 1.0);
  float back = pow(max(dot(V, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
  vec3 body = uDeep * (0.5 + 0.5 * sunUp) + uScatter * (0.05 + 0.5 * crest * crest * (0.25 + 0.75 * back) * chop) * sunUp * (0.55 + 0.45 * lit);
  body *= (1.0 - 0.3 * gP) * (1.0 + 0.12 * gL);
  body += uScatter * (0.22 * trail) * sunUp;                       // в следу вода с пузырьками: светлее и зеленее

  vec3 col = mix(body, refl * (1.0 - 0.22 * gP), fres) + sun;

  // пена: барашки на сжатых гребнях и след лодки
  float nz = texture2D(uNoise, r * 0.31 + uRipB.zw).r, nz2 = texture2D(uNoise, q2 * 0.9 + uRipC.xy).g;
  float jt = mix(0.16, 0.6, uSea.x);
  // барашки только на вершинах крупных гребней, пятнами, а не россыпью точек
  float foam = uSea.x * smoothstep(jt + 0.12, jt - 0.08, jac + (nz - 0.5) * 0.3) * smoothstep(0.5, 0.9, crest) * smoothstep(0.35, 0.6, nz2);
  if (uFoamWin.w > 0.5) {
    vec2 fu = (vW.xz - uFoamWin.xy) / uFoamWin.z + 0.5;
    if (fu.x > 0.0 && fu.x < 1.0 && fu.y > 0.0 && fu.y < 1.0) {
      float wf = wake;
      // пена рвётся шумом двух масштабов: у кормы плотная, дальше распадается на клочья
      float nf = texture2D(uNoise, r * 1.7 + uRipC.zw).b;
      foam = max(foam, smoothstep(0.3, 0.78, wf * (0.35 + 0.9 * nz + 0.55 * nf) + wf * wf * 0.35 - nz2 * 0.16) * 0.92);
    }
  }
  // Полосы пены по ветру и редкие пятна: лежат на воде и медленно сносятся под ветер.
  // По ним виден ход лодки и на открытой воде, где нет ни знаков, ни берега рядом.
  {
    vec2 wd = uWindMark.xy, pw = vW.xz + wd * uDriftT;
    float al = dot(pw, wd), ac = dot(pw, vec2(-wd.y, wd.x));
    float lane = texture2D(uNoise, vec2(ac * 0.045, al * 0.0045)).g, lane2 = texture2D(uNoise, vec2(ac * 0.16 + 0.37, al * 0.017)).b;
    float fine = texture2D(uNoise, pw * 0.83).r;
    float streak = smoothstep(0.6, 0.8, lane) * smoothstep(0.42, 0.7, lane2) * (0.45 + 0.55 * fine) * smoothstep(4.0, 12.0, uSea.z);
    float fleck = smoothstep(0.78, 0.92, texture2D(uNoise, vec2(ac * 0.19 + 0.21, al * 0.05)).r) * (0.45 + 0.55 * fine);      // клочья пены, вытянутые по ветру
    float farK = 1.0 / (1.0 + dist * dist * 0.00012);
    foam = max(foam, (streak * 0.25 + fleck * 0.34) * farK * (1.0 - 0.8 * trail));
  }
  vec3 foamCol = (uSunCol * 0.34 * max(uSunDir.y, 0.1) * (0.35 + 0.65 * lit) + uHorizon * 0.45);
  col = mix(col, foamCol, foam);
  col *= 1.0 - 0.28 * shade * (1.0 - foam * 0.5);

  // разметка на воде: компасное кольцо, мёртвая зона, стрелка ветра, кольца у знаков
  float alphaAdd = 0.0;
  if (uCompass.w > 0.0) {
    vec2 q = vW.xz - uCompass.xy; float rq = length(q), R0 = uCompass.z;
    float aa = max(fwidth(rq), 0.004);
    float ring = smoothstep(R0 - 0.11 - aa, R0 - 0.11, rq) * (1.0 - smoothstep(R0, R0 + aa, rq));
    float bear = atan(q.x, -q.y);                               // компасный пеленг точки от лодки
    float st = 0.17453293, bt = abs(fract(bear / st + 0.5) - 0.5) * st * rq;
    float k10 = fract(bear / st + 0.5) - 0.5, idx = floor(bear / st + 0.5);
    float len = mod(idx, 9.0) == 0.0 ? 0.46 : (mod(idx, 3.0) == 0.0 ? 0.3 : 0.16);
    float tick = (1.0 - smoothstep(0.011, 0.011 + aa, bt)) * smoothstep(R0 - 0.11 - len - aa, R0 - 0.11 - len, rq) * (1.0 - smoothstep(R0 - 0.11, R0 - 0.11 + aa, rq));
    float white = max(ring, tick) * 0.62 * uCompass.w;
    col = mix(col, vec3(1.25), white); alphaAdd += white;
    vec2 wd = uWindMark.xy;                                     // единичный вектор «откуда ветер»
    float along = dot(q, wd), lat = dot(q, vec2(-wd.y, wd.x));
    if (uWindMark.z > 0.5) {
      float ang = acos(clamp(along / max(rq, 1e-4), -1.0, 1.0));
      float wedge = (1.0 - smoothstep(0.733 - aa / max(rq, 0.3), 0.733, ang)) * smoothstep(0.15, 0.2, rq) * (1.0 - smoothstep(R0 - 0.17, R0 - 0.15, rq));
      col = mix(col, vec3(1.0, 0.16, 0.12), wedge * 0.26 * uCompass.w); alphaAdd += wedge * 0.2;
    }
    if (uWindMark.w > 0.5) {
      float a0 = along - R0;                                    // стрелка снаружи кольца, остриём к лодке
      float head = step(0.25, a0) * step(a0, 1.15) * step(abs(lat), (a0 - 0.25) / 0.9 * 0.5);
      float shaft = step(1.15, a0) * step(a0, 2.65) * step(abs(lat), 0.18);
      float arrow = max(head, shaft) * uCompass.w;
      col = mix(col, vec3(0.0, 0.2, 1.3), arrow * 0.92); alphaAdd += arrow;
    }
  }
  for (int i = 0; i < 4; i++) {
    if (uMarks[i].w > 0.0) {
      float rq = length(vW.xz - uMarks[i].xy), aa = max(fwidth(rq), 0.004);
      float ring = smoothstep(uMarks[i].z - 0.25 - aa, uMarks[i].z - 0.25, rq) * (1.0 - smoothstep(uMarks[i].z, uMarks[i].z + aa, rq));
      col = mix(col, uMarkCol[i].rgb, ring * uMarks[i].w); alphaAdd += ring * uMarks[i].w;
    }
  }

  if (uLineA > 0.0) {
    vec2 pa = vW.xz - uLine.xy, ba = uLine.zw - uLine.xy;
    float dl = length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)), aa = max(fwidth(dl), 0.004);
    float ln = (1.0 - smoothstep(0.17, 0.17 + aa, dl)) * uLineA;
    col = mix(col, vec3(1.25), ln); alphaAdd += ln;
  }

  // дымка: вдали вода уходит в цвет неба у горизонта
  float fog = 1.0 - exp(-pow(dist / 1500.0, 1.35));
  col = mix(col, skyColor(normalize(vec3(-V.x, 0.012, -V.z)), 0.0, 0.0), fog);
  // вблизи при отвесном взгляде вода прозрачна: видно подводную часть лодки
  float alpha = clamp(mix(0.72, 1.0, clamp(fres * 3.0 + dist * 0.02, 0.0, 1.0)) + foam + alphaAdd + shade * 0.1, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;
export const OCEAN_UNIFORMS = ['world', 'viewProjection', 'uCam', 'uScreen', 'uRipple', 'uRipB', 'uRipC', 'uDriftT', 'uFoamWin', 'uShadowM', 'uFx', 'uSea', 'uDeep', 'uScatter',
  'uCompass', 'uWindMark', 'uMarks', 'uMarkCol', 'uLine', 'uLineA', ...SKY_UNIFORMS, ...WAVE_UNIFORMS];
export const OCEAN_SAMPLERS = ['uNoise', 'uNormalTex', 'uFoamTex', 'uMirror', 'uShadowMask'];

// ---------- пена от лодки ----------
// Текстура-окно вокруг лодки, привязанная к воде: каждый кадр прошлое состояние слегка расплывается и гаснет,
// а лодка добавляет пену у бортов и за кормой. Получается след, который остаётся на воде и расходится.
export const FOAM_FRAG = /* glsl */`
precision highp float;
varying vec2 vUV;
uniform sampler2D uPrev;
uniform vec2 uShift;                  // на сколько сдвинулось окно с прошлого кадра, в долях текстуры
uniform vec4 uStep;                   // затухание, вычитание, размытие, размер текселя
uniform vec4 uBoat;                   // положение лодки в текстуре, направление носа
uniform vec4 uBoatP;                  // полудлина и полуширина в долях текстуры, сила пены у носа и за кормой
uniform vec4 uBoat2; uniform vec4 uBoatP2;    // вторая лодка: ближайший соперник
float hullFoam(vec4 boat, vec4 bp) {
  vec2 r = vUV - boat.xy;
  float bf = dot(r, boat.zw) / bp.x, bs = dot(r, vec2(-boat.w, boat.z)) / bp.y;
  // обвод корпуса: острый нос, полная середина, чуть зауженная корма
  float hw = bf > -0.25 ? sqrt(max(0.0, 1.0 - pow(clamp((bf + 0.25) / 1.25, 0.0, 1.0), 2.2))) : 1.0 - 0.22 * pow((-0.25 - bf) / 0.75, 2.0);
  float inHull = step(-1.0, bf) * step(bf, 1.0);
  float dH = abs(bs) - hw;
  float bow = bp.z * inHull * (1.0 - smoothstep(0.0, 0.42, abs(dH - 0.1))) * smoothstep(-0.9, 0.7, bf);
  float st = bp.w * (1.0 - smoothstep(0.0, 1.0, length(vec2((bf + 1.12) * 2.2, bs * 1.05))));
  return max(bow, st);
}
void main() {
  vec2 uv = vUV + uShift;
  float f = 0.0;
  if (uv.x > 0.002 && uv.x < 0.998 && uv.y > 0.002 && uv.y < 0.998) {
    float c = texture2D(uPrev, uv).r, t = uStep.w;
    float nb = texture2D(uPrev, uv + vec2(t, 0.0)).r + texture2D(uPrev, uv - vec2(t, 0.0)).r + texture2D(uPrev, uv + vec2(0.0, t)).r + texture2D(uPrev, uv - vec2(0.0, t)).r;
    f = max(0.0, mix(c, nb * 0.25, uStep.z) * uStep.x - uStep.y);
  }
  f = max(f, max(hullFoam(uBoat, uBoatP), hullFoam(uBoat2, uBoatP2)));
  gl_FragColor = vec4(f, f, f, 1.0);
}
`;
