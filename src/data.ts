export const RAID_SECONDS = 15 * 60;
export const EXTRACT_SECONDS = 6;
export const BAG_CAPACITY = 18;
/* 仓库按「堆」计格，一组占一格（和潮汐线后期的口径一致）。
   只在买入时拦截，撤离带回允许溢出，避免结算因为满仓吞掉战利品。 */
export const STASH_CAPACITY = 90;

export type AmmoId = '9mm' | '556' | '12g';
export type WeaponId = 'k9' | 'ar56' | 'p12';
export type ArmorId = 'vest' | 'plate';
export type Slot = 'primary' | 'secondary' | 'armor';
export type Kind = 'weapon' | 'ammo' | 'armor' | 'medical' | 'salvage';

/* 主题分类与潮汐线对齐：kind 管「能不能用」，cat 管「在哪一类里出现」。
   med 类战利品（注射器、X 光片）kind 仍是 salvage，不能回血，只是归类在医疗。
   字段口径也照潮汐线：r 是 1~5 的稀有度，w 是重量（公斤），目前只做展示与后续负重预留。 */
export type Cat = 'weapon' | 'ammo' | 'armor' | 'med' | 'elec' | 'ind' | 'mil' | 'intel' | 'life' | 'odd';

type ItemDef = {
  name: string; mark: string; kind: Kind; cat: Cat; r: 1|2|3|4|5;
  w: number; price: number; size: number; stack: number; description: string;
};

