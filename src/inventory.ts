import { armor, headsets, helmets, items, lootTables, slots, storageTypes, weapons } from './data.ts';
import type { ArmorId, ItemId, LootKind, Slot, WeaponId } from './data.ts';
import { canPlaceItem, canStack, containerType, findAvailablePosition, gridOf, place, registerInventory } from './grid-inventory.ts';
import type { Inventory, Placement, Rotation } from './grid-inventory.ts';

export type Stack = { key:string; id:ItemId; qty:number; rounds?:number; integrity?:number; found?:boolean;
  inventoryId?:string; x?:number; y?:number; rotation?:Rotation; contents?:Stack[][] };
export type Kit = { gear:Partial<Record<Slot,Stack>>; bag:Stack[]; characterId?:string; pockets?:Stack[][]; quick?:Record<string,string> };
let sequence = 0;

export function stack(id:ItemId, qty=1, found=false):Stack {
  const entry:Stack = {key:crypto.randomUUID?.() ?? Date.now().toString(36) + '-' + (sequence++).toString(36), id, qty};
  if (items[id].kind === 'weapon') entry.rounds = weapons[id as WeaponId].capacity;
  if (items[id].kind === 'armor') entry.integrity = armor[id as ArmorId].durability;
  if (Object.hasOwn(helmets,id)) entry.integrity=helmets[id as keyof typeof helmets].durability;
  if (found) entry.found = true;
  bindContents(entry);
  return entry;
}

export const isStorage=(entry:Stack)=>Object.hasOwn(storageTypes,entry.id);
export const isLoaded=(entry:Stack)=>Boolean(entry.contents?.some(grid=>grid.length));
export function bindContents(entry:Stack) {
  if (!isStorage(entry)) return;
  const types=storageTypes[entry.id as keyof typeof storageTypes];
  entry.contents??=types.map(()=>[]);
  types.forEach((type,index)=>{
    registerInventory(entry.contents![index],type,`${entry.key}:${index}`,item=>!isStorage(item));
  });
}

export function characterKit(characterId:string):Kit {
  const pockets=Array.from({length:4},()=>[] as Stack[]);
  pockets.forEach((entries,index)=>registerInventory(entries,'pocket',`${characterId}:pocket:${index}`,item=>!isStorage(item)));
  const kit={characterId,pockets,quick:{},gear:{}} as Kit;
  const unavailable:Stack[]=[];
  registerInventory(unavailable,'pocket',`${characterId}:empty`,()=>false);
  Object.defineProperty(kit,'bag',{get:()=>kit.gear.backpack?.contents?.[0] ?? unavailable});
  return kit;
}

export function quickGrids(kit:Kit) {
  return [...(kit.gear.rig?.contents ?? []),...(kit.pockets ?? [])];
}
export function pruneQuick(kit:Kit) {
  if (!kit.quick) return;
  for (const key of Object.keys(kit.quick)) {
    if (!quickGrids(kit).some(grid=>grid.some(item=>item.key===kit.quick![key] && items[item.id].kind==='medical')))
      delete kit.quick[key];
  }
}

export const defaultHearing={range:1,steps:1,ambient:1,loud:1};
export function hearingFor(kit:Kit) {
  const headset=kit.gear.headset?.id as keyof typeof headsets;
  const helmet=kit.gear.helmet?.id as keyof typeof helmets;
  const hearing=headsets[headset] ?? defaultHearing;
  return {...hearing,range:hearing.range*(helmets[helmet]?.hearing ?? 1)};
}
export function carriedGrids(kit:Kit) {
  return [...(kit.pockets ?? []),...(kit.gear.rig?.contents ?? []),
    ...(kit.characterId ? kit.gear.backpack?.contents ?? [] : [kit.bag])];
}
export function packItem(kit:Kit,item:Stack) {
  const storage=kit.characterId ? kit.gear.backpack?.contents ?? [] : [kit.bag];
  const preferred=items[item.id].kind==='ammo' || items[item.id].kind==='medical';
  return preferred ? [...quickGrids(kit),...storage] : [...storage,...quickGrids(kit)];
}
export const compatible=(slot:Slot,entry:Stack)=>slot==='primary'||slot==='secondary'
  ? items[entry.id].kind==='weapon' && (slot==='primary'||entry.id==='k9')
  : items[entry.id].kind===slot;
export const usedSpace = (entries:Stack[]) => entries.reduce((total, entry) => {
  const {width,height}=items[entry.id]; return total+width*height;
},0);
export const inventoryCount = (entries:Stack[], id:ItemId) => entries.reduce((sum, entry) => sum + (entry.id === id ? entry.qty : 0), 0);
export const takeValue = (entry:Stack) => entry.qty * sellPrice(entry);

