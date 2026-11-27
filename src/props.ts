import type * as T from 'three';

/* 收集品的程序化建模。只用方盒、八边柱、圆锥与八面体这四种基元，
   和场景里其余资产同一套材质（flatShading + 高粗糙度），所以图标截图
   和游戏内的方块画风是一套东西，不会出现「图标很精致、实物很方块」。 */

export type PropShape = 'box' | 'barrel' | 'wedge' | 'shard' | 'plane' | 'cone';
export type PropBuild = (shape:PropShape, color:number, x:number, y:number, z:number,
  w:number, h:number, d:number, rx?:number, ry?:number, rz?:number) => void;

const C = {
  steel: 0x76837b, darkSteel: 0x4a5751, iron: 0x3a4540, black: 0x262f2b,
  rubber: 0x333d38, chrome: 0x9aa39c, brass: 0xb79756, copper: 0x9c6f42,
  wood: 0x7d6a4e, paper: 0xcfc7ab, kraft: 0xa2874f, news: 0xbeb69b,
  glass: 0x8fb2a6, plastic: 0x5f6d60, red: 0x9d4c45, cream: 0xc9c5a8,
  enamel: 0xd6d3bd, odd: 0x7fc9b4, gold: 0xc8a85e, amber: 0xb98a3e,
};
const PI = Math.PI;

/* 绕 Y 轴把 N 段方盒摆成圆环：用于轴承、镜框、刻度这类「有孔」的形状，
   比用实心圆柱更像真的，也避免透明材质。
   方盒的 Z 轴当作切向、X 轴当作径向厚度，这样 boxes 才首尾相接成环。 */
function ring(add:PropBuild, color:number, cx:number, cy:number, cz:number,
  radius:number, thickness:number, height:number, segments:number, phase=0) {
  const length = 2*PI*radius/segments*1.14;
  for (let i=0;i<segments;i++) {
    const a = phase+i/segments*PI*2;
    add('box',color,cx+Math.cos(a)*radius,cy,cz+Math.sin(a)*radius,thickness,height,length,0,-a,0);
  }
}

/* 贴地的细长杆，沿两点之间摆放：天线、镜腿、耳机线这类。 */
function strut(add:PropBuild, color:number, x0:number,y0:number,z0:number, x1:number,y1:number,z1:number, thick:number) {
  const dx=x1-x0, dy=y1-y0, dz=z1-z0;
  const length=Math.hypot(dx,dy,dz) || .001;
  const yaw=Math.atan2(dx,dz), pitch=Math.acos(dy/length);
  add('barrel',color,(x0+x1)/2,(y0+y1)/2,(z0+z1)/2,thick,length,thick,pitch,yaw,0);
}

function syringe(add:PropBuild) {
  const z=-.06;
  add('barrel',C.glass,.012,.012,z+.052,.020,.105,.020,PI/2,0,0);      // 筒身
  add('barrel',C.chrome,.012,.012,z+.005,.014,.055,.014,PI/2,0,0);     // 推杆
  add('barrel',C.plastic,.012,.012,z-.030,.030,.008,.030,PI/2,0,0);    // 指托
  add('barrel',C.steel,.012,.012,z+.104,.017,.014,.017,PI/2,0,0);      // 针座
  add('barrel',C.chrome,.012,.012,z+.127,.0028,.032,.0028,PI/2,0,0);   // 针管
  add('box',C.cream,.012,.012,z+.070,.016,.0015,.030);                 // 刻度标签
}

function xray(add:PropBuild) {
  add('box',0x2f3a3a,0,.003,0,.30,.004,.40,0,0,.02);
  add('box',0x26302f,0,.006,-.02,.27,.002,.35,0,0,.02);
  /* 胶片的骨骼轮廓：两根长骨加一段关节，比纯色板好认 */
  for (const side of [-1,1]) {
    add('box',0x8fa9a4,side*.055,.008,.02,.030,.0015,.20,0,0,.015);
    add('shard',0x9ab4ae,side*.055,.010,-.10,.048,.012,.048);
    add('shard',0x8fa9a4,side*.055,.010,.15,.040,.010,.040);
  }
  add('box',0x8fa9a4,0,.009,-.02,.09,.0012,.05);
  add('box',C.kraft,-.13,.004,.16,.05,.003,.055,0,0,.1);  // 牛皮纸袋角
}

function relay(add:PropBuild) {
  /* 壳体做成矮框，让线圈和衔铁露出来——继电器最有辨识度的就是那圈铜线 */
  for (const sx of [-1,1]) for (const sz of [-1,1]) {
    add('box',0x6f8c86,sx*.021,.026,sz*.016,.006,.036,.006);
  }
  add('box',0x7b9791,0,.045,0,.050,.006,.038);            // 顶板
  add('barrel',C.copper,0,.026,0,.030,.032,.030);         // 内部线圈
  add('barrel',0xa97e4e,0,.026,0,.032,.030,.032);
  add('box',C.chrome,0,.040,.016,.024,.006,.008);         // 衔铁
  add('box',C.brass,0,.048,-.010,.016,.004,.014);
  for (const sx of [-1,1]) for (const sz of [-1,1]) {
    add('box',C.steel,sx*.014,.004,sz*.010,.0035,.020,.0035); // 引脚
    add('box',C.chrome,sx*.014,.001,sz*.010,.005,.002,.005);
  }
}

