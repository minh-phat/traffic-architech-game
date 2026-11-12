import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Simulation, Route, demoWorld, pt, overlaps, planRoute, SPECS, sampled, dist, type Vehicle, type VehicleKind } from '../src/simulation';

function seeded(seed=42){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function assertNoOverlap(sim:Simulation){for(let i=0;i<sim.vehicles.length;i++)for(let j=i+1;j<sim.vehicles.length;j++){const a=sim.vehicles[i],b=sim.vehicles[j];if(a.inGarage||b.inGarage)continue;assert.equal(overlaps(a.pose,a.kind,b.pose,b.kind,0),false,`Vehicles ${a.id}/${b.id} intersect at t=${sim.time.toFixed(2)}`);}}
function vehicle(id:number,route:Route,s=0,kind:VehicleKind='car'):Vehicle{return {id,kind,route,s,offset:0,targetOffset:0,speed:6,pose:route.at(s),waiting:0,age:0,arrived:false,blocked:false,decision:0};}
function house(id:number,x:number,z:number,angle=0){return {id,x,z,angle,kind:0};}

test('a direct trip on one two-way road never detours to a dead end',()=>{
  const world=new World();world.addRoad([pt(-50,0),pt(50,0)]);
  for(const side of [-12,12])for(const direction of [-1,1]){
    const route=planRoute(world,house(1,-15*direction,side,side>0?Math.PI:0),house(2,15*direction,side,side>0?Math.PI:0))!;
    assert.ok(route);assert.ok(route.total<55,`A 30m trip took ${route.total.toFixed(1)}m`);
    assert.ok(route.points.every(p=>Math.abs(p.x)<20),'Route must not visit either end of the road');
  }
});
test('splitting a road leaves no zero-length segments at the new connection',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  for(const road of world.roads)for(let i=1;i<road.points.length;i++)assert.ok(dist(road.points[i-1],road.points[i])>.001);
});
test('straight traffic across a connection keeps its forward heading',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  const route=planRoute(world,house(1,-25,-12),house(2,25,-12))!;
  for(let s=0;s<route.total;s+=.2){const p=route.at(s);if(Math.abs(p.x)<9&&Math.abs(p.z)<6)assert.ok(Math.sin(p.angle)>.95,`Heading reversed near connection: ${p.angle}`);}
});
test('a right turn follows one continuous bend instead of hooking back at the node',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  const route=planRoute(world,house(1,-25,-12),house(2,-12,25,Math.PI/2))!;
  let crossed=false;
  for(let s=0;s<route.total;s+=.2){const p=route.at(s);if(Math.abs(p.x)<8&&Math.abs(p.z)<8){crossed=true;assert.ok(Math.sin(p.angle)>-.05,'Turn must not point back west');assert.ok(Math.cos(p.angle)>-.05,'Turn must not point back north');}}
  assert.ok(crossed);assert.ok(route.total<80);
});
test('saved maps with duplicate connection samples are repaired on load',()=>{
  const world=new World();world.addRoad([pt(-30,0),pt(0,0)]);world.addRoad([pt(0,0),pt(30,0)]);
  world.roads[1].points.unshift({...world.roads[1].points[0]});
  const loaded=new World();loaded.restore(world.serialize());
  assert.ok(dist(loaded.roads[1].points[0],loaded.roads[1].points[1])>0);
  const route=planRoute(loaded,house(1,-20,-12),house(2,20,-12))!;
  assert.ok(route.total<65);
});
test('one-way roads do not gain wrong-way shortcuts',()=>{
  const world=new World();world.addRoad([pt(-30,0),pt(30,0)],5,true);
  assert.ok(planRoute(world,house(1,-15,-12),house(2,15,-12)));
  assert.equal(planRoute(world,house(1,15,-12),house(2,-15,-12)),null);
});
test('a car parked beside the junction does not stop a clear through lane',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  const lane=new Route(sampled([pt(-30,-2.5),pt(30,-2.5)]).map(p=>({...p,width:5})),[]);
  const side=new Route(sampled([pt(0,6),pt(0,30)]).map(p=>({...p,width:5})),[{x:0,z:14,offset:0}]);
  const sim=new Simulation(world,seeded());sim.target=0;sim.time=2;
  const driver=vehicle(2,lane,16),parked=vehicle(1,side);parked.speed=0;sim.vehicles=[parked,driver];
  for(let i=0;i<240;i++){sim.step();assertNoOverlap(sim);}
  assert.ok(driver.s>43,`Unrelated stopped car delayed clear lane: ${driver.s}`);
});
test('opposing vehicles with clear separate lanes do not lock each other out of a junction',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  const east=new Route(sampled([pt(-30,-2.5),pt(30,-2.5)]).map(p=>({...p,width:5})),[]);
  const west=new Route(sampled([pt(30,2.5),pt(-30,2.5)]).map(p=>({...p,width:5})),[]);
  const sim=new Simulation(world,seeded());sim.target=0;sim.vehicles=[vehicle(1,east,16),vehicle(2,west,16)];
  for(let i=0;i<240;i++){sim.step();assertNoOverlap(sim);}
  assert.ok(sim.vehicles.every(v=>v.s>43),`Clear lanes stopped: ${sim.vehicles.map(v=>v.s.toFixed(1))}`);
});
test('a stopped vehicle can accelerate in a clear lane beside an unrelated red-light queue',()=>{
  const lane=new Route(sampled([pt(-30,-2.5),pt(30,-2.5)]).map(p=>({...p,width:5})),[]);
  const side=new Route(sampled([pt(0,6),pt(0,30)]).map(p=>({...p,width:5})),[]);
  side.signals=[{s:SPECS.car.length/2,light:{x:0,z:14,offset:0},vertical:true}];
  const sim=new Simulation(new World(),seeded());sim.target=0;sim.time=2;
  const driver=vehicle(2,lane,26),queued=vehicle(1,side);driver.speed=queued.speed=0;driver.waiting=queued.waiting=8;sim.vehicles=[queued,driver];
  for(let i=0;i<120;i++){sim.step();assertNoOverlap(sim);}
  assert.equal(queued.s,0);assert.ok(driver.s>29,`Clear driver reversed or stayed stuck: ${driver.s}`);
});
test('vehicles on colliding approaches yield and both finish without overlapping',()=>{
  const east=new Route(sampled([pt(-30,0),pt(30,0)]).map(p=>({...p,width:5})),[]);
  const south=new Route(sampled([pt(0,-30),pt(0,30)]).map(p=>({...p,width:5})),[]);
  for(const kind of ['car','truck'] as const){
    const sim=new Simulation(new World(),seeded());sim.target=0;sim.vehicles=[vehicle(1,east,12,kind),vehicle(2,south,12,kind)];
    for(let i=0;i<1800;i++){sim.step();assertNoOverlap(sim);}
    assert.equal(sim.completed,2,`${kind} pair remained blocked at an empty crossing`);
  }
});
test('all eight left/right turns keep a continuous forward bend through the connection',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(40,0)]);world.addRoad([pt(0,-40),pt(0,40)]);
  const incoming=[house(1,-25,-12,0),house(1,12,-25,-Math.PI/2),house(1,25,12,Math.PI),house(1,-12,25,Math.PI/2)];
  const outgoing=[house(2,25,-12,0),house(2,12,25,-Math.PI/2),house(2,-25,12,Math.PI),house(2,-12,-25,Math.PI/2)];
  const headings=[pt(1,0),pt(0,1),pt(-1,0),pt(0,-1)];
  for(let i=0;i<4;i++)for(const turn of [1,3]){
    const j=(i+turn)%4,route=planRoute(world,incoming[i],outgoing[j])!;let crossed=false;
    assert.ok(route);assert.ok(route.total<80);
    for(let s=0;s<route.total;s+=.25){const p=route.at(s);if(Math.abs(p.x)<8&&Math.abs(p.z)<8){
      crossed=true;for(const h of [headings[i],headings[j]])assert.ok(Math.sin(p.angle)*h.x+Math.cos(p.angle)*h.z>-.05,`Turn ${i} -> ${j} hooks backwards`);
    }}
    assert.ok(crossed);
  }
});
test('joining roads of different widths produces no abrupt heading reversal',()=>{
  const world=new World();world.addRoad([pt(-40,0),pt(0,0)],3);world.addRoad([pt(0,0),pt(40,0)],8);
  const route=planRoute(world,house(1,-25,-14),house(2,25,-14))!;
  for(let s=0;s<route.total;s+=.25){const p=route.at(s);if(Math.abs(p.x)<10)assert.ok(Math.sin(p.angle)>.8);}
  assert.equal(route.at(route.total+12).angle,route.at(route.total).angle);
});
test('roads connect at ground crossings, while bridges remain separate',()=>{
  const w=new World();w.addRoad([pt(-20,0),pt(20,0)]);w.addRoad([pt(0,-20),pt(0,20)]);assert.equal(w.roads.length,4);
  w.addRoad([pt(-10,-20,6),pt(-10,20,6)]);assert.equal(w.roads.length,5);
});
test('roundabout clips crossing roads and reconnects all four branches',()=>{
  const w=new World();w.addRoad([pt(-40,0),pt(40,0)]);w.addRoad([pt(0,-40),pt(0,40)]);w.roundabout(pt(0,0));
  assert.equal(w.roads.filter(r=>r.oneWay).length,4);
  const from={id:500,x:-30,z:12,kind:0,angle:Math.PI},to={id:501,x:12,z:30,kind:0,angle:-Math.PI/2};
  assert.ok(planRoute(w,from,to));
});
test('oriented bounds respect width, heading and bridge clearance',()=>{
  const a={...pt(0,0),angle:0};assert.equal(overlaps(a,'truck',{...pt(3,0),angle:0},'bike'),false);
  assert.equal(overlaps(a,'truck',{...pt(0,0),angle:Math.PI/2},'car'),true);
  assert.equal(overlaps(a,'truck',{...pt(0,0,6),angle:0},'car'),false);
});
test('serialization retains geometry, buildings and lights',()=>{const w=demoWorld(),copy=new World();copy.restore(w.serialize());assert.equal(copy.serialize(),w.serialize());assert.ok(w.houses.length>15);});
test('multiple motorbikes travel side by side within a 5 m direction',()=>{
  const w=new World(),sim=new Simulation(w,seeded());sim.target=0;
  const route=new Route([{...pt(0,-50),width:5},{...pt(0,50),width:5}],[]);
  sim.vehicles=[-1.3,0,1.3].map((offset,i)=>({id:i,kind:'bike' as VehicleKind,route,s:10,offset,targetOffset:offset,speed:6,pose:route.at(10,offset),waiting:0,age:0,arrived:false,blocked:false,decision:99}));
  for(let i=0;i<300;i++){sim.step();assertNoOverlap(sim);}
  assert.equal(sim.vehicles.length,3);assert.ok(sim.vehicles.every(v=>v.s>35));
});
test('a truck and motorbike share a 5 m direction without touching',()=>{
  const sim=new Simulation(new World(),seeded());sim.target=0;
  const route=new Route([{...pt(0,-50),width:5},{...pt(0,50),width:5}],[]);
  sim.vehicles=([{kind:'truck',offset:-.9},{kind:'bike',offset:1.3}] as const).map((entry,id)=>({id:id+1,kind:entry.kind,route,s:10,offset:entry.offset,targetOffset:entry.offset,speed:4,pose:route.at(10,entry.offset),waiting:0,age:0,arrived:false,blocked:false,decision:99}));
  for(let i=0;i<300;i++){sim.step();assertNoOverlap(sim);}
  assert.ok(sim.vehicles.every(v=>v.s>30));
});
test('vehicles stop before a red signal and resume on green',()=>{
  const light={x:0,z:0,offset:0};const sim=new Simulation(new World(),seeded());sim.target=0;sim.time=12;
  const route=new Route([{...pt(-40,0),width:5},{...pt(40,0),width:5}],[light]);
  const vehicle:Vehicle={id:1,kind:'car',route,s:18,offset:0,targetOffset:0,speed:6,pose:route.at(18),waiting:0,age:0,arrived:false,blocked:false,decision:0};sim.vehicles=[vehicle];
  for(let i=0;i<360;i++)sim.step();assert.ok(vehicle.s+SPECS.car.length/2<=route.signals[0].s+.1);const stopped=vehicle.s;
  sim.time=25;for(let i=0;i<180;i++)sim.step();assert.ok(vehicle.s>stopped+5);
});
test('mixed traffic never overlaps during a deterministic 120-second city simulation',()=>{
  const sim=new Simulation(demoWorld(),seeded());sim.target=60;
  for(let i=0;i<7200;i++){sim.step();assertNoOverlap(sim);}
  const kinds=new Set(sim.vehicles.map(v=>v.kind));assert.equal(kinds.size,3);assert.ok(sim.completed>8,`Only ${sim.completed} completed`);
  console.log(`120 s: ${sim.completed} completed, ${sim.vehicles.length} active; no overlaps.`);
});
test('paused simulation leaves time and vehicle positions unchanged',()=>{const sim=new Simulation(demoWorld(),seeded());for(let i=0;i<180;i++)sim.step();const before=JSON.stringify(sim.vehicles);sim.paused=true;const time=sim.time;sim.step();assert.equal(sim.time,time);assert.equal(JSON.stringify(sim.vehicles),before);});

