import { weapons } from './data.ts';
import type { WeaponId } from './data.ts';
import { inventoryCount, spend } from './inventory.ts';
import type { Stack } from './inventory.ts';
import type { Player } from './player.ts';
import type { Input } from './input.ts';
import type { View } from './view.ts';
import type { Enemies } from './enemies.ts';
import type { Collision } from './collision.ts';
import type { Audio } from './audio.ts';
import { Melee, meleeAttacks, sweepMelee } from './melee.ts';
import type { MeleeKind } from './melee.ts';

export class Combat {
  private slot:'primary'|'secondary'|'knife';
  readonly melee=new Melee();
  reload=0;
  flash=0;
  hit=0;
  headshot=false;
  private interval=0;
  private heat=0;
  private pump=0;
  private pumpSound=false;
  private near=0;

  constructor(private player:Player,private view:View,private collision:Collision,private enemies:Enemies,
    private audio:Audio,private message:(text:string)=>void) {
    this.slot=player.kit.gear.primary ? 'primary' : player.kit.gear.secondary ? 'secondary' : 'knife';
  }

  get usingKnife() { return this.slot==='knife'; }
  get entry():Stack|undefined { return this.slot==='knife' ? undefined : this.player.kit.gear[this.slot]; }
  get id() { return this.entry?.id as WeaponId|undefined; }
  get reserve() { return this.id ? inventoryCount(this.player.kit.bag,weapons[this.id].ammo) : 0; }
  get cycling() { return this.pump>0; }

  private select(slot:'primary'|'secondary'|'knife') {
    if (slot===this.slot || this.melee.active) return;
    if (slot!=='knife' && !this.player.kit.gear[slot]) { this.message('该武器槽为空');return; }
    this.slot=slot;
    this.inventoryChanged();
    this.interval=.26;
  }

  inventoryChanged() {
    this.reload=this.pump=this.heat=this.flash=0;
    this.pumpSound=false;
    if (this.slot!=='knife' && !this.entry) {
      const other=this.slot==='primary' ? 'secondary' : 'primary';
      this.slot=this.player.kit.gear[other] ? other : 'knife';
    }
  }

  private startReload(user=true) {
    const id=this.id, entry=this.entry;
    if (!id || !entry || this.reload>0 || this.pump>0 || this.player.sprint>.65) return;
    if ((entry.rounds ?? 0)>=weapons[id].capacity) return;
    if (!this.reserve) {
      if (user) { this.message('没有匹配的备用弹药');this.audio.play('empty'); }
      return;
    }
    this.reload=weapons[id].reload;
    this.audio.reload(id);
  }

  selectFrom(input:Input) {
    if (input.pop('Digit1')) this.select('primary');
    if (input.pop('Digit2')) this.select('secondary');
    if (input.pop('Digit3')) this.select('knife');
    if (input.popWheel() && !this.usingKnife) this.select(this.slot==='primary' ? 'secondary' : 'primary');
  }

  update(dt:number,time:number,input:Input) {
    const shot=input.shot,altShot=input.altShot;
    input.shot=input.altShot=false;
    this.hit=Math.max(0,this.hit-dt);
    const reload=input.pop('KeyR');
    if (this.usingKnife) {
      this.melee.step(dt,shot,altShot,kind=>this.strike(kind,time));
      return;
    }
    const id=this.id, entry=this.entry;
    if (!id || !entry) return;
    const def=weapons[id];
    const p=this.player;
    const probe=this.collision.cast(p.x,p.eyeY,p.z,-Math.sin(p.yaw)*Math.cos(p.pitch),Math.sin(p.pitch),-Math.cos(p.yaw)*Math.cos(p.pitch),1.3);
    this.near+=(Math.max(0,1-probe.distance/1.3)-this.near)*Math.min(1,dt*16);
    this.interval=Math.max(0,this.interval-dt);
    this.heat=Math.max(0,this.heat-dt*2.8);
    this.flash=Math.max(0,this.flash-dt);
    if (this.pump>0) {
      this.pump=Math.max(0,this.pump-dt);
      if (this.pump<.52 && this.pumpSound) { this.audio.play('pump');this.pumpSound=false; }
    }
    if (this.reload>0) {
      this.reload=Math.max(0,this.reload-dt);
      if (id==='p12' && shot && (entry.rounds ?? 0)>0) this.reload=0;
      else if (this.reload===0) {
        const rounds=entry.rounds ?? 0;
        entry.rounds=rounds+spend(this.player.kit.bag,def.ammo,id==='p12' ? 1 : def.capacity-rounds);
        this.audio.play('grab');
        if (id==='p12' && !shot && !input.fire) this.startReload(false);
      }
    }
    if (reload) this.startReload();
    if (this.reload>0 || this.interval>0 || this.player.sprint>.55 || !(shot || (def.automatic && input.fire))) return;
    if (!entry.rounds) {
      if (shot) { this.audio.play('empty');this.message('空仓 · R 装填'); }
      this.interval=.21;
      return;
    }
    entry.rounds--;
    this.interval=def.interval;
    this.flash=.055;
    this.audio.gun(id);
    this.enemies.alert(this.player.x,this.player.z,id==='k9' ? 17 : 30,time);
    this.shoot(id);
    this.heat=Math.min(2.3,this.heat+.53);
    this.player.pitch=Math.min(1.43,this.player.pitch+def.recoil*(1-this.player.ads*.46));
    this.player.kick=Math.min(1.6,this.player.kick+def.recoil*17);
    if (id==='p12') { this.pump=.77; this.pumpSound=true; }
  }

