import { enemyTypes, weapons } from './data.ts';
import { protectedDamage, scavKit } from './inventory.ts';
import type { Kit } from './inventory.ts';
import type { EnemyKind } from './data.ts';
import { enemySites } from './sector.ts';
import type { EnemySite, Point } from './sector.ts';
import type { ActorModel } from './assets.ts';
import type { Collision, Navigator } from './collision.ts';
import type { Player } from './player.ts';
import type { Audio } from './audio.ts';
import type { View } from './view.ts';

type State = 'patrol'|'investigate'|'chase'|'aim'|'attack'|'dead';
type Noise = Point & {radius:number; time:number};
const angleDiff=(a:number,b:number) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
const heading=(dx:number,dz:number) => Math.atan2(-dx,-dz);

class Enemy {
  x:number; z:number; yaw:number;
  model:ActorModel;
  hp:number;
  state:State='patrol';
  hitTime=0;
  flashTime=0;
  deadTime=0;
  aimTime=0;
  cooldown=0;
  alert=0;
  sound=0;
  phase=0;
  patrol=0;
  wait=0;
  moved=0;
  last:Point;
  route:Point[]=[];
  nextPath=0;
  burst=0;
  kit?:Kit;

  constructor(readonly site:EnemySite,readonly kind:EnemyKind,view:View,index:number,collision:Collision) {
    this.x=site.x;this.z=site.z;this.yaw=site.heading;
    const offset=(Math.random()-.5)*1.55;
    if (kind==='scav') {
      let seed=(Math.floor((offset+.775)*1e8)^index)>>>0;
      this.kit=scavKit('scav-'+index,()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296));
    }
    if (!collision.blocked(this.x+offset,this.z-offset,.46)) { this.x+=offset;this.z-=offset; }
    this.last={x:this.x,z:this.z};
    this.hp=enemyTypes[kind].hp;
    this.model=view.assets.actor(kind);
    this.model.root.position.set(this.x,0,this.z);
    this.model.root.rotation.y=this.yaw;
    this.nextPath=index*.032;
    view.dynamic.add(this.model.root);
  }
}

export class Enemies {
  readonly units:Enemy[];
  private noise:Noise={x:0,z:0,radius:0,time:-100};

  constructor(private view:View,private collision:Collision,private nav:Navigator,private audio:Audio,
    private onDeath:(kind:EnemyKind,x:number,z:number,kit?:Kit)=>void,
    private onHurt:(damage:number,label:string,region?:'head'|'body')=>void, private caption:(text:string,origin:Point)=>void) {
    // The warehouse, lab and both exits always have a threat nearby. Other patrols vary.
    this.units=enemySites.flatMap((site,i) => [0,1,4,5,6,8].includes(i) || Math.random()>.33
      ? [new Enemy(site,site.kind,view,i,collision)] : []);
  }

  dispose() { for (const unit of this.units) unit.model.root.removeFromParent(); }

  alert(x:number,z:number,radius:number,time:number) { Object.assign(this.noise,{x,z,radius,time}); }

  private move(unit:Enemy,target:Point,dt:number,pace:number) {
    const def=enemyTypes[unit.kind];
    const distance=Math.hypot(target.x-unit.x,target.z-unit.z);
    if (distance<.28) return;
    let next=target;
    if (!this.collision.clearPath(unit.x,unit.z,target.x,target.z,def.radius+.10)) {
      if (unit.nextPath<=0) {
        unit.route=this.nav.path(unit,target);
        unit.nextPath=.49+Math.random()*.23;
      }
      while (unit.route.length && Math.hypot(unit.route[0].x-unit.x,unit.route[0].z-unit.z)<.50) unit.route.shift();
      if (!unit.route.length) return;
      next=unit.route[0];
    }
    const dx=next.x-unit.x,dz=next.z-unit.z;
    const len=Math.hypot(dx,dz);
    if (len<.015) return;
    unit.yaw+=angleDiff(heading(dx,dz),unit.yaw)*Math.min(1,dt*9);
    const beforeX=unit.x,beforeZ=unit.z;
    this.collision.slide(unit,dx/len*Math.min(len,dt*pace),dz/len*Math.min(len,dt*pace),def.radius);
    unit.moved=Math.hypot(unit.x-beforeX,unit.z-beforeZ)/dt;
  }

