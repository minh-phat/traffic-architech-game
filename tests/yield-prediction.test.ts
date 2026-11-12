import test from 'node:test';
import assert from 'node:assert/strict';
import { YieldPrediction, YIELD_BUFFER } from '../src/vehicle-yield-prediction';
import { movingBodiesOverlap } from '../src/collision';
import { Simulation, World, Route, pt, sampled, overlaps, type Vehicle, type Movement } from '../src/simulation';

const road=(a:ReturnType<typeof pt>,b:ReturnType<typeof pt>)=>new Route(sampled([a,b]).map(p=>({...p,width:3.2})),[]);
const car=(id:number,route:Route,s:number,speed:number):Vehicle=>({id,route,s,kind:'car',speed,offset:0,targetOffset:0,pose:route.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:10});
function crossing(){
  return [car(1,road(pt(0,-30),pt(0,40)),20,4),car(2,road(pt(-30,0),pt(40,0)),20,5),car(3,road(pt(-30,3),pt(40,3)),18,4)];
}

test('all observed conflicts constrain the yield, independent of array order',()=>{
  const [a,b,c]=crossing();
  const plan=new YieldPrediction().plan(a,[b,c],8)!;
  assert.deepEqual(plan.risks.map(r=>r.id),[2,3]);
  assert.deepEqual(new YieldPrediction().plan(a,[c,b],8),plan);
  assert.ok(plan.distance<=Math.min(...plan.risks.map(r=>r.distance))-YIELD_BUFFER+1e-8);
  assert.ok(plan.distance>0,'can advance to a safe yielding position');
  assert.equal(plan.emergency,false);
  assert.ok(plan.target<a.speed,'brake before the crossing');
});

test('a later conflict is still considered after the first vehicle has passed',()=>{
  const [a,b,c]=crossing();
  b.s=50;b.pose=b.route.at(b.s);
  const plan=new YieldPrediction().plan(a,[b,c],8)!;
  assert.deepEqual(plan.risks.map(r=>r.id),[3]);
  c.s=50;c.pose=c.route.at(c.s);
  assert.equal(new YieldPrediction().plan(a,[b,c],8),undefined);
});

test('measured moving speed is used even while the other vehicle is braking or reversing',()=>{
  const [a,b]=crossing();
  const normal=new YieldPrediction().plan(a,[b],8)!;
  b.acceleration=-5;
  assert.deepEqual(new YieldPrediction().plan(a,[b],8),normal);
  b.pose.x=10;b.s=40;b.velocity=-5;
  assert.ok(new YieldPrediction().plan(a,[b],8)?.risks.some(r=>r.id===b.id));
});

test('parallel traffic, different crossing times, other bridge levels and inactive bodies remain clear',()=>{
  const a=car(1,road(pt(0,-30),pt(0,40)),20,2);
  const parallel=car(2,road(pt(4,-30),pt(4,40)),25,2);
  const early=car(3,road(pt(-30,0),pt(40,0)),28,8);
  const bridge=car(4,road(pt(-30,0,6),pt(40,0,6)),20,4);
  const hidden=car(5,a.route,24,0);hidden.inGarage=true;
  assert.equal(new YieldPrediction().plan(a,[parallel,early,bridge,hidden],2),undefined);
});

test('a close head-on conflict remains hazardous for both maximum steering directions',()=>{
  const a=car(1,road(pt(0,-20),pt(0,40)),20,2);
  const b=car(2,road(pt(0,20),pt(0,-40)),15.9,2);
  const plan=new YieldPrediction().plan(a,[b],2)!;
  assert.equal(plan.risks[0].unavoidable,true);
  assert.equal(plan.emergency,true,'the requested half-metre gap is already unavailable');
  assert.equal(plan.target,0);
});

