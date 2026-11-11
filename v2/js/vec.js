// Небольшой вектор для геометрии и поз: расчёт форм не зависит от графического движка,
// наружу отдаются обычные массивы чисел.
export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  crossVectors(a, b) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; this.x = x; this.y = y; this.z = z; return this; }
  cross(b) { return this.crossVectors(this, b); }
  // поворот вокруг оси Y на угол a (как у узла сцены: +a уводит ось x к −z)
  rotY(a) { const c = Math.cos(a), s = Math.sin(a), x = this.x * c + this.z * s, z = -this.x * s + this.z * c; this.x = x; this.z = z; return this; }
  // поворот вокруг произвольной единичной оси
  applyAxisAngle(ax, a) {
    const c = Math.cos(a), s = Math.sin(a), d = this.dot(ax) * (1 - c);
    const cx = ax.y * this.z - ax.z * this.y, cy = ax.z * this.x - ax.x * this.z, cz = ax.x * this.y - ax.y * this.x;
    return this.set(this.x * c + cx * s + ax.x * d, this.y * c + cy * s + ax.y * d, this.z * c + cz * s + ax.z * d);
  }
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const DEG = Math.PI / 180;

// Нормали по треугольникам, усреднённые в вершинах. out можно переиспользовать между кадрами.
export function computeNormals(pos, idx, out) {
  out.fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz; out[b] += nx; out[b + 1] += ny; out[b + 2] += nz; out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) { const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}

// Плавная кривая через точки (Катмулла — Рома) для обводов корпуса
export function catmull(pts, t) {
  const n = pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}
