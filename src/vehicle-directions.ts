import * as THREE from 'three';
import { SPECS, type Vehicle, type VehicleKind } from './simulation';

const POINT_COUNT = 61;
const LOOK_AHEAD = 30;
const COLORS: Record<VehicleKind, number> = { bike: 0xf6be36, car: 0x3cbbf0, truck: 0xc08bff };

/** A visual forecast of the assigned route, not a reservation of road space. */
export class VehicleDirections {
  group = new THREE.Group();
  private markers = new Map<number, THREE.Group>();
  private sweepMaterials = new Map<VehicleKind, THREE.MeshBasicMaterial>();
  private outlineMaterials = new Map<VehicleKind, THREE.LineBasicMaterial>();
  private materials = new Map<VehicleKind, THREE.MeshBasicMaterial>();

  constructor() {
    this.group.name = 'vehicle-directions';
    for (const kind of Object.keys(COLORS) as VehicleKind[]) {
      this.sweepMaterials.set(kind, new THREE.MeshBasicMaterial({
        color: COLORS[kind], transparent: true, opacity: .12,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      this.outlineMaterials.set(kind, new THREE.LineBasicMaterial({
        color: COLORS[kind], transparent: true, opacity: .75, depthWrite: false, toneMapped: false,
      }));
      this.materials.set(kind, new THREE.MeshBasicMaterial({
        color: COLORS[kind], transparent: true, opacity: .9,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
    }
  }

  private remove(id: number, marker: THREE.Group) {
    for (const child of marker.children) (child as THREE.Mesh).geometry.dispose();
    this.group.remove(marker);
    this.markers.delete(id);
  }

  clear() {
    for (const [id, marker] of this.markers) this.remove(id, marker);
  }

  private make(vehicle: Vehicle) {
    const marker = new THREE.Group();
    marker.name = `vehicle-direction-${vehicle.id}`;
    const strip = new THREE.BufferGeometry();
    strip.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINT_COUNT * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let i = 0; i < POINT_COUNT - 1; i++) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    strip.setIndex(indices);
    const arrows = new THREE.BufferGeometry();
    arrows.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 9), 3).setUsage(THREE.DynamicDrawUsage));
    for (const geometry of [strip, arrows]) {
      const mesh = new THREE.Mesh(geometry, this.materials.get(vehicle.kind)!);
      mesh.renderOrder = 4;
      // These buffers move through world space; avoid stale bounding-sphere culling.
      mesh.frustumCulled = false;
      marker.add(mesh);
    }
    const sweep = new THREE.BufferGeometry();
    sweep.setAttribute('position', new THREE.BufferAttribute(new Float32Array((POINT_COUNT * 6 + (POINT_COUNT - 1) * 24) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const area = new THREE.Mesh(sweep, this.sweepMaterials.get(vehicle.kind)!);
    area.name = 'body-sweep'; area.renderOrder = 2; area.frustumCulled = false;
    const outlines = new THREE.BufferGeometry();
    outlines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINT_COUNT * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const frames = new THREE.LineSegments(outlines, this.outlineMaterials.get(vehicle.kind)!);
    frames.name = 'body-footprints'; frames.renderOrder = 3; frames.frustumCulled = false;
    marker.add(area, frames);
    this.group.add(marker);
    this.markers.set(vehicle.id, marker);
    return marker;
  }

  update(vehicles: Vehicle[], enabled: boolean) {
    this.group.visible = enabled;
    if (!enabled) { this.clear(); return; }
    const active = new Set(vehicles.map(v => v.id));
    for (const [id, marker] of this.markers) if (!active.has(id)) this.remove(id, marker);

    for (const vehicle of vehicles) {
      const marker = this.markers.get(vehicle.id) ?? this.make(vehicle);
      const remaining = Math.min(LOOK_AHEAD, Math.max(0, vehicle.route.total - vehicle.s));
      marker.visible = remaining > .25;
      if (!marker.visible) continue;
      const pointAt = (distance: number) => {
        const s = Math.min(vehicle.route.total, vehicle.s + Math.max(0, distance));
        const width = vehicle.route.position(s).width;
        const bound = Math.max(0, (width - SPECS[vehicle.kind].width) / 2 - .28);
        const blend = Math.min(1, Math.max(0, distance) / 6);
        const offset = THREE.MathUtils.clamp(vehicle.offset + (vehicle.targetOffset - vehicle.offset) * blend, -bound, bound);
        const point = vehicle.route.at(s, offset);
        return new THREE.Vector3(point.x, point.y + .25, point.z);
      };
      const points = Array.from({ length: POINT_COUNT }, (_, i) => pointAt(remaining * i / (POINT_COUNT - 1)));
      const strip = (marker.children[0] as THREE.Mesh).geometry;
      const positions = strip.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < POINT_COUNT; i++) {
        const before = points[Math.max(0, i - 1)], after = points[Math.min(POINT_COUNT - 1, i + 1)];
        const tangent = new THREE.Vector3().subVectors(after, before);
        const length = Math.hypot(tangent.x, tangent.z) || 1;
        const x = tangent.z / length * .16, z = -tangent.x / length * .16;
        const p = points[i];
        positions.setXYZ(i * 2, p.x + x, p.y, p.z + z);
        positions.setXYZ(i * 2 + 1, p.x - x, p.y, p.z - z);
      }
      positions.needsUpdate = true;

      // Sweep all four body corners, including the nose and tail on bends.
      // Start at the actual pose, then blend into the assigned route forecast.
      const spec = SPECS[vehicle.kind];
      const footprints = points.map((p, i) => {
        const distance = remaining * i / (POINT_COUNT - 1);
        const t = Math.min(1, distance / 6);
        const routeAngle = vehicle.route.at(Math.min(vehicle.route.total, vehicle.s + distance)).angle;
        const angle = vehicle.pose.angle + Math.atan2(Math.sin(routeAngle - vehicle.pose.angle), Math.cos(routeAngle - vehicle.pose.angle)) * t;
        const start = points[0];
        const cx = p.x + (vehicle.pose.x - start.x) * (1 - t);
        const cz = p.z + (vehicle.pose.z - start.z) * (1 - t);
        const y = p.y + (vehicle.pose.y + .25 - start.y) * (1 - t) - .06;
        return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([side, end]) => new THREE.Vector3(
          cx + Math.cos(angle) * side * spec.width / 2 + Math.sin(angle) * end * spec.length / 2,
          y,
          cz - Math.sin(angle) * side * spec.width / 2 + Math.cos(angle) * end * spec.length / 2,
        ));
      });
      const sweep = (marker.children[2] as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
      const framesGeometry = (marker.children[3] as THREE.LineSegments).geometry;
      const frames = framesGeometry.getAttribute('position') as THREE.BufferAttribute;
      let vertex = 0, line = 0;
      const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
        for (const p of [a,b,c]) sweep.setXYZ(vertex++, p.x, p.y, p.z);
      };
      footprints.forEach((corners, i) => {
        triangle(corners[0], corners[1], corners[2]);
        triangle(corners[0], corners[2], corners[3]);
        for (let j = 0; j < 4; j++) {
          const a = corners[j], b = corners[(j + 1) % 4];
          if (i % 8 === 0 || i === POINT_COUNT - 1) {
            frames.setXYZ(line++, a.x, a.y + .025, a.z);
            frames.setXYZ(line++, b.x, b.y + .025, b.z);
          }
          if (i > 0) {
            const previous = footprints[i - 1];
            triangle(previous[j], previous[(j + 1) % 4], b);
            triangle(previous[j], b, a);
          }
        }
      });
      sweep.needsUpdate = true; frames.needsUpdate = true;
      framesGeometry.setDrawRange(0, line);

      const arrows = (marker.children[1] as THREE.Mesh).geometry;
      const arrowPositions = arrows.getAttribute('position') as THREE.BufferAttribute;
      let arrowCount = 0;
      for (let distance = 5; distance < remaining - 1; distance += 7) {
        const p = pointAt(distance), tip = pointAt(distance + 1.5), back = pointAt(distance - .5);
        const tangent = new THREE.Vector3().subVectors(tip, back);
        const length = Math.hypot(tangent.x, tangent.z) || 1;
        const x = tangent.z / length * .85, z = -tangent.x / length * .85;
        arrowPositions.setXYZ(arrowCount * 3, tip.x, tip.y + .02, tip.z);
        arrowPositions.setXYZ(arrowCount * 3 + 1, p.x + x, p.y + .02, p.z + z);
        arrowPositions.setXYZ(arrowCount * 3 + 2, p.x - x, p.y + .02, p.z - z);
        arrowCount++;
      }
      arrows.setDrawRange(0, arrowCount * 3);
      arrowPositions.needsUpdate = true;
    }
  }
}
