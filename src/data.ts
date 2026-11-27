export const RAID_SECONDS = 15 * 60;
export const EXTRACT_SECONDS = 6;
export const inventorySizes={
  pocket:[1,1], rigTall:[1,2], rigWide:[2,2], smallBag:[4,4], mediumBag:[5,5], largeBag:[6,6], drawer:[4,2], toolbox:[3,3],
  supply:[5,4], storage:[6,5], safe:[4,3], stash:[10,20], overflow:[10,1],
} as const;
export const BAG_TYPE='largeBag';
export const BAG_CAPACITY = inventorySizes[BAG_TYPE][0]*inventorySizes[BAG_TYPE][1];
export const STASH_CAPACITY = inventorySizes.stash[0]*inventorySizes.stash[1];

export type AmmoId = '9mm' | '556' | '12g';
export type WeaponId = 'k9' | 'ar56' | 'p12';
export type ArmorId = 'vest' | 'plate';
export type Slot = 'primary' | 'secondary' | 'helmet' | 'headset' | 'armor' | 'rig' | 'backpack';
export type Kind = 'weapon' | 'ammo' | 'armor' | 'helmet' | 'headset' | 'rig' | 'backpack' | 'medical' | 'salvage';

/* 主题分类与潮汐线对齐：kind 管「能不能用」，cat 管「在哪一类里出现」。
   med 类战利品（注射器、X 光片）kind 仍是 salvage，不能回血，只是归类在医疗。
   字段口径也照潮汐线：r 是 1~5 的稀有度，w 是重量（公斤）。 */
export type Cat = 'weapon' | 'ammo' | 'armor' | 'med' | 'elec' | 'ind' | 'mil' | 'intel' | 'life' | 'odd';

type ItemDef = {
  name: string; short?: string; mark: string; kind: Kind; cat: Cat; r: 1|2|3|4|5;
  w: number; price: number; stack: number; description: string;
};

