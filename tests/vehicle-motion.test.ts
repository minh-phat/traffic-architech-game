import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleMotionState } from '../src/vehicle-motion';
import { Simulation, World, Route, sampled, pt, type Vehicle } from '../src/simulation';

test('a stopped braking vehicle is stationary, and reverse uses speed magnitude',()=>{
  assert.equal(vehicleMotionState({speed:0,velocity:0,braking:true,acceleration:-5}),'stationary');
  assert.equal(vehicleMotionState({speed:1,velocity:-1,acceleration:1}),'accelerating');
  assert.equal(vehicleMotionState({speed:1,velocity:-1,acceleration:-.3}),'slowing');
  assert.equal(vehicleMotionState({speed:1,velocity:-1,acceleration:-1}),'braking');
  assert.equal(vehicleMotionState({speed:1,velocity:-1,acceleration:.01}),'steady');
});

test('motion information follows actual driving and survives rewind',()=>{
  const route=new Route(sampled([pt(0,0),pt(0,100)]).map(p=>({...p,width:3.2})),[]);
  const vehicle:Vehicle={id:1,route,s:10,kind:'car',speed:0,offset:0,targetOffset:0,pose:route.at(10),waiting:0,age:0,arrived:false,blocked:false,decision:0};
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[vehicle];
  sim.step();assert.equal(vehicle.motionState,'accelerating');
  const saved=sim.snapshot();
  route.signals=[{s:vehicle.s+1.95+.1,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  for(let i=0;i<120;i++)sim.step();
  assert.equal(vehicle.motionState,'stationary');
  sim.restore(saved);
  assert.equal(sim.vehicles[0].motionState,'accelerating');
});
