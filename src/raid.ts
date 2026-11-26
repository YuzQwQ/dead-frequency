import { BAG_CAPACITY, EXTRACT_SECONDS, RAID_SECONDS, items, weapons } from './data.ts';
import type { EnemyKind, LootKind } from './data.ts';
import { areaAt, buildingAt, containerSites, exits, starts } from './sector.ts';
import type { Exit, Point } from './sector.ts';
import { Collision, Navigator } from './collision.ts';
import { Player } from './player.ts';
import { Enemies } from './enemies.ts';
import { Combat } from './combat.ts';
import { kitEntries, rollLoot, takeValue, transfer } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';
import type { Settings, Result } from './save.ts';
import type { Input } from './input.ts';
import type { View } from './view.ts';
import type { Audio } from './audio.ts';
import type { Group } from 'three';
import { knifeName } from './melee.ts';

export type Cache = Point & {
  key:string; name:string; kind:LootKind; h:number; entries:Stack[]; searched:boolean; model?:Group;
};
type Search = {cache:Cache; remaining:number; duration:number; origin:Point};
export type HudData = {
  hp:number; stamina:number; time:number; weapon:string; rounds:number; reserve:number; ammo:string;
  knife:boolean;
  armor:number; area:string; heading:number; extraction:number; exit:string; prompt:string; progress:number;
  damage:number; hit:number; headshot:boolean; ads:number; moving:number; flash:boolean; caption:string;
};
type RaidEvents = {
  finish:(result:Result)=>void; inventory:(cache?:Cache)=>void; map:()=>void; notice:(text:string)=>void;
};

export class Raid {
  readonly player:Player;
  readonly combat:Combat;
  readonly enemies:Enemies;
  readonly caches:Cache[];
  readonly start: typeof starts[number];
  private readonly collision:Collision;
  private elapsed=0;
  private kills=0;
  private searched=0;
  private seq=0;
  private running=true;
  private target?:Cache;
  private exit?:Exit;
  private extracting=0;
  private activeExit?:Exit;
  private search?:Search;
  private captionText='';
  private captionTime=0;
  private alertStage=0;
  private damageLabel='';

  constructor(private view:View, private audio:Audio, private input:Input, kit:Kit, private settings:Settings,private events:RaidEvents) {
    this.start=starts[Math.floor(Math.random()*starts.length)];
    this.player=new Player(this.start,kit);
    this.collision=new Collision(view.solids);
    const nav=new Navigator(this.collision);
    this.caches=containerSites.map(site => ({...site,key:'c'+this.seq++,entries:rollLoot(site.kind),searched:false}));
    this.enemies=new Enemies(view,this.collision,nav,audio,
      (kind,x,z) => this.death(kind,x,z),
      (damage,label) => this.hurt(damage,label),
      (message,origin) => this.caption(message,origin),
    );
    this.combat=new Combat(this.player,view,this.collision,this.enemies,audio,events.notice);
    this.render();
  }

  update(dt:number) {
    if (!this.running) return;
    const p=this.player;
    this.captionTime=Math.max(0,this.captionTime-dt);
    p.look(this.input,this.settings.sensitivity);
    const {combat,input}=this;
    combat.selectFrom(input);
    const swinging=combat.usingKnife && Boolean(combat.melee.active || input.shot || input.altShot);
    p.update(dt,input,this.collision,!combat.usingKnife && input.aim,!swinging);
    this.audio.position(p,p.yaw);
    const inside=Boolean(buildingAt(p.x,p.z));
    if (p.step || p.landed) {
      this.audio.play(inside ? 'metalStep' : 'step');
      this.enemies.alert(p.x,p.z,p.crouched ? 2.7 : p.sprint>.55 ? 12 : 5.5,this.elapsed);
    }
    this.audio.ambience(true,inside);
    if (this.input.pop('KeyF')) {
      p.flashlight=!p.flashlight;
      this.audio.play('grab');
    }
    if (this.input.pop('KeyH')) this.heal();
    if (this.input.pop('Tab')) { this.search=undefined;this.events.inventory();return; }
    if (this.input.pop('KeyM')) { this.events.map();return; }

    this.combat.update(dt,this.elapsed,this.input);
    this.enemies.update(dt,this.elapsed,p);
    this.view.animate(dt,this.elapsed);
    if (p.hp<=0) { this.finish('dead');return; }
    this.findTarget();
    if (this.input.pop('KeyE')) this.interact();
    if (this.search) {
      const {cache,origin}=this.search;
      if (Math.hypot(p.x-origin.x,p.z-origin.z)>.5 || this.target!==cache) {
        this.search=undefined;
        this.events.notice('搜索中断');
      } else {
        this.search.remaining-=dt;
        if (this.search.remaining<=0) {
          this.search=undefined;
          this.open(cache);
        }
      }
    }
    if (this.activeExit) {
      if (this.exit!==this.activeExit) {
        this.activeExit=undefined;
        this.extracting=0;
        this.events.notice('离开撤离区，撤离已中止');
      } else {
        const old=Math.ceil(this.extracting);
        this.extracting=Math.max(0,this.extracting-dt);
        if (!this.extracting) { this.finish('escaped'); return; }
        if (Math.ceil(this.extracting)<old) this.audio.play('ping');
      }
    }
  }

