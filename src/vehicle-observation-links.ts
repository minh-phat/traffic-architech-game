import * as THREE from 'three';
import { SPECS, type Vehicle } from './simulation';
import { vehicleObservationPose, vehicleObservationSamples, type VehicleObservations } from './vehicle-perception';

type Indicators={group:THREE.Group;material:THREE.MeshBasicMaterial;shafts:THREE.Mesh[];arrows:THREE.Mesh[]};

/** Directional links and markers for vehicles detected by the selected vehicle. */
export class VehicleObservationLinks {
  group=new THREE.Group();
  private front=this.makeLines('observation-links-front',0x008fa3);
  private rear=this.makeLines('observation-links-rear',0xd34b98);
  private shaftGeometry=new THREE.CylinderGeometry(.055,.055,1,8);
  private arrowGeometry=new THREE.ConeGeometry(.48,1,12).rotateZ(Math.PI);
  private frontMarkers=this.makeIndicators('observation-markers-front',0x00b5d0);
  private rearMarkers=this.makeIndicators('observation-markers-rear',0xf45ba9);
  ids:number[]=[];
  constructor(){this.group.name='observation-links';this.group.add(this.front,this.rear,this.frontMarkers.group,this.rearMarkers.group);this.group.visible=false;}
  private makeLines(name:string,color:number){
    const line=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color,depthTest:true,depthWrite:false,toneMapped:false}));
    line.name=name;line.frustumCulled=false;line.renderOrder=8;return line;
  }
  private makeIndicators(name:string,color:number):Indicators{
    const group=new THREE.Group();group.name=name;
    return {group,material:new THREE.MeshBasicMaterial({color,depthTest:true,depthWrite:false,toneMapped:false}),shafts:[],arrows:[]};
  }
  private indicator(markers:Indicators,index:number,eye:THREE.Vector3,sample:THREE.Vector3,target:Vehicle){
    let shaft=markers.shafts[index],arrow=markers.arrows[index];
    if(!shaft){
      shaft=new THREE.Mesh(this.shaftGeometry,markers.material);arrow=new THREE.Mesh(this.arrowGeometry,markers.material);
      shaft.name='observation-shaft';arrow.name='observation-arrow';shaft.renderOrder=9;arrow.renderOrder=9;
      markers.group.add(shaft,arrow);markers.shafts.push(shaft);markers.arrows.push(arrow);
    }
    shaft.visible=arrow.visible=true;
    const direction=sample.clone().sub(eye),length=direction.length();
    shaft.position.copy(eye).add(sample).multiplyScalar(.5);shaft.scale.set(1,length,1);
    if(length>1e-6)shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.multiplyScalar(1/length));
    // A downward pointer floats just above the vehicle, making the destination
    // readable even if the sightline ends on a partially hidden side of it.
    const roof=target.kind==='truck'?3:target.kind==='bike'?2.1:1.9;
    arrow.position.set(target.pose.x,target.pose.y+roof+.65,target.pose.z);
  }
  update(selected:Vehicle|undefined,vehicles:Vehicle[],observations:VehicleObservations,observedVehicleId:number|null){
    this.ids=[];
    if(!selected||selected.inGarage||selected.id!==observedVehicleId){this.group.visible=false;return;}
    const byId=new Map(vehicles.filter(v=>!v.inGarage&&!v.arrived).map(v=>[v.id,v]));
    const used=new Set<number>(),pose=vehicleObservationPose(selected),eye=new THREE.Vector3(pose.x,pose.y,pose.z);
    for(const [side,lines,markers] of [['front',this.front,this.frontMarkers],['rear',this.rear,this.rearMarkers]] as const){
      const points:number[]=[];let count=0;
      for(const observation of observations[side]){
        const target=byId.get(observation.id);
        if(!target||target.id===selected.id||used.has(target.id))continue;
        const sample=vehicleObservationSamples(target)[observation.sampleIndex];
        if(!sample)continue;
        used.add(target.id);this.ids.push(target.id);this.indicator(markers,count++,eye,sample,target);
        points.push(eye.x,eye.y,eye.z,sample.x,sample.y,sample.z);
        const spec=SPECS[target.kind],p=target.pose,height=target.kind==='truck'?3:2.25;
        const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[
          p.x+Math.cos(p.angle)*x*(spec.width/2+.16)+Math.sin(p.angle)*z*(spec.length/2+.16),
          p.y+height,
          p.z-Math.sin(p.angle)*x*(spec.width/2+.16)+Math.cos(p.angle)*z*(spec.length/2+.16),
        ]);
        for(let i=0;i<4;i++)points.push(...corners[i],...corners[(i+1)%4]);
      }
      for(let i=count;i<markers.shafts.length;i++){markers.shafts[i].visible=false;markers.arrows[i].visible=false;}
      lines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    }
    this.group.visible=this.ids.length>0;
  }
}