function radio(add:PropBuild) {
  add('box',0x5b5245,0,.048,0,.26,.092,.150);              // 机身
  add('box',0x6a6152,0,.094,0,.255,.010,.145);             // 顶面拼缝
  add('box',0x8f8a72,0,.048,-.077,.104,.070,.004);         // 喇叭网
  for (let i=0;i<5;i++) add('box',0x4b4639,0,.020+i*.014,-.080,.096,.004,.004);
  add('box',0xc2b98c,-.072,.062,-.079,.086,.026,.004);     // 调频窗
  add('box',0x3d3a31,-.072,.062,-.081,.062,.004,.004);     // 指针
  for (const x of [.082,.112]) {
    add('barrel',C.rubber,x,.046,-.072,.020,.012,.020,PI/2,0,0); // 旋钮
    add('box',C.brass,x,.046,-.079,.004,.010,.003);
  }
  strut(add,C.chrome,.098,.092,.052,.150,.300,.078,.005);  // 天线
  add('box',C.darkSteel,.070,.100,-.02,.020,.012,.070);    // 提手
}

function calculator(add:PropBuild) {
  add('box',0x8f8f7c,0,.011,0,.140,.022,.190);             // 机身
  add('box',0xa5a58e,0,.0232,0,.134,.003,.184);
  add('box',0x222e2a,0,.0255,-.056,.114,.002,.062);        // 屏幕
  add('box',0x53705d,0,.0262,-.054,.104,.001,.050);        // 屏幕底光
  add('box',0x8fb79c,-.030,.0268,-.054,.032,.001,.014);    // 屏幕上的 0
  for (let row=0;row<3;row++) for (let col=0;col<3;col++) {
    add('box',0x424c40,-.044+col*.030,.0255,-.006+row*.030,.024,.004,.022);
  }
  add('box',0xb0805a,.042,.0255,.054,.022,.004,.060);      // 橙色运算键
  add('box',0x424c40,-.044,.0255,.054,.024,.004,.022);
}

function walkman(add:PropBuild) {
  add('box',0x6f746c,0,.017,0,.112,.034,.082);             // 机身
  add('box',0x81877d,0,.035,0,.106,.004,.076);
  add('box',0x232d29,0,.037,-.006,.080,.002,.034);         // 磁带窗
  for (const x of [-.023,.023]) {
    add('barrel',0xcfc9ad,x,.0385,-.006,.015,.003,.015);
    add('barrel',0x6a6553,x,.0385,-.006,.006,.003,.006);
  }
  add('box',0xd2cbb2,-.022,.0375,.032,.058,.002,.016);     // 标签
  add('box',0x9c9682,-.022,.0385,.032,.044,.001,.004);
  for (let i=0;i<4;i++) {
    add('box',0xd6d2c2,.040,.038,.024-i*.011,.005,.004,.008); // 按键
  }
  add('barrel',C.steel,-.040,.020,.042,.014,.006,.014,0,0,0); // 耳机孔
  strut(add,C.black,-.040,.020,.048,-.118,.004,.086,.0028);   // 耳机线
  add('shard',C.black,-.122,.004,.090,.012,.012,.012);
}

function circuitBoard(add:PropBuild) {
  add('box',0x3f5a45,0,.004,0,.150,.008,.105);
  add('box',0x475f4a,0,.0085,0,.142,.001,.097);
  for (const [x,z,w,d] of [[-.030,-.020,.040,.028],[.036,.012,.024,.030],[-.005,.031,.034,.016]]) {
    add('box',0x2a332e,x,.012,z,w,.007,d);                 // 芯片
    for (let i=-1;i<=1;i++) add('box',C.chrome,x+i*w*.28,.009,z+d/2+.003,.004,.003,.004);
  }
  for (const x of [.050,-.052]) add('barrel',0x6e7a6a,x,.013,-.032,.014,.014,.014,0,0,0);
  for (let i=0;i<7;i++) add('box',C.brass,-.048+i*.016,.004,-.052,.011,.003,.024);
  add('box',0x7a5a3a,-.070,.010,.034,.010,.012,.020);      // 插座
}

