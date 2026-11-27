import { armor, helmets, items, slots, weapons } from './data.ts';
import type { ArmorId, ItemId, WeaponId } from './data.ts';
import { bindContents, compatible, characterKit, insert, kitEntries, quickGrids, stack } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';
import { canPlaceItem, footprint, gridOf, place, registerInventory } from './grid-inventory.ts';

export const SAVE_KEY = 'dead-frequency.profile';
const VERSION = 4;
export type Settings = { volume:number; sensitivity:number; resolution:number; bob:boolean; subtitles:boolean };
type Stats = { raids:number; escapes:number; kills:number; earnings:number };
export type Profile = {
  version:number; credits:number; stash:Stack[]; overflow:Stack[]; kit:Kit; settings:Settings;
  stats:Stats; active:boolean;
};
export type Result = {
  outcome:'escaped' | 'dead' | 'timeout' | 'abandoned'; exit?:string;
  elapsed:number; kills:number; searched:number; found:number; haul:number; lost:number;
};
export const defaults:Settings = {volume:.55, sensitivity:1, resolution:1, bob:true, subtitles:true};

export function newProfile():Profile {
  const {stash,overflow,kit}=storageGrids();
  kit.gear={secondary:stack('k9'),armor:stack('vest'),rig:stack('rigLight'),backpack:stack('packLegacy')};
  for (const entry of [stack('p12'),stack('12g',10),stack('9mm',24),stack('bandage',2)]) insert(stash,entry);
  insert(kit.pockets![0],stack('9mm',24));insert(kit.pockets![1],stack('bandage',2));
  return {
    version:VERSION, credits:900, active:false,
    stash,overflow,kit,
    settings:{...defaults}, stats:{raids:0,escapes:0,kills:0,earnings:0},
  };
}

function emptyKit():Kit {
  return characterKit('player');
}
function storageGrids() {
  const stash:Stack[]=[],overflow:Stack[]=[];
  registerInventory(stash,'stash');
  registerInventory(overflow,'overflow');
  return {stash,overflow,kit:emptyKit()};
}

function retainOverflow(overflow:Stack[],entry:Stack) {
  const grid=gridOf(overflow)!;
  grid.columns=Math.max(grid.columns,items[entry.id].width);
  let remaining=entry.qty;
  while (remaining>0) {
    const added=insert(overflow,{...entry, key:remaining===entry.qty ? entry.key : stack(entry.id).key,qty:remaining});
    remaining-=added;
    if (remaining) grid.rows+=Math.max(items[entry.id].height,items[entry.id].width);
  }
}

function storeOrOverflow(dest:Stack[],overflow:Stack[],entry:Stack) {
  const added=insert(dest,entry);
  if (added<entry.qty) retainOverflow(overflow,{...entry,qty:entry.qty-added,key:added ? stack(entry.id).key : entry.key});
}

const record = (value:unknown):Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string,unknown> : {};
const number = (value:unknown, fallback:number, min:number, max:number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(min,value)) : fallback;
const integer = (value:unknown, fallback:number, min=0, max=1_000_000_000) => Math.floor(number(value,fallback,min,max));

function restoreEntry(value:unknown):Stack | null {
  const row = record(value);
  if (typeof row.id !== 'string' || !Object.hasOwn(items, row.id)) return null;
  const id = row.id as ItemId;
  const qty = integer(row.qty,1,0,10000);
  if (!qty) return null;
  const entry = stack(id,qty);
  if (typeof row.key==='string' && /^[a-z0-9_-]{1,80}$/i.test(row.key)) entry.key=row.key;
  if (row.found===true) entry.found=true;
  if (typeof row.x==='number' && Number.isInteger(row.x)) entry.x=row.x;
  if (typeof row.y==='number' && Number.isInteger(row.y)) entry.y=row.y;
  if (row.rotation===90 && items[id].rotatable) entry.rotation=90;
  else if (row.rotation===0) entry.rotation=0;
  if (entry.rounds !== undefined) entry.rounds = integer(row.rounds,entry.rounds,0,weapons[id as WeaponId].capacity);
  if (entry.integrity !== undefined) entry.integrity = number(row.integrity,entry.integrity,0,
    armor[id as ArmorId]?.durability ?? helmets[id as keyof typeof helmets].durability);
  return entry;
}

