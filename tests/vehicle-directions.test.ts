import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh, LineSegments} from 'three';
import {VehicleDirections} from '../src/vehicle-directions';
import {Route, SPECS, type Vehicle, type VehicleKind} from '../src/simulation';

test('forecast footprints use each body size and begin at its actual pose', () => {
  for (const kind of ['bike', 'car', 'truck'] as VehicleKind[]) {
    const route = new Route([{x:0,y:0,z:0,width:5},{x:0,y:0,z:50,width:5}], []);
    const vehicle = {id:1,kind,route,s:0,offset:0,targetOffset:0,pose:{x:1,y:0,z:0,angle:Math.PI/2}} as Vehicle;
    const directions = new VehicleDirections(); directions.update([vehicle], true);
    const marker = directions.group.children[0];
    const frames = (marker.children[3] as LineSegments).geometry.getAttribute('position');
    const xs = Array.from({length:8}, (_, i) => frames.getX(i));
    const zs = Array.from({length:8}, (_, i) => frames.getZ(i));
    assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-SPECS[kind].length)<1e-5);
    assert.ok(Math.abs(Math.max(...zs)-Math.min(...zs)-SPECS[kind].width)<1e-5);
    assert.ok(Math.abs((Math.max(...xs)+Math.min(...xs))/2-1)<1e-5);
    const area = (marker.children[2] as Mesh).geometry.getAttribute('position');
    for (const value of area.array) assert.ok(Number.isFinite(value));
    directions.update([], true); assert.equal(directions.group.children.length, 0);
  }
});
