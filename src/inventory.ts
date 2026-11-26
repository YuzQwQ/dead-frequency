import { armor, BAG_CAPACITY, items, lootTables, slots, weapons } from './data.ts';
import type { ArmorId, ItemId, LootKind, Slot, WeaponId } from './data.ts';

export type Stack = { key:string; id:ItemId; qty:number; rounds?:number; integrity?:number; found?:boolean };
export type Kit = { gear:Partial<Record<Slot,Stack>>; bag:Stack[] };
let sequence = 0;

export function stack(id:ItemId, qty=1, found=false):Stack {
  const entry:Stack = {key:crypto.randomUUID?.() ?? Date.now().toString(36) + '-' + (sequence++).toString(36), id, qty};
  if (items[id].kind === 'weapon') entry.rounds = weapons[id as WeaponId].capacity;
  if (items[id].kind === 'armor') entry.integrity = armor[id as ArmorId].durability;
  if (found) entry.found = true;
  return entry;
}

export const compatible = (slot:Slot, entry:Stack) => slot === 'armor'
  ? items[entry.id].kind === 'armor'
  : items[entry.id].kind === 'weapon' && (slot === 'primary' || entry.id === 'k9');
export const usedSpace = (entries:Stack[]) => entries.reduce((total, entry) => total + items[entry.id].size, 0);
export const inventoryCount = (entries:Stack[], id:ItemId) => entries.reduce((sum, entry) => sum + (entry.id === id ? entry.qty : 0), 0);
export const takeValue = (entry:Stack) => entry.qty * sellPrice(entry);

export function sellPrice(entry:Stack) {
  const def = items[entry.id];
  const factor = def.kind === 'salvage' ? .8 : .54;
  const condition = entry.integrity === undefined ? 1 : .22 + .78 * entry.integrity / armor[entry.id as ArmorId].durability;
  return Math.max(1, Math.floor(def.price * factor * condition));
}

export function insert(entries:Stack[], entry:Stack, capacity=Infinity):number {
  const def = items[entry.id];
  let remaining = entry.qty;
  if (def.stack > 1) {
    for (const existing of entries) {
      if (existing.id !== entry.id || Boolean(existing.found) !== Boolean(entry.found)) continue;
      const added = Math.min(def.stack - existing.qty, remaining);
      existing.qty += added;
      remaining -= added;
      if (!remaining) return entry.qty;
    }
  }
  let free = capacity - usedSpace(entries);
  while (remaining > 0 && free >= def.size) {
    const qty = Math.min(remaining, def.stack);
    entries.push({...entry, key:remaining === entry.qty && qty === entry.qty ? entry.key : stack(entry.id).key, qty});
    remaining -= qty;
    free -= def.size;
  }
  return entry.qty - remaining;
}

export function remove(entries:Stack[], entry:Stack, qty:number) {
  const index = entries.indexOf(entry);
  if (index < 0 || qty <= 0) return;
  entry.qty -= qty;
  if (entry.qty <= 0) entries.splice(index, 1);
}

export function transfer(source:Stack[], dest:Stack[], entry:Stack, capacity=Infinity) {
  if (source === dest || !source.includes(entry)) return 0;
  const count = insert(dest, entry, capacity);
  remove(source, entry, count);
  return count;
}

export function spend(entries:Stack[], id:ItemId, amount:number) {
  let remaining = amount;
  // Prefer the original supplies so newly recovered ammunition can contribute to the haul.
  for (const found of [false,true]) {
    for (let i = entries.length - 1; i >= 0 && remaining > 0; i--) {
      const entry = entries[i];
      if (entry.id !== id || Boolean(entry.found) !== found) continue;
      const qty = Math.min(entry.qty, remaining);
      remove(entries, entry, qty);
      remaining -= qty;
    }
  }
  return amount - remaining;
}

export function equip(kit:Kit, source:Stack[], slot:Slot, entry:Stack):boolean {
  if (!compatible(slot, entry) || !source.includes(entry)) return false;
  const previous = kit.gear[slot];
  const cost = previous ? items[previous.id].size : 0;
  if (source === kit.bag && usedSpace(source) - items[entry.id].size + cost > BAG_CAPACITY) return false;
  const equipped = {...entry};
  remove(source, entry, 1);
  if (previous) insert(source, previous);
  kit.gear[slot] = equipped;
  return true;
}

export function unequip(kit:Kit, dest:Stack[], slot:Slot) {
  const entry = kit.gear[slot];
  if (!entry || !insert(dest, entry, dest === kit.bag ? BAG_CAPACITY : Infinity)) return false;
  delete kit.gear[slot];
  return true;
}

export function kitEntries(kit:Kit) {
  return [...slots.flatMap(slot => kit.gear[slot] ? [kit.gear[slot]!] : []), ...kit.bag];
}

export function rollLoot(kind:Exclude<LootKind,'drop'>, random=Math.random) {
  const {count:[min,max], pool} = lootTables[kind];
  const entries:Stack[] = [];
  const choices = pool.slice();
  const draws = min + Math.floor(random() * (max - min + 1));
  for (let i=0; i<draws && choices.length; i++) {
    let roll = random() * choices.reduce((sum, row) => sum + row[1], 0);
    const index = choices.findIndex(row => (roll -= row[1]) < 0);
    const [[id,,low=1,high=low]] = choices.splice(index,1);
    insert(entries, stack(id, low + Math.floor(random() * (high - low + 1)), true));
  }
  return entries;
}
