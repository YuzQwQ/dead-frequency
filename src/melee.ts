import type { Collision } from './collision.ts';

export const knifeName='简易小刀';
export const meleeAttacks={
  light:{damage:20,windup:.10,recovery:.20,reach:1.45,
    yaw:[0,-.16,.16,-.32,.32,-.48,.48],pitch:[0,-.21,.13]},
  heavy:{damage:46,windup:.42,recovery:.50,reach:1.80,
    yaw:[0,-.105,.105],pitch:[0,-.13,.08]},
} as const;
export type MeleeKind=keyof typeof meleeAttacks;
export type MeleeMotion={kind:MeleeKind; side:-1|1; elapsed:number};

export class Melee {
  private motion:MeleeMotion|null=null;
  private nextSide:-1|1=-1;
  private queuedLight=false;

  get active():Readonly<MeleeMotion>|null { return this.motion; }

  get label() {
    const attack=this.motion;
    if (!attack) return '左键轻击 / 右键重击';
    if (attack.kind==='light') return attack.side===-1 ? '左侧轻击' : '右侧轻击';
    return attack.elapsed<meleeAttacks.heavy.windup ? '重击蓄势' : '重刺收势';
  }

  clearQueue() { this.queuedLight=false; }

  step(dt:number,light:boolean,heavy:boolean,impact:(kind:MeleeKind)=>void) {
    const attack=this.motion;
    if (!attack) {
      if (heavy || light) this.start(heavy ? 'heavy' : 'light');
      return;
    }
    const {windup,recovery}=meleeAttacks[attack.kind];
    const end=windup+recovery;
    if (attack.kind==='light' && light && attack.elapsed>=end-.10-1e-9) this.queuedLight=true;
    const previous=attack.elapsed;
    attack.elapsed=Math.min(end,previous+dt);
    if (previous<windup && attack.elapsed>=windup-1e-9) {
      attack.elapsed=Math.max(attack.elapsed,windup);
      impact(attack.kind);
    }
    if (attack.elapsed>=end-1e-9) {
      this.motion=null;
      if (this.queuedLight) this.start('light');
      this.clearQueue();
    }
  }

  private start(kind:MeleeKind) {
    this.motion={kind,side:this.nextSide,elapsed:0};
    if (kind==='light') this.nextSide=this.nextSide===-1 ? 1 : -1;
  }
}

export type MeleeOrigin={x:number; y:number; z:number; yaw:number; pitch:number};
type Trace<T>=(x:number,y:number,z:number,dx:number,dy:number,dz:number,reach:number)=>
  {victim:T;length:number}|null;

export function sweepMelee<T>(kind:MeleeKind,origin:MeleeOrigin,collision:Collision,trace:Trace<T>) {
  const {x,y,z,yaw,pitch}=origin;
  const {reach,yaw:arcs,pitch:tilts}=meleeAttacks[kind];
  let best:{victim:T;x:number;y:number;z:number;length:number}|null=null;
  for (const arc of arcs) {
    for (const tilt of tilts) {
      const elevation=Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch+tilt));
      const horizontal=Math.cos(elevation);
      const dx=-Math.sin(yaw+arc)*horizontal,dy=Math.sin(elevation),dz=-Math.cos(yaw+arc)*horizontal;
      const limit=Math.min(best?.length ?? reach,dy<0 ? -y/dy : reach);
      const wall=collision.cast(x,y,z,dx,dy,dz,limit);
      const target=trace(x,y,z,dx,dy,dz,wall.distance);
      if (!target) continue;
      const length=target.length;
      best={victim:target.victim,x:x+dx*length,y:y+dy*length,z:z+dz*length,length};
    }
  }
  return best;
}
