import { items } from './data.ts';
import { canPlaceItem, footprint, targetedStack } from './grid-inventory.ts';
import type { Inventory, Placement } from './grid-inventory.ts';
import type { Stack } from './inventory.ts';

export const inventoryDragConfig={holdMs:120,threshold:4};
export type GridMove={source:Inventory;target:Inventory;item:Stack;position:Placement;mergeCell:{x:number;y:number}};

export function GridInventory(grid:Inventory,visible:Stack[],render:(item:Stack)=>string) {
  return `<div class="inventory-scroll"><div class="inventory-grid" data-grid="${grid.inventoryId}"
    style="--columns:${grid.columns};--rows:${grid.rows}">${visible.map(item=>{
      if (item.x===undefined || item.y===undefined) return '';
      const {width,height}=footprint(item);
      return `<div class="inventory-item" data-rotated="${item.rotation===90}"
        style="grid-column:${item.x+1}/span ${width};grid-row:${item.y+1}/span ${height};--icon-cols:${width};--icon-rows:${height}">${render(item)}</div>`;
    }).join('')}</div></div>`;
}

type Drag={source:Inventory;item:Stack;tile:HTMLElement;anchorX:number;anchorY:number;
  startX:number;startY:number;px:number;py:number;rotation:0|90;pointer:number;active:boolean;unit:number};

export class InventoryDrag {
  private drag?:Drag;
  private ghost=document.createElement('div');
  private highlight=document.createElement('div');
  private controller=new AbortController();
  private timer=0;
  private scrollFrame=0;
  private suppressClick=false;
  get active() { return this.drag?.active ?? false; }

