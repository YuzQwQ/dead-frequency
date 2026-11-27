import { inventorySizes, items } from './data.ts';
import type { LootKind } from './data.ts';
import type { SlotTarget, Stack } from './inventory.ts';

export type Rotation=0|90;
export type Placement={x:number;y:number;rotation:Rotation};
export type InventoryType=keyof typeof inventorySizes;
export type Inventory={inventoryId:string;type:InventoryType;columns:number;rows:number;items:Stack[];
  accepts?:(item:Stack)=>boolean;slotTarget?:SlotTarget};
const inventories=new WeakMap<Stack[],Inventory>();
export const gridOf=(entries:Stack[])=>inventories.get(entries);
export const containerType:Record<LootKind,InventoryType>={
  tool:'toolbox',file:'drawer',supply:'supply',medical:'supply',sealed:'safe',corpse:'storage',
  anomaly:'safe',drop:'storage',
};
export function registerInventory(entries:Stack[],type:InventoryType,inventoryId:string=type, accepts?:Inventory['accepts']) {
  const [columns,rows]=inventorySizes[type];
  const grid={inventoryId,type,columns,rows,items:entries,accepts};
  inventories.set(entries,grid);
  return grid;
}

export function footprint(item:Stack,rotation:Rotation=item.rotation ?? 0) {
  const {width,height}=items[item.id];
  return rotation===90 ? {width:height,height:width} : {width,height};
}

export function canPlaceItem(grid:Inventory,item:Stack,x:number,y:number,rotation:Rotation,ignore?:string) {
  const {width,height}=footprint(item,rotation);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x<0 || y<0 || x+width>grid.columns ||
    y+height>grid.rows || (rotation!==0 && (rotation!==90 || !items[item.id].rotatable)) ||
    grid.accepts?.(item)===false) return false;
  return grid.items.every(other=>{
    if (other.key===ignore || other.x===undefined || other.y===undefined) return true;
    const size=footprint(other);
    return x+width<=other.x || other.x+size.width<=x || y+height<=other.y || other.y+size.height<=y;
  });
}

export function findAvailablePosition(grid:Inventory,item:Stack):Placement|undefined {
  const rotation=item.rotation===90 && items[item.id].rotatable ? 90 : 0;
  const {width,height}=footprint(item,0);
  const rotations:Rotation[]=items[item.id].rotatable && width!==height ? [rotation,rotation===0 ? 90 : 0] : [rotation];
  for (const direction of rotations)
    for (let y=0;y<grid.rows;y++)
      for (let x=0;x<grid.columns;x++)
        if (canPlaceItem(grid,item,x,y,direction)) return {x,y,rotation:direction};
}

export function place(grid:Inventory,item:Stack,position:Placement) {
  Object.assign(item,position,{inventoryId:grid.inventoryId});
}

export function canStack(a:Stack,b:Stack) {
  return a.id===b.id && items[a.id].maxStack>1 && Boolean(a.found)===Boolean(b.found) &&
    a.rounds===b.rounds && a.integrity===b.integrity;
}

export function targetedStack(grid:Inventory,item:Stack,x:number,y:number) {
  return grid.items.find(other=>{
    if (other===item || !canStack(item,other) || other.qty>=items[item.id].maxStack ||
      other.x===undefined || other.y===undefined) return false;
    const {width,height}=footprint(other);
    return x>=other.x && x<other.x+width && y>=other.y && y<other.y+height;
  });
}

export function movePlaced(source:Inventory,target:Inventory,item:Stack,position:Placement,mergeCell?:{x:number;y:number}) {
  const index=source.items.indexOf(item);
  if (index<0 || target.accepts?.(item)===false || (target.type==='overflow' && source!==target)) return false;
  const point=mergeCell ?? position;
  const merge=targetedStack(target,item,point.x,point.y);
  if (merge) {
    const qty=Math.min(item.qty,items[item.id].maxStack-merge.qty);
    merge.qty+=qty;
    item.qty-=qty;
    if (!item.qty) source.items.splice(index,1);
    return true;
  }
  if (!canPlaceItem(target,item,position.x,position.y,position.rotation,source===target ? item.key : undefined)) return false;
  if (source!==target) {
    source.items.splice(index,1);
    target.items.push(item);
  }
  place(target,item,position);
  return true;
}
