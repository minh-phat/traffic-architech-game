import { SPECS, dist, type Pose, type Vehicle } from './simulation';

export const angleDelta=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));
const sinc=(v:number)=>Math.abs(v)<1e-4?1-v*v/6:Math.sin(v)/v;

/** Exact constant-steering bicycle arc, including signed reverse travel.
 * The chord form remains stable when a creeping vehicle barely rotates. */
export function driveArc(pose:Pose,travel:number,steering:number,wheelbase:number):Pose {
  const yaw=travel*Math.tan(steering)/wheelbase,chord=travel*sinc(yaw/2),mid=pose.angle+yaw/2;
  return {...pose,x:pose.x+Math.sin(mid)*chord,z:pose.z+Math.cos(mid)*chord,angle:pose.angle+yaw};
}

/** Interpolate the arc, rather than the chord between two driven poses. */
export function interpolateArc(a:Pose,b:Pose,t:number):Pose {
  const yaw=angleDelta(b.angle-a.angle),dx=b.x-a.x,dz=b.z-a.z,mid=a.angle+yaw/2;
  const along=dx*Math.sin(mid)+dz*Math.cos(mid),travel=along/sinc(yaw/2);
  const chord=travel*t*sinc(yaw*t/2),heading=a.angle+yaw*t/2;
  return {x:a.x+Math.sin(heading)*chord+(dx-Math.sin(mid)*along)*t,y:a.y+(b.y-a.y)*t,
    z:a.z+Math.cos(heading)*chord+(dz-Math.cos(mid)*along)*t,angle:a.angle+yaw*t};
}

export function arcSagitta(a:Pose,b:Pose){
  const yaw=angleDelta(b.angle-a.angle),mid=a.angle+yaw/2;
  const along=(b.x-a.x)*Math.sin(mid)+(b.z-a.z)*Math.cos(mid);
  return Math.abs(along*Math.tan(yaw/4))/2;
}

/** Shared steering integration for physical motion and time-based prediction. */
export function advanceVehicle(v:Vehicle,distance:number,targetOffset:number,dt:number,steerOverride?:number){
  const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
  const spec=SPECS[v.kind],direction=Math.sign(distance)||1;
  let desiredSteering=steerOverride;
  if(desiredSteering===undefined){
    const look=Math.max(1.3,spec.wheelbase*.65)+Math.abs(distance/dt)*.25;
    const aimS=v.s+direction*look,target=v.route.at(aimS,targetOffset);
    const extension=aimS-clamp(aimS,0,v.route.total);
    target.x+=Math.sin(target.angle)*extension;target.z+=Math.cos(target.angle)*extension;
    const bearing=Math.atan2(target.x-v.pose.x,target.z-v.pose.z);
    const error=angleDelta(bearing-v.pose.angle-(direction<0?Math.PI:0));
    const curvature=2*Math.sin(error)/Math.max(.5,dist(v.pose,target));
    desiredSteering=clamp(Math.atan(spec.wheelbase*curvature)*direction,-spec.maxSteer,spec.maxSteer);
  }
  const steering=(v.steering??0)+clamp(desiredSteering-(v.steering??0),-dt*1.3,dt*1.3);
  const pose=driveArc(v.pose,distance,steering,spec.wheelbase);
  const q=v.route.locate(pose,v.s,Math.abs(distance)+4);
  pose.y=v.route.position(q.s).y;
  return {pose,s:q.s,offset:q.offset,steering};
}
