import { advanceVehicle } from './kinematics';
import { movingBodiesOverlap } from './collision';
import { SPECS, dist, type Pose, type Vehicle } from './simulation';

export const YIELD_BUFFER = .5;
const STEP = .1;
const HORIZON = 3;
type Model = 'current' | 'route' | 'left' | 'right';
type Sample = { pose:Pose; s:number; distance:number; time:number; speed:number; offset:number; steering:number };
type Path = Sample[];
type Motion = ReturnType<typeof advanceVehicle>;
export type SteeringAvoidance = { steering:number; target:number; targetOffset:number; duration:number };
export type YieldRisk = { id:number; time:number; distance:number; unavoidable:boolean };
export type YieldPlan = {
  risks:YieldRisk[];
  distance:number;
  limit:number;
  target:number;
  emergency:boolean;
};

/** Short, rate-limited forecasts. Other drivers retain their measured speed,
 * even when braking: an intention to brake is not proof that they have stopped.
 * Own motion may accelerate, brake or approach a finite stopping distance. */
function forecast(vehicle:Vehicle,model:Model,target?:number,stopDistance=Infinity,limit=Infinity,steering?:number,steeringTime=Infinity,horizon=HORIZON,brakeAt=Infinity,brake?:number):Path {
  const spec=SPECS[vehicle.kind],measured=vehicle.velocity??vehicle.speed;
  let probe={...vehicle},speed=target===undefined?measured:Math.max(0,measured),distance=0;
  const path:Path=[{pose:vehicle.pose,s:vehicle.s,distance,time:0,speed,offset:vehicle.offset,steering:vehicle.steering??0}];
  if(target===undefined&&Math.abs(measured)<1e-9){
    // A stationary neighbour's steering changes do not move its body. Avoid
    // repeatedly integrating and locating the same pose for every model.
    for(let i=1;i<=Math.ceil(horizon/STEP);i++)path.push({...path[0],time:i*STEP});
    return path;
  }
  for(let i=1;i<=Math.ceil(horizon/STEP);i++){
    if(target!==undefined){
      const stopSpeed=Math.sqrt(2*Math.min(1.8,spec.brake)*Math.max(0,stopDistance-distance-.15));
      const wanted=i*STEP>brakeAt?0:Math.min(target,stopSpeed);
      speed=Math.max(0,speed+Math.max(-(brake??spec.emergencyBrake)*STEP,Math.min(spec.accel*STEP,wanted-speed)));
    }
    const override=model==='current'?(vehicle.steering??0):model==='left'?spec.maxSteer:model==='right'?-spec.maxSteer:i*STEP<=steeringTime+1e-9?steering:undefined;
    let travel=speed*STEP;
    let next=advanceVehicle(probe,travel,vehicle.targetOffset,STEP,override);
    if(target!==undefined&&next.s>limit){
      travel*=Math.max(0,(limit-probe.s)/Math.max(1e-8,next.s-probe.s));
      next=advanceVehicle(probe,travel,vehicle.targetOffset,STEP,override);
      speed=travel/STEP;
    }
    distance+=Math.abs(travel);probe={...probe,...next};
    path.push({pose:next.pose,s:next.s,distance,time:i*STEP,speed,offset:next.offset,steering:next.steering});
  }
  return path;
}

function firstContact(own:Path,kind:Vehicle['kind'],other:Path,otherKind:Vehicle['kind'],margin=.06):{time:number;distance:number}|undefined {
  const a=SPECS[kind],b=SPECS[otherKind],radius=Math.hypot(a.length,a.width)/2+Math.hypot(b.length,b.width)/2+margin*4;
  for(let i=1;i<Math.min(own.length,other.length);i++){
    // Bounding circles around the swept centres reject distant intervals before SAT.
    const separation=dist(own[i-1].pose,other[i-1].pose);
    const travel=own[i].distance-own[i-1].distance+other[i].distance-other[i-1].distance;
    if(separation>radius+travel)continue;
    if(movingBodiesOverlap(own[i-1].pose,own[i].pose,kind,other[i-1].pose,other[i].pose,otherKind,margin)){
      return {time:own[i-1].time,distance:own[i-1].distance};
    }
  }
  return undefined;
}

/** One instance per decision snapshot. Forecasts are shared across observers,
 * never saved in replay checkpoints or reused after vehicles have moved. */
