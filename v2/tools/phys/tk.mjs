import { createState, defaultControls, step, settleRig, norm180 } from '../../js/physics.js';
const DT=1/120, DEG=Math.PI/180;
function run(w, smart, roll=true) {
  const s=createState(), c=defaultControls(); c.gusts=false; c.windSpeed=w; c.autoSheet=true; c.rollTack=roll; s.heading=45; s.vf=2; settleRig(s,c);
  let tgt=45, o, tDone=null, minV=9, up0=0, up10=0, v0=0;
  for (let i=0;i<40/DT;i++){ const t=i*DT; if (t>=20 && tgt===45){ tgt=315; up0=-s.z; v0=o.speedKn; }
    const e=norm180(tgt-s.heading); let rud=Math.max(-25,Math.min(25,e*1.3-s.yawRate*0.4));
    if (smart && Math.abs(e)>18) { const lim=Math.min(40, Math.atan2(Math.abs(s.yawRate*DEG)*2.15, Math.max(0.3,s.vf))/DEG + 12); rud=Math.sign(e)*lim; }
    c.rudder=rud; o=step(s,c,DT);
    if(t>=20){ minV=Math.min(minV,o.speedKn); if(tDone===null && Math.abs(norm180(s.heading-315))<10) tDone=t-20; }
    if (Math.abs(t-30)<DT/2) up10=-s.z-up0; }
  return `w${w} smart ${smart}: tack ${tDone&&tDone.toFixed(1)} s, v0 ${v0.toFixed(1)} min ${minV.toFixed(2)}, upwind10 ${up10.toFixed(1)} m`;
}
for (const w of [5,8,12,18]) { console.log(run(w,false)); console.log(run(w,true)); }
