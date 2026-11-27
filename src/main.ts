import './style.css';
import { items, slots, vendors } from './data.ts';
import type { Slot } from './data.ts';
import { Audio } from './audio.ts';
import { Input } from './input.ts';
import { carriedGrids, compatible, equipmentMove, insert, isLoaded, packItem, pruneQuick, quickGrids, sellPrice, splitStack, stack, transfer, transferAcross } from './inventory.ts';
import type { Kit, SlotTarget, Stack } from './inventory.ts';
import { Raid } from './raid.ts';
import type { Cache } from './raid.ts';
import { Saves, stashHasRoom, supplyRelief } from './save.ts';
import type { Result, Settings } from './save.ts';
import { UI, credits } from './ui.ts';
import type { PlayPanel, Tab } from './ui.ts';
import { View } from './view.ts';
import { ViewModelPanel } from './viewmodel-panel.ts';
import { findAvailablePosition, gridOf, movePlaced } from './grid-inventory.ts';
import type { Inventory } from './grid-inventory.ts';
import type { GridMove } from './grid-inventory-ui.ts';

const tabs:Tab[]=['brief','stash','trade','settings'];

class Game {
  private saves=new Saves();
  private audio=new Audio();
  private view?:View;
  private viewModelPanel?:ViewModelPanel;
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
  private waitingForPointer=false;
  private viewError='';
  private controller=new AbortController();

  constructor() {
    this.ui=new UI(document.querySelector('#app')!,document.querySelector('#notice')!,this.action,this.moveInventory,this.checkEquipment);
    try {
      this.view=new View(document.querySelector('#viewport')!);
      this.input=new Input(this.view.canvas,(locked,voluntary) => this.pointerChanged(locked,voluntary),
        ()=>this.interrupted(true),this.pointerDenied);
      this.viewModelPanel=new ViewModelPanel(this.view.knifeRig,this.closeViewModel);
    } catch {
      this.viewError='无法初始化 3D 场景。请在启用 WebGL 2 的桌面浏览器中打开游戏。';
    }
    this.applySettings();
    this.hideout('brief');
    const {signal}=this.controller;
    window.addEventListener('resize',() => this.view?.resize(),{signal});
    document.addEventListener('keydown',this.key,{signal});
    document.addEventListener('visibilitychange',() => {
      if (document.hidden && this.raid && !this.panel && !this.viewModelPanel?.open) this.openPanel('pause');
    },{signal});
    /* 没锁上时（切出窗口、系统拒绝），点一下画面就接着打 */
    this.view?.canvas.addEventListener('pointerdown',() => {
      if (this.state!=='raid' || this.panel || this.viewModelPanel?.open || this.input?.locked) return;
      this.requestFieldLock();
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
    this.viewModelPanel?.dispose();
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
    } else if (raid && this.viewModelPanel?.open) {
      this.step=0;
      raid.render();
    } else if (raid && (this.input?.locked && !this.panel || this.inventoryWorld)) {
      raid.advanceClock(wallDelta);
      this.step+=delta;
      while (this.step>=1/60 && this.raid===raid && (!this.panel || this.inventoryWorld)) {
        this.step-=1/60;
        if (this.inventoryWorld) raid.updateWhileManaging(1/60);
        else raid.update(1/60);
      }
      if (this.raid===raid) {
        this.ui.update(raid.hud());
        if (!this.panel) raid.render();
      }
    } else {
      this.step=0;
    }
  };

  private get inventoryWorld() { return this.panel==='inventory'||this.panel==='status'||this.panel==='map'; }

  private hideout(tab:Tab) {
    this.state='hideout';
    this.tab=tab;
    if (tab!=='stash' || !this.saves.profile.stash.includes(this.ui.stashOpen!)) this.ui.stashOpen=undefined;
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
      this.panel=null;
      this.step=0;
      this.cache=undefined;
      this.confirmAbandon=false;
      this.syncRaid();
      this.resume();
      this.input.enterFullscreen();
    } catch (error) {
      console.error(error);
      this.ui.toast('行动场景初始化失败');
    }
  }

