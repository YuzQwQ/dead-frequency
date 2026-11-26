import { bounds } from './sector.ts';
import type { Point, Solid } from './sector.ts';

const EPSILON = .0001;

export class Collision {
  constructor(readonly solids:Solid[]) {}

  floor(x:number,z:number,radius:number,limit:number) {
    let height=0;
    for (const box of this.solids) {
      const top=box.y+box.h;
      if (top<=height || top>limit+EPSILON) continue;
      const dx=Math.max(0,Math.abs(x-box.x)-box.w/2);
      const dz=Math.max(0,Math.abs(z-box.z)-box.d/2);
      if (dx*dx+dz*dz<radius*radius) height=top;
    }
    return height;
  }

  blocked(x:number,z:number,radius:number,feet=0,height=1.72) {
    for (const box of this.solids) {
      if (feet >= box.y+box.h-EPSILON || feet+height <= box.y+EPSILON) continue;
      const dx = Math.max(0,Math.abs(x-box.x)-box.w/2);
      const dz = Math.max(0,Math.abs(z-box.z)-box.d/2);
      if (dx*dx+dz*dz<radius*radius) return true;
    }
    return false;
  }

  slide(point:Point,dx:number,dz:number,radius:number,feet=0,height=1.72) {
    if (!this.blocked(point.x+dx,point.z,radius,feet,height)) point.x += dx;
    if (!this.blocked(point.x,point.z+dz,radius,feet,height)) point.z += dz;
  }

  clearPath(x:number,z:number,tx:number,tz:number,radius:number) {
    const segments = Math.ceil(Math.hypot(tx-x,tz-z)/.6);
    for (let i=1;i<=segments;i++) {
      const t = i/segments;
      if (this.blocked(x+(tx-x)*t,z+(tz-z)*t,radius)) return false;
    }
    return true;
  }

  cast(x:number,y:number,z:number,dx:number,dy:number,dz:number,range:number) {
    let distance = range;
    let hit:Solid | null = null;
    const ix = 1/(Math.abs(dx)<1e-9 ? 1e-9 : dx);
    const iy = 1/(Math.abs(dy)<1e-9 ? 1e-9 : dy);
    const iz = 1/(Math.abs(dz)<1e-9 ? 1e-9 : dz);
    for (const solid of this.solids) {
      const ax=(solid.x-solid.w/2-x)*ix, bx=(solid.x+solid.w/2-x)*ix;
      const ay=(solid.y-y)*iy, by=(solid.y+solid.h-y)*iy;
      const az=(solid.z-solid.d/2-z)*iz, bz=(solid.z+solid.d/2-z)*iz;
      const near=Math.max(Math.min(ax,bx),Math.min(ay,by),Math.min(az,bz),0);
      const far=Math.min(Math.max(ax,bx),Math.max(ay,by),Math.max(az,bz));
      if (near>far || near>=distance) continue;
      distance=near;
      hit=solid;
    }
    return {distance,hit};
  }

  visible(x:number,y:number,z:number,tx:number,ty:number,tz:number) {
    const dx=tx-x,dy=ty-y,dz=tz-z;
    const range=Math.hypot(dx,dy,dz);
    return range<=.015 || !this.cast(x,y,z,dx/range,dy/range,dz/range,range-.015).hit;
  }
}

const CELL = 1.5;
const WIDTH = Math.floor(bounds*2/CELL);
const NODES = WIDTH*WIDTH;
const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
const cell = (value:number) => Math.min(WIDTH-1,Math.max(0,Math.floor((value+bounds)/CELL)));

export class Navigator {
  private clear = new Uint8Array(NODES);
  private costs = new Float32Array(NODES);
  private parents = new Int32Array(NODES);
  private closed = new Uint8Array(NODES);

  constructor(collision:Collision) {
    for (let id=0;id<NODES;id++) {
      const p=this.position(id);
      this.clear[id]=collision.blocked(p.x,p.z,.56) ? 0 : 1;
    }
  }

  private position(id:number):Point {
    return {x:(id%WIDTH+.5)*CELL-bounds,z:(Math.floor(id/WIDTH)+.5)*CELL-bounds};
  }

  private nearest(p:Point) {
    const x=cell(p.x), z=cell(p.z);
    let closest=-1, distance=Infinity;
    for (let dz=-2;dz<=2;dz++) for (let dx=-2;dx<=2;dx++) {
      const nx=x+dx,nz=z+dz;
      if (nx<0 || nx>=WIDTH || nz<0 || nz>=WIDTH) continue;
      const id=nz*WIDTH+nx;
      if (!this.clear[id]) continue;
      const point=this.position(id), d=Math.hypot(point.x-p.x,point.z-p.z);
      if (d<distance) { closest=id; distance=d; }
    }
    return closest;
  }

  path(from:Point,to:Point):Point[] {
    const start=this.nearest(from), end=this.nearest(to);
    if (start<0 || end<0 || start===end) return [];
    this.costs.fill(Infinity);
    this.parents.fill(-1);
    this.closed.fill(0);
    this.costs[start]=0;
    const goalX=end%WIDTH, goalZ=Math.floor(end/WIDTH);
    const open=[{id:start,score:0}];
    while (open.length) {
      let best=0;
      for (let i=1;i<open.length;i++) if (open[i].score<open[best].score) best=i;
      const {id}=open[best];
      open[best]=open[open.length-1];
      open.pop();
      if (this.closed[id]) continue;
      if (id===end) {
        const path:Point[]=[];
        for (let cursor=id;cursor>=0;cursor=this.parents[cursor]) path.push(this.position(cursor));
        return path.reverse();
      }
      this.closed[id]=1;
      const x=id%WIDTH,z=Math.floor(id/WIDTH);
      for (const [dx,dz] of directions) {
        const nx=x+dx,nz=z+dz;
        if (nx<0 || nx>=WIDTH || nz<0 || nz>=WIDTH) continue;
        const next=nz*WIDTH+nx;
        if (!this.clear[next] || this.closed[next]) continue;
        if (dx && dz && (!this.clear[z*WIDTH+nx] || !this.clear[nz*WIDTH+x])) continue;
        const cost=this.costs[id]+(dx && dz ? Math.SQRT2 : 1);
        if (cost>=this.costs[next]) continue;
        this.costs[next]=cost;
        this.parents[next]=id;
        open.push({id:next,score:cost+Math.hypot(nx-goalX,nz-goalZ)});
      }
    }
    return [];
  }
}
