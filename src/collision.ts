import { interpolateArc, arcSagitta } from './kinematics';
import { SPECS, overlaps, type Pose, type VehicleKind } from './simulation';

const signedAngle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
const between=interpolateArc;

/** Continuous SAT for translation, with a conservative rotation envelope.
 * Subdivision resolves a possible rotating corner contact instead of jumping
 * over it with evenly spaced samples. The remaining tolerance is submillimetre. */
export function sweptOverlaps(from:Pose,to:Pose,kind:VehicleKind,other:Pose,otherKind:VehicleKind,margin=.06,depth=0):boolean {
  if(Math.min(Math.abs(from.y-other.y),Math.abs(to.y-other.y))>2.5&&Math.sign(from.y-other.y)===Math.sign(to.y-other.y))return false;
  const a=SPECS[kind],b=SPECS[otherKind];
  const yaw=signedAngle(to.angle-from.angle),mid=between(from,to,.5);
  const af={x:Math.sin(mid.angle),z:Math.cos(mid.angle)},ar={x:Math.cos(mid.angle),z:-Math.sin(mid.angle)};
  const bf={x:Math.sin(other.angle),z:Math.cos(other.angle)},br={x:Math.cos(other.angle),z:-Math.sin(other.angle)};
  const rotationPad=Math.hypot(a.length/2+margin,a.width/2+margin)*Math.abs(yaw)/2+arcSagitta(from,to);
  let enter=0,leave=1;
  const rise=to.y-from.y;
  if(Math.abs(rise)>1e-12){
    const lo=(other.y-2.5-from.y)/rise,hi=(other.y+2.5-from.y)/rise;
    enter=Math.max(enter,Math.min(lo,hi));leave=Math.min(leave,Math.max(lo,hi));if(enter>=leave)return false;
  }
  for(const axis of [af,ar,bf,br]){
    const dot=(v:{x:number;z:number})=>Math.abs(v.x*axis.x+v.z*axis.z);
    const radius=dot(af)*(a.length/2+margin)+dot(ar)*(a.width/2+margin)
      +dot(bf)*(b.length/2+margin)+dot(br)*(b.width/2+margin)+rotationPad;
    const start=(from.x-other.x)*axis.x+(from.z-other.z)*axis.z;
    const travel=(to.x-from.x)*axis.x+(to.z-from.z)*axis.z;
    if(Math.abs(travel)<1e-12){if(Math.abs(start)>=radius)return false;continue;}
    const lo=(-radius-start)/travel,hi=(radius-start)/travel;
    enter=Math.max(enter,Math.min(lo,hi));leave=Math.min(leave,Math.max(lo,hi));
    if(enter>=leave)return false;
  }
  if(overlaps(between(from,to,(enter+leave)/2),kind,other,otherKind,Math.max(0,margin-1e-6)))return true;
  if(Math.abs(yaw)<1e-10||depth>=12)return false;
  return sweptOverlaps(from,mid,kind,other,otherKind,margin,depth+1)||sweptOverlaps(mid,to,kind,other,otherKind,margin,depth+1);
}