  private pointerChanged(locked:boolean,voluntary:boolean) {
    if (!this.raid) return;
    if (locked) {
      if (this.panel || this.viewModelPanel?.open || document.hidden || !document.hasFocus()) {
        this.input?.release();return;
      }
      this.waitingForPointer=false;
      this.last=0;
      this.ui.pointerPrompt(false);
      this.raid.cleanupDrops();
      return;
    }
    if (!voluntary && !this.waitingForPointer) this.interrupted();
  }

  private interrupted(includeInventory=false) {
    if (this.raid && (!this.panel || includeInventory && this.inventoryWorld) && !this.viewModelPanel?.open)
      this.openPanel('pause');
  }

  private readonly pointerDenied=()=>{
    if (this.raid && !this.panel && this.waitingForPointer) this.ui.pointerPrompt(true);
  };

  private requestFieldLock() {
    if (!this.raid || this.panel || this.viewModelPanel?.open || document.hidden) return;
    if (document.pointerLockElement===this.input?.canvas) return;
    this.waitingForPointer=true;
    this.ui.pointerPrompt(true);
    this.input?.lock(this.pointerDenied);
  }

  private openPanel(panel:Exclude<PlayPanel,null>,cache?:Cache) {
    if (!this.raid) return;
    this.waitingForPointer=false;
    this.panel=panel;
    this.cache=cache;
    this.input?.release();
    this.raid.suspend();
    if (this.inventoryWorld) this.raid.resume();
    this.syncRaid();
  }

  private syncRaid() {
    const raid=this.raid;
    if (!raid) return;
    this.ui.raid(this.panel,raid.player.kit,this.cache,raid.player,-raid.player.yaw,this.confirmAbandon);
    this.ui.update(raid.hud());
    this.ui.pointerPrompt(!this.panel && this.waitingForPointer);
  }

  private resume() {
    if (!this.raid) return;
    const closed=this.cache;
    this.panel=null;
    this.cache=undefined;
    this.confirmAbandon=false;
    this.raid.resume();
    this.audio.wake();
    this.syncRaid();
    this.requestFieldLock();
    if (closed) this.ui.toast('已离开 '+closed.name);
  }

  private finish(result:Result) {
    const raid=this.raid;
    if (!raid) return;
    this.state='result';
    this.raid=undefined;
    this.panel=null;
    this.cache=undefined;
    this.viewModelPanel?.hide();
    this.waitingForPointer=false;
    this.input?.endSession();
    this.saves.finish(result,raid.player.kit);
    raid.dispose();
    if (result.outcome==='escaped') this.audio.play('extract');
    this.ui.result(result);
  }

  private readonly key=(event:KeyboardEvent) => {
    if (!this.raid) return;
    const code=event.code;
    if (event.repeat) {
      if (code==='Escape' && this.input?.capturesEscape) event.preventDefault();
      return;
    }
    const viewModel=this.viewModelPanel;
    if (viewModel?.open) {
      if (code==='F8' || code==='Escape') {
        event.preventDefault();
        this.closeViewModel();
      }
      return;
    }
    if (code==='F8' && viewModel && !this.panel) {
      event.preventDefault();
      if (!this.raid.combat.usingKnife) {
        this.ui.toast('切换到小刀后按 F8 调试 ViewModel');
        return;
      }
      viewModel.show();
      this.input?.release();
      this.raid.suspend();
      return;
    }
    if (code==='Escape') {
      // In windowed fallback the native unlock is the signal to pause.
      if (!this.panel && this.input?.locked && !this.input.capturesEscape) return;
      event.preventDefault();
      if (this.confirmAbandon) {
        this.confirmAbandon=false;
        this.syncRaid();
        return;
      }
      if (this.panel) {this.resume();return;}
      this.openPanel('pause');
      return;
    }
    if (this.input?.locked) return;
    /* 面板打开时再按同一个键，等于关掉它：Tab 关背包/地图，M 只关地图 */
    if (!this.panel) return;
    if (code==='Tab' && this.inventoryWorld) {
      event.preventDefault();
      this.resume();
      return;
    }
    if (code==='KeyM' && this.panel==='map') {
      event.preventDefault();
      this.resume();
    }
  };