function copperCoil(add:PropBuild) {
  const cy=.100, cz=.050;
  /* 两片木挡板：8 边柱侧躺、轴沿 Z，内侧面在 z=.010 / .090 */
  add('barrel',C.wood,0,cy,0,.200,.020,.200,PI/2,0,0);
  add('barrel',C.wood,0,cy,.100,.200,.020,.200,PI/2,0,0);
  /* 轴毂只从两侧挡板各露一点；原先那根 .180 长轴会穿过纸带捅出来 */
  for (const z of [-.016,.116]) add('barrel',C.darkSteel,0,cy,z,.034,.012,.034,PI/2,0,0);
  /* 铜线卷本体与一圈圈绕线，长度收在两片挡板之间 */
  add('barrel',C.copper,0,cy,cz,.150,.080,.150,PI/2,0,0);
  for (let i=-3;i<=3;i++) add('barrel',0xa97e4e,0,cy,cz+i*.011,.152,.004,.152,PI/2,0,0);
  /* 防潮纸：沿线圈外缘包一圈纸带，8 段薄板拼成八边形环。
     顶上一段是水平面，正好盖章；原先那张平铺的纸会从挡板中间穿过去，
     看起来像「一张文件和一个线轴插在一起」。 */
  /* 纸带比线卷窄一截：轻俯视下挡板会挡住中间的线卷，两侧多露一点绕线才读得出是「铜线卷」 */
  const radius=.080, thickness=.005, width=.034;
  const length=2*PI*radius/8*1.12;
  for (let i=0;i<8;i++) {
    const a=PI/2+i*PI/4;
    add('box',C.paper,Math.cos(a)*radius,cy+Math.sin(a)*radius,cz,
      thickness,length,width,0,0,a);
  }
  add('box',C.red,-.020,cy+radius+.0035,cz,.026,.002,.026); // 旧公章，落在顶板水平面上
}

function bearing(add:PropBuild) {
  ring(add,C.steel,0,.014,0,.082,.022,.028,12);
  ring(add,0x5c6a62,0,.014,0,.060,.018,.030,12);
  ring(add,C.chrome,0,.014,0,.036,.016,.027,10);
  for (let i=0;i<8;i++) {
    const a=i/8*PI*2;
    add('shard',0x9fada5,Math.cos(a)*.049,.014,Math.sin(a)*.049,.020,.020,.020);
  }
}

function gauge(add:PropBuild) {
  add('barrel',C.steel,0,.020,0,.124,.038,.124);           // 表壳
  add('barrel',C.darkSteel,0,.040,0,.120,.006,.120);       // 表圈
  add('barrel',C.cream,0,.043,0,.106,.006,.106);           // 表盘（高出表圈才看得见）
  for (let i=0;i<12;i++) {
    const a=i/12*PI*2;
    add('box',0x4a544c,Math.cos(a)*.044,.0465,Math.sin(a)*.044,.011,.001,.003,0,-a,0);
  }
  add('box',C.red,.016,.0472,.012,.0035,.0012,.046,0,-.42,0);  // 指针（停在满量程）
  add('barrel',0x2d3833,0,.0472,0,.010,.003,.010);
  add('barrel',C.steel,0,.010,-.070,.034,.030,.034);       // 接头
  for (let i=0;i<3;i++) add('barrel',C.darkSteel,0,.010-i*.008,-.070,.036,.004,.036);
  add('shard',0x9fb5ae,.030,.044,-.026,.030,.006,.026,0,.4,.2);  // 碎玻璃
  add('shard',0x9fb5ae,-.020,.044,.030,.024,.005,.022,0,.9,-.3);
}

function cassetteTape(add:PropBuild) {
  add('box',0x2f3733,0,.007,0,.100,.014,.064);
  add('box',0x3b443e,0,.0145,0,.096,.002,.060);
  for (const x of [-.022,.022]) {
    add('barrel',C.cream,x,.0155,0,.024,.002,.024);
    add('barrel',0x6f6a55,x,.0155,0,.011,.002,.011);
  }
  add('box',0xb9b19a,0,.0155,-.024,.070,.0012,.012);       // 手写标签
  add('box',0x8e8a72,0,.0155,.024,.056,.0012,.006);
  for (const z of [-.020,.020]) add('box',0x1f2723,0,.001,z,.078,.004,.010);
}

function dossier(add:PropBuild) {
  add('box',C.kraft,0,.012,.010,.226,.014,.300,0,.05,0);   // 封套
  add('box',0xb69a63,0,.020,.010,.218,.004,.290,0,.05,0);
  add('box',0xd9d3b8,-.004,.023,.004,.206,.004,.276,0,.05,0); // 纸张
  for (let i=0;i<5;i++) add('box',0xb3ab90,0,.0255,-.100+i*.052,.180,.0012,.003,0,.05,0);
  add('box',C.red,0,.028,-.070,.220,.0015,.030,0,.05,0);   // 封条
  add('box',C.red,0,.028,.096,.220,.0015,.030,0,.05,0);
  add('box',0x8d3f3a,.070,.029,-.070,.034,.001,.020,0,.05,0); // 印章
  add('box',C.darkSteel,-.070,.016,.140,.014,.010,.060,0,.05,0); // 别针
}