  advanceClock(dt:number) {
    if (!this.running) return;
    this.elapsed=Math.min(RAID_SECONDS,this.elapsed+dt);
    const remain=RAID_SECONDS-this.elapsed;
    if (remain<=0) { this.finish('timeout');return; }
    const stage=remain<30 ? 2 : remain<120 ? 1 : 0;
    if (stage>this.alertStage) {
      this.alertStage=stage;
      this.events.notice(stage===2 ? '频段将在 30 秒后关闭' : '最后 2 分钟 · 前往撤离点');
      this.audio.play('ping');
    }
  }

  suspend() {
    this.search=undefined;
    this.combat.melee.clearQueue();
    this.audio.ambience(false);
  }

  /* 关闭面板回现场：环境音按当前是否在室内重新起，下一帧 update 会继续接管 */
  resume() {
    this.audio.ambience(true,Boolean(buildingAt(this.player.x,this.player.z)));
  }

  private findTarget() {
    const p=this.player;
    const forwardX=-Math.sin(p.yaw)*Math.cos(p.pitch), forwardZ=-Math.cos(p.yaw)*Math.cos(p.pitch), forwardY=Math.sin(p.pitch);
    this.exit=exits.find(e => Math.hypot(e.x-p.x,e.z-p.z)<e.radius);
    this.target=undefined;
    let best=-Infinity;
    for (const cache of this.caches) {
      if (cache.kind==='drop' && !cache.entries.length) continue;
      const x=cache.x-p.x,y=Math.max(.23,cache.h*.76)-p.eyeY,z=cache.z-p.z;
      const length=Math.hypot(x,y,z);
      if (length>3.06) continue;
      const dot=(x*forwardX+y*forwardY+z*forwardZ)/length;
      if (dot<.72) continue;
      const hit=this.collision.cast(p.x,p.eyeY,p.z,x/length,y/length,z/length,length-.03);
      if (hit.hit && (Math.hypot(hit.hit.x-cache.x,hit.hit.z-cache.z)>.10)) continue;
      const score=dot*2-length*.14;
      if (score>best) { best=score;this.target=cache; }
    }
  }

  private interact() {
    if (this.activeExit || this.search) return;
    if (this.exit) {
      this.activeExit=this.exit;
      this.extracting=EXTRACT_SECONDS;
      this.audio.play('ping');
      return;
    }
    const cache=this.target;
    if (!cache) return;
    if (cache.searched) { this.open(cache);return; }
    const duration=cache.kind==='sealed' ? 1.65 : cache.kind==='corpse' || cache.kind==='anomaly' ? .70 : .88;
    this.search={cache,remaining:duration,duration,origin:{x:this.player.x,z:this.player.z}};
    this.audio.play(cache.kind==='sealed' ? 'lock' : cache.kind==='corpse' || cache.kind==='medical' ? 'zip' : 'open',cache);
    this.enemies.alert(cache.x,cache.z,cache.kind==='sealed' ? 14 : 5,this.elapsed);
  }

  private open(cache:Cache) {
    if (!cache.searched) {
      this.searched++;
      cache.searched=true;
    }
    this.audio.play('grab',cache);
    this.events.inventory(cache);
  }

  private death(kind:EnemyKind,x:number,z:number) {
    this.kills++;
    const loot=kind==='echo' ? 'anomaly' : 'corpse';
    this.spawnCache(loot,kind==='echo' ? '回响体残骸' : '拾荒者随身包',x,z,rollLoot(loot),false);
  }

  private spawnCache(kind:LootKind,name:string,x:number,z:number,entries:Stack[],searched:boolean) {
    const model=this.view.assets.cache(kind);
    model.position.set(x,0,z);
    model.rotation.y=Math.random()*6.28;
    this.view.dynamic.add(model);
    const cache:Cache={key:'c'+this.seq++,x,z,h:.49,name,kind,entries,searched,model};
    this.caches.push(cache);
    return cache;
  }

  collect(cache:Cache,entry:Stack) {
    const added=transfer(cache.entries,this.player.kit.bag,entry,BAG_CAPACITY);
    if (added) this.audio.play('grab');
    return added;
  }