  private readonly closeViewModel=()=>{
    if (!this.viewModelPanel?.open) return;
    this.viewModelPanel.hide();
    this.resume();
  };

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
    const item=stash.find(entry => entry.key===id);
    const source=[...carriedGrids(kit),...(this.ui.stashOpen?.contents ?? [])].find(grid=>grid.some(entry=>entry.key===id));
    const carried=source?.find(entry=>entry.key===id);
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
    if (action==='open-storage' && item?.contents && this.tab==='stash') {
      this.ui.stashOpen=item;this.hideout(this.tab);return;
    }
    if (action==='close-storage') {this.ui.stashOpen=undefined;this.hideout(this.tab);return;}
    if (action==='pack' && item) moved=this.takeIntoKit(stash,kit,item);
    if (action==='unpack' && carried && source) moved=transfer(source,stash,carried)>0;
    if (action==='quick-equip' || action==='quick-slot' || action==='split') {
      this.quickInventoryAction(action,id,value);return;
    }
    if (action==='claim-overflow') {
      const entry=profile.overflow.find(row=>row.key===id);
      if (entry) moved=transfer(profile.overflow,stash,entry)>0;
    }
    if (action==='unequip' && slots.includes(id as Slot)) moved=this.stow({kit,slot:id as Slot},[stash,...carriedGrids(kit)]);
    if (action==='equip-stash' && item) moved=this.wear(gridOf(stash)!,kit,value,item);
    if (action==='equip-bag' && carried && source) moved=this.wear(gridOf(source)!,kit,value,carried);
    if (action==='quick-bind' && carried && source) moved=this.bindQuick(kit,source,carried,value);
    if (action==='relief') moved=supplyRelief(profile);
    if (action==='buy') {
      const offer=vendors.flatMap(vendor => vendor.offers).find(([key,qty]) => key===id && String(qty)===value);
      if (!offer) return;
      const [key,qty]=offer, price=items[key].price*qty;
      if (profile.credits<price) { this.ui.toast('信用点不足');return; }
      if (!stashHasRoom(profile,key,qty)) { this.ui.toast('仓库空间不足，先出售一些物资');return; }
      profile.credits-=price;
      insert(stash,stack(key,qty));
      moved=true;this.ui.toast('已购买 '+items[key].name);
    }
    if (action==='sell' && item && !isLoaded(item)) {
      const price=sellPrice(item)*item.qty;
      const index=stash.indexOf(item);
      if (index<0) return;
      stash.splice(index,1);
      profile.credits+=price;profile.stats.earnings+=price;moved=true;
      this.ui.toast('入账 '+credits(price)+' CR');
    }
    if (moved) {
      this.audio.wake();this.audio.play('grab');
      this.inventoryChanged();
    } else this.ui.toast('背包容量不足或当前物品不可移动');
  };

  private inventoryContext() {
    const {stash,kit,overflow}=this.saves.profile;
    if (this.raid && this.panel==='inventory') {
      const player=this.raid.player.kit;
      const cache=this.cache && this.raid.caches.includes(this.cache) ? this.cache : undefined;
      const corpse=cache?.character;
      const external=corpse ? carriedGrids(corpse)
        : cache ? [cache.entries,...cache.entries.flatMap(entry=>entry.contents ?? [])] : [];
      return {entries:[...carriedGrids(player),...external],kits:corpse ? [player,corpse] : [player]};
    }
    if (this.state==='hideout' && this.tab==='stash')
      return {entries:[stash,overflow,...carriedGrids(kit),...(this.ui.stashOpen?.contents ?? [])],kits:[kit]};
    return {entries:this.state==='hideout' && this.tab==='trade' ? [stash] : [],kits:[]};
  }

  private fallbacks(kit:Kit) {
    const grids=carriedGrids(kit);
    if (this.state==='hideout' && this.tab==='stash') grids.push(this.saves.profile.stash);
    return grids.map(entries=>gridOf(entries)!);
  }

  private approvedMove({source,target,item,position,mergeCell}:GridMove,commit:boolean) {
    const {entries,kits}=this.inventoryContext();
    const available=(grid:Inventory)=>grid.slotTarget
      ? kits.includes(grid.slotTarget.kit) && slots.includes(grid.slotTarget.slot)
      : entries.includes(grid.items) && gridOf(grid.items)===grid;
    if (!available(source) || !available(target)) return false;
    if (source.slotTarget || target.slotTarget) {
      const owner=target.slotTarget?.kit ?? source.slotTarget!.kit;
      return equipmentMove(source.slotTarget ?? source,target.slotTarget ?? target,item,position,this.fallbacks(owner),commit);
    }
    return commit && movePlaced(source,target,item,position,mergeCell);
  }

  private readonly checkEquipment=(move:GridMove)=>this.approvedMove(move,false);
  private readonly moveInventory=(move:GridMove)=>{
    if (!this.approvedMove(move,true)) return;
    this.audio.play('grab');
    const own=this.raid?.player.kit;
    this.inventoryChanged([move.source,move.target].some(grid=>Boolean(grid.slotTarget && grid.slotTarget.kit===own)));
  };

  private inventoryChanged(equipment=false) {
    const raid=this.raid;
    if (raid) {
      pruneQuick(raid.player.kit);
      raid.player.updateLoad();
      if (equipment) raid.combat.inventoryChanged();
      this.syncRaid();
    } else {
      pruneQuick(this.saves.profile.kit);
      if (!this.saves.write()) this.ui.toast(this.saves.message);
      this.hideout(this.tab);
    }
  }

  private takeIntoKit(source:Stack[],kit:Kit,item:Stack) {
    return transferAcross(source,packItem(kit,item),item)>0;
  }

  private quickInventoryAction(action:string,id:string,value:string) {
    const {entries,kits}=this.inventoryContext(), owner=kits[0];
    if (!owner) return;
    const source=entries.find(grid=>grid.some(item=>item.key===id));
    const item=source?.find(item=>item.key===id);
    const equipped=kits.flatMap(kit=>slots.map(slot=>({kit,slot}))).find(({kit,slot})=>kit.gear[slot]?.key===id);
    let changed=false,gear=false;
    if (action==='split' && source && item) changed=splitStack(source,item,Number(value));
    if (action==='quick-equip') {
      const entry=item ?? (equipped && equipped.kit.gear[equipped.slot]);
      const origin=source ? gridOf(source) : equipped;
      if (entry && origin && equipped?.kit!==owner) {
        const matching=slots.filter(slot=>compatible(slot,entry));
        const slot=matching.find(slot=>!owner.gear[slot]) ?? matching[0];
        if (slot) gear=this.wear(origin,owner,slot,entry);
      }
    }
    if (action==='quick-slot' && equipped) {
      const entry=equipped.kit.gear[equipped.slot]!;
      const targets=equipped.kit!==owner ? packItem(owner,entry)
        : this.raid ? this.externalDestinations(entry) : [this.saves.profile.stash];
      gear=this.stow(equipped,targets);
      if (!targets.length) return;
    }
    if (changed||gear) {this.audio.play('grab');this.inventoryChanged(gear);}
    else this.ui.toast(action==='split' ? '当前网格没有足够空间拆分' : '没有合适的装备槽或存放空间');
  }

  private externalDestinations(item:Stack) {
    const cache=this.cache;
    if (!cache || !this.raid?.caches.includes(cache)) return [];
    return cache.character ? packItem(cache.character,item) : [cache.entries];
  }

  private wear(source:Inventory|SlotTarget,kit:Kit,slot:string,item:Stack) {
    if (!slots.includes(slot as Slot)) return false;
    return equipmentMove(source,{kit,slot:slot as Slot},item,{x:0,y:0,rotation:0},this.fallbacks(kit),true);
  }

  private stow(source:SlotTarget,grids:Stack[][]) {
    const item=source.kit.gear[source.slot];
    if (!item) return false;
    for (const entries of grids) {
      const target=gridOf(entries)!;
      const at=findAvailablePosition(target,item);
      if (at && equipmentMove(source,target,item,at,[],true)) return true;
    }
    return false;
  }

  private bindQuick(kit:Kit,source:Stack[],item:Stack,key:string) {
    if (!/^[4-7]$/.test(key) || !quickGrids(kit).includes(source) || items[item.id].kind!=='medical') return false;
    if (kit.quick![key]===item.key) delete kit.quick![key];
    else kit.quick![key]=item.key;
    return true;
  }

  private raidAction(action:string,id:string,value:string) {
    const raid=this.raid;
    if (!raid) return;
    if (action==='restore-pointer' && !this.panel) {this.requestFieldLock();return;}
    if (!this.panel) return;
    if (action==='resume') { this.resume();return; }
    if (action==='equipment-tab' && (id==='inventory'||id==='status'||id==='map')) {this.openPanel(id,this.cache);return;}
    if (action==='map') { this.openPanel('map');return; }
    if (action==='abandon' || action==='cancel-abandon') {
      this.confirmAbandon=action==='abandon';this.syncRaid();return;
    }
    if (action==='confirm-abandon' && this.confirmAbandon) { raid.finish('abandoned');return; }
    if (this.panel!=='inventory') return;
    if (action==='quick-equip' || action==='quick-slot' || action==='split') {
      this.quickInventoryAction(action,id,value);return;
    }
    const kit=raid.player.kit;
    const cache=this.cache && raid.caches.includes(this.cache) ? this.cache : undefined;
    const source=carriedGrids(kit).find(grid=>grid.some(row=>row.key===id));
    const entry=source?.find(row=>row.key===id), found=cache?.entries.find(row=>row.key===id);
    const corpse=cache?.character;
    let moved=false, gearChanged=false;
    if (action==='collect' && cache && found) moved=raid.collect(cache,found)>0;
    if (action==='collect-all' && cache) {
      for (const item of cache.entries.slice()) if (raid.collect(cache,item)>0) moved=true;
      if (moved && cache.entries.length) this.ui.toast('剩余物资放不进背包');
    }
    if (action==='put' && cache && entry && source) moved=transferAcross(source,this.externalDestinations(entry),entry)>0;
    if (action==='drop' && entry) moved=raid.drop(entry);
    if (action==='heal' && entry && source && quickGrids(kit).includes(source) && (entry.id==='bandage' || entry.id==='medkit')) {
      raid.heal(entry.id,entry);this.inventoryChanged();return;
    }
    if (action==='quick-bind' && entry && source) moved=this.bindQuick(kit,source,entry,value);
    if (action==='raid-unequip' && slots.includes(id as Slot)) gearChanged=this.stow({kit,slot:id as Slot},carriedGrids(kit));
    if (action==='raid-equip' && entry && source) gearChanged=this.wear(gridOf(source)!,kit,value,entry);
    if (action==='drop-equipped' && slots.includes(id as Slot)) {
      const slot=id as Slot,equipped=kit.gear[slot];
      if (equipped && raid.drop(equipped,[equipped])) {delete kit.gear[slot];gearChanged=true;}
    }
    if (corpse && slots.includes(id as Slot)) {
      const slot=id as Slot,equipped=corpse.gear[slot];
      if (action==='corpse-equip' && equipped) gearChanged=this.wear({kit:corpse,slot},kit,slot,equipped);
      if (action==='corpse-take' && equipped) moved=this.stow({kit:corpse,slot},packItem(kit,equipped));
    }
    if (action==='corpse-item' || action==='ground-item' || action==='ground-equip') {
      const grids=corpse ? carriedGrids(corpse) : [...(cache?.entries ?? []).flatMap(row=>row.contents ?? []),...(cache ? [cache.entries] : [])];
      const origin=grids.find(grid=>grid.some(row=>row.key===id));
      const loot=origin?.find(row=>row.key===id);
      if (origin && loot) {
        if (action==='ground-equip') gearChanged=this.wear(gridOf(origin)!,kit,value,loot);
        else moved=this.takeIntoKit(origin,kit,loot);
      }
    }
    if (moved || gearChanged) this.inventoryChanged(gearChanged);
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
      bag:p ? carriedGrids(p.kit).flat().map(simplify) : undefined, combat:combat?.usingKnife ? 'knife' : combat?.id,
      melee:combat?.melee.active, hud:this.raid?.hud(),
      caches:this.raid?.caches.map(c => ({x:c.x,z:c.z,name:c.name,kind:c.kind,searched:c.searched,
        highlight:Boolean(c.outline?.visible),
        entries:c.entries.map(simplify)})),
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