test('moderate city traffic drains after spawning stops instead of locking at crossings',()=>{
  for(const side of ['right','left'] as const)for(const dt of [1/30,1/60])for(const seed of [1,7,42]){
    const world=demoWorld();world.setDrivingSide(side);
    const sim=new Simulation(world,seeded(seed));sim.target=25;
    // Two minutes of arrivals, followed by four minutes to clear the network.
    for(let i=0;i<Math.round(360/dt);i++){
      if(i===Math.round(120/dt))sim.target=0;
      sim.step(dt);assertNoOverlap(sim);
    }
    assert.ok(sim.completed>25,`Seed ${seed}: insufficient completed trips`);
    assert.equal(sim.vehicles.length,0,`Side ${side}, seed ${seed}, dt=${dt}: ${sim.vehicles.length} vehicles failed to clear`);
  }
});

test('right-hand traffic is the default and switching sides mirrors both travel directions',()=>{
  const world=new World();world.addRoad([pt(-50,0),pt(50,0)]);
  assert.equal(world.drivingSide,'right');
  for(const side of ['right','left'] as const){
    world.setDrivingSide(side);
    for(const direction of [-1,1]){
      const z=(side==='right'?1:-1)*direction*12;
      const route=planRoute(world,house(1,-25*direction,z,z>0?Math.PI:0),house(2,25*direction,z,z>0?Math.PI:0))!;
      let checked=0;
      for(let s=0;s<route.total;s+=.5){const p=route.at(s);if(Math.abs(p.x)<15){
        assert.ok(Math.abs(p.z-(side==='right'?1:-1)*direction*2.5)<.01);
        assert.ok(Math.sin(p.angle)*direction>.99);checked++;
      }}
      assert.ok(checked>20);
    }
  }
});
test('driving side persists and old saves default to the right',()=>{
  const world=demoWorld();world.setDrivingSide('left');
  const copy=new World();copy.restore(world.serialize());
  assert.equal(copy.drivingSide,'left');assert.equal(copy.serialize(),world.serialize());
  const legacy=JSON.parse(world.serialize());delete legacy.drivingSide;
  copy.restore(JSON.stringify(legacy));assert.equal(copy.drivingSide,'right');
});
test('switching driving side reverses roundabouts while retaining explicit one-way roads',()=>{
  for(const side of ['right','left'] as const){
    const world=new World();world.setDrivingSide(side);world.roundabout(pt(0,0));
    const signedTurn=()=>world.roads.filter(r=>r.roundabout).reduce((sum,r)=>sum+r.points.slice(1).reduce((s,p,i)=>s+r.points[i].x*p.z-p.x*r.points[i].z,0),0);
    assert.ok(signedTurn()*(side==='right'?-1:1)>0);
    world.addRoad([pt(30,0),pt(60,0)],5,true);const road=world.roads.at(-1)!,before=JSON.stringify(road.points);
    world.setDrivingSide(side==='right'?'left':'right');
    assert.ok(signedTurn()*(side==='right'?1:-1)>0);
    assert.equal(JSON.stringify(road.points),before);
    assert.equal(planRoute(world,house(1,50,-12),house(2,40,-12)),null);
  }
});


