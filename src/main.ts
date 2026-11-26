import './style.css';
import { BAG_CAPACITY, items, slots, vendors } from './data.ts';
import type { Slot } from './data.ts';
import { Audio } from './audio.ts';
import { Input } from './input.ts';
import { equip, insert, sellPrice, stack, transfer, unequip } from './inventory.ts';
import type { Stack } from './inventory.ts';
import { Raid } from './raid.ts';
import type { Cache } from './raid.ts';
import { Saves, stashHasRoom, supplyRelief } from './save.ts';
import type { Result, Settings } from './save.ts';
import { UI, credits } from './ui.ts';
import type { PlayPanel, Tab } from './ui.ts';
import { View } from './view.ts';

const tabs:Tab[]=['brief','stash','trade','settings'];

class Game {
  private saves=new Saves();
  private audio=new Audio();
  private view?:View;
  private input?:Input;
  private ui:UI;
  private raid?:Raid;
  private panel:PlayPanel=null;
  private cache?:Cache;
  private tab:Tab='brief';
  private state:'hideout'|'raid'|'result'='hideout';
  private confirmReset=false;
  private confirmAbandon=false;
  private last=0;
  private frame=0;
  private step=0;
  private showBrief=true;
  private viewError='';
  private controller=new AbortController();

  constructor() {
    this.ui=new UI(document.querySelector('#app')!,document.querySelector('#notice')!,this.action);
    try {
      this.view=new View(document.querySelector('#viewport')!);
      this.input=new Input(this.view.canvas,locked => this.pointerChanged(locked));
    } catch {
      this.viewError='无法初始化 3D 场景。请在启用 WebGL 2 的桌面浏览器中打开游戏。';
    }
    this.applySettings();
    this.hideout('brief');
    const {signal}=this.controller;
    window.addEventListener('resize',() => this.view?.resize(),{signal});
    document.addEventListener('keydown',this.key,{signal});
    document.addEventListener('visibilitychange',() => {
      if (document.hidden && this.raid && !this.panel) this.openPanel('pause');
    },{signal});
    this.frame=requestAnimationFrame(this.loop);
    if (import.meta.hot) import.meta.hot.dispose(() => this.dispose());
  }

  private applySettings() {
    const config=this.saves.profile.settings;
    this.view?.settings(config);
    this.audio.setVolume(config.volume);
  }

  private dispose() {
    cancelAnimationFrame(this.frame);
    this.controller.abort();
    this.input?.dispose();
    this.raid?.dispose();
    this.audio.dispose();
    this.view?.dispose();
    this.ui.dispose();
  }

  private readonly loop=(now:number) => {
    this.frame=requestAnimationFrame(this.loop);
    const wallDelta=this.last ? (now-this.last)/1000 : 0;
    const delta=Math.min(.09,wallDelta);
    this.last=now;
    const raid=this.raid;
    if (this.state==='hideout') {
      if (this.tab==='brief' || this.showBrief) {
        this.view?.preview(now/1000);
        this.showBrief=false;
      }
    } else if (raid && this.input?.locked && !this.panel) {
      raid.advanceClock(wallDelta);
      this.step+=delta;
      while (this.step>=1/60 && this.raid===raid && !this.panel) {
        this.step-=1/60;
        raid.update(1/60);
      }
      if (this.raid===raid) {
        this.ui.update(raid.hud());
        raid.render();
      }
    } else {
      this.step=0;
    }
  };

  private hideout(tab:Tab) {
    this.state='hideout';
    this.tab=tab;
    this.showBrief=true;
    this.ui.hideout(tab,this.saves.profile,this.viewError || this.saves.message,this.confirmReset);
  }

  private deploy() {
    if (!this.view || !this.input || this.state!=='hideout') { if (this.viewError) this.ui.toast(this.viewError);return; }
    this.audio.wake();
    try {
      // Leave the equipped items in storage if the 3D raid cannot be prepared.
      const raid=new Raid(this.view,this.audio,this.input,this.saves.profile.kit,this.saves.profile.settings,{
        finish:result => this.finish(result),
        inventory:cache => this.openPanel('inventory',cache),
        map:() => this.openPanel('map'),
        notice:text => this.ui.toast(text),
      });
      this.saves.deploy();
      if (this.saves.message && this.saves.message.includes('写入失败')) this.ui.toast(this.saves.message);
      this.raid=raid;
      this.state='raid';
      this.panel='pause';
      this.step=0;
      this.cache=undefined;
      this.confirmAbandon=false;
      this.syncRaid();
      this.resume();
    } catch (error) {
      console.error(error);
      this.ui.toast('行动场景初始化失败');
    }
  }