test('priority and a braking indication cannot bypass a one-metre collision risk',()=>{
  for(const braking of [false,true]){
    const a=car(1,road(pt(0,-20),pt(0,40)),20,2);
    const b=car(2,road(pt(-30,3.85),pt(40,3.85)),27.5,3);
    if(braking)b.acceleration=-2;
    for(const [v,entry,priority,incoming] of [[a,18,2,0],[b,24,0,Math.PI/2]] as const){
      v.route.movements=[{id:'junction',entry,exit:entry+12,stop:entry,center:pt(0,3.85),incoming,outgoing:incoming,turn:0,priority,control:'none',mode:'priority',circulating:false,enteringRoundabout:false} satisfies Movement];
    }
    const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[a,b];sim.step();
    assert.ok((a.acceleration??0)<0);
    assert.ok(a.yieldingTo?.includes(b.id));
    assert.notEqual(a.reason,'Đường thông thoáng');
    sim.vehicles=[a];const previous=a.speed;sim.step();
    assert.deepEqual(a.yieldingTo,[]);
    assert.ok(a.speed>previous,'resume as soon as the observed conflict clears');
  }
});

test('a stopped observer can approach its safe yielding point instead of freezing immediately',()=>{
  const a=car(1,road(pt(0,-30),pt(0,40)),20,0);
  const b=car(2,road(pt(-30,0),pt(40,0)),18,4);
  const plan=new YieldPrediction().plan(a,[b],8)!;
  assert.ok(plan&&plan.distance>0&&plan.target>0);
  assert.ok(plan.distance<Math.min(...plan.risks.map(r=>r.distance)));
});

test('moving body sweeps detect between-frame contact and distinguish different arrival times',()=>{
  const a0={...pt(0,-5),angle:0},a1={...pt(0,5),angle:0};
  const b0={...pt(-5,0),angle:Math.PI/2},b1={...pt(5,0),angle:Math.PI/2};
  assert.equal(movingBodiesOverlap(a0,a1,'bike',b0,b1,'bike'),true);
  assert.equal(movingBodiesOverlap(a0,a1,'bike',{...b0,x:-12},{...b1,x:-2},'bike'),false);
  assert.equal(movingBodiesOverlap(a0,a1,'bike',{...b0,y:6},{...b1,y:6},'bike'),false);
});


test('a rolling yield avoids a crossing vehicle without stopping in front of a moving follower',()=>{
  const lane=road(pt(0,-30),pt(0,60));
  const a=car(1,lane,30,4),cross=car(2,road(pt(-30,10),pt(40,10)),22,5),rear=car(3,lane,21,4);
  const plan=new YieldPrediction().plan(a,[cross,rear],8)!;
  assert.equal(plan.emergency,false);
  assert.deepEqual(plan.risks.map(r=>r.id),[cross.id,rear.id]);
  assert.ok(plan.target>0&&plan.target<a.speed);
  assert.equal(plan.distance,Infinity,'validated rolling movement replaces the unsafe full stop');
});

test('multiple live conflicts clear without body overlap and the yielding vehicle resumes',()=>{
  const [a,b,c]=crossing();
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[a,b,c];
  let multiple=false;
  for(let i=0;i<12*60;i++){
    sim.step();multiple ||= (a.yieldingTo?.length??0)>1;
    for(let j=0;j<sim.vehicles.length;j++)for(let k=j+1;k<sim.vehicles.length;k++){
      const first=sim.vehicles[j],second=sim.vehicles[k];
      assert.equal(overlaps(first.pose,first.kind,second.pose,second.kind,0),false);
    }
  }
  assert.ok(multiple,'retain every simultaneous yielding dependency');
  assert.ok(a.arrived,'continue after the moving conflict clears');
});

test('the other vehicle rotating can sweep a corner into us between clear endpoints',()=>{
  const a0={...pt(0,2.92),angle:0},a1={...pt(.2,2.92),angle:0};
  const b0={...pt(0,0),angle:-Math.PI/4},b1={...pt(.2,0),angle:Math.PI/4};
  assert.equal(overlaps(a0,'bike',b0,'car',0),false);
  assert.equal(overlaps(a1,'bike',b1,'car',0),false);
  assert.equal(movingBodiesOverlap(a0,a1,'bike',b0,b1,'car',0),true);
});