  private pose(unit:Enemy,dt:number) {
    const {root,torso,head,limbs,hit,flash}=unit.model;
    root.position.set(unit.x,0,unit.z);
    root.rotation.y=unit.yaw;
    hit.visible=unit.hitTime>0;
    flash.visible=unit.flashTime>0;
    if (unit.state==='dead') {
      const ease=1-Math.pow(1-Math.min(1,unit.deadTime/.43),3);
      root.rotation.z=-ease*1.55; root.position.y=ease*.22;
      return;
    }
    const echo=unit.kind==='echo', moving=Math.min(unit.moved/2.1,1);
    const attack=unit.state==='attack';
    unit.phase+=dt*(3+unit.moved*2.9);
    const cycle=Math.sin(unit.phase)*moving;
    torso.rotation.x=(echo ? -.18-moving*.12 : moving*.07)+(attack && echo ? -.20 : 0);
    torso.position.y=(echo ? .77 : .94)+Math.abs(cycle)*.035;
    torso.rotation.z=unit.hitTime*.75+cycle*.029;
    head.rotation.x=echo ? -.18+Math.sin(unit.phase*.4)*.13 : 0;
    const ready=unit.state==='aim' || attack || unit.state==='chase';
    for (let i=0;i<2;i++) {
      const direction=i===0 ? 1 : -1;
      limbs[i*2+1].rotation.x=cycle*direction*(echo ? .67 : .42);
      limbs[i*2].rotation.x=echo ? (attack ? -1.36 : -.42-cycle*direction*.55) : (ready ? -1.23 : -.68)-cycle*direction*.15;
      limbs[i*2].rotation.z=direction*(echo ? .26 : .10);
    }
  }

