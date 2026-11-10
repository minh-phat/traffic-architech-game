import { Simulation } from './simulation';

/** Half-second checkpoints, bounded to five minutes of simulation time. */
export class Timeline {
  private frames:ReturnType<Simulation['snapshot']>[]=[];
  private cursor=0;
  constructor(private sim:Simulation){this.reset();}
  get start(){return this.frames[0].time;}
  get end(){return this.frames.at(-1)!.time;}
  reset(){this.frames=[this.sim.snapshot()];this.cursor=0;}
  record(){
    if(this.sim.time<this.frames[this.cursor].time-1e-6){this.reset();return;}
    if(this.sim.time<=this.frames[this.cursor].time+1e-6)return;
    // Continuing from an older checkpoint starts a new future.
    this.frames.length=this.cursor+1;
    if(this.sim.time-this.end<.5-1e-6)return;
    this.frames.push(this.sim.snapshot());
    if(this.frames.length>601)this.frames.shift();
    this.cursor=this.frames.length-1;
  }
  seek(time:number){
    if(!Number.isFinite(time))return;
    let index=0;
    for(let i=1;i<this.frames.length;i++){
      if(Math.abs(this.frames[i].time-time)<Math.abs(this.frames[index].time-time))index=i;
    }
    this.cursor=index;this.sim.restore(this.frames[index]);this.sim.paused=true;
  }
}
