import test from 'node:test';
import assert from 'node:assert/strict';
import { blockerBearing, selectedBlocker, VehicleBlockage } from '../src/vehicle-blockage';
import { type Vehicle } from '../src/simulation';

const car=(id:number,x:number,z:number,angle=0)=>({id,kind:'car',pose:{x,y:0,z,angle},state:'blocked'} as Vehicle);
test('blocker bearing follows the nose when the vehicle rotates',()=>{
  const v=car(1,0,0),other=car(2,1,1);
  assert.equal(blockerBearing(v,other).direction,'phía trước bên phải');
  assert.equal(blockerBearing(v,other).degrees,45);
  v.pose.angle=Math.PI/2;
  assert.equal(blockerBearing(v,other).direction,'phía trước bên trái');
});
test('overlay follows the reported blocker and clears on deselection or departure',()=>{
  const v=car(1,0,0),other=car(2,1,4);v.blockerId=2;
  const overlay=new VehicleBlockage();overlay.update(v,[v,other]);
  assert.equal(overlay.group.visible,true);
  other.inGarage=true;assert.equal(selectedBlocker(v,[v,other]),undefined);
  overlay.update(v,[v,other]);assert.equal(overlay.group.visible,false);
  overlay.update(undefined,[]);assert.equal(overlay.group.visible,false);
});