export function decode(value:unknown):Profile {
  const row = record(value);
  if (row.version !== 1 && row.version !== 2 && row.version !== 3 && row.version !== VERSION) throw new Error('不支持的存档版本');
  if (!Array.isArray(row.stash) || !row.kit || !row.stats || !row.settings || typeof row.credits !== 'number') {
    throw new Error('缺少存档字段');
  }
  const rawKit = record(row.kit);
  const rawGear = record(rawKit.gear);
  const rawStats = record(row.stats);
  const config = record(row.settings);
  const stats = {raids:integer(rawStats.raids,0), escapes:integer(rawStats.escapes,0),
    kills:integer(rawStats.kills,0), earnings:integer(rawStats.earnings,0)};
  const {stash,overflow,kit}=storageGrids();
  const keys=new Set<string>();
  const restore=(raw:unknown)=>{
    const entry=restoreEntry(raw);
    if (entry) {
      if (keys.has(entry.key)) entry.key=stack(entry.id).key;
      keys.add(entry.key);
      bindContents(entry);
      const contents=record(raw).contents;
      if (Array.isArray(contents)) contents.forEach((part,index)=>load(part,entry.contents?.[index] ?? overflow));
    }
    return entry;
  };
  const load=(raw:unknown,dest:Stack[])=>{
    if (!Array.isArray(raw)) return;
    const grid=gridOf(dest)!;
    const displaced:Stack[]=[];
    for (const value of raw) {
      const entry=restore(value);
      if (!entry) continue;
      const {x,y}=entry, rotation=entry.rotation ?? 0;
      if ((row.version===3 || row.version===VERSION) && x!==undefined && y!==undefined && entry.qty<=items[entry.id].stack &&
          (grid.type!=='overflow' || y<raw.length*6) ) {
        const rows=grid.rows;
        if (grid.type==='overflow') grid.rows=Math.max(rows,y+footprint(entry).height);
        if (canPlaceItem(grid,entry,x,y,rotation)) {
          place(grid,entry,{x,y,rotation}); dest.push(entry); continue;
        }
        grid.rows=rows;
      }
      if (row.version===1 || row.version===2) entry.rotation=0;
      displaced.push(entry);
    }
    for (const entry of displaced) {
      if (dest===overflow) retainOverflow(overflow,entry);
      else storeOrOverflow(dest,overflow,entry);
    }
  };
  load(row.overflow,overflow);
  load(row.stash,stash);
  for (const slot of slots) {
    const entry = restore(rawGear[slot]);
    if (!entry) continue;
    if (compatible(slot,entry) && entry.qty===1) {
      delete entry.x;delete entry.y;kit.gear[slot]=entry;
    } else storeOrOverflow(stash,overflow,entry);
  }
  if (row.version!==VERSION && !kit.gear.backpack && (row.active!==true || (Array.isArray(rawKit.bag) && rawKit.bag.length)))
    kit.gear.backpack=stack('packLegacy');
  if (row.version!==VERSION) load(rawKit.bag,kit.bag);
  if (Array.isArray(rawKit.pockets)) rawKit.pockets.forEach((p,i)=>load(p,kit.pockets?.[i] ?? overflow));
  const bindings=record(rawKit.quick);
  for (const key of ['4','5','6','7']) {
    const id=bindings[key];
    if (typeof id==='string' && quickGrids(kit).flat().some(entry=>entry.key===id && items[entry.id].kind==='medical'))
      kit.quick![key]=id;
  }
  return {
    version:VERSION, credits:integer(row.credits,0), stash,overflow,kit,stats,active:row.active === true,
    settings:{volume:number(config.volume, defaults.volume,0,1), sensitivity:number(config.sensitivity,1,.25,2.5),
      resolution:config.resolution === 2 ? 2 : 1, bob:config.bob !== false, subtitles:config.subtitles !== false},
  };
}

export class Saves {
  profile:Profile;
  message = '';
  private protectedVersion = false;
  private storage?:Pick<Storage,'getItem'|'setItem'>;

  constructor(storage?:Pick<Storage,'getItem'|'setItem'>) {
    this.profile = newProfile();
    try {
      this.storage = storage ?? localStorage;
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return;
      const data:unknown = JSON.parse(raw);
      const version = record(data).version;
      if (typeof version === 'number' && version > VERSION) {
        this.protectedVersion = true;
        this.message = '检测到较新版本的存档。本次进度仅保留到关闭页面，原存档可在设置中重置。';
        return;
      }
      this.profile = decode(data);
      if (this.profile.active) {
        this.profile.active = false;
        this.message = '上次行动中断。随身装备按弃离处理。';
        this.write();
      } else if (version !== VERSION || JSON.stringify(this.profile)!==JSON.stringify(data)) {
        this.write();
      }
    } catch {
      this.message = '存档无法读取，已开启新的档案。';
      try {
        if (!this.storage) throw new Error('Storage unavailable');
        const raw = this.storage.getItem(SAVE_KEY);
        if (raw) this.storage.setItem(SAVE_KEY + '.recovery',raw);
      } catch {
        this.message = '本地存储不可用，进度仅保留在本次页面。';
      }
    }
  }

  write() {
    if (this.protectedVersion) return true;
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(SAVE_KEY,JSON.stringify(this.profile));
      return true;
    } catch {
      this.message = '本地存储写入失败，当前进度可能在关闭页面后丢失。';
      return false;
    }
  }

  reset() {
    this.protectedVersion = false;
    this.profile = newProfile();
    this.message = '';
    this.write();
  }

  deploy():Kit {
    const kit = this.profile.kit;
    this.profile.kit = emptyKit();
    this.profile.active = true;
    this.profile.stats.raids++;
    this.write();
    return kit;
  }

  finish(result:Result, kit:Kit) {
    const profile = this.profile;
    if (!profile.active) return;
    profile.active = false;
    profile.stats.kills += result.kills;
    if (result.outcome === 'escaped') {
      profile.stats.escapes++;
      for (const entry of kitEntries(kit)) delete entry.found;
      profile.kit = kit;
    }
    this.write();
  }
}

export function needsRelief(profile:Profile) {
  return profile.credits<items.k9.price && ![...kitEntries(profile.kit),...profile.stash,...profile.overflow]
    .some(entry=>items[entry.id].kind==='weapon');
}

/* 仓库满时，只有「能并进已有堆」的物资还放得下。
   买入走这条判断；撤离带回不拦，允许溢出后再让玩家自己清理。 */
export function stashHasRoom(profile:Profile,id:ItemId,qty=1) {
  const forecast=profile.stash.map(entry=>({...entry}));
  registerInventory(forecast,'stash');
  return insert(forecast,stack(id,qty))===qty;
}

export function supplyRelief(profile:Profile) {
  if (!needsRelief(profile)) return false;
  profile.kit.gear.secondary = stack('k9');
  storeOrOverflow(profile.stash,profile.overflow,stack('9mm',18));
  storeOrOverflow(profile.stash,profile.overflow,stack('bandage'));
  return true;
}
