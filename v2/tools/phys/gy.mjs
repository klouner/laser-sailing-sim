import { createState, defaultControls, step, settleRig, norm180 } from '../../js/physics.js';
const DT=1/120, DEG=Math.PI/180;
function run(name, w, gusts, auto, plan) {
  const s=createState(), c=defaultControls(); c.gusts=gusts; c.windSpeed=w; c.autoSheet=auto; c.sheet=30; s.heading=plan[0][1]; s.vf=2; settleRig(s,c);
  let tgt=plan[0][1], pi=0, seen=-1, ev=[], o, boomHist=[];
  for (let i=0;i<plan[plan.length-1][0]/DT;i++){ const t=i*DT; while (pi+1<plan.length && t>=plan[pi+1][0]) { pi++; tgt=plan[pi][1]; if (plan[pi][2]!==undefined) c.sheet=plan[pi][2]; }
    const e=norm180(tgt-s.heading); let rud=Math.max(-25,Math.min(25,e*1.3-s.yawRate*0.4)); if (Math.abs(e)>18) rud=Math.sign(e)*Math.min(35, Math.atan2(Math.abs(s.yawRate*DEG)*2.15, Math.max(0.3,s.vf))/DEG+12); c.rudder=rud;
    const b0=s.boom; o=step(s,c,DT); boomHist.push(s.boom); if (boomHist.length>240) boomHist.shift();
    if (s.lastGybe.time!==seen) { seen=s.lastGybe.time; if (s.lastGybe.kick>1.6 && s.lastGybe.crossed) { const was=boomHist[0]; ev.push(`t${t.toFixed(1)} kick${s.lastGybe.kick.toFixed(1)} boom ${was.toFixed(0)}→${s.boom.toFixed(0)} ${Math.sign(was)!==Math.sign(s.boom)?'ПЕРЕЛЁТ':'тот же борт'} twa${o.TWA.toFixed(0)} rt${s.rt} heel${s.heel.toFixed(0)} sheet${s.sheetNow.toFixed(0)}`); } } }
  console.log(name+': '+(ev.length?ev.length+' сообщ.\n   '+ev.join('\n   '):'нет сообщений'));
}
for (const w of [6,10,14,18]) {
  run(`оверштаг туда-обратно, автошкот, ${w} уз`, w, false, true, [[0,45],[12,315],[24,45],[36,315],[48,315]]);
  run(`оверштаг, шкот вручную 14°, ${w} уз`, w, false, false, [[0,45,14],[12,315],[24,45],[36,45]]);
  run(`галфвинд с порывами, автошкот, ${w} уз`, w, true, true, [[0,90],[60,90]]);
  run(`бакштаг и фордевинд с порывами, автошкот, ${w} уз`, w, true, true, [[0,140],[30,175],[60,175]]);
  run(`увалился с бейдевинда на фордевинд, автошкот, ${w} уз`, w, false, true, [[0,50],[12,170],[30,170]]);
  run(`привёлся с фордевинда, автошкот, ${w} уз`, w, false, true, [[0,170],[12,60],[30,60]]);
}