test('legacy roundabout saves adopt the default driving side and remain switchable',()=>{
  const old=new World();old.setDrivingSide('left');old.roundabout(pt(5,-8));
  old.addRoad([pt(30,0),pt(60,0)],5,true);
  const saved=JSON.parse(old.serialize());delete saved.drivingSide;
  for(const road of saved.roads)delete road.roundabout;
  const loaded=new World();loaded.restore(JSON.stringify(saved));
  assert.equal(loaded.drivingSide,'right');
  const arcs=loaded.roads.filter(r=>r.roundabout);assert.equal(arcs.length,4);
  for(const arc of arcs){const original=old.roads.find(r=>r.id===arc.id)!;assert.deepEqual(arc.points,[...original.points].reverse());}
  const straight=loaded.roads.at(-1)!;assert.equal(straight.roundabout,undefined);
  const before=JSON.stringify(straight.points);loaded.setDrivingSide('left');
  assert.equal(JSON.stringify(straight.points),before);
  for(const arc of arcs)assert.deepEqual(arc.points,old.roads.find(r=>r.id===arc.id)!.points);
});

test('turn preparation moves toward the turn within the lane',()=>{
  for(const direction of [-1,1]){
    const route=new Route(sampled([pt(0,-35),pt(0,0),pt(direction*30,0)]).map(p=>({...p,width:5})),[]);
    assert.equal(route.turns.length,1);
    assert.equal(route.turns[0].direction,direction);
    const sim=new Simulation(new World(),seeded());sim.target=0;
    const driver=vehicle(1,route,route.turns[0].start-14);sim.vehicles=[driver];
    for(let i=0;i<60;i++)sim.step();
    assert.ok(driver.offset*direction>.3);
    assert.ok(Math.abs(driver.offset)<(5-SPECS.car.width)/2);
  }
});