  private shoot(id:WeaponId) {
    const def=weapons[id], p=this.player;
    const x=p.x,y=p.eyeY,z=p.z;
    const spread=def.spread*(1-p.ads*(id==='p12' ? .38 : .76))*(1+p.speed*.092+this.heat*.34)*(p.crouched?.84:1);
    let connected=false;
    for (let i=0;i<def.pellets;i++) {
      const yaw=p.yaw+(Math.random()+Math.random()-1)*spread;
      const pitch=p.pitch+(Math.random()+Math.random()-1)*spread;
      const dx=-Math.sin(yaw)*Math.cos(pitch),dy=Math.sin(pitch),dz=-Math.cos(yaw)*Math.cos(pitch);
      const world=this.collision.cast(x,y,z,dx,dy,dz,def.range);
      const ground=dy<0 ? -y/dy : Infinity;
      const target=this.enemies.hitRay(x,y,z,dx,dy,dz,Math.min(world.distance,ground));
      if (target) {
        const falloff=1-Math.max(0,target.length/def.range-.46)*(id==='p12' ? 1.25 : .62);
        this.enemies.damage(target.victim,def.damage*(target.headshot ? 1.7 : 1)*falloff,p);
        this.hit=.16;
        this.headshot=target.headshot;
        this.view.impact(x+dx*target.length,y+dy*target.length,z+dz*target.length,target.victim.kind==='echo' ? 'echo' : 'enemy');
        connected=true;
      } else if (world.hit || ground<def.range) {
        const length=Math.min(world.distance,ground)-.018;
        this.view.impact(x+dx*length,y+dy*length,z+dz*length,ground<world.distance ? 'concrete' : world.hit!.surface);
      }
    }
    if (connected) this.audio.play('hit');
  }

  private strike(kind:MeleeKind,time:number) {
    const p=this.player;
    this.audio.play(kind==='light' ? 'knifeSwing' : 'knifeThrust');
    this.enemies.alert(p.x,p.z,kind==='light' ? 3.4 : 4.8,time);
    const target=sweepMelee(kind,{x:p.x,y:p.eyeY-.15,z:p.z,yaw:p.yaw,pitch:p.pitch},this.collision,
      (...ray)=>this.enemies.hitRay(...ray));
    if (!target) return;
    this.enemies.damage(target.victim,meleeAttacks[kind].damage,p);
    this.hit=.16;
    this.headshot=false;
    this.view.impact(target.x,target.y,target.z,target.victim.kind==='echo' ? 'echo' : 'enemy');
    this.audio.play('knifeHit');
  }

  render() {
    const id=this.id,p=this.player;
    if (this.usingKnife) {
      this.view.knife(this.melee.active,p.phase,Math.min(p.speed/4,1),p.sprint);
      return;
    }
    const visualReload=id && this.reload>0
      ? .25+.75*Math.sin(this.reload/weapons[id].reload*Math.PI)
      : 0;
    const pump=this.pump>0 ? Math.sin((1-this.pump/.77)*Math.PI) : 0;
    this.view.weapon(id,p.ads,p.sprint,p.kick,visualReload,pump,this.flash>0,p.phase,
      {x:Math.sin(p.phase)*Math.min(p.speed/4,1),z:Math.cos(p.phase*2)*Math.min(p.speed/4,1)},this.near);
  }
}
