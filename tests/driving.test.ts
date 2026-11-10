import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Simulation, Route, SPECS, overlaps, pt, sampled, signalState, planRoute, type Vehicle, type VehicleKind, type Movement } from '../src/simulation';

function driver(id:number,route:Route,s=0,kind:VehicleKind='car',speed=0):Vehicle{return {id,route,s,kind,speed,offset:0,targetOffset:0,pose:route.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:0};}
function road(points:ReturnType<typeof pt>[],width=5){return new Route(sampled(points).map(p=>({...p,width})),[]);}
function simulation(vehicles:Vehicle[]){const sim=new Simulation(new World(),()=>.5);sim.target=0;sim.vehicles=vehicles;return sim;}
function run(sim:Simulation,seconds:number,check?:(v:Vehicle[])=>void,dt=1/60){for(let i=0;i<seconds/dt;i++){sim.step(dt);for(let a=0;a<sim.vehicles.length;a++)for(let b=a+1;b<sim.vehicles.length;b++){const v=sim.vehicles[a],o=sim.vehicles[b];if(!v.inGarage&&!o.inGarage)assert.equal(overlaps(v.pose,v.kind,o.pose,o.kind,0),false);}check?.(sim.vehicles);}}
function movement(route:Route,changes:Partial<Movement>={}):Movement {const m:Movement={id:'junction',entry:24,exit:38,stop:24,center:pt(0,0),incoming:route.at(10).angle,outgoing:route.at(45).angle,turn:0,priority:0,control:'none',mode:'priority',circulating:false,enteringRoundabout:false,...changes};route.movements=[m];return m;}

test('a long red queue never reverses or drifts sideways, at 30 and 60 Hz',()=>{
  for(const dt of [1/30,1/60]){
    const lane=road([pt(0,-60),pt(0,100)],3.2);lane.signals=[{s:42,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]},vertical:true}];
    const cars=[driver(1,lane,40),driver(2,lane,34),driver(3,lane,28),driver(4,lane,22)];const sim=simulation(cars);
    const positions=cars.map(v=>v.s);run(sim,18,()=>cars.forEach((v,i)=>{assert.ok(v.s>=positions[i]-1e-6);assert.ok(Math.abs(v.pose.x)<1e-6);assert.notEqual(v.state,'reversing');positions[i]=v.s;}),dt);
    assert.equal(cars[0].state,'red-light');assert.ok(cars.every(v=>(v.stuckTime??0)===0));
  }
});

test('red is a hard geometric limit even when it changes immediately before the nose',()=>{
  const lane=road([pt(0,-50),pt(0,50)]);lane.signals=[{s:30,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]},vertical:true}];
  const v=driver(1,lane,30-SPECS.car.length/2-.01,'car',8),sim=simulation([v]);run(sim,2);assert.ok(v.s+SPECS.car.length/2<=30+.001);
});

test('yellow stops a distant car but lets a committed car clear',()=>{
  const light={x:0,z:0,offset:0,phases:[{duration:60,horizontal:'yellow' as const,vertical:'red' as const}]};
  const a=road([pt(-50,0),pt(50,0)]),b=road([pt(-50,12),pt(50,12)]);a.signals=[{s:40,light,vertical:false}];b.signals=[{s:40,light,vertical:false}];
  const distant=driver(1,a,15,'car',4),committed=driver(2,b,37,'car',7),sim=simulation([distant,committed]);sim.step();assert.equal(distant.state,'red-light');assert.equal(committed.state,'driving');run(sim,2);assert.ok(committed.s>40);
});

test('protected turn phases distinguish straight, left, and right and survive saves',()=>{
  const light={x:0,z:0,offset:0,phases:[{duration:4,horizontal:'green' as const,vertical:'red' as const,turns:'left' as const},{duration:2,horizontal:'red' as const,vertical:'red' as const}]};
  assert.equal(signalState(1,light,false,'left'),'green');assert.equal(signalState(1,light,false,'straight'),'red');assert.equal(signalState(1,light,false,'right'),'red');assert.equal(signalState(5,light,false,'left'),'red');
  const world=new World();world.lights=[light];const copy=new World();copy.restore(world.serialize());assert.deepEqual(copy.lights,world.lights);
});