function newspaper(add:PropBuild) {
  for (let i=0;i<3;i++) {
    add('box',i===2?0xb0a88e:C.news,-.006+i*.004,.004+i*.004,.010-i*.004,.290,.004,.380,0,.06+i*.07,0);
  }
  add('box',0x5f5b4c,0,.016,-.118,.242,.002,.056,0,.13,0);    // 头版标题块
  add('box',0x7d7663,0,.017,-.118,.190,.001,.014,0,.13,0);
  for (let i=0;i<4;i++) add('box',0x9a927a,0,.016,-.048+i*.048,.250,.001,.004,0,.13,0);
  add('box',0x8f8770,0,.016,.070,.256,.001,.004,0,.13,0);
  add('box',0x938b74,.120,.018,.120,.070,.002,.120,0,.2,0);   // 翘起的报角
  add('box',0x7c7560,-.080,.017,.020,.090,.001,.150,0,.13,0); // 版面照片块
}

function filmStrip(add:PropBuild) {
  add('box',0x4a3c33,0,.002,-.010,.038,.002,.160,0,.06,0);
  add('box',0x3b2f28,0,.004,-.010,.032,.0015,.150,0,.06,0);
  for (let i=0;i<9;i++) {
    const z=-.078+i*.017;
    add('box',0x1e2422,-.014,.005,z,.006,.0015,.010,0,.06,0); // 齿孔
    add('box',0x1e2422,.014,.005,z,.006,.0015,.010,0,.06,0);
  }
  add('box',0x6b5a3f,0,.006,.078,.040,.002,.070,0,.9,0);     // 卷起的一端
  add('box',C.paper,0,.0075,.070,.034,.001,.040,0,.62,0);
}

function compass(add:PropBuild) {
  add('barrel',0x4e5a52,0,.010,0,.086,.020,.086);           // 壳体
  add('barrel',C.cream,0,.019,0,.072,.006,.072);            // 表盘
  ring(add,0x3f4a43,0,.021,0,.033,.003,.002,8);             // 刻度环
  for (let i=0;i<8;i++) {
    const a=i/8*PI*2;
    add('box',0x3a453e,Math.cos(a)*.031,.0225,Math.sin(a)*.031,.008,.001,.002);
  }
  add('box',C.red,0,.023,-.014,.005,.001,.028,0,0,0);        // 指北
  add('box',0xd8d6c0,0,.023,.014,.005,.001,.028);
  add('barrel',C.brass,0,.023,0,.008,.004,.008);
  add('barrel',0x4e5a52,-.052,.030,.060,.086,.006,.086,-1.15,.4,0); // 翻盖
  add('barrel',C.chrome,-.052,.036,.060,.070,.002,.070,-1.15,.4,0); // 盖内镜片
  add('box',0x3a453e,.048,.024,-.030,.014,.006,.030);       // 铰链
}

function enamelMug(add:PropBuild) {
  add('barrel',C.enamel,0,.055,0,.086,.110,.086);
  add('barrel',0x5d665c,0,.062,0,.074,.100,.074);           // 内壁
  add('barrel',0xa9a794,0,.110,0,.090,.010,.090);           // 口沿
  add('box',0x4a544c,.043,.040,.014,.014,.024,.016);        // 磕掉的瓷
  add('box',C.iron,.043,.052,.014,.010,.014,.012);
  /* C 形把手：三段方盒 */
  add('box',C.enamel,.056,.086,-.022,.014,.024,.012);
  add('box',C.enamel,.062,.060,-.022,.012,.044,.012);
  add('box',C.enamel,.056,.032,-.022,.014,.024,.012);
  add('box',C.enamel,.050,.078,-.022,.014,.012,.012);
}

function lunchBox(add:PropBuild) {
  add('box',0x8d968c,0,.030,0,.190,.060,.128);              // 盒身
  add('box',0x99a298,0,.058,0,.184,.008,.122);
  add('box',0xaab2a8,0,.066,0,.198,.014,.136);              // 盖
  add('box',0xb6beb3,0,.0735,0,.184,.004,.122);
  add('box',0x76817a,0,.034,-.066,.172,.005,.004);          // 冲压线
  add('box',0x76817a,0,.046,-.066,.172,.004,.003);
  for (const x of [-.062,.062]) {
    add('box',0x6d7872,x,.052,-.070,.014,.056,.012);        // 侧扣
    add('box',0xb0b8ad,x,.070,-.070,.016,.010,.014);
    add('box',0x5c6761,x,.030,-.072,.016,.016,.010);
  }
  /* 提手：两根立柱 + 一根横梁 */
  for (const x of [-.070,.070]) add('box',0x6d7872,x,.106,-.010,.010,.060,.010);
  add('box',0x7d887f,0,.138,-.010,.152,.012,.012);
}

