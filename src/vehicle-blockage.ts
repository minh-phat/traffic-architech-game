import * as THREE from 'three';
import { SPECS, type Vehicle } from './simulation';

/** Bearing to the blocker centre, relative to the selected vehicle's nose. */
export function blockerBearing(vehicle: Vehicle, other: Vehicle) {
  const dx=other.pose.x-vehicle.pose.x, dz=other.pose.z-vehicle.pose.z;
  const angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-vehicle.pose.angle),Math.cos(Math.atan2(dx,dz)-vehicle.pose.angle));
  const degrees=Math.round(Math.abs(angle)*180/Math.PI);
  const side=angle>0?'phải':'trái';
  const direction=degrees<20?'phía trước':degrees>160?'phía sau':degrees<70?`phía trước bên ${side}`:degrees>110?`phía sau bên ${side}`:`bên ${side}`;
  return {degrees,direction,distance:Math.hypot(dx,dz)};
}

export function selectedBlocker(vehicle: Vehicle | undefined, vehicles: Vehicle[]) {
  if(!vehicle || vehicle.state==='driving' || vehicle.inGarage)return undefined;
  return vehicles.find(other=>other.id===vehicle.blockerId && other.id!==vehicle.id && !other.inGarage);
}

export class VehicleBlockage {
  group=new THREE.Group();
  private geometry=new THREE.BufferGeometry();
  constructor(){
    this.group.name='vehicle-blockage';
    const line=new THREE.LineSegments(this.geometry,new THREE.LineBasicMaterial({color:0xf04e42,depthTest:false,depthWrite:false,toneMapped:false}));
    line.renderOrder=10;line.frustumCulled=false;this.group.add(line);this.group.visible=false;
  }
  update(vehicle:Vehicle|undefined,vehicles:Vehicle[]){
    const other=selectedBlocker(vehicle,vehicles);
    this.group.visible=!!other;
    if(!vehicle||!other)return;
    const points:number[]=[];
    const point=(x:number,y:number,z:number)=>points.push(x,y,z);
    // Elevated frames stay visible above the body, even at a low camera angle.
    for(const v of [vehicle,other]){
      const spec=SPECS[v.kind],p=v.pose;
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[p.x+Math.cos(p.angle)*x*(spec.width/2+.08)+Math.sin(p.angle)*z*(spec.length/2+.08),p.y+2.4,p.z-Math.sin(p.angle)*x*(spec.width/2+.08)+Math.cos(p.angle)*z*(spec.length/2+.08)]);
      for(let i=0;i<4;i++){points.push(...corners[i],...corners[(i+1)%4]);}
    }
    point(vehicle.pose.x,vehicle.pose.y+2.4,vehicle.pose.z);
    point(other.pose.x,other.pose.y+2.4,other.pose.z);
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  }
}
