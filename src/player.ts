import { healing } from './data.ts';
import { kitWeight, protectedDamage, quickGrids, remove } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';
import type { Input } from './input.ts';
import type { Collision } from './collision.ts';
import type { Settings } from './save.ts';
import type { Point } from './sector.ts';

const RADIUS=.31;
const clamp=(value:number,min:number,max:number) => Math.min(max,Math.max(min,value));
const damp=(a:number,b:number,speed:number,dt:number) => a+(b-a)*(1-Math.exp(-speed*dt));

export class Player {
  x:number;
  z:number;
  feet=0;
  yaw:number;
  pitch=0;
  hp=100;
  stamina=100;
  ads=0;
  sprint=0;
  kick=0;
  flashlight=false;
  crouched=false;
  speed=0;
  phase=0;
  step=false;
  landed=false;
  damaged=0;
  private eye=1.64;
  private vx=0;
  private vz=0;
  private vy=0;
  private grounded=true;
  private tired=false;
  private stepDistance=0;
  private burden=0;

  constructor(start:Point & {heading:number},readonly kit:Kit) {
    this.x=start.x;this.z=start.z;this.yaw=start.heading;
    this.updateLoad();
  }

  updateLoad() { this.burden=clamp((kitWeight(this.kit)-14)/30,0,1); }

  get eyeY() { return this.feet+this.eye; }
  get bodyHeight() { return this.crouched ? 1.20 : 1.76; }
  get walking() { return this.speed>.4; }

  look(input:Input,sensitivity:number) {
    this.yaw=(this.yaw-input.dx*.00215*sensitivity)%(Math.PI*2);
    this.pitch=clamp(this.pitch-input.dy*.00192*sensitivity,-1.43,1.43);
    input.dx=input.dy=0;
  }

  private moveAxis(collision:Collision,x:number,z:number) {
    if (x===this.x && z===this.z) return;
    let feet=this.feet;
    if (collision.blocked(x,z,RADIUS,feet,this.bodyHeight)) {
      if (!this.grounded) return;
      const step=collision.floor(x,z,RADIUS,feet+.21);
      if (step<=feet || collision.blocked(x,z,RADIUS,step,this.bodyHeight)) return;
      feet=step;
    }
    this.x=x;this.z=z;this.feet=feet;
  }

  update(dt:number,input:Input,collision:Collision,aim=input.aim,allowSprint=true) {
    const duck=input.down.has('KeyC') || input.down.has('ControlLeft') || input.down.has('ControlRight');
    this.crouched=duck || (this.crouched && collision.blocked(this.x,this.z,RADIUS,this.feet,1.76));
    const fwd=Number(input.down.has('KeyW'))-Number(input.down.has('KeyS'));
    const strafe=Number(input.down.has('KeyD'))-Number(input.down.has('KeyA'));
    const length=Math.max(1,Math.hypot(fwd,strafe));
    const sprinting=allowSprint && !this.crouched && !aim && !this.tired && this.stamina>0 && fwd>0 &&
      (input.down.has('ShiftLeft') || input.down.has('ShiftRight'));
    const pace=this.crouched ? 2.05 : sprinting ? 6.15*(1-.12*this.burden) : aim ? 2.75 : 4.05;
    const sin=Math.sin(this.yaw),cos=Math.cos(this.yaw);
    this.vx=damp(this.vx,pace*(strafe*cos-fwd*sin)/length,19,dt);
    this.vz=damp(this.vz,pace*(-strafe*sin-fwd*cos)/length,19,dt);
    const prevX=this.x,prevZ=this.z;
    this.moveAxis(collision,this.x+this.vx*dt,this.z);
    this.moveAxis(collision,this.x,this.z+this.vz*dt);
    const distance=Math.hypot(this.x-prevX,this.z-prevZ);
    this.speed=distance/dt;
    const jump=input.pop('Space') && this.grounded && !this.crouched && this.stamina>=12;
    if (jump) { this.vy=5.05;this.grounded=false;this.stamina-=12; }
    this.vy-=17.5*dt;
    const nextFeet=this.feet+this.vy*dt;
    this.landed=false;
    const support=collision.floor(this.x,this.z,RADIUS,this.feet);
    if (this.vy<=0 && nextFeet<=support) {
      this.landed=!this.grounded && this.vy<-.7;
      this.grounded=true;
      this.feet=support;
      this.vy=0;
    } else if (this.vy>0 && collision.blocked(this.x,this.z,RADIUS,nextFeet,this.bodyHeight)) {
      this.vy=0;
    } else {
      this.feet=nextFeet;
      this.grounded=false;
    }
    this.stamina=clamp(this.stamina+(sprinting && this.walking ? -24*(1+.3*this.burden) : 17)*dt,0,100);
    if (this.stamina===0) this.tired=true;
    if (this.stamina>24) this.tired=false;
    this.ads=damp(this.ads,aim && !sprinting ? 1 : 0,13,dt);
    this.sprint=damp(this.sprint,sprinting && this.walking ? 1 : 0,12,dt);
    this.kick=damp(this.kick,0,13,dt);
    this.damaged=Math.max(0,this.damaged-dt*1.8);
    this.eye=damp(this.eye,this.crouched ? 1.08 : 1.64,17,dt);
    this.step=false;
    if (this.grounded && distance>.001) {
      this.phase+=distance*(sprinting ? 4.3 : 5.0);
      this.stepDistance+=distance;
      const stride=sprinting ? 1.75 : this.crouched ? 1.32 : 1.48;
      if (this.stepDistance>=stride) { this.stepDistance-=stride;this.step=true; }
    }
  }

  viewBob(settings:Settings) {
    return settings.bob ? Math.sin(this.phase)*Math.min(this.speed/4,1)*.024*(1-.83*this.ads) : 0;
  }

  hurt(amount:number,region:'head'|'body'='body') {
    amount=protectedDamage(this.kit,amount,region);
    this.hp=Math.max(0,this.hp-amount);
    this.damaged=1;
  }

  heal(id:keyof typeof healing,bound?:Stack) {
    if (this.hp>=100) return false;
    const source=quickGrids(this.kit).find(grid=>grid.some(entry=>entry.id===id && (!bound||entry===bound)));
    if (!source) return false;
    remove(source,bound ?? source.find(entry=>entry.id===id)!,1);
    this.updateLoad();
    this.hp=Math.min(100,this.hp+healing[id]);
    return true;
  }
}
