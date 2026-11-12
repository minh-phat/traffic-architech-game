/** Broad phase only: callers still perform exact distance/body checks. */
export class SpatialGrid<T> {
  private cells=new Map<string,T[]>();
  constructor(private size=12){}
  insert(item:T,x:number,z:number){
    const key=`${Math.floor(x/this.size)},${Math.floor(z/this.size)}`;
    const bucket=this.cells.get(key);
    if(bucket)bucket.push(item);else this.cells.set(key,[item]);
  }
  query(x:number,z:number,radius:number):T[]{
    const result:T[]=[];
    for(let i=Math.floor((x-radius)/this.size);i<=Math.floor((x+radius)/this.size);i++)
      for(let j=Math.floor((z-radius)/this.size);j<=Math.floor((z+radius)/this.size);j++){
        const bucket=this.cells.get(`${i},${j}`);if(bucket)result.push(...bucket);
      }
    return result;
  }
}