function deskLamp(add:PropBuild) {
  add('barrel',0x44524a,0,.011,0,.150,.022,.150);           // 底座
  add('barrel',0x55645a,0,.026,0,.072,.012,.072);
  add('barrel',C.brass,0,.135,0,.016,.215,.016);            // 立杆
  add('barrel',C.brass,0,.240,0,.022,.022,.022);
  strut(add,C.brass,0,.240,0,0,.292,-.082,.011);            // 斜臂
  add('shard',C.brass,0,.292,-.082,.026,.026,.026);         // 关节
  /* cone 默认上小下大：不转时开口朝下，绕 X 转正角度把罩口转向 -Z（前方） */
  add('cone',0x9a9678,0,.300,-.104,.150,.140,.150,.62,0,0); // 灯罩（米色搪瓷）
  add('barrel',0x4a544c,0,.268,-.076,.126,.014,.126,.62,0,0); // 罩口内壁
  add('barrel',0x7e7a5f,0,.352,-.128,.042,.018,.042,.62,0,0);
  add('barrel',C.cream,0,.272,-.092,.082,.028,.082,.62,0,0); // 灯泡
  add('box',0x2f3b34,0,.244,.030,.024,.010,.024);           // 开关
  add('box',0x2f3b34,0,.040,-.020,.020,.006,.060);          // 电源线
}

function sugarJar(add:PropBuild) {
  add('barrel',C.glass,0,.062,0,.100,.124,.100);            // 罐体
  add('barrel',0x7a9c92,0,.058,0,.088,.108,.088);           // 内部
  const candy:readonly [number,number,number,number][] = [
    [-.022,.032,.014,.034],[.018,.030,-.018,.030],[.004,.062,.024,.028],[-.014,.058,-.026,.026],[.026,.058,.006,.024],
  ];
  for (const [x,y,z,s] of candy) add('shard',C.amber,x,y,z,s,s*.72,s,0,.4,.2); // 粘成一团的话梅糖
  add('barrel',0x51695e,0,.130,0,.108,.016,.108);           // 盖
  add('shard',0x51695e,0,.146,0,.030,.020,.030);
  add('box',C.paper,.049,.070,.012,.004,.048,.040);         // 标签
  add('box',C.red,.049,.070,.012,.002,.020,.024);
}

function alarmClock(add:PropBuild) {
  add('barrel',0x47544b,0,.026,0,.104,.052,.104);           // 钟体
  add('barrel',C.cream,0,.052,0,.088,.006,.088);            // 表盘
  for (let i=0;i<12;i++) {
    const a=i/12*PI*2;
    add('box',0x3f4a43,Math.cos(a)*.038,.0555,Math.sin(a)*.038,.008,.001,.0026,0,-a,0);
  }
  add('box',C.iron,0,.057,.010,.0035,.0012,.026,0,-.5,0);
  add('box',C.red,.011,.058,.004,.003,.0012,.032,0,-1.1,0);
  add('barrel',C.brass,0,.059,0,.008,.005,.008);
  for (const side of [-1,1]) {
    add('barrel',C.brass,side*.052,.058,-.010,.038,.016,.038,0,0,side*.5); // 铃（横放圆盘）
    add('barrel',0xa98a4a,side*.052,.048,-.010,.042,.008,.042,0,0,side*.5);
    add('barrel',0x3f4a43,side*.040,.062,-.010,.014,.012,.014,0,0,side*.5); // 铃座
    add('box',0x3f4a43,side*.038,.008,.022,.010,.016,.010,0,0,side*.4);     // 支脚
  }
  strut(add,C.iron,0,.070,-.014,0,.086,-.014,.004);          // 铃锤
  add('shard',C.iron,0,.090,-.014,.014,.014,.014);
  add('box',0x39443d,0,.012,-.040,.020,.014,.012);           // 发条
}

function eyeglasses(add:PropBuild) {
  for (const side of [-1,1]) {
    ring(add,C.gold,side*.042,.020,0,.026,.0035,.006,8);     // 镜框
    add('barrel',0x9fb8b0,side*.042,.0195,0,.046,.002,.046); // 镜片
    strut(add,C.gold,side*.066,.022,-.004,side*.085,.020,-.078,.0035); // 镜腿
    strut(add,C.gold,side*.085,.020,-.078,side*.082,.012,-.130,.0032);
    add('box',C.gold,side*.066,.022,-.002,.010,.005,.005);
  }
  strut(add,C.gold,-.016,.023,-.004,.016,.023,-.004,.0032); // 鼻梁
  add('box',C.gold,0,.024,-.004,.006,.004,.006);
  add('box',0x2f3a34,0,.014,.020,.062,.006,.036);            // 镜布
}

function lowHumGlass(add:PropBuild) {
  add('shard',C.odd,0,.048,0,.090,.096,.086,0,.4,.16);
  add('shard',0x6fb2a2,.034,.030,-.020,.052,.062,.050,.3,.7,-.2);
  add('shard',0x95dcc6,-.030,.036,.016,.046,.070,.044,-.2,.2,.3);
  add('shard',0x5c9a8c,0,.012,.024,.036,.026,.032,.2,.9,0);
  for (let i=0;i<4;i++) {
    const a=i/4*PI*2+.4;
    add('shard',0x4c7a70,Math.cos(a)*.048,.008,Math.sin(a)*.048,.020,.012,.018,0,a,0);
  }
}