  update(dt:number,time:number,player:Player) {
    for (const unit of this.units) {
      unit.hitTime=Math.max(0,unit.hitTime-dt);
      unit.flashTime=Math.max(0,unit.flashTime-dt);
      if (unit.state==='dead') {
        if (unit.deadTime<.5) { unit.deadTime+=dt;this.pose(unit,dt); }
        continue;
      }
      const def=enemyTypes[unit.kind], echo=unit.kind==='echo';
      unit.nextPath-=dt;
      unit.cooldown-=dt;
      unit.sound-=dt;
      unit.moved=0;
      const dx=player.x-unit.x,dz=player.z-unit.z,dist=Math.hypot(dx,dz);
      const face=heading(dx,dz);
      const eye=echo ? 1.03 : 1.55;
      const inSight=dist<def.view*(player.crouched ? .78 : 1) &&
        (dist<3.25 || echo || unit.alert>0 || Math.abs(angleDiff(face,unit.yaw))<1.10);
      const seen=inSight && this.collision.visible(unit.x,eye,unit.z,player.x,player.eyeY-.17,player.z);
      const heard=time-this.noise.time<.32 &&
        Math.hypot(unit.x-this.noise.x,unit.z-this.noise.z)<Math.min(this.noise.radius*(echo?1.4:1),def.hearing);
      unit.alert=Math.max(0,unit.alert-dt);
      if (seen) {
        if (!unit.alert) {
          this.audio.play(echo ? 'echo' : 'scav',unit);
          this.caption(echo ? '回响体发出尖鸣' : '拾荒者发现了你',unit);
        }
        unit.alert=echo ? 6.5 : 7.5;
        unit.last.x=player.x;unit.last.z=player.z;
      } else if (heard) {
        unit.alert=Math.max(unit.alert,echo?5:4);
        unit.last.x=this.noise.x;unit.last.z=this.noise.z;
      }
      if (seen && dist<def.range) {
        unit.yaw+=angleDiff(face,unit.yaw)*Math.min(1,dt*14);
        if (echo) {
          if (unit.state!=='attack') { unit.state='attack';unit.aimTime=.25; }
          unit.aimTime-=dt;
          if (unit.aimTime<=0 && unit.cooldown<=0 && player.hp>0) {
            unit.cooldown=1.08;
            unit.aimTime=.52;
            this.audio.play('echo',unit);
            this.onHurt(def.damage,'回响体');
          }
        } else {
          if (unit.state!=='aim' && unit.state!=='attack') {
            unit.aimTime=dist<6 ? .57 : .76;
            unit.state='aim';unit.burst=2+Math.floor(Math.random()*2);
          }
          unit.aimTime-=dt;
          if (unit.aimTime<=0 && unit.cooldown<=0 && player.hp>0) {
            unit.state='attack';
            unit.flashTime=.075;
            const rifle=unit.kit?.gear.primary;
            if (rifle) rifle.rounds=(rifle.rounds || weapons.ar56.capacity)-1;
            this.audio.gun('ar56',unit);
            const hit=Math.random()<Math.max(.25,.89-dist*.027-player.speed*.026-(player.crouched?.11:0));
            const head=hit && ((unit.phase*997)%1)<.10;
            const tx=player.x+(hit ? 0 : (Math.random()>.5 ? 1 : -1)*(.45+Math.random()*.8));
            const tz=player.z+(hit ? 0 : (Math.random()-.5)*.7);
            const ty=player.eyeY-(hit ? head ? .025 : .23 : (Math.random()-.25)*1.6);
            const td=Math.hypot(tx-unit.x,ty-eye,tz-unit.z);
            const block=this.collision.cast(unit.x,eye,unit.z,(tx-unit.x)/td,(ty-eye)/td,(tz-unit.z)/td,td);
            const frac=block.distance/td;
            this.view.tracer(unit.x,eye,unit.z,unit.x+(tx-unit.x)*frac,eye+(ty-eye)*frac,unit.z+(tz-unit.z)*frac);
            if (hit && !block.hit) this.onHurt(def.damage*(head ? 1.7 : 1),'拾荒者',head?'head':'body');
            if (--unit.burst===0) { unit.cooldown=1.35+Math.random()*.55;unit.burst=2+Math.floor(Math.random()*2); }
            else unit.cooldown=.20;
          }
          if (dist>.01 && dist<5.5) {
            const back={x:unit.x-dx/dist*2.2,z:unit.z-dz/dist*2.2};
            if (this.collision.clearPath(unit.x,unit.z,back.x,back.z,.48)) {
              this.collision.slide(unit,-dx/dist*dt*1.7,-dz/dist*dt*1.7,def.radius);
              unit.moved=1.7;
            }
          }
        }
      } else if (unit.alert>0) {
        unit.state=seen ? 'chase' : 'investigate';
        if (Math.hypot(unit.last.x-unit.x,unit.last.z-unit.z)>.68) this.move(unit,unit.last,dt,def.pace);
        else unit.yaw+=dt*(echo?2.0:1.23);
      } else {
        unit.state='patrol';
        unit.wait-=dt;
        const a=unit.patrol*.94+unit.site.heading;
        const wander={x:unit.site.x+Math.cos(a)*2.4,z:unit.site.z+Math.sin(a)*2.4};
        if (unit.wait<=0) {
          if (this.collision.blocked(wander.x,wander.z,.49) || Math.hypot(wander.x-unit.x,wander.z-unit.z)<.55) {
            unit.patrol++;unit.wait=.48+Math.random()*1.3;
          } else this.move(unit,wander,dt,echo ? 1.45 : 1.18);
        }
      }
      if (unit.moved>.8 && dist<12 && unit.sound<=0) {
        unit.sound=echo?.49:.7;
        this.audio.play(echo ? 'metalStep' : 'step',unit);
      }
      this.pose(unit,dt);
    }
  }

  hitRay(x:number,y:number,z:number,dx:number,dy:number,dz:number,range:number) {
    let victim:Enemy|undefined;
    let length=range, headshot=false;
    for (const unit of this.units) {
      if (unit.state==='dead') continue;
      const echo=unit.kind==='echo';
      for (const [height,radius,isHead] of [[echo?1.21:1.58,.235,true],[echo?.87:1.14,.37,false],[.51,.32,false]] as const) {
        const ax=unit.x-x,ay=height-y,az=unit.z-z;
        const dot=ax*dx+ay*dy+az*dz;
        if (dot<0 || dot>length+radius) continue;
        const closest=ax*ax+ay*ay+az*az-dot*dot;
        if (closest>radius*radius) continue;
        const t=dot-Math.sqrt(radius*radius-closest);
        if (t<0 || t>=length) continue;
        victim=unit;length=t;headshot=isHead;
      }
    }
    return victim ? {victim,length,headshot} : null;
  }

  damage(unit:Enemy,amount:number,origin:Point,region:'head'|'body'='body') {
    if (unit.state==='dead') return;
    unit.hitTime=.17;
    unit.hp-=unit.kit ? protectedDamage(unit.kit,amount,region) : amount;
    unit.alert=7;
    unit.last.x=origin.x;unit.last.z=origin.z;
    if (unit.hp<=0) {
      unit.state='dead';unit.flashTime=0;
      this.onDeath(unit.kind,unit.x,unit.z,unit.kit);
    }
  }
}
