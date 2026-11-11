import test from 'node:test';
import assert from 'node:assert/strict';
import { LineSegments, Mesh } from 'three';
import type { Vehicle } from '../src/simulation';
import { VehicleObservationLinks } from '../src/vehicle-observation-links';
import { vehicleObservationPose, vehicleObservationSamples, type VehicleObservations } from '../src/vehicle-perception';

const car=(id:number,x:number,z:number)=>({id,kind:'car',pose:{x,y:0,z,angle:0},arrived:false,inGarage:false} as Vehicle);
const item=(v:Vehicle,sampleIndex=0)=>({id:v.id,kind:v.kind,distance:5,sampleIndex});

test('links and coloured frames follow observed vehicles without duplicating both sectors',()=>{
  const observer=car(1,0,0),front=car(2,0,8),rear=car(3,2,-6);
  const seen:VehicleObservations={front:[item(front,1)],rear:[item(rear),item(front)]};
  const overlay=new VehicleObservationLinks();overlay.update(observer,[observer,front,rear],seen,observer.id);
  assert.equal(overlay.group.visible,true);assert.deepEqual(overlay.ids,[2,3]);
  const frontLine=overlay.group.getObjectByName('observation-links-front') as LineSegments;
  const rearLine=overlay.group.getObjectByName('observation-links-rear') as LineSegments;
  assert.equal(frontLine.geometry.getAttribute('position').count,10);
  assert.equal(rearLine.geometry.getAttribute('position').count,10);
  const markers=overlay.group.getObjectByName('observation-markers-front')!;
  const shaft=markers.getObjectByName('observation-shaft') as Mesh,arrow=markers.getObjectByName('observation-arrow') as Mesh;
  assert.equal(shaft.visible,true);assert.equal(arrow.visible,true);
  assert.ok(shaft.scale.y>0);assert.ok(arrow.position.y>front.pose.y+1.9);
  assert.equal(arrow.position.z,front.pose.z);
  const p=frontLine.geometry.getAttribute('position'),eye=vehicleObservationPose(observer),sample=vehicleObservationSamples(front)[1];
  assert.ok(Math.abs(p.getY(0)-eye.y)<1e-5);assert.ok(Math.abs(p.getX(1)-sample.x)<1e-5);assert.equal(p.getZ(1),sample.z);
  front.pose.z=9;overlay.update(observer,[observer,front,rear],seen,observer.id);
  assert.equal(frontLine.geometry.getAttribute('position').getZ(1),9,'links follow moving targets without waiting for perception refresh');
  assert.equal(arrow.position.z,9,'arrow follows the observed vehicle');
  front.inGarage=true;overlay.update(observer,[observer,front,rear],seen,observer.id);assert.deepEqual(overlay.ids,[3]);assert.equal(arrow.visible,false);
  overlay.update(observer,[observer,front,rear],seen,99);assert.equal(overlay.group.visible,false);
  overlay.update(undefined,[],seen,null);assert.equal(overlay.group.visible,false);assert.deepEqual(overlay.ids,[]);
});

test('empty or invalid detections draw no links',()=>{
  const observer=car(1,0,0),target=car(2,0,5),overlay=new VehicleObservationLinks();
  overlay.update(observer,[observer,target],{front:[item(target,99)],rear:[]},1);
  assert.equal(overlay.group.visible,false);assert.deepEqual(overlay.ids,[]);
});
