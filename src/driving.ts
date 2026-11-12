import { YIELD_BUFFER, YieldPrediction } from './vehicle-yield-prediction';
import { vehicleMotionState } from './vehicle-motion';
import { advanceVehicle, driveArc } from './kinematics';
import { sweptOverlaps, movingBodiesOverlap, separatesContact } from './collision';
import { SPECS, overlaps, dist, project, signalState, planRoute, type Simulation, type Vehicle, type Pose, type Movement, type DrivingState, type Road, type Point } from './simulation';

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const angle=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
const active=(v:Vehicle)=>!v.arrived&&!v.inGarage;
const vehiclesById=(sim:Simulation,id:number)=>sim.vehicles.find(v=>v.id===id);
export const STATE_LABELS:Record<DrivingState,string>={driving:'Đang chạy',following:'Bám xe', 'red-light':'Chờ đèn',yielding:'Nhường đường','exit-blocked':'Chờ phía ra thông thoáng',stopping:'Dừng bắt buộc',blocked:'Bị chặn',reversing:'Đang lùi',garage:'Chờ trong nhà',merging:'Nhập dòng'};

type Conflict={a:number;b:number;until:number};
type ReversePlan={other:number;target:number;until:number;start:number;travelled?:number;steering?:number;blockedFor?:number;group?:number[]};
type Intent={target:number;limit:number;state:DrivingState;reason:string;other?:number;leader?:number;movement?:Movement;legal:boolean;line?:Pose;travelLimit?:number;yieldingTo?:number[];avoidanceSteering?:number;avoidanceOffset?:number};

/** Decision state is separate from physical motion. Legal stops never trigger recovery. */
export class DrivingSystem {
  private conflicts=new Map<string,Conflict|null>();
  private conflictExpiry=new Map<string,number>();
  private reverse=new Map<number,ReversePlan>();
  private reserved=new Map<number,{kind:Vehicle['kind'];poses:Pose[]}>();
  private reverseNeeds=new Map<number,{other:number;steering:number;until:number}>();
  private reverseCooldown=new Map<number,number>();
  private forward=new Map<number,{steering:number;until:number;start:number}>();
  private release=new Map<number,{other:number;until:number}>();
  private lastMerge=new Map<string,number>();
  private grants=new Map<number,number>();
  private tick=0;
  private avoidance=new Map<number,{steering?:number;targetOffset?:number;until?:number;retryAt:number}>();
  private surfaces=new Map<string,{a:Point;b:Point;road:Road}[]>();
  private surfaceReady=false;
  private stoppedPaths=new Map<number,{key:string;steps:{pose:Pose;s:number}[]}>();
  private trafficDelay=new Map<number,number>();
  private trafficAt=-Infinity;
  private trafficVersion=-1;

  snapshot(){
    const {surfaces, surfaceReady, stoppedPaths, ...state}=this;
    return structuredClone(state);
  }

  restore(state:ReturnType<DrivingSystem['snapshot']>){
    Object.assign(this,structuredClone(state));
    this.surfaces.clear();this.surfaceReady=false;this.stoppedPaths.clear();
  }

  roadDelay(sim:Simulation){
    if(sim.time-this.trafficAt<.5&&this.trafficVersion===sim.world.nextId)return this.trafficDelay;
    const delay=new Map<number,number>();
    for(const v of sim.vehicles){
      if(!active(v))continue;
      const road=sim.world.nearest(v.pose)?.road;if(!road)continue;
      const spec=SPECS[v.kind],speed=Math.max(0,v.velocity??v.speed);
      // Seconds lost to occupied queue space and slow discharge; not metres.
      const lost=speed<1?spec.headway+(spec.length+1)/2+.5+Math.min(4,v.waiting*.1)
        :Math.max(0,(spec.length+1)/speed-(spec.length+1)/spec.speed);
      delay.set(road.id,(delay.get(road.id)??0)+lost);
    }
    if(this.trafficVersion===sim.world.nextId)for(const id of new Set([...delay.keys(),...this.trafficDelay.keys()])){
      const value=(this.trafficDelay.get(id)??0)*.6+(delay.get(id)??0)*.4;
      if(value>.05)delay.set(id,value);else delay.delete(id);
    }
    this.trafficDelay=delay;this.trafficAt=sim.time;this.trafficVersion=sim.world.nextId;
    return delay;
  }

  private frontLook(v:Vehicle){
    return Math.max(6,v.speed*.7+v.speed*v.speed/(2*SPECS[v.kind].brake));
  }

  /** Only a nearby body in front may claim a yield. A distant route crossing
   * or a car already behind us does not block the clear road ahead. */
  private nearFront(v:Vehicle,other:Vehicle,look=this.frontLook(v)){
    if(Math.abs(v.pose.y-other.pose.y)>2.5)return false;
    const dx=other.pose.x-v.pose.x,dz=other.pose.z-v.pose.z,spec=SPECS[v.kind],body=SPECS[other.kind];
    const along=dx*Math.sin(v.pose.angle)+dz*Math.cos(v.pose.angle);
    const across=Math.abs(dx*Math.cos(v.pose.angle)-dz*Math.sin(v.pose.angle));
    const relative=other.pose.angle-v.pose.angle;
    const frontExtent=Math.abs(Math.cos(relative))*body.length/2+Math.abs(Math.sin(relative))*body.width/2;
    const sideExtent=Math.abs(Math.sin(relative))*body.length/2+Math.abs(Math.cos(relative))*body.width/2;
    return along+frontExtent>=spec.length/2-.2
      &&across<=Math.max(2.5,along*1.5)+spec.width/2+sideExtent
      &&Math.hypot(dx,dz)<=(spec.length+body.length)/2+look+.5;
  }

  private frontObstruction(v:Vehicle,other:Vehicle,look=this.frontLook(v)){
    if(!this.nearFront(v,other,look))return undefined;
    for(let d=0;d<=look;d+=.4){
      if(overlaps(v.route.at(v.s+d,v.offset),v.kind,other.pose,other.kind,.2))return d;
    }
    return undefined;
  }

  /** A body already across our path keeps its space even when it is waiting
   * at a signal. Follow the bend and sweep the whole body, not just its centre. */
  private occupiedPath(v:Vehicle,other:Vehicle){
    if(Math.cos(other.pose.angle-v.pose.angle)>.8||Math.cos(other.pose.angle-v.pose.angle)<-.8)return undefined;
    if(overlaps(v.pose,v.kind,other.pose,other.kind,.2))return undefined;
    const look=this.frontLook(v);
    let from=v.pose;
    for(let d=.4;d<=look+.4;d+=.4){
      const distance=Math.min(d,look),to=v.route.at(Math.min(v.route.total,v.s+distance),v.targetOffset);
      if(sweptOverlaps(from,to,v.kind,other.pose,other.kind,.35))return Math.max(0,distance-.4);
      from=to;
    }
    return undefined;
  }

  /** A stopped body owns its space regardless of junction priority. Follow
   * the actual steering transition, sweeping the whole body along the corridor. */
  private stoppedPathObstruction(v:Vehicle,other:Vehicle){
    if(Math.abs(other.velocity??other.speed)>=.15||overlaps(v.pose,v.kind,other.pose,other.kind,0))return undefined;
    const look=this.frontLook(v),speed=Math.max(1,v.speed);
    const own=SPECS[v.kind],body=SPECS[other.kind];
    const reach=look+Math.hypot(own.length,own.width)/2+Math.hypot(body.length,body.width)/2+.1;
    if(dist(v.pose,other.pose)>reach)return undefined;
    const steering=this.forward.get(v.id)?.steering;
    const key=[v.s,v.pose.x,v.pose.y,v.pose.z,v.pose.angle,v.speed,v.steering,v.targetOffset,steering].join(',');
    let path=this.stoppedPaths.get(v.id);
    if(path?.key!==key){
      const steps:{pose:Pose;s:number}[]=[];
      let probe={...v};
      for(let d=0;d<look;d+=.25){
        const travel=Math.min(.25,look-d),next=this.motion(probe,travel,v.targetOffset,travel/speed,steering);
        steps.push(next);probe={...probe,...next};
      }
      path={key,steps};this.stoppedPaths.set(v.id,path);
    }
    let previous={pose:v.pose,s:v.s};
    for(const next of path.steps){
      if(sweptOverlaps(previous.pose,next.pose,v.kind,other.pose,other.kind,.06))return Math.max(v.s,previous.s);
      previous=next;
    }
    return undefined;
  }

  private seesFront(v:Vehicle,other:Vehicle,sim:Simulation){
    return sim.observations.get(v.id)?.front.some(target=>target.id===other.id)??false;
  }

  /** Predict simultaneous body occupancy, including acceleration when restarting.
   * Stop half a metre before the first unsafe body position, not its centre. */
  private crossingRisk(v:Vehicle,other:Vehicle){
    const speed=Math.max(0,other.velocity??other.speed);
    if(speed<.3)return undefined;
    const spec=SPECS[v.kind],step=.1,horizon=5;
    let previous=v.pose,previousOther=other.pose,previousDistance=0;
    for(let t=step;t<=horizon;t+=step){
      const distance=Math.min(v.route.total-v.s,v.speed*t+.5*spec.accel*t*t);
      const own=v.route.at(v.s+distance,v.targetOffset);
      const theirs=other.route.at(Math.min(other.route.total,other.s+speed*t),other.targetOffset);
      // Relative translation sweeps both moving bodies during this interval.
      const relative={...own,x:own.x-(theirs.x-previousOther.x),
        y:own.y-(theirs.y-previousOther.y),z:own.z-(theirs.z-previousOther.z)};
      if(sweptOverlaps(previous,relative,v.kind,previousOther,other.kind,.1)
        ||overlaps(own,v.kind,theirs,other.kind,.1))return Math.max(v.s,v.s+previousDistance-.5);
      previous=own;previousOther=theirs;previousDistance=distance;
    }
    return undefined;
  }

