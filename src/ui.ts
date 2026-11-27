import { armor, headsets, helmets, catNames, items, rarityNames, slots, slotNames, STASH_CAPACITY, vendors, weapons } from './data.ts';
import type { ArmorId, Cat, Slot, WeaponId } from './data.ts';
import { carriedGrids, compatible, isLoaded, isStorage, kitEntries, kitWeight, quickGrids, sellPrice, usedSpace } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';
import { buildings, bounds, exits, obstacles, starts } from './sector.ts';
import type { Point } from './sector.ts';
import { needsRelief } from './save.ts';
import { itemIcon } from './icons.ts';
import type { Profile, Result } from './save.ts';
import type { Cache, HudData } from './raid.ts';
import { gridOf } from './grid-inventory.ts';
import type { Inventory } from './grid-inventory.ts';
import { GridInventory, InventoryDrag } from './grid-inventory-ui.ts';
import type { GridMove } from './grid-inventory-ui.ts';
import { InventoryPreview } from './inventory-preview.ts';
import './inventory-screen.css';

export type Tab = 'brief'|'stash'|'trade'|'settings';
export type PlayPanel = 'pause'|'inventory'|'status'|'map'|null;
type Action = (name:string,id:string,value:string)=>void;
type MenuItem = {label:string; action:string; id?:string; value?:string; danger?:boolean};

/* 仓库筛选口径：装备把武器/弹药/护甲并在一起，剩下的直接按 cat 分。
   pill 上的数字是「格数」不是件数，和右上角容量的单位保持一致。 */
type StashFilter = 'all' | 'gear' | Cat;
type StashSort = 'value' | 'rarity' | 'name' | 'weight';
const stashFilters:{key:StashFilter; name:string}[] = [
  {key:'all', name:'全部'},
  {key:'gear', name:'装备'},
  {key:'med', name:'医疗'},
  {key:'elec', name:'电子'},
  {key:'ind', name:'工业'},
  {key:'mil', name:'军品'},
  {key:'intel', name:'情报'},
  {key:'life', name:'生活'},
  {key:'odd', name:'异常'},
];
const stashSorts:{key:StashSort; name:string}[] = [
  {key:'value', name:'按价值'},
  {key:'rarity', name:'按稀有度'},
  {key:'name', name:'按名称'},
  {key:'weight', name:'按重量'},
];
const inFilter=(cat:Cat, filter:StashFilter) => filter==='all' ? true
  : filter==='gear' ? cat==='weapon' || cat==='ammo' || cat==='armor'
  : cat===filter;