test('turning traffic yields to a conflicting straight vehicle regardless of ID',()=>{
  for(const turningId of [1,2]){
    const turn=new Route(sampled([pt(-30,0),pt(0,0),pt(0,30)]).map(p=>({...p,width:5})),[]);
    const straight=new Route(sampled([pt(0,30),pt(0,-30)]).map(p=>({...p,width:5})),[]);
    const sim=new Simulation(new World(),seeded());sim.target=0;
    const turning=vehicle(turningId,turn,turn.turns[0].start-10);
    const through=vehicle(3-turningId,straight,12);
    sim.vehicles=[turning,through];
    sim.step();
    // These approaches have a predicted conflict within the safety horizon.
    // Priority permits proceeding once clear; it cannot require keeping speed.
    for(const v of [turning,through]){
      assert.ok(v.speed>=6-SPECS.car.emergencyBrake/60-1e-8,'Early yielding respects the braking limit');
      assert.notEqual(v.reason,'Đánh lái qua khoảng trống an toàn','Moving crossing traffic is resolved by yielding');
    }
    let yielded=false;
    for(let i=0;i<1200;i++){sim.step();assertNoOverlap(sim);if(turning.state==='yielding'&&turning.blockerId===through.id)yielded=true;}
    assert.ok(yielded,'Turner yields once the through vehicle is nearby in front');
    assert.equal(sim.completed,2);
  }
});

