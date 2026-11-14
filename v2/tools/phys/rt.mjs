import { createState, defaultControls, step, settleRig, norm180, KN } from '../../js/physics.js';
const DT = 1/120;
function run(w, roll, rudMax=25) {
  const s = createState(), c = defaultControls(); c.gusts=false; c.windSpeed=w; c.autoSheet=true; c.rollTack=roll; s.heading=45; s.vf=2; settleRig(s,c);
  let tgt=45, o; const log=[];
  let upwind0=0, minV=9, heelMin=0, heelMax=0, caps=false;
  for (let i=0;i<40/DT;i++){
    const t=i*DT; if (t>=20 && tgt===45){ tgt=315; upwind0=-s.z; }
    const e=norm180(tgt-s.heading); c.rudder=Math.max(-rudMax,Math.min(rudMax,e*1.3-s.yawRate*0.4));
    o=step(s,c,DT); if(s.capsized) caps=true;
    if(t>=20){ minV=Math.min(minV,o.speedKn); heelMin=Math.min(heelMin,s.heel); heelMax=Math.max(heelMax,s.heel); }
    if (t>=20 && t<26 && i%30===0) log.push(`${(t-20).toFixed(2)} hd${s.heading.toFixed(0)} v${o.speedKn.toFixed(2)} heel${s.heel.toFixed(0)} y${s.crewY.toFixed(2)} rt${s.rt} boom${s.boom.toFixed(0)}`);
    if (Math.abs(t-19.99)<DT/2) var v0=o.speedKn;
    if (Math.abs(t-30)<DT/2) var up10=-s.z-upwind0, v10=o.speedKn;
  }
  return {w, roll, v0:+v0.toFixed(2), minV:+minV.toFixed(2), up10:+up10.toFixed(1), v10:+v10.toFixed(2), heelMin:+heelMin.toFixed(0), heelMax:+heelMax.toFixed(0), caps, log};
}
for (const w of [5,8,12,18]) for (const roll of [false,true]) { const r=run(w,roll); const {log,...x}=r; console.log(JSON.stringify(x)); if (process.argv[2]&&roll&&w==+process.argv[2]) console.log(log.join('\n')); }