const esc=(text:string) => text.replace(/[&<>"]/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!));
/* 格子里的短名：长型号（Remington 870）在 70px 格里会截断，用 short 兜住 */
const cellName=(def:{name:string; short?:string}) => def.short ?? def.name;

const controls = [
  ['W A S D','移动'],['鼠标','观察'],['SHIFT','奔跑'],['SPACE','跳跃'],['C / CTRL','蹲伏'],
  ['鼠标左键','射击 / 轻击'],['鼠标右键','瞄准 / 重刺'],['R','装填'],['1 / 2 或滚轮','切换枪械'],['3','简易小刀'],['F','手电筒'],
  ['E','搜索 / 撤离'],['H','使用医疗品'],['TAB','背包'],['M','战术地图'],
  ['ESC','关闭面板 / 暂停'],
];
const tabNames:Record<Tab,string>={brief:'行动简报',stash:'仓库与整备',trade:'交易',settings:'设置'};
const fmt = new Intl.NumberFormat('zh-CN');
export const credits=(value:number) => fmt.format(Math.floor(value));
export const timeText=(seconds:number) => {
  const whole=Math.max(0,Math.floor(seconds));
  return String(Math.floor(whole/60)).padStart(2,'0')+':'+String(whole%60).padStart(2,'0');
};

const button=(label:string,action:string,id='',value='',variant='') =>
  `<button type="button" class="${variant}" data-action="${action}" data-id="${id}" data-value="${value}">${label}</button>`;
const empty=(text:string) => `<p class="empty">${text}</p>`;
const itemRow=(entry:Stack,actions:string) => {
  const def=items[entry.id];
  const icon=itemIcon(entry.id);
  return `<div class="item-row r${def.r}"><span class="item-icon${icon ? ' has-icon' : ''}" aria-hidden="true">${icon ? `<img src="${icon}" alt="">` : def.mark}</span>
    <span class="item-copy"><strong>${def.name} ${entry.qty>1 ? `<small>×${entry.qty}</small>` : ''}</strong>
    <small>${rarityNames[def.r]} / ${def.w.toFixed(2)} kg</small></span><div class="item-actions">${actions}</div></div>`;
};
const equipMenu=(entry:Stack,action:string) => slots.filter(slot => compatible(slot,entry))
  .map(slot => ({label:slot==='primary' ? '装备到主武器' : slot==='secondary' ? '装备到副武器' : '穿戴'+slotNames[slot],action,id:entry.key,value:slot}));

const mapMarkup=(compact=false) => `<canvas class="sector-map" data-map="${compact ? 'compact' : 'detail'}" width="440" height="400" aria-label="07 号站地图。北侧水闸和东侧公路可撤离。"></canvas>`;
const maxIntegrity=(entry:Stack)=>armor[entry.id as ArmorId]?.durability ?? helmets[entry.id as keyof typeof helmets]?.durability;
const integrityBar=(entry:Stack)=>entry.integrity===undefined ? '' :
  `<progress class="item-condition" max="${maxIntegrity(entry)}" value="${entry.integrity}" aria-label="装备耐久"></progress>`;
const slotIcons:Partial<Record<Slot,string>>={
  helmet:'M5 27v-7a15 15 0 0 1 30 0v7H24v7h-8v-7Z',
  headset:'M6 26v-7a14 14 0 0 1 28 0v7M6 21h5v13H6Zm23 0h5v13h-5Z',
  armor:'m5 9 9-4 5 6h2l5-6 9 4-4 25H9Z M13 17h14v11H13Z',
  rig:'M4 10h32v22H4Z M12 14v14m8-14v14m8-14v14',
  backpack:'M8 10h24v24H8Z M14 10V5h12v5m-12 12h12v8H14Z',
  primary:'M3 22h8l4-5h16v3h6v4H23l-4 7h-6l2-7H9l-6 3Z',
  secondary:'M8 15h25v7H22l-4 9h-7l3-9H8Z',
};
const silhouette=(slot:Slot)=>`<svg aria-hidden="true" viewBox="0 0 40 40"><path d="${slotIcons[slot]}" /></svg>`;
/* 扫描面纱上的放大镜（Lucide search 的路径） */
const LENS_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="6.4"/><path d="M15 15l6 6"/></svg>';

export class UI {
  private hud?:HTMLElement;
  private hudValues=new Map<string,HTMLElement>();
  private lastHud?:HudData;
  private statusReadings?:{hp:Element;stamina:Element;clock:Element};
  private raidKit?:Kit;
  private noticeTimer=0;
  private controller=new AbortController();
  /* 浮层独立挂载，刷新网格时保持事件监听。 */
  private tip:HTMLElement;
  private menu:HTMLElement;
  private menus=new Map<string,MenuItem[]>();
  private primary=new Map<string,MenuItem>();
  private openKey:string|null=null;
  private menuOrigin?:{cell:HTMLElement;x:number;y:number};
  private hoverKey?:string;
  private selection?:string;
  private detail=document.createElement('dialog');
  private preview=new InventoryPreview();
  private inspection?:InventoryPreview;
  /* 仓库的筛选状态放在实例上：动作触发的整页重建不会把玩家挑好的分类冲掉 */
  private stashFilter:StashFilter='all';
  private stashSort:StashSort='value';
  private stashQuery='';
  private stashProfile?:Profile;
  stashOpen?:Stack;
  private lastTab?:Tab;
  /* 局内开箱后的扫描：格子 → 揭晓时刻（绝对时间）。
     面板会因拾取/移动重绘，存绝对时间才能让没扫完的格子接着扫，而不是从头再来。 */
  private scanTimeline=new Map<string,number>();
  private scanCache?:Cache;
  private scanned=new WeakSet<Cache>();
  private scanNoticeAt=0;

  private grids=new Map<string,Inventory>();
  private drag:InventoryDrag;
  constructor(private host:HTMLElement,private noticeRoot:HTMLElement,private act:Action,move:(request:GridMove)=>void,check:(request:GridMove)=>boolean) {
    this.tip=document.createElement('aside');
    this.tip.className='item-tip';this.tip.hidden=true;
    this.menu=document.createElement('div');
    this.menu.className='ctx';this.menu.hidden=true;
    this.detail.className='gear-detail';
    document.body.append(this.tip,this.menu,this.detail);
    this.detail.addEventListener('close',()=>{if (!this.detail.open) this.inspection?.show();},{signal:this.controller.signal});
    this.detail.addEventListener('click',event=>{if (event.target===this.detail) this.detail.close();},{signal:this.controller.signal});
    this.drag=new InventoryDrag(host,id=>this.grids.get(id),move,()=>this.closeLayers(),check);
    /* 面纱还盖着的格子不接受拖拽：拦在捕获阶段，别让长按把没扫出来的东西拖走 */
    host.addEventListener('pointerdown',event=>{
      if (!(event.target as HTMLElement).closest('.scan-veil')) return;
      event.stopPropagation();
      if (event.button===0) this.scanBlocked();
    },{capture:true,signal:this.controller.signal});
    host.addEventListener('pointerover',event=>{
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.inventory-item .cell');
      if (cell && !cell.contains(event.relatedTarget as Node|null) && this.menu.hidden && !this.drag.active) {
        if (this.stillScanning(cell)) { this.hoverKey=undefined;this.tip.hidden=true;return; }
        this.hoverKey=cell.dataset.key;this.showTip(cell);
      }
    },{signal:this.controller.signal});
    host.addEventListener('pointerout',event=>{
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.inventory-item .cell');
      if (cell && !cell.contains(event.relatedTarget as Node|null)) {
        this.hoverKey=undefined;this.tip.hidden=true;
      }
    },{signal:this.controller.signal});

    host.addEventListener('click',event => {
      const target=event.target as HTMLElement;
      /* 还没扫出来的格子：面纱收下这一下点击，只给提示 */
      if (target.closest('.scan-veil')) { this.scanBlocked(); return; }
      /* 仓库的分类标签与「清除筛选」：只重绘网格，不整页重建 */
      const pill=target.closest<HTMLElement>('[data-stash-filter]');
      if (pill) { this.stashFilter=pill.dataset.stashFilter as StashFilter; this.closeLayers(); this.syncStashBar(); this.refreshStash(); return; }
      if (target.closest('[data-stash-reset]')) {
        this.stashFilter='all';this.stashQuery='';
        const input=this.host.querySelector<HTMLInputElement>('[data-stash-search]');
        if (input) input.value='';
        this.closeLayers();this.syncStashBar();this.refreshStash();return;
      }
      const element=target.closest<HTMLButtonElement>('button[data-action]');
      if (element) {
        if (element.dataset.action==='collect-all' && this.scanPending()) { this.scanBlocked(); return; }
        this.closeLayers();
        if (element.dataset.action==='inspect-knife') this.showDetail('knife');
        else this.act(element.dataset.action!,element.dataset.id ?? '',element.dataset.value ?? '');
        return;
      }
      const cell=target.closest<HTMLElement>('.cell');
      if (cell) {
        if (this.stillScanning(cell)) { this.scanBlocked(); return; }
        const key=cell.dataset.key;
        if (key && (event.altKey || event.ctrlKey)) {
          event.preventDefault();
          this.closeLayers();
          const primary=this.primary.get(key);
          if (event.altKey) this.act('quick-equip',key,'');
          else if (primary) this.act(primary.action,primary.id ?? '',primary.value ?? '');
          return;
        }
        this.selection=key;this.showTip(cell);return;
      }
      this.closeLayers();
    },{signal:this.controller.signal});
    host.addEventListener('input',event => {
      const input=(event.target as HTMLElement).closest<HTMLInputElement>('[data-stash-search]');
      if (!input) return;
      this.stashQuery=input.value;
      this.closeLayers();
      this.refreshStash();
    },{signal:this.controller.signal});
    host.addEventListener('contextmenu',event => {
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell) return;
      event.preventDefault();
      if (this.stillScanning(cell)) { this.scanBlocked(); return; }
      this.showMenu(cell,event.clientX,event.clientY);
    },{signal:this.controller.signal});
    host.addEventListener('dblclick',event => {
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell) return;
      if (this.stillScanning(cell)) { this.scanBlocked(); return; }
      if (!(event.ctrlKey || event.altKey)) this.showDetail(cell.dataset.key!);
    },{signal:this.controller.signal});
    host.addEventListener('change',event => {
      const target=event.target as HTMLElement;
      const sort=target.closest<HTMLSelectElement>('[data-stash-sort]');
      if (sort) { this.stashSort=sort.value as StashSort; this.refreshStash(); return; }
      const input=target.closest<HTMLInputElement | HTMLSelectElement>('[data-setting]');
      if (input) this.act('setting',input.dataset.setting!,input instanceof HTMLInputElement && input.type==='checkbox' ? String(input.checked) : input.value);
    },{signal:this.controller.signal});
    this.menu.addEventListener('click',event => {
      const row=(event.target as HTMLElement).closest<HTMLElement>('[data-mi]');
      if (!row) return;
      const item=this.menus.get(this.openKey!)![Number(row.dataset.mi)];
      this.closeLayers();
      if (item) this.perform(item);
    });
    /* 键盘也能开详情；ESC 先收浮窗/菜单，不打断外层面板逻辑 */
    host.addEventListener('keydown',event => {
      if (event.key!=='Enter' && event.key!==' ') return;
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell) return;
      event.preventDefault();
      this.showTip(cell);
    },{signal:this.controller.signal});
    document.addEventListener('keydown',event => {
      if (event.code==='Delete' && !event.repeat && !this.drag.active && !this.detail.open &&
          !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) {
        const key=this.hoverKey ?? this.selection;
        const drop=key && this.menus.get(key)?.find(item=>item.action==='drop'||item.action==='drop-equipped');
        if (drop) {event.preventDefault();this.perform(drop);return;}
      }
      if (event.code==='Escape' && this.detail.open) {
        this.detail.close();event.preventDefault();event.stopImmediatePropagation();return;
      }
      /* 浮窗/菜单算最内层：ESC 只收它们，不把暂停页也一起弹出来 */
      if (event.key==='Escape' && !this.menu.hidden) {
        this.closeLayers();
        event.stopImmediatePropagation();
      }
    },{signal:this.controller.signal});
    document.addEventListener('pointerdown',event=>{
      if (!this.menu.contains(event.target as Node) && event.button===0) this.closeLayers();
    },{signal:this.controller.signal});
    window.addEventListener('resize',() => this.closeLayers(),{signal:this.controller.signal});
    document.addEventListener('scroll',() => {
      this.tip.hidden=true;
      if (!this.menuOrigin || this.menu.hidden) return;
      const {cell,x,y}=this.menuOrigin,rect=cell.getBoundingClientRect();
      if (!cell.isConnected || Math.abs(rect.x-x)>.5 || Math.abs(rect.y-y)>.5) this.closeLayers();
    },{capture:true,signal:this.controller.signal});
  }

  dispose() {
    this.drag.dispose();
    this.controller.abort();
    window.clearTimeout(this.noticeTimer);
    this.preview.dispose();this.inspection?.dispose();
    this.tip.remove();this.menu.remove();this.detail.remove();
  }

  toast(message:string) {
    this.noticeRoot.textContent=message;
    this.noticeRoot.classList.add('on');
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer=window.setTimeout(() => this.noticeRoot.classList.remove('on'),2700);
  }

  /* 开箱的扫描节拍：密封柜慢、尸体与残骸快，其余居中。
     同一个容器只扫一次；重开已经搜过的容器直接显示内容。 */
  private primeScan(cache?:Cache) {
    if (!cache || cache.kind==='drop' || cache===this.scanCache) return;
    this.scanCache=cache;
    this.scanTimeline.clear();
    if (this.scanned.has(cache)) return;
    this.scanned.add(cache);
    const step=cache.kind==='sealed' ? .34 : cache.kind==='corpse' || cache.kind==='anomaly' ? .22 : .28;
    const start=performance.now()+110;
    cache.entries.forEach((entry,index)=>this.scanTimeline.set(entry.key,start+index*step*1000));
  }

  private scanPending() {
    const now=performance.now();
    for (const at of this.scanTimeline.values()) if (at>now) return true;
    return false;
  }

  private scanBlocked() {
    const now=performance.now();
    if (now-this.scanNoticeAt<900) return;
    this.scanNoticeAt=now;
    this.toast('正在扫描 · 扫完才看得清');
  }

  /* 物品卡与菜单共用实例键，网格组件负责尺寸与位置。 */
  private cell(entry:Stack,menu:MenuItem[],primary?:MenuItem,withName=false) {
    const def=items[entry.id];
    const showName=withName && (entry.rotation===90 ? def.height : def.width)>=2;
    const split=entry.qty>1 && (this.lastTab==='stash'||Boolean(this.host.querySelector('#raid-panel'))) &&
      menu.some(option=>['drop','pack','unpack','collect','corpse-item','ground-item'].includes(option.action));
    this.menus.set(entry.key,[...menu,...(split ? [{label:'拆分堆叠',action:'split',id:entry.key}] : []),
      {label:'查看详情',action:'item-detail',id:entry.key}]);
    this.entries.set(entry.key,entry);
    if (primary) this.primary.set(entry.key,primary);
    const qty=entry.qty>1 ? `<i>${entry.qty}</i>` : '';
    const icon=itemIcon(entry.id);
    const gear=def.kind==='helmet'||def.kind==='headset'||def.kind==='rig'||def.kind==='backpack' ? def.kind : undefined;
    const face=icon
      ? `<img class="cell-img" src="${icon}" alt="" draggable="false">`
      : gear ? `<span class="inventory-slot-icon">${silhouette(gear)}</span>` : `<span class="cell-mark">${def.mark}</span>`;
    /* 还没扫到这一件：盖一层扫描面纱，扫完整块自己淡出（CSS 驱动，重绘时按剩余时间续播） */
    const scanAt=this.scanTimeline.get(entry.key);
    const scanLeft=scanAt===undefined ? 0 : scanAt-performance.now();
    const scanning=scanAt!==undefined && scanLeft>0;
    const veil=scanning ? `<div class="scan-veil" aria-hidden="true">${face}
        <span class="scan-line"></span><span class="scan-lens">${LENS_SVG}</span></div>` : '';
    const reveal=scanning ? ` style="--reveal-at:${Math.max(0,Math.round(scanLeft))}ms"` : '';
    return `<div class="cell r${def.r}${showName ? ' with-name' : ''}${icon ? ' has-icon' : ''}${scanning ? ' scanning' : ''}"${reveal} data-key="${entry.key}" tabindex="0" role="button" title="${def.name}"
      aria-label="${def.name}${entry.qty>1 ? ' ×'+entry.qty : ''}${scanning ? '，扫描中' : '，右键更多操作'}">
      ${face}${qty}${integrityBar(entry)}${showName ? `<span class="cell-name">${cellName(def)}</span>` : ''}${veil}</div>`;
  }

  private grid(entries:Stack[], build:(entry:Stack) => {menu:MenuItem[];primary?:MenuItem}, withName=false, visible=entries) {
    const grid=gridOf(entries);
    if (!grid) return '';
    this.grids.set(grid.inventoryId,grid);
    return GridInventory(grid,visible,entry => {
      const spec=build(entry);
      return this.cell(entry,spec.menu,spec.primary,withName);
    });
  }

  private preserveGridScroll() {
    const offsets=new Map([...this.host.querySelectorAll<HTMLElement>('[data-grid]')].map(grid=>{
      const scroll=grid.parentElement!;
      return [grid.dataset.grid!,[scroll.scrollLeft,scroll.scrollTop] as const];
    }));
    const columns=new Map([...this.host.querySelectorAll<HTMLElement>('[data-inventory-scroll]')]
      .map(el=>[el.dataset.inventoryScroll!,[el.scrollLeft,el.scrollTop] as const]));
    return ()=>{
      for (const grid of this.host.querySelectorAll<HTMLElement>('[data-grid]')) {
        const offset=offsets.get(grid.dataset.grid!);
        if (offset) grid.parentElement!.scrollTo(...offset);
      }
      for (const column of this.host.querySelectorAll<HTMLElement>('[data-inventory-scroll]')) {
        const offset=columns.get(column.dataset.inventoryScroll!);
        if (offset) column.scrollTo(...offset);
      }
    };
  }

  private syncInventoryMarkup(root:HTMLElement,markup:string) {
    const template=document.createElement('template');
    template.innerHTML=markup;
    const current=root.firstElementChild,next=template.content.firstElementChild;
    if (!current || !next || current.getAttribute('data-inventory-screen')!==next.getAttribute('data-inventory-screen')) {
      root.replaceChildren(template.content);return;
    }
    const patch=(oldNode:Element,newNode:Element)=>{
      if (oldNode.matches('[data-character-preview]') || oldNode.isEqualNode(newNode)) return;
      if (oldNode.matches('[data-inventory-screen], .equipment-content, .character-inventory, .equipment-column, .carried-column, .external-column, .protection-layout, .weapon-slots')
          && oldNode.children.length===newNode.children.length) {
        Array.from(newNode.children).forEach((child,i)=>patch(oldNode.children[i],child));
      } else oldNode.replaceWith(newNode);
    };
    patch(current,next);
  }

  private slotView(kit:Kit,slot:Slot,raid:boolean,own:boolean) {
    const item=kit.gear[slot],inventoryId=(kit.characterId ?? 'player')+':slot:'+slot;
    const weapon=slot==='primary'||slot==='secondary';
    this.grids.set(inventoryId,{inventoryId,type:'pocket',columns:1,rows:1,items:item ? [item] : [],slotTarget:{kit,slot}});
    const menu:MenuItem[]=item ? own
      ? [{label:'卸下',action:raid?'raid-unequip':'unequip',id:slot},
         ...(raid ? [{label:'丢弃装备',action:'drop-equipped',id:slot,danger:true}] : [])]
      : [{label:'装备到身上',action:'corpse-equip',id:slot},{label:'拾取到随身库存',action:'corpse-take',id:slot}]
      : [];
    const primary={label:'转移装备',action:'quick-slot',id:item?.key ?? ''};
    const def=item ? items[item.id] : undefined;
    const hotkey=weapon ? (slot==='primary' ? '1' : '2') : '';
    const ammo=weapon && item ? `${item.rounds ?? 0}/${weapons[item.id as WeaponId].capacity}` : '';
    const durability=item?.integrity!==undefined ? `${Math.ceil(item.integrity)}/${maxIntegrity(item)}` : '';
    const state=(durability ? `<span class="gear-durability">${durability}</span>` : '')+
      (ammo ? `<span class="gear-ammo">${ammo}</span>` : '');
    /* 装备槽自身就是物品卡片：.cell 退成透明的图标 + 拖拽/右键交互层，
       名称、耐久、弹数、快捷键全部覆盖式排布，不再套一层库存格边框。 */
    return `<div class="gear-slot ${weapon ? 'weapon-slot' : ''} ${item ? 'is-equipped' : 'is-empty'} ${def ? 'r'+def.r : ''}" data-slot="${slot}">
      <div class="gear-head"><small>${slotNames[slot]}</small>${hotkey ? `<kbd class="gear-hotkey">${hotkey}</kbd>` : ''}</div>
      <div class="gear-target" data-grid="${inventoryId}" aria-label="${slotNames[slot]}">
        ${item ? `<div class="inventory-item">${this.cell(item,menu,primary)}</div>` : `<span class="slot-empty">${silhouette(slot)}</span>`}
        ${def ? `<span class="gear-name" title="${esc(def.name)}">${esc(def.name)}</span>` : ''}
        ${state ? `<span class="gear-state">${state}</span>` : ''}
      </div></div>`;
  }

  private CharacterInventoryPanel(kit:Kit,name:string,raid:boolean,own:boolean,cache?:Cache) {
    const compact=!own || Boolean(cache?.character);
    const grids=(groups:Stack[][],quick:boolean)=>groups.map(entries=>this.grid(entries,entry=>{
      const menu:MenuItem[]=own ? [...equipMenu(entry,raid?'raid-equip':'equip-bag')] :
        [{label:'拾取',action:'corpse-item',id:entry.key},...equipMenu(entry,'ground-equip')];
      if (own && quick && items[entry.id].kind==='medical') {
        if (raid) menu.push({label:'使用',action:'heal',id:entry.key});
        for (const key of ['4','5','6','7']) menu.push({label:(kit.quick?.[key]===entry.key?'取消绑定 ':'绑定 ')+key,action:'quick-bind',id:entry.key,value:key});
      }
      if (own && !raid) menu.push({label:'存回仓库',action:'unpack',id:entry.key});
      if (own && raid) {
        if (cache) menu.push({label:cache.character ? '放入尸体库存' : '放入容器',action:'put',id:entry.key});
        menu.push({label:'丢弃',action:'drop',id:entry.key,danger:true});
      }
      return {menu,primary:menu.find(row=>['unpack','put','corpse-item'].includes(row.action))};
    })).join('');
    const rig=kit.gear.rig?.contents ?? [],pack=kit.gear.backpack?.contents ?? [];
    const quickText=own ? `<span>${['4','5','6','7'].map(key=>{
      const entry=quickGrids(kit).flat().find(item=>item.key===kit.quick?.[key]);
      return key+' '+(entry ? items[entry.id].short ?? items[entry.id].name : '—');
    }).join(' · ')}</span>` : '';
    const capacity=(groups:Stack[][])=>groups.length ? `${groups.reduce((sum,grid)=>sum+usedSpace(grid),0)} / ${groups.reduce((sum,entries)=>{
      const grid=gridOf(entries)!;return sum+grid.columns*grid.rows;
    },0)} 格` : '未装备';
    const storage=(slot:'rig'|'backpack',groups:Stack[][])=>`<section class="carried-section" data-carried="${slot}">
      <div class="storage-head">${this.slotView(kit,slot,raid,own)}<span class="capacity">${capacity(groups)}</span></div>
      <div class="gear-partitions">${grids(groups,slot==='rig')}</div></section>`;
    /* 近战武器是固定装备，没有 data-grid：展示规范与其它槽一致，检视按钮直接铺在展示区里 */
    const melee=own ? `<div class="gear-slot melee-slot is-equipped" data-slot="melee">
      <div class="gear-head"><small>近战武器</small><kbd class="gear-hotkey">3</kbd></div>
      <div class="gear-target"><button class="melee-inspect" data-action="inspect-knife" aria-label="查看简易小刀"><svg viewBox="0 0 30 100" aria-hidden="true"><path d="M10 4h10v22H10Z"/><path d="M6 26h18v6H6Z"/><path d="M10 32h10v52l-5 12-5-12Z"/></svg></button>
        <span class="gear-name">简易小刀</span></div></div>` : '';
    return `<section class="character-inventory ${compact ? 'compact-character' : ''}" aria-label="${name}">
      <div class="equipment-column" data-inventory-scroll="equipment-${own}"><h3>${name} · 角色装备</h3>
        <div class="protection-layout">
          ${!compact ? '<div class="character-preview" data-character-preview aria-label="角色 3D 预览，拖动旋转"></div>' : ''}
          ${(['helmet','headset','armor'] as const).map(slot=>this.slotView(kit,slot,raid,own)).join('')}
          ${melee}
        </div>
        <div class="weapon-slots">${(['primary','secondary'] as const).map(slot=>this.slotView(kit,slot,raid,own)).join('')}</div>
      </div>
      <div class="carried-column" data-inventory-scroll="carried-${own}"><h3>随身库存</h3>
        ${storage('rig',rig)}
        <section class="carried-section pocket-section" data-carried="pockets"><div class="section-head"><h4>口袋</h4><span>${capacity(kit.pockets ?? [])}</span></div>
          <div class="gear-partitions">${grids(kit.pockets ?? [],true)}</div>${quickText}</section>
        ${storage('backpack',pack)}
      </div>
    </section>`;
  }

  private inventoryFooter(kit:Kit,raid=true) {
    const weight=kitWeight(kit);
    return `<footer class="equipment-footer"><div class="carry-weight ${weight>=14 ? 'burdened' : ''}"><span>负重</span>
      <strong>${weight.toFixed(1)} kg</strong><progress value="${Math.min(weight,44)}" max="44" aria-label="负重，超过 14 kg 影响冲刺"></progress>
      <small>${weight>=14?'冲刺受负重影响':'14 kg 起影响冲刺'}</small></div>
      <div class="inventory-hints">长按拖拽 <kbd>R</kbd> 旋转 <kbd>Ctrl</kbd> 转移 <kbd>Alt</kbd> 装备 ${raid ? '<kbd>Tab</kbd> 关闭' : ''}</div></footer>`;
  }

  private stashSpec(entry:Stack,mode:'stash'|'trade') {
    const open:MenuItem[] = isStorage(entry) ? [{label:'打开收纳',action:'open-storage',id:entry.key}] : [];
    const sale={label:`出售 · +${credits(sellPrice(entry)*entry.qty)} CR`,action:'sell',id:entry.key};
    return {
      menu:mode==='trade'
        ? [...(isLoaded(entry) ? [] : [sale]),{label:'放入背包',action:'pack',id:entry.key}]
        : [{label:'放入背包',action:'pack',id:entry.key},...equipMenu(entry,'equip-stash'),...open,...(isLoaded(entry) ? [] : [sale])],
      primary:{label:'放入背包',action:'pack',id:entry.key},
    };
  }

  private stashList(profile:Profile,honour=true) {
    const query=this.stashQuery.trim().toLowerCase();
    const list=profile.stash.filter(entry => {
      const def=items[entry.id];
      if (honour && !inFilter(def.cat,this.stashFilter)) return false;
      if (!honour || !query) return true;
      return def.name.toLowerCase().includes(query) || def.mark.toLowerCase().includes(query)
        || def.description.toLowerCase().includes(query) || catNames[def.cat].includes(query)
        || rarityNames[def.r].includes(query);
    });
    const sort=honour ? this.stashSort : 'value';
    return list.sort((a,b) => {
      const da=items[a.id],db=items[b.id];
      if (sort==='rarity') return db.r-da.r || db.price-da.price;
      if (sort==='name') return da.name.localeCompare(db.name,'zh-Hans');
      if (sort==='weight') return db.w*b.qty-da.w*a.qty;
      return db.price*b.qty-da.price*a.qty;
    });
  }

  private stashGrid(profile:Profile,mode:'stash'|'trade'='stash',honour=true) {
    const list=this.stashList(profile,honour);
    const filtered=honour && Boolean(this.stashQuery.trim() || this.stashFilter!=='all');
    const grid=this.grid(profile.stash,entry=>this.stashSpec(entry,mode),true,list);
    if (list.length) return grid;
    return grid+`<p class="empty stash-empty">${profile.stash.length
      ? '没有符合当前筛选的物资。'
      : '仓库为空。可以从交易台购买补给，或带回封锁区物资。'}${filtered
      ? ' <button type="button" class="mini" data-stash-reset>清除筛选</button>' : ''}</p>`;
  }

  private stashFoot(profile:Profile) {
    const list=this.stashList(profile);
    const value=list.reduce((sum,entry) => sum+sellPrice(entry)*entry.qty,0);
    const showing=this.stashFilter!=='all' || this.stashQuery.trim();
    return `<span>${showing ? `筛选 ${list.length} / ${profile.stash.length} 组` : `库存 ${usedSpace(profile.stash)} 格`}</span>
      <span>可回收 <b>${credits(value)} CR</b></span>
      <span class="stash-hint">拖动整理 · R 旋转 · 右键操作</span>`;
  }

  private stashPanel(profile:Profile) {
    this.stashProfile=profile;
    const total=usedSpace(profile.stash),over=total-STASH_CAPACITY;
    const counts=new Map<StashFilter,number>();
    for (const filter of stashFilters)
      counts.set(filter.key,profile.stash.filter(entry => inFilter(items[entry.id].cat,filter.key)).length);
    return `<section class="box stash-box">
      <div class="stash-head"><div class="stash-title"><h2>仓库</h2>
        <em class="stash-count${over>0 ? ' over' : ''}">${total} / ${STASH_CAPACITY} 格${over>0 ? ` · 超出 ${over}` : ''}</em></div>
        <div class="stash-tools">
          <input type="search" data-stash-search placeholder="搜索名称 / 描述" aria-label="搜索仓库" value="${esc(this.stashQuery)}">
          <select data-stash-sort aria-label="仓库排序">${stashSorts.map(sort =>
            `<option value="${sort.key}"${sort.key===this.stashSort ? ' selected' : ''}>${sort.name}</option>`).join('')}</select>
        </div></div>
      <div class="stash-cap-track${over>0 ? ' over' : ''}"><i style="width:${Math.min(100,total/STASH_CAPACITY*100)}%"></i></div>
      <div class="stash-filter" data-stash-bar>${stashFilters.map(filter => {
        const count=counts.get(filter.key) || 0;
        return `<button type="button" class="pill${filter.key===this.stashFilter ? ' on' : ''}${count ? '' : ' zero'}"
          data-stash-filter="${filter.key}" aria-pressed="${filter.key===this.stashFilter}">${filter.name}<em>${count}</em></button>`;
      }).join('')}</div>
      <div class="stash-grid" data-stash-grid>${this.stashGrid(profile)}</div>
      <div class="stash-foot" data-stash-foot>${this.stashFoot(profile)}</div>
    </section>`;
  }

  private syncStashBar() {
    for (const pill of this.host.querySelectorAll<HTMLElement>('[data-stash-filter]')) {
      const on=pill.dataset.stashFilter===this.stashFilter;
      pill.classList.toggle('on',on);
      pill.setAttribute('aria-pressed',String(on));
    }
  }

  /* 只重绘网格与页脚：搜索框保住焦点，页面也不闪 */
  private refreshStash() {
    this.drag.cancel();
    const restore=this.preserveGridScroll();
    const profile=this.stashProfile;
    if (!profile) return;
    const grid=this.host.querySelector<HTMLElement>('[data-stash-grid]');
    if (grid) grid.innerHTML=this.stashGrid(profile);
    restore();
    const foot=this.host.querySelector<HTMLElement>('[data-stash-foot]');
    if (foot) foot.innerHTML=this.stashFoot(profile);
  }

  /* ---------------- 浮窗与菜单 ---------------- */
  /* 面纱还在的格子连名称都不露出：悬浮、回车、双击一律先挡住 */
  private stillScanning(cell:HTMLElement) {
    const veil=cell.querySelector<HTMLElement>('.scan-veil');
    if (!veil) return false;
    return getComputedStyle(veil).visibility!=='hidden';
  }

  private showTip(cell:HTMLElement) {
    if (this.stillScanning(cell)) return;
    const key=cell.dataset.key!;
    const entry=this.findEntry(key);
    if (!entry) return;
    const def=items[entry.id];
    const condition=entry.rounds!==undefined ? `余弹 ${entry.rounds} / ${weapons[entry.id as WeaponId].capacity}`
      : entry.integrity!==undefined ? `防护 ${Math.ceil(entry.integrity)} / ${armor[entry.id as ArmorId]?.durability ?? helmets[entry.id as keyof typeof helmets]?.durability}` : '';
    this.tip.className='item-tip r'+def.r;
    const tipIcon=itemIcon(entry.id);
    this.tip.innerHTML=`<div class="tip-head"><span class="tip-mark${tipIcon ? ' has-icon' : ''}">${tipIcon ? `<img src="${tipIcon}" alt="">` : def.mark}</span>
        <div><strong>${def.name}</strong><small>${rarityNames[def.r]} · ${catNames[def.cat]}</small></div></div>
      ${def.description.split(/\n{2,}/).map(part => `<p>${part}</p>`).join('')}
      <dl><div><dt>占用</dt><dd>${def.width}×${def.height} 格</dd></div><div><dt>重量</dt><dd>${def.w.toFixed(2)} kg</dd></div>
      <div><dt>单价</dt><dd>${credits(def.price)} CR</dd></div>${condition ? `<div><dt>状态</dt><dd>${condition}</dd></div>` : ''}</dl>
      <small class="tip-hint">右键操作 · 双击详情 · Ctrl + 左键转移</small>`;
    this.tip.hidden=false;
    const r=cell.getBoundingClientRect();
    const w=this.tip.offsetWidth||250;
    const left=r.right+10+w>window.innerWidth-8 ? Math.max(8,r.left-w-10) : r.right+10;
    const top=Math.max(8,Math.min(r.top,window.innerHeight-this.tip.offsetHeight-8));
    this.tip.style.left=left+'px';this.tip.style.top=top+'px';
    this.openKey=key;
  }

  private showMenu(cell:HTMLElement,x:number,y:number) {
    const key=cell.dataset.key!;
    const menu=this.menus.get(key);
    if (!menu) return;
    const anchor=cell.getBoundingClientRect();
    this.menuOrigin={cell,x:anchor.x,y:anchor.y};
    this.openKey=key;
    this.menu.innerHTML=menu.map((item,i) =>
      `<div class="ctx-row${item.danger ? ' danger' : ''}" data-mi="${i}">${item.label}</div>`).join('');
    this.menu.hidden=false;
    const w=this.menu.offsetWidth||150,h=this.menu.offsetHeight||40;
    this.menu.style.left=Math.max(8,Math.min(x,window.innerWidth-w-8))+'px';
    this.menu.style.top=Math.max(8,Math.min(y,window.innerHeight-h-8))+'px';
    this.tip.hidden=true;
  }

  private perform(item:MenuItem) {
    const id=item.id ?? '';
    if (item.action==='item-detail') {this.showDetail(id);return;}
    if (item.action==='split') {
      const entry=this.entries.get(id);
      if (!entry || entry.qty<2) return;
      this.openDetail(`<h2>拆分 ${items[entry.id].name}</h2><form>
        <label>拆出数量 <input name="quantity" type="number" min="1" max="${entry.qty-1}" value="${Math.floor(entry.qty/2)}" required></label>
        <div class="detail-actions"><button type="button" data-close>取消</button><button type="submit">拆分</button></div></form>`);
      this.detail.querySelector('form')!.addEventListener('submit',event=>{
        event.preventDefault();
        const quantity=String(new FormData(event.currentTarget as HTMLFormElement).get('quantity'));
        this.detail.close();this.act('split',id,quantity);
      });
      return;
    }
    const entry=item.action==='drop-equipped'
      ? [...this.grids.values()].find(grid=>grid.slotTarget?.kit.characterId==='player' && grid.slotTarget.slot===id)?.items[0]
      : this.entries.get(id);
    if ((item.action==='drop'||item.action==='drop-equipped') && entry && (isLoaded(entry) || items[entry.id].price*entry.qty>=650)) {
      this.openDetail(`<h2>丢弃 ${items[entry.id].name}？</h2><p>${isLoaded(entry) ? '内部物品会一同落到地上。' : '确认将这件贵重物品放到地面。'}</p>
        <div class="detail-actions"><button data-close>取消</button><button data-confirm class="danger">确认丢弃</button></div>`);
      this.detail.querySelector('[data-confirm]')!.addEventListener('click',()=>{
        this.detail.close();this.act(item.action,id,item.value ?? '');
      });
      return;
    }
    this.act(item.action,id,item.value ?? '');
  }

  private openDetail(markup:string) {
    this.closeLayers();
    if (this.detail.open) this.detail.close();
    this.detail.innerHTML=markup;
    this.detail.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>this.detail.close()));
    this.detail.showModal();
  }

  private showDetail(key:string) {
    const entry=this.entries.get(key);
    if (!entry && key!=='knife') return;
    const def=entry && items[entry.id];
    const gun=entry && def?.kind==='weapon' ? weapons[entry.id as WeaponId] : undefined;
    const helmet=entry && helmets[entry.id as keyof typeof helmets];
    const armorStats=entry && armor[entry.id as ArmorId];
    const headset=entry && headsets[entry.id as keyof typeof headsets];
    const info=entry && def ? [
      ['品质',rarityNames[def.r]],['分类',catNames[def.cat]],['占格',`${def.width} × ${def.height}`],['重量',def.w.toFixed(2)+' kg'],
      ...(entry.integrity===undefined ? [] : [['耐久',`${Math.ceil(entry.integrity)} / ${maxIntegrity(entry)}`]]),
      ...(helmet ? [['防护等级',helmet.level],['材质',helmet.material==='steel'?'钢':'复合材料'],['拾音距离',Math.round(helmet.hearing*100)+'%']] : []),
      ...(armorStats ? [['躯干防护',Math.round(armorStats.protection*100)+'%']] : []),
      ...(headset ? [['拾音距离',Math.round(headset.range*100)+'%'],['脚步声',Math.round(headset.steps*100)+'%'],['环境音',Math.round(headset.ambient*100)+'%'],['响声',Math.round(headset.loud*100)+'%']] : []),
      ...(gun ? [['弹药',items[gun.ammo].name],['弹匣',`${entry.rounds ?? 0} / ${gun.capacity}`],['伤害',gun.damage+(gun.pellets>1 ? ' × '+gun.pellets : '')],['有效射程',gun.range+' m']] : []),
      ...(entry.contents ? [['内部容量',entry.contents.map(part=>{const g=gridOf(part)!;return g.columns+'×'+g.rows;}).join(' · ')]] : []),
    ] : [['快捷键','3']];
    const icon=entry ? itemIcon(entry.id) : undefined;
    this.openDetail(`<div class="section-head"><h2>${def?.name ?? '简易小刀'}</h2><button data-close aria-label="关闭详情">Esc</button></div>
      ${gun||!entry ? '<div class="inspection-preview" aria-label="物品 3D 检视，拖动旋转"></div>' : `<div class="detail-icon">${icon ? `<img src="${icon}" alt="">` : def!.mark}</div>`}
      <dl>${info.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
      <p>${def?.description ?? '随身近战武器，可轻击和重刺。'}</p>`);
    const mount=this.detail.querySelector<HTMLElement>('.inspection-preview');
    if (mount) (this.inspection ??=new InventoryPreview()).show(mount,undefined,entry ?? 'knife');
  }

  private closeLayers() {
    this.tip.hidden=true;this.menu.hidden=true;
    this.menuOrigin=undefined;
  }

  /* 当前页面上所有条目的索引：渲染时菜单里只存了 key，
     浮窗要完整物品信息，所以从最近一次渲染的数据里查。 */
  private entries=new Map<string,Stack>();
  private findEntry(key:string) { return this.entries.get(key); }
  private index(entries:Stack[]) {
    for (const entry of entries) this.entries.set(entry.key,entry);
  }

  /* ---------------- 藏身处 ---------------- */
  hideout(tab:Tab,profile:Profile,warning:string,confirmReset:boolean) {
    this.drag.cancel();this.grids.clear();
    const restore=this.lastTab===tab ? this.preserveGridScroll() : undefined;
    this.hud=undefined;this.lastHud=undefined;
    this.statusReadings=undefined;this.raidKit=undefined;
    this.closeLayers();
    if (this.detail.open) this.detail.close();
    /* 同一页内的动作（放入背包 / 出售）会整页重建，留住滚动位置，
       否则仓库翻到一半点一下就被弹回顶部。切页签时不保留。 */
    const previous=this.host.querySelector<HTMLElement>('.hideout');
    const scrollTop=this.lastTab===tab && previous ? previous.scrollTop : 0;
    this.menus.clear();this.primary.clear();this.entries.clear();
    this.index(profile.stash);this.index(kitEntries(profile.kit));this.index(profile.overflow);
    for (const grid of this.stashOpen?.contents ?? []) this.index(grid);
    for (const slot of slots) { const entry=profile.kit.gear[slot]; if (entry) this.entries.set(entry.key,entry); }
    const navigation=(Object.keys(tabNames) as Tab[]).map(key =>
      `<button type="button" data-action="tab" data-id="${key}" ${key===tab ? 'class="active" aria-current="page"' : ''}>${tabNames[key]}</button>`).join('');
    const sameStash=tab==='stash' && this.lastTab==='stash' && Boolean(previous?.querySelector('.stash-screen'));
    this.lastTab=tab;
    if (sameStash) {
      const root=previous!.querySelector<HTMLElement>('.hideout-body')!;
      this.syncInventoryMarkup(root,this.stash(profile));
      const balance=previous!.querySelector('.balance strong')!;
      balance.innerHTML=`${credits(profile.credits)} <span>CR</span>`;
      restore?.();
      this.preview.show(this.host.querySelector<HTMLElement>('[data-character-preview]') ?? undefined,profile.kit);
      return;
    }
    this.host.innerHTML=`<div class="hideout ${tab==='brief'?'brief':'subpage'} ${tab==='stash'?'gear-hideout':''}">
      <header class="station-header"><div class="brand"><span class="signal-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span><strong>DEAD FREQUENCY</strong><small>环礁湾回收网络</small></span></div>
        <nav aria-label="藏身处">${navigation}</nav><div class="balance"><small>信用点</small><strong>${credits(profile.credits)} <span>CR</span></strong></div></header>
      ${warning ? `<p class="save-warning">${warning}</p>` : ''}
      <div class="hideout-body">${tab==='brief' ? this.brief(profile) : tab==='stash' ? this.stash(profile) : tab==='trade' ? this.trade(profile) : this.settings(profile,confirmReset)}</div>
    </div>`;
    const next=this.host.querySelector<HTMLElement>('.hideout');
    if (next && scrollTop) next.scrollTop=scrollTop;
    restore?.();
    this.preview.show(this.host.querySelector<HTMLElement>('[data-character-preview]') ?? undefined,profile.kit);
    this.drawMap();
  }

  private brief(profile:Profile) {
    const armed=Boolean(profile.kit.gear.primary || profile.kit.gear.secondary);
    return `<div class="brief-grid"><section class="brief-copy">
      <p class="overline"><span class="live"></span> 07 号转播站 / 封锁区</p>
      <h1>DEAD<br><span>FREQUENCY</span></h1><h2>死寂频段</h2>
      <p class="brief-text">第一次潮汐过后，07 号站停播了四年。昨夜，维修频段再次传来站内呼号。趁静潮窗口进入站区，带走能证明那里发生了什么的东西。</p>
      <div class="brief-actions">${button(armed?'开始出击':'持刀出击','deploy','','primary loud')}${button('调整装备','tab','stash','','secondary loud')}</div>
      ${needsRelief(profile) ? `<div class="relief">${button('领取免费救济装备','relief')}</div>` : ''}
      </section><aside class="brief-map"><div class="map-title"><strong>站区导航</strong><span>北 ↑</span></div>
      ${mapMarkup(true)}<div class="map-key"><span><i class="swatch entry"></i>南侧入场</span><span><i class="swatch exit"></i>可用撤离点</span></div></aside></div>
      <footer class="station-footer"><div><small>行动窗口</small><strong>15:00</strong></div><div><small>已出击</small><strong>${profile.stats.raids}</strong></div>
      <div><small>成功撤离</small><strong>${profile.stats.escapes}</strong></div><div><small>击倒目标</small><strong>${profile.stats.kills}</strong></div></footer>`;
  }

  private stash(profile:Profile) {
    const {kit}=profile;
    return `<section class="screen stash-screen equipment-screen" data-inventory-screen="stash"><div class="screen-heading"><div><h1>仓库与整备</h1></div>
      ${button('返回行动简报','tab','brief','','secondary')}</div>
      <div class="equipment-content inventory-three">
        ${this.CharacterInventoryPanel(kit,'回收员',false,true)}
      <section class="external-column" data-inventory-scroll="stash"><h3>仓库库存</h3>${this.stashPanel(profile)}
        ${this.stashOpen ? `<div class="section-head"><h3>${items[this.stashOpen.id].name}</h3>${button('关闭收纳','close-storage')}</div>
          <div class="gear-partitions">${(this.stashOpen.contents ?? []).map(grid=>this.grid(grid,item=>{
            const unpack={label:'存回仓库',action:'unpack',id:item.key};
            return {menu:[unpack,...equipMenu(item,'equip-bag')],primary:unpack};
          })).join('')}</div>` : ''}
        ${profile.overflow.length ? `<div class="section-head"><h3>待领取物资</h3><span>拖到仓库或背包</span></div>
          ${this.grid(profile.overflow,entry=>({menu:[{label:'领取到仓库',action:'claim-overflow',id:entry.key}]}))}` : ''}
        ${needsRelief(profile) ? `<p class="relief">${button('领取免费救济装备','relief')}</p>` : ''}</section></div>${this.inventoryFooter(kit,false)}</section>`;
  }

  private trade(profile:Profile) {
    const offers=vendors.map(vendor => `<section class="box vendor"><div class="section-head"><h2>${vendor.name}</h2><span>${vendor.call}</span></div>
      <div class="item-list">${vendor.offers.map(([id,qty]) => itemRow({id,qty,key:'offer-'+id},
        button(`买入 · ${credits(items[id].price*qty)} CR`,'buy',id,String(qty)))).join('')}</div></section>`).join('');
    return `<section class="screen"><div class="screen-heading"><div><p class="overline">藏身处</p><h1>交易</h1></div>
      <span class="total">累计回收收入 <strong>${credits(profile.stats.earnings)} CR</strong></span></div>
      <div class="screen-grid"><div class="vendor-list">${offers}</div><section class="box"><div class="section-head"><h2>维克托</h2><span>仓库回收 · 右键出售</span></div>
      <div class="stash-grid">${this.stashGrid(profile,'trade',false)}</div></section></div></section>`;
  }

  private settings(profile:Profile,conf: boolean) {
    const s=profile.settings;
    return `<section class="screen"><div class="screen-heading"><div><p class="overline">藏身处</p><h1>设置</h1></div></div>
      <div class="screen-grid"><section class="box settings"><h2>显示与操作</h2>
      <label>总音量 <input data-setting="volume" type="range" min="0" max="1" step=".05" value="${s.volume}"></label>
      <label>鼠标灵敏度 <input data-setting="sensitivity" type="range" min=".25" max="2.5" step=".05" value="${s.sensitivity}"></label>
      <label>渲染分辨率 <select data-setting="resolution"><option value="1" ${s.resolution===1?'selected':''}>原生</option>
      <option value="2" ${s.resolution===2?'selected':''}>性能优先</option></select></label>
      <label>行走镜头晃动 <input data-setting="bob" type="checkbox" ${s.bob?'checked':''}></label>
      <label>敌人声音提示 <input data-setting="subtitles" type="checkbox" ${s.subtitles?'checked':''}></label>
      <div class="settings-reset"><h3>本地档案</h3>${conf ? '<p>重置会清除这台浏览器中的装备、仓库、信用点和统计。</p>' : ''}
      ${button(conf?'确认清除档案':'重置存档',conf?'confirm-reset':'reset','','','danger')}${conf?button('取消','cancel-reset'):''}</div></section>
      <section class="box"><h2>操作手册</h2>${this.controlTable()}</section></div></section>`;
  }

  private controlTable() {
    return `<dl class="controls">${controls.map(([key,description])=>`<div><dt><kbd>${key}</kbd></dt><dd>${description}</dd></div>`).join('')}</dl>`;
  }

  /* ---------------- 局内 ---------------- */
  raid(panel:PlayPanel,kit:Kit,cache:Cache|undefined,location:Point,heading:number,confirmAbandon:boolean) {
    if (!this.hud) {
      this.host.innerHTML=`<div class="hud">
        <div class="damage" data-hud="damage"></div>
        <div class="hud-top"><div class="hud-location"><small>07 / 封锁区</small><strong data-hud="area"></strong></div>
          <div class="hud-compass"><span>·</span><strong data-hud="direction"></strong><span>·</span><small data-hud="heading"></small></div>
          <div class="hud-clock"><small>信号窗口</small><strong data-hud="clock"></strong></div></div>
        <div class="crosshair" data-hud="cross"><i></i><i></i><i></i><i></i><b></b></div>
        <div class="hitmarker" data-hud="hit" aria-hidden="true">×</div>
        <div class="hud-interact" data-hud="interact" hidden>
          <strong data-hud="extraction"></strong><div data-hud="prompt"></div>
          <div class="progress" data-hud="progress" hidden><i data-hud="progress-fill"></i></div>
        </div>
        <div class="hud-caption" data-hud="caption"></div>
        <div class="hud-bottom"><div class="vitals"><div class="health-line"><span>生命</span><strong data-hud="hp"></strong></div>
          <div class="meter health"><i data-hud="health-fill"></i></div>
          <div class="meter stamina"><i data-hud="stamina-fill"></i></div>
          <small data-hud="armor"></small></div>
          <div class="field-shortcuts"><kbd>TAB</kbd> 背包 &nbsp; <kbd>M</kbd> 地图 &nbsp; <kbd>F</kbd> 手电 &nbsp; <kbd>3</kbd> 小刀</div>
          <div class="weapon-hud"><span data-hud="weapon"></span><div data-hud="ammo-count"><strong data-hud="rounds"></strong><small data-hud="reserve"></small></div>
          <small data-hud="ammo"></small></div></div>
      </div><div id="raid-panel"></div><div class="pointer-prompt" hidden>
        ${button('点击继续行动','restore-pointer','','','primary')}
      </div>`;
      this.hud=this.host.querySelector('.hud')!;
      this.hudValues=new Map([...this.hud.querySelectorAll<HTMLElement>('[data-hud]')].map(el => [el.dataset.hud!,el]));
    }
    this.closeLayers();
    if (this.detail.open) this.detail.close();
    this.drag.cancel();this.grids.clear();
    this.raidKit=panel==='inventory' ? kit : undefined;
    this.statusReadings=undefined;
    const root=this.host.querySelector<HTMLElement>('#raid-panel')!;
    if (!panel) { root.innerHTML='';this.preview.show();this.selection=undefined;return; }
    const restore=this.preserveGridScroll();
    this.menus.clear();this.primary.clear();this.entries.clear();
    if (cache) this.index(cache.entries);
    this.index(kitEntries(kit));
    if (cache?.character) this.index(kitEntries(cache.character));
    if (cache?.kind==='drop') for (const entry of cache.entries) for (const grid of entry.contents ?? []) this.index(grid);
    for (const slot of slots) { const entry=kit.gear[slot]; if (entry) this.entries.set(entry.key,entry); }
    const markup=panel==='inventory' ? this.raidInventory(kit,cache) : panel==='map' || panel==='status'
      ? `<section class="equipment-screen equipment-raid" data-inventory-screen="${panel}">
          ${this.equipmentNav(panel)}<section class="equipment-reading" data-inventory-scroll="${panel}">
          ${panel==='map' ? `<h2>07 号转播站</h2>${mapMarkup()}<div class="map-key"><span><i class="swatch entry"></i>当前位置</span><span><i class="swatch exit"></i>撤离区 · E 呼叫</span></div>`
          : '<h2>行动状态</h2><dl class="raid-readings"><div><dt>生命</dt><dd data-equipment-hp></dd></div><div><dt>体力</dt><dd data-equipment-stamina></dd></div><div><dt>信号窗口</dt><dd data-equipment-clock></dd></div></dl>'}
          </section>${this.inventoryFooter(kit)}</section>`
      : `<section class="overlay"><div class="modal pause-dialog"><p class="overline">行动暂停</p><h2>${confirmAbandon ? '放弃这次行动？' : '信号待命'}</h2>
          ${confirmAbandon ? '<p>弃离将损失本次携带的所有装备与物资。</p>' : '<p>点击返回现场，重新锁定鼠标。</p>'}
          <div class="modal-actions">${confirmAbandon ? button('确认弃离','confirm-abandon','','','danger')+button('取消','cancel-abandon')
            : button('返回现场','resume','','','primary')+button('战术地图','map')+button('放弃行动','abandon','','','quiet')}</div></div></section>`;
    if (panel==='inventory') this.syncInventoryMarkup(root,markup);
    else root.innerHTML=markup;
    if (panel==='status') this.statusReadings={
      hp:root.querySelector('[data-equipment-hp]')!,stamina:root.querySelector('[data-equipment-stamina]')!,clock:root.querySelector('[data-equipment-clock]')!,
    };
    restore();
    this.preview.show(root.querySelector<HTMLElement>('[data-character-preview]') ?? undefined,kit);
    this.drawMap(location,heading);
  }

  pointerPrompt(show:boolean) {
    const prompt=this.host.querySelector<HTMLElement>('.pointer-prompt');
    if (prompt) prompt.hidden=!show;
  }

  private equipmentNav(active:'inventory'|'status'|'map') {
    return `<header class="equipment-nav"><strong>DEAD FREQUENCY</strong><nav aria-label="行动面板">
      ${([['inventory','装备'],['status','状态'],['map','地图']] as const).map(([id,label])=>
        `<button type="button" data-action="equipment-tab" data-id="${id}" ${active===id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}
      </nav><button type="button" data-action="resume" aria-label="返回现场">返回现场 <kbd>ESC</kbd></button></header>`;
  }

  private raidInventory(kit:Kit,cache?:Cache) {
    this.primeScan(cache);
    const corpse=cache?.character;
    const loot=cache ? this.grid(cache.entries,entry => ({
      menu:[{label:'拾取',action:'collect',id:entry.key},...equipMenu(entry,'ground-equip')],
      primary:{label:'拾取',action:'collect',id:entry.key},
    })) : '';
    const grid=cache && gridOf(cache.entries);
    return `<section class="equipment-screen equipment-raid inventory-dialog ${corpse ? 'corpse-dialog' : ''}" data-inventory-screen="${cache?.key ?? 'inventory'}">
      ${this.equipmentNav('inventory')}
      <div class="inventory-heading"><h2>${corpse ? '尸体搜刮' : cache?.name ?? '背包与装备'}</h2>
      ${cache?.entries.length ? button('全部拾取','collect-all') : ''}</div>
      <div class="equipment-content ${corpse ? 'inventory-corpse' : cache ? 'inventory-three' : 'inventory-standalone'}">${this.CharacterInventoryPanel(kit,'回收员',true,true,cache)}
        ${corpse ? this.CharacterInventoryPanel(corpse,cache!.name,true,false) : cache ? `<section class="external-column" data-inventory-scroll="loot"><div class="section-head"><h3>容器内容</h3>
          <span>${grid ? `${usedSpace(cache.entries)} / ${grid.columns*grid.rows} 格` : ''}</span></div>
        ${loot || empty('容器已空')}
        ${cache.kind==='drop' ? cache.entries.flatMap(entry=>(entry.contents ?? []).map((grid,i)=>`<h3>${items[entry.id].name} · ${i+1}</h3>${this.grid(grid,item=>{
          const collect={label:'拾取',action:'ground-item',id:item.key};
          return {menu:[collect,...equipMenu(item,'ground-equip')],primary:collect};
        })}`)).join('') : ''}</section>` : ''}</div>
    ${this.inventoryFooter(kit)}</section>`;
  }

  update(data:HudData) {
    if (!this.hud) return;
    const get=(name:string) => this.hudValues.get(name)!;
    const previous=this.lastHud;
    const direction=['北','东北','东','东南','南','西南','西','西北'][Math.round(data.heading/45)%8];
    const set=(name:string,value:string|number) => {
      const el=get(name), text=String(value);
      if (el.textContent!==text) el.textContent=text;
    };
    set('area',data.area);set('direction',direction);set('heading',String(Math.round(data.heading)%360).padStart(3,'0')+'°');
    set('clock',timeText(data.time));set('hp',data.hp);
    if (this.statusReadings) for (const [key,value] of [['hp',data.hp],['stamina',data.stamina],['clock',timeText(data.time)]] as const) {
      const reading=this.statusReadings[key];
      if (reading.textContent!==String(value)) reading.textContent=String(value);
    }
    if (this.raidKit && data.hp!==previous?.hp) for (const slot of ['armor','helmet'] as const) {
      const gear=this.raidKit.gear[slot];
      const card=this.host.querySelector(`.character-inventory [data-slot="${slot}"]`);
      const bar=card?.querySelector('progress'),label=card?.querySelector('.gear-durability');
      if (gear?.integrity!==undefined && bar && label) {
        bar.value=gear.integrity;
        label.textContent=`${Math.ceil(gear.integrity)}/${maxIntegrity(gear)}`;
      }
    }
    set('armor',data.armor ? '护甲  '+data.armor : '无有效护甲');
    set('weapon',data.weapon);set('rounds',String(data.rounds).padStart(2,'0'));set('reserve',' / '+data.reserve);
    if (data.knife!==previous?.knife) get('ammo-count').hidden=data.knife;
    set('ammo',data.ammo);set('prompt',data.prompt);set('caption',data.caption);
    set('extraction',data.extraction>0 ? `${data.exit} · ${data.extraction.toFixed(1)} 秒` : '');
    if (data.hp!==previous?.hp) get('health-fill').style.width=data.hp+'%';
    if (data.stamina!==previous?.stamina) get('stamina-fill').style.width=data.stamina+'%';
    get('clock').classList.toggle('urgent',data.time<120);
    get('damage').style.opacity=String(data.damage*.80);
    get('hit').style.opacity=data.hit>0 ? '1' : '0';
    get('hit').classList.toggle('headshot',data.headshot);
    get('cross').style.setProperty('--spread', Math.round(7+data.moving*1.1)+'px');
    get('cross').style.opacity=String(1-data.ads*.87);
    get('interact').hidden=!data.prompt;
    get('progress').hidden=data.progress<0;
    if (data.progress>=0) get('progress-fill').style.width=(data.progress*100)+'%';
    this.lastHud=data;
  }

  result(result:Result) {
    this.drag.cancel();this.grids.clear();
    this.hud=undefined;
    this.statusReadings=undefined;this.raidKit=undefined;
    this.closeLayers();
    if (this.detail.open) this.detail.close();
    this.preview.show();this.selection=undefined;
    const won=result.outcome==='escaped';
    const titles={escaped:'撤离成功',dead:'阵亡',timeout:'信号窗口关闭',abandoned:'行动弃离'};
    const values=[
      ['行动时间',timeText(result.elapsed)],['击倒目标',result.kills],['搜索容器',result.searched],
      [won?'带回物资':'装备与物资损失',won ? result.found+' 件' : credits(result.lost)+' CR'],
      ...(won ? [['战利品回收估值',credits(result.haul)+' CR']] : []),
    ];
    this.host.innerHTML=`<section class="overlay result-overlay"><div class="modal result-dialog ${won?'success':'failure'}">
      <p class="overline">行动结算 / 07 号站</p><h1>${titles[result.outcome]}</h1>
      <p>${won ? `${result.exit} · 装备与战利品已随身带回。` : '本次携带的装备与物资已遗失。'}</p>
      <dl>${values.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${button('返回藏身处','hideout','','','primary loud')}</div></section>`;
  }

  private drawMap(player?:Point, heading=0) {
    for (const canvas of this.host.querySelectorAll<HTMLCanvasElement>('canvas[data-map]')) {
      const ctx=canvas.getContext('2d')!;
      const w=canvas.width,h=canvas.height,pad=24, sx=(w-pad*2)/(bounds*2),sz=(h-pad*2)/(bounds*2);
      const x=(value:number)=>pad+(value+bounds)*sx, z=(value:number)=>pad+(value+bounds)*sz;
      const compact=canvas.dataset.map==='compact';
      ctx.fillStyle='#202d28';ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='#37463c';ctx.lineWidth=1;
      for (let offset=-40;offset<=40;offset+=5) {
        ctx.beginPath();ctx.moveTo(x(offset),pad);ctx.lineTo(x(offset),h-pad);ctx.stroke();
        ctx.beginPath();ctx.moveTo(pad,z(offset));ctx.lineTo(w-pad,z(offset));ctx.stroke();
      }
      ctx.strokeStyle='#708279';ctx.strokeRect(pad,pad,w-2*pad,h-2*pad);
      for (const cover of obstacles) {
        ctx.fillStyle='#46554b';
        ctx.fillRect(x(cover.x-cover.w/2),z(cover.z-cover.d/2),cover.w*sx,cover.d*sz);
      }
      for (const b of buildings) {
        ctx.fillStyle=b.name==='信号研究室' ? '#52756a' : '#58665a';
        ctx.fillRect(x(b.x-b.w/2),z(b.z-b.d/2),b.w*sx,b.d*sz);
        ctx.strokeStyle='#a8ad91';
        ctx.strokeRect(x(b.x-b.w/2),z(b.z-b.d/2),b.w*sx,b.d*sz);
        ctx.fillStyle='#ebebcd';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.font=`bold ${compact ? 16 : 14}px "Microsoft YaHei", sans-serif`;
        ctx.fillText(b.name,x(b.x),z(b.z),b.w*sx-5);
      }
      for (const exit of exits) {
        ctx.fillStyle='#a3d0a1';ctx.strokeStyle='#a3d0a1';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(x(exit.x),z(exit.z),9,0,Math.PI*2);ctx.stroke();
        ctx.font='bold 14px monospace';ctx.fillText(exit.id,x(exit.x),z(exit.z)+1);
        if (!compact) {
          ctx.textAlign='right';ctx.fillText(exit.name,x(exit.x)-13,z(exit.z));
        }
      }
      const positions=player ? [player] : starts;
      ctx.fillStyle='#f2bd70';
      for (const point of positions) {
        ctx.save();ctx.translate(x(point.x),z(point.z));ctx.rotate(heading);
        ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(6,5);ctx.lineTo(-6,5);ctx.closePath();ctx.fill();ctx.restore();
      }
    }
  }
}
