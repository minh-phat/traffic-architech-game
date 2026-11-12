import { interpolateArc, arcSagitta } from './kinematics';
import { SPECS, overlaps, type Pose, type VehicleKind } from './simulation';

const signedAngle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
const between=interpolateArc;

/** Minimum separating translation for two oriented rectangles (zero if clear). */
export function penetration(a:Pose,kind:VehicleKind,b:Pose,otherKind:VehicleKind,margin=0):number {
  if(Math.abs(a.y-b.y)>2.5)return 0;
  const own=SPECS[kind],other=SPECS[otherKind];
  const af={x:Math.sin(a.angle),z:Math.cos(a.angle)},ar={x:Math.cos(a.angle),z:-Math.sin(a.angle)};
  const bf={x:Math.sin(b.angle),z:Math.cos(b.angle)},br={x:Math.cos(b.angle),z:-Math.sin(b.angle)};
  let depth=Infinity;
  for(const axis of [af,ar,bf,br]){
    const dot=(v:{x:number;z:number})=>Math.abs(v.x*axis.x+v.z*axis.z);
    const radius=dot(af)*(own.length/2+margin)+dot(ar)*(own.width/2+margin)
      +dot(bf)*(other.length/2+margin)+dot(br)*(other.width/2+margin);
    depth=Math.min(depth,radius-Math.abs((a.x-b.x)*axis.x+(a.z-b.z)*axis.z));
  }
  return Math.max(0,depth);
}

/** Recovery permits only an existing contact to decrease throughout the arc.
 * New contacts are still rejected by the caller's continuous sweep. */
export function separatesContact(from:Pose,to:Pose,kind:VehicleKind,other:Pose,otherKind:VehicleKind):boolean {
  let previous=penetration(from,kind,other,otherKind,.06);
  if(previous<=0)return false;
  const initial=previous;
  const travel=Math.hypot(to.x-from.x,to.z-from.z);
  const steps=Math.max(4,Math.ceil(travel/.01),Math.ceil(Math.abs(signedAngle(to.angle-from.angle))/.005));
  for(let i=1;i<=steps;i++){
    const depth=penetration(between(from,to,i/steps),kind,other,otherKind,.06);
    if(depth>previous+1e-9)return false;
    previous=depth;
  }
  return previous<initial-1e-9;
}

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

/** Simultaneous motion of two bodies. Freeze their orientations at the middle
 * of short arc segments and bound the rotation/curvature around those chords.
 * Relative translation then tests the same time interval, rather than two
 * spatial paths which may cross at entirely different times. */
export function movingBodiesOverlap(a0:Pose,a1:Pose,kind:VehicleKind,b0:Pose,b1:Pose,otherKind:VehicleKind,margin=.06,depth=0):boolean {
  const yawA=signedAngle(a1.angle-a0.angle),yawB=signedAngle(b1.angle-b0.angle);
  if(depth<8&&(Math.abs(yawA)>.04||Math.abs(yawB)>.04)){
    const am=between(a0,a1,.5),bm=between(b0,b1,.5);
    return movingBodiesOverlap(a0,am,kind,b0,bm,otherKind,margin,depth+1)
      ||movingBodiesOverlap(am,a1,kind,bm,b1,otherKind,margin,depth+1);
  }
  const a=SPECS[kind],b=SPECS[otherKind];
  const pad=Math.hypot(a.length,a.width)*Math.abs(yawA)/4
    +Math.hypot(b.length,b.width)*Math.abs(yawB)/4+arcSagitta(a0,a1)+arcSagitta(b0,b1);
  const heading=a0.angle+yawA/2;
  const possible=sweptOverlaps({...a0,angle:heading},
    {x:a1.x-(b1.x-b0.x),y:a1.y-(b1.y-b0.y),z:a1.z-(b1.z-b0.z),angle:heading},kind,
    {...b0,angle:b0.angle+yawB/2},otherKind,margin+pad);
  if(!possible)return false;
  if(Math.abs(yawA)+Math.abs(yawB)<1e-10||depth>=12)return true;
  const am=between(a0,a1,.5),bm=between(b0,b1,.5);
  if(overlaps(am,kind,bm,otherKind,margin)||overlaps(a1,kind,b1,otherKind,margin))return true;
  // A padded rotation envelope can report a corner contact that never happens.
  // Refine only these ambiguous intervals instead of freezing recovery forever.
  return movingBodiesOverlap(a0,am,kind,b0,bm,otherKind,margin,depth+1)
    ||movingBodiesOverlap(am,a1,kind,bm,b1,otherKind,margin,depth+1);
}