function resonanceCore(add:PropBuild) {
  add('box',0x59635c,0,.062,0,.170,.124,.170);              // 铅盒
  add('box',0x646e66,0,.126,0,.184,.016,.184);              // 盖
  add('box',0x4c564f,0,.135,0,.152,.008,.152);
  for (const sx of [-1,1]) for (const sz of [-1,1]) {
    add('barrel',C.chrome,sx*.074,.127,sz*.074,.017,.010,.017);
  }
  /* 正面开窗，里面放谐振芯：这是整件东西唯一要看的细节 */
  add('box',0x24302b,0,.068,-.083,.092,.070,.010);
  add('box',0x3c4a44,0,.068,-.086,.104,.082,.004);
  add('shard',C.odd,0,.066,-.078,.062,.058,.036,0,.5,.1);
  add('shard',0x9fe0ca,-.012,.074,-.072,.034,.030,.022,0,.2,-.2);
  add('box',0x6b786f,0,.068,-.090,.012,.072,.006);          // 窗框竖条
  add('box',0x6b786f,0,.068,-.090,.104,.012,.006);
  /* 封条横在盒盖顶上，不要做在正面——横竖两条叠起来会读成医疗十字 */
  add('box',C.red,0,.145,0,.020,.006,.176);                 // 铅封封条
  add('box',0x8d3f3a,.062,.145,.062,.016,.008,.016);       // 铅封扣
  /* 顶部提手 */
  for (const x of [-.056,.056]) add('box',C.iron,x,.150,0,.014,.048,.014);
  add('box',C.iron,0,.176,0,.126,.012,.012);
}


/* 弹药：平放一排，28° 轻俯视能同时看到弹壳与弹头。
   三口径靠长度和弹壳颜色区分，不看文字也能认。 */
function cartridge(add:PropBuild, x:number, z:number, length:number, dia:number, caseColor:number, tip:number) {
  /* 弹壳占后 70%，弹头是前端一小段锥体：锥体太长会把弹壳整个盖住，看着像一排球 */
  add('barrel',caseColor,x,dia/2,z+length*.18,dia,length*.64,dia,PI/2,0,0);   // 弹壳
  add('barrel',0xc9a566,x,dia/2,z+length*.47,dia*1.06,length*.10,dia*1.06,PI/2,0,0); // 底缘
  add('barrel',0xb98a54,x,dia/2,z+length*.02,dia*1.04,length*.06,dia*1.04,PI/2,0,0); // 收口
  add('cone',tip,x,dia/2,z-length*.26,dia*.92,length*.30,dia*.92,-PI/2,0,0);   // 弹头
}

function ammo9(add:PropBuild) {
  for (let i=0;i<4;i++) cartridge(add,-.024+i*.016,0,.030,.010,0x9c6a3c,0x8f8574);
}
function ammo556(add:PropBuild) {
  for (let i=0;i<4;i++) cartridge(add,-.026+i*.017,0,.057,.0095,0x9c6a3c,0x8f8574);
}
function ammo12(add:PropBuild) {
  for (let i=0;i<3;i++) cartridge(add,-.022+i*.022,0,.068,.016,0x9a4a40,0x7d7461);
}

/* 护甲：平铺的背心与插板背心，靠厚度与插板轮廓区分 */
function vest(add:PropBuild) {
  /* 平铺的前后片 + 两条竖直肩带，俯视就能看出「背心」的轮廓 */
  add('box',0x6c7568,0,.012,0,.215,.024,.290);            // 躯干片
  add('box',0x76806f,0,.026,0,.202,.004,.276);
  add('box',0x424b41,0,.028,-.112,.086,.004,.056);        // 领口
  add('box',0x545e53,0,.030,.052,.150,.004,.120);         // 内衬补丁
  add('box',0x5a6459,0,.030,.052,.120,.004,.090);
  for (const side of [-1,1]) {
    add('box',0x5f6a5e,side*.068,.026,-.156,.050,.010,.098); // 肩带
    add('box',0x4e584d,side*.105,.016,.040,.040,.018,.150);  // 侧带
    add('box',C.chrome,side*.105,.026,.000,.024,.004,.026);  // 扣
    add('box',0x3f4841,side*.105,.026,.078,.028,.004,.030);
  }
  add('box',0x3f4841,0,.028,-.020,.140,.003,.010);        // 中缝
}

function plateCarrier(add:PropBuild) {
  add('box',0x50594f,0,.022,0,.250,.044,.320);            // 主体（更厚）
  add('box',0x5c665b,0,.048,0,.236,.010,.304);
  add('box',0x6b7568,0,.056,-.040,.170,.010,.180);        // 陶瓷插板
  add('box',0x7b8578,0,.062,-.040,.150,.006,.158);
  for (const side of [-1,1]) {
    add('box',0x3f4841,side*.090,.058,-.130,.040,.014,.070,0,0,side*.3); // 肩垫
    add('box',0x3f4841,side*.108,.030,.040,.034,.030,.150);              // 侧围
    add('box',C.chrome,side*.108,.046,-.010,.022,.006,.030);
  }
  add('box',0x2b332d,0,.056,.126,.150,.006,.040);         // 魔术贴条
}