export function protectedDamage(kit:Kit,amount:number,region:'head'|'body') {
  const equipped=kit.gear[region==='head'?'helmet':'armor'];
  if (!equipped?.integrity) return amount;
  const protection=region==='head' ? helmets[equipped.id as keyof typeof helmets]?.protection : armor[equipped.id as ArmorId]?.protection;
  const absorbed=Math.min(equipped.integrity,amount*(protection ?? 0));
  equipped.integrity=Math.max(0,equipped.integrity-absorbed*1.7);
  return amount-absorbed;
}

export const enemyLoadouts=[
  {weight:70,helmetChance:.28,helmet:'helmetLight',armorChance:.45,armor:'vest',rig:'rigLight',pack:'packSmall',headset:undefined},
  {weight:25,helmetChance:.70,helmet:'helmetLight',armorChance:.85,armor:'vest',rig:'rigStandard',pack:'packTactical',headset:'headsetScout'},
  {weight:5,helmetChance:1,helmet:'helmetHeavy',armorChance:1,armor:'plate',rig:'rigUtility',pack:'packTactical',headset:'headsetQuiet'},
] as const;

export function scavKit(id:string,random:()=>number):Kit {
  const kit=characterKit(id);
  let roll=random()*100;
  const loadout=enemyLoadouts.find(config=>(roll-=config.weight)<0) ?? enemyLoadouts[0];
  kit.gear.primary=stack('ar56',1,true);
  if (random()<loadout.helmetChance) kit.gear.helmet=stack(loadout.helmet,1,true);
  if (random()<loadout.armorChance) kit.gear.armor=stack(loadout.armor,1,true);
  if (loadout.headset) kit.gear.headset=stack(loadout.headset,1,true);
  if (random()<.94) kit.gear.rig=stack(loadout.rig,1,true);
  if (random()<.82) kit.gear.backpack=stack(loadout.pack,1,true);
  const put=(grids:Stack[][],item:Stack)=>grids.some(grid=>insert(grid,item)>0);
  const rig=kit.gear.rig?.contents ?? [];
  const bag=kit.gear.backpack?.contents ?? [];
  const ammo=weapons.ar56.ammo;
  for (let i=0,n=1+Math.floor(random()*2);i<n;i++) put(rig,stack(ammo,6+Math.floor(random()*8),true));
  if (random()<.45) put(rig,stack('bandage',1,true));
  if (random()<.20) put(rig,stack('relay',1,true));
  for (let i=0,n=1+Math.floor(random()*3);i<n;i++) {
    const salvage=['relay','copper','life06','ind02','intel'] as const;
    put(bag,stack(salvage[Math.floor(random()*salvage.length)],1,true));
  }
  if (random()<.3) put(bag,stack(ammo,8,true));
  if (random()<.25) put(bag,stack('bandage',1,true));
  if (loadout.weight===5 && random()<.08) put(bag,stack('life33',1,true));
  for (let i=0,n=Math.floor(random()*3);i<n;i++)
    put(kit.pockets!,random()<.45 ? stack(ammo,3,true) : stack('bandage',1,true));
  return kit;
}

export function sellPrice(entry:Stack) {
  const def = items[entry.id];
  const factor = def.kind === 'salvage' ? .8 : .54;
  const durability=armor[entry.id as ArmorId]?.durability ?? helmets[entry.id as keyof typeof helmets]?.durability;
  const condition = entry.integrity === undefined || !durability ? 1 : .22 + .78 * entry.integrity / durability;
  return Math.max(1, Math.floor(def.price * factor * condition));
}

export function insert(entries:Stack[], entry:Stack):number {
  const def = items[entry.id];
  const grid=gridOf(entries);
  if (entries.includes(entry) || grid?.accepts?.(entry)===false) return 0;
  let remaining = entry.qty;
  if (def.stack > 1) {
    for (const existing of entries) {
      if (existing===entry || !canStack(existing,entry)) continue;
      const added = Math.min(def.stack - existing.qty, remaining);
      existing.qty += added;
      remaining -= added;
      if (!remaining) return entry.qty;
    }
  }
  while (remaining>0) {
    const position=grid && findAvailablePosition(grid,entry);
    if (grid && !position) break;
    const qty = Math.min(remaining, def.stack);
    const placed={...entry,key:remaining===entry.qty && qty===entry.qty ? entry.key : stack(entry.id).key,qty};
    if (grid && position) place(grid,placed,position);
    entries.push(placed);
    remaining -= qty;
  }
  return entry.qty - remaining;
}

export function remove(entries:Stack[], entry:Stack, qty:number) {
  const index = entries.indexOf(entry);
  if (index < 0 || qty <= 0) return;
  entry.qty -= qty;
  if (entry.qty <= 0) entries.splice(index, 1);
}

export function transfer(source:Stack[], dest:Stack[], entry:Stack) {
  if (source === dest || !source.includes(entry)) return 0;
  const count = insert(dest,entry);
  remove(source, entry, count);
  return count;
}

