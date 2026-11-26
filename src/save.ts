import { armor, BAG_CAPACITY, items, slots, STASH_CAPACITY, weapons } from './data.ts';
import type { ArmorId, ItemId, WeaponId } from './data.ts';
import { compatible, insert, kitEntries, stack } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';

export const SAVE_KEY = 'dead-frequency.profile';
const VERSION = 2;
export type Settings = { volume:number; sensitivity:number; resolution:number; bob:boolean; subtitles:boolean };
type Stats = { raids:number; escapes:number; kills:number; earnings:number };
export type Profile = {
  version:number; credits:number; stash:Stack[]; kit:Kit; settings:Settings;
  stats:Stats; active:boolean;
};
export type Result = {
  outcome:'escaped' | 'dead' | 'timeout' | 'abandoned'; exit?:string;
  elapsed:number; kills:number; searched:number; found:number; haul:number; lost:number;
};
export const defaults:Settings = {volume:.55, sensitivity:1, resolution:1, bob:true, subtitles:true};

export function newProfile():Profile {
  return {
    version:VERSION, credits:900, active:false,
    stash:[stack('p12'), stack('12g',10), stack('9mm',24), stack('bandage',2)],
    kit:{gear:{secondary:stack('k9'), armor:stack('vest')}, bag:[stack('9mm',24),stack('bandage',2)]},
    settings:{...defaults}, stats:{raids:0,escapes:0,kills:0,earnings:0},
  };
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
  const qty = integer(row.qty,1,0,items[id].stack);
  if (!qty) return null;
  const entry = stack(id,qty);
  if (entry.rounds !== undefined) entry.rounds = integer(row.rounds,entry.rounds,0,weapons[id as WeaponId].capacity);
  if (entry.integrity !== undefined) entry.integrity = number(row.integrity,entry.integrity,0,armor[id as ArmorId].durability);
  return entry;
}

export function decode(value:unknown):Profile {
  const row = record(value);
  if (row.version !== 1 && row.version !== VERSION) throw new Error('不支持的存档版本');
  if (!Array.isArray(row.stash) || !row.kit || !row.stats || !row.settings || typeof row.credits !== 'number') {
    throw new Error('缺少存档字段');
  }
  const rawKit = record(row.kit);
  const rawGear = record(rawKit.gear);
  const rawStats = record(row.stats);
  const config = record(row.settings);
  const stats = {raids:integer(rawStats.raids,0), escapes:integer(rawStats.escapes,0),
    kills:integer(rawStats.kills,0), earnings:integer(rawStats.earnings,0)};
  const stash:Stack[] = [];
  const kit:Kit = {gear:{},bag:[]};
  for (const value of row.stash) {
    const entry = restoreEntry(value);
    if (entry) insert(stash,entry);
  }
  for (const slot of slots) {
    const entry = restoreEntry(rawGear[slot]);
    if (!entry) continue;
    if (compatible(slot,entry)) kit.gear[slot] = entry;
    else insert(stash,entry);
  }
  for (const value of Array.isArray(rawKit.bag) ? rawKit.bag : []) {
    const entry = restoreEntry(value);
    if (!entry) continue;
    const moved = insert(kit.bag,entry,BAG_CAPACITY);
    if (moved < entry.qty) insert(stash,{...entry, key:stack(entry.id).key, qty:entry.qty-moved});
  }
  return {
    version:VERSION, credits:integer(row.credits,0), stash, kit, stats, active:row.active === true,
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
      } else if (version !== VERSION) {
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
    this.profile.kit = {gear:{},bag:[]};
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
      const bag:Stack[] = [];
      for (const entry of kit.bag) {
        if (entry.found) insert(profile.stash,{...entry,found:false});
        else insert(bag,entry,BAG_CAPACITY);
      }
      for (const entry of kitEntries({gear:kit.gear,bag:[]})) delete entry.found;
      profile.kit = {gear:kit.gear,bag};
    }
    this.write();
  }
}

export function needsRelief(profile:Profile) {
  return profile.credits < items.k9.price && ![...kitEntries(profile.kit), ...profile.stash].some(entry => items[entry.id].kind === 'weapon');
}

/* 仓库满时，只有「能并进已有堆」的物资还放得下。
   买入走这条判断；撤离带回不拦，允许溢出后再让玩家自己清理。 */
export function stashHasRoom(profile:Profile, id:ItemId) {
  if (profile.stash.length < STASH_CAPACITY) return true;
  return profile.stash.some(entry => entry.id === id && entry.qty < items[id].stack);
}

export function supplyRelief(profile:Profile) {
  if (!needsRelief(profile)) return false;
  profile.kit.gear.secondary = stack('k9');
  insert(profile.stash,stack('9mm',18));
  insert(profile.stash,stack('bandage'));
  return true;
}
