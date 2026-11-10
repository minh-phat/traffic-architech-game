import {VehicleSteering} from './vehicle-steering';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VehicleBlockage } from './vehicle-blockage';
import { VehicleDirections } from './vehicle-directions';
import { World, Simulation, SPECS, type Point, type Vehicle, type Road, type Pose, signalState, pt, dist } from './simulation';

const materials=new Map<string,THREE.MeshStandardMaterial>();
function mat(color:number,roughness=.8){const key=`${color}-${roughness}`;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness}));return materials.get(key)!;}
function box(w:number,h:number,d:number,color:number,x=0,y=0,z=0){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
function cylinder(r:number,h:number,color:number,x=0,y=0,z=0,segments=16){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),mat(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
function dispose(group:THREE.Object3D){group.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const list=Array.isArray(o.material)?o.material:[o.material];for(const material of list)if(material.userData.transient)material.dispose();}});group.clear();}
function ribbon(points:Point[],width:number,color:number,height=.06){
  const vertices:number[]=[],indices:number[]=[];
  points.forEach((p,i)=>{const a=points[Math.max(i-1,0)],b=points[Math.min(i+1,points.length-1)],l=dist(a,b)||1,nx=(b.z-a.z)/l,nz=-(b.x-a.x)/l;vertices.push(p.x+nx*width/2,p.y+height,p.z+nz*width/2,p.x-nx*width/2,p.y+height,p.z-nz*width/2);if(i<points.length-1){const v=i*2;indices.push(v,v+1,v+2,v+1,v+3,v+2);}});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();const mesh=new THREE.Mesh(g,mat(color));mesh.receiveShadow=true;return mesh;
}
function offsetPath(points:Point[],offset:number){return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],l=dist(a,b)||1;return {...p,x:p.x+(b.z-a.z)/l*offset,z:p.z-(b.x-a.x)/l*offset};});}
export class CityScene {
  renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.OrthographicCamera();controls:OrbitControls;
  city=new THREE.Group();cars=new THREE.Group();ghost=new THREE.Group();carMeshes=new Map<number,THREE.Group>();signalMeshes:{mesh:THREE.Mesh;index:number;vertical:boolean;turn?:'straight'|'left'|'right'}[]=[];
  ray=new THREE.Raycaster();pointer=new THREE.Vector2();night=false;debug=false;sun:THREE.DirectionalLight;ambient:THREE.HemisphereLight;
  steeringGuide=new VehicleSteering();
  showDirections=false;directions=new VehicleDirections();blockage=new VehicleBlockage();
  selectedVehicleId:number|null=null;
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(.84,1,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xffd45c,side:THREE.DoubleSide,toneMapped:false,depthWrite:false}));
  constructor(public canvas:HTMLCanvasElement,public container:HTMLElement){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.setClearColor(0xe8ece4);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.22;
    this.camera.position.set(130,155,150);this.camera.near=.1;this.camera.far=1000;
    this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,0,3);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.maxPolarAngle=Math.PI/2.2;this.controls.minPolarAngle=.001;this.controls.minZoom=.45;this.controls.maxZoom=15;this.controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE};this.controls.update();
    this.ambient=new THREE.HemisphereLight(0xeaf5ff,0x7e8a69,2.3);this.scene.add(this.ambient);
    this.sun=new THREE.DirectionalLight(0xffeed6,3.5);this.sun.position.set(-75,130,65);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-145,right:145,top:145,bottom:-145,near:1,far:350});this.sun.shadow.bias=-.0005;this.sun.shadow.normalBias=.25;this.scene.add(this.sun);
    this.selectionRing.visible=false;this.selectionRing.renderOrder=5;
    this.scene.add(this.city,this.cars,this.ghost,this.steeringGuide.group,this.directions.group,this.blockage.group,this.selectionRing);this.resize();new ResizeObserver(()=>this.resize()).observe(container);
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();this.renderer.setSize(width,height,false);const aspect=width/height,span=95;this.camera.left=-span*aspect;this.camera.right=span*aspect;this.camera.top=span;this.camera.bottom=-span;this.camera.updateProjectionMatrix();}
  pick(clientX:number,clientY:number){const rect=this.canvas.getBoundingClientRect();this.pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const p=new THREE.Vector3();return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),p)?pt(p.x,p.z):null;}
  pickVehicle(clientX:number,clientY:number,tolerance=8):number|null {
    const rect=this.canvas.getBoundingClientRect();
    this.pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.ray.setFromCamera(this.pointer,this.camera);
    const hits=this.ray.intersectObject(this.cars,true).filter(hit=>hit.object instanceof THREE.Mesh);
    const first=hits[0];
    if(first){
      const obstruction=this.ray.intersectObject(this.city,true)[0];
      if(!obstruction||first.distance<obstruction.distance){
        let group:THREE.Object3D=first.object;
        while(group.parent&&group.parent!==this.cars)group=group.parent;
        if(typeof group.userData.vehicleId==='number')return group.userData.vehicleId;
      }
    }
    // A small screen-space tolerance keeps narrow motorcycles selectable when zoomed out.
    const candidates=[...this.carMeshes].map(([id,mesh])=>{
      const center=new THREE.Vector3(0,1.2,0);mesh.localToWorld(center);
      const projected=center.clone().project(this.camera);
      const distance=Math.hypot(rect.left+(projected.x+1)*rect.width/2-clientX,rect.top+(1-projected.y)*rect.height/2-clientY);
      return {id,center,projected,distance};
    }).filter(c=>c.distance<=tolerance&&c.projected.z>=-1&&c.projected.z<=1).sort((a,b)=>a.distance-b.distance);
    for(const candidate of candidates){
      this.ray.setFromCamera(new THREE.Vector2(candidate.projected.x,candidate.projected.y),this.camera);
      const obstruction=this.ray.intersectObject(this.city,true)[0];
      if(!obstruction||obstruction.distance>=this.ray.ray.origin.distanceTo(candidate.center)-.3)return candidate.id;
    }
    return null;
  }
  home(){this.camera.position.set(130,155,150);this.controls.target.set(0,0,3);this.camera.zoom=1;this.camera.updateProjectionMatrix();this.controls.update();}
  zoom(factor:number){this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom*factor,this.controls.minZoom,this.controls.maxZoom);this.camera.updateProjectionMatrix();}
  setCameraInteraction(rotate:boolean,exploring:boolean){
    this.controls.mouseButtons.LEFT=exploring?(rotate?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN):null;
    this.controls.touches.ONE=exploring?(rotate?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN):null;
    this.controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
  }
  orbit(azimuth:number,elevation=0){
    const offset=this.camera.position.clone().sub(this.controls.target);
    const spherical=new THREE.Spherical().setFromVector3(offset);
    spherical.theta+=azimuth;
    spherical.phi=THREE.MathUtils.clamp(spherical.phi+elevation,this.controls.minPolarAngle,this.controls.maxPolarAngle);
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.controls.update();
  }
  top(){this.camera.position.set(this.controls.target.x,230,this.controls.target.z+.1);this.controls.update();}
  setNight(value:boolean){this.night=value;this.renderer.setClearColor(value?0x172a32:0xe8ece4);this.ambient.intensity=value?.65:2.3;this.sun.intensity=value?.8:3.5;this.sun.color.setHex(value?0x9fbfff:0xffeed6);}
  rebuild(world:World){
    this.selectedVehicleId=null;this.selectionRing.visible=false;
    this.directions.clear();
    dispose(this.city);this.signalMeshes=[];
    const ground=box(240,.8,205,0xc3d3b7,0,-.6,3);this.city.add(ground);
    const grid=new THREE.GridHelper(240,48,0xb8c9ac,0xb8c9ac);grid.position.y=-.17;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.35;this.city.add(grid);
    this.city.add(box(19,.12,205,0xaabf9d,28,-.11,3),box(15,.13,205,0x79b6bb,28,-.04,3));
    for(let z=-94;z<100;z+=9)this.city.add(box(3,.015,.13,0xa0cfd0,26+(Math.sin(z)*3),.04,z));
    for(const road of world.roads)this.drawRoad(road);
    const nodes=new Map<string,{p:Point;width:number;count:number}>();
    for(const road of world.roads)for(const p of [road.points[0],road.points.at(-1)!]){const k=`${p.x.toFixed(1)},${p.z.toFixed(1)}`;const existing=nodes.get(k);if(existing){existing.count++;existing.width=Math.max(existing.width,road.oneWay?road.width/2:road.width);}else nodes.set(k,{p,width:road.oneWay?road.width/2:road.width,count:1});}
    for(const {p,width,count} of nodes.values())if(count>2){const disc=cylinder(width+.05,.025,0x69736e,p.x,p.y+.085,p.z,32);disc.castShadow=false;this.city.add(disc);}
    for(const h of world.houses){
      const group=new THREE.Group();const height=[5.5,8.5,12,4][h.kind],colors=[0xf0eade,0xe5b79c,0xe0e6df,0xa4c0b9];
      group.add(box(8,.25,8,0xd9d7c6,0,.12,0));group.add(box(6.6,height,6,colors[h.kind],0,height/2+.25,0));
      if(h.kind===0||h.kind===3){const roof=new THREE.Mesh(new THREE.CylinderGeometry(0,5.2,2.3,4),mat(h.kind===0?0xa86f55:0x648b81));roof.rotation.y=Math.PI/4;roof.position.y=height+1.3;roof.scale.z=.93;roof.castShadow=true;group.add(roof);}else{group.add(box(7,.4,6.5,0xf4eee0,0,height+.4,0));group.add(box(1.4,.8,1.5,0x82918b,1.5,height+1,0));}
      group.add(box(1.15,2,.1,0x5a756c,0,1.3,3.05));group.add(box(2.5,.12,1,0xe7dcca,0,.3,3.7));
      for(let floor=0;floor<Math.floor(height/2.8);floor++)for(const x of [-2,2]){group.add(box(1.1,1.2,.08,0x63898b,x,2+floor*2.8,3.06));group.add(box(.08,1.2,1.1,0x63898b,3.34,2+floor*2.8,x));group.add(box(1.25,.12,.35,0xf4efdd,x,1.36+floor*2.8,3.15));}
      group.position.set(h.x,0,h.z);group.rotation.y=h.angle;this.city.add(group);
      const q=world.nearest(pt(h.x,h.z));if(q)this.city.add(ribbon([pt(h.x,h.z),q.point],6.4,0xb5b6a6,.025));
    }
    let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<260;i++){
      const p=pt((random()-.5)*215,(random()-.5)*177),r=1.2+random()*1.2,q=world.nearest(p);
      if(Math.abs(p.x-28)<13||q&&q.distance<q.road.width*(q.road.oneWay?.5:1)+4||world.houses.some(h=>Math.hypot(h.x-p.x,h.z-p.z)<7))continue;
      this.tree(p.x,p.z,r,random()>.5?0x7f9f6a:0x93ad77);
    }
    // Little planted islands make circular junctions immediately legible.
    for(const [x,z] of [[-16,0]])if(world.roads.some(r=>r.oneWay&&dist(r.points[0],pt(x,z))<15)){this.city.add(cylinder(6.9,.22,0xacc28d,x,.12,z,40));this.city.add(cylinder(2.3,.5,0xe2ddc7,x,.35,z));this.city.add(cylinder(1.9,.4,0x90bcc0,x,.65,z));this.tree(x-3,z-2,1.6,0x769864);this.tree(x+3,z+2,1.3,0x8aa66b);}
    world.lights.forEach((light,index)=>{
      for(const vertical of [false,true]){
        const x=light.x+(vertical?-6:6),z=light.z+(vertical?6:-6);this.city.add(cylinder(.13,4,0x475550,x,2,z));this.city.add(box(.65,1.4,.5,0x34433e,x,4.1,z));
        const lens=new THREE.Mesh(new THREE.SphereGeometry(.2,8,8),new THREE.MeshStandardMaterial({color:0xe85645,emissive:0xe85645,emissiveIntensity:1}));(lens.material as THREE.Material).userData.transient=true;lens.position.set(x,4.3,z+.3);this.city.add(lens);this.signalMeshes.push({mesh:lens,index,vertical});
        if(light.phases){
          for(const [i,turn] of (['left','straight','right'] as const).entries()){
            const shape=new THREE.Shape();shape.moveTo(-.14,-.08);shape.lineTo(.03,-.08);shape.lineTo(.03,-.16);shape.lineTo(.22,0);shape.lineTo(.03,.16);shape.lineTo(.03,.08);shape.lineTo(-.14,.08);shape.closePath();
            const material=new THREE.MeshStandardMaterial({color:0xf26352,emissive:0xf26352,emissiveIntensity:1});material.userData.transient=true;
            const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),material);arrow.rotation.z=turn==='left'?Math.PI:turn==='straight'?Math.PI/2:0;arrow.position.set(x+(i-1)*.48,3.7,z+.31);this.city.add(arrow);this.signalMeshes.push({mesh:arrow,index,vertical,turn});
          }
        }

      }
    });
  }
  tree(x:number,z:number,r:number,color:number){this.city.add(cylinder(.2,2.3,0x8b7960,x,1.15,z,6));const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),mat(color));crown.scale.y=1.35;crown.position.set(x,3+r*.4,z);crown.castShadow=true;this.city.add(crown);}
  drawRoad(road:Road){
    const width=road.oneWay?road.width:road.width*2;
    this.city.add(ribbon(road.points,width+1.3,0xd3d3c6,.035),ribbon(road.points,width,0x69736e,.07));
    for(const side of [-1,1])this.city.add(ribbon(offsetPath(road.points,side*(width/2-.25)),.12,0xdedfd1,.088));
    if(!road.oneWay){let traveled=0;for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i];traveled+=dist(a,b);if(Math.floor(traveled/3)%2===0)this.city.add(ribbon([a,b],.13,0xead9a4,.09));}}
    if(road.points.some(p=>p.y>1)){
      for(const side of [-1,1]){const path=offsetPath(road.points,side*(width/2+.25));this.city.add(ribbon(path.filter(p=>p.y>.5),.2,0xf1e9d4,1));path.forEach((p,i)=>{if(i%3===0&&p.y>.6)this.city.add(box(.16,1,.16,0xe7dfcc,p.x,p.y+.5,p.z));});}
      road.points.forEach((p,i)=>{if(i%6===0&&p.y>2)this.city.add(box(width*.8,p.y,1.3,0xc3c5b8,p.x,p.y/2,p.z));});
    }
  }
  makeVehicle(v:Vehicle){
    const g=new THREE.Group(),s=SPECS[v.kind];const palette=[0xf2eee2,0xdf8b69,0x74a8ad,0xe4bc66,0x677e91],color=v.kind==='car'?palette[v.id%palette.length]:s.color;
    g.userData.vehicleId=v.id;
    if(v.kind==='bike'){
      g.add(box(.55,.55,1.4,color,0,.65,0));g.add(box(.45,.2,.7,0x394740,0,.98,-.1));g.add(box(.55,.7,.4,0x506866,0,1.3,-.15));g.add(cylinder(.27,.35,v.id%2?0xf0e1b6:0xe3a985,0,1.85,-.12));g.add(box(.9,.07,.12,0x34453e,0,1.13,.55));
      for(const z of [-.7,.7]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.18,10),mat(0x303a34));wheel.rotation.z=Math.PI/2;wheel.position.set(0,.34,z);if(z>0)wheel.name='front-wheel';g.add(wheel);}
    }else{
      g.add(box(s.width,.65,s.length,color,0,.75,0));
      if(v.kind==='car'){g.add(box(s.width*.84,.65,s.length*.49,color,0,1.36,-.15));g.add(box(s.width*.77,.42,.1,0x6a9296,0,1.42,.86));g.add(box(s.width*.77,.4,.1,0x6a9296,0,1.42,-1.17));for(const x of [-s.width*.427,s.width*.427])g.add(box(.04,.4,1.5,0x6a9296,x,1.42,-.15));}
      else{g.add(box(s.width*.97,2.1,4.1,0xe9e3d3,0,1.7,-.8));g.add(box(s.width,.9,1.65,color,0,1.5,2.25));g.add(box(s.width*.85,.6,.06,0x648b91,0,1.6,3.09));}
      for(const x of [-s.width/2+.13,s.width/2-.13])for(const z of [-s.length*.31,s.length*.31]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.25,10),mat(0x344039));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.4,z);if(z>0)wheel.name='front-wheel';g.add(wheel);}
      for(const x of [-s.width*.33,s.width*.33]){g.add(box(.3,.18,.05,0xfff0c5,x,.85,s.length/2+.03));g.add(box(.3,.17,.05,0xbf5d4f,x,.85,-s.length/2-.03));}
    }
    const lamp=(name:string,color:number,x:number,z:number,w=.2)=>{
      const material=new THREE.MeshBasicMaterial({color,toneMapped:false});material.userData.transient=true;
      const light=new THREE.Mesh(new THREE.BoxGeometry(w,.14,.07),material);light.name=name;light.position.set(x,v.kind==='bike'?.8:.9,z);g.add(light);
    };
    for(const side of [-1,1]){
      const x=side*s.width*.36;
      lamp('brake',0xff2929,x,-s.length/2-.05);
      lamp('reverse',0xf5ffff,x*.55,-s.length/2-.08,.12);
      for(const z of [-s.length/2-.09,s.length/2+.05])lamp(side>0?'indicator-left':'indicator-right',0xffad18,x,z,.14);
    }
    const wire=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.width+.16,2.1,s.length+.16)),new THREE.LineBasicMaterial({color:0xecae46}));(wire.material as THREE.Material).userData.transient=true;wire.position.y=1.1;wire.name='collision';wire.visible=this.debug;g.add(wire);g.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.cars.add(g);this.carMeshes.set(v.id,g);return g;
  }
  update(sim:Simulation,alpha=1){
    const ids=new Set(sim.vehicles.map(v=>v.id));for(const [id,g]of this.carMeshes)if(!ids.has(id)){dispose(g);this.cars.remove(g);this.carMeshes.delete(id);}
    for(const v of sim.vehicles){const g=this.carMeshes.get(v.id)??this.makeVehicle(v);const old=g.userData.pose as Pose|undefined,p=v.pose;
      g.visible=!v.inGarage;const blend=old?alpha:1;g.position.lerp(new THREE.Vector3(p.x,p.y+.12,p.z),blend);let angle=p.angle-g.rotation.y;angle=Math.atan2(Math.sin(angle),Math.cos(angle));g.rotation.y+=angle*blend;g.userData.pose=p;g.getObjectByName('collision')!.visible=this.debug;
      g.traverse(child=>{
        if(child.name==='brake')child.visible=!!v.braking;
        if(child.name==='reverse')child.visible=(v.velocity??0)<-.01;
        if(child.name==='indicator-left')child.visible=v.indicator===-1&&Math.floor(sim.time*2.8)%2===0;
        if(child.name==='indicator-right')child.visible=v.indicator===1&&Math.floor(sim.time*2.8)%2===0;
        if(child.name==='front-wheel')child.rotation.y=v.steering??0;
      });
      g.rotation.z=v.kind==='bike'?THREE.MathUtils.clamp(-((v.velocity??0)**2)*Math.tan(v.steering??0)/(SPECS.bike.wheelbase*9.81),-.28,.28):0;
      const next=v.route.at(Math.min(v.route.total,v.s+.8)),prev=v.route.at(Math.max(0,v.s-.8));g.rotation.x=Math.atan2(next.y-prev.y,dist(prev,next)||1)*-.8;
    }
    for(const signal of this.signalMeshes){const light=sim.world.lights[signal.index];if(light){const state=signalState(sim.time,light,signal.vertical,signal.turn);const m=signal.mesh.material as THREE.MeshStandardMaterial;m.color.setHex(state==='green'?0x7cda8a:state==='yellow'?0xffc34b:0xf26352);m.emissive.copy(m.color);}}
    const selected=sim.vehicles.find(v=>v.id===this.selectedVehicleId&&!v.inGarage);
    if(!selected)this.selectedVehicleId=null;
    this.selectionRing.visible=!!selected;
    if(selected){
      const spec=SPECS[selected.kind];
      this.selectionRing.position.set(selected.pose.x,selected.pose.y+.2,selected.pose.z);
      this.selectionRing.rotation.y=selected.pose.angle;
      this.selectionRing.scale.set(spec.width/2+.65,1,spec.length/2+.65);
    }
    this.steeringGuide.update(selected);
    this.blockage.update(selected,sim.vehicles);
    this.directions.update(selected?[selected]:sim.vehicles.filter(v=>!v.inGarage),!!selected||this.showDirections);
    this.controls.update();this.renderer.render(this.scene,this.camera);
  }
  preview(points:Point[],width:number,valid=true){dispose(this.ghost);if(points.length>1){const mesh=ribbon(points,width*2,valid?0x60b69a:0xe79c70,.2);mesh.material=new THREE.MeshStandardMaterial({color:valid?0x60b69a:0xe79c70,transparent:true,opacity:.65});mesh.material.userData.transient=true;this.ghost.add(mesh);}for(const p of [points[0],points.at(-1)])if(p){const m=cylinder(.75,.2,0xfff5d7,p.x,p.y+.3,p.z);this.ghost.add(m);}}
}
