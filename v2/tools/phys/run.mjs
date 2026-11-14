import { createState, defaultControls, step, settleRig, norm180 } from '../../js/physics.js';
const DT=1/120;
function run(w, hd, gusts, auto, verbose) {
  const s=createState(), c=defaultControls(); c.gusts=gusts; c.windSpeed=w; c.autoSheet=auto; c.sheet=88; s.heading=hd; s.vf=3; settleRig(s,c);
  let o, flips=0, cross=0, lastSide=s.side, lastY=Math.sign(s.crewY), maxH=0, sumH=0, n=0, gyb=0, lastB=Math.sign(s.boom), cap=0; const log=[];
  for (let i=0;i<90/DT;i++){ const e=norm180(hd-s.heading); c.rudder=Math.max(-25,Math.min(25,e*1.3-s.yawRate*0.4)); o=step(s,c,DT);
    if (i*DT>10) { if(s.side!==lastSide) flips++; if(Math.sign(s.crewY)!==lastY && Math.abs(s.crewY)>0.12){cross++; lastY=Math.sign(s.crewY);} if(Math.sign(s.boom)!==lastB){gyb++;lastB=Math.sign(s.boom);} maxH=Math.max(maxH,Math.abs(s.heel)); sumH+=Math.abs(s.heel); n++; if(s.capsized) cap=1; }
    lastSide=s.side;
    if (verbose && i%60===0 && i*DT>20 && i*DT<34) log.push(`${(i*DT).toFixed(1)} heel${s.heel.toFixed(0)} y${s.crewY.toFixed(2)} side${s.side} awa${o.AWA.toFixed(0)} boom${s.boom.toFixed(0)} K${o.Kext.toFixed(0)} roll${s.rollAmp.toFixed(2)} lee${o.byLee.toFixed(0)}`); }
  console.log(`w${w} hd${hd} gusts ${gusts} auto ${auto}: sideFlips ${flips} crewCross ${cross} gybes ${gyb} maxHeel ${maxH.toFixed(0)} avgHeel ${(sumH/n).toFixed(1)} cap ${cap}`);
  if (verbose) console.log(log.join('\n'));
}
for (const w of [8,12,16]) for (const hd of [180,172]) for (const g of [false,true]) run(w,hd,g,true,false);
run(12,180,true,true,true);
