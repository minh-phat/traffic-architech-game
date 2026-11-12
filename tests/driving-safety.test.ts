import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, World, Route, SPECS, pt, sampled, type Vehicle } from '../src/simulation';
import { penetration, separatesContact } from '../src/collision';
import { YieldPrediction } from '../src/vehicle-yield-prediction';

const road=(a=pt(0,0),b=pt(0,100),width=3.2)=>new Route(sampled([a,b]).map(p=>({...p,width})),[]);
const car=(id:number,route:Route,s:number,speed=0):Vehicle=>({id,kind:'car',route,s,speed,pose:route.at(s),offset:0,targetOffset:0,waiting:0,age:0,arrived:false,blocked:false,decision:10});
function simulation(vehicles:Vehicle[]){const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=vehicles;return sim;}

test('an existing contact permits separation but rejects deeper penetration and rotation into the other body',()=>{
  const a={...pt(0,0),angle:0},b={...pt(0,3.7),angle:0};
  assert.ok(penetration(a,'car',b,'car')>0);
  assert.equal(separatesContact(a,{...a,z:-.1},'car',b,'car'),true);
  assert.equal(separatesContact(a,{...a,z:.1},'car',b,'car'),false);
  assert.equal(separatesContact(a,{...a,angle:.15},'car',b,'car'),false);
});

test('two cars overlapping after an incident separate without increasing penetration',()=>{
  const a=car(1,road(pt(-40,0),pt(40,0)),38.2),b=car(2,road(pt(40,0),pt(-40,0)),38.2);
  a.waiting=b.waiting=5;
  const sim=simulation([a,b]);let depth=penetration(a.pose,a.kind,b.pose,b.kind);
  assert.ok(depth>0);let reversed=false;
  for(let i=0;i<12*60;i++){
    sim.step();
    const next=penetration(a.pose,a.kind,b.pose,b.kind);
    assert.ok(next<=depth+1e-8,'recovery must not push the bodies further together');depth=next;
    reversed||=(a.velocity??0)<0||(b.velocity??0)<0;
  }
  assert.ok(reversed);assert.equal(depth,0);
});

test('the beneficiary keeps its position while the other car retreats',()=>{
  const a=car(1,road(pt(-40,0),pt(40,0)),37),b=car(2,road(pt(40,0),pt(-40,0)),37);
  a.waiting=b.waiting=5;
  const sim=simulation([a,b]);let sawRetreat=false;
  for(let i=0;i<10*60;i++){
    const before=new Map([a,b].map(v=>[v.id,v.s]));sim.step();
    const retreat=[a,b].find(v=>(v.velocity??0)<-.01);
    if(!retreat)continue;
    sawRetreat=true;const other=retreat===a?b:a;
    assert.ok(other.s<=before.get(other.id)!+1e-8,'leave the manoeuvring room open');
  }
  assert.ok(sawRetreat);
});

test('a cycle of post-retreat holds can release one validated movement without waiting forever',()=>{
  const a=car(1,road(pt(-30,0),pt(40,0),5),27),b=car(2,road(pt(0,-30),pt(0,40),5),27);
  a.waiting=b.waiting=5;a.state=b.state='yielding';a.blockerId=2;b.blockerId=1;
  const sim=simulation([a,b]),snapshot=sim.snapshot();
  snapshot.driving.release=new Map([[1,{other:2,until:5}],[2,{other:1,until:5}]]);
  sim.restore(snapshot);
  for(let i=0;i<25*60;i++){
    sim.step();
    if(sim.vehicles.length===2)assert.equal(penetration(sim.vehicles[0].pose,'car',sim.vehicles[1].pose,'car'),0);
  }
  assert.equal(sim.completed,2);
});

test('a detour with a clear cruise corridor is rejected when its braking tail has no room',()=>{
  const route=road(pt(0,-30),pt(0,60),12),a=car(1,route,30,2),b=car(2,route,39);
  const selected=new YieldPrediction().steerAround(a,[b],8,90,(_from,to)=>Math.abs(to.offset)<4.5)!;
  assert.ok(selected);
  const samples:number[]=[];
  const valid=new YieldPrediction().steerAround(a,[b],8,90,(_from,to)=>{samples.push(to.s);return Math.abs(to.offset)<4.5;},selected.steering,selected.targetOffset);
  assert.ok(valid);assert.ok(samples.length>30);
  const barrier=samples[29]+.001;
  assert.equal(new YieldPrediction().steerAround(a,[b],8,90,(_from,to)=>to.s<=barrier&&Math.abs(to.offset)<4.5,selected.steering,selected.targetOffset),undefined);
});

test('an occupied receiving corridor prevents entry even when the final exit pose is clear',()=>{
  const lane=road(),v=car(1,lane,14,4),holding=road(),blocker=car(2,holding,36);
  lane.movements=[{id:'junction',entry:24,exit:38,stop:24,center:pt(0,30),incoming:0,outgoing:0,turn:0,priority:0,control:'none',mode:'priority',circulating:false,enteringRoundabout:false}];
  holding.signals=[{s:36+SPECS.car.length/2,vertical:true,light:{x:0,z:36,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const sim=simulation([v,blocker]);sim.step();
  assert.equal(v.state,'exit-blocked');
  for(let i=0;i<5*60;i++)sim.step();
  assert.ok(v.s+SPECS.car.length/2<24);assert.notEqual(v.state,'reversing');
});

test('a driver limits speed so it can stop within a shortened observation range',()=>{
  const v=car(1,road(undefined,undefined,5),10),sim=simulation([v]);sim.observationProfiles.car.front.range=5;
  for(let i=0;i<8*60;i++)sim.step();
  assert.ok(v.speed>0);assert.ok(v.speed<SPECS.car.speed*.6);
  assert.ok(v.speed*.35+v.speed*v.speed/(2*SPECS.car.brake)<=5-SPECS.car.length/2-.5+1e-6);
});