  private approachingFront(v:Vehicle,other:Vehicle,c:Conflict,intent:Intent,otherIntent:Intent){
    if(!this.nearFront(v,other)||c.a-v.s>this.frontLook(v)+SPECS[v.kind].length/2)return false;
    const occupied=this.frontObstruction(v,other)!==undefined;
    const speed=Math.max(0,other.velocity??other.speed);
    if(speed<.3){
      // A stopped car elsewhere in the junction does not drive an imaginary
      // 2 m/s trajectory. Ready, nearby approaches may still take turns at a stop.
      const sameJunction=intent.movement&&intent.movement.id===otherIntent.movement?.id;
      return occupied||!!sameJunction&&otherIntent.state==='driving'&&otherIntent.target>.3&&c.b-other.s<=6;
    }
    const distance=Math.max(0,c.a-v.s),accel=SPECS[v.kind].accel;
    const ownTime=(Math.sqrt(v.speed*v.speed+2*accel*distance)-v.speed)/accel;
    const otherTime=Math.max(0,c.b-other.s)/speed;
    return occupied||otherTime<=2&&Math.abs(ownTime-otherTime)<=1.25;
  }

  private conflict(a:Vehicle,b:Vehicle,time:number):Conflict|null {
    if(a.id>b.id){const c=this.conflict(b,a,time);return c?{a:c.b,b:c.a,until:c.until}:null;}
    const id=`${a.id}:${b.id}`;
    if((this.conflictExpiry.get(id)??0)>time)return this.conflicts.get(id)??null;
    let found:Conflict|null=null,best=Infinity;
    // A stopped participant still has an intended trajectory. Only spatially
    // overlapping bodies along both routes form a conflict, not the entire node.
    const horizon=30;
    for(let s=a.s;s<=Math.min(a.route.total,a.s+horizon);s+=1.2){
      const p=a.route.at(s,a.offset),q=b.route.locate(p,b.s+10,20);
      if(q.s<b.s-SPECS[b.kind].length/2||q.s>b.s+horizon||q.distance>5)continue;
      if(overlaps(p,a.kind,b.route.at(q.s,b.offset),b.kind,.35)){
        const ta=(s-a.s)/Math.max(2,a.speed),tb=(q.s-b.s)/Math.max(2,b.speed),score=Math.abs(ta-tb)*2+Math.max(ta,tb);
        if(score<best){best=score;found={a:s,b:q.s,until:time+.4};}
      }
    }
    this.conflicts.set(id,found);this.conflictExpiry.set(id,time+.4);return found;
  }

  private hasPriority(a:Vehicle,b:Vehicle,ia:Intent,ib:Intent,c:Conflict,sim:Simulation){
    const ma=a.route.movements.find(m=>c.a>=m.entry-3&&c.a<=m.exit+3)??ia.movement,mb=b.route.movements.find(m=>c.b>=m.entry-3&&c.b<=m.exit+3)??ib.movement;
    // A follower cannot simultaneously demand that its own leader yield to it.
    // Let the lead body finish its turn/merge while the follower keeps headway.
    if(Math.cos(a.pose.angle-b.pose.angle)>.7){
      const followsA=(ib.state==='following'&&ib.other===a.id)||(b.state==='following'&&b.blockerId===a.id);
      const followsB=(ia.state==='following'&&ia.other===b.id)||(a.state==='following'&&a.blockerId===b.id);
      if(followsA!==followsB)return followsA;
    }
    const reversingA=this.reverse.has(a.id),reversingB=this.reverse.has(b.id);
    if(reversingA!==reversingB)return !reversingA;
    const grantedA=(this.grants.get(a.id)??0)>sim.time,grantedB=(this.grants.get(b.id)??0)>sim.time;
    if(grantedA!==grantedB)return grantedA;
    // Once committed, clear the junction instead of stopping across another lane.
    const sameJunction=ma&&mb&&ma.id===mb.id;
    const insideA=sameJunction?a.s>=ma.entry+.3&&a.s<ma.exit:c.a-a.s<SPECS[a.kind].length/2+.6;
    const insideB=sameJunction?b.s>=mb.entry+.3&&b.s<mb.exit:c.b-b.s<SPECS[b.kind].length/2+.6;
    if(insideA!==insideB)return insideA;
    const mergingA=a.route.fromHouse!==undefined&&a.s<a.route.departureLength&&c.a<=a.route.departureLength+SPECS[a.kind].length/2;
    const mergingB=b.route.fromHouse!==undefined&&b.s<b.route.departureLength&&c.b<=b.route.departureLength+SPECS[b.kind].length/2;
    if(mergingA!==mergingB)return !mergingA;
    if(ma?.id===mb?.id&&ma&&mb){
      if(ma.circulating!==mb.circulating)return ma.circulating;
      const pa=ma.priority-(ma.control==='yield'||ma.control==='stop'?100:0);
      const pb=mb.priority-(mb.control==='yield'||mb.control==='stop'?100:0);
      if(ma.mode!=='all-way-stop'&&mb.mode!=='all-way-stop'&&pa!==pb)return pa>pb;
      if(ma.mode==='zipper'||mb.mode==='zipper'){
        const last=this.lastMerge.get(ma.id);
        if(last!==undefined&&Math.abs((a.approachSince??sim.time)-(b.approachSince??sim.time))<2){
          const roadA=ma.incomingRoad??Math.round(ma.incoming*100),roadB=mb.incomingRoad??Math.round(mb.incoming*100);
          if((roadA===last)!==(roadB===last))return roadA!==last;
        }
      }
      if(ma.mode==='all-way-stop'||mb.mode==='all-way-stop'){
        const arrivedA=a.stopSince??Infinity,arrivedB=b.stopSince??Infinity;
        if(Math.abs(arrivedA-arrivedB)>.15)return arrivedA<arrivedB;
      }
      // Oncoming traffic has priority over an unprotected crossing turn.
      const crossingTurn=(m:Movement)=>m.turn===(sim.world.drivingSide==='right'?1:-1);
      if(Math.cos(ma.incoming-mb.incoming)<-.5&&crossingTurn(ma)!==crossingTurn(mb))return !crossingTurn(ma);
    }else if(!a.route.movements.length&&!b.route.movements.length){
      // Synthetic routes used by callers have no topology: use their actual
      // manoeuvre and arrival, never a bend elsewhere on a real road.
      const ta=a.route.upcomingTurn(a.s,12),tb=b.route.upcomingTurn(b.s,12);
      if(!!ta!==!!tb)return !ta;
    }
    const arrivalA=a.approachSince??sim.time,arrivalB=b.approachSince??sim.time;
    if(Math.abs(arrivalA-arrivalB)>.15)return arrivalA<arrivalB;
    // Simultaneous arrivals: yield to the appropriate side; use geometry as
    // a stable final tie-break. IDs only distinguish coincident spawn poses.
    const heading=ma?.incoming??a.pose.angle;
    const side=(b.pose.x-a.pose.x)*Math.cos(heading)-(b.pose.z-a.pose.z)*Math.sin(heading);
    const reciprocal=(a.pose.x-b.pose.x)*Math.cos(mb?.incoming??b.pose.angle)-(a.pose.z-b.pose.z)*Math.sin(mb?.incoming??b.pose.angle);
    if(side*reciprocal<0&&Math.abs(side)>.1)return sim.world.drivingSide==='right'?side>0:side<0;
    const bearingA=angle(ma?.incoming??a.pose.angle),bearingB=angle(mb?.incoming??b.pose.angle);
    return Math.abs(bearingA-bearingB)>.001?bearingA<bearingB:a.id<b.id;
  }

  private signalLimit(v:Vehicle,sim:Simulation,intent:Intent){
    for(const signal of v.route.signals){
      const line=v.route.at(signal.s),gap=-this.frontAtLine(v.pose,v,line);
      if(gap<-.08||signal.s-v.s>35||signal.s-v.s<-SPECS[v.kind].length)continue;
      const m=v.route.movements.find(m=>m.light===signal.light);
      const turn=m?.turn===0||!m?'straight':m.turn>0?'left':'right';
      const color=signalState(sim.time,signal.light,signal.vertical,turn);
      // Yellow permits an already committed vehicle to clear if comfortable
      // stopping is impossible. Red is always a hard stop before the line.
      const stopping=v.speed*v.speed/(2*SPECS[v.kind].brake)+v.speed*.35;
      if(color==='red'||color==='yellow'&&gap>=stopping){
        const previous=intent.limit;
        this.stop(intent,v,v.s+Math.max(0,gap),'red-light',color==='yellow'?'Dừng trước đèn vàng':'Đèn đỏ');
        if(intent.limit<previous)intent.line=line;
      }
    }
  }

  private frontAtLine(pose:Pose,v:Vehicle,line:Pose){
    const relative=pose.angle-line.angle,spec=SPECS[v.kind];
    const extent=Math.abs(Math.cos(relative))*spec.length/2+Math.abs(Math.sin(relative))*spec.width/2;
    return (pose.x-line.x)*Math.sin(line.angle)+(pose.z-line.z)*Math.cos(line.angle)+extent;
  }

  private stop(intent:Intent,v:Vehicle,s:number,state:DrivingState,reason:string,other?:number){
    if(other!==undefined){intent.yieldingTo??=[];if(!intent.yieldingTo.includes(other))intent.yieldingTo.push(other);}
    if(s<intent.limit){intent.limit=Math.max(v.s,s);intent.state=state;intent.reason=reason;intent.other=other;intent.legal=state!=='blocked';}
    intent.target=Math.min(intent.target,Math.sqrt(2*Math.min(1.8,SPECS[v.kind].brake)*Math.max(0,s-v.s-.15)));
  }

