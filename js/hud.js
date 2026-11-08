// 2D-схема «вид сверху, север вверху»
const DEG = Math.PI / 180;

export function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = W / 2 - 14;

  function arrow(x0, y0, x1, y1, color, width = 3, head = 10) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 2) return;
    const ux = dx / L, uy = dy / L;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * head * 0.7, y1 - uy * head * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
    ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5); ctx.closePath(); ctx.fill();
  }
  function bearingVec(b) { return [Math.sin(b * DEG), -Math.cos(b * DEG)]; } // на холсте: x вправо, y вниз; север вверх

  return function draw(state, out, ctl, show) {
    ctx.clearRect(0, 0, W, H);
    // фон
    ctx.fillStyle = '#0f2744'; ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // мёртвая зона
    if (show.noGo) {
      const a0 = (ctl.windFrom - 42 - 90) * DEG, a1 = (ctl.windFrom + 42 - 90) * DEG;
      ctx.fillStyle = 'rgba(239,68,68,.22)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill();
    }
    // риски и буквы
    ctx.font = '600 12px Inter, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let b = 0; b < 360; b += 30) {
      const [vx, vy] = bearingVec(b);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = b % 90 === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + vx * (R - (b % 90 === 0 ? 10 : 6)), cy + vy * (R - (b % 90 === 0 ? 10 : 6))); ctx.lineTo(cx + vx * R, cy + vy * R); ctx.stroke();
      if (b % 90 === 0) { ctx.fillStyle = '#cbd5e1'; ctx.fillText(['С', 'В', 'Ю', 'З'][b / 90], cx + vx * (R - 20), cy + vy * (R - 20)); }
    }
    // истинный ветер: стрелка от края к центру
    if (show.trueWind) {
      const [vx, vy] = bearingVec(ctl.windFrom);
      arrow(cx + vx * (R - 2), cy + vy * (R - 2), cx + vx * 62, cy + vy * 62, '#3b82f6', 4, 12);
      ctx.fillStyle = '#93c5fd'; ctx.font = '600 11px Inter, Arial';
      ctx.fillText(`${Math.round(ctl.windSpeed)} уз`, cx + vx * (R - 2) - vy * 22, cy + vy * (R - 2) + vx * 22);
    }
    // вымпельный ветер: стрелка к лодке
    if (show.appWind) {
      const L = Math.hypot(out.Ax, out.Az) || 0.001;
      const ux = out.Ax / L, uz = out.Az / L; // «куда»
      const len = Math.min(R - 10, 6.5 * out.AWS);
      arrow(cx - ux * len, cy - uz * len, cx - ux * 48, cy - uz * 48, '#22d3ee', 3, 10);
    }
    // скорость лодки
    if (show.vel) {
      const L = Math.hypot(out.Vx, out.Vz);
      if (L > 0.05) { const len = Math.min(R - 10, 22 * L); arrow(cx, cy, cx + out.Vx / L * len, cy + out.Vz / L * len, '#22c55e', 3, 10); }
    }
    // сила на парусе
    if (show.force) {
      const L = Math.hypot(out.forceWorldX, out.forceWorldZ);
      if (L > 5) { const len = Math.min(R - 10, L * 0.14); arrow(cx, cy, cx + out.forceWorldX / L * len, cy + out.forceWorldZ / L * len, '#f97316', 3, 10); }
    }
    // лодка
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(state.heading * DEG);
    const S = 17; // пикселей на метр
    // корпус (нос вверх)
    ctx.fillStyle = '#f1f5f9'; ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -2.13 * S);
    ctx.bezierCurveTo(0.55 * S, -1.4 * S, 0.72 * S, -0.3 * S, 0.68 * S, 1.2 * S);
    ctx.lineTo(0.56 * S, 2.1 * S); ctx.lineTo(-0.56 * S, 2.1 * S); ctx.lineTo(-0.68 * S, 1.2 * S);
    ctx.bezierCurveTo(-0.72 * S, -0.3 * S, -0.55 * S, -1.4 * S, 0, -2.13 * S);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // кокпит
    ctx.fillStyle = '#94a3b8'; ctx.beginPath(); ctx.roundRect(-0.45 * S, -0.5 * S, 0.9 * S, 1.5 * S, 5); ctx.fill();
    // мачта
    const mx = 0, my = -1.12 * S;
    // гик и парус (boom>0 — по правому борту = +x на холсте)
    const b = state.boom * DEG;
    const bx = mx + Math.sin(b) * 2.7 * S, by = my + Math.cos(b) * 2.7 * S;
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(bx, by); ctx.stroke();
    // пузо паруса
    const side = state.side, belly = out.luffing ? 0.1 : 0.18 + 0.25 * Math.min(1, out.aoa / 15);
    const nx = Math.cos(b) * -side, ny = -Math.sin(b) * -side; // нормаль под ветер
    ctx.strokeStyle = out.luffing ? '#fca5a5' : '#f8fafc'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(mx, my);
    ctx.quadraticCurveTo((mx + bx) / 2 + nx * belly * 2 * S, (my + by) / 2 + ny * belly * 2 * S, bx, by); ctx.stroke();
    ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
    // руль (+ = перо вправо, лодка направо)
    const r = ctl.rudder * DEG;
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 2.1 * S); ctx.lineTo(Math.sin(r) * 0.55 * S, 2.1 * S + Math.cos(r) * 0.55 * S); ctx.stroke();
    // румпель — в противоположную сторону
    ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2.1 * S); ctx.lineTo(-Math.sin(r) * 0.9 * S, 2.1 * S - Math.cos(r) * 0.9 * S); ctx.stroke();
    ctx.restore();
    // подписи углов
    ctx.fillStyle = '#e2e8f0'; ctx.font = '600 11px Inter, Arial'; ctx.textAlign = 'left';
    ctx.fillText(`Курс ${Math.round(state.heading)}°`, 10, 14);
    ctx.fillText(`Ветер ${Math.round(ctl.windFrom)}° · угол к ветру ${Math.round(Math.abs(out.TWA))}°`, 10, 28);
    ctx.textAlign = 'right';
    ctx.fillText(`Гик ${Math.round(Math.abs(state.boom))}° · атака ${Math.round(out.aoa)}°`, W - 10, H - 12);
  };
}
