import * as THREE from 'three';
import {driveArc} from './kinematics';
import {SPECS, type Vehicle} from './simulation';

/** Kinematic steering limits; these guides do not account for obstacles. */
export class VehicleSteering {
  group = new THREE.Group();
  private lines: THREE.Line[] = [];
  private areas: {mesh: THREE.Mesh; direction: number}[] = [];
  constructor() {
    this.group.name = 'vehicle-steering';
    for (const direction of [1, -1]) for (const turn of [-1, 0, 1]) {
      const material = new THREE.LineDashedMaterial({
        color: turn === 0 ? 0xffffff : direction === 1 ? 0x32dfae : 0xffad55,
        transparent: true, opacity: turn === 0 ? .85 : .7,
        dashSize: direction === 1 ? 100 : .55, gapSize: .35,
        depthWrite: false, toneMapped: false,
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(41 * 3), 3));
      const line = new THREE.Line(geometry, material);
      line.name = `${direction === 1 ? 'forward' : 'reverse'}-${turn}`;
      line.frustumCulled = false; line.renderOrder = 5;
      this.lines.push(line); this.group.add(line);
    }
    for (const direction of [1, -1]) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(41 * 33 * 3), 3));
      const indices: number[] = [];
      for (let step = 0; step < 40; step++) for (let turn = 0; turn < 32; turn++) {
        const a = step * 33 + turn, b = a + 33;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: direction === 1 ? 0x32dfae : 0xffad55,
        transparent: true, opacity: .3, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false,
      }));
      mesh.name = direction === 1 ? 'forward-steering-area' : 'reverse-steering-area';
      mesh.renderOrder = 4; mesh.frustumCulled = false;
      this.areas.push({mesh, direction}); this.group.add(mesh);
    }
  }
  update(vehicle?: Vehicle) {
    this.group.visible = !!vehicle;
    if (!vehicle) return;
    const spec = SPECS[vehicle.kind];
    // Limit the extreme arcs to a quarter turn so they remain readable.
    const distance = Math.min(12, Math.PI / 2 * spec.wheelbase / Math.tan(spec.maxSteer));
    let index = 0;
    for (const direction of [1, -1]) for (const turn of [-1, 0, 1]) {
      const line = this.lines[index++];
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const steering = turn === 0 ? vehicle.steering ?? 0 : turn * spec.maxSteer;
      for (let i = 0; i <= 40; i++) {
        const pose = driveArc(vehicle.pose, direction * distance * i / 40, steering, spec.wheelbase);
        positions.setXYZ(i, pose.x, pose.y + .32, pose.z);
      }
      positions.needsUpdate = true;
      line.computeLineDistances();
    }
    for (const {mesh, direction} of this.areas) {
      const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let step = 0; step <= 40; step++) for (let turn = 0; turn <= 32; turn++) {
        const steering = spec.maxSteer * (turn / 16 - 1);
        const pose = driveArc(vehicle.pose, direction * distance * step / 40, steering, spec.wheelbase);
        positions.setXYZ(step * 33 + turn, pose.x, pose.y + .28, pose.z);
      }
      positions.needsUpdate = true;
    }
  }
}