test('a departing vehicle reverses fully into its garage and waits for the arrival',()=>{
  const outgoing=new Route([{...pt(0,0),width:3.6},{...pt(0,40),width:3.6}],[]);
  const incoming=new Route([{...pt(0,40),width:3.6},{...pt(0,0),width:3.6}],[]);
  outgoing.fromHouse=1;outgoing.departureLength=12;
  incoming.toHouse=1;incoming.arrivalLength=20;
  const sim=new Simulation(new World(),seeded());sim.target=0;
  const leaving=vehicle(1,outgoing,.8),arriving=vehicle(2,incoming,27);
  leaving.speed=arriving.speed=0;sim.vehicles=[leaving,arriving];
  let parked=false;
  for(let i=0;i<2400;i++){
    sim.step();assertNoOverlap(sim);
    if(leaving.inGarage){parked=true;assert.equal(leaving.s,0);}
    if(parked&&!arriving.arrived)assert.equal(leaving.inGarage,true);
  }
  assert.ok(parked,'Departing driver must retreat into garage');
  assert.equal(sim.completed,2);
});

test('lateral manoeuvres rotate the body with bounded angular speed',()=>{
  const route=new Route([{...pt(0,0),width:8},{...pt(0,80),width:8}],[]);
  const sim=new Simulation(new World(),seeded());sim.target=0;
  const driver=vehicle(1,route,10);driver.targetOffset=2;driver.decision=99;sim.vehicles=[driver];
  let turned=false;
  for(let i=0;i<90;i++){
    const previous=driver.pose.angle;sim.step();
    assert.ok(Math.abs(driver.pose.angle-previous)<=1.8/60+.00001);
    if(Math.abs(driver.pose.angle)>.1)turned=true;
  }
  assert.ok(turned);assert.ok(driver.offset>1.9);
});