export class YieldPrediction {
  private paths=new Map<string,Path>();
  private path(vehicle:Vehicle,model:Model,horizon=HORIZON){
    const key=`${vehicle.id}:${model}:${horizon}`;
    let path=this.paths.get(key);
    if(!path){path=forecast(vehicle,model,undefined,Infinity,Infinity,undefined,Infinity,horizon);this.paths.set(key,path);}
    return path;
  }

  /** Search the remaining steering range using the same rate-limited motion
   * as the physical vehicle. A clear first step alone is not a usable detour. */
  steerAround(vehicle:Vehicle,observed:Vehicle[],target:number,limit:number,
    canMove:(from:Vehicle,to:Motion)=>boolean,onlySteering?:number,offset?:number,duration=.6):SteeringAvoidance|undefined {
    const spec=SPECS[vehicle.kind],current=vehicle.steering??0;
    const candidates=onlySteering===undefined
      ? [current,...Array.from({length:8},(_,i)=>current+(spec.maxSteer-current)*(i+1)/8),
        ...Array.from({length:8},(_,i)=>current+(-spec.maxSteer-current)*(i+1)/8)]
      : [onlySteering];
    let best:{steering:number;target:number;targetOffset:number;score:number}|undefined;
    for(const steering of new Set(candidates)){
      if(onlySteering===undefined&&Math.abs(steering-current)<.015&&Math.abs(current)<spec.maxSteer-.015)continue;
      if(Math.abs(steering)<.015||Math.abs(steering)>spec.maxSteer+1e-8)continue;
      const curveSpeed=Math.sqrt(spec.lateralAccel*spec.wheelbase/Math.max(.001,Math.abs(Math.tan(steering))));
      const speed=Math.min(target,2.5,curveSpeed);
      if(speed<.15)continue;
      const bound=Math.max(0,(vehicle.route.at(vehicle.s).width-spec.width)/2-.28);
      const halfBody=Math.max(spec.width,...observed.filter(o=>!o.arrived&&!o.inGarage).map(o=>SPECS[o.kind].width))/2;
      const targetOffset=offset??Math.sign(steering)*Math.min(bound,spec.width/2+halfBody+YIELD_BUFFER+.7);
      // Include a full braking tail: a detour must end somewhere it can stop.
      // Look beyond the nearest stationary blocker, including its tail.
      // A long truck can occupy more than the old three-second preview.
      const blockers=observed.filter(o=>o.id!==vehicle.id&&!o.arrived&&!o.inGarage&&Math.abs(o.velocity??o.speed)<.3)
        .map(o=>({o,along:(o.pose.x-vehicle.pose.x)*Math.sin(vehicle.pose.angle)+(o.pose.z-vehicle.pose.z)*Math.cos(vehicle.pose.angle)}))
        .filter(({along})=>along>0&&along<12);
      const clearance=blockers.length?Math.min(...blockers.map(({o,along})=>along+(spec.length+SPECS[o.kind].length)/2+YIELD_BUFFER)):0;
      const driveTime=Math.max(HORIZON,Math.min(6,clearance/Math.max(.5,speed)+speed/spec.accel));
      const horizon=driveTime+Math.ceil(speed/spec.brake/STEP)*STEP+.2;
      const path=forecast({...vehicle,targetOffset},'route',speed,Infinity,limit,steering,duration,horizon,driveTime,spec.brake);
      const end=path.at(-1)!;
      if(end.s-vehicle.s<1||end.distance<1.5)continue;
      let probe={...vehicle},clear=true;
      for(const sample of path.slice(1)){
        const next={pose:sample.pose,s:sample.s,offset:sample.offset,steering:sample.steering};
        if(!canMove(probe,next)){clear=false;break;}
        probe={...probe,...next};
      }
      if(!clear)continue;
      // Check every observed moving body, including cars approaching the new
      // corridor from behind. They must be clear at the same future times.
      for(const other of observed){
        if(other.id===vehicle.id||other.arrived||other.inGarage)continue;
        if(firstContact(path,vehicle.kind,this.path(other,'current',horizon),other.kind,YIELD_BUFFER/2)
          ||firstContact(path,vehicle.kind,this.path(other,'route',horizon),other.kind,YIELD_BUFFER/2)){
          clear=false;break;
        }
      }
      if(!clear)continue;
      const score=end.s-vehicle.s-Math.abs(steering-current)*.4-Math.abs(probe.offset)*.2;
      if(!best||score>best.score)best={steering,target:speed,targetOffset,score};
    }
    return best?{steering:best.steering,target:best.target,targetOffset:best.targetOffset,duration}:undefined;
  }

