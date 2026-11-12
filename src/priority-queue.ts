/** Stable minimum heap. Stale entries are discarded by the route search. */
export class PriorityQueue<T> {
  private items:{value:T;cost:number;order:number}[]=[];
  private order=0;
  get size(){return this.items.length;}
  private before(a:{cost:number;order:number},b:{cost:number;order:number}){return a.cost<b.cost||a.cost===b.cost&&a.order<b.order;}
  push(value:T,cost:number){
    const item={value,cost,order:this.order++};let i=this.items.length;this.items.push(item);
    while(i>0){const parent=(i-1)>>1;if(!this.before(item,this.items[parent]))break;this.items[i]=this.items[parent];i=parent;}
    this.items[i]=item;
  }
  pop(){
    const first=this.items[0],last=this.items.pop()!;
    if(this.items.length){
      let i=0;
      while(i*2+1<this.items.length){
        let child=i*2+1;
        if(child+1<this.items.length&&this.before(this.items[child+1],this.items[child]))child++;
        if(!this.before(this.items[child],last))break;
        this.items[i]=this.items[child];i=child;
      }
      this.items[i]=last;
    }
    return first;
  }
}
