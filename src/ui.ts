import { armor, BAG_CAPACITY, catNames, items, rarityNames, slots, slotNames, STASH_CAPACITY, vendors, weapons } from './data.ts';
import type { ArmorId, Cat, Slot, WeaponId } from './data.ts';
import { compatible, sellPrice, usedSpace } from './inventory.ts';
import type { Kit, Stack } from './inventory.ts';
import { buildings, bounds, exits, obstacles, starts } from './sector.ts';
import type { Point } from './sector.ts';
import { needsRelief } from './save.ts';
import type { Profile, Result } from './save.ts';
import type { Cache, HudData } from './raid.ts';

export type Tab = 'brief'|'stash'|'trade'|'settings';
export type PlayPanel = 'pause'|'inventory'|'map'|null;
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
const gearView=(kit:Kit,raid:boolean) => `<div class="gear">${slots.map(slot => {
  const item=kit.gear[slot];
  return `<div class="gear-slot"><small>${slotNames[slot]}</small>${item ? itemRow(item,button('卸下',raid?'raid-unequip':'unequip',slot))
    : '<span class="slot-empty">空槽</span>'}</div>`;
}).join('')}</div>`;
const itemRow=(entry:Stack,actions:string) => {
  const def=items[entry.id];
  return `<div class="item-row r${def.r}"><span class="item-icon" aria-hidden="true">${def.mark}</span>
    <span class="item-copy"><strong>${def.name} ${entry.qty>1 ? `<small>×${entry.qty}</small>` : ''}</strong>
    <small>${rarityNames[def.r]} / ${def.w.toFixed(2)} kg</small></span><div class="item-actions">${actions}</div></div>`;
};
const equipMenu=(entry:Stack,action:string) => slots.filter(slot => compatible(slot,entry))
  .map(slot => ({label:slot==='armor' ? '穿戴' : slot==='primary' ? '装备到主武器' : '装备到副武器',action,id:entry.key,value:slot}));

const mapMarkup=(compact=false) => `<canvas class="sector-map" data-map="${compact ? 'compact' : 'detail'}" width="440" height="400" aria-label="07 号站地图。北侧水闸和东侧公路可撤离。"></canvas>`;

export class UI {
  private hud?:HTMLElement;
  private hudValues=new Map<string,HTMLElement>();
  private lastHud?:HudData;
  private noticeTimer=0;
  private controller=new AbortController();
  /* 物品格交互：单击看详情、右键出菜单、双击快速转移。
     tip / menu 挂在 body 上，不跟着 #app 的 innerHTML 重建被冲掉。 */
  private tip:HTMLElement;
  private menu:HTMLElement;
  private menus=new Map<string,MenuItem[]>();
  private primary=new Map<string,MenuItem>();
  private openKey:string|null=null;
  /* 仓库的筛选状态放在实例上：动作触发的整页重建不会把玩家挑好的分类冲掉 */
  private stashFilter:StashFilter='all';
  private stashSort:StashSort='value';
  private stashQuery='';
  private stashProfile?:Profile;
  private lastTab?:Tab;

  constructor(private host:HTMLElement,private noticeRoot:HTMLElement,private act:Action) {
    this.tip=document.createElement('aside');
    this.tip.className='item-tip';this.tip.hidden=true;
    this.menu=document.createElement('div');
    this.menu.className='ctx';this.menu.hidden=true;
    document.body.append(this.tip,this.menu);

    host.addEventListener('click',event => {
      const target=event.target as HTMLElement;
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
      if (element) { this.closeLayers();this.act(element.dataset.action!,element.dataset.id ?? '',element.dataset.value ?? '');return; }
      const cell=target.closest<HTMLElement>('.cell');
      if (cell) { this.showTip(cell);return; }
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
      this.showMenu(cell,event.clientX,event.clientY);
    },{signal:this.controller.signal});
    host.addEventListener('dblclick',event => {
      const cell=(event.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell) return;
      const key=cell.dataset.key!;
      const primary=this.primary.get(key);
      if (primary) { this.closeLayers();this.act(primary.action,primary.id ?? '',primary.value ?? ''); }
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
      if (item) this.act(item.action,item.id ?? '',item.value ?? '');
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
      /* 浮窗/菜单算最内层：ESC 只收它们，不把暂停页也一起弹出来 */
      if (event.key==='Escape' && (!this.tip.hidden || !this.menu.hidden)) {
        this.closeLayers();
        event.stopImmediatePropagation();
      }
    },{signal:this.controller.signal});
    window.addEventListener('resize',() => this.closeLayers(),{signal:this.controller.signal});
    document.addEventListener('scroll',() => this.closeLayers(),{capture:true,signal:this.controller.signal});
  }

