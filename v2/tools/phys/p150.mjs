import { createState, defaultControls, step, settleRig, norm180 } from '../../js/physics.js';
const DT=1/120;
for (const w of [16,18,20,24]) for (const a of [135,150,165]) { const s=createState(), c=defaultControls(); c.gusts=false; c.windSpeed=w; c.autoSheet=true; s.heading=a; s.vf=3; settleRig(s,c); let o, cap=null, maxH=0;
  for (let i=0;i<60/DT;i++){ const e=norm180(a-s.heading); c.rudder=Math.max(-25,Math.min(25,e*1.3-s.yawRate*0.4)); o=step(s,c,DT); maxH=Math.max(maxH,Math.abs(s.heel)); if(s.capsized&&!cap){cap=`t${(i*DT).toFixed(1)} side${s.capsizeSide} windSide${s.side} roll${s.rollAmp.toFixed(2)} boom${s.boom.toFixed(0)} v${o.speedKn.toFixed(1)} y${s.crewY.toFixed(2)} vang${s.trim.vang.toFixed(2)}`; break;} }
  console.log(w, a, cap || `ok v${o.speedKn.toFixed(1)} maxHeel${maxH.toFixed(0)} roll${s.rollAmp.toFixed(2)}`); }
