import { SPECS, overlaps, type Vehicle } from './simulation';

export const CROSSING_TIME_BUFFER = .6;
export type CrossingSpace = { entry:number; exit:number };
export type CrossingWindow = { entry:number; arrival:number; exit:number; plannedExit:number; canClear:boolean };

/** Find the connected part of the route whose whole body intersects the
 * other's swept corridor. Parallel following/merging has no bounded crossing. */
export function crossingSpace(a:Vehicle,b:Vehicle,sa:number,sb:number):CrossingSpace|undefined {
  if(Math.abs(Math.sin(a.route.at(sa).angle-b.route.at(sb).angle))<.4)return undefined;
  const step=.4,span=16;
  const occupied=(s:number)=>{
    const p=a.route.at(s,a.targetOffset),q=b.route.locate(p,sb,span);
    return overlaps(p,a.kind,b.route.at(q.s,b.targetOffset),b.kind,.25);
  };
  if(!occupied(sa))return undefined;
  let entry=sa,exit=sa;
  for(const direction of [-1,1]){
    let found=false;
    for(let d=step;d<=span;d+=step){
      const s=Math.max(0,Math.min(a.route.total,sa+direction*d));
      if(!occupied(s)){
        if(direction<0)entry=s;else exit=s;
        found=true;break;
      }
      if(s===0||s===a.route.total)break;
    }
    // An unbounded shared corridor or a route ending inside the crossing
    // cannot promise that its tail will clear this conflict.
    if(!found)return undefined;
  }
  return {entry,exit};
}

/** Earliest physically feasible arrival, with a finite acceleration/speed cap. */
function arrival(distance:number,speed:number,accel:number,target:number){
  if(distance<=0)return 0;
  const cap=Math.max(speed,target);
  if(cap<.01)return Infinity;
  const accelerating=Math.max(0,(cap*cap-speed*speed)/(2*accel));
  if(distance<=accelerating)return 2*distance/(speed+Math.sqrt(speed*speed+2*accel*distance));
  return (cap-speed)/accel+(distance-accelerating)/cap;
}

export function crossingWindow(v:Vehicle,space:CrossingSpace,target:number,limit:number):CrossingWindow {
  const speed=Math.max(0,v.velocity??v.speed),spec=SPECS[v.kind];
  const canClear=target>.15&&limit>=space.exit+.5&&(v.velocity??v.speed)>=0;
  const entry=arrival(space.entry-v.s,speed,spec.accel,target);
  const plannedExit=canClear?arrival(space.exit-v.s,speed,spec.accel,target):Infinity;
  // A safe gap never relies on the other driver accelerating. A stationary
  // participant can get a planned turn, but cannot promise a measured exit.
  const exit=canClear&&speed>=.3?Math.max(0,space.exit-v.s)/Math.min(speed,target):Infinity;
  const measuredArrival=speed>=.3?Math.max(0,space.entry-v.s)/speed:entry;
  return {entry,arrival:measuredArrival,exit,plannedExit,canClear};
}

/** Undefined leaves a close tie to traffic rules / stable arrival ordering. */
export function earlierCrossing(a:CrossingWindow,b:CrossingWindow):boolean|undefined {
  if(a.canClear!==b.canClear)return a.canClear;
  if(!a.canClear)return undefined;
  if(a.exit+CROSSING_TIME_BUFFER<b.entry)return true;
  if(b.exit+CROSSING_TIME_BUFFER<a.entry)return false;
  // Prefer the first arrival when distinguishable; if arrival is close, use
  // the time needed to clear the whole vehicle, including a long truck's tail.
  if(Math.abs(a.arrival-b.arrival)>.35)return a.arrival<b.arrival;
  const exitA=Number.isFinite(a.exit)?a.exit:a.plannedExit;
  const exitB=Number.isFinite(b.exit)?b.exit:b.plannedExit;
  if(Math.abs(exitA-exitB)>.6)return exitA<exitB;
  return undefined;
}
