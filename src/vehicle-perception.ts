import * as THREE from 'three';
import { SPECS, type Vehicle, type VehicleKind } from './simulation';
import { isObservationPointVisible, type ObservationPose, type ObservationProfile } from './vehicle-observation';

export type ObservedVehicle = { id:number; kind:VehicleKind; distance:number; sampleIndex:number };
export type VehicleObservations = { front:ObservedVehicle[]; rear:ObservedVehicle[] };
export type ObservationTarget = { vehicle:Vehicle; object:THREE.Object3D };

/** Eye height and road pitch are shared by the display and detection. */
export function vehicleObservationPose(vehicle:Vehicle):ObservationPose {
  const eyeHeight=vehicle.kind==='bike'?1.8:vehicle.kind==='truck'?2:1.4;
  const before=vehicle.route?.at(Math.max(0,vehicle.s-.8)),after=vehicle.route?.at(Math.min(vehicle.route.total,vehicle.s+.8));
  const pitch=before&&after?Math.atan2(after.y-before.y,Math.hypot(after.x-before.x,after.z-before.z)||1):0;
  return {...vehicle.pose,y:vehicle.pose.y+eyeHeight,pitch};
}

/** Points inside the rendered vehicle body, including the ends and sides. */
export function vehicleObservationSamples(vehicle:Vehicle):THREE.Vector3[] {
  const {width,length}=SPECS[vehicle.kind],angle=vehicle.pose.angle;
  const height=vehicle.kind==='truck'?1.7:vehicle.kind==='bike'?.8:1.0;
  const result:THREE.Vector3[]=[];
  const add=(right:number,forward:number,up:number)=>result.push(new THREE.Vector3(vehicle.pose.x+right*Math.cos(angle)+forward*Math.sin(angle),vehicle.pose.y+up,vehicle.pose.z-right*Math.sin(angle)+forward*Math.cos(angle)));
  // Keep the central samples first for the common unobstructed case, then
  // cover corners, sides and height to catch partial overlaps with the field.
  for(const [right,forward,up] of [[0,0,height],[-width*.4,0,height],[width*.4,0,height],[0,-length*.4,height],[0,length*.4,height],[0,0,height*.5],[0,0,height+0.35]])add(right,forward,up);
  for(const up of [height*.5,height,height+.35])for(const right of [-width*.4,0,width*.4])for(const forward of [-length*.4,-length*.2,0,length*.2,length*.4])add(right,forward,up);
  return result;
}

/** The caller supplies current world matrices and roots for opaque scene objects.
 * The target's own root is excluded; other vehicles remain potential occluders.
 * A vehicle is visible when at least one body sample has an unobstructed sightline. */
export function observeVehicles(observer:Vehicle,profile:ObservationProfile,targets:ObservationTarget[],occluders:THREE.Object3D[]):VehicleObservations {
  const result:VehicleObservations={front:[],rear:[]},eye=vehicleObservationPose(observer);
  for(const {vehicle,object} of targets){
    if(vehicle.id===observer.id||vehicle.arrived||vehicle.inGarage)continue;
    const bound=Math.hypot(SPECS[vehicle.kind].width/2,SPECS[vehicle.kind].length/2,2.5);
    if(Math.hypot(vehicle.pose.x-eye.x,vehicle.pose.y-eye.y,vehicle.pose.z-eye.z)>Math.max(profile.front.range,profile.rear.range)+bound)continue;
    const points=vehicleObservationSamples(vehicle);
    const otherSolids=occluders.filter(root=>root!==object);
    const front=points.findIndex(point=>isObservationPointVisible(eye,point,profile.front,otherSolids));
    const rear=points.findIndex(point=>isObservationPointVisible(eye,point,profile.rear,otherSolids,true));
    if(front<0&&rear<0)continue;
    const visible={id:vehicle.id,kind:vehicle.kind,distance:Math.hypot(vehicle.pose.x-eye.x,vehicle.pose.y-eye.y,vehicle.pose.z-eye.z)};
    if(front>=0)result.front.push({...visible,sampleIndex:front});
    if(rear>=0)result.rear.push({...visible,sampleIndex:rear});
  }
  result.front.sort((a,b)=>a.distance-b.distance||a.id-b.id);
  result.rear.sort((a,b)=>a.distance-b.distance||a.id-b.id);
  return result;
}
