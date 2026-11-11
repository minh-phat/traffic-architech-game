import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { Vehicle } from '../src/simulation';
import { defaultObservationProfiles } from '../src/vehicle-observation';
import { observeVehicles } from '../src/vehicle-perception';

function vehicle(id:number,x:number,z:number,y=0):Vehicle{return {id,kind:'car',pose:{x,y,z,angle:0},s:0,arrived:false,inGarage:false} as Vehicle;}
function body(v:Vehicle){const mesh=new Mesh(new BoxGeometry(1.8,2,3.9),new MeshBasicMaterial());mesh.position.set(v.pose.x,v.pose.y+1,v.pose.z);mesh.updateMatrixWorld(true);return mesh;}

test('detects visible vehicles in front and behind, ordered by distance and excluding self',()=>{
  const observer=vehicle(1,0,0),near=vehicle(2,0,8),far=vehicle(3,0,16),behind=vehicle(4,0,-7),outside=vehicle(5,0,-30);
  const targets=[observer,far,behind,outside,near].map(vehicle=>({vehicle,object:body(vehicle)}));
  const result=observeVehicles(observer,defaultObservationProfiles().car,targets,[]);
  assert.deepEqual(result.front.map(v=>v.id),[2,3]);assert.deepEqual(result.rear.map(v=>v.id),[4]);
  near.inGarage=true;assert.deepEqual(observeVehicles(observer,defaultObservationProfiles().car,targets,[]).front.map(v=>v.id),[3]);
});

test('opaque wall or a nearer vehicle hides a target, while the target never blocks its own sightline',()=>{
  const observer=vehicle(1,0,0),near=vehicle(2,0,8),far=vehicle(3,0,16),nearBody=body(near),farBody=body(far);
  const profile=defaultObservationProfiles().car,targets=[{vehicle:near,object:nearBody},{vehicle:far,object:farBody}];
  assert.deepEqual(observeVehicles(observer,profile,targets,[nearBody,farBody]).front.map(v=>v.id),[2]);
  const wall=new Mesh(new BoxGeometry(20,10,1),new MeshBasicMaterial());wall.position.set(0,2,4);wall.updateMatrixWorld(true);
  assert.deepEqual(observeVehicles(observer,profile,targets,[wall,nearBody,farBody]).front,[]);
  wall.position.x=20;wall.updateMatrixWorld(true);
  assert.deepEqual(observeVehicles(observer,profile,targets,[wall,farBody]).front.map(v=>v.id),[2,3]);
});

test('a visible side sample can reveal a partly obscured vehicle; angles and bridge height apply',()=>{
  const observer=vehicle(1,0,0),target=vehicle(2,0,8),targetBody=body(target),profile=defaultObservationProfiles().car;
  const wall=new Mesh(new BoxGeometry(.4,4,1),new MeshBasicMaterial());wall.position.set(0,1,4);wall.updateMatrixWorld(true);
  assert.deepEqual(observeVehicles(observer,profile,[{vehicle:target,object:targetBody}],[wall,targetBody]).front.map(v=>v.id),[2]);
  const narrower=structuredClone(profile);narrower.front.angle=0;
  assert.deepEqual(observeVehicles(observer,narrower,[{vehicle:target,object:targetBody}],[wall,targetBody]).front,[]);
  const bridge=new Mesh(new BoxGeometry(20,.3,20),new MeshBasicMaterial());bridge.position.y=4;bridge.updateMatrixWorld(true);
  target.pose.y=8;targetBody.position.y=9;targetBody.updateMatrixWorld(true);
  assert.deepEqual(observeVehicles(observer,{...profile,front:{...profile.front,verticalAngle:180}},[{vehicle:target,object:targetBody}],[bridge,targetBody]).front,[]);
});

test('recognises a vehicle whose corner enters a narrow field even when its first seven samples miss',()=>{
  const observer=vehicle(1,0,0),target=vehicle(2,4,8),targetBody=body(target),profile=defaultObservationProfiles().car;
  profile.front.angle=44;profile.rear.angle=0;
  const result=observeVehicles(observer,profile,[{vehicle:target,object:targetBody}],[targetBody]);
  assert.equal(result.front.length,1);
  assert.ok(result.front[0].sampleIndex>=7,'a combined side-and-end sample detects the overlap');
  const wall=new Mesh(new BoxGeometry(30,10,1),new MeshBasicMaterial());wall.position.set(0,2,4);wall.updateMatrixWorld(true);
  assert.deepEqual(observeVehicles(observer,profile,[{vehicle:target,object:targetBody}],[wall,targetBody]).front,[]);
});