// Priority assertions start with nearby cars; distant approaches may advance first.
test('priority roads beat arrival and vehicle ID only where trajectories conflict',()=>{
  for(const highId of [1,99]){
    const east=road([pt(-35,0),pt(35,0)]),south=road([pt(0,-35),pt(0,35)]);movement(east,{priority:1});movement(south);
    const high=driver(highId,east,27.5,'car',5),low=driver(100-highId,south,27.5,'car',5),sim=simulation([low,high]);sim.step();
    assert.equal(low.state,'yielding');assert.notEqual(high.state,'yielding');run(sim,25);assert.equal(sim.completed,2);
  }
});

test('a circulating vehicle gets priority over a stopped roundabout entrant',()=>{
  const ring=road([pt(-35,0),pt(35,0)]),entry=road([pt(0,-35),pt(0,35)]);movement(ring,{circulating:true});movement(entry,{enteringRoundabout:true});
  const circulating=driver(50,ring,30,'car',5),entering=driver(1,entry,30),sim=simulation([entering,circulating]);sim.step();assert.equal(entering.state,'yielding');assert.notEqual(circulating.state,'yielding');run(sim,25);assert.equal(sim.completed,2);
});

test('a curved priority road is not classified as a yielding turn just for bending',()=>{
  const main=road([pt(-40,0),pt(0,0),pt(0,35)]),minor=road([pt(0,35),pt(0,-35)]);movement(main,{priority:2,turn:-1});movement(minor,{priority:0,incoming:Math.PI});
  const a=driver(10,main,32,'car',5),b=driver(1,minor,29,'car',5),sim=simulation([a,b]);sim.step();assert.notEqual(a.state,'yielding');assert.equal(b.state,'yielding');
});

test('a mandatory stop lasts a full second before taking an empty intersection',()=>{
  const lane=road([pt(0,-35),pt(0,35)]);movement(lane,{control:'stop'});const v=driver(1,lane,24-SPECS.car.length/2-.15),sim=simulation([v]);
  run(sim,.8);assert.equal(v.state,'stopping');const stopped=v.s;run(sim,2);assert.ok(v.s>stopped+1);
});