/* ---------- 装备类：头盔 / 耳机 / 弹挂 / 背包 ----------
   和角色身上那套方块部件同色系，28° 轻俯视能一眼分辨类型与等级。
   这里只用于物品图标渲染，不参与游戏内 3D 场景。 */
function helmet(add:PropBuild,heavy:boolean) {
  const shell=heavy ? 0x46534c : 0x6b775d;
  const top=heavy ? 0x536158 : 0x7d8a6c;
  const trim=heavy ? 0x2f3a35 : 0x424d3e;
  add('barrel',trim,0,.048,0,.268,.052,.268);          // 帽檐
  add('barrel',shell,0,.080,0,.244,.068,.244);         // 盔体下圈
  add('barrel',top,0,.124,0,.202,.058,.202);           // 盔体中圈
  add('barrel',shell,0,.158,0,.140,.034,.140);         // 盔顶
  add('barrel',trim,0,.178,0,.072,.010,.072);          // 顶盖
  add('box',trim,0,.095,-.126,.158,.022,.014);         // 前沿加强
  for (const side of [-1,1]) {
    add('box',trim,side*.122,.058,.010,.026,.076,.126); // 护耳
    add('box',0x2e3831,side*.128,.034,.048,.010,.034,.056); // 束带
    if (heavy) {
      add('box',0x7c8a80,side*.108,.104,-.072,.014,.014,.086); // 钢侧棱
      add('barrel',C.chrome,side*.122,.150,.010,.014,.008,.014);
    }
  }
  if (heavy) add('box',0x78867d,0,.176,-.020,.020,.010,.170); // 顶部脊梁
  else add('box',C.brass,0,.108,-.124,.030,.008,.008);        // 前徽
}

function headset(add:PropBuild,quiet:boolean) {
  const frame=quiet ? 0x39433e : 0x4f5a4a;
  const cup=quiet ? 0x2f3833 : 0x5d6855;
  /* 头梁：7 段方盒沿上半圆拼出拱形 */
  for (let i=0;i<7;i++) {
    const a=Math.PI*(i+.5)/7;
    add('box',frame,Math.cos(a)*.112,.078+Math.sin(a)*.100,0,.038,.020,.030,0,0,a+PI/2);
  }
  for (const side of [-1,1]) {
    add('box',frame,side*.116,.058,0,.026,.062,.030);        // 滑杆
    add('box',cup,side*.132,.020,0,.056,.098,.096);          // 耳罩
    add('box',0x202824,side*.160,.020,0,.014,.076,.078);     // 海绵垫
    add('box',C.chrome,side*.116,.086,0,.034,.010,.034);     // 铰接
    if (quiet) add('box',C.brass,side*.170,.020,-.026,.008,.026,.026);
  }
  add('box',0x2c352f,0,.176,0,.070,.016,.030);               // 头顶软垫
}

function rig(add:PropBuild,level:1|2|3) {
  const cloth=level===1 ? 0x6d7256 : level===2 ? 0x5f6a54 : 0x4e5b4b;
  const pouch=level===1 ? 0x808264 : level===2 ? 0x717958 : 0x636d56;
  const w=level===1 ? .250 : level===2 ? .290 : .320;
  add('box',cloth,0,.022,0,w,.044,.176);                    // 主板
  add('box',0x404a3c,0,.046,-.074,w*.92,.008,.030);         // 上沿
  if (level>=2) add('box',0x3c463a,0,.046,.076,w*.92,.008,.024);
  const cols=level===1 ? 4 : level===2 ? 4 : 3;
  const gap=w/(cols+1);
  for (let i=0;i<cols;i++) {
    const x=-w/2+gap*(i+1);
    add('box',pouch,x,.048,-.012,gap*.74,.036,.086);         // 弹匣袋
    add('box',0x39433a,x,.068,-.012,gap*.74,.008,.086);      // 袋盖
    add('box',C.brass,x,.073,-.012,gap*.18,.004,.012);
  }
  if (level===2) for (const side of [-1,1])
    add('box',0x5a6450,side*(w*.36),.048,.062,.046,.030,.044); // 小杂物袋
  if (level===3) {
    for (const side of [-1,1]) {
      add('box',0x59644f,side*(w*.33),.050,.064,.082,.038,.058); // 2×2 大袋
      add('box',0x3c463a,side*(w*.33),.070,.064,.082,.008,.058);
    }
    add('box',0x2f3a32,0,.048,.116,w*.40,.030,.020);          // 医疗包贴条
  }
  for (const side of [-1,1]) {
    add('box',0x3c463a,side*(w*.48),.030,-.070,.014,.060,.100); // 肩带连接
  }
}

