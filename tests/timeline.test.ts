import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, demoWorld } from '../src/simulation';
import { Timeline } from '../src/timeline';

function advance(sim:Simulation,timeline:Timeline,seconds:number){
  for(let i=0;i<seconds*60;i++){sim.step();timeline.record();}
}
test('rewind restores vehicle state, route methods and counters without mutating checkpoints',()=>{
  let seed=42;
  const sim=new Simulation(demoWorld(),()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;});
  const timeline=new Timeline(sim);
  advance(sim,timeline,5);
  const expected=sim.snapshot();
  assert.ok(expected.vehicles.length>0);
  advance(sim,timeline,2);
  timeline.seek(5);
  assert.equal(sim.paused,true);
  assert.equal(sim.time,expected.time);
  assert.deepEqual(sim.vehicles,expected.vehicles);
  assert.equal(sim.nextId,expected.nextId);
  assert.equal(sim.completed,expected.completed);
  for(const v of sim.vehicles)assert.ok(Number.isFinite(v.route.at(v.s).x));
  sim.paused=false;advance(sim,timeline,.25);
  timeline.seek(5);
  assert.deepEqual(sim.vehicles,expected.vehicles);
});
test('resuming branches history and reset discards an incompatible past',()=>{
  const sim=new Simulation(demoWorld());sim.target=0;
  const timeline=new Timeline(sim);
  advance(sim,timeline,4);timeline.seek(2);
  timeline.record();assert.ok(timeline.end>3.9,'Paused seeks preserve the future');
  sim.paused=false;advance(sim,timeline,1);
  assert.ok(timeline.end<3.1);assert.ok(timeline.end>2.9);
  sim.reset();timeline.reset();assert.equal(timeline.start,0);assert.equal(timeline.end,0);
});


test('repeated rewinds reproduce arrivals and every driving decision exactly',()=>{
  let seed=123;
  const sim=new Simulation(demoWorld(),()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;});
  const timeline=new Timeline(sim);
  advance(sim,timeline,12);
  const earlier=sim.snapshot();
  advance(sim,timeline,8);
  const expected=sim.snapshot();
  assert.ok(expected.nextId>earlier.nextId,'Replay must include newly spawned vehicles');
  for(let replay=0;replay<3;replay++){
    timeline.seek(12);sim.paused=false;
    advance(sim,timeline,8);
    assert.deepEqual(sim.snapshot(),expected,`Replay ${replay} must preserve the complete simulation state`);
  }
});
