import test from 'node:test';
import assert from 'node:assert/strict';
import { crossingSpace, crossingWindow, earlierCrossing, CROSSING_TIME_BUFFER } from '../src/crossing-time';
import { DrivingSystem } from '../src/driving';
import { Simulation, World, Route, SPECS, sampled, pt, overlaps, type Vehicle, type Movement } from '../src/simulation';

const road=(horizontal=false)=>new Route(sampled(horizontal?[pt(-30,0),pt(50,0)]:[pt(0,-30),pt(0,50)]).map(p=>({...p,width:3.2})),[]);
const car=(id:number,r:Route,s:number,speed:number,kind:Vehicle['kind']='car'):Vehicle=>({id,route:r,s,kind,speed,pose:r.at(s),offset:0,targetOffset:0,age:0,waiting:0,arrived:false,blocked:false,decision:10});
const spaces=(a:Vehicle,b:Vehicle)=>[crossingSpace(a,b,30,30)!,crossingSpace(b,a,30,30)!];
const intent=(v:Vehicle)=>({target:SPECS[v.kind].speed,limit:v.route.total,state:'driving',reason:'',legal:false});
type TimingSystem={
  timedCrossing(a:Vehicle,b:Vehicle,ia:ReturnType<typeof intent>,ib:ReturnType<typeof intent>,c:{a:number;b:number;until:number},sim:Simulation):{wa:ReturnType<typeof crossingWindow>;wb:ReturnType<typeof crossingWindow>;separated:boolean};
  hasPriority(a:Vehicle,b:Vehicle,ia:ReturnType<typeof intent>,ib:ReturnType<typeof intent>,c:{a:number;b:number;until:number},sim:Simulation):boolean;
};

test('the crossing window includes the whole truck tail rather than just its centre',()=>{
  const a=car(1,road(),20,3),b=car(2,road(true),20,3);
  const small=crossingSpace(a,b,30,30)!;
  a.kind='truck';
  const large=crossingSpace(a,b,30,30)!;
  assert.ok(large.entry<small.entry-1);
  assert.ok(large.exit>small.exit+1);
  assert.ok(large.exit>30+SPECS.truck.length/2);
});

test('a farther but faster opponent gets the first turn according to measured arrival',()=>{
  const a=car(1,road(),22,1),b=car(2,road(true),16,6);
  const [sa,sb]=spaces(a,b),wa=crossingWindow(a,sa,8,80),wb=crossingWindow(b,sb,8,80);
  assert.ok(30-a.s<30-b.s,'our centre is closer');
  assert.ok(wb.arrival<wa.arrival,'the opponent reaches the occupied region first');
  assert.equal(earlierCrossing(wa,wb),false);
  assert.equal(earlierCrossing(wb,wa),true);
});

test('a safe gap compares measured clearance against the other earliest accelerated entry',()=>{
  const a=car(1,road(),20,5),b=car(2,road(true),0,1);
  const [sa,sb]=spaces(a,b),wa=crossingWindow(a,sa,8,80),wb=crossingWindow(b,sb,8,80);
  assert.ok(wa.exit+CROSSING_TIME_BUFFER<wb.entry);
  assert.equal(earlierCrossing(wa,wb),true);
  a.speed=.5;
  const slow=crossingWindow(a,sa,8,80);
  assert.ok(slow.plannedExit<slow.exit,'planned acceleration is faster than actual clearance');
  assert.ok(slow.exit+CROSSING_TIME_BUFFER>wb.entry,'acceleration alone cannot certify the gap');
});

test('a stationary or legally stopped vehicle cannot promise a measured clearance',()=>{
  const a=car(1,road(),23,0),b=car(2,road(true),20,4);
  const [sa,sb]=spaces(a,b),wa=crossingWindow(a,sa,8,80),wb=crossingWindow(b,sb,8,80);
  assert.equal(wa.exit,Infinity);
  assert.ok(Number.isFinite(wa.plannedExit),'it can still negotiate a turn from rest');
  const stopped=crossingWindow(a,sa,0,sa.entry-.5);
  assert.equal(stopped.canClear,false);
  assert.equal(earlierCrossing(stopped,wb),false);
  a.velocity=-.5;
  assert.equal(crossingWindow(a,sa,8,80).canClear,false);
});

test('parallel lanes, a shared merge and a bridge cannot create a bounded crossing turn',()=>{
  const a=car(1,road(),20,3),b=car(2,road(),20,3);
  assert.equal(crossingSpace(a,b,30,30),undefined);
  b.route=road(true);
  b.route.points.forEach(p=>p.y=6);
  assert.equal(crossingSpace(a,b,30,30),undefined);
});

