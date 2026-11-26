import type { EnemyKind, LootKind } from './data.ts';

export type Surface = 'concrete' | 'steel' | 'wood' | 'glass';
export type Point = {x:number; z:number};
export type Solid = Point & {w:number; d:number; h:number; y:number; surface:Surface; tone?:number};
export type Building = {
  name:string; sign:string; x:number; z:number; w:number; d:number; h:number;
  doors:Partial<Record<'n'|'s'|'e'|'w',number[][]>>; tint:number; light:number;
  windows?:Partial<Record<'n'|'s'|'e'|'w',number[][]>>;
};
export type ContainerSite = Point & {name:string; kind:Exclude<LootKind,'drop'>; h:number};
export type Exit = Point & {id:string; name:string; radius:number};
export type EnemySite = Point & {kind:EnemyKind; heading:number};

export const bounds = 40;
export const starts = [{x:-4,z:34,heading:0},{x:9,z:34,heading:0}];
export const exits:Exit[] = [
  {id:'A',name:'北侧水闸',x:-28,z:-35,radius:2.8},
  {id:'B',name:'东侧公路',x:35,z:-3,radius:2.8},
];
export const buildings:Building[] = [
  {name:'维修车间',sign:'01  SERVICE',x:-21,z:16,w:19,d:15,h:4.8,
    doors:{s:[[-21,4]],e:[[16,3]],n:[[-25,3]]},windows:{s:[[-27,2.2],[-15,2.2]]},tint:0x899288,light:0xf5ba70},
  {name:'临时医疗站',sign:'02  MEDICAL',x:23,z:21,w:14,d:12,h:3.7,
    doors:{w:[[22,3]],s:[[24,3]],n:[[20,2.6]]},windows:{s:[[19,2.1],[27.7,1.65]]},tint:0x98aaa0,light:0xc8e3c8},
  {name:'货运仓库',sign:'03  FREIGHT',x:-24,z:-13,w:19,d:20,h:6.4,
    doors:{s:[[-22,5]],e:[[-13,3.8]],n:[[-28,4]]},windows:{s:[[-29,2.8]]},tint:0x87968a,light:0xd2a05b},
  {name:'安保与调度',sign:'04  DISPATCH',x:21,z:-12,w:18,d:16,h:4.1,
    doors:{s:[[20,3.6]],e:[[-12,3]],w:[[-14,3]],n:[[25,3.2]]},windows:{s:[[15.4,2.5],[26.2,2.5]]},tint:0x919884,light:0xe4b677},
  {name:'信号研究室',sign:'05  SIGNAL LAB',x:1,z:-27,w:20,d:14,h:4.6,
    doors:{s:[[2,3.3]],w:[[-27,3]],e:[[-26,3]],n:[[4,3]]},windows:{s:[[-5,3],[7.2,2.1]]},tint:0x8ba19b,light:0x78c4b6},
];
export const obstacles:Solid[] = [
  {x:-10,z:30,w:3.3,d:.65,h:1,y:0,surface:'concrete'},
  {x:3,z:27,w:3.5,d:.6,h:.96,y:0,surface:'concrete'},
  {x:12,z:16,w:.65,d:4.1,h:1,y:0,surface:'concrete'},
  {x:-7,z:10,w:2.6,d:4.7,h:2.5,y:0,surface:'steel',tone:0x7e5240},
  {x:-6,z:1,w:2.6,d:4.7,h:2.5,y:0,surface:'steel',tone:0x5e7772},
  {x:7,z:4,w:2.6,d:4.7,h:2.5,y:0,surface:'steel',tone:0x8b5946},
  {x:0,z:-6,w:5.2,d:.7,h:1.1,y:0,surface:'concrete'},
  {x:5,z:-14,w:3.6,d:2.3,h:1.35,y:0,surface:'steel',tone:0x627267},
  {x:-12,z:-30,w:2.2,d:3.3,h:1.4,y:0,surface:'wood'},
  {x:23,z:1,w:5.8,d:.65,h:1,y:0,surface:'concrete'},
  {x:32,z:8,w:2.6,d:4.6,h:1.8,y:0,surface:'steel',tone:0x748271},
  {x:-29,z:15,w:2.1,d:7.7,h:1.75,y:0,surface:'steel',tone:0x66746a},
  {x:-19,z:13,w:3.5,d:1.5,h:1.02,y:0,surface:'wood'},
  {x:-23,z:19,w:3,d:1.6,h:1.1,y:0,surface:'steel',tone:0x8a6b44},
  {x:25,z:23.5,w:3.2,d:1.05,h:.85,y:0,surface:'steel',tone:0x9aa790},
  {x:27.5,z:18,w:1,d:3,h:1.3,y:0,surface:'wood'},
  {x:-30,z:-13,w:3.1,d:9.2,h:3.2,y:0,surface:'wood'},
  {x:-21,z:-16,w:2.7,d:5.5,h:2.05,y:0,surface:'steel',tone:0x79754b},
  {x:-17,z:-8,w:2.3,d:2.6,h:1.4,y:0,surface:'wood'},
  {x:17,z:-7,w:4.4,d:.85,h:1.04,y:0,surface:'wood'},
  {x:24,z:-16,w:3.4,d:1.3,h:1.5,y:0,surface:'steel',tone:0x6c7568},
  {x:-3,z:-28,w:2.7,d:5.2,h:1.2,y:0,surface:'steel',tone:0x759184},
  {x:7.5,z:-29,w:2.3,d:3.2,h:1.8,y:0,surface:'steel',tone:0x6a7771},
  {x:0,z:-37,w:3.2,d:2.8,h:2,y:0,surface:'concrete'},
  {x:33,z:-9,w:2,d:2,h:1.1,y:0,surface:'concrete'},
];

