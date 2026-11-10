import test from 'node:test';
import assert from 'node:assert/strict';
import {Line} from 'three';
import {VehicleSteering} from '../src/vehicle-steering';
import {SPECS, type Vehicle, type VehicleKind} from '../src/simulation';

test('selected steering guides show symmetric forward/reverse quarter turns for each vehicle', () => {
  for (const kind of ['bike', 'car', 'truck'] as VehicleKind[]) {
    const guide = new VehicleSteering();
    guide.update({kind, pose:{x:0,y:0,z:0,angle:0},steering:0} as Vehicle);
    assert.equal(guide.group.visible, true);
    const radius = SPECS[kind].wheelbase / Math.tan(SPECS[kind].maxSteer);
    for (const [index, x, z] of [[0,-radius,radius],[2,radius,radius],[3,-radius,-radius],[5,radius,-radius]]) {
      const positions = (guide.group.children[index] as Line).geometry.getAttribute('position');
      assert.ok(Math.abs(positions.getX(40)-x)<1e-5);
      assert.ok(Math.abs(positions.getZ(40)-z)<1e-5);
      assert.equal(positions.getX(0), 0);
      assert.equal(positions.getZ(0), 0);
    }
    guide.update();
    assert.equal(guide.group.visible, false);
  }
});