  dispose() {
    this.controller.abort();
    window.clearTimeout(this.noticeTimer);
    this.tip.remove();this.menu.remove();
  }

  toast(message:string) {
    this.noticeRoot.textContent=message;
    this.noticeRoot.classList.add('on');
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer=window.setTimeout(() => this.noticeRoot.classList.remove('on'),2700);
  }

  /* ---------------- 物品格 ----------------
     一格一件，不按 size 拆格（类似潮汐线后期的口径）。容量单独用条和读数表示，
     这样 18 容量不会变成 18 个空格子，稀有度也只需要一层边框色。 */
  private cell(entry:Stack,menu:MenuItem[],primary?:MenuItem,withName=false) {
    const def=items[entry.id];
    this.menus.set(entry.key,menu);
    if (primary) this.primary.set(entry.key,primary);
    const qty=entry.qty>1 ? `<i>${entry.qty}</i>` : '';
    return `<div class="cell r${def.r}${withName ? ' with-name' : ''}" data-key="${entry.key}" tabindex="0" role="button" title="${def.name}"
      aria-label="${def.name}${entry.qty>1 ? ' ×'+entry.qty : ''}，右键更多操作">
      <span class="cell-mark">${def.mark}</span>${qty}${withName ? `<span class="cell-name">${def.name}</span>` : ''}</div>`;
  }

  private grid(entries:Stack[], build:(entry:Stack) => {menu:MenuItem[];primary?:MenuItem;slot?:string}, withName=false) {
    if (!entries.length) return '';
    return `<div class="cell-grid">${entries.map(entry => {
      const spec=build(entry);
      return `<div class="cell-slot">${this.cell(entry,spec.menu,spec.primary,withName)}${spec.slot ? `<small>${spec.slot}</small>` : ''}</div>`;
    }).join('')}</div>`;
  }

  private capacity(used:number,label='容量') {
    return `<div class="section-head"><h3>${label}</h3><span class="capacity ${used>=BAG_CAPACITY?'full':''}">${used} / ${BAG_CAPACITY}</span></div>
      <div class="capacity-track"><i style="width:${Math.min(100,used/BAG_CAPACITY*100)}%"></i></div>`;
  }

  /* 背包：装备 / 使用 / 放入 / 丢弃，全部走菜单，格子上不再挂一排按钮 */
  private bagView(kit:Kit,raid:boolean,cache?:Cache) {
    const used=usedSpace(kit.bag);
    const entries=this.grid(kit.bag,entry => {
      const menu:MenuItem[]=[...equipMenu(entry,raid?'raid-equip':'equip-bag')];
      if (raid && items[entry.id].kind==='medical') menu.push({label:'使用',action:'heal',id:entry.id});
      if (raid && cache) menu.push({label:'放入容器',action:'put',id:entry.key});
      if (!raid) menu.push({label:'存回仓库',action:'unpack',id:entry.key});
      menu.push({label:'丢弃',action:'drop',id:entry.key,danger:true});
      const primary=cache ? {label:'放入容器',action:'put',id:entry.key}
        : !raid ? {label:'存回仓库',action:'unpack',id:entry.key} : undefined;
      return {menu,primary};
    });
    return `${this.capacity(used,'行动背包')}${entries || empty('背包为空')}`;
  }