  constructor(private host:HTMLElement,private lookup:(id:string)=>Inventory|undefined,
    private commit:(move:GridMove)=>void,private hideLayers:()=>void,private checkSpecial:(move:GridMove)=>boolean) {
    const {signal}=this.controller;
    this.ghost.className='inventory-ghost';
    this.highlight.className='inventory-highlight';
    host.addEventListener('pointerdown',this.down,{signal});
    window.addEventListener('pointermove',this.move,{signal});
    window.addEventListener('pointerup',this.up,{signal});
    window.addEventListener('pointercancel',()=>this.cancel(),{signal});
    window.addEventListener('blur',()=>this.cancel(),{signal});
    window.addEventListener('pointerout',event=>{if (!event.relatedTarget) this.cancel();},{signal});
    document.addEventListener('visibilitychange',()=>{if (document.hidden) this.cancel();},{signal});
    document.addEventListener('scroll',()=>{if (this.drag?.active) this.draw();},{capture:true,signal});
    document.addEventListener('keydown',event=>{
      const drag=this.drag;
      if (event.code==='Escape' && drag) {
        this.cancel();event.preventDefault();event.stopImmediatePropagation();return;
      }
      if (event.code!=='KeyR' || !drag?.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const {width,height}=footprint(drag.item,drag.rotation);
      if (event.repeat || !items[drag.item.id].rotatable || width===height) return;
      const {anchorX,anchorY}=drag;
      if (drag.rotation===0) {
        drag.anchorX=height-anchorY;drag.anchorY=anchorX;drag.rotation=90;
      } else {
        drag.anchorX=anchorY;drag.anchorY=width-anchorX;drag.rotation=0;
      }
      this.draw();
    },{capture:true,signal});
    host.addEventListener('contextmenu',event=>{
      if (this.drag?.active) {event.preventDefault();event.stopImmediatePropagation();}
    },{capture:true,signal});
    for (const type of ['click','dblclick']) host.addEventListener(type,event=>{
      if (!this.suppressClick) return;
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,signal});
  }

  private down=(event:PointerEvent)=>{
    if (event.button!==0 || event.altKey || event.ctrlKey || this.drag) return;
    const cell=(event.target as HTMLElement).closest<HTMLElement>('.inventory-item .cell');
    const tile=cell?.parentElement;
    const element=tile?.closest<HTMLElement>('[data-grid]');
    const source=element?.dataset.grid && this.lookup(element.dataset.grid);
    const item=source && source.items.find(row=>row.key===cell?.dataset.key);
    if (!source || !item || !tile || !element) return;
    const box=tile.getBoundingClientRect();
    const unit=source.slotTarget ? parseFloat(getComputedStyle(element).getPropertyValue('--inventory-cell')) || 42
      : element.getBoundingClientRect().width/source.columns;
    const size=footprint(item,source.slotTarget ? 0 : item.rotation);
    const anchorX=source.slotTarget ? (event.clientX-box.left)/box.width*size.width : (event.clientX-box.left)/unit;
    const anchorY=source.slotTarget ? (event.clientY-box.top)/box.height*size.height : (event.clientY-box.top)/unit;
    this.drag={source,item,tile,unit,anchorX,anchorY,
      startX:event.clientX,startY:event.clientY,px:event.clientX,py:event.clientY,rotation:item.rotation ?? 0,
      pointer:event.pointerId,active:false};
    if (source.slotTarget) this.drag.rotation=0;
    this.timer=window.setTimeout(()=>this.start(),inventoryDragConfig.holdMs);
  };

  private start() {
    const drag=this.drag;
    if (!drag || !drag.tile.isConnected) { this.cancel();return; }
    if (drag.active) return;
    drag.active=true;
    this.hideLayers();
    drag.tile.classList.add('inventory-origin');
    const face=drag.tile.firstElementChild!.cloneNode(true) as HTMLElement;
    face.removeAttribute('title');face.removeAttribute('role');face.removeAttribute('tabindex');
    this.ghost.replaceChildren(face);
    document.body.append(this.ghost,this.highlight);
    this.draw();
    this.scrollFrame=requestAnimationFrame(this.autoScroll);
  }

  private autoScroll=()=>{
    const drag=this.drag;
    if (!drag?.active) return;
    let target=document.elementFromPoint(drag.px,drag.py)?.closest<HTMLElement>('.inventory-scroll,[data-inventory-scroll],.equipment-content');
    while (target) {
      const rect=target.getBoundingClientRect();
      const edge=36;
      const velocity=(point:number,min:number,max:number)=>point<min+edge ? -Math.min(16,(min+edge-point)*.35)
        : point>max-edge ? Math.min(16,(point-max+edge)*.35) : 0;
      const before=[target.scrollLeft,target.scrollTop];
      if (target.scrollWidth>target.clientWidth && rect.width>edge*2)
        target.scrollLeft+=velocity(drag.px,rect.left,rect.right);
      if (target.scrollHeight>target.clientHeight && rect.height>edge*2) {
        const clip=target.closest('[data-inventory-scroll]')?.getBoundingClientRect();
        target.scrollTop+=velocity(drag.py,Math.max(rect.top,clip?.top ?? 0),Math.min(rect.bottom,clip?.bottom ?? innerHeight));
      }
      if (before[0]!==target.scrollLeft || before[1]!==target.scrollTop) break;
      target=target.parentElement?.closest<HTMLElement>('[data-inventory-scroll],.equipment-content') ?? undefined;
    }
    this.scrollFrame=requestAnimationFrame(this.autoScroll);
  };

  private move=(event:PointerEvent)=>{
    const drag=this.drag;
    if (!drag || event.pointerId!==drag.pointer) return;
    drag.px=event.clientX;drag.py=event.clientY;
    if (!drag.active && Math.hypot(drag.px-drag.startX,drag.py-drag.startY)>=inventoryDragConfig.threshold) this.start();
    if (drag.active) this.draw();
  };

  private target(drag:Drag) {
    const element=document.elementFromPoint(drag.px,drag.py)?.closest<HTMLElement>('[data-grid]');
    const target=element?.dataset.grid && this.lookup(element.dataset.grid);
    if (!element || !target) return;
    const box=element.getBoundingClientRect(),unit=box.width/target.columns;
    const cx=(drag.px-box.left)/unit,cy=(drag.py-box.top)/unit;
    const mergeCell={x:Math.floor(cx),y:Math.floor(cy)};
    const position={x:Math.floor(cx-drag.anchorX+1e-4),y:Math.floor(cy-drag.anchorY+1e-4),rotation:drag.rotation};
    const accepts=(target.type!=='overflow'||drag.source===target) && target.accepts?.(drag.item)!==false;
    const merge=accepts && targetedStack(target,drag.item,mergeCell.x,mergeCell.y);
    const allowed=drag.source.slotTarget || target.slotTarget
      ? this.checkSpecial({source:drag.source,item:drag.item,target,position,mergeCell})
      : accepts && Boolean(merge || canPlaceItem(target,drag.item,position.x,position.y,position.rotation,
        drag.source===target ? drag.item.key : undefined));
    return {target,position,mergeCell,allowed,element,box,unit,merge};
  }

  private draw() {
    const drag=this.drag;
    if (!drag) return;
    if (!drag.tile.isConnected) {this.cancel();return;}
    const size=footprint(drag.item,drag.rotation);
    this.ghost.dataset.rotated=String(drag.rotation===90);
    this.ghost.style.setProperty('--icon-cols',String(size.width));
    this.ghost.style.setProperty('--icon-rows',String(size.height));
    this.ghost.style.setProperty('--inventory-cell',`${drag.unit}px`);
    Object.assign(this.ghost.style,{left:`${drag.px-drag.anchorX*drag.unit}px`,top:`${drag.py-drag.anchorY*drag.unit}px`,
      width:`${size.width*drag.unit}px`,height:`${size.height*drag.unit}px`});
    const hit=this.target(drag);
    this.highlight.hidden=!hit;
    if (!hit) return;
    hit.element.append(this.highlight);
    const {unit,allowed,position,merge,box}=hit;
    const x=hit.target.slotTarget ? 0 : merge ? merge.x! : position.x;
    const y=hit.target.slotTarget ? 0 : merge ? merge.y! : position.y;
    const area=hit.target.slotTarget ? {width:1,height:1} : merge ? footprint(merge) : size;
    this.highlight.classList.toggle('valid',allowed);
    Object.assign(this.highlight.style,{left:`${x*unit}px`,top:`${y*unit}px`,
      width:`${hit.target.slotTarget ? box.width : area.width*unit}px`,height:`${hit.target.slotTarget ? box.height : area.height*unit}px`});
  }

  private up=(event:PointerEvent)=>{
    const drag=this.drag;
    if (!drag || event.pointerId!==drag.pointer) return;
    drag.px=event.clientX;drag.py=event.clientY;
    const hit=drag.active && drag.tile.isConnected ? this.target(drag) : undefined;
    this.cancel();
    if (hit?.allowed) this.commit({source:drag.source,item:drag.item,target:hit.target,position:hit.position,mergeCell:hit.mergeCell});
  };

  cancel() {
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.scrollFrame);
    const drag=this.drag;
    this.drag=undefined;
    if (drag?.active) {
      drag.tile.classList.remove('inventory-origin');
      this.suppressClick=true;
      window.setTimeout(()=>{this.suppressClick=false;},0);
    }
    this.ghost.remove();
    this.highlight.remove();
  }

  dispose() { this.cancel();this.controller.abort(); }
}