  private pointerChanged(locked:boolean) {
    if (!this.raid) return;
    if (locked) {
      const closed=this.cache;
      this.last=0;
      this.panel=null;
      this.cache=undefined;
      this.confirmAbandon=false;
      this.raid.cleanupDrops();
      this.syncRaid();
      if (closed) this.ui.toast('已离开 '+closed.name);
    } else if (!this.panel) this.openPanel('pause');
  }

  private openPanel(panel:Exclude<PlayPanel,null>,cache?:Cache) {
    if (!this.raid) return;
    this.panel=panel;
    this.cache=cache;
    this.input?.release();
    this.raid.suspend();
    this.syncRaid();
  }

  private syncRaid() {
    const raid=this.raid;
    if (!raid) return;
    this.ui.raid(this.panel,raid.player.kit,this.cache,raid.player,-raid.player.yaw,this.confirmAbandon);
    this.ui.update(raid.hud());
  }

  private resume() {
    if (!this.raid) return;
    this.audio.wake();
    this.input?.lock(() => this.ui.toast('未能锁定鼠标。请再次点击“返回现场”。'));
  }

  private finish(result:Result) {
    const raid=this.raid;
    if (!raid) return;
    this.state='result';
    this.raid=undefined;
    this.panel=null;
    this.cache=undefined;
    this.input?.release();
    this.saves.finish(result,raid.player.kit);
    raid.dispose();
    if (result.outcome==='escaped') this.audio.play('extract');
    this.ui.result(result);
  }

  private readonly key=(event:KeyboardEvent) => {
    if (!this.raid || this.input?.locked || event.repeat) return;
    const code=event.code;
    /* ESC 按「从里往外一层」处理：先取消失败确认，再关当前面板，最后才回到暂停。
       这样背包/容器/地图里按 ESC 是关闭，不会突然弹一页暂停。 */
    if (code==='Escape') {
      event.preventDefault();
      if (this.confirmAbandon) {
        this.confirmAbandon=false;
        this.syncRaid();
        return;
      }
      if (!this.panel) return;
      this.closePanel();
      return;
    }
    /* 面板打开时再按同一个键，等于关掉它：Tab 关背包/地图，M 只关地图 */
    if (!this.panel) return;
    if (code==='Tab' && (this.panel==='inventory' || this.panel==='map')) {
      event.preventDefault();
      this.closePanel();
      return;
    }
    if (code==='KeyM' && this.panel==='map') {
      event.preventDefault();
      this.closePanel();
    }
  };

  /* 关闭面板回现场：面板先撤掉，再尝试把鼠标锁回来。
     锁不上（浏览器的 pointer lock 冷却）就退回暂停页，至少玩家点得到按钮。 */
  private closePanel() {
    if (!this.raid) return;
    this.panel=null;
    this.cache=undefined;
    this.confirmAbandon=false;
    this.raid.resume();
    this.syncRaid();
    this.audio.wake();
    this.input?.lock(() => {
      if (!this.panel) this.openPanel('pause');
    });
  }

  private setOption(key:keyof Settings,value:string) {
    if (key==='volume' || key==='sensitivity' || key==='resolution') {
      const number=Number(value);
      if (!Number.isFinite(number)) return;
      this.saves.profile.settings[key]=number;
    } else if (key==='bob' || key==='subtitles') {
      this.saves.profile.settings[key]=value==='true';
    }
    this.applySettings();
    if (!this.saves.write()) this.ui.toast(this.saves.message);
    if (key==='volume') {
      this.audio.wake();
      this.audio.play('ping');
    }
  }