const catalog = {
  helmetLight:{name:'轻型防护盔',mark:'H1',kind:'helmet',cat:'armor',r:2,w:1.25,price:190,stack:1,description:'轻型复合材料，轻微阻碍听觉。'},
  helmetHeavy:{name:'重型防护盔',mark:'H2',kind:'helmet',cat:'armor',r:3,w:2.6,price:390,stack:1,description:'钢制防护盔，抑制较远的声源。'},
  headsetScout:{name:'巡听耳机',mark:'E1',kind:'headset',cat:'armor',r:2,w:0.32,price:150,stack:1,description:'增强脚步并扩大拾音距离。'},
  headsetQuiet:{name:'降噪耳机',mark:'E2',kind:'headset',cat:'armor',r:3,w:0.42,price:230,stack:1,description:'重点压低环境和高音量声音。'},
  rigLight:{name:'简易弹挂',mark:'R1',kind:'rig',cat:'armor',r:1,w:0.75,price:120,stack:1,description:'四个 1×2 独立分区。'},
  rigStandard:{name:'标准弹挂',mark:'R2',kind:'rig',cat:'armor',r:2,w:1.35,price:260,stack:1,description:'四个 1×2 和四个 1×1 分区。'},
  rigUtility:{name:'多用途弹挂',mark:'R3',kind:'rig',cat:'armor',r:3,w:1.75,price:380,stack:1,description:'两个 2×2、四个 1×1 和两个 1×2 分区，可快速取用野战医疗包。'},
  packSmall:{name:'小型背包',mark:'B1',kind:'backpack',cat:'armor',r:1,w:0.6,price:115,stack:1,description:'内部 4×4。'},
  packTactical:{name:'战术背包',mark:'B2',kind:'backpack',cat:'armor',r:2,w:1.15,price:240,stack:1,description:'内部 5×5。'},
  packLegacy:{name:'旧式背包',mark:'B3',kind:'backpack',cat:'armor',r:2,w:1.4,price:280,stack:1,description:'内部 6×6。'},
  /* ---------- 武器 / 弹药 / 护甲 ----------
     型号一律用潮汐线军械库里的真名（M4A1 / Glock 17 / Remington 870），
     文案只说本作的机制，不抄潮汐线的穿透与弹道描述。 */
  k9:      {name:'Glock 17', short:'Glock 17', mark:'G17', kind:'weapon', cat:'weapon', r:1, w:1.1, price:320, stack:1, description:'Glock 17，使用 9×19mm 弹药。轻便的半自动自卫武器。'},
  ar56:    {name:'M4A1', short:'M4A1', mark:'M4', kind:'weapon', cat:'weapon', r:4, w:3.2, price:1150, stack:1, description:'M4A1，使用 5.56×45mm 弹药。全自动步枪，远距离建议短点射。'},
  p12:     {name:'Remington 870', short:'R870', mark:'870', kind:'weapon', cat:'weapon', r:2, w:3.4, price:720, stack:1, description:'Remington 870，使用 12 号鹿弹。泵动供弹，近距离高伤害，逐发装填。'},
  '9mm':   {name:'9×19mm 弹', mark:'9', kind:'ammo', cat:'ammo', r:1, w:0.012, price:3, stack:30, description:'用于 Glock 17。'},
  '556':   {name:'5.56×45mm 弹', mark:'56', kind:'ammo', cat:'ammo', r:1, w:0.013, price:5, stack:30, description:'用于 M4A1。'},
  '12g':   {name:'12 号鹿弹', mark:'12', kind:'ammo', cat:'ammo', r:1, w:0.05, price:8, stack:12, description:'用于 Remington 870。'},
  vest:    {name:'旧芳纶背心', mark:'V1', kind:'armor', cat:'armor', r:2, w:7.5, price:310, stack:1, description:'削减枪伤和近战伤害，防护随受击消耗。'},
  plate:   {name:'陶瓷插板背心', mark:'V2', kind:'armor', cat:'armor', r:4, w:11.8, price:850, stack:1, description:'比芳纶更厚重，能吸收更多伤害。'},

  /* ---------- 医疗 ---------- */
  bandage: {name:'压缩敷料', mark:'+', kind:'medical', cat:'med', r:1, w:0.05, price:65, stack:3, description:'恢复 28 点生命。'},
  medkit:  {name:'制式野战医疗包', mark:'M+', kind:'medical', cat:'med', r:2, w:1.2, price:175, stack:2, description:'M-17 型野战医疗包，采用耐磨帆布与可拆卸内部隔层，适用于高湿度、低照度及缺乏固定医疗设施的环境。\n\n军需部门曾为这一型号提出二十七项改进要求，其中包括：\n\n「所有主要器械必须能够在佩戴手套时取出。」\n\n「包装开启时不得产生过量噪声。」\n\n「医疗标识应当在泥水浸泡后仍保持可辨认。」\n\n最后一项测试因采购部门忘记准备泥水，最终改在军营后方的排水沟内完成。\n\n恢复 60 点生命。'},
  med02:  {name:'注射器', mark:'SY', kind:'salvage', cat:'med', r:2, w:0.15, price:300, stack:2, description:'一支保存于独立包装中的医用注射器。针筒刻度清晰，推杆仍能正常活动。'},
  med03:  {name:'X 光片', mark:'XR', kind:'salvage', cat:'med', r:2, w:0.1, price:340, stack:2, description:'一张装在牛皮纸袋里的医学 X 光胶片。边角微微卷起，透过光线还能辨认出骨骼轮廓。'},

  /* ---------- 转播站电子 ---------- */
  relay:   {name:'氧化继电器', mark:'RL', kind:'salvage', cat:'elec', r:1, w:0.3, price:88, stack:3, description:'送电时还会响一声。维克托收。'},
  elec01:  {name:'收音机', mark:'RD', kind:'salvage', cat:'elec', r:2, w:0.9, price:240, stack:1, description:'调到中波能听见东西。不是电台，是回响。'},
  elec03:  {name:'计算器', mark:'CC', kind:'salvage', cat:'elec', r:2, w:0.2, price:180, stack:2, description:'屏幕上留着最后一次运算的结果：0。'},
  elec02:  {name:'随身听', mark:'WK', kind:'salvage', cat:'elec', r:4, w:0.35, price:980, stack:1, description:'磁带还在里面。按播放键能出声，所以它很值钱——也很有用。'},
  board:   {name:'电路板', mark:'PCB', kind:'salvage', cat:'elec', r:2, w:0.5, price:260, stack:1, description:'实验所的标准件，外面已经没人生产了。'},

  /* ---------- 工业 / 机械 ---------- */
  copper:  {name:'密封铜线卷', mark:'CU', kind:'salvage', cat:'ind', r:1, w:1.6, price:105, stack:2, description:'防潮纸上盖着转播站的旧公章。'},
  ind02:   {name:'轴承', mark:'BR', kind:'salvage', cat:'ind', r:2, w:2.2, price:260, stack:1, description:'转起来还是顺的。手指一推能转很久。'},
  ind03:   {name:'压力表', mark:'PG', kind:'salvage', cat:'ind', r:3, w:1.1, price:480, stack:1, description:'一只工业弹簧管压力表，表盘玻璃已经碎裂，指针停在量程上限。内部测压机构可能曾遭受过载，单凭指针位置已无法判断最后一次实际压力。'},

  /* ---------- 情报 / 文档 ---------- */
  tape:    {name:'监听磁带', mark:'T90', kind:'salvage', cat:'intel', r:2, w:0.12, price:225, stack:1, description:'最后九秒只有空响，倒带以后却多出一段人声。'},
  intel:   {name:'07 号站密封卷宗', mark:'D7', kind:'salvage', cat:'intel', r:3, w:0.4, price:510, stack:1, description:'封锁当夜的值班表有三行被划掉。'},
  life02:  {name:'旧报纸', mark:'NP', kind:'salvage', cat:'intel', r:1, w:0.2, price:70, stack:2, description:'日期停在事故前三天。头版是一场没人关心的听证会。'},
  art03:   {name:'摄影底片', mark:'NG', kind:'salvage', cat:'intel', r:3, w:0.05, price:560, stack:1, description:'对着光看不出什么。需要显影，但你可能舍不得用掉它。'},

  /* ---------- 军用 ---------- */
  mil06:   {name:'军用罗盘', mark:'CP', kind:'salvage', cat:'mil', r:3, w:0.25, price:620, stack:1, description:'采用液体阻尼结构的精密军用罗盘，带有可折叠瞄准镜片和夜光方位刻度。\n\n保护盖内侧固定着一面小镜子，外壳的防滑涂层已经磨损。与普通旅行指南针相比，它更耐碰撞，也更适合长时间野外测绘。'},

  /* ---------- 生活 ---------- */
  life01:  {name:'搪瓷缸', mark:'MG', kind:'salvage', cat:'life', r:1, w:0.4, price:90, stack:1, description:'磕掉了一块瓷，露出底下的铁。里面的水早就干了。'},
  life06:  {name:'铝饭盒', mark:'BX', kind:'salvage', cat:'life', r:1, w:0.35, price:110, stack:1, description:'盖子上敲了一串工号，敲得很深。厂子关了，号还留着。'},
  life03:  {name:'老式台灯', mark:'LP', kind:'salvage', cat:'life', r:2, w:1.6, price:280, stack:1, description:'灯罩烧黑了。插头还在墙上，墙已经不在了。'},
  life08:  {name:'玻璃糖罐', mark:'JR', kind:'salvage', cat:'life', r:2, w:0.9, price:230, stack:1, description:'还剩半罐话梅糖，糖化了又凝住，把罐底和糖粘成一块。摇不动，也倒不出来。'},
  life11:  {name:'双铃闹钟', mark:'AL', kind:'salvage', cat:'life', r:3, w:0.6, price:470, stack:1, description:'分针的传动齿轮缺了一齿，每转到 5:47 就卡住。上紧发条还能走，走到那个位置照样停。修表匠在背面贴了张纸条：齿轮缺一齿，非磁化，非进水。'},
  life33:  {name:'金丝眼镜', mark:'GL', kind:'salvage', cat:'life', r:5, w:0.03, price:2100, stack:1, description:'实金细框，镜腿内侧打着成色戳记，两片镜片都是手工磨边的。左眼的度数比右眼深很多。'},

  /* ---------- 异常 ---------- */
  crystal: {name:'低鸣玻璃', mark:'Δ', kind:'salvage', cat:'odd', r:4, w:0.6, price:1320, stack:1, description:'贴近耳边时，声音来自房间另一侧。'},
  core:    {name:'离线谐振芯', mark:'Ω', kind:'salvage', cat:'odd', r:5, w:1.4, price:1940, stack:1, description:'封铅盒还未开封，内部计数器已在走动。'},
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof catalog;
const footprints:Partial<Record<ItemId,readonly [number,number]>>={
  helmetLight:[2,2],helmetHeavy:[2,2],headsetScout:[2,1],headsetQuiet:[2,1],
  rigLight:[2,2],rigStandard:[3,2],rigUtility:[3,3],packSmall:[2,2],packTactical:[3,2],packLegacy:[3,3],
  k9:[2,2],ar56:[5,2],p12:[6,1],vest:[3,3],plate:[3,3],medkit:[2,2],
  elec01:[2,2],board:[3,1],elec02:[1,2],intel:[2,1],copper:[2,1],ind02:[2,1],
  ind03:[2,1],life03:[1,2],crystal:[1,2],core:[2,2],
};
type GridItemDef=ItemDef & {id:ItemId;width:number;height:number;rotatable:boolean;maxStack:number;weight:number;icon:string};
export const items=Object.fromEntries((Object.keys(catalog) as ItemId[]).map(id=>{
  const item=catalog[id], [width,height]=footprints[id] ?? [1,1];
  return [id,{...item,id,width,height,rotatable:true,maxStack:item.stack,weight:item.w,icon:item.mark}];
})) as Record<ItemId,GridItemDef>;
/* 下标就是 r；第 0 位占位，让 r1 直接落到「普通」 */
export const rarityNames = ['','普通','改良','稀有','珍贵','异常'] as const;
export const catNames: Record<Cat,string> = {
  weapon:'武器', ammo:'弹药', armor:'护甲', med:'医疗', elec:'电子',
  ind:'工业', mil:'军品', intel:'情报', life:'生活', odd:'异常',
};
export const slotNames: Record<Slot, string> = {primary:'主武器', secondary:'副武器', armor:'护甲',helmet:'头盔',headset:'耳机',rig:'弹挂',backpack:'背包'};
export const slots: Slot[] = ['helmet','headset','armor','primary','secondary','rig','backpack'];

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
  {name:'鲁克', call:'军械台', offers:[['helmetLight',1],['helmetHeavy',1],['headsetScout',1],['headsetQuiet',1],['rigLight',1],['rigStandard',1],['rigUtility',1],['packSmall',1],['packTactical',1],['packLegacy',1],['k9',1], ['ar56',1], ['p12',1], ['9mm',15], ['556',15], ['12g',6]]},
  {name:'林岑', call:'医疗与防护', offers:[['vest',1], ['plate',1], ['bandage',1], ['medkit',1], ['med02',1]]},
];

