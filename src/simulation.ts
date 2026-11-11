import { observationContext, observeInContext, type ObservationContext, type VehicleObservations } from './vehicle-perception';
import type { VehicleMotionState } from './vehicle-motion';
import { defaultObservationProfiles } from './vehicle-observation';
import { DrivingSystem } from './driving';
export type Point = { x: number; y: number; z: number };
export type DrivingSide = 'right' | 'left';
export type Road = { id: number; points: Point[]; width: number; oneWay: boolean; roundabout?: boolean; priority?: number; control?: 'none' | 'yield' | 'stop'; junctionMode?: 'priority' | 'zipper' | 'all-way-stop' };
export type House = { id: number; x: number; z: number; kind: number; angle: number };
export type SignalColor = 'green' | 'yellow' | 'red';
export type SignalPhase = { duration:number; horizontal:SignalColor; vertical:SignalColor; turns?: 'all' | 'straight' | 'left' | 'right' };
export type Light = { x: number; z: number; offset: number; phases?:SignalPhase[] };
export type VehicleKind = 'bike' | 'car' | 'truck';
export const SPECS = {
  bike: { width: .8, length: 2, speed: 9, accel:2.4, brake:3.5, emergencyBrake:7, wheelbase:1.35, maxSteer:.65, lateralAccel:2.2, headway:.85, color: 0xf7c557 },
  car: { width: 1.8, length: 3.9, speed: 8, accel:1.8, brake:2.8, emergencyBrake:7, wheelbase:2.6, maxSteer:.65, lateralAccel:1.8, headway:1.25, color: 0xe8efeb },
  truck: { width: 2.3, length: 6.4, speed: 5.8, accel:1.05, brake:2.1, emergencyBrake:5, wheelbase:3.7, maxSteer:.7, lateralAccel:1.25, headway:1.7, color: 0x52a99c },
};
export const pt = (x: number, z: number, y = 0): Point => ({ x, y, z });
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const key = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)},${Math.round(p.z * 10)}`;
export function project(p: Point, a: Point, b: Point) {
  const t = clamp(((p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z))/(dist(a,b)**2 || 1),0,1);
  const point = lerp(a,b,t); return { point, t, distance: dist(p,point) };
}
function cleanPoints<T extends Point>(points:T[]):T[] {
  const clean:T[]=[];for(const p of points)if(!clean.length||dist(clean.at(-1)!,p)>.001)clean.push(p);return clean;
}
export function sampled(points: Point[], spacing = 2): Point[] {
  points=cleanPoints(points);
  const out = [points[0]];
  for(let i=1;i<points.length;i++) { const n=Math.max(1,Math.ceil(dist(points[i-1],points[i])/spacing)); for(let j=1;j<=n;j++) out.push(lerp(points[i-1],points[i],j/n)); }
  return out;
}
export function curve(a: Point, control: Point, b: Point) {
  return Array.from({length:49},(_,i)=>{const t=i/48; return lerp(lerp(a,control,t),lerp(control,b,t),t);});
}
function crossing(a: Point,b: Point,c: Point,d: Point) {
  const den=(b.x-a.x)*(d.z-c.z)-(b.z-a.z)*(d.x-c.x); if(Math.abs(den)<.00001)return null;
  const t=((c.x-a.x)*(d.z-c.z)-(c.z-a.z)*(d.x-c.x))/den;
  const u=((c.x-a.x)*(b.z-a.z)-(c.z-a.z)*(b.x-a.x))/den;
  if(t < -.0001 || t > 1.0001 || u < -.0001 || u > 1.0001)return null;
  const p=lerp(a,b,clamp(t,0,1)), q=lerp(c,d,clamp(u,0,1));
  return Math.abs(p.y-q.y)<.6 ? {p,t:clamp(t,0,1),u:clamp(u,0,1)} : null;
}
export class World {
  drivingSide:DrivingSide='right';
  setDrivingSide(side:DrivingSide){
    if(side===this.drivingSide)return;
    for(const road of this.roads)if(road.roundabout)road.points.reverse();
    this.drivingSide=side;
  }
  roads: Road[]=[]; houses: House[]=[]; lights: Light[]=[]; nextId=1;
  addRoad(points: Point[], width=5, oneWay=false) {
    if(points.length<2 || points.slice(1).reduce((s,p,i)=>s+dist(p,points[i]),0)<2)return;
    const incoming: Road={id:this.nextId++,points:sampled(points),width,oneWay};
    const cuts=new Map<Road, {index:number; t:number; point:Point}[]>(); cuts.set(incoming,[]);
    for(const road of this.roads) {
      for(let i=1;i<incoming.points.length;i++) for(let j=1;j<road.points.length;j++) {
        const hit=crossing(incoming.points[i-1],incoming.points[i],road.points[j-1],road.points[j]);
        if(hit) { cuts.get(incoming)!.push({index:i-1,t:hit.t,point:hit.p}); if(!cuts.has(road))cuts.set(road,[]); cuts.get(road)!.push({index:j-1,t:hit.u,point:hit.p}); }
      }
    }
    this.roads.push(incoming);
    for(const [road,raw] of cuts) {
      const sorted=raw.sort((a,b)=>a.index+a.t-b.index-b.t).filter((c,i,all)=> (!i||dist(c.point,all[i-1].point)>.1) && dist(c.point,road.points[0])>.1 && dist(c.point,road.points.at(-1)!)>.1);
      if(!sorted.length)continue;
      const fragments:Point[][]=[]; let current:Point[]=[road.points[0]], cursor=1;
      for(const cut of sorted) { while(cursor<=cut.index)current.push(road.points[cursor++]); current.push(cut.point); if(dist(current[0],current.at(-1)!)>.1)fragments.push(current); current=[cut.point]; }
      current.push(...road.points.slice(cursor)); if(current.length>1)fragments.push(current);
      this.roads=this.roads.filter(r=>r!==road);
      fragments.forEach(points=>this.roads.push({...road,id:this.nextId++,points:cleanPoints(points)}));
    }
  }
  nearest(p:Point) {
    let best:{road:Road; index:number; t:number; point:Point; distance:number}|null=null;
    for(const road of this.roads)for(let i=1;i<road.points.length;i++) { const q=project(p,road.points[i-1],road.points[i]); if(!best||q.distance<best.distance) best={...q,road,index:i-1}; }
    return best;
  }
  snap(p:Point):Point { const q=this.nearest(p); return q&&q.distance<6 ? {...q.point} : pt(Math.round(p.x),Math.round(p.z)); }
  addHouse(p:Point,kind=0) {
    const q=this.nearest(p); if(!q||q.distance>26||q.distance<q.road.width*(q.road.oneWay?.5:1)+4)return false;
    if(this.houses.some(h=>Math.hypot(h.x-p.x,h.z-p.z)<9))return false;
    this.houses.push({id:this.nextId++,x:p.x,z:p.z,kind,angle:Math.atan2(q.point.x-p.x,q.point.z-p.z)});return true;
  }
  roundabout(center:Point,radius=12,width=5) {
    const angles:number[]=[0,Math.PI/2,Math.PI,Math.PI*1.5]; const retained:Road[]=[];
    for(const road of this.roads) {
      let current:Point[]=[];
      for(let i=0;i<road.points.length;i++) {
        const p=road.points[i], outside=dist(p,center)>=radius || p.y>1;
        if(i>0) {
          const prev=road.points[i-1], was=dist(prev,center)>=radius || prev.y>1;
          if(outside!==was) {
            let lo=0,hi=1; for(let j=0;j<20;j++){const t=(lo+hi)/2;if((dist(lerp(prev,p,t),center)>=radius)===was)lo=t;else hi=t;}
            const hit=lerp(prev,p,(lo+hi)/2); angles.push((Math.atan2(hit.z-center.z,hit.x-center.x)+Math.PI*2)%(Math.PI*2));
            if(was){current.push(hit);retained.push({...road,id:this.nextId++,points:current});current=[];}else current=[hit];
          }
        }
        if(outside)current.push(p);
      }
      if(current.length>1)retained.push({...road,id:this.nextId++,points:current});
    }
    this.roads=retained;
    angles.sort((a,b)=>a-b); const unique=angles.filter((a,i)=>i===0||a-angles[i-1]>.01);
    for(let i=0;i<unique.length;i++) {
      const start=unique[i],end=unique[(i+1)%unique.length]+(i===unique.length-1?Math.PI*2:0);
      const points=Array.from({length:Math.max(3,Math.ceil((end-start)*radius/1.5))},(_,j,)=>{const t=start+(end-start)*j/(Math.max(3,Math.ceil((end-start)*radius/1.5))-1);return pt(center.x+Math.cos(t)*radius,center.z+Math.sin(t)*radius);});
      if(this.drivingSide==='right')points.reverse();
      this.roads.push({id:this.nextId++,points,width,oneWay:true,roundabout:true});
    }
  }
  private restoreLegacyRoundabouts(){
    // Older saves stored roundabouts as unlabelled clockwise one-way arcs.
    const pending=new Set(this.roads.filter(r=>r.oneWay&&!r.roundabout));
    while(pending.size){
      const group:Road[]=[pending.values().next().value!];pending.delete(group[0]);
      const nodes=new Set([key(group[0].points[0]),key(group[0].points.at(-1)!)]);
      for(let i=0;i<group.length;i++)for(const road of pending){
        if(!nodes.has(key(road.points[0]))&&!nodes.has(key(road.points.at(-1)!)))continue;
        pending.delete(road);group.push(road);nodes.add(key(road.points[0]));nodes.add(key(road.points.at(-1)!));
      }
      if(group.length<3||[...nodes].some(n=>group.filter(r=>key(r.points[0])===n).length!==1||group.filter(r=>key(r.points.at(-1)!)===n).length!==1))continue;
      const points=group.flatMap(r=>r.points),xs=points.map(p=>p.x),zs=points.map(p=>p.z);
      const center=pt((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2),radius=dist(center,points[0]);
      if(radius<4||points.some(p=>Math.abs(dist(center,p)-radius)>.1))continue;
      for(const road of group){
        road.roundabout=true;
        const turn=road.points.slice(1).reduce((sum,p,i)=>sum+(road.points[i].x-center.x)*(p.z-center.z)-(p.x-center.x)*(road.points[i].z-center.z),0);
        if(turn>0)road.points.reverse();
      }
    }
  }
  serialize(){return JSON.stringify({version:1,drivingSide:this.drivingSide,roads:this.roads,houses:this.houses,lights:this.lights,nextId:this.nextId});}
  restore(json:string){const v=JSON.parse(json);if(v.version!==1||!Array.isArray(v.roads)||!Array.isArray(v.houses))throw Error('Bản lưu không hợp lệ');this.drivingSide=v.drivingSide==='left'?'left':'right';this.roads=v.roads.map((r:Road)=>({...r,points:cleanPoints(r.points)}));this.houses=v.houses;this.lights=v.lights??[];this.nextId=v.nextId;if(v.drivingSide===undefined)this.restoreLegacyRoundabouts();}
}
type Edge={road:Road;reverse:boolean;start:string;end:string;length:number};
type WayPoint=Point&{width:number};
export type Pose=Point&{angle:number};
export type DrivingState = 'driving' | 'following' | 'red-light' | 'yielding' | 'exit-blocked' | 'stopping' | 'blocked' | 'reversing' | 'garage' | 'merging';
export type Vehicle={id:number;kind:VehicleKind;route:Route;s:number;offset:number;targetOffset:number;speed:number;pose:Pose;waiting:number;age:number;arrived:boolean;blocked:boolean;decision:number;garageYield?:number;inGarage?:boolean;leftHouse?:boolean; state?:DrivingState; motionState?:VehicleMotionState; reason?:string; blockerId?:number; stuckTime?:number; velocity?:number; acceleration?:number; steering?:number; indicator?:-1|0|1; braking?:boolean; approachSince?:number; approachId?:string; stopTime?:number; stopSince?:number; driverFactor?:number; lane?:number; rerouteAt?:number; tripDistance?:number};
export type Movement = { id:string; entry:number; exit:number; stop:number; center:Point; incoming:number; outgoing:number; incomingRoad?:number; turn:-1|0|1; priority:number; control:'none'|'yield'|'stop'; mode:'priority'|'zipper'|'all-way-stop'; circulating:boolean; enteringRoundabout:boolean; light?:Light };
export class Route {
  movements:Movement[]=[]; roadIds:number[]=[];
  fromHouse?:number;toHouse?:number;departureDoor?:Pose;departureLength=0;arrivalLength=0;
  turns:{start:number;end:number;direction:number}[]=[];
  points:WayPoint[]; lengths:number[]=[0]; total:number; signals:{s:number;light:Light;vertical:boolean}[]=[];
  constructor(raw:WayPoint[],lights:Light[]) {
    let points=raw.filter((p,i)=>!i||dist(p,raw[i-1])>.05);
    // Chaikin corners stay inside the road's convex junction surface.
    for(let n=0;n<2;n++){const smooth=[points[0]];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];smooth.push({...lerp(a,b,.25),width:Math.min(a.width,b.width)},{...lerp(a,b,.75),width:Math.min(a.width,b.width)});}smooth.push(points.at(-1)!);points=smooth;}
    this.points=points;for(let i=1;i<points.length;i++)this.lengths.push(this.lengths.at(-1)!+dist(points[i-1],points[i]));this.total=this.lengths.at(-1)!;
    // Detect whole bends, including driveway entrances, rather than treating
    // each small segment of a smooth corner as a separate manoeuvre.
    let bend:{start:number;end:number;angle:number}|undefined;
    const finish=()=>{if(bend&&Math.abs(bend.angle)>.4)this.turns.push({start:bend.start,end:bend.end,direction:Math.sign(bend.angle)});bend=undefined;};
    for(let s=1;s<this.total-1;s+=1){
      const a=this.at(s-1).angle,b=this.at(s).angle,delta=Math.atan2(Math.sin(b-a),Math.cos(b-a));
      if(Math.abs(delta)>.012){
        if(bend&&(s-bend.end>2||Math.sign(delta)!==Math.sign(bend.angle)))finish();
        if(!bend)bend={start:Math.max(0,s-2),end:s+1,angle:0};
        bend.end=s+1;bend.angle+=delta;
      }else if(bend&&s-bend.end>2)finish();
    }
    finish();
    for(const light of lights){
      let nearest=Infinity,index=0,fraction=0,elevation=0;
      for(let i=1;i<points.length;i++){const q=project(pt(light.x,light.z),points[i-1],points[i]);if(q.distance<nearest){nearest=q.distance;index=i;fraction=q.t;elevation=q.point.y;}}
      if(nearest<9&&index>0&&elevation<1){const p=points[index],prev=points[index-1],s=this.lengths[index-1]+(this.lengths[index]-this.lengths[index-1])*fraction;this.signals.push({s:Math.max(0,s-8),light,vertical:Math.abs(p.z-prev.z)>Math.abs(p.x-prev.x)});}
    }
  }
  locate(p:Point, around=0, radius=Infinity){
    let best={s:around,offset:0,distance:Infinity};
    let low=0,high=this.lengths.length-1;
    while(low+1<high){const mid=(low+high)>>1;if(this.lengths[mid]<around-radius)low=mid;else high=mid;}
    for(let i=Math.max(1,low);i<this.points.length&&this.lengths[i-1]<=around+radius;i++){
      const q=project(p,this.points[i-1],this.points[i]);
      if(q.distance<best.distance){const s=this.lengths[i-1]+(this.lengths[i]-this.lengths[i-1])*q.t,pose=this.at(s);best={s,offset:(p.x-pose.x)*Math.cos(pose.angle)-(p.z-pose.z)*Math.sin(pose.angle),distance:q.distance};}
    }
    return best;
  }
  curvature(s:number){const a=this.at(s-1).angle,b=this.at(s+1).angle;return Math.atan2(Math.sin(b-a),Math.cos(b-a))/2;}
  movement(s:number,ahead=24){return this.movements.find(m=>m.exit>=s&&m.stop<=s+ahead);}
  upcomingTurn(s:number,ahead=16){return this.turns.find(t=>t.end>=s&&t.start<=s+ahead);}
  position(s:number):Point&{width:number} {
    s=clamp(s,0,this.total);let low=0,high=this.lengths.length-1;
    while(low+1<high){const mid=(low+high)>>1;if(this.lengths[mid]<=s)low=mid;else high=mid;}
    const a=this.points[low],b=this.points[high],t=(s-this.lengths[low])/(this.lengths[high]-this.lengths[low]||1);
    return {...lerp(a,b,t),width:Math.min(a.width,b.width)};
  }
  at(s:number,offset=0):Pose&{width:number} {
    s=clamp(s,0,this.total);
    const p=this.position(s),a=this.position(s-1.5),b=this.position(s+1.5),angle=Math.atan2(b.x-a.x,b.z-a.z);
    return {...p,x:p.x+Math.cos(angle)*offset,z:p.z-Math.sin(angle)*offset,angle};
  }
}
export function overlaps(a:Pose,ak:VehicleKind,b:Pose,bk:VehicleKind,margin=.12) {
  if(Math.abs(a.y-b.y)>2.5)return false;
  const sa=SPECS[ak],sb=SPECS[bk],dx=b.x-a.x,dz=b.z-a.z;
  if(Math.hypot(dx,dz)>(sa.length+sb.length)/2+2)return false;
  const af={x:Math.sin(a.angle),z:Math.cos(a.angle)},ar={x:Math.cos(a.angle),z:-Math.sin(a.angle)},bf={x:Math.sin(b.angle),z:Math.cos(b.angle)},br={x:Math.cos(b.angle),z:-Math.sin(b.angle)};
  for(const axis of [af,ar,bf,br]) {
    const dot=(u:{x:number;z:number})=>Math.abs(u.x*axis.x+u.z*axis.z);
    const ra=dot(af)*(sa.length/2+margin)+dot(ar)*(sa.width/2+margin),rb=dot(bf)*(sb.length/2+margin)+dot(br)*(sb.width/2+margin);
    if(Math.abs(dx*axis.x+dz*axis.z)>=ra+rb)return false;
  }
  return true;
}
function directed(road:Road,reverse:boolean,side:DrivingSide,points=road.points):WayPoint[] {
  const clean=cleanPoints(points);const p=reverse?[...clean].reverse():clean;
  return p.map((v,i)=>{const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],angle=Math.atan2(b.x-a.x,b.z-a.z),shift=road.oneWay?0:road.width/2*(side==='right'?-1:1);return {...v,x:v.x+Math.cos(angle)*shift,z:v.z-Math.sin(angle)*shift,width:road.width};});
}
function pathLength(points:Point[]){return points.slice(1).reduce((s,p,i)=>s+dist(p,points[i]),0);}
function trimPath(points:WayPoint[],start:number,end:number){
  const length=pathLength(points),result:WayPoint[]=[];let walked=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],segment=dist(a,b),lo=Math.max(start,walked),hi=Math.min(length-end,walked+segment);
    if(hi>lo&&segment>.001){const width=Math.min(a.width,b.width);result.push({...lerp(a,b,(lo-walked)/segment),width},{...lerp(a,b,(hi-walked)/segment),width});}
    walked+=segment;
  }
  return cleanPoints(result);
}
function connectPaths(chunks:WayPoint[][]):WayPoint[]{
  const starts=chunks.map(()=>0),ends=chunks.map(()=>0);
  for(let i=1;i<chunks.length;i++){
    const a=chunks[i-1],b=chunks[i],last=a.at(-1)!,first=b[0];
    const prev=a.at(-2)!,next=b[1],la=dist(prev,last)||1,lb=dist(first,next)||1;
    const dot=((last.x-prev.x)*(next.x-first.x)+(last.z-prev.z)*(next.z-first.z))/(la*lb);
    if(dot>.995&&dist(last,first)<.05)continue;
    const trim=Math.max(last.width,first.width)+1;
    ends[i-1]=Math.min(trim,pathLength(a)*.4);starts[i]=Math.min(trim,pathLength(b)*.4);
  }
  const pieces=chunks.map((c,i)=>trimPath(c,starts[i],ends[i]));const result:WayPoint[]=[];
  for(const piece of pieces){
    if(piece.length<2)continue;
    if(result.length>1&&dist(result.at(-1)!,piece[0])>.05){
      const a=result.at(-1)!,b=piece[0],before=result.at(-2)!,after=piece[1];
      const handle=dist(a,b)*.45,la=dist(before,a)||1,lb=dist(b,after)||1;
      const c={x:a.x+(a.x-before.x)/la*handle,y:a.y,z:a.z+(a.z-before.z)/la*handle};
      const d={x:b.x-(after.x-b.x)/lb*handle,y:b.y,z:b.z-(after.z-b.z)/lb*handle};
      const count=Math.max(4,Math.ceil(dist(a,b)/.6));
      for(let j=1;j<count;j++){
        const t=j/count,u=1-t;
        result.push({x:u*u*u*a.x+3*u*u*t*c.x+3*u*t*t*d.x+t*t*t*b.x,y:a.y+(b.y-a.y)*t,z:u*u*u*a.z+3*u*u*t*c.z+3*u*t*t*d.z+t*t*t*b.z,width:Math.min(a.width,b.width)});
      }
    }
    result.push(...piece);
  }
  return cleanPoints(result);
}
export function planRoute(world:World,from:House,to:House,options:{kind?:VehicleKind;roadDelay?:Map<number,number>;startPose?:Pose}={}):Route|null {
  const a=world.nearest(pt(from.x,from.z)),b=world.nearest(pt(to.x,to.z));if(!a||!b)return null;
  const edges:Edge[]=world.roads.flatMap(road=>{const base={road,start:key(road.points[0]),end:key(road.points.at(-1)!),length:road.points.slice(1).reduce((s,p,i)=>s+dist(p,road.points[i]),0),reverse:false};return road.oneWay?[base]:[base,{...base,start:base.end,end:base.start,reverse:true}];});
  let best:{cost:number;path:WayPoint[]}|null=null;
  // Driveways join the closest carriageway; avoid crossing opposing traffic at every house.
  const nearSide=(q:NonNullable<ReturnType<World['nearest']>>,h:House)=>{const p=q.road.points[q.index],n=q.road.points[q.index+1];const leftSide=(h.x-q.point.x)*(n.z-p.z)-(h.z-q.point.z)*(n.x-p.x)<0;return world.drivingSide==='left'?leftSide:!leftSide;};
  const sideA=a.road.oneWay?false:nearSide(a,from),sideB=b.road.oneWay?false:nearSide(b,to);
  for(const reverseA of a.road.oneWay?[false]:[sideA,!sideA])for(const reverseB of b.road.oneWay?[false]:[sideB,!sideB]) {
    const tangent=Math.atan2(a.road.points[a.index+1].x-a.road.points[a.index].x,a.road.points[a.index+1].z-a.road.points[a.index].z)+(reverseA?Math.PI:0);
    if(options.startPose&&Math.cos(tangent-options.startPose.angle)<.85)continue;
    const first=reverseA?[...a.road.points.slice(0,a.index+1),a.point]:[a.point,...a.road.points.slice(a.index+1)];
    const last=reverseB?[b.point,...b.road.points.slice(b.index+1)]:[...b.road.points.slice(0,b.index+1),b.point];
    const start=key(reverseA?a.road.points[0]:a.road.points.at(-1)!),end=key(reverseB?b.road.points.at(-1)!:b.road.points[0]);
    // Search directed incoming edges, so a cheaper node visit cannot hide
    // an illegal immediate reversal at the next connection.
    const edgeKey=(road:Road,reverse:boolean)=>`${road.id}:${Number(reverse)}`;
    const initial=edgeKey(a.road,reverseA);
    const states=new Map<string,{node:string;road:Road;reverse:boolean}>([[initial,{node:start,road:a.road,reverse:reverseA}]]);
    const costs=new Map([[initial,0]]),prev=new Map<string,{from:string;edge:Edge}>(),pending=new Set([initial]),visited=new Set<string>();
    let terminal:string|null=null;
    while(pending.size){
      const state=[...pending].sort((x,y)=>costs.get(x)!-costs.get(y)!)[0];pending.delete(state);
      const incoming=states.get(state)!;
      if(incoming.node===end&&!(incoming.road===b.road&&incoming.reverse!==reverseB)){terminal=state;break;}
      visited.add(state);
      for(const e of edges){
        if(e.start!==incoming.node||(e.road===incoming.road&&e.reverse!==incoming.reverse))continue;
        const next=edgeKey(e.road,e.reverse),cost=costs.get(state)!+e.length+(options.roadDelay?.get(e.road.id)??0);
        if(options.kind&&e.road.width<SPECS[options.kind].width+.55)continue;
        if(!visited.has(next)&&cost<(costs.get(next)??Infinity)){
          costs.set(next,cost);states.set(next,{node:e.end,road:e.road,reverse:e.reverse});prev.set(next,{from:state,edge:e});pending.add(next);
        }
      }
    }
    if(terminal===null)continue;
    const middle:Edge[]=[];let state=terminal;
    while(state!==initial){const step=prev.get(state)!;middle.unshift(step.edge);state=step.from;}
    const chunks=[directed(a.road,reverseA,world.drivingSide,first),...middle.map(e=>directed(e.road,e.reverse,world.drivingSide)),directed(b.road,reverseB,world.drivingSide,last)].filter(c=>c.length>1);
    const route=connectPaths(chunks);
    const cost=route.slice(1).reduce((s,p,i)=>s+dist(p,route[i]),0)+(reverseA!==sideA?25:0)+(reverseB!==sideB?25:0)+(options.roadDelay?.get(a.road.id)??0)+(options.roadDelay?.get(b.road.id)??0)+middle.reduce((sum,e)=>sum+(options.roadDelay?.get(e.road.id)??0),0);
    if(!best||cost<best.cost)best={cost,path:route};
  }
  // Direct trips on the same road do not need to circle through an endpoint.
  if(a.road===b.road){const reverse=a.index+a.t>b.index+b.t;const tangent=Math.atan2(a.road.points[a.index+1].x-a.road.points[a.index].x,a.road.points[a.index+1].z-a.road.points[a.index].z)+(reverse?Math.PI:0);if((!a.road.oneWay||!reverse)&&(!options.startPose||Math.cos(tangent-options.startPose.angle)>.85)){const lo=reverse?b:a,hi=reverse?a:b;const raw=[lo.point,...a.road.points.slice(lo.index+1,hi.index+1),hi.point];const path=directed(a.road,reverse,world.drivingSide,raw);const cost=path.slice(1).reduce((s,p,i)=>s+dist(p,path[i]),0)+(reverse!==sideA?25:0)+(reverse!==sideB?25:0)+(options.roadDelay?.get(a.road.id)??0);if(!best||cost<best.cost)best={cost,path};}}
  if(!best||best.path.length<2)return null;
  // Driveways connect the actual house doorway to the road.
  const door=(h:House,side:number):WayPoint=>({...pt(h.x+Math.sin(h.angle)*4.2+Math.cos(h.angle)*side,h.z+Math.cos(h.angle)*4.2-Math.sin(h.angle)*side),width:6.4});
  const doorSide=world.drivingSide==='right'?-1:1;
  const departure=options.startPose?{...options.startPose,width:a.road.width}:door(from,1.6*doorSide),arrival=door(to,-1.6*doorSide);
  let raw:WayPoint[];
  if(options.startPose){
    const ahead={...departure,x:departure.x+Math.sin(options.startPose.angle)*2,z:departure.z+Math.cos(options.startPose.angle)*2};
    const onward=trimPath(best.path,Math.min(4,pathLength(best.path)*.2),0);
    raw=connectPaths([[departure,ahead],onward,[best.path.at(-1)!,arrival]].filter(c=>c.length>1&&pathLength(c)>.05));
  }else raw=connectPaths([[departure,best.path[0]],best.path,[best.path.at(-1)!,arrival]]);
  const route=new Route(raw,world.lights);
  if(!options.startPose){route.fromHouse=from.id;route.departureDoor={...departure,angle:from.angle};route.departureLength=dist(departure,best.path[0])+3;}
  route.toHouse=to.id;
  route.arrivalLength=dist(door(to,-1.6*doorSide),best.path.at(-1)!)+6;
  annotateMovements(route,world);
  if(options.kind&&route.points.some(p=>p.width<SPECS[options.kind!].width+.35))return null;
  return route;
}
export function protectedSignalPhases():SignalPhase[]{
  const phases:SignalPhase[]=[];
  for(const vertical of [false,true])for(const turns of ['straight','left','right'] as const){
    phases.push({duration:turns==='straight'?7:4,horizontal:vertical?'red':'green',vertical:vertical?'green':'red',turns},
      {duration:2,horizontal:vertical?'red':'yellow',vertical:vertical?'yellow':'red',turns},
      {duration:1,horizontal:'red',vertical:'red'});
  }
  return phases;
}
export function signalState(time:number,light:Light,vertical:boolean,turn:'straight'|'left'|'right'='straight'):SignalColor {
  const phases=light.phases??[
    {duration:1,horizontal:'red',vertical:'red'}, {duration:7,horizontal:'green',vertical:'red'},
    {duration:3,horizontal:'yellow',vertical:'red'}, {duration:2,horizontal:'red',vertical:'red'},
    {duration:7,horizontal:'red',vertical:'green'}, {duration:3,horizontal:'red',vertical:'yellow'},
    {duration:1,horizontal:'red',vertical:'red'},
  ] satisfies SignalPhase[];
  const total=phases.reduce((n,p)=>n+Math.max(0,p.duration),0);if(!total)return 'red';
  let phase=((time+light.offset)%total+total)%total;
  for(const p of phases){if(phase<p.duration)return p.turns&&p.turns!=='all'&&p.turns!==turn?'red':(vertical?p.vertical:p.horizontal);phase-=Math.max(0,p.duration);}
  return 'red';
}
export function lightGreen(time:number,light:Light,vertical:boolean){return signalState(time,light,vertical)==='green';}

/** Junction identity and approach priority come from road topology, never route curvature. */
export function annotateMovements(route:Route,world:World){
  route.movements=[];route.roadIds=[];
  const nodes=new Map<string,{point:Point;roads:Road[]}>();
  for(const road of world.roads){for(const point of [road.points[0],road.points.at(-1)!]){const k=key(point),node=nodes.get(k)??{point,roads:[]};node.roads.push(road);nodes.set(k,node);}}
  for(const [id,node] of nodes){
    if(node.roads.length<3)continue;
    const q=route.locate(node.point);const radius=Math.max(...node.roads.map(r=>r.width))+1;
    if(q.distance>radius||q.s<route.departureLength-2||q.s>route.total-route.arrivalLength+2)continue;
    const entry=Math.max(0,q.s-radius),exit=Math.min(route.total,q.s+radius);
    const before=route.at(Math.max(0,entry-2)),after=route.at(Math.min(route.total,exit+2));
    const nearestRoad=(p:Point)=>node.roads.map(road=>({road,d:Math.min(...road.points.slice(1).map((b,i)=>project(p,road.points[i],b).distance))})).sort((a,b)=>a.d-b.d)[0].road;
    const incoming=nearestRoad(before),outgoing=nearestRoad(after);
    const delta=Math.atan2(Math.sin(after.angle-before.angle),Math.cos(after.angle-before.angle));
    const turn=(Math.abs(delta)<.45?0:Math.sign(delta)) as -1|0|1;
    route.movements.push({id,entry,exit,stop:entry,center:node.point,incoming:before.angle,outgoing:after.angle,incomingRoad:incoming.id,turn,
      priority:incoming.priority??0,control:incoming.control??'none',mode:node.roads.some(r=>r.junctionMode==='all-way-stop')?'all-way-stop':node.roads.some(r=>r.junctionMode==='zipper')?'zipper':'priority',
      circulating:!!incoming.roundabout,enteringRoundabout:!incoming.roundabout&&!!outgoing.roundabout,
      light:node.point.y<1?world.lights.find(l=>dist(pt(l.x,l.z),node.point)<2):undefined});
  }
  route.movements.sort((a,b)=>a.entry-b.entry);
  // Bind a light to its incoming approach and explicit stop line, not the bend tangent.
  route.signals=route.movements.filter(m=>m.light).map(m=>({s:m.stop,light:m.light!,vertical:Math.abs(Math.cos(m.incoming))>Math.abs(Math.sin(m.incoming))}));
  for(let s=route.departureLength;s<route.total-route.arrivalLength;s+=5){const road=world.nearest(route.at(s))?.road;if(road&&!route.roadIds.includes(road.id))route.roadIds.push(road.id);}
}
export class Simulation {
  observationProfiles=defaultObservationProfiles();
  prepareObservation?: (sim:Simulation)=>ObservationContext;
  observations=new Map<number,VehicleObservations>();
  refreshObservations(){
    const context=this.prepareObservation?.(this)??observationContext(this.vehicles);
    this.observations.clear();
    for(const v of this.vehicles)if(!v.arrived&&!v.inGarage)
      this.observations.set(v.id,observeInContext(v,this.observationProfiles[v.kind],context));
  }
  vehicles:Vehicle[]=[];time=0;completed=0;nextId=1;target=50;spawnClock=0;paused=false;types:Record<VehicleKind,boolean>={bike:true,car:true,truck:true};
  private driving=new DrivingSystem();
  // Keep consumed random values so restoring a checkpoint also restores the
  // random stream, including custom random sources supplied by tests/callers.
  private randomValues:number[]=[];
  private randomCursor=0;
  readonly random:()=>number;
  constructor(public world:World,random:()=>number=Math.random){
    this.random=()=>{
      if(this.randomCursor===this.randomValues.length)this.randomValues.push(random());
      return this.randomValues[this.randomCursor++];
    };
  }
  reset(){this.randomValues=[];this.randomCursor=0;this.vehicles=[];this.time=0;this.completed=0;this.spawnClock=0;this.driving=new DrivingSystem();this.observations.clear();}
  snapshot(){
    return {randomCursor:this.randomCursor,time:this.time,completed:this.completed,nextId:this.nextId,spawnClock:this.spawnClock,
      observationProfiles:structuredClone(this.observationProfiles),target:this.target,types:{...this.types},driving:this.driving.snapshot(),
      vehicles:this.vehicles.map(({route,...state})=>({...structuredClone(state),route}))};
  }
  restore(snapshot:ReturnType<Simulation['snapshot']>){
    this.randomCursor=snapshot.randomCursor;
    Object.assign(this.observationProfiles,structuredClone(snapshot.observationProfiles));
    this.time=snapshot.time;this.completed=snapshot.completed;this.nextId=snapshot.nextId;
    this.spawnClock=snapshot.spawnClock;this.target=snapshot.target;this.types={...snapshot.types};
    this.observations.clear();
    this.vehicles=snapshot.vehicles.map(({route,...state})=>({...structuredClone(state),route}));
    this.driving=new DrivingSystem();this.driving.restore(snapshot.driving);
  }
  spawn(){
    const kinds=(Object.keys(this.types) as VehicleKind[]).filter(k=>this.types[k]);if(!kinds.length||this.world.houses.length<2)return;
    const from=this.world.houses[Math.floor(this.random()*this.world.houses.length)],to=this.world.houses[Math.floor(this.random()*this.world.houses.length)];if(from===to)return;
    const distribution=kinds.flatMap(k=>Array.from({length:k==='bike'?5:k==='car'?3:1},()=>k));
    const kind=distribution[Math.floor(this.random()*distribution.length)],route=planRoute(this.world,from,to,{kind,roadDelay:this.driving.roadDelay(this)});if(!route||route.total<8)return;
    const pose=route.at(0);if(this.vehicles.some(v=>!v.inGarage&&overlaps(pose,kind,v.pose,v.kind,.45)))return;
    this.vehicles.push({id:this.nextId++,kind,route,s:0,offset:0,targetOffset:0,speed:0,pose,waiting:0,age:0,arrived:false,blocked:false,decision:0,driverFactor:.92+this.random()*.16});
  }
  step(dt=1/60){
    if(this.paused||!Number.isFinite(dt)||dt<=0)return;
    // Bound integration and decision intervals even when callers supply a large delta.
    const count=Math.ceil(dt/(1/60)),slice=dt/count;
    for(let i=0;i<count;i++){
      this.time+=slice;this.spawnClock+=slice;
      if(this.spawnClock>.55&&this.vehicles.length<this.target){this.spawnClock=0;this.spawn();}
      this.driving.step(this,slice);
      this.vehicles=this.vehicles.filter(v=>!v.arrived);
    }
  }
}
export function demoWorld(){
  const w=new World();
  w.addRoad([pt(-70,-40),pt(66,-40)],5);w.addRoad([pt(-70,40),pt(66,40)],5);
  w.addRoad([pt(-70,-40),pt(-70,40)],5);w.addRoad([pt(66,-40),pt(66,40)],5);
  w.addRoad([pt(-70,0),pt(66,0)],5);w.addRoad([pt(-16,-40),pt(-16,40)],5);
  w.addRoad([pt(-45,-40),pt(-45,0)],4);
  w.roundabout(pt(-16,0),11,5);
  // Elevate the two river crossings; ground-level connections remain at the banks.
  for(const r of [...w.roads]){
    if(r.points.every(p=>Math.abs(p.z)<.1||Math.abs(p.z+40)<.1||Math.abs(p.z-40)<.1)&&Math.min(...r.points.map(p=>p.x))<18&&Math.max(...r.points.map(p=>p.x))>38){r.points=r.points.map(p=>({...p,y:p.x>9&&p.x<49?Math.sin((p.x-9)/40*Math.PI)*5.2:0}));}
  }
  w.addRoad(curve(pt(66,40),pt(92,67),pt(35,65)),4);
  [[-59,-53],[-42,-53],[-22,-53],[-4,-53],[12,-53],[55,-53],[79,-28],[79,-7],[79,16],[54,13],[51,28],[11,28],[-3,27],[-30,27],[-48,27],[-57,53],[-37,53],[-15,53],[7,53],[54,53],[-58,-25],[-57,-12],[-32,-27],[-3,-25],[11,-26],[-82,-21],[-82,9],[-82,29]].forEach(([x,z],i)=>w.addHouse(pt(x,z),i%4));
  w.lights=[{x:-45,z:-40,offset:0},{x:66,z:0,offset:5}];return w;
}