  private laneTargets(v:Vehicle){
    const width=v.route.at(v.s).width,bound=Math.max(0,(width-SPECS[v.kind].width)/2-.28);
    const m=v.route.movement(v.s,16),driveway=v.s<v.route.departureLength+3||v.s>v.route.total-v.route.arrivalLength-3,turn=driveway?0:(m?.turn??v.route.upcomingTurn(v.s)?.direction??0);
    if(driveway)return {bound,preferred:0,candidates:[0,v.offset]};
    const lanes=Math.max(1,Math.floor(width/3));
    if(v.kind==='bike')return {bound,preferred:turn*bound*.65,candidates:[v.offset,0,-bound,bound,-bound*.5,bound*.5,turn*bound*.65]};
    const centers=Array.from({length:lanes},(_,i)=>(i-(lanes-1)/2)*width/lanes);
    const nearest=centers.reduce((a,b)=>Math.abs(a-v.offset)<Math.abs(b-v.offset)?a:b);
    const preferred=turn?clamp(nearest+turn*Math.min(.65,width/lanes*.18),-bound,bound):nearest;
    return {bound,preferred,candidates:[v.offset,preferred,...centers,-bound,bound].map(n=>clamp(n,-bound,bound))};
  }

  private chooseLane(v:Vehicle,near:Vehicle[],intent:Intent,sim:Simulation){
    const {bound,preferred,candidates}=this.laneTargets(v);
    const current=v.offset;let best=current,bestScore=-Infinity;
    for(const offset of candidates){
      let free=0;
      const lateral=Math.abs(offset-current);
      const changeLength=Math.max(3,lateral*1.2);
      // Check a whole lane-change corridor and the follower's braking demand.
      if(lateral>.15&&near.some(o=>{
        if(o===v||!active(o))return false;
        const p=v.route.at(v.s,offset),dx=o.pose.x-p.x,dz=o.pose.z-p.z;
        const along=dx*Math.sin(p.angle)+dz*Math.cos(p.angle),across=Math.abs(dx*Math.cos(p.angle)-dz*Math.sin(p.angle));
        return Math.cos(o.pose.angle-p.angle)>.75&&along<0&&along>-(SPECS[o.kind].length/2+SPECS[v.kind].length/2+Math.max(2,o.speed*1.2))&&across<(SPECS[o.kind].width+SPECS[v.kind].width)/2+.3;
      }))continue;
      for(let d=.5;d<=18;d+=.8){
        const t=clamp(d/changeLength,0,1),blend=t*t*(3-2*t),p=v.route.at(v.s+d,current+(offset-current)*blend);
        if(near.some(o=>o!==v&&active(o)&&overlaps(p,v.kind,o.pose,o.kind,.2)))break;free=d;
      }
      const score=free-lateral*.1-Math.abs(offset-preferred)*.7+(Math.abs(offset-v.targetOffset)<.1?(Math.abs(v.targetOffset)>.7?.8:.12):0);
      if(score>bestScore){bestScore=score;best=offset;}
    }
    // A red queue cannot become an invitation to overtake within the same lane.
    if(intent.state==='red-light'||intent.state==='stopping'||intent.state==='exit-blocked'||intent.state==='yielding')best=current;
    v.targetOffset=clamp(best,-bound,bound);
    v.lane=Math.round((v.targetOffset+v.route.at(v.s).width/2)/3);
    v.decision=.4+sim.random()*.2;
  }

  private departure(v:Vehicle,sim:Simulation){
    if(v.route.fromHouse===undefined||v.s>v.route.departureLength+SPECS[v.kind].length)return;
    const spec=SPECS[v.kind],door=v.route.departureDoor??v.route.at(0),relative=v.pose.angle-door.angle;
    const extent=Math.abs(Math.cos(relative))*spec.length/2+Math.abs(Math.sin(relative))*spec.width/2;
    const outward=(v.pose.x-door.x)*Math.sin(door.angle)+(v.pose.z-door.z)*Math.cos(door.angle);
    if(outward>extent+.05){v.leftHouse=true;return;}
    // Recovery can bring a previously departed body back across the doorway.
    // Use its current footprint rather than a permanent historical flag.
    v.leftHouse=false;
    const arriving=sim.vehicles.find(o=>o!==v&&active(o)&&this.nearFront(v,o,8)&&o.route.toHouse===v.route.fromHouse&&o.route.total-o.s<o.route.arrivalLength+spec.length
      &&Array.from({length:9},(_,i)=>v.route.at(v.route.departureLength*i/8)).some(p=>Array.from({length:9},(_,i)=>o.route.at(o.s+(o.route.total-o.s)*i/8)).some(q=>overlaps(p,v.kind,q,o.kind,.4))));
    if(arriving){
      v.garageYield=arriving.id;this.reverse.delete(v.id);this.reserved.delete(v.id);this.forward.delete(v.id);
    }
  }

  /** Rear-axle bicycle integration: all displacement follows the body's heading.
   * Steering can change while stopped; position and yaw cannot. */
  private motion(v:Vehicle,distance:number,targetOffset:number,dt:number,steerOverride?:number){
    return advanceVehicle(v,distance,targetOffset,dt,steerOverride);
  }

