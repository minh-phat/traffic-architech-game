import test from 'node:test';
import assert from 'node:assert/strict';
import { YieldPrediction } from '../src/vehicle-yield-prediction';
import { Simulation, World, Route, SPECS, pt, sampled, overlaps, type Vehicle } from '../src/simulation';

const road=(a:ReturnType<typeof pt>,b:ReturnType<typeof pt>,width=12)=>new Route(sampled([a,b]).map(p=>({...p,width})),[]);
const car=(id:number,route:Route,s:number,speed:number):Vehicle=>({id,route,s,kind:'car',speed,offset:0,targetOffset:0,pose:route.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:10});
function fixture(){
  const route=road(pt(0,-30),pt(0,60));
  return {a:car(1,route,30,2),b:car(2,route,39,0)};
}
const corridor=(_from:Vehicle,to:{offset:number})=>Math.abs(to.offset)<4.5;

test('remaining steering is used proactively when the complete detour is clear',()=>{
  const {a,b}=fixture();a.steering=.1;
  const detour=new YieldPrediction().steerAround(a,[b],8,90,(from,to)=>corridor(from,to)&&to.offset>=-1e-5)!;
  assert.ok(detour);
  assert.ok(detour.steering>a.steering,'turn further while steering range remains');
  assert.ok(detour.steering<=SPECS.car.maxSteer);
  assert.ok(detour.target>0);
});

test('moving traffic entering either new corridor prevents the stationary-obstacle detour',()=>{
  const {a,b}=fixture();
  const c=car(3,road(pt(10,4),pt(-30,4)),0,4),d=car(4,road(pt(-10,4),pt(30,4)),0,4);
  assert.ok(new YieldPrediction().steerAround(a,[b],8,90,corridor));
  assert.equal(new YieldPrediction().steerAround(a,[b,c,d],8,90,corridor),undefined);
  assert.equal(new YieldPrediction().steerAround(a,[d,b,c],8,90,corridor),undefined);
});

test('a clear first step is insufficient when the road or a stationary body blocks the rest of the arc',()=>{
  const {a,b}=fixture();
  assert.equal(new YieldPrediction().steerAround(a,[b],8,90,(_v,to)=>Math.abs(to.offset)<.25),undefined);
  const wall=[-4,-2,0,2,4].map((x,i)=>{
    const v=car(10+i,a.route,35,0);v.pose={...v.pose,x};return v;
  });
  assert.equal(new YieldPrediction().steerAround(a,[b,...wall],8,90,corridor),undefined);
});

test('the car steers and passes a stationary blocker without waiting for lock recovery',()=>{
  const {a,b}=fixture();
  b.route=road(pt(0,-30),pt(0,60));
  b.route.signals=[{s:b.s+SPECS.car.length/2,vertical:true,light:{x:0,z:9,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[a,b];
  sim.step();
  assert.equal(a.reason,'Đánh lái qua khoảng trống an toàn');
  assert.ok(Math.abs(a.steering??0)>0);
  assert.ok(Math.abs(a.steering??0)<=1.3/60+1e-8,'respect the real steering rate');
  for(let i=0;i<12*60;i++){
    sim.step();
    assert.equal(overlaps(a.pose,a.kind,b.pose,b.kind,0),false);
    assert.ok(Math.abs(a.steering??0)<=SPECS.car.maxSteer+1e-8);
    assert.ok(b.s<=39+.001,'the blocker remains parked at its red light');
  }
  assert.ok(a.s>b.s+SPECS.car.length,'pass rather than stop forever or circle beside the blocker');
});

test('moving hazards are checked again after a steering angle was selected',()=>{
  const {a,b}=fixture();
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.observationProfiles.car.front.angle=360;sim.vehicles=[a,b];sim.step();
  assert.equal(a.reason,'Đánh lái qua khoảng trống an toàn');
  const c=car(3,road(pt(10,4),pt(-30,4)),0,4),d=car(4,road(pt(-10,4),pt(30,4)),0,4);
  sim.vehicles=[a,b,c,d];sim.step();
  assert.notEqual(a.reason,'Đánh lái qua khoảng trống an toàn');
});

test('red lights remain a hard stop even when a side corridor is clear',()=>{
  const {a,b}=fixture();a.speed=0;
  a.route.signals=[{s:a.s+SPECS.car.length/2,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=[a,b];
  for(let i=0;i<60;i++)sim.step();
  assert.equal(a.state,'red-light');assert.ok(a.s<=30+.001);
  assert.ok(Math.abs(a.pose.x)<1e-8);
});