  /* ---------------- 仓库 ----------------
     结构照潮汐线的局外仓库：容量读数 + 分类计数 + 方格网 + 页脚估价。
     不同之处是分页换成滚动、加了搜索与排序、格子里带名称——
     分页在这里没有意义（一页摆不满就是一堆空格），滚动和多条件筛选更顺手。 */
  private stashSpec(entry:Stack,mode:'stash'|'trade') {
    const sale={label:`出售 · +${credits(sellPrice(entry)*entry.qty)} CR`,action:'sell',id:entry.key};
    return {
      menu:mode==='trade'
        ? [sale,{label:'放入背包',action:'pack',id:entry.key}]
        : [{label:'放入背包',action:'pack',id:entry.key},...equipMenu(entry,'equip-stash'),sale],
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
    if (list.length) return this.grid(list,entry => this.stashSpec(entry,mode),true);
    const filtered=honour && Boolean(this.stashQuery.trim() || this.stashFilter!=='all');
    return `<p class="empty stash-empty">${profile.stash.length
      ? '没有符合当前筛选的物资。'
      : '仓库为空。可以从交易台购买补给，或带回封锁区物资。'}${filtered
      ? ' <button type="button" class="mini" data-stash-reset>清除筛选</button>' : ''}</p>`;
  }

  private stashFoot(profile:Profile) {
    const list=this.stashList(profile);
    const value=list.reduce((sum,entry) => sum+sellPrice(entry)*entry.qty,0);
    const showing=this.stashFilter!=='all' || this.stashQuery.trim();
    return `<span>${showing ? `筛选 ${list.length} / ${profile.stash.length} 格` : `库存 ${profile.stash.length} 格`}</span>
      <span>可回收 <b>${credits(value)} CR</b></span>
      <span class="stash-hint">单击详情 · 右键操作 · 双击入包</span>`;
  }

  private stashPanel(profile:Profile) {
    this.stashProfile=profile;
    const total=profile.stash.length,over=total-STASH_CAPACITY;
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
    const profile=this.stashProfile;
    if (!profile) return;
    const grid=this.host.querySelector<HTMLElement>('[data-stash-grid]');
    if (grid) grid.innerHTML=this.stashGrid(profile);
    const foot=this.host.querySelector<HTMLElement>('[data-stash-foot]');
    if (foot) foot.innerHTML=this.stashFoot(profile);
  }

  /* ---------------- 浮窗与菜单 ---------------- */
  private showTip(cell:HTMLElement) {
    const key=cell.dataset.key!;
    const entry=this.findEntry(key);
    if (!entry) return;
    const def=items[entry.id];
    const condition=entry.rounds!==undefined ? `余弹 ${entry.rounds} / ${weapons[entry.id as WeaponId].capacity}`
      : entry.integrity!==undefined ? `防护 ${Math.ceil(entry.integrity)} / ${armor[entry.id as ArmorId].durability}` : '';
    this.tip.className='item-tip r'+def.r;
    this.tip.innerHTML=`<div class="tip-head"><span class="tip-mark">${def.mark}</span>
        <div><strong>${def.name}</strong><small>${rarityNames[def.r]} · ${catNames[def.cat]}</small></div></div>
      <p>${def.description}</p>
      <dl><div><dt>占用</dt><dd>${def.size} 格</dd></div><div><dt>重量</dt><dd>${def.w.toFixed(2)} kg</dd></div>
      <div><dt>单价</dt><dd>${credits(def.price)} CR</dd></div>${condition ? `<div><dt>状态</dt><dd>${condition}</dd></div>` : ''}</dl>
      <small class="tip-hint">右键：操作 · 双击：快速转移</small>`;
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
    this.openKey=key;
    this.menu.innerHTML=menu.map((item,i) =>
      `<div class="ctx-row${item.danger ? ' danger' : ''}" data-mi="${i}">${item.label}</div>`).join('');
    this.menu.hidden=false;
    const w=this.menu.offsetWidth||150,h=this.menu.offsetHeight||40;
    this.menu.style.left=Math.max(8,Math.min(x,window.innerWidth-w-8))+'px';
    this.menu.style.top=Math.max(8,Math.min(y,window.innerHeight-h-8))+'px';
    this.tip.hidden=true;
  }

  private closeLayers() {
    this.tip.hidden=true;this.menu.hidden=true;
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
    this.hud=undefined;this.lastHud=undefined;
    this.closeLayers();
    /* 同一页内的动作（放入背包 / 出售）会整页重建，留住滚动位置，
       否则仓库翻到一半点一下就被弹回顶部。切页签时不保留。 */
    const previous=this.host.querySelector<HTMLElement>('.hideout');
    const scrollTop=this.lastTab===tab && previous ? previous.scrollTop : 0;
    this.menus.clear();this.primary.clear();this.entries.clear();
    this.index(profile.stash);this.index(profile.kit.bag);
    for (const slot of slots) { const entry=profile.kit.gear[slot]; if (entry) this.entries.set(entry.key,entry); }
    const navigation=(Object.keys(tabNames) as Tab[]).map(key =>
      `<button type="button" data-action="tab" data-id="${key}" ${key===tab ? 'class="active" aria-current="page"' : ''}>${tabNames[key]}</button>`).join('');
    this.host.innerHTML=`<div class="hideout ${tab==='brief'?'brief':'subpage'}">
      <header class="station-header"><div class="brand"><span class="signal-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span><strong>DEAD FREQUENCY</strong><small>环礁湾回收网络</small></span></div>
        <nav aria-label="藏身处">${navigation}</nav><div class="balance"><small>信用点</small><strong>${credits(profile.credits)} <span>CR</span></strong></div></header>
      ${warning ? `<p class="save-warning">${warning}</p>` : ''}
      ${tab==='brief' ? this.brief(profile) : tab==='stash' ? this.stash(profile) : tab==='trade' ? this.trade(profile) : this.settings(profile,confirmReset)}
    </div>`;
    this.lastTab=tab;
    const next=this.host.querySelector<HTMLElement>('.hideout');
    if (next && scrollTop) next.scrollTop=scrollTop;
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
    return `<section class="screen stash-screen"><div class="screen-heading"><div><p class="overline">藏身处</p><h1>仓库与整备</h1></div>
      ${button('返回行动简报','tab','brief','','secondary')}</div>
      <div class="screen-grid stash-layout">${this.stashPanel(profile)}
      <section class="box kit-box"><div class="section-head"><h2>当前装备</h2><span>右键操作 · 双击转移</span></div>
        ${gearView(kit,false)}${this.bagView(kit,false)}
        ${needsRelief(profile) ? `<p class="relief">${button('领取免费救济装备','relief')}</p>` : ''}</section></div></section>`;
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
      </div><div id="raid-panel"></div>`;
      this.hud=this.host.querySelector('.hud')!;
      this.hudValues=new Map([...this.hud.querySelectorAll<HTMLElement>('[data-hud]')].map(el => [el.dataset.hud!,el]));
    }
    this.closeLayers();
    const root=this.host.querySelector<HTMLElement>('#raid-panel')!;
    if (!panel) { root.innerHTML='';return; }
    this.menus.clear();this.primary.clear();this.entries.clear();
    if (cache) this.index(cache.entries);
    this.index(kit.bag);
    for (const slot of slots) { const entry=kit.gear[slot]; if (entry) this.entries.set(entry.key,entry); }
    root.innerHTML=panel==='inventory' ? this.raidInventory(kit,cache) : panel==='map'
      ? `<section class="overlay"><div class="modal map-dialog"><div class="section-head"><div><p class="overline">战术地图</p><h2>07 号转播站</h2></div>
          ${button('返回现场','resume','','','primary')}</div>
          ${mapMarkup()}<div class="map-key"><span><i class="swatch entry"></i>当前位置</span><span><i class="swatch exit"></i>撤离区 · E 呼叫</span></div></div></section>`
      : `<section class="overlay"><div class="modal pause-dialog"><p class="overline">行动暂停</p><h2>${confirmAbandon ? '放弃这次行动？' : '信号待命'}</h2>
          ${confirmAbandon ? '<p>弃离将损失本次携带的所有装备与物资。</p>' : '<p>点击返回现场，重新锁定鼠标。</p>'}
          <div class="modal-actions">${confirmAbandon ? button('确认弃离','confirm-abandon','','','danger')+button('取消','cancel-abandon')
            : button('返回现场','resume','','','primary')+button('战术地图','map')+button('放弃行动','abandon','','','quiet')}</div></div></section>`;
    this.drawMap(location,heading);
  }

  private raidInventory(kit:Kit,cache?:Cache) {
    const loot=cache ? this.grid(cache.entries,entry => ({
      menu:[{label:'拾取',action:'collect',id:entry.key}],
      primary:{label:'拾取',action:'collect',id:entry.key},
    })) : '';
    return `<section class="overlay"><div class="modal inventory-dialog"><div class="section-head"><div><p class="overline">行动物资</p>
      <h2>${cache ? cache.name : '背包与装备'}</h2></div><div class="modal-actions">
      ${cache?.entries.length ? button('全部拾取','collect-all') : ''}${button('返回现场','resume','','','primary')}</div></div>
      <div class="screen-grid">${cache ? `<section class="box"><div class="section-head"><h2>容器内容</h2><span>${cache.entries.length} 组 · 双击拾取</span></div>
        ${loot || empty('容器已空')}</section>` : `<section class="box"><h3>当前装备</h3>${gearView(kit,true)}</section>`}
        <section class="box">${this.bagView(kit,true,cache)}</section>
        ${cache ? `<section class="box gear-on-cache"><h3>当前装备</h3>${gearView(kit,true)}</section>` : ''}</div>
    </div></section>`;
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
    this.hud=undefined;
    this.closeLayers();
    const won=result.outcome==='escaped';
    const titles={escaped:'撤离成功',dead:'阵亡',timeout:'信号窗口关闭',abandoned:'行动弃离'};
    const values=[
      ['行动时间',timeText(result.elapsed)],['击倒目标',result.kills],['搜索容器',result.searched],
      [won?'带回物资':'装备与物资损失',won ? result.found+' 件' : credits(result.lost)+' CR'],
      ...(won ? [['战利品回收估值',credits(result.haul)+' CR']] : []),
    ];
    this.host.innerHTML=`<section class="overlay result-overlay"><div class="modal result-dialog ${won?'success':'failure'}">
      <p class="overline">行动结算 / 07 号站</p><h1>${titles[result.outcome]}</h1>
      <p>${won ? `${result.exit} · 新回收物资已入库，身上的装备可继续使用。` : '本次携带的装备与物资已遗失。'}</p>
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
