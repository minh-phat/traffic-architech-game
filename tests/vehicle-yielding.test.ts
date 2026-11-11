import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingSystem } from '../src/driving';
import { Simulation, World, Route, sampled, pt, type Vehicle } from '../src/simulation';

const route=(points:ReturnType<typeof pt>[])=>new Route(sampled(points).map(p=>({...p,width:3.2})),[]);
const vehicle=(id:number,r:Route,s:number,speed:number):Vehicle=>({id,route:r,s,kind:'car',speed,offset:0,targetOffset:0,pose:r.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:0});
type TestSystem={
  crossingRisk(a:Vehicle,b:Vehicle):number|undefined;
  seesFront(a:Vehicle,b:Vehicle,sim:Simulation):boolean;
  restartBlocker(a:Vehicle,near:Vehicle[],sim:Simulation):Vehicle|undefined;
};
const system=()=>{
  const driving=new DrivingSystem() as unknown as TestSystem;
  return {
    crossingRisk:driving.crossingRisk.bind(driving),
    seesFront(a:Vehicle,b:Vehicle,sim:Simulation){
      sim.vehicles=[a,b];sim.refreshObservations();
      return driving.seesFront(a,b,sim);
    },
    restartBlocker(a:Vehicle,near:Vehicle[],sim:Simulation){
      sim.vehicles=[a,...near.filter(v=>v!==a)];sim.refreshObservations();
      return driving.restartBlocker(a,near,sim);
    },
  };
};

test('crossing prediction reserves half a metre before unsafe body occupancy',()=>{
  const a=vehicle(1,route([pt(0,-30),pt(0,40)]),20,4);
  const b=vehicle(2,route([pt(-30,0),pt(40,0)]),20,5);
  const limit=system().crossingRisk(a,b);
  assert.ok(limit!==undefined&&limit>=a.s&&limit<27);
  b.acceleration=-2;
  assert.equal(system().crossingRisk(a,b),undefined);
});

test('front recognition follows configured range and angle and excludes another level',()=>{
  const a=vehicle(1,route([pt(0,-30),pt(0,40)]),20,4);
  const b=vehicle(2,route([pt(-30,0),pt(40,0)]),24,5);
  const sim=new Simulation(new World());
  assert.equal(system().seesFront(a,b,sim),true);
  sim.observationProfiles.car.front.range=0;
  assert.equal(system().seesFront(a,b,sim),false);
  sim.observationProfiles.car.front.range=25;
  b.pose.y=20;
  assert.equal(system().seesFront(a,b,sim),false);
});

test('prediction releases after crossing traffic clears and ignores separated paths',()=>{
  const a=vehicle(1,route([pt(0,-30),pt(0,40)]),20,4);
  const cross=route([pt(-30,0),pt(40,0)]);
  const b=vehicle(2,cross,40,5);
  assert.equal(system().crossingRisk(a,b),undefined);
  b.s=20;b.pose=cross.at(20);b.pose.y=6;
  b.route=route([pt(-30,0,6),pt(40,0,6)]);
  assert.equal(system().crossingRisk(a,b),undefined);
});


test('starting waits for crossing traffic even when that traffic is braking',()=>{
  const a=vehicle(1,route([pt(0,-30),pt(0,40)]),25,0);
  const b=vehicle(2,route([pt(-30,0),pt(40,0)]),24,4);
  b.acceleration=-2;
  const sim=new Simulation(new World());
  sim.target=0;sim.vehicles=[a,b];
  assert.equal(system().restartBlocker(a,[a,b],sim)?.id,b.id);
  sim.step();
  assert.equal(a.speed,0);
  assert.equal(a.s,25);
  assert.equal(a.state,'yielding');
  sim.vehicles=[a];sim.step();
  assert.ok(a.speed>0);
  assert.ok(a.s>25);
});

test('launch corridor rejects a stopped body within half a metre and permits a free adjacent lane',()=>{
  const lane=route([pt(0,-30),pt(0,40)]);
  const a=vehicle(1,lane,20,0),b=vehicle(2,lane,24.2,0);
  const sim=new Simulation(new World());
  assert.equal(system().restartBlocker(a,[b],sim)?.id,b.id);
  b.pose.x=4;
  assert.equal(system().restartBlocker(a,[b],sim),undefined);
});

test('crossing paths at different times and traffic outside front detection allow starting',()=>{
  const a=vehicle(1,route([pt(0,-30),pt(0,40)]),25,0);
  const b=vehicle(2,route([pt(-30,0),pt(40,0)]),29,8);
  const sim=new Simulation(new World());
  assert.equal(system().restartBlocker(a,[b],sim),undefined);
  b.s=24;b.pose=b.route.at(24);b.speed=4;
  sim.observationProfiles.car.front.range=0;
  assert.equal(system().restartBlocker(a,[b],sim),undefined);
});