test('an occupied receiving corridor disqualifies the otherwise earlier driver',()=>{
  const a=car(1,road(),24,4),b=car(2,road(true),20,3),queue=car(3,road(),37,0);
  const sim=new Simulation(new World());sim.vehicles=[a,b,queue];sim.target=0;
  const system=new DrivingSystem() as unknown as TimingSystem;
  const timing=system.timedCrossing(a,b,intent(a),intent(b),{a:30,b:30,until:.4},sim);
  assert.equal(timing.wa.canClear,false);
  assert.equal(timing.wb.canClear,true);
  assert.equal(earlierCrossing(timing.wa,timing.wb),false);
  a.route.movements=[{id:'junction',entry:28,stop:28,exit:38,center:pt(0,0),incoming:0,outgoing:0,turn:0,priority:2,control:'none',mode:'priority',circulating:false,enteringRoundabout:false}];
  b.route.movements=[{...a.route.movements[0],priority:0}];
  assert.equal(system.hasPriority(a,b,intent(a),intent(b),{a:30,b:30,until:.4},sim),false,
    'a blocked priority approach must leave the clear lower-priority crossing available');
});

test('a temporal turn is reciprocal and remains stable while its winner makes progress',()=>{
  const a=car(1,road(),22,1),b=car(2,road(true),16,6);
  const sim=new Simulation(new World());sim.vehicles=[a,b];sim.target=0;
  const system=new DrivingSystem() as unknown as TimingSystem,c={a:30,b:30,until:.4};
  assert.equal(system.hasPriority(a,b,intent(a),intent(b),c,sim),false);
  assert.equal(system.hasPriority(b,a,intent(b),intent(a),c,sim),true);
  b.speed=2;sim.time=.5;b.s+=.2;b.pose=b.route.at(b.s);
  assert.equal(system.hasPriority(a,b,intent(a),intent(b),c,sim),false,'a small speed change must not swap turns');
});

test('a turn is reconsidered when the selected driver has no exit',()=>{
  const a=car(1,road(),22,1),b=car(2,road(true),16,6);
  const sim=new Simulation(new World());sim.vehicles=[a,b];sim.target=0;
  const system=new DrivingSystem() as unknown as TimingSystem,c={a:30,b:30,until:.4};
  assert.equal(system.hasPriority(a,b,intent(a),intent(b),c,sim),false);
  const blocked={...intent(b),target:0,limit:24};
  assert.equal(system.hasPriority(a,b,intent(a),blocked,c,sim),true);
});

test('temporal preference respects explicit road priority when occupancy overlaps',()=>{
  const a=car(1,road(),22,1),b=car(2,road(true),16,6);
  const movement=(priority:number):Movement=>({id:'junction',entry:24,stop:24,exit:38,center:pt(0,0),incoming:0,outgoing:0,turn:0,priority,control:'none',mode:'priority',circulating:false,enteringRoundabout:false});
  a.route.movements=[movement(2)];b.route.movements=[movement(0)];
  const sim=new Simulation(new World());sim.vehicles=[a,b];sim.target=0;
  const system=new DrivingSystem() as unknown as TimingSystem;
  assert.equal(system.hasPriority(a,b,intent(a),intent(b),{a:30,b:30,until:.4},sim),true);
});

test('crossing pairs finish without overlap for both array orders and integration rates',()=>{
  for(const reverse of [false,true])for(const dt of [1/30,1/60]){
    const a=car(1,road(),22,1),b=car(2,road(true),16,6);
    const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=reverse?[b,a]:[a,b];
    let first:number|undefined;
    for(let i=0;i<25/dt;i++){
      sim.step(dt);
      assert.equal(overlaps(a.pose,a.kind,b.pose,b.kind,0),false);
      if(first===undefined&&(a.s>=30||b.s>=30))first=a.s>=30?a.id:b.id;
    }
    assert.equal(first,b.id,'the farther, faster car actually crosses first');
    assert.equal(sim.completed,2);
  }
});

test('replay restores a negotiated crossing turn and reproduces its motion',()=>{
  const a=car(1,road(),22,1),b=car(2,road(true),16,6);
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[a,b];
  sim.step();const checkpoint=sim.snapshot();
  assert.ok(checkpoint.driving.crossingTurns.size>0);
  for(let i=0;i<120;i++)sim.step();
  const expected=sim.snapshot();sim.restore(checkpoint);
  for(let i=0;i<120;i++)sim.step();
  assert.deepEqual(sim.snapshot(),expected);
});
