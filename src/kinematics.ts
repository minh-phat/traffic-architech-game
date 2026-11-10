import type {Pose} from './simulation';

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