export type LootKind = 'tool' | 'file' | 'supply' | 'medical' | 'sealed' | 'corpse' | 'anomaly' | 'drop';
/* 容器等级的中文名，交互提示里直接写出来，玩家一眼知道这是哪一档 */
export const lootNames:Record<LootKind,string> = {
  tool:'工具', file:'档案', supply:'补给', medical:'医疗', sealed:'密封', corpse:'遗物', anomaly:'异常', drop:'遗落',
};
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

export const helmets={helmetLight:{protection:.30,durability:35,level:1,material:"composite",hearing:.95},helmetHeavy:{protection:.52,durability:62,level:2,material:"steel",hearing:.78}} as const;
export const headsets={headsetScout:{range:1.28,steps:1.35,ambient:.82,loud:.84},headsetQuiet:{range:1.10,steps:1.12,ambient:.58,loud:.58}} as const;
export const storageTypes={
  rigLight:['rigTall','rigTall','rigTall','rigTall'],
  rigStandard:['rigTall','rigTall','rigTall','rigTall','pocket','pocket','pocket','pocket'],
  rigUtility:['rigTall','rigTall','pocket','pocket','pocket','pocket','rigWide','rigWide'],
  packSmall:['smallBag'],packTactical:['mediumBag'],packLegacy:['largeBag'],
} as const;
