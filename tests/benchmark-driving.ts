import { mkdirSync, writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { Simulation, demoWorld, overlaps } from '../src/simulation';

let seed=Number(process.argv[2]??1);
const sim=new Simulation(demoWorld(),()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;});
sim.target=Number(process.argv[3]??25);
const duration=Number(process.argv[4]??360),samples:number[]=[];
let contacts=0;
const started=performance.now();
for(let i=0;i<duration*60;i++){
  if(i===120*60)sim.target=0;
  const before=performance.now();sim.step();samples.push(performance.now()-before);
  for(let a=0;a<sim.vehicles.length;a++)for(let b=a+1;b<sim.vehicles.length;b++){
    const v=sim.vehicles[a],other=sim.vehicles[b];
    if(!v.inGarage&&!other.inGarage&&overlaps(v.pose,v.kind,other.pose,other.kind,0))contacts++;
  }
  if((i+1)%3600===0)console.log(JSON.stringify({time:Math.round(sim.time),completed:sim.completed,active:sim.vehicles.length,elapsedMs:Math.round(performance.now()-started)}));
}
samples.sort((a,b)=>a-b);
const report={seconds:duration,completed:sim.completed,active:sim.vehicles.length,contacts,
  stepMs:{median:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],p99:samples[Math.floor(samples.length*.99)],max:samples.at(-1)},
  vehicles:sim.vehicles.map(v=>({id:v.id,kind:v.kind,state:v.state,reason:v.reason,blocker:v.blockerId,waiting:v.waiting,s:v.s,total:v.route.total,pose:v.pose,steering:v.steering,offset:v.offset,yieldingTo:v.yieldingTo}))};
mkdirSync('test-results',{recursive:true});
writeFileSync('test-results/driving-benchmark.json',JSON.stringify(report,null,2));
writeFileSync('test-results/driving-checkpoint.bin',serialize({world:sim.world.serialize(),snapshot:sim.snapshot()}));
console.log(JSON.stringify(report));