export function transferAcross(source:Stack[],destinations:Stack[][],entry:Stack) {
  if (!source.includes(entry)) return 0;
  const targets=destinations.filter(dest=>dest!==source && gridOf(dest)?.accepts?.(entry)!==false);
  let moved=0;
  for (const dest of targets) {
    for (const existing of dest) {
      if (!canStack(existing,entry)) continue;
      const count=Math.max(0,Math.min(items[entry.id].maxStack-existing.qty,entry.qty));
      existing.qty+=count;remove(source,entry,count);moved+=count;
      if (!entry.qty) return moved;
    }
  }
  for (const dest of targets) moved+=transfer(source,dest,entry);
  return moved;
}

export function splitStack(source:Stack[],entry:Stack,qty:number) {
  const grid=gridOf(source);
  if (!grid || !source.includes(entry) || !Number.isInteger(qty) || qty<1 || qty>=entry.qty || items[entry.id].maxStack===1) return false;
  const at=findAvailablePosition(grid,entry);
  if (!at) return false;
  const piece={...entry,key:stack(entry.id).key,qty};
  place(grid,piece,at);
  entry.qty-=qty;source.push(piece);
  return true;
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
  const grid=gridOf(source);
  const vacated=grid && {...grid,items:source.filter(item=>item!==entry)};
  const room=previous && vacated ? findAvailablePosition(vacated,previous) : undefined;
  if (previous && vacated && !room) return false;
  const equipped = {...entry};
  delete equipped.inventoryId; delete equipped.x; delete equipped.y;
  remove(source, entry, 1);
  if (previous && grid && room && canPlaceItem(grid,previous,room.x,room.y,room.rotation)) {
    place(grid,previous,room); source.push(previous);
  } else if (previous) insert(source,previous);
  kit.gear[slot] = equipped;
  return true;
}

export function unequip(kit:Kit, dest:Stack[], slot:Slot) {
  const entry = kit.gear[slot];
  if (!entry || !insert(dest,entry)) return false;
  delete kit.gear[slot];
  return true;
}

export function kitEntries(kit:Kit) {
  return [...slots.flatMap(slot=>kit.gear[slot] ? [kit.gear[slot]!] : []),...carriedGrids(kit).flat()];
}
export function kitWeight(kit:Kit) {
  return kitEntries(kit).reduce((total,item)=>total+items[item.id].weight*item.qty,0);
}

export type SlotTarget={kit:Kit;slot:Slot};
export type MoveEndpoint=Inventory|SlotTarget;
const isSlot=(target:MoveEndpoint):target is SlotTarget=>'slot' in target;

export function equipmentMove(source:MoveEndpoint,target:MoveEndpoint,item:Stack,position:Placement,
  fallbacks:Inventory[],commit=false) {
  const fromSlot=isSlot(source),toSlot=isSlot(target);
  if (!fromSlot && !toSlot) return false;
  if (fromSlot ? source.kit.gear[source.slot]!==item : !source.items.includes(item)) return false;
  if (item.qty!==1 || (fromSlot && toSlot && source.kit===target.kit && source.slot===target.slot)) return false;
  if (!toSlot) {
    if (!fromSlot || target.type==='overflow' || !canPlaceItem(target,item,position.x,position.y,position.rotation)) return false;
    if (commit) { delete source.kit.gear[source.slot];place(target,item,position);target.items.push(item); }
    return true;
  }
  if (!compatible(target.slot,item)) return false;
  const old=target.kit.gear[target.slot];
  let destination:{grid:Inventory;at:Placement}|undefined;
  const swapSlot=old && fromSlot && compatible(source.slot,old);
  if (old && !swapSlot) {
    for (const grid of [...(fromSlot ? [] : [source]),...fallbacks]) {
      if (grid.type==='overflow' || item.contents?.includes(grid.items) || old.contents?.includes(grid.items)) continue;
      const available={...grid,items:grid.items.filter(entry=>entry!==item)};
      const exact=grid===source && item.x!==undefined && item.y!==undefined
        ? {x:item.x,y:item.y,rotation:item.rotation ?? 0} : undefined;
      const at=exact && canPlaceItem(available,old,exact.x,exact.y,exact.rotation) ? exact : findAvailablePosition(available,old);
      if (at) {destination={grid,at};break;}
    }
    if (!destination) return false;
  }
  if (commit) {
    if (fromSlot) delete source.kit.gear[source.slot];
    else source.items.splice(source.items.indexOf(item),1);
    if (old && swapSlot && fromSlot) source.kit.gear[source.slot]=old;
    if (old && destination) {
      place(destination.grid,old,destination.at);destination.grid.items.push(old);
    }
    delete item.x;delete item.y;delete item.inventoryId;
    target.kit.gear[target.slot]=item;
  }
  return true;
}

export function rollLoot(kind:Exclude<LootKind,'drop'>, random=Math.random, inventoryId?:string) {
  const {count:[min,max], pool} = lootTables[kind];
  const entries:Stack[] = [];
  registerInventory(entries,containerType[kind],inventoryId,item=>!isLoaded(item));
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