test('only vehicles still straddling the doorway yield to a house arrival',()=>{
  for(const kind of ['bike','car','truck'] as const)for(const cleared of [false,true]){
    const outgoing=new Route([{...pt(0,0),width:5},{...pt(0,40),width:5}],[]);
    const incoming=new Route([{...pt(0,40),width:5},{...pt(0,0),width:5}],[]);
    outgoing.fromHouse=1;outgoing.departureLength=12;
    incoming.toHouse=1;incoming.arrivalLength=20;
    const sim=new Simulation(new World(),seeded());sim.target=0;
    const leaving=vehicle(1,outgoing,SPECS[kind].length/2+(cleared?.2:-.2),kind);
    const arriving=vehicle(2,incoming,31);leaving.speed=arriving.speed=0;
    sim.vehicles=[leaving,arriving];sim.step();assertNoOverlap(sim);
    assert.equal(leaving.garageYield,cleared?undefined:arriving.id);
    assert.equal(!!leaving.leftHouse,cleared);
  }
});

test('a driver uses a clear side gap without reversing toward a following car',()=>{
  const lane=new Route([{...pt(0,0),width:8},{...pt(0,100),width:8}],[]);
  const parkedRoute=new Route([{...pt(0,0),width:8},{...pt(0,100),width:8}],[]);
  parkedRoute.signals=[{s:28+SPECS.car.length/2,light:{x:0,z:28,offset:0},vertical:true}];
  const sim=new Simulation(new World(),seeded());sim.target=0;sim.time=2;
  const driver=vehicle(1,lane,20),parked=vehicle(2,parkedRoute,28),follower=vehicle(3,lane,15);
  driver.speed=parked.speed=follower.speed=0;driver.waiting=8;
  sim.vehicles=[driver,parked,follower];
  let previous=driver.s;
  for(let i=0;i<360;i++){
    sim.step();assertNoOverlap(sim);
    assert.ok(driver.s>=previous-.00001,'Driver must steer forward instead of reversing into its follower');
    previous=driver.s;
  }
  assert.ok(driver.s>30,'Driver should pass the obstruction through the available side gap');
});