test('an occupied exit holds a car outside the intersection without reversing',()=>{
  const lane=road([pt(0,-35),pt(0,60)]),parkRoute=road([pt(0,-35),pt(0,60)]);movement(lane);
  parkRoute.signals=[{s:41+SPECS.car.length/2,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const lead=driver(1,parkRoute,41),v=driver(2,lane,14,'car',4),sim=simulation([v,lead]);run(sim,12,()=>assert.notEqual(v.state,'reversing'));assert.ok(v.s+SPECS.car.length/2<24);assert.equal(v.state,'exit-blocked');
});

test('car and truck cannot translate or rotate at rest to escape an obstacle',()=>{
  for(const kind of ['car','truck'] as const){const lane=road([pt(0,0),pt(0,80)],8);lane.signals=[{s:10+SPECS[kind].length/2,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];const v=driver(1,lane,10,kind),sim=simulation([v]);v.targetOffset=2;v.decision=99;const before={...v.pose};run(sim,6);assert.equal(v.pose.x,before.x);assert.equal(v.pose.z,before.z);assert.equal(v.pose.angle,before.angle);}
});

test('lateral displacement follows a bicycle arc rather than a sideways translation',()=>{
  for(const kind of ['car','truck'] as const){const lane=road([pt(0,0),pt(0,100)],10),v=driver(1,lane,10,kind,3),sim=simulation([v]);v.targetOffset=2;v.decision=99;
    for(let i=0;i<90;i++){const before={...v.pose};sim.step();const dx=v.pose.x-before.x,dz=v.pose.z-before.z,mid=(before.angle+v.pose.angle)/2;assert.ok(Math.abs(dx*Math.cos(mid)-dz*Math.sin(mid))<1e-7);assert.ok(Math.abs(v.steering??0)<=SPECS[kind].maxSteer+1e-6);}
    assert.ok(v.offset>.5);
  }
});

test('a truck brakes earlier and takes a tight curve slower than a car',()=>{
  function sample(kind:VehicleKind){const lane=road([pt(0,-45),pt(0,0),pt(40,0)],8),v=driver(1,lane,20,kind,5),sim=simulation([v]);let minimum=10;run(sim,5,()=>{if(v.s>32&&v.s<48)minimum=Math.min(minimum,v.speed);});return minimum;}
  assert.ok(sample('truck')<sample('car'));
});

test('a moving follower prevents a lane change that would force abrupt braking',()=>{
  const lane=road([pt(0,0),pt(0,120)],8),v=driver(1,lane,30,'car',2),follower=driver(2,lane,25,'car',8);follower.offset=follower.targetOffset=2.7;follower.pose=lane.at(25,2.7);follower.decision=99;
  const obstacleRoute=road([pt(0,0),pt(0,120)],8);obstacleRoute.signals=[{s:38+SPECS.car.length/2,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];const obstacle=driver(3,obstacleRoute,38),sim=simulation([v,follower,obstacle]);sim.step();assert.ok(v.targetOffset<1);
});

test('reverse has a signed velocity, brake lights, and no overlap at the garage',()=>{
  const out=road([pt(0,0),pt(0,45)],3.6),into=road([pt(0,45),pt(0,0)],3.6);out.fromHouse=1;out.departureLength=12;into.toHouse=1;into.arrivalLength=20;
  const a=driver(1,out,.8),b=driver(2,into,30),sim=simulation([a,b]);let reversed=false;
  run(sim,3,()=>{if((a.velocity??0)<0){reversed=true;assert.equal(a.state,'reversing');assert.ok(a.speed>0);}});assert.ok(reversed);assert.equal(a.inGarage,true);
});

test('approach controls, priority, and zipper settings persist across road splits',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);Object.assign(world.roads[0],{priority:2,control:'yield',junctionMode:'zipper'});world.addRoad([pt(0,-40),pt(0,40)]);
  const copy=new World();copy.restore(world.serialize());const pieces=copy.roads.filter(r=>r.points.every(p=>p.z===0));assert.equal(pieces.length,2);assert.ok(pieces.every(r=>r.priority===2&&r.control==='yield'&&r.junctionMode==='zipper'));
  const route=planRoute(copy,{id:50,x:-25,z:12,angle:Math.PI,kind:0},{id:51,x:25,z:12,angle:Math.PI,kind:0})!;assert.ok(route.movements.some(m=>m.priority===2&&m.control==='yield'&&m.mode==='zipper'));
});

test('a genuine head-on lock selects one reversing car and protects its stopped follower',()=>{
  const east=road([pt(-40,0),pt(40,0)],3.2),west=road([pt(40,0),pt(-40,0)],3.2);
  const a=driver(1,east,37),b=driver(2,west,37),follower=driver(3,east,32);a.waiting=b.waiting=5;
  const sim=simulation([a,b,follower]);let reversed=false;let previousA=a.s;
  run(sim,15,()=>{const reversing=sim.vehicles.filter(v=>v.state==='reversing');assert.ok(reversing.length<=1);if((b.velocity??0)<0)reversed=true;assert.ok(a.s>=previousA-.001,'Do not back into a stopped follower');previousA=a.s;});assert.ok(reversed);
});

test('normal speed and stopping behavior are stable across integration rates',()=>{
  function sample(dt:number){const lane=road([pt(0,0),pt(0,150)]),v=driver(1,lane,10),sim=simulation([v]);run(sim,8,undefined,dt);return {s:v.s,speed:v.speed};}
  const a=sample(1/30),b=sample(1/60);assert.ok(Math.abs(a.s-b.s)<.15);assert.ok(Math.abs(a.speed-b.speed)<.05);
});

test('turn indicators use the physical left/right turn, including mirrored traffic',()=>{
  for(const direction of [-1,1]){const lane=road([pt(0,-35),pt(0,0),pt(direction*30,0)]),v=driver(1,lane,20,'car',2),sim=simulation([v]);sim.step();assert.equal(v.indicator,-direction);}
});

test('zipper admission alternates branches after a vehicle enters the merge',()=>{
  const branchA=road([pt(-30,0),pt(0,0),pt(0,50)]),branchB=road([pt(0,-30),pt(0,50)]);
  movement(branchA,{mode:'zipper',turn:-1});movement(branchB,{mode:'zipper'});
  const first=driver(1,branchA,23,'car',4),sim=simulation([first]);run(sim,25);assert.equal(first.arrived,true);
  const a=driver(2,branchA,26,'car',4),b=driver(3,branchB,26,'car',4);sim.vehicles=[a,b];sim.step();
  assert.equal(a.state,'yielding');assert.notEqual(b.state,'yielding');run(sim,40);assert.equal(sim.completed,3);
});

test('a turning leader clears before the vehicle already following it',()=>{
  const through=road([pt(-30,0),pt(35,0)]),turn=road([pt(-4,-20),pt(-4,0),pt(35,0)]);
  const follower=driver(1,through,20,'bike'),lead=driver(2,turn,21,'car');
  follower.state='following';follower.blockerId=lead.id;const sim=simulation([follower,lead]);
  run(sim,30);assert.equal(sim.completed,2);
});

test('brake lights follow deceleration and the normal stop instead of the spawn ID',()=>{
  const lane=road([pt(0,0),pt(0,80)]);lane.signals=[{s:24,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const v=driver(99,lane,18,'car',5),sim=simulation([v]);sim.step();assert.equal(v.braking,true);run(sim,4);assert.equal(v.braking,true);assert.equal(v.speed,0);
});

test('one all-way-stop setting controls every incoming approach at that node',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);world.roads[0].junctionMode='all-way-stop';
  const route=planRoute(world,{id:50,x:12,z:-25,angle:-Math.PI/2,kind:0},{id:51,x:12,z:25,angle:-Math.PI/2,kind:0})!;
  assert.ok(route.movements.some(m=>m.mode==='all-way-stop'));
});

test('each traffic reverse stays within four metres of actual travel',()=>{
  const east=road([pt(-40,0),pt(40,0)],3.2),west=road([pt(40,0),pt(-40,0)],3.2);
  const a=driver(1,east,37),b=driver(2,west,37);a.waiting=b.waiting=5;const sim=simulation([a,b]);
  const totals=new Map<number,number>();let sawReverse=false;
  run(sim,18,()=>{for(const v of [a,b]){if(v.state==='reversing'){sawReverse=true;totals.set(v.id,(totals.get(v.id)??0)+Math.max(0,-(v.velocity??0))/60);assert.ok(totals.get(v.id)!<=4.02);}else totals.set(v.id,0);}});
  assert.ok(sawReverse);
});

test('routing chooses a longer open connection when the short connection is congested',()=>{
  const world=new World();world.addRoad([pt(-30,0),pt(0,0)]);world.addRoad([pt(0,0),pt(50,0)]);const direct=world.roads.at(-1)!.id;
  world.addRoad([pt(50,0),pt(80,0)]);world.addRoad([pt(0,0),pt(0,40),pt(50,40),pt(50,0)]);
  const from={id:100,x:-20,z:12,angle:Math.PI,kind:0},to={id:101,x:70,z:12,angle:Math.PI,kind:0};
  const normal=planRoute(world,from,to,{kind:'car'})!,detour=planRoute(world,from,to,{kind:'car',roadDelay:new Map([[direct,1000]])})!;
  assert.ok(Math.max(...normal.points.map(p=>p.z))<20);assert.ok(Math.max(...detour.points.map(p=>p.z))>30);assert.ok(detour.total>normal.total);
});

test('a car slightly across the centre can steer back into its assigned carriageway',()=>{
  const world=new World();world.addRoad([pt(-50,0),pt(50,0)]);
  const lane=road([pt(-50,2.5),pt(50,2.5)]),v=driver(1,lane,20);v.pose={...v.pose,z:-.06,angle:Math.PI/2-.3};v.offset=2.56;v.targetOffset=0;
  const sim=new Simulation(world,()=>.5);sim.target=0;sim.vehicles=[v];run(sim,8);assert.ok(v.s>30);assert.ok(Math.abs(v.offset)<.5);
});

test('a truck nearly tangent to a road edge can accelerate along an inward steering arc',()=>{
  const world=new World();world.addRoad([pt(-80,-40),pt(80,-40)]);
  const lane=road([pt(-80,-37.5),pt(80,-37.5)]),v=driver(1,lane,30,'truck');
  v.pose={...v.pose,z:-36.04,angle:Math.PI/2-.0012};v.offset=-1.46;v.targetOffset=0;v.steering=.35;
  const sim=new Simulation(world,()=>.5);sim.target=0;sim.vehicles=[v];run(sim,8);
  assert.ok(v.s>40,'Tiny acceleration steps must allow the truck to rejoin the lane');assert.ok(Math.abs(v.offset)<.6);
});

test('an angled vehicle keeps every front corner behind its red stop line',()=>{
  const lane=road([pt(0,0),pt(0,80)]),v=driver(1,lane,14);v.pose={...v.pose,angle:.5};
  const extent=Math.cos(.5)*SPECS.car.length/2+Math.sin(.5)*SPECS.car.width/2,line=14+extent+.001;
  lane.signals=[{s:line,vertical:true,light:{x:0,z:0,offset:0,phases:[{duration:60,horizontal:'red',vertical:'red'}]}}];
  const sim=simulation([v]);run(sim,4,()=>{const front=v.pose.z+Math.abs(Math.cos(v.pose.angle))*SPECS.car.length/2+Math.abs(Math.sin(v.pose.angle))*SPECS.car.width/2;assert.ok(front<=line+.001);});
});

test('a queued driver replans onto an open connection without teleporting or reversing its heading',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(0,0)]);world.addRoad([pt(0,0),pt(50,0)]);world.addRoad([pt(50,0),pt(90,0)]);world.addRoad([pt(0,0),pt(0,40),pt(50,40),pt(50,0)]);
  const from={id:100,x:-25,z:12,angle:Math.PI,kind:0},to={id:101,x:75,z:12,angle:Math.PI,kind:0};world.houses=[from,to];
  const original=planRoute(world,from,to,{kind:'car'})!,v=driver(1,original,original.locate(pt(-8,2.5)).s);v.waiting=26;v.leftHouse=true;
  const holding=road([pt(-40,2.5),pt(90,2.5)]);holding.signals=[{s:38+SPECS.car.length/2,vertical:false,light:{x:-2,z:2.5,offset:0,phases:[{duration:100,horizontal:'red',vertical:'red'}]}}];
  const lead=driver(2,holding,38),bikes=Array.from({length:12},(_,i)=>driver(3+i,holding,43+i*4,'bike'));
  const sim=new Simulation(world,()=>.5);sim.target=0;sim.vehicles=[v,lead,...bikes];const before={...v.pose};sim.step();
  assert.notEqual(v.route,original);assert.ok(Math.hypot(v.pose.x-before.x,v.pose.z-before.z)<.01);assert.ok(Math.abs(v.pose.angle-before.angle)<.01);
  assert.ok(Math.max(...v.route.points.map(p=>p.z))>30);assert.equal(v.route.fromHouse,undefined);
});