// Coordinates refer to the lowest step. Positive direction runs toward north.
export const stairs = [{x:-30.7,z:-.52,width:2.55,tread:.46,rise:.17,steps:4}];

export const containerSites:ContainerSite[] = [
  {name:'路边工具箱',kind:'tool',x:-4,z:30.5,h:.7},
  {name:'报废检修箱',kind:'tool',x:-25,z:20.5,h:.84},
  {name:'维修部储物柜',kind:'file',x:-25.8,z:11,h:1.28},
  {name:'诊疗急救箱',kind:'medical',x:18.8,z:24,h:.7},
  {name:'医疗站药柜',kind:'medical',x:23.5,z:17,h:1.26},
  {name:'散落货箱',kind:'tool',x:11,z:8,h:.75},
  {name:'露天军用箱',kind:'supply',x:-3.2,z:4.5,h:.86},
  {name:'货运补给箱',kind:'supply',x:-27,z:-6.7,h:.88},
  {name:'仓库调度柜',kind:'file',x:-23,z:-20.5,h:1.24},
  {name:'北侧检修箱',kind:'tool',x:-23,z:-30.2,h:.75},
  {name:'安保军需箱',kind:'supply',x:27.2,z:-8.1,h:.87},
  {name:'调度档案柜',kind:'file',x:16,z:-17,h:1.3},
  {name:'密封档案柜',kind:'sealed',x:-6.4,z:-31.5,h:1.33},
  {name:'谐振样本保险箱',kind:'sealed',x:5.5,z:-32,h:1.05},
  {name:'被遗弃的帆布箱',kind:'medical',x:34,z:-19,h:.68},
];

export const enemySites:EnemySite[] = [
  {kind:'scav',x:-24,z:-10,heading:0},
  {kind:'scav',x:18,z:-11,heading:Math.PI},
  {kind:'scav',x:9,z:-7,heading:1.4},
  {kind:'scav',x:27,z:-25,heading:-1.4},
  {kind:'echo',x:0,z:-28,heading:0},
  {kind:'echo',x:-12,z:-17,heading:2.5},
  {kind:'echo',x:9,z:13,heading:3.1},
  {kind:'echo',x:29,z:-29,heading:.5},
  {kind:'echo',x:-28,z:-25,heading:1.4},
];

export function sectorSolids() {
  const solids = obstacles.slice();
  const add = (x:number,z:number,w:number,d:number,h:number,y=0,surface:Surface='concrete',tone?:number) =>
    solids.push({x,z,w,d,h,y,surface,tone});
  for (const stair of stairs) {
    for (let i=0;i<stair.steps;i++) {
      add(stair.x,stair.z-i*stair.tread,stair.width,stair.tread,(i+1)*stair.rise,0,'concrete',0x8a9382);
    }
    add(stair.x,stair.z-stair.steps*stair.tread-.28,stair.width,stair.tread+.56,stair.steps*stair.rise,0,'concrete',0x8a9382);
  }
  const wall = (center:number, fixed:number, length:number, horizontal:boolean, height:number, openings:number[][], windows:number[][], tint:number) => {
    let cursor = center - length/2;
    const segment = (a:number,b:number,h:number,y=0) => {
      if (b-a < .02) return;
      const mid = (a+b)/2;
      add(horizontal ? mid : fixed,horizontal ? fixed : mid,horizontal ? b-a : .32,horizontal ? .32 : b-a,h,y,'concrete',tint);
    };
    const cuts=[...openings.map(([p,w]) => ({p,w,window:false})),...windows.map(([p,w]) => ({p,w,window:true}))];
    for (const {p:position,w:width,window} of cuts.sort((a,b) => a.p-b.p)) {
      const left = position-width/2, right = position+width/2;
      segment(cursor,left,height);
      if (window) {
        segment(left,right,1.24);
        segment(left,right,height-2.39,2.39);
        add(horizontal?position:fixed,horizontal?fixed:position,horizontal?width:.10,horizontal?.10:width,1.15,1.24,'glass');
      } else segment(left,right,height-2.85,2.85);
      cursor = right;
    }
    segment(cursor,center+length/2,height);
  };
  for (const b of buildings) {
    wall(b.x,b.z-b.d/2,b.w,true,b.h,b.doors.n ?? [],b.windows?.n ?? [],b.tint);
    wall(b.x,b.z+b.d/2,b.w,true,b.h,b.doors.s ?? [],b.windows?.s ?? [],b.tint);
    wall(b.z,b.x-b.w/2,b.d,false,b.h,b.doors.w ?? [],b.windows?.w ?? [],b.tint);
    wall(b.z,b.x+b.w/2,b.d,false,b.h,b.doors.e ?? [],b.windows?.e ?? [],b.tint);
    add(b.x,b.z,b.w+.55,b.d+.55,.29,b.h,'steel',0x424f49);
  }
  for (const sign of [-1,1]) {
    add(0,sign*bounds,bounds*2+.4,.5,3.45);
    add(sign*bounds,0,.5,bounds*2,3.45);
  }
  for (const c of containerSites) add(c.x,c.z,c.h>1 ? .78 : 1.13,.58,c.h,0,'steel');
  return solids;
}

export function areaAt(x:number,z:number) {
  const building = buildingAt(x,z);
  if (building) return building.name;
  if (z>27) return '南侧接入路';
  if (z<-32) return '北侧水闸';
  if (x>30) return '东侧公路';
  return '站区堆场';
}

export function buildingAt(x:number,z:number) {
  return buildings.find(b => Math.abs(x-b.x)<b.w/2 && Math.abs(z-b.z)<b.d/2);
}
