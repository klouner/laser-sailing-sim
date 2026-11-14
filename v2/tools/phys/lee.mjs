import { createState, defaultControls, step, settleRig, norm180 } from '../../js/physics.js';
const DT=1/120;
// за ветер: ветер с севера, идём на юг; гик на правом борту (ветер чуть слева), затем уходим за ветер на N градусов
for (const w of [8,14]) for (const lee of [0,10,20,30,40]) {
  const s=createState(), c=defaultControls(); c.gusts=false; c.windSpeed=w; c.autoSheet=true; s.heading=170; s.vf=2; settleRig(s,c);
  let o, gy=false, caps=false, sum=0,n=0, tgt=170; const b0=Math.sign(s.boom);
  for (let i=0;i<50/DT;i++){ const t=i*DT; if(t>12) tgt=180+lee;   // гик на правом (ветер слева) → за ветер = курс больше 180
    const e=norm180(tgt-s.heading); c.rudder=Math.max(-25,Math.min(25,e*1.3-s.yawRate*0.4)); o=step(s,c,DT);
    if(Math.sign(s.boom)!==b0) gy=true; if(s.capsized) caps=true; if(t>35){sum+=o.speedKn;n++;} }
  console.log(`w${w} lee${lee}: boom0 ${b0} gybed ${gy} caps ${caps} v ${(sum/n).toFixed(2)} byLee ${o.byLee.toFixed(0)} lim ${o.leeLimit.toFixed(0)} heel ${s.heel.toFixed(0)} state ${o.sailState}`);
}
// оверкиль: мачта на ветер и под ветер, авто и вручную
for (const [side, auto, swim] of [[1,true,false],[-1,true,false],[-1,false,false],[-1,false,true]]) {
  const s=createState(), c=defaultControls(); c.gusts=false; c.windSpeed=14; c.autoSheet=true; c.autoRight=auto; s.heading=90; settleRig(s,c);
  s.capsized=0.01; s.capsizeSide=side; // ветер с севера, курс 90: ветер слева (side=-1). capsizeSide=+1 → крен на левый борт → мачта на ветер
  let log=[]; let o;
  for (let i=0;i<30/DT;i++){ const t=i*DT;
    if(!auto && swim && t>1 && t<1.02) c.swimBow=true;
    if(!auto && !swim && Math.abs(t-2)<DT/2) c.rightBoat=true;
    if(!auto && swim && s.capsized && !c.swimBow && t>1.1 && !s.righting) c.rightBoat=true;
    o=step(s,c,DT); if(i%240===0) log.push(`${t.toFixed(0)}:${s.capsized?'C':'-'}${s.righting?'r':''} h${s.heel.toFixed(0)} hd${s.heading.toFixed(0)}${o.mastUpwind?' UP':''}`); }
  console.log(`capSide ${side} auto ${auto} swim ${swim} capsizes ${s.capsizes} | `+log.slice(0,10).join(' | ')+` | end v${o.speedKn.toFixed(1)} heel${s.heel.toFixed(0)}`);
}