test('an all-way stop uses actual arrival at the line rather than early approach detection',()=>{
  const east=road([pt(-35,0),pt(35,0)]),south=road([pt(0,-35),pt(0,35)]);
  for(const lane of [east,south])movement(lane,{entry:32,stop:32,exit:44,mode:'all-way-stop'});
  const a=driver(1,east,30.05),b=driver(2,south,30.05);
  Object.assign(a,{approachId:'junction',approachSince:0,stopTime:1.1,stopSince:3});Object.assign(b,{approachId:'junction',approachSince:1,stopTime:1.1,stopSince:2});
  const sim=simulation([a,b]);sim.time=5;sim.step();assert.equal(a.state,'yielding');assert.notEqual(b.state,'yielding');run(sim,25);assert.equal(sim.completed,2);
});

test('a distant priority vehicle does not stop a driver with a clear road ahead',()=>{
  for(const kind of ['bike','car','truck'] as const)for(const speed of [0,6]){
    const east=road([pt(-40,0),pt(40,0)]),south=road([pt(0,-40),pt(0,40)]);movement(east,{entry:34,stop:34,exit:46});movement(south,{entry:34,stop:34,exit:46,priority:2});
    const v=driver(10,east,35,kind),distant=driver(1,south,10,'car',speed),sim=simulation([v,distant]);
    run(sim,1,()=>{assert.notEqual(v.state,'yielding');assert.notEqual(v.state,'reversing');});assert.ok(v.s>35.4);
  }
});