  plan(vehicle:Vehicle,observed:Vehicle[],target:number,limit=vehicle.route.total,steering?:number):YieldPlan|undefined {
    if((vehicle.velocity??vehicle.speed)<-.01)return undefined;
    const spec=SPECS[vehicle.kind];
    const others=observed.filter(other=>{
      if(other.id===vehicle.id||other.arrived||other.inGarage)return false;
      const body=SPECS[other.kind];
      const reach=(Math.max(vehicle.speed,target)+Math.abs(other.velocity??other.speed))*HORIZON
        +Math.hypot(spec.length,spec.width)/2+Math.hypot(body.length,body.width)/2+1;
      return dist(vehicle.pose,other.pose)<=reach;
    });
    if(!others.length)return undefined;
    const nominal=forecast(vehicle,'route',Math.max(0,target),Infinity,limit,steering);
    const evaluate=(own:Path,margin=.06):YieldRisk[]=>{
      const risks:YieldRisk[]=[];
      for(const other of others){
        const current=firstContact(own,vehicle.kind,this.path(other,'current'),other.kind,margin);
        const intended=firstContact(own,vehicle.kind,this.path(other,'route'),other.kind,margin);
        const contact=!current?intended:!intended?current:current.time<=intended.time?current:intended;
        if(contact)risks.push({id:other.id,...contact,unavoidable:false});
      }
      return risks.sort((a,b)=>a.distance-b.distance||a.time-b.time||a.id-b.id);
    };
    const risks=evaluate(nominal);
    if(!risks.length)return undefined;
    // Test immediate maximum left/right steering as well as the current and
    // intended course. This flags conflicts that none of these feasible choices
    // avoids; we never assume another driver will make an evasive turn for us.
    for(const risk of risks){
      const other=others.find(o=>o.id===risk.id)!;
      risk.unavoidable=!!firstContact(nominal,vehicle.kind,this.path(other,'current'),other.kind)
        &&!!firstContact(nominal,vehicle.kind,this.path(other,'route'),other.kind)
        &&!!firstContact(nominal,vehicle.kind,this.path(other,'left'),other.kind)
        &&!!firstContact(nominal,vehicle.kind,this.path(other,'right'),other.kind);
    }
    const stopDistance=Math.max(0,Math.min(...risks.map(r=>r.distance))-YIELD_BUFFER);
    const allRisks=new Map(risks.map(r=>[r.id,r]));
    // Choose the furthest safe sampled yielding position. Every candidate, including
    // standing still, must be checked against ALL observed moving bodies.
    for(const distance of [...new Set([stopDistance,stopDistance/2,0])]){
      const candidate=forecast(vehicle,'route',Math.max(0,target),distance,limit,steering);
      const conflicts=evaluate(candidate,YIELD_BUFFER/2);
      for(const risk of conflicts)if(!allRisks.has(risk.id))allRisks.set(risk.id,risk);
      const stoppedWithinBuffer=candidate.at(-1)!.distance<=distance+.01;
      if(!conflicts.length&&stoppedWithinBuffer){
        const point=candidate.at(-1)!;
        return {risks:[...allRisks.values()].sort((a,b)=>a.id-b.id),distance,
          limit:Math.max(vehicle.s,point.s),target:Math.min(target,Math.sqrt(2*Math.min(1.8,spec.brake)*Math.max(0,distance-.15))),emergency:false};
      }
    }
    // Stopping can expose us to a following/crossing body. A rolling yield is
    // allowed only if its entire forecast remains clear of every observed car.
    // Starting from rest may still have a safe low-speed corridor. A zero
    // measured speed must not make every rolling-yield candidate zero forever.
    const cruise=Math.min(Math.max(.6,vehicle.velocity??vehicle.speed),target);
    for(const fraction of [.875,.75,.625,.5,.375,.25,.125]){
      const cap=cruise*fraction;
      if(cap<.15)continue;
      const conflicts=evaluate(forecast(vehicle,'route',cap,Infinity,limit,steering),YIELD_BUFFER/2);
      for(const risk of conflicts)if(!allRisks.has(risk.id))allRisks.set(risk.id,risk);
      if(!conflicts.length)return {risks:[...allRisks.values()].sort((a,b)=>a.id-b.id),
        distance:Infinity,limit,target:cap,emergency:false};
    }
    // A late observation can make the buffer physically unattainable. Request
    // emergency braking; the final swept collision check remains authoritative.
    return {risks:[...allRisks.values()].sort((a,b)=>a.id-b.id),distance:stopDistance,
      limit:Math.max(vehicle.s,vehicle.s+stopDistance),target:0,emergency:true};
  }
}
