import * as THREE from 'three';
import type { Pose, VehicleKind } from './simulation';

/** Horizontal and vertical total opening, degrees; range is a 3D distance in metres. */
export type ObservationSector = { range:number; angle:number; verticalAngle:number };
export type ObservationProfile = { front:ObservationSector; rear:ObservationSector };
export type ObservationProfiles = Record<VehicleKind,ObservationProfile>;
export type ObservationPose = Pose & { pitch?:number };

export function defaultObservationProfiles():ObservationProfiles {
  return {
    bike:{front:{range:18,angle:120,verticalAngle:60},rear:{range:8,angle:90,verticalAngle:50}},
    car:{front:{range:25,angle:120,verticalAngle:60},rear:{range:10,angle:90,verticalAngle:50}},
    truck:{front:{range:30,angle:100,verticalAngle:60},rear:{range:12,angle:80,verticalAngle:50}},
  };
}

/** Geometric coverage from the supplied eye position. Pitch is positive uphill. */
export function pointInObservationSector(pose:ObservationPose,point:{x:number;y:number;z:number},sector:ObservationSector,rear=false):boolean {
  if(sector.range<=0||sector.angle<=0||sector.verticalAngle<=0)return false;
  const dx=point.x-pose.x,dy=point.y-pose.y,dz=point.z-pose.z,distance=Math.hypot(dx,dy,dz);
  if(distance>sector.range+1e-9)return false;
  if(distance<1e-9)return true;
  const yaw=pose.angle+(rear?Math.PI:0),pitch=(pose.pitch??0)*(rear?-1:1);
  const x=dx*Math.cos(yaw)-dz*Math.sin(yaw),forward=dx*Math.sin(yaw)+dz*Math.cos(yaw);
  const y=dy*Math.cos(pitch)-forward*Math.sin(pitch),z=dy*Math.sin(pitch)+forward*Math.cos(pitch);
  const horizontal=Math.atan2(x,z),vertical=Math.atan2(y,Math.hypot(x,z));
  return (sector.angle>=360||Math.abs(horizontal)<=sector.angle*Math.PI/360+1e-9)
    &&Math.abs(vertical)<=sector.verticalAngle*Math.PI/360+1e-9;
}

/** Distance to the first opaque object on a line of sight. Exclude the observer
 * and, when querying a target body, exclude that body's root as well. Objects
 * must have up-to-date world matrices; the caller defines the opaque meshes. */
export function observationRayDistance(origin:THREE.Vector3,direction:THREE.Vector3,range:number,occluders:THREE.Object3D[],raycaster=new THREE.Raycaster()):number {
  if(range<=0||direction.lengthSq()===0)return 0;
  raycaster.set(origin,direction.clone().normalize());raycaster.near=.01;raycaster.far=range;
  return raycaster.intersectObjects(occluders,true)[0]?.distance??range;
}

/** Call with the observer and target excluded from occluders. Tests one point,
 * not an entire vehicle body; multiple target points can be queried separately. */
export function isObservationPointVisible(pose:ObservationPose,point:{x:number;y:number;z:number},sector:ObservationSector,occluders:THREE.Object3D[],rear=false):boolean {
  if(!pointInObservationSector(pose,point,sector,rear))return false;
  const origin=new THREE.Vector3(pose.x,pose.y,pose.z),direction=new THREE.Vector3(point.x-pose.x,point.y-pose.y,point.z-pose.z),distance=direction.length();
  return distance<.01||observationRayDistance(origin,direction,Math.max(0,distance-.01),occluders)>=distance-.01;
}

export function readObservationProfiles(value:unknown):ObservationProfiles {
  const profiles=defaultObservationProfiles();
  if(!value||typeof value!=='object')return profiles;
  for(const kind of ['bike','car','truck'] as const){
    const item=(value as Record<string,unknown>)[kind];if(!item||typeof item!=='object')continue;
    for(const side of ['front','rear'] as const){
      const part=(item as Record<string,unknown>)[side];if(!part||typeof part!=='object')continue;
      for(const key of ['range','angle','verticalAngle'] as const){
        const n=(part as Record<string,unknown>)[key];
        if(typeof n==='number'&&Number.isFinite(n))profiles[kind][side][key]=Math.max(0,Math.min(key==='range'?50:key==='angle'?360:180,n));
      }
    }
  }
  return profiles;
}