test('a car behind us cannot claim a yield through a distant future crossing',()=>{
  const lane=road([pt(-40,0),pt(60,0)]),loop=road([pt(-10,0),pt(-10,15),pt(10,15),pt(10,0),pt(60,0)]);
  const v=driver(2,lane,40),behind=driver(1,loop,0,'car',4),sim=simulation([v,behind]);
  run(sim,1,()=>assert.notEqual(v.state,'yielding'));assert.ok(v.s>40.5);
});

test('yield is released immediately after the nearby crossing car has passed',()=>{
  const east=road([pt(-35,0),pt(35,0)]),south=road([pt(0,-35),pt(0,35)]);movement(east,{priority:0});movement(south,{priority:1});
  const v=driver(2,east,28,'car',4),crossing=driver(1,south,30,'car',4),sim=simulation([v,crossing]);sim.step();assert.equal(v.state,'yielding');
  crossing.s=50;crossing.pose=south.at(50);const speed=v.speed;sim.step();assert.notEqual(v.state,'yielding');assert.ok(v.speed>speed);
});

test('an arrival far from the house does not recall a departing car into the garage',()=>{
  const out=road([pt(0,0),pt(0,50)],3.6),into=road([pt(0,50),pt(0,0)],3.6);out.fromHouse=1;out.departureLength=12;into.toHouse=1;into.arrivalLength=45;
  const leaving=driver(1,out,.8),arriving=driver(2,into,15),sim=simulation([leaving,arriving]);leaving.garageYield=arriving.id;run(sim,1);
  assert.equal(leaving.garageYield,undefined);assert.ok(leaving.s>.8);assert.notEqual(leaving.state,'reversing');
});