  private readonly action=(action:string,id:string,value:string) => {
    if (action==='hideout' && this.state==='result') { this.hideout('brief');return; }
    if (this.raid) { this.raidAction(action,id,value);return; }
    if (this.state!=='hideout') return;
    const profile=this.saves.profile;
    const {stash,kit}=profile;
    const item=stash.find(entry => entry.key===id), inBag=kit.bag.find(entry => entry.key===id);
    let moved=false;
    if (action==='tab' && tabs.includes(id as Tab)) {
      this.confirmReset=false;this.hideout(id as Tab);return;
    }
    if (action==='deploy') { this.deploy();return; }
    if (action==='setting') { this.setOption(id as keyof Settings,value);return; }
    if (action==='reset' || action==='cancel-reset') {
      this.confirmReset=action==='reset';this.hideout('settings');return;
    }
    if (action==='confirm-reset' && this.confirmReset) {
      this.saves.reset();this.confirmReset=false;this.applySettings();this.hideout('settings');
      this.ui.toast('档案已重置');return;
    }
    if (action==='pack' && item) moved=transfer(stash,kit.bag,item,BAG_CAPACITY)>0;
    if (action==='unpack' && inBag) moved=transfer(kit.bag,stash,inBag)>0;
    if (action==='unequip' && slots.includes(id as Slot)) moved=unequip(kit,stash,id as Slot);
    if (action==='equip-stash' && item && slots.includes(value as Slot)) moved=equip(kit,stash,value as Slot,item);
    if (action==='equip-bag' && inBag && slots.includes(value as Slot)) moved=equip(kit,kit.bag,value as Slot,inBag);
    if (action==='relief') moved=supplyRelief(profile);
    if (action==='buy') {
      const offer=vendors.flatMap(vendor => vendor.offers).find(([key,qty]) => key===id && String(qty)===value);
      if (!offer) return;
      const [key,qty]=offer, price=items[key].price*qty;
      if (profile.credits<price) { this.ui.toast('信用点不足');return; }
      if (!stashHasRoom(profile,key)) { this.ui.toast('仓库已满，先出售一些物资');return; }
      profile.credits-=price;
      insert(stash,stack(key,qty));
      moved=true;this.ui.toast('已购买 '+items[key].name);
    }
    if (action==='sell' && item) {
      const price=sellPrice(item)*item.qty;
      const index=stash.indexOf(item);
      if (index<0) return;
      stash.splice(index,1);
      profile.credits+=price;profile.stats.earnings+=price;moved=true;
      this.ui.toast('入账 '+credits(price)+' CR');
    }
    if (moved) {
      this.audio.wake();this.audio.play('grab');
      this.saves.write();
      this.hideout(this.tab);
    } else this.ui.toast('背包容量不足或当前物品不可移动');
  };

  private raidAction(action:string,id:string,value:string) {
    const raid=this.raid;
    if (!raid || !this.panel) return;
    if (action==='resume') { this.resume();return; }
    if (action==='map') { this.openPanel('map');return; }
    if (action==='abandon' || action==='cancel-abandon') {
      this.confirmAbandon=action==='abandon';this.syncRaid();return;
    }
    if (action==='confirm-abandon' && this.confirmAbandon) { raid.finish('abandoned');return; }
    const cache=this.cache,kit=raid.player.kit;
    const entry=kit.bag.find(row => row.key===id), found=cache?.entries.find(row => row.key===id);
    let moved=false, gearChanged=false;
    if (action==='collect' && cache && found) moved=raid.collect(cache,found)>0;
    if (action==='collect-all' && cache) {
      for (const item of cache.entries.slice()) if (raid.collect(cache,item)>0) moved=true;
      if (moved && cache.entries.length) this.ui.toast('剩余物资放不进背包');
    }
    if (action==='put' && cache && entry) moved=transfer(kit.bag,cache.entries,entry)>0;
    if (action==='drop' && entry) moved=raid.drop(entry);
    if (action==='heal' && (id==='bandage' || id==='medkit')) { raid.heal(id);this.syncRaid();return; }
    if (action==='raid-unequip' && slots.includes(id as Slot)) gearChanged=unequip(kit,kit.bag,id as Slot);
    if (action==='raid-equip' && entry && slots.includes(value as Slot)) gearChanged=equip(kit,kit.bag,value as Slot,entry);
    if (gearChanged) raid.combat.inventoryChanged();
    if (moved || gearChanged) this.syncRaid();
    else this.ui.toast('背包容量不足或当前物品不可移动');
  }

  diagnostics() {
    const p=this.raid?.player;
    const r=this.view?.renderer.info;
    const combat=this.raid?.combat;
    const simplify=(entry:Stack) => ({id:entry.id,qty:entry.qty,rounds:entry.rounds,found:entry.found});
    return {
      state:this.state,panel:this.panel,locked:this.input?.locked,
      player:p ? {x:p.x,z:p.z,y:p.feet,yaw:p.yaw,pitch:p.pitch,hp:p.hp,crouched:p.crouched} : null,
      bag:p?.kit.bag.map(simplify), combat:combat?.usingKnife ? 'knife' : combat?.id,
      melee:combat?.melee.active, hud:this.raid?.hud(),
      caches:this.raid?.caches.map(c => ({x:c.x,z:c.z,name:c.name,searched:c.searched,entries:c.entries.map(simplify)})),
      enemies:this.raid?.enemies.units.map(unit => ({x:unit.x,z:unit.z,kind:unit.kind,hp:unit.hp,state:unit.state})),
      rendering:r ? {calls:r.render.calls,geometries:r.memory.geometries,textures:r.memory.textures} : null,
      sounds:this.audio.sampleCount,
    };
  }
}

const game=new Game();
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
  Object.assign(window,{deadFrequencyState:() => game.diagnostics()});
}
