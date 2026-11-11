import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { Simulation, World, Route, pt, sampled, type Vehicle } from '../src/simulation';
import { observeInContext } from '../src/vehicle-perception';

function vehicle(id:number,s:number):Vehicle {
  const route=new Route(sampled([pt(0,-20),pt(0,80)]).map(p=>({...p,width:5})),[]);
  return {id,route,s,kind:'car',speed:0,offset:0,targetOffset:0,pose:route.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:0};
}

test('autonomous observation uses the same occlusion and front/rear detection without selection',()=>{
  const sim=new Simulation(new World());sim.target=0;
  const observer=vehicle(1,20),front=vehicle(2,32),rear=vehicle(3,14);
  sim.vehicles=[observer,front,rear];
  const targets=sim.vehicles.map(vehicle=>({vehicle,object:new Group()}));
  const wall=new Mesh(new BoxGeometry(12,8,1),new MeshBasicMaterial());
  wall.position.set(0,4,6);wall.updateMatrixWorld(true);
  let occluders=[wall],calls=0;
  sim.prepareObservation=()=>{calls++;return {targets,occluders};};
  sim.step();
  assert.equal(calls,1);
  assert.notEqual(observer.state,'following');
  assert.deepEqual(sim.observations.get(1)?.front,[]);
  assert.deepEqual(sim.observations.get(1)?.rear.map(v=>v.id),[3]);
  occluders=[];sim.refreshObservations();
  assert.deepEqual(sim.observations.get(1),observeInContext(observer,sim.observationProfiles.car,{targets,occluders}));
  assert.deepEqual(sim.observations.get(1)?.front.map(v=>v.id),[2]);
  sim.step();
  assert.equal(observer.state,'following');
  assert.equal(observer.blockerId,front.id);
  sim.observationProfiles.car.front.range=2;sim.refreshObservations();
  assert.deepEqual(sim.observations.get(1)?.front,[]);
});

test('the observer body cannot occlude its own sight lines',()=>{
  const observer=vehicle(1,20),front=vehicle(2,32);
  const own=new Mesh(new BoxGeometry(4,5,4),new MeshBasicMaterial());
  own.position.set(0,2,0);own.updateMatrixWorld(true);
  const sim=new Simulation(new World());
  const result=observeInContext(observer,sim.observationProfiles.car,{targets:[{vehicle:observer,object:own},{vehicle:front,object:new Group()}],occluders:[own]});
  assert.deepEqual(result.front.map(v=>v.id),[2]);
});

test('a visible stopped body across the intended path prevents acceleration regardless of priority or heading',()=>{
  for(const heading of [Math.PI/2,Math.PI,.55]){
    const sim=new Simulation(new World());sim.target=0;
    const observer=vehicle(1,20),blocker=vehicle(2,24);
    observer.speed=3;observer.decision=10;
    blocker.pose.angle=heading;blocker.decision=10;
    sim.vehicles=[observer,blocker];sim.step();
    assert.ok(sim.observations.get(observer.id)?.front.some(v=>v.id===blocker.id));
    assert.equal(observer.blockerId,blocker.id,`heading ${heading}: ${observer.reason}`);
    assert.ok((observer.acceleration??0)<=0,`heading ${heading}: must brake for an occupied corridor`);
    assert.notEqual(observer.reason,'Đường thông thoáng');
  }
});

test('a visible stopped car beside a clear driving corridor does not prevent acceleration',()=>{
  const sim=new Simulation(new World());sim.target=0;
  const observer=vehicle(1,20),other=vehicle(2,25);
  observer.speed=2;observer.decision=10;other.pose.x=4;other.decision=10;
  sim.vehicles=[observer,other];sim.step();
  assert.ok(sim.observations.get(observer.id)?.front.some(v=>v.id===other.id));
  assert.equal(observer.reason,'Đường thông thoáng');
  assert.ok((observer.acceleration??0)>0);
});


test('a future clear lane cannot hide a stopped car on the steering transition',()=>{
  const sim=new Simulation(new World());sim.target=0;
  const observer=vehicle(1,20),blocker=vehicle(2,24.2);
  observer.route=new Route(sampled([pt(0,-20),pt(0,80)]).map(p=>({...p,width:8})),[]);
  observer.speed=2;observer.targetOffset=2.5;observer.decision=10;blocker.decision=10;
  sim.vehicles=[observer,blocker];sim.step();
  assert.equal(observer.blockerId,blocker.id);
  assert.ok((observer.acceleration??0)<=0);
  assert.notEqual(observer.reason,'Đường thông thoáng');
});