test('a departure that backed across its doorway can yield to a nearby arrival again',()=>{
  const out=road([pt(0,0),pt(0,45)],3.6),into=road([pt(0,45),pt(0,0)],3.6);
  out.fromHouse=1;out.departureLength=12;into.toHouse=1;into.arrivalLength=20;
  const leaving=driver(1,out,.8),arriving=driver(2,into,30),sim=simulation([leaving,arriving]);leaving.leftHouse=true;
  run(sim,3);assert.equal(leaving.inGarage,true);assert.equal(leaving.garageYield,arriving.id);
});

test('a house arrival can approach while the departure retreats well ahead of it',()=>{
  const out=road([pt(0,0),pt(0,40)],3.6),into=road([pt(0,40),pt(0,0)],3.6);out.fromHouse=1;out.departureLength=12;into.toHouse=1;into.arrivalLength=20;
  const leaving=driver(1,out,.8),arriving=driver(2,into,27),sim=simulation([leaving,arriving]);sim.step();
  assert.equal(leaving.garageYield,arriving.id);assert.ok(arriving.speed>0);assert.notEqual(arriving.state,'yielding');
});

test('a departure approaches a clear merge instead of stopping at the door for distant traffic',()=>{
  const driveway=road([pt(0,0),pt(0,30)],3.6),street=road([pt(-30,10),pt(30,10)]);driveway.fromHouse=1;driveway.departureLength=10;
  const leaving=driver(1,driveway,0,'car',6),through=driver(2,street,14,'car',8),sim=simulation([leaving,through]);sim.step();
  assert.notEqual(leaving.state,'merging');assert.ok(leaving.speed>=6);assert.ok(leaving.s>.09);assert.ok(through.speed>=8);
  run(sim,15);assert.equal(sim.completed,2);
});