function pack(add:PropBuild,size:'small'|'tactical'|'legacy') {
  const w=size==='small' ? .190 : size==='tactical' ? .230 : .252;
  const h=size==='small' ? .210 : size==='tactical' ? .250 : .272;
  const d=size==='small' ? .110 : size==='tactical' ? .130 : .140;
  const cloth=size==='tactical' ? 0x4c635a : size==='legacy' ? 0x827453 : 0x7b7756;
  const flap=size==='tactical' ? 0x405650 : size==='legacy' ? 0x6f6247 : 0x6a6849;
  add('box',cloth,0,h/2,0,w,h,d);                            // 主袋
  add('box',flap,0,h*.86,-d*.10,w*.94,h*.24,d*.28);          // 顶盖
  add('box',0x333c34,0,h*.60,-d*.52,w*.56,h*.28,d*.06);      // 前袋
  add('box',0x2b332d,0,h*.74,-d*.56,w*.56,.008,d*.04);
  for (const side of [-1,1]) {
    add('box',flap,side*(w*.34),h*.98,-d*.14,w*.20,h*.12,d*.30); // 侧耳
    add('box',C.chrome,side*(w*.28),h*.72,-d*.56,.018,.014,.012); // 卡扣
    add('box',0x3c443a,side*(w*.30),h*.50,d*.56,.030,h*.66,.018); // 背带
  }
  add('box',flap,0,h*1.02,0,w*.34,h*.06,d*.34);              // 顶提手
  if (size==='legacy') add('box',C.brass,w*.30,h*.36,-d*.52,.016,.060,.014); // 旧式铜扣
  if (size==='tactical') add('box',0x2f4a43,0,h*.40,-d*.54,w*.70,.020,.012); // 织带
}

function bandage(add:PropBuild) {
  add('barrel',0xd3cdb4,0,.020,0,.086,.040,.086);         // 敷料卷
  add('barrel',0xb9b198,0,.040,0,.070,.006,.070);
  add('box',0xe2ddc8,.020,.024,.036,.030,.026,.044,0,.5,0); // 展开的一段纱布
  add('box',0x8f3f3a,-.014,.042,.014,.038,.004,.038);      // 红色标识
  add('box',0xb9b198,-.014,.044,.014,.014,.002,.014);
  add('box',0xb9b198,-.014,.044,.014,.002,.014,.002);
}

function medkit(add:PropBuild) {
  add('box',0x7c7a5e,0,.052,0,.220,.104,.150);            // 帆布包
  add('box',0x8a8868,0,.106,0,.214,.010,.144);
  add('box',0x6b6a50,0,.052,-.076,.200,.090,.008);        // 前袋
  add('box',0x6b6a50,0,.062,-.082,.150,.012,.006);
  add('box',0xd8d4bc,-.052,.062,-.083,.070,.070,.004);    // 白底红十字
  add('box',0xa8443f,-.052,.062,-.086,.048,.020,.004);    // 十字横
  add('box',0xa8443f,-.052,.062,-.086,.018,.048,.004);    // 十字竖
  for (const x of [-.070,.070]) add('box',0x5e5c46,x,.132,-.010,.016,.048,.016); // 提手立柱
  add('box',0x5e5c46,0,.156,-.010,.152,.012,.012);
  add('box',C.brass,.098,.056,.040,.012,.016,.040);       // 侧扣
}

const props:Record<string, (add:PropBuild) => void> = {
  '9mm':ammo9, '556':ammo556, '12g':ammo12, vest, plate:plateCarrier, bandage, medkit,
  helmetLight:add=>helmet(add,false), helmetHeavy:add=>helmet(add,true),
  headsetScout:add=>headset(add,false), headsetQuiet:add=>headset(add,true),
  rigLight:add=>rig(add,1), rigStandard:add=>rig(add,2), rigUtility:add=>rig(add,3),
  packSmall:add=>pack(add,'small'), packTactical:add=>pack(add,'tactical'), packLegacy:add=>pack(add,'legacy'),
  med02:syringe, med03:xray, relay, elec01:radio, elec03:calculator, elec02:walkman,
  board:circuitBoard, copper:copperCoil, ind02:bearing, ind03:gauge, tape:cassetteTape,
  intel:dossier, life02:newspaper, art03:filmStrip, mil06:compass, life01:enamelMug,
  life06:lunchBox, life03:deskLamp, life08:sugarJar, life11:alarmClock, life33:eyeglasses,
  crystal:lowHumGlass, core:resonanceCore,
};

export function hasProp(id:string) {
  return Object.hasOwn(props,id);
}

export function buildProp(add:PropBuild, id:string) {
  const build=props[id];
  if (!build) throw new Error(`No prop model for ${id}`);
  build(add);
}

/* 图标渲染要按物品高度做一点点差异：平铺的文件类不该占满整张图，
   给相机一个「视觉尺寸」，让 40cm 的 X 光片和 6cm 的继电器在图标里比例接近。 */
export const propScale:Record<string,number> = {
  med03:1.6, life02:1.7, intel:1.45, life03:1.25, elec01:1.3, copper:1.15,
  core:1.1, life06:1.15, life11:1.1, board:1.25, ind03:1.1,
};
