import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import type { Vehicle } from '../src/simulation';
import { defaultObservationProfiles, pointInObservationSector, isObservationPointVisible, observationRayDistance, readObservationProfiles } from '../src/vehicle-observation';
import { VehicleObservationGuide } from '../src/vehicle-observation-guide';

const pose={x:10,y:2,z:20,angle:0};
const point=(x:number,z:number,y=2)=>({x,y,z});
test('3D observation respects horizontal and vertical angles, range, rear direction and pitch',()=>{
  const sector={range:10,angle:90,verticalAngle:60};
  assert.equal(pointInObservationSector(pose,point(10,30),sector),true);
  assert.equal(pointInObservationSector(pose,point(15,25),sector),true);
  assert.equal(pointInObservationSector(pose,point(16,25),sector),false);
  assert.equal(pointInObservationSector(pose,point(10,30.1),sector),false);
  assert.equal(pointInObservationSector(pose,point(10,15),sector),false);
  assert.equal(pointInObservationSector(pose,point(10,15),sector,true),true);
  assert.equal(pointInObservationSector({...pose,angle:Math.PI/2},point(15,20),sector),true);
  assert.equal(pointInObservationSector(pose,point(10,25,4),sector),true);
  assert.equal(pointInObservationSector(pose,point(10,25,6),sector),false);
  assert.equal(pointInObservationSector({...pose,pitch:Math.PI/6},point(10,25,6),sector),true);
  assert.equal(pointInObservationSector(pose,point(10,20),{range:0,angle:90,verticalAngle:60}),false);
  assert.equal(pointInObservationSector(pose,point(10,15),{range:10,angle:360,verticalAngle:90}),true);
});

test('a wall and a bridge block 3D sight rays from either side',()=>{
  const material=new MeshBasicMaterial({side:DoubleSide});
  const wall=new Mesh(new BoxGeometry(4,4,1),material);wall.position.set(0,2,5);wall.updateMatrixWorld(true);
  const eye={x:0,y:2,z:0,angle:0},target={x:0,y:2,z:10},sector={range:20,angle:120,verticalAngle:100};
  assert.equal(isObservationPointVisible(eye,target,sector,[]),true);
  assert.equal(isObservationPointVisible(eye,target,sector,[wall]),false);
  assert.ok(Math.abs(observationRayDistance(new Vector3(0,2,0),new Vector3(0,0,1),20,[wall])-4.5)<1e-6);
  const bridge=new Mesh(new PlaneGeometry(20,20),material);bridge.rotation.x=-Math.PI/2;bridge.position.y=5;bridge.updateMatrixWorld(true);
  const below={x:0,y:1,z:0,angle:0},above={x:0,y:9,z:3};
  assert.equal(isObservationPointVisible(below,above,{range:20,angle:180,verticalAngle:180},[bridge]),false);
  assert.equal(isObservationPointVisible({...above,angle:Math.PI},below,{range:20,angle:180,verticalAngle:180},[bridge]),false);
});

test('old observation settings migrate and validate vertical angles per kind',()=>{
  const saved=readObservationProfiles({bike:{front:{range:80,angle:-5,verticalAngle:200},rear:{range:'invalid'}},car:{rear:{angle:180}}});
  const defaults=defaultObservationProfiles();
  assert.deepEqual(saved.bike.front,{range:50,angle:0,verticalAngle:180});
  assert.equal(saved.bike.rear.range,defaults.bike.rear.range);
  assert.equal(saved.car.rear.angle,180);assert.equal(saved.car.rear.verticalAngle,defaults.car.rear.verticalAngle);
  assert.deepEqual(saved.truck,defaults.truck);
});

test('volume follows the vehicle every frame while occlusion geometry is throttled',()=>{
  const guide=new VehicleObservationGuide(),bike={id:1,kind:'bike',pose:{x:0,y:0,z:0,angle:0}} as Vehicle;
  guide.profiles.bike.front={range:10,angle:20,verticalAngle:20};
  const wall=new Mesh(new BoxGeometry(10,10,1),new MeshBasicMaterial({side:DoubleSide}));wall.position.set(0,2,5);wall.updateMatrixWorld(true);
  guide.update(bike,[wall],1000);
  assert.equal(guide.group.visible,true);assert.equal(guide.group.position.y,1.8);
  const area=guide.group.getObjectByName('observation-front') as Mesh,geometry=area.geometry,vertices=geometry.getAttribute('position');
  assert.ok(vertices.count>100,'the guide must contain surfaces rather than isolated rays');
  for(let i=0;i<vertices.count;i++)assert.ok(vertices.getZ(i)<=4.50001,'the sampled wall limits the volume');
  bike.pose={x:1,y:2,z:3,angle:.4};guide.update(bike,[wall],1016);
  assert.equal(guide.group.position.x,1);assert.equal(guide.group.position.y,3.8);assert.equal(guide.group.position.z,3);
  assert.equal(guide.group.rotation.y,.4);assert.equal(area.geometry,geometry,'do not recast every frame');
  guide.update(bike,[wall],1160);assert.notEqual(area.geometry,geometry,'refresh occlusion after the interval');
  const before=area.geometry;guide.profiles.bike.front.range=3;guide.update(bike,[],1161);
  assert.notEqual(area.geometry,before,'settings refresh geometry immediately');
  for(let i=0;i<area.geometry.getAttribute('position').count;i++){
    const p=area.geometry.getAttribute('position');assert.ok(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))<=3.00001);
  }
  guide.enabled=false;guide.update(bike);assert.equal(guide.group.visible,false);
  guide.enabled=true;guide.update();assert.equal(guide.group.visible,false);
});
