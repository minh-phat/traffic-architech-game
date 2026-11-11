import * as THREE from 'three';
import type { Vehicle } from './simulation';
import { vehicleObservationPose } from './vehicle-perception';
import { defaultObservationProfiles, observationRayDistance, type ObservationProfiles, type ObservationSector } from './vehicle-observation';

const COLUMNS=21, ROWS=9, OCCLUSION_INTERVAL=150;

/** A translucent, sampled 3D field. Position and heading follow every frame;
 * its occlusion boundary is resampled periodically to bound raycasting cost. */
export class VehicleObservationGuide {
  group=new THREE.Group();
  profiles:ObservationProfiles=defaultObservationProfiles();
  enabled=true;
  private key='';
  private lastUpdate=-Infinity;
  private raycaster=new THREE.Raycaster();
  private front=this.makeSector(0x16a6ba,'observation-front');
  private rear=this.makeSector(0xe479b3,'observation-rear');
  constructor(){this.group.name='vehicle-observation';this.group.add(this.front,this.rear);this.group.visible=false;}
  private makeSector(color:number,name:string){
    const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.14,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
    mesh.name=name;mesh.renderOrder=3;mesh.frustumCulled=false;return mesh;
  }
  private setSector(mesh:THREE.Mesh,sector:ObservationSector,rear:boolean,origin:THREE.Vector3,yaw:number,pitch:number,occluders:THREE.Object3D[]){
    const positions:number[]=[];
    if(sector.range>0&&sector.angle>0&&sector.verticalAngle>0){
      const samples:{direction:THREE.Vector3;distance:number}[]=[];
      const tilt=rear?-pitch:pitch,worldRotation=new THREE.Matrix4().makeRotationY(yaw);
      for(let row=0;row<ROWS;row++)for(let col=0;col<COLUMNS;col++){
        const h=(col/(COLUMNS-1)-.5)*sector.angle*Math.PI/180;
        const v=(row/(ROWS-1)-.5)*sector.verticalAngle*Math.PI/180;
        const x=Math.sin(h)*Math.cos(v),up=Math.sin(v),forward=Math.cos(h)*Math.cos(v);
        const direction=new THREE.Vector3(x,up*Math.cos(tilt)+forward*Math.sin(tilt),forward*Math.cos(tilt)-up*Math.sin(tilt));
        if(rear){direction.x=-direction.x;direction.z=-direction.z;}
        const worldDirection=direction.clone().applyMatrix4(worldRotation);
        samples.push({direction,distance:observationRayDistance(origin,worldDirection,sector.range,occluders,this.raycaster)});
      }
      const add=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>positions.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
      const zero=new THREE.Vector3();
      for(let row=0;row<ROWS-1;row++)for(let col=0;col<COLUMNS-1;col++){
        const a=samples[row*COLUMNS+col],b=samples[row*COLUMNS+col+1],c=samples[(row+1)*COLUMNS+col],d=samples[(row+1)*COLUMNS+col+1];
        // Use the nearest sampled hit for the whole cell so an obstacle at a
        // sample cannot be bridged by the opposite corner of the same cell.
        const distance=Math.min(a.distance,b.distance,c.distance,d.distance);
        const pa=a.direction.clone().multiplyScalar(distance),pb=b.direction.clone().multiplyScalar(distance),pc=c.direction.clone().multiplyScalar(distance),pd=d.direction.clone().multiplyScalar(distance);
        add(pa,pb,pd);add(pa,pd,pc);
        if(row===0)add(zero,pb,pa);
        if(row===ROWS-2)add(zero,pc,pd);
        if(col===0)add(zero,pa,pc);
        if(col===COLUMNS-2)add(zero,pd,pb);
      }
    }
    mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  }
  update(vehicle?:Vehicle,occluders:THREE.Object3D[]=[],now=performance.now()){
    this.group.visible=!!vehicle&&this.enabled;
    if(!vehicle||!this.enabled){this.key='';return;}
    const pose=vehicleObservationPose(vehicle),origin=new THREE.Vector3(pose.x,pose.y,pose.z),pitch=pose.pitch??0;
    const profile=this.profiles[vehicle.kind],key=JSON.stringify([vehicle.id,vehicle.kind,profile]);
    this.group.position.copy(origin);
    this.group.rotation.y=vehicle.pose.angle;
    if(key!==this.key||now-this.lastUpdate>=OCCLUSION_INTERVAL||now<this.lastUpdate){
      this.setSector(this.front,profile.front,false,origin,vehicle.pose.angle,pitch,occluders);
      this.setSector(this.rear,profile.rear,true,origin,vehicle.pose.angle,pitch,occluders);
      this.key=key;this.lastUpdate=now;
    }
  }
}