export const items = {
  /* ---------- 武器 / 弹药 / 护甲 ---------- */
  k9:      {name:'K-9 紧凑手枪', mark:'K9', kind:'weapon', cat:'weapon', r:1, w:1.1, price:320, size:3, stack:1, description:'轻便的半自动自卫武器。'},
  ar56:    {name:'AR-56 回收员步枪', mark:'AR', kind:'weapon', cat:'weapon', r:4, w:3.6, price:1150, size:6, stack:1, description:'全自动步枪。远距离建议短点射。'},
  p12:     {name:'P-12 泵动霰弹枪', mark:'P12', kind:'weapon', cat:'weapon', r:2, w:3.2, price:720, size:5, stack:1, description:'近距离高伤害，逐发装填。'},
  '9mm':   {name:'9×19 mm 弹', mark:'9', kind:'ammo', cat:'ammo', r:1, w:0.012, price:3, size:1, stack:30, description:'用于 K-9。'},
  '556':   {name:'5.56 mm 弹', mark:'56', kind:'ammo', cat:'ammo', r:1, w:0.013, price:5, size:1, stack:30, description:'用于 AR-56。'},
  '12g':   {name:'12 号鹿弹', mark:'12', kind:'ammo', cat:'ammo', r:1, w:0.05, price:8, size:1, stack:12, description:'用于 P-12。'},
  vest:    {name:'旧芳纶背心', mark:'V1', kind:'armor', cat:'armor', r:2, w:7.5, price:310, size:3, stack:1, description:'削减枪伤和近战伤害，防护随受击消耗。'},
  plate:   {name:'陶瓷插板背心', mark:'V2', kind:'armor', cat:'armor', r:4, w:11.8, price:850, size:4, stack:1, description:'比芳纶更厚重，能吸收更多伤害。'},

  /* ---------- 医疗 ---------- */
  bandage: {name:'压缩敷料', mark:'+', kind:'medical', cat:'med', r:1, w:0.05, price:65, size:1, stack:3, description:'恢复 28 点生命。'},
  medkit:  {name:'制式野战医疗包', mark:'M+', kind:'medical', cat:'med', r:2, w:0.6, price:175, size:2, stack:2, description:'恢复 60 点生命。'},
  med02:  {name:'一次性注射器', mark:'SY', kind:'salvage', cat:'med', r:2, w:0.15, price:300, size:1, stack:2, description:'封口完好，标签被撕掉了。林岑收。'},
  med03:  {name:'胸片胶片', mark:'XR', kind:'salvage', cat:'med', r:2, w:0.1, price:340, size:1, stack:2, description:'受潮前的最后一批。片角写着别人的名字。'},

  /* ---------- 转播站电子 ---------- */
  relay:   {name:'氧化继电器', mark:'RL', kind:'salvage', cat:'elec', r:1, w:0.3, price:88, size:1, stack:3, description:'送电时还会响一声。维克托收。'},
  elec01:  {name:'袖珍收音机', mark:'RD', kind:'salvage', cat:'elec', r:2, w:0.9, price:240, size:2, stack:1, description:'调到中波能听见东西。不是电台，是回响。'},
  elec03:  {name:'电容计算器', mark:'CC', kind:'salvage', cat:'elec', r:2, w:0.2, price:180, size:1, stack:2, description:'屏幕上留着最后一次运算的结果：0。'},
  elec02:  {name:'磁带随身听', mark:'WK', kind:'salvage', cat:'elec', r:4, w:0.35, price:980, size:2, stack:1, description:'磁带还在里面。按播放键能出声，所以它很值钱。'},
  board:   {name:'稳频电路板', mark:'PCB', kind:'salvage', cat:'elec', r:2, w:0.5, price:260, size:2, stack:1, description:'停电后，指示灯保持了整整两天。'},

  /* ---------- 工业 / 机械 ---------- */
  copper:  {name:'密封铜线卷', mark:'CU', kind:'salvage', cat:'ind', r:1, w:1.6, price:105, size:2, stack:2, description:'防潮纸上盖着转播站的旧公章。'},
  ind02:   {name:'旧轴承', mark:'BR', kind:'salvage', cat:'ind', r:2, w:2.2, price:260, size:2, stack:1, description:'转起来还是顺的。手指一推能转很久。'},
  ind03:   {name:'碎裂压力表', mark:'PG', kind:'salvage', cat:'ind', r:3, w:1.1, price:480, size:2, stack:1, description:'玻璃碎了，指针停在量程上限。它见过那天的压力。'},

  /* ---------- 情报 / 文档 ---------- */
  tape:    {name:'监听磁带', mark:'T90', kind:'salvage', cat:'intel', r:2, w:0.12, price:225, size:1, stack:1, description:'最后九秒只有空响，倒带以后却多出一段人声。'},
  intel:   {name:'07 号站密封卷宗', mark:'D7', kind:'salvage', cat:'intel', r:3, w:0.4, price:510, size:2, stack:1, description:'封锁当夜的值班表有三行被划掉。'},
  life02:  {name:'泛黄旧报纸', mark:'NP', kind:'salvage', cat:'intel', r:1, w:0.2, price:70, size:1, stack:2, description:'日期停在事故前三天。头版是一场没人关心的听证会。'},
  art03:   {name:'未显影底片', mark:'NG', kind:'salvage', cat:'intel', r:3, w:0.05, price:560, size:1, stack:1, description:'对着光看不出什么。需要显影，但你可能舍不得用掉它。'},

  /* ---------- 军用 ---------- */
  mil06:   {name:'军用罗盘', mark:'CP', kind:'salvage', cat:'mil', r:3, w:0.25, price:620, size:1, stack:1, description:'刻度盘进了水，指针还是准的。'},

  /* ---------- 生活 ---------- */
  life01:  {name:'搪瓷缸', mark:'MG', kind:'salvage', cat:'life', r:1, w:0.4, price:90, size:1, stack:1, description:'磕掉了一块瓷，露出底下的铁。里面的水早就干了。'},
  life06:  {name:'铝饭盒', mark:'BX', kind:'salvage', cat:'life', r:1, w:0.5, price:110, size:1, stack:1, description:'盖子扣得很紧，里面是一张折了四次的班表。'},
  life03:  {name:'老式台灯', mark:'LP', kind:'salvage', cat:'life', r:2, w:1.8, price:280, size:2, stack:1, description:'灯泡是好的。这里已经四年没有电了。'},
  life08:  {name:'玻璃糖罐', mark:'JR', kind:'salvage', cat:'life', r:2, w:0.6, price:230, size:1, stack:1, description:'糖结成一块，底下压着两枚旧硬币。'},
  life11:  {name:'双铃闹钟', mark:'AL', kind:'salvage', cat:'life', r:3, w:0.9, price:470, size:1, stack:1, description:'发条还能上。它停在 04:17，停得很准。'},
  life33:  {name:'金丝眼镜', mark:'GL', kind:'salvage', cat:'life', r:5, w:0.05, price:2100, size:1, stack:1, description:'镜片没碎。有人把它摘下来放在桌上，再没回来拿。'},

  /* ---------- 异常 ---------- */
  crystal: {name:'低鸣玻璃', mark:'Δ', kind:'salvage', cat:'odd', r:4, w:0.6, price:1320, size:2, stack:1, description:'贴近耳边时，声音来自房间另一侧。'},
  core:    {name:'离线谐振芯', mark:'Ω', kind:'salvage', cat:'odd', r:5, w:1.4, price:1940, size:3, stack:1, description:'封铅盒还未开封，内部计数器已在走动。'},
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof items;
/* 下标就是 r；第 0 位占位，让 r1 直接落到「普通」 */
export const rarityNames = ['','普通','改良','稀有','珍贵','异常'] as const;
export const catNames: Record<Cat,string> = {
  weapon:'武器', ammo:'弹药', armor:'护甲', med:'医疗', elec:'电子',
  ind:'工业', mil:'军品', intel:'情报', life:'生活', odd:'异常',
};
export const slotNames: Record<Slot, string> = {primary:'主武器', secondary:'副武器', armor:'护甲'};
export const slots: Slot[] = ['primary','secondary','armor'];

type Weapon = {
  ammo: AmmoId; damage: number; interval: number; capacity: number; reload: number;
  recoil: number; spread: number; range: number; pellets: number; automatic: boolean;
};

export const weapons: Record<WeaponId, Weapon> = {
  k9: {ammo:'9mm', damage:29, interval:.23, capacity:12, reload:1.25, recoil:.026, spread:.010, range:30, pellets:1, automatic:false},
  ar56: {ammo:'556', damage:25, interval:.105, capacity:24, reload:1.65, recoil:.015, spread:.010, range:53, pellets:1, automatic:true},
  p12: {ammo:'12g', damage:15, interval:.86, capacity:5, reload:.56, recoil:.062, spread:.061, range:21, pellets:7, automatic:false},
};

export const armor: Record<ArmorId, {protection:number; durability:number}> = {
  vest:{protection:.35, durability:65}, plate:{protection:.56, durability:110},
};
export const healing = {bandage:28, medkit:60} as const;

export const vendors: {name:string; call:string; offers:[ItemId,number][]}[] = [
  {name:'鲁克', call:'军械台', offers:[['k9',1], ['ar56',1], ['p12',1], ['9mm',15], ['556',15], ['12g',6]]},
  {name:'林岑', call:'医疗与防护', offers:[['vest',1], ['plate',1], ['bandage',1], ['medkit',1], ['med02',1]]},
];

export type LootKind = 'tool' | 'file' | 'supply' | 'medical' | 'sealed' | 'corpse' | 'anomaly' | 'drop';
type Roll = [id:ItemId, weight:number, min?:number, max?:number];

/* 掉落按「地点讲故事」排：工具间是电子与机械，档案柜是情报，
   医疗柜是药和片子，密封柜才是值钱货。
   生活类只做低价值填充，保证搜完一屋子不会全是钱。 */
export const lootTables: Record<Exclude<LootKind,'drop'>, {count:[number,number]; pool:Roll[]}> = {
  tool:{count:[2,3], pool:[
    ['relay',30],['copper',24],['elec01',10],['elec03',12],['ind02',10],
    ['life01',12],['life06',8],['9mm',18,8,16],['bandage',8],
  ]},
  file:{count:[1,3], pool:[
    ['tape',26],['intel',11],['board',16],['life02',20],['art03',9],
    ['med03',10],['life08',8],['bandage',7],
  ]},
  supply:{count:[2,4], pool:[
    ['556',26,10,22],['9mm',24,10,19],['12g',22,4,9],['p12',5],['ar56',3],
    ['vest',7],['plate',3],['medkit',7],['med02',9],['life06',8],
  ]},
  medical:{count:[2,3], pool:[
    ['bandage',40,1,2],['medkit',24],['med02',16],['med03',12],['vest',6],['life08',8],
  ]},
  sealed:{count:[2,3], pool:[
    ['intel',30],['board',20],['tape',10],['crystal',13],['core',4],
    ['elec02',8],['mil06',7],['life03',5],['plate',5],['life33',3],
  ]},
  corpse:{count:[2,3], pool:[
    ['9mm',22,5,15],['556',17,6,15],['12g',12,3,7],['bandage',20],['vest',8],
    ['k9',5],['ar56',4],['tape',8],['life11',6],
  ]},
  anomaly:{count:[1,2], pool:[
    ['tape',24],['relay',24],['board',20],['crystal',11],['intel',8],['life11',7],
  ]},
};

export type EnemyKind = 'scav' | 'echo';
export const enemyTypes = {
  scav:{hp:73, pace:2.35, view:24, hearing:20, range:16, damage:13, radius:.35, height:1.76},
  echo:{hp:63, pace:4.85, view:15, hearing:28, range:1.55, damage:20, radius:.38, height:1.43},
} satisfies Record<EnemyKind, Record<string,number>>;