  drop(entry:Stack) {
    const bag=this.player.kit.bag;
    if (!bag.includes(entry)) return false;
    const p=this.player;
    const dx=-Math.sin(p.yaw)*1.28,dz=-Math.cos(p.yaw)*1.28;
    const point={x:p.x,z:p.z};
    this.collision.slide(point,dx,dz,.22);
    let cache=this.caches.find(c => c.kind==='drop' && Math.hypot(c.x-point.x,c.z-point.z)<.75);
    if (!cache) cache=this.spawnCache('drop','遗落物资',point.x,point.z,[],true);
    cache.model!.visible=true;
    return transfer(bag,cache.entries,entry)>0;
  }

  cleanupDrops() {
    for (let i=this.caches.length-1;i>=0;i--) {
      const cache=this.caches[i];
      if (cache.kind==='drop' && !cache.entries.length) {
        cache.model?.removeFromParent();
        this.caches.splice(i,1);
      }
    }
  }

  heal(preferred?:'bandage'|'medkit') {
    const p=this.player;
    const order=preferred ? [preferred] : p.hp<=49 ? ['medkit','bandage'] as const : ['bandage','medkit'] as const;
    for (const id of order) {
      if (p.heal(id)) { this.audio.play('grab');this.events.notice('已使用 '+items[id].name);return true; }
    }
    this.events.notice(p.hp>=100 ? '生命值已满' : '背包内无可用医疗品');
    return false;
  }

  private hurt(damage:number,label:string) {
    this.player.hurt(damage);
    this.damageLabel=label;
    if (this.search) this.events.notice('受伤 · 搜索中断');
    this.search=undefined;
    this.audio.play('hurt');
  }

  private caption(text:string,origin:Point) {
    if (!this.settings.subtitles) return;
    const p=this.player;
    const offset=(origin.x-p.x)*Math.cos(p.yaw)-(origin.z-p.z)*Math.sin(p.yaw);
    this.captionText=text+(Math.abs(offset)>2 ? offset>0 ? ' · 右侧' : ' · 左侧' : ' · 附近');
    this.captionTime=2.4;
  }

  hud():HudData {
    const p=this.player,c=this.combat,id=c.id,weapon=id ? weapons[id] : undefined;
    const progress=this.activeExit ? 1-this.extracting/EXTRACT_SECONDS : this.search ? 1-this.search.remaining/this.search.duration : -1;
    const prompt=this.activeExit ? '保持在撤离区内' : this.search ? '搜索中 · 保持站定'
      : this.exit ? 'E  请求撤离' : this.target ? 'E  '+(this.target.searched ? '查看 ' : '搜索 ')+this.target.name : '';
    return {
      hp:Math.ceil(p.hp),stamina:Math.ceil(p.stamina),time:Math.max(0,Math.ceil(RAID_SECONDS-this.elapsed)),
      weapon:id ? items[id].name : knifeName, rounds:c.entry?.rounds ?? 0,reserve:c.reserve,knife:c.usingKnife,
      ammo:c.usingKnife ? c.melee.label : c.reload>0 ? '装填中' : c.cycling ? '泵动中' : weapon ? items[weapon.ammo].name+' / '+(weapon.automatic ? '自动' : id==='p12' ? '泵动' : '半自动') : '',
      armor:Math.ceil(p.kit.gear.armor?.integrity ?? 0),area:areaAt(p.x,p.z),heading:(((-p.yaw*180/Math.PI)%360)+360)%360,
      extraction:this.extracting,exit:this.activeExit?.name ?? this.exit?.name ?? '',prompt,progress,
      damage:p.damaged,hit:c.hit,headshot:c.headshot,ads:p.ads,moving:p.speed,flash:p.flashlight,
      caption:this.captionTime>0 ? this.captionText : p.damaged>.6 ? this.damageLabel+' · 受伤' : '',
    };
  }

  render() {
    const p=this.player;
    this.view.aim(p.x,p.eyeY+p.viewBob(this.settings),p.z,p.yaw,p.pitch,71-p.ads*19+p.sprint*3);
    this.view.flashlight(p.flashlight);
    this.combat.render();
    this.view.draw(true);
  }

  finish(outcome:Result['outcome']) {
    if (!this.running) return;
    this.running=false;
    const entries=kitEntries(this.player.kit);
    const found=entries.filter(entry => entry.found);
    this.events.finish({
      outcome, exit:outcome==='escaped' ? this.activeExit?.name : undefined, elapsed:this.elapsed,
      kills:this.kills,searched:this.searched,found:outcome==='escaped' ? found.reduce((n,e)=>n+e.qty,0) : 0,
      haul:outcome==='escaped' ? found.reduce((n,e)=>n+takeValue(e),0) : 0,
      lost:outcome==='escaped' ? 0 : entries.reduce((n,e)=>n+takeValue(e),0),
    });
  }

  dispose() {
    this.enemies.dispose();
    this.caches.forEach(cache => cache.model?.removeFromParent());
    this.view.resetEffects();
    this.audio.ambience(false);
  }
}