  private surfaceAt(p:Point,sim:Simulation){
    if(!this.surfaceReady){
      const driveways:Road[]=sim.world.houses.flatMap(h=>{
        const nearest=sim.world.nearest({x:h.x,y:0,z:h.z});if(!nearest)return [];
        return [{id:-h.id,oneWay:true,width:6.4,points:[{x:h.x+Math.sin(h.angle)*4.2,y:0,z:h.z+Math.cos(h.angle)*4.2},nearest.point]}];
      });
      for(const road of [...sim.world.roads,...driveways])for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],width=road.width*(road.oneWay?.5:1);
        for(let x=Math.floor((Math.min(a.x,b.x)-width)/10);x<=Math.floor((Math.max(a.x,b.x)+width)/10);x++)for(let z=Math.floor((Math.min(a.z,b.z)-width)/10);z<=Math.floor((Math.max(a.z,b.z)+width)/10);z++){
          const key=`${x},${z}`,list=this.surfaces.get(key)??[];list.push({a,b,road});this.surfaces.set(key,list);
        }
      }this.surfaceReady=true;
    }
    let best:{point:Point;distance:number;road:Road}|undefined;
    for(const segment of this.surfaces.get(`${Math.floor(p.x/10)},${Math.floor(p.z/10)}`)??[]){
      const q=project(p,segment.a,segment.b);if(Math.abs(q.point.y-p.y)>1)continue;
      const clearance=segment.road.width*(segment.road.oneWay?.5:1)-q.distance;
      const previous=best?best.road.width*(best.road.oneWay?.5:1)-best.distance:-Infinity;
      if(clearance>previous)best={point:q.point,distance:q.distance,road:segment.road};
    }
    return best;
  }

  private safeMotion(v:Vehicle,next:{pose:Pose;s:number;offset:number;steering:number},near:Vehicle[],sim:Simulation,line?:Pose,manoeuvring=false){
    if(line&&this.frontAtLine(next.pose,v,line)>.001)return false;
    for(const [owner,reservation] of this.reserved){
      if(owner===v.id||!this.reverse.has(owner))continue;
      for(const p of reservation.poses){
        if(dist(v.pose,p)>SPECS[v.kind].length/2+SPECS[reservation.kind].length/2+2)continue;
        if(!overlaps(v.pose,v.kind,p,reservation.kind,.06)&&sweptOverlaps(v.pose,next.pose,v.kind,p,reservation.kind,.06))return false;
      }
    }
    // A rotating corner can touch within the first millimetres and be clear
    // again at 10 cm. The planner and commit use the same continuous sweep.
    if(near.some(o=>o.id!==v.id&&active(o)&&sweptOverlaps(v.pose,next.pose,v.kind,o.pose,o.kind,.06)
      &&!(manoeuvring&&Math.abs(v.speed)<=1&&separatesContact(v.pose,next.pose,v.kind,o.pose,o.kind))))return false;
    const driveway=next.s<v.route.departureLength+3||next.s>v.route.total-v.route.arrivalLength-3;
    const bound=Math.max(0,((driveway?Math.max(8,v.route.at(next.s).width):v.route.at(next.s).width)-SPECS[v.kind].width)/2-.12);
    if(Math.abs(next.offset)>bound+.12){
      // The physical surface is the union of connected carriageways and the
      // driveway. A smoothed route's conservative width is not a curb.
      const road=this.surfaceAt(next.pose,sim);
      if(!road)return false;
      const clearance=road.road.width*(road.road.oneWay?.5:1)-road.distance;
      if(clearance<SPECS[v.kind].width/2+.08){
        const previous=this.surfaceAt(v.pose,sim);
        const oldClearance=previous?previous.road.width*(previous.road.oneWay?.5:1)-previous.distance:-Infinity;
        if(clearance<oldClearance-1e-8){
          const travel=(next.pose.x-v.pose.x)*Math.sin(v.pose.angle)+(next.pose.z-v.pose.z)*Math.cos(v.pose.angle);
          if(Math.abs(travel)>1e-10){
            // A nearly tangent wheel arc can move a few micrometres outward
            // before turning inward. Require a clear inward continuation,
            // rather than rejecting every tiny acceleration step forever.
            const ahead=driveArc(next.pose,Math.sign(travel)*.5,next.steering,SPECS[v.kind].wheelbase);
            const surface=this.surfaceAt(ahead,sim);
            const future=surface?surface.road.width*(surface.road.oneWay?.5:1)-surface.distance:-Infinity;
            if(clearance<oldClearance-.001||future<oldClearance+.005)return false;
          }
        }
      }
      const base=v.route.at(next.s),center=road.point;
      const sameSide=(base.x-center.x)*(next.pose.x-center.x)+(base.z-center.z)*(next.pose.z-center.z)>=-.05;
      const manoeuvre=v.route.movement(next.s,0);
      const driveway=next.s<v.route.departureLength+3||next.s>v.route.total-v.route.arrivalLength-3;
      if(!sameSide&&!driveway&&!manoeuvre&&!manoeuvring&&road.road.id>=0&&Math.abs(next.offset)>=Math.abs(v.offset)-.000001)return false;
    }
    return true;
  }

  private forecast(v:Vehicle,time:number):Pose {
    return driveArc(v.pose,(v.velocity??v.speed)*time,v.steering??0,SPECS[v.kind].wheelbase);
  }

  private reserveRetreats(vehicles:Vehicle[]){
    this.reserved.clear();
    const byId=new Map(vehicles.map(v=>[v.id,v]));
    for(const [id,plan] of this.reverse){
      const owner=byId.get(id);if(!owner)continue;
      const remaining=Math.max(0,Math.min(4,plan.start-plan.target)-(plan.travelled??0));
      const poses:Pose[]=[owner.pose];
      for(let d=.2;d<remaining;d+=.2)poses.push(driveArc(owner.pose,-d,plan.steering??owner.steering??0,SPECS[owner.kind].wheelbase));
      if(remaining>0)poses.push(driveArc(owner.pose,-remaining,plan.steering??owner.steering??0,SPECS[owner.kind].wheelbase));
      this.reserved.set(id,{kind:owner.kind,poses});
    }
  }

  private rearRoom(v:Vehicle,near:Vehicle[],max=4,steering=v.steering??0){
    // The reverse is pre-steered while stationary. Sweep the same curve the
    // integrator will actually drive; checking only its endpoint can miss a
    // corner contact in the first centimetres and select an unusable retreat.
    let room=0,probe={...v,steering};
    const limit=Math.max(0,Math.min(max,v.s));
    while(room<limit-.00001){
      const step=Math.min(.05,limit-room),time=(room+step)/.9;
      const next=this.motion(probe,-step,0,step/.9,steering);
      if(near.some(o=>o.id!==v.id&&active(o)&&[0,Math.min(1,time),Math.min(2,time)].some(t=>{
        const pose=this.forecast(o,t);
        return sweptOverlaps(probe.pose,next.pose,v.kind,pose,o.kind,.06)
          &&!(Math.abs(o.velocity??o.speed)<.15&&separatesContact(probe.pose,next.pose,v.kind,pose,o.kind));
      })))break;
      room+=step;probe={...probe,...next};
    }
    return room;
  }

  private forwardChoices(v:Vehicle,near:Vehicle[],sim:Simulation){
    const spec=SPECS[v.kind],others=near.filter(o=>o.id!==v.id);
    return [v.steering??0,0,-spec.maxSteer/2,spec.maxSteer/2,-spec.maxSteer,spec.maxSteer].map(steering=>{
      let probe={...v,steering},free=0;
      while(free<1.5-.001){
        const next=this.motion(probe,.1,v.targetOffset,.1,steering);
        if(!this.safeMotion(probe,next,others,sim,undefined,true))break;
        free+=.1;probe={...probe,...next};
      }
      const progress=probe.s-v.s,alignment=Math.abs(angle(probe.pose.angle-v.route.at(probe.s).angle));
      const end=driveArc(probe.pose,YIELD_BUFFER,steering,SPECS[v.kind].wheelbase);
      const keepsBuffer=!(v.yieldingTo?.length&&others.some(o=>active(o)&&Math.abs(o.velocity??o.speed)<.15&&sweptOverlaps(probe.pose,end,v.kind,o.pose,o.kind,.06)));
      return {v,steering,free,progress,keepsBuffer,score:progress-alignment*.5-Math.abs(probe.offset)*.2};
    }).filter(c=>c.keepsBuffer&&c.free>=.8&&c.progress>.25).sort((a,b)=>b.score-a.score);
  }

  private reverseChoices(v:Vehicle,near:Vehicle[],sim:Simulation,max:number){
    const spec=SPECS[v.kind],steers=[v.steering??0,0,-spec.maxSteer/2,spec.maxSteer/2,-spec.maxSteer,spec.maxSteer];
    return steers.map(steering=>{
      const reserved=this.rearRoom(v,near,max,steering);let room=0,probe={...v,steering};
      const others=near.filter(o=>o.id!==v.id);
      while(room<reserved-.001){
        const step=Math.min(.1,reserved-room),next=this.motion(probe,-step,0,step/.9,steering);
        if(!this.safeMotion(probe,next,others,sim,undefined,true))break;
        room+=step;probe={...probe,...next};
      }
      // Prefer a retreat that leaves the body facing its lane. Maximizing rear
      // distance alone can choose a full-lock circle and trap a now solitary car.
      const onward=v.route.at(Math.min(v.route.total,v.s+Math.max(2,spec.wheelbase)));
      // Near the destination, face the doorway after retreating rather than
      // the road segment we have just backed onto. On a carriageway, preserve
      // its direction so a retreat cannot become a turn across opposing lanes.
      const heading=v.s>v.route.total-v.route.arrivalLength
        ?Math.atan2(onward.x-probe.pose.x,onward.z-probe.pose.z):v.route.at(probe.s).angle;
      const alignment=Math.abs(angle(probe.pose.angle-heading));
      // In a lock, the retreat must also leave usable space for the neighbour.
      // A short arc that improves our heading but still traps its bumper only
      // makes both vehicles repeat the same forward/backward manoeuvre.
      const freed=others.filter(o=>o.speed<.3&&[1.5,-1.5].some(distance=>{
        const end=driveArc(o.pose,distance,o.steering??0,SPECS[o.kind].wheelbase);
        return sweptOverlaps(o.pose,end,o.kind,v.pose,v.kind,.06)
          &&!sweptOverlaps(o.pose,end,o.kind,probe.pose,v.kind,.06);
      })).length;
      const score=Math.min(2,room)*.4-alignment*2-Math.abs(probe.offset)*.35+freed*3;
      return {v,steering,room,score};
    }).filter(c=>c.room>=.2).sort((a,b)=>b.score-a.score);
  }

  private bodyBlocks(a:Vehicle,b:Vehicle,distance=.6){
    const end=driveArc(a.pose,distance,a.steering??0,SPECS[a.kind].wheelbase);
    return sweptOverlaps(a.pose,end,a.kind,b.pose,b.kind,.06);
  }

  private recover(sim:Simulation,intents:Map<number,Intent>,neighbors:Map<number,Vehicle[]>){
    // A physically impossible forward arc at a curb is a multi-point turn,
    // distinct from a traffic queue. Reserve its entire rear corridor first.
    for(const v of sim.vehicles){
      const intent=intents.get(v.id),near=neighbors.get(v.id)??[];
      if((v.stuckTime??0)<3||!intent||intent.legal||this.reverse.has(v.id)||this.forward.has(v.id)||this.release.has(v.id)||(this.reverseCooldown.get(v.id)??0)>sim.time)continue;
      if(near.some(o=>o.id!==v.id&&this.reverse.has(o.id)&&dist(o.pose,v.pose)<12&&this.conflict(v,o,sim.time)))continue;
      const forward=this.forwardChoices(v,near,sim)[0];
      if(forward){this.forward.set(v.id,{steering:forward.steering,until:sim.time+4,start:v.s});this.grants.set(v.id,sim.time+8);continue;}
      const bodyBlocker=near.some(o=>o!==v&&active(o)&&(this.bodyBlocks(v,o,1)||v.yieldingTo?.includes(o.id)&&this.stoppedPathObstruction(v,o)!==undefined));
      if(!bodyBlocker||!this.safeMotion(v,this.motion(v,.1,v.targetOffset,1/30),[],sim)){
        const choice=this.reverseChoices(v,near,sim,4)[0];
        if(choice){
          const traffic=near.find(o=>o!==v&&active(o)&&dist(o.pose,v.pose)<10&&this.conflict(v,o,sim.time));
          this.reverse.set(v.id,{other:traffic?.id??v.id,target:v.s-choice.room,start:v.s,until:sim.time+6,steering:choice.steering});
          this.grants.delete(v.id);if(traffic)this.grants.set(traffic.id,sim.time+8);
        }else{
          // A body trapped against a curb may need its stopped rear follower
          // to retreat first. Record that real dependency even before a reverse
          // can start, so the wait-cycle solver sees both sides of the lock.
          const retreat=this.reverseChoices(v,[],sim,4)[0];
          if(retreat){
            const rear=driveArc(v.pose,-.5,retreat.steering,SPECS[v.kind].wheelbase);
            const blocker=near.find(o=>o!==v&&active(o)&&o.speed<.3&&sweptOverlaps(v.pose,rear,v.kind,o.pose,o.kind,.06));
            if(blocker)this.reverseNeeds.set(v.id,{other:blocker.id,steering:retreat.steering,until:sim.time+20});
          }
        }
      }
    }
    const eligible=sim.vehicles.filter(v=>active(v)&&v.waiting>3&&(['blocked','yielding','following','merging','exit-blocked'].includes(intents.get(v.id)?.state??'')||v.state==='blocked'&&!intents.get(v.id)?.legal));
    const edges=new Map<number,number[]>();
    for(const v of eligible){
      const near=neighbors.get(v.id)??[],intent=intents.get(v.id)!;
      const blockers=near.filter(o=>o!==v&&active(o)&&o.speed<.3&&this.bodyBlocks(v,o));
      const ids=blockers.map(o=>o.id);if(intent.other!==undefined&&!ids.includes(intent.other))ids.push(intent.other);
      // Forecast conflicts can be several seconds away. Only present physical
      // dependencies belong in a recovery cycle; a distant follower must not be
      // selected to reverse merely because it appears in another car's forecast.
      for(const id of intent.yieldingTo??v.yieldingTo??[]){
        const other=near.find(o=>o.id===id);
        if(other&&other.speed<.3&&this.bodyBlocks(v,other,1)&&!ids.includes(id))ids.push(id);
      }
      const need=this.reverseNeeds.get(v.id);
      if(need){
        const other=near.find(o=>o.id===need.other);
        if(!other||sim.time>need.until||!sweptOverlaps(v.pose,driveArc(v.pose,-.5,need.steering,SPECS[v.kind].wheelbase),v.kind,other.pose,other.kind,.06))this.reverseNeeds.delete(v.id);
        else if(!ids.includes(other.id))ids.push(other.id);
      }
      edges.set(v.id,ids);
    }
    // Strongly connected components include every participant in a physical
    // lock, including a vehicle blocking the rear of a requested retreat.
    const indices=new Map<number,number>(),low=new Map<number,number>(),stack:number[]=[],onStack=new Set<number>(),groups:number[][]=[];
    let index=0;
    const visit=(id:number)=>{
      indices.set(id,index);low.set(id,index++);stack.push(id);onStack.add(id);
      for(const other of edges.get(id)??[]){
        if(!edges.has(other))continue;
        if(!indices.has(other)){visit(other);low.set(id,Math.min(low.get(id)!,low.get(other)!));}
        else if(onStack.has(other))low.set(id,Math.min(low.get(id)!,indices.get(other)!));
      }
      if(low.get(id)===indices.get(id)){
        const component:number[]=[];let other:number;
        do{other=stack.pop()!;onStack.delete(other);component.push(other);}while(other!==id);
        if(component.length>1)groups.push(component);
      }
    };
    for(const id of edges.keys())if(!indices.has(id))visit(id);
    for(const cycle of groups){
      if(cycle.some(id=>this.reverse.has(id)||this.forward.has(id)||(this.grants.get(id)??0)>sim.time)
        ||[...this.reverse.values()].some(plan=>plan.group?.some(id=>cycle.includes(id))))continue;
      const bodiesLocked=cycle.some(id=>{
        const a=sim.vehicles.find(v=>v.id===id)!;
        return (neighbors.get(id)??[]).some(b=>b!==a&&cycle.includes(b.id)&&(this.bodyBlocks(a,b)||this.stoppedPathObstruction(a,b)!==undefined));
      });
      const capacityCycle=cycle.every(id=>['following','exit-blocked'].includes(intents.get(id)!.state));
      if(!bodiesLocked&&!capacityCycle){
        let winner=cycle.map(id=>sim.vehicles.find(v=>v.id===id)!).sort((a,b)=>(a.approachSince??sim.time)-(b.approachSince??sim.time)||angle(a.pose.angle)-angle(b.pose.angle))[0];
        // Grant the front of a following chain. Giving permission to a follower
        // while its leader still yields leaves the entire wait cycle unchanged.
        const seen=new Set<number>();
        while(!seen.has(winner.id)){
          seen.add(winner.id);const intent=intents.get(winner.id)!;
          const leader=intent.leader??(['following','exit-blocked'].includes(intent.state)?intent.other:undefined);
          if(leader===undefined||!cycle.includes(leader))break;
          winner=sim.vehicles.find(v=>v.id===leader)!;
        }
        this.grants.set(winner.id,sim.time+8);
        const advance=this.forwardChoices(winner,neighbors.get(winner.id)??[],sim)[0];
        if(advance){
          this.release.delete(winner.id);
          this.forward.set(winner.id,{steering:advance.steering,until:sim.time+4,start:winner.s});
        }
        continue;
      }
      const forward=cycle.filter(id=>!intents.get(id)!.leader&&!['following','exit-blocked'].includes(intents.get(id)!.state)).flatMap(id=>{
        const v=sim.vehicles.find(v=>v.id===id)!;return this.forwardChoices(v,neighbors.get(id)??[],sim);
      }).sort((a,b)=>b.score-a.score)[0];
      if(forward){
        this.release.delete(forward.v.id);
        this.grants.set(forward.v.id,sim.time+8);
        this.forward.set(forward.v.id,{steering:forward.steering,until:sim.time+4,start:forward.v.s});continue;
      }
      // Only one vehicle in a wait cycle may reverse. A queued follower is not
      // part of a cycle and can never be selected just for waiting a long time.
      let candidates=cycle.filter(id=>(this.reverseCooldown.get(id)??0)<=sim.time).flatMap(id=>{const v=sim.vehicles.find(v=>v.id===id)!;return this.reverseChoices(v,neighbors.get(v.id)??[],sim,4);});
      const parents=new Map<number,number>();
      if(!candidates.some(c=>c.room>=.75)){
        // A confirmed physical lock can require the rear of its queue to move
        // first. Ordinary queues never enter this branch without a wait cycle.
        const pending=cycle.map(id=>({id,depth:0})),seen=new Set(cycle);
        for(let i=0;i<pending.length;i++){
          const item=pending[i];if(item.depth>=6)continue;
          const front=vehiclesById(sim,item.id);if(!front)continue;
          const rear=driveArc(front.pose,-1,front.steering??0,SPECS[front.kind].wheelbase);
          for(const follower of neighbors.get(front.id)??[]){
            if(seen.has(follower.id)||!active(follower)||follower.speed>.15||follower.waiting<3)continue;
            const state=intents.get(follower.id)?.state;
            if(state==='red-light'||state==='stopping'||state==='garage'||this.reverse.has(follower.id))continue;
            const dx=follower.pose.x-front.pose.x,dz=follower.pose.z-front.pose.z;
            if(dx*Math.sin(front.pose.angle)+dz*Math.cos(front.pose.angle)>=0)continue;
            if(!sweptOverlaps(front.pose,rear,front.kind,follower.pose,follower.kind,.2))continue;
            seen.add(follower.id);parents.set(follower.id,front.id);pending.push({id:follower.id,depth:item.depth+1});
            this.reverseNeeds.set(front.id,{other:follower.id,steering:front.steering??0,until:sim.time+25});
            if((this.reverseCooldown.get(follower.id)??0)<=sim.time)candidates.push(...this.reverseChoices(follower,neighbors.get(follower.id)??[],sim,4));
          }
        }
        if(candidates.some(c=>c.room>=.75))candidates=candidates.filter(c=>c.room>=.75);
      }
      candidates.sort((a,b)=>b.score-a.score||(b.v.approachSince??0)-(a.v.approachSince??0));
      const chosen=candidates[0];if(!chosen)continue;
      const other=parents.get(chosen.v.id)??edges.get(chosen.v.id)?.find(id=>cycle.includes(id));if(other===undefined)continue;
      this.release.delete(chosen.v.id);
      this.reverse.set(chosen.v.id,{other,target:Math.max(0,chosen.v.s-Math.min(4,chosen.room)),start:chosen.v.s,until:sim.time+8,steering:chosen.steering,group:cycle});
      this.grants.delete(chosen.v.id);this.grants.set(other,sim.time+8);

    }
  }

  step(sim:Simulation,dt:number){
    this.tick++;this.stoppedPaths.clear();
    const vehicles=sim.vehicles.filter(active),grid=new Map<string,Vehicle[]>();
    const cell=(p:Pose)=>`${Math.floor(p.x/12)},${Math.floor(p.z/12)}`;
    const insert=(v:Vehicle)=>{const k=cell(v.pose);const bucket=grid.get(k)??[];bucket.push(v);grid.set(k,bucket);};vehicles.forEach(insert);
    // Garage occupants re-enter only once their named arrival and doorway clear.
    for(const v of sim.vehicles.filter(v=>v.inGarage)){
      const arrival=sim.vehicles.find(o=>o.id===v.garageYield&&active(o));
      if(arrival&&this.nearFront({...v,pose:v.route.at(0)},arrival,8))continue;
      if(sim.vehicles.some(o=>active(o)&&overlaps(v.route.at(0),v.kind,o.pose,o.kind,.4)))continue;
      v.inGarage=false;v.garageYield=undefined;v.pose=v.route.at(0);v.speed=0;v.velocity=0;v.steering=0;vehicles.push(v);insert(v);
    }
    sim.refreshObservations();
    this.reserveRetreats(vehicles);
    const neighbors=new Map<number,Vehicle[]>(),intents=new Map<number,Intent>(),constraints=new Map<number,Intent>();
    for(const v of vehicles){
      v.age+=dt;v.decision-=dt;
      const x=Math.floor(v.pose.x/12),z=Math.floor(v.pose.z/12),near:Vehicle[]=[];
      const radius=Math.max(3,Math.ceil((Math.max(sim.observationProfiles[v.kind].front.range,sim.observationProfiles[v.kind].rear.range)+6)/12));
      for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++)near.push(...grid.get(`${x+dx},${z+dz}`)??[]);
      neighbors.set(v.id,near);this.departure(v,sim);
      if(v.garageYield!==undefined){
        const arrival=vehicles.find(o=>o.id===v.garageYield);
        if(!arrival||v.leftHouse||!this.nearFront(v,arrival,8))v.garageYield=undefined;
      }
      const spec=SPECS[v.kind],movement=v.route.movement(v.s);
      if(movement){if(v.approachId!==movement.id){v.approachId=movement.id;v.approachSince=sim.time;v.stopTime=0;v.stopSince=undefined;}}
      else{v.approachId=undefined;if(v.route.movements.length)v.approachSince=undefined;else v.approachSince??=sim.time;}
      const intent:Intent={target:spec.speed*(v.driverFactor??1),limit:v.route.total,state:'driving',reason:'Đường thông thoáng',movement,legal:false};
      // Never choose a cruise speed whose stopping distance exceeds sensor range.
      const sight=sim.observationProfiles[v.kind].front;
      const visible=Math.max(0,(sight.angle>0&&sight.verticalAngle>0?sight.range:0)-spec.length/2-.5);
      const reaction=.35;
      intent.target=Math.min(intent.target,Math.sqrt((spec.brake*reaction)**2+2*spec.brake*visible)-spec.brake*reaction);
      // Preview curvature and decelerate before the bend, with distinct truck dynamics.
      const preview=v.speed*v.speed/(2*spec.brake)+8;
      for(let d=0;d<=preview;d+=2){const k=Math.abs(v.route.curvature(v.s+d)),curveSpeed=Math.sqrt(spec.lateralAccel/Math.max(.003,k));intent.target=Math.min(intent.target,Math.sqrt(curveSpeed**2+2*spec.brake*Math.max(0,d-2)));}
      intent.target=Math.min(intent.target,Math.sqrt(2*spec.brake*Math.max(0,v.route.total-v.s-.03)));
      this.signalLimit(v,sim,intent);
      if(movement&&(movement.control==='stop'||movement.mode==='all-way-stop')&&v.s<=movement.stop+1){
        if(v.speed<.1&&Math.abs(movement.stop-v.s-spec.length/2)<1){v.stopTime=(v.stopTime??0)+dt;v.stopSince??=sim.time;}
        if((v.stopTime??0)<1)this.stop(intent,v,movement.stop-spec.length/2,'stopping','Dừng đủ một giây trước giao lộ');
      }
      constraints.set(v.id,{...intent});
      const release=this.release.get(v.id);
      if(release){
        const other=vehicles.find(o=>o.id===release.other);
        if(!other||this.frontObstruction(v,other,6)===undefined)this.release.delete(v.id);
        else this.stop(intent,v,v.s,'yielding',`Chờ xe #${other.id} thoát điểm kẹt`,other.id);
      }
      intents.set(v.id,intent);
    }
    // All decisions read the same snapshot. Physical commits below are swept
    // against already committed bodies too, independent of iteration ordering.
    for(const v of vehicles){
      const near=neighbors.get(v.id)!,intent=intents.get(v.id)!,spec=SPECS[v.kind];
      if(v.decision<=0)this.chooseLane(v,near,intent,sim);
      for(const [owner,reservation] of this.reserved){
        if(owner===v.id||!this.reverse.has(owner)||reservation.poses.some(p=>overlaps(v.pose,v.kind,p,reservation.kind,.1)))continue;
        for(let d=.5;d<=Math.max(5,v.speed*v.speed/(2*spec.brake)+3);d+=.5){
          if(reservation.poses.some(p=>overlaps(v.route.at(v.s+d,v.offset),v.kind,p,reservation.kind,.2))){
            this.stop(intent,v,v.s+Math.max(0,d-1),'yielding',`Chờ xe #${owner} lùi xong`,owner);break;
          }
        }
      }
      let leaderGap=Infinity;
      for(const other of near){
        if(other===v||!active(other)||other.garageYield===v.id)continue;
        const p=v.route.at(v.s),dx=other.pose.x-v.pose.x,dz=other.pose.z-v.pose.z;
        const along=dx*Math.sin(p.angle)+dz*Math.cos(p.angle),across=Math.abs(dx*Math.cos(p.angle)-dz*Math.sin(p.angle));
        const sameDirection=Math.cos(other.pose.angle-p.angle)>.8;
        if(this.seesFront(v,other,sim)&&sameDirection&&along>(spec.length+SPECS[other.kind].length)/2-.1&&across<(spec.width+SPECS[other.kind].width)/2+.25){
          const planned=v.route.at(v.s+Math.max(4,along),v.targetOffset);
          const plannedAcross=Math.abs((other.pose.x-planned.x)*Math.cos(p.angle)-(other.pose.z-planned.z)*Math.sin(p.angle));
          // A future lane offset does not make the steering transition clear.
          if(plannedAcross>(spec.width+SPECS[other.kind].width)/2+.25&&this.stoppedPathObstruction(v,other)===undefined)continue;
          const gap=along-(spec.length+SPECS[other.kind].length)/2;
          const relative=v.speed-Math.max(0,other.velocity??other.speed),headway=spec.headway/(v.driverFactor??1);
          const desiredGap=.9+Math.max(0,v.speed*headway+v.speed*relative/(2*Math.sqrt(spec.accel*spec.brake)));
          const acceleration=spec.accel*(1-(v.speed/Math.max(.1,intent.target))**4-(desiredGap/Math.max(.15,gap))**2);
          intent.target=Math.min(intent.target,Math.max(0,v.speed+acceleration*dt));
          if(gap<leaderGap){
            leaderGap=gap;intent.leader=other.id;
            if(intent.state==='driving'||intent.state==='following'){intent.state='following';intent.reason=`Giữ khoảng cách với xe #${other.id}`;intent.other=other.id;intent.legal=true;}
          }
          // A stopped lead vehicle's legal reason propagates down the queue.
          const oi=intents.get(other.id)!;
          if(gap<2&&oi.legal){intent.legal=true;}
          continue;
        }
        const oi=intents.get(other.id)!;
        const waitingApproach=intent.movement&&oi.movement?.id===intent.movement.id&&other.s<=oi.movement.entry+.5;
        const occupied=!waitingApproach&&(oi.state==='red-light'||v.state==='yielding'&&v.blockerId===other.id)
          ?this.occupiedPath(v,other):undefined;
        if(occupied!==undefined){
          this.stop(intent,v,v.s+Math.max(0,occupied-.8),'yielding',`Chừa khoảng trống cho xe #${other.id} đang trong đường đi`,other.id);
          continue;
        }
        const obstruction=this.seesFront(v,other,sim)?this.stoppedPathObstruction(v,other):undefined;
        if(obstruction!==undefined){
          this.stop(intent,v,obstruction,'blocked',`Xe #${other.id} đang chắn cung di chuyển phía trước`,other.id);
          continue;
        }
        if(sameDirection&&across>=(spec.width+SPECS[other.kind].width)/2+.15)continue;
        if((oi.state==='red-light'||oi.state==='stopping'||oi.state==='exit-blocked')&&oi.limit-other.s>1||other.garageYield!==undefined)continue;
        if(oi.state==='red-light'||oi.state==='stopping'||oi.state==='exit-blocked')continue;
        const visible=this.seesFront(v,other,sim);
        const crossing=visible?this.conflict(v,other,sim.time):null;
        const predicted=crossing&&!this.hasPriority(v,other,intent,oi,crossing,sim)?this.crossingRisk(v,other):undefined;
        if(predicted!==undefined){
          this.stop(intent,v,predicted,'yielding',`Nhường xe #${other.id} đang cắt hướng di chuyển (cách tối thiểu 0,5 m)`,other.id);
          continue;
        }
        if(!visible||!this.nearFront(v,other))continue;
        const c=this.conflict(v,other,sim.time);if(!c||c.a<v.s-spec.length/2||c.b<other.s-SPECS[other.kind].length/2)continue;
        if(!this.approachingFront(v,other,c,intent,oi))continue;
        if(!this.hasPriority(v,other,intent,oi,c,sim)){
          const bend=!intent.movement?v.route.upcomingTurn(v.s,16):undefined;
          const entry=intent.movement?intent.movement.stop-spec.length/2-1:Infinity;
          const bendEntry=bend?bend.start-spec.length/2-.8:Infinity;
          const stop=Math.min(c.a-spec.length/2-1,entry>v.s?entry:Infinity,bendEntry>v.s?bendEntry:Infinity);
          this.stop(intent,v,stop,'yielding',`Nhường xe #${other.id}`,other.id);
        }
      }
      const m=intent.movement;
      if(m&&!m.circulating&&v.s<m.entry-spec.length/2){
        const exit=v.route.at(Math.min(v.route.total,m.exit+spec.length/2+1),v.targetOffset);
        const tail=v.route.at(m.exit,v.targetOffset);
        const blocker=near.find(o=>{
          if(o===v||!active(o)||o.speed>=1||Math.cos(o.pose.angle-exit.angle)<.8)return false;
          const approach=o.route.movements.find(other=>other.id===m.id&&o.s<=other.entry+.5);
          // A car waiting on another approach of this junction is a priority
          // conflict, not a downstream queue occupying the receiving lane.
          if(approach)return false;
          return sweptOverlaps(tail,exit,v.kind,o.pose,o.kind,.35);
        });
        if(blocker)this.stop(intent,v,m.stop-spec.length/2-.5,'exit-blocked','Phía ra giao lộ chưa đủ chỗ',blocker.id);
      }
      if(v.route.fromHouse!==undefined&&v.s<v.route.departureLength&&v.garageYield===undefined){
        let merge:{other:Vehicle;s:number}|undefined;
        for(const other of near){
          if(other===v||!active(other)||other.speed<.3||other.route.fromHouse===v.route.fromHouse||!this.nearFront(v,other))continue;
          for(const time of [.5,1,1.5,2]){
            const s=Math.min(v.route.departureLength,v.s+v.speed*time+.5*spec.accel*time*time);
            if(overlaps(v.route.at(s,v.offset),v.kind,this.forecast(other,time),other.kind,.4)){
              if(!merge||s<merge.s)merge={other,s};break;
            }
          }
        }
        if(merge){
          const stop=Math.min(merge.s-.6,v.route.departureLength-spec.length/2-.8);
          this.stop(intent,v,stop,'merging',`Chờ xe phía trước #${merge.other.id} qua điểm nhập dòng`,merge.other.id);
        }
      }
      const doorway=vehicles.find(o=>active(o)&&o.garageYield===v.id&&this.frontObstruction(v,o)!==undefined);
      if(doorway){const gap=this.frontObstruction(v,doorway)!;this.stop(intent,v,v.s+Math.max(0,gap-.5),'yielding','Chờ xe trước mặt lùi vào cửa nhà',doorway.id);}
    }
    // Detect geometric locks separately from normal following or right-of-way.
    for(const v of vehicles){const intent=intents.get(v.id)!,near=neighbors.get(v.id)!;
      const touching=near.find(o=>o!==v&&active(o)&&overlaps(v.route.at(v.s+.3,v.offset),v.kind,o.pose,o.kind,.12));
      if(touching&&!intent.legal){intent.state='blocked';intent.other=touching.id;intent.reason=`Không đủ khoảng trống trước xe #${touching.id}`;}
      // Mutual nose-to-nose stops are physical locks, even if both previously yielded.
      if(touching&&intent.state==='yielding'&&intents.get(touching.id)?.other===v.id&&Math.cos(v.pose.angle-touching.pose.angle)<.8){intent.state='blocked';intent.legal=false;}
    }
    if(this.tick%15===0)this.recover(sim,intents,neighbors);
    // Safety prediction reads one shared snapshot and is independent of right
    // of way. Recovery grants and following/traffic-rule branches cannot skip it.
    const prediction=new YieldPrediction(),byId=new Map(vehicles.map(v=>[v.id,v]));
    for(const v of vehicles){
      const intent=intents.get(v.id)!;intent.yieldingTo??=[];
      if(this.reverse.has(v.id)||v.garageYield!==undefined)continue;
      const recovery=this.forward.get(v.id),base=constraints.get(v.id)!;
      if(recovery&&recovery.until>sim.time&&base.state==='driving'&&intent.state!=='exit-blocked'&&!this.release.has(v.id)){
        // A validated recovery arc replaces the stale geometric yield that
        // caused the lock. Signals, exit capacity and collision prediction still
        // constrain this short, low-speed movement on every integration step.
        intent.target=Math.min(base.target,.8);intent.limit=Math.min(base.limit,recovery.start+1.2);
        intent.state='driving';intent.reason='Tiến chậm để mở khoảng trống';intent.legal=false;
        intent.other=undefined;intent.leader=undefined;
      }
      const seen=sim.observations.get(v.id);
      const ids=new Set([...(seen?.front??[]),...(seen?.rear??[])].map(o=>o.id));
      const observed=[...ids].flatMap(id=>{const other=byId.get(id);return other?[other]:[];});
      let plan=prediction.plan(v,observed,intent.target,intent.limit,this.forward.get(v.id)?.steering);
      const cached=this.avoidance.get(v.id);
      const blocked=!!plan||intent.state==='blocked'||intent.state==='following'&&observed.some(o=>this.stoppedPathObstruction(v,o)!==undefined);
      const stationaryObstruction=observed.some(o=>Math.abs(o.velocity??o.speed)<.3
        &&this.stoppedPathObstruction(v,o)!==undefined);
      const canDetour=base.state==='driving'&&!intent.line&&!['red-light','stopping','exit-blocked'].includes(intent.state)
        &&stationaryObstruction&&!this.forward.has(v.id)&&!this.release.has(v.id);
      if(blocked&&canDetour&&(!cached||cached.steering!==undefined||sim.time>=cached.retryAt)){
        const detour=prediction.steerAround(v,observed,base.target,base.limit,
          (from,to)=>this.safeMotion(from,to,neighbors.get(v.id)!,sim,base.line),
          cached&&sim.time<cached.retryAt?cached.steering:undefined,
          cached&&sim.time<cached.retryAt?cached.targetOffset:undefined,
          cached&&sim.time<cached.retryAt?Math.max(0,(cached.until??sim.time)-sim.time):.6);
        if(detour){
          this.avoidance.set(v.id,{steering:detour.steering,targetOffset:detour.targetOffset,until:sim.time+detour.duration,retryAt:sim.time+.35});
          intent.target=detour.target;intent.limit=base.limit;intent.travelLimit=undefined;
          intent.avoidanceSteering=detour.duration>0?detour.steering:undefined;intent.avoidanceOffset=detour.targetOffset;intent.state='driving';intent.legal=false;
          intent.reason='Đánh lái qua khoảng trống an toàn';intent.other=undefined;intent.leader=undefined;intent.yieldingTo=[];
          plan=undefined; // The complete steering-and-offset path was validated above.
        }else this.avoidance.set(v.id,{retryAt:cached?.steering!==undefined?sim.time:sim.time+.35});
      }else if(!blocked||!canDetour)this.avoidance.delete(v.id);
      if(!plan)continue;
      intent.yieldingTo=[...new Set([...intent.yieldingTo,...plan.risks.map(r=>r.id)])].sort((a,b)=>a-b);
      const first=[...plan.risks].sort((a,b)=>a.distance-b.distance||a.time-b.time||a.id-b.id)[0];
      const reason=`${plan.emergency?'Phanh tránh va chạm':'Nhường trước vùng xung đột'} với xe ${intent.yieldingTo.map(id=>`#${id}`).join(', ')}`;
      const state=['red-light','stopping','exit-blocked','blocked'].includes(intent.state)?intent.state:'yielding';
      const previousTarget=intent.target;
      this.stop(intent,v,plan.limit,state,reason,first.id);
      if(plan.target<previousTarget&&['driving','following'].includes(intent.state)){
        intent.state='yielding';intent.reason=reason;intent.other=first.id;intent.legal=true;
      }
      intent.target=Math.min(intent.target,plan.target);
      intent.travelLimit=plan.distance;
    }
    this.reserveRetreats(vehicles);
    // A new recovery plan takes effect this tick. Its beneficiary waits for the
    // retreat to finish instead of following the reversing nose into its space.
    for(const [owner,reverse] of this.reverse){
      const other=byId.get(reverse.other),retreat=byId.get(owner);
      if(!other||!retreat||other.id===owner||this.reverse.has(other.id))continue;
      if(dist(other.pose,retreat.pose)>12)continue;
      const intent=intents.get(other.id)!;
      this.stop(intent,other,other.s,'yielding',`Chờ xe #${owner} lùi mở khoảng trống`,owner);
      intent.avoidanceSteering=undefined;intent.avoidanceOffset=undefined;
    }
    const committed=new Map<number,{from:Pose;to:Pose}>();
    for(const v of vehicles){
      const intent=intents.get(v.id)!,near=neighbors.get(v.id)!,spec=SPECS[v.kind],oldS=v.s,oldSpeed=v.speed,oldCell=cell(v.pose);
      const startPose=v.pose;
      const canCommit=(next:ReturnType<DrivingSystem['motion']>,manoeuvring:boolean)=>{
        if(!this.safeMotion(v,next,near,sim,intent.line,manoeuvring))return false;
        for(const other of near){
          if(other.id===v.id)continue;
          const motion=committed.get(other.id);if(!motion)continue;
          if(movingBodiesOverlap(startPose,next.pose,v.kind,motion.from,motion.to,other.kind,.06)){
            // Existing, stationary contacts may separate during a recovery.
            if(!(manoeuvring&&dist(motion.from,motion.to)<1e-10&&Math.abs(angle(motion.to.angle-motion.from.angle))<1e-10
              &&separatesContact(startPose,next.pose,v.kind,motion.from,other.kind)))return false;
          }
        }
        return true;
      };
      let forward=this.forward.get(v.id);
      if(forward&&(sim.time>forward.until||v.s-forward.start>1.2)){this.forward.delete(v.id);forward=undefined;}
      let distance=0,reverse=this.reverse.get(v.id),reverseTarget=reverse?.other===v.id?0:v.offset;
      if(reverse&&(sim.time>reverse.until||(reverse.travelled??0)>=Math.min(4,reverse.start-reverse.target)-.01||v.s<=.01||!vehicles.some(o=>o.id===reverse!.other))){
        this.reverse.delete(v.id);
        if(reverse.other!==v.id){this.release.set(v.id,{other:reverse.other,until:sim.time+5});this.grants.delete(v.id);this.grants.set(reverse.other,sim.time+8);}
        reverse=undefined;
      }
      if(v.garageYield!==undefined){v.speed=Math.min(1.5,oldSpeed+spec.accel*dt);distance=-Math.min(v.s,v.speed*dt);intent.state='reversing';intent.reason='Lùi vào nhà để nhường xe về';}
      else if(reverse){
        const remaining=Math.max(0,Math.min(4,reverse.start-reverse.target)-(reverse.travelled??0));
        if(reverse.steering!==undefined&&Math.abs((v.steering??0)-reverse.steering)>.025){
          v.steering=(v.steering??0)+clamp(reverse.steering-(v.steering??0),-dt*1.3,dt*1.3);v.speed=0;
          intent.state='reversing';intent.reason='Đánh lái chuẩn bị lùi';
        }else if(this.rearRoom(v,near,Math.min(.5,remaining),reverse.steering)>=Math.min(.1,remaining)-.00001){
          v.speed=Math.min(.9,oldSpeed+spec.accel*dt);distance=-Math.min(remaining,v.speed*dt);intent.state='reversing';intent.reason=reverse.other===v.id?'Lùi để mở rộng cung quay':`Lùi mở đường cho xe #${reverse.other}`;
        }else{v.speed=0;intent.state='reversing';intent.reason='Dừng lùi vì phía sau có xe';}
      }else{
        const requested=clamp((intent.target-oldSpeed)/dt,-spec.emergencyBrake,spec.accel);
        v.acceleration=requested;v.speed=Math.max(0,oldSpeed+requested*dt);
        distance=Math.min(v.speed*dt,Math.max(0,intent.limit-v.s),intent.travelLimit??Infinity);
      }
      if(forward&&!reverse&&v.garageYield===undefined&&Math.abs((v.steering??0)-forward.steering)>.025){
        v.steering=(v.steering??0)+clamp(forward.steering-(v.steering??0),-dt*1.3,dt*1.3);distance=0;v.speed=0;
        if(!intent.legal)intent.reason='Đánh lái để đi tiếp qua khoảng trống';
      }
      if(intent.avoidanceOffset!==undefined)v.targetOffset=intent.avoidanceOffset;
      const target=distance<0?reverseTarget:v.targetOffset;
      let next=this.motion(v,distance,target,dt,reverse?.steering??intent.avoidanceSteering??forward?.steering);
      // A stop line is a geometric constraint for every movement, including
      // avoidance and recovery. Collision prevention cannot override a red.
      if(distance>0&&next.s>intent.limit+.001){distance*=Math.max(0,(intent.limit-v.s)/(next.s-v.s));next=this.motion(v,distance,target,dt,reverse?.steering??intent.avoidanceSteering??forward?.steering);}
      if(distance>0&&intent.line&&this.frontAtLine(next.pose,v,intent.line)>0){
        let low=0,high=distance;
        for(let i=0;i<14;i++){
          const mid=(low+high)/2,candidate=this.motion(v,mid,target,dt,reverse?.steering??intent.avoidanceSteering??forward?.steering);
          if(this.frontAtLine(candidate.pose,v,intent.line)>0)high=mid;else low=mid;
        }
        distance=low;next=this.motion(v,distance,target,dt,reverse?.steering??intent.avoidanceSteering??forward?.steering);
      }
      let avoidanceTargets:Vehicle[]|undefined;
      let fallbackPrediction:YieldPrediction|undefined;
      const targets=()=>{
        if(avoidanceTargets)return avoidanceTargets;
        const seen=sim.observations.get(v.id),ids=new Set([...(seen?.front??[]),...(seen?.rear??[])].map(o=>o.id));
        return avoidanceTargets=near.filter(o=>ids.has(o.id));
      };
      let moved=canCommit(next,!!reverse||!!forward);
      if(!moved&&distance>0&&intent.avoidanceOffset===undefined){
        // Try small forward arcs only. Never translate sideways at zero speed.
        for(const offset of [v.offset,v.targetOffset-.5,v.targetOffset+.5]){
          const bound=Math.max(0,(v.route.at(v.s).width-spec.width)/2-.25);
          const candidateOffset=clamp(offset,-bound,bound);
          if((fallbackPrediction??=new YieldPrediction()).plan({...v,targetOffset:candidateOffset},targets(),Math.max(v.speed,intent.target),intent.limit))continue;
          const candidate=this.motion(v,distance,candidateOffset,dt);
          if(candidate.s<=intent.limit+.001&&canCommit(candidate,!!reverse||!!forward)){next=candidate;moved=true;break;}
        }
      }
      if(!moved&&distance>0&&!intent.legal&&intent.avoidanceOffset===undefined){
        let best=-Infinity;
        for(const steering of [-spec.maxSteer,-spec.maxSteer/2,0,spec.maxSteer/2,spec.maxSteer]){
          if((fallbackPrediction??=new YieldPrediction()).plan(v,targets(),Math.max(v.speed,intent.target),intent.limit,steering))continue;
          const candidate=this.motion(v,distance,target,dt,steering);
          if(candidate.s>intent.limit+.001||!canCommit(candidate,!!reverse||!!forward))continue;
          const future=this.motion({...v,...candidate},.6,target,.6,steering);
          if(!this.safeMotion({...v,...candidate},future,near,sim,intent.line,!!reverse||!!forward))continue;
          const score=future.s-v.s-Math.abs(future.offset)*.15-Math.abs(angle(future.pose.angle-v.route.at(future.s).angle))*.2;
          if(score>best){best=score;next=candidate;moved=true;}
        }
      }
      if(moved){v.pose=next.pose;v.s=next.s;v.offset=next.offset;v.steering=next.steering;}
      else{v.steering=next.steering;v.speed=0;v.acceleration=-oldSpeed/dt;if(!intent.legal&&intent.state!=='reversing'){intent.state='blocked';intent.reason='Chờ khoảng trống cho cả thân xe';}}
      committed.set(v.id,{from:startPose,to:v.pose});
      if(moved&&reverse)reverse.travelled=(reverse.travelled??0)+Math.abs(distance);
      v.velocity=moved?distance/dt:0;
      v.acceleration=(v.speed-oldSpeed)/dt;
      if(reverse&&Math.abs((v.steering??0)-(reverse.steering??0))<.025){
        reverse.blockedFor=Math.abs(v.velocity)<.01?(reverse.blockedFor??0)+dt:0;
        if(reverse.blockedFor>.75){
          const rear=driveArc(v.pose,-.5,reverse.steering??0,spec.wheelbase);
          const blocker=near.find(o=>o!==v&&active(o)&&sweptOverlaps(v.pose,rear,v.kind,o.pose,o.kind,.06));
          if(blocker)this.reverseNeeds.set(v.id,{other:blocker.id,steering:reverse.steering??0,until:sim.time+20});
          this.reverse.delete(v.id);this.reserved.delete(v.id);this.reverseCooldown.set(v.id,sim.time+6);
        }
      }
      if(Math.abs(v.velocity)<.01)v.speed=0;
      v.braking=(v.acceleration??0)<-.5||v.speed<.2&&intent.legal;
      v.blocked=intent.state==='blocked'&&Math.abs(v.velocity)<.15;
      v.stuckTime=v.blocked?(v.stuckTime??0)+dt:0;
      v.waiting=Math.abs(v.velocity)<.15?v.waiting+dt:Math.max(0,v.waiting-dt*2);
      v.state=intent.state;v.reason=intent.reason;v.blockerId=intent.other;v.yieldingTo=intent.yieldingTo??[];
      const m=intent.movement,driveway=v.s<v.route.departureLength+8||v.s>v.route.total-v.route.arrivalLength-8,turn=m?.turn??(driveway||!v.route.movements.length?v.route.upcomingTurn(v.s,12)?.direction??0:0);
      const changing=v.targetOffset-v.offset;
      v.indicator=-(Math.abs(changing)>.5?Math.sign(changing):turn) as -1|0|1;
      v.tripDistance=(v.tripDistance??0)+Math.abs(distance);
      if(v.garageYield!==undefined&&v.s<.08){v.inGarage=true;v.state='garage';v.reason='Chờ xe về vào nhà';v.s=0;v.pose={...v.route.at(0),y:-10};v.offset=v.targetOffset=0;v.speed=v.velocity=0;}
      if(m&&oldS<m.entry&&v.s>=m.entry)this.lastMerge.set(m.id,m.incomingRoad??Math.round(m.incoming*100));
      if(m&&oldS<m.exit&&v.s>=m.exit)this.grants.delete(v.id);
      if(oldCell!==cell(v.pose)||v.inGarage){grid.set(oldCell,(grid.get(oldCell)??[]).filter(o=>o!==v));if(!v.inGarage)insert(v);}
      if(v.s>=v.route.total-.15){v.arrived=true;sim.completed++;this.reverse.delete(v.id);this.reserved.delete(v.id);this.reverseNeeds.delete(v.id);this.forward.delete(v.id);}
      v.motionState=vehicleMotionState(v);
      // Replan a sustained blocked trip from a real road position. The new
      // route starts at the exact pose, so neither position nor heading teleports.
      const congested=(v.stuckTime??0)>20||v.waiting>25&&['following','exit-blocked'].includes(v.state??'');
      const reviewRoute=this.tick%60===v.id%60&&v.age>12&&!this.reverse.has(v.id)&&!this.release.has(v.id);
      if((congested||reviewRoute)&&sim.time>(v.rerouteAt??0)&&v.route.toHouse!==undefined&&v.leftHouse){
        v.rerouteAt=sim.time+15+v.id%7;this.reroute(v,sim);
      }
    }
    if(this.tick%300===0){const ids=new Set(sim.vehicles.filter(v=>!v.arrived).map(v=>v.id));for(const k of this.conflicts.keys()){if((this.conflictExpiry.get(k)??0)<sim.time||k.split(':').some(id=>!ids.has(Number(id)))){this.conflicts.delete(k);this.conflictExpiry.delete(k);}}for(const map of [this.reverse,this.reserved,this.reverseNeeds,this.reverseCooldown,this.forward,this.release,this.grants,this.avoidance])for(const id of map.keys())if(!ids.has(id))map.delete(id);}
  }

  private reroute(v:Vehicle,sim:Simulation){
    const destination=sim.world.houses.find(h=>h.id===v.route.toHouse),road=sim.world.nearest(v.pose);if(!destination||!road)return;
    // Replanning inside a driveway or a turn discards the very manoeuvre that
    // must finish first. Only reconsider a straight carriageway approach.
    if(v.s<v.route.departureLength+SPECS[v.kind].length+3||v.s>v.route.total-v.route.arrivalLength-SPECS[v.kind].length-3
      ||v.route.upcomingTurn(v.s,14)||Math.abs(v.route.curvature(v.s))>.02||Math.abs(v.offset)>.25
      ||Math.cos(v.pose.angle-v.route.at(v.s).angle)<.98)return;

    const delays=this.roadDelay(sim);
    const from={id:-v.id,x:v.pose.x,z:v.pose.z,angle:v.pose.angle,kind:0};
    const route=planRoute(sim.world,from,destination,{kind:v.kind,roadDelay:delays,startPose:v.pose,travelTime:true});if(!route)return;
    const remaining=new Set<number>();
    for(let s=v.s;s<v.route.total-v.route.arrivalLength;s+=8){const road=sim.world.nearest(v.route.at(s))?.road;if(road)remaining.add(road.id);}
    const oldCost=(v.route.total-v.s)/SPECS[v.kind].speed+[...remaining].reduce((n,id)=>n+(delays.get(id)??0),0);
    const newCost=route.total/SPECS[v.kind].speed+route.roadIds.reduce((n,id)=>n+(delays.get(id)??0),0);
    if(oldCost-newCost<Math.max(3,oldCost*.15))return;
    v.route=route;this.reverse.delete(v.id);this.reserved.delete(v.id);this.reverseNeeds.delete(v.id);this.forward.delete(v.id);this.release.delete(v.id);
    for(const k of this.conflicts.keys())if(k.split(':').includes(String(v.id))){this.conflicts.delete(k);this.conflictExpiry.delete(k);}
    v.s=0;v.offset=v.targetOffset=0;v.approachId=undefined;

  }
}
