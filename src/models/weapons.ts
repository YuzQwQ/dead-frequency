import type { WeaponId } from '../data.ts';
import type { ModelPart, ModelRecipe, XY, XYZ } from '../model-parts.ts';

export type WeaponRecipe = ModelRecipe & {
  concept:string;
  muzzle:XYZ;
  sightHeight:number;
  viewDepth?:number;
  motion?:{part:string; travel:XYZ};
};

// Trace the reference sheet's outline in visual units.
const forward=(u:number)=>(u-425)*.00172;
const up=(v:number)=>(361-v)*.00207;
const trace=(points:readonly XY[], origin=425):XY[] =>
  points.map(([u,v])=>[(u-origin)*.00172,up(v)]);
const box=(name:string,material:string,at:XYZ,size:XYZ,rotation?:XYZ):ModelPart =>
  ({kind:'box',name,material,at,size,rotation});
const tube=(name:string,material:string,a:number,b:number,v:number,width:number):ModelPart =>
  ({kind:'barrel',name,material,at:[0,up(v),-(forward(a)+forward(b))/2],
    size:[width,forward(b)-forward(a),width],rotation:[Math.PI/2,0,0]});

const p12 = {
  concept:'art/p12-reference.svg',
  materials:{
    iron:0x3b4244, rail:0x555b59, charcoal:0x282e2f, inset:0x1c2222,
    walnut:0x745035, woodEdge:0x91663e, woodShade:0x523b2c,
    cuff:0x46534a, glove:0x69664e, palm:0x4e4d3d,
  },
  muzzle:[0,up(326),-forward(1255)-.047],
  sightHeight:.137,
  viewDepth:.29,
  motion:{part:'pump',travel:[0,0,.069]},
  parts:[
    {kind:'profile',name:'stock',material:'walnut',depth:.134,bevel:.012,view:'external',
      outline:trace([[437,355],[601,343],[625,351],[659,352],[719,329],[736,334],[736,360],
        [668,366],[604,378],[442,432]])},
    {kind:'profile',name:'heel',material:'charcoal',depth:.141,bevel:.006,view:'external',
      outline:trace([[416,351],[434,351],[441,435],[423,440]])},
    {kind:'profile',name:'comb',material:'woodEdge',depth:.111,bevel:.005,view:'external',
      outline:trace([[436,354],[600,342],[625,351],[660,352],[719,328],[727,331],
        [663,359],[625,358],[603,350],[437,363]])},
    {kind:'profile',name:'stock-neck',material:'walnut',depth:.121,bevel:.008,view:'first-person',
      outline:trace([[587,380],[610,360],[642,353],[661,352],[720,330],[736,334],[736,360],
        [669,366],[631,372],[603,388]])},
    {kind:'profile',name:'grip',material:'walnut',depth:.104,bevel:.009,
      outline:trace([[657,368],[695,366],[675,428],[636,420],[650,382]])},
    {kind:'profile',name:'grip-heel',material:'woodShade',depth:.105,bevel:.004,
      outline:trace([[637,415],[677,423],[675,429],[635,421]])},
    {kind:'profile',name:'receiver',material:'iron',depth:.179,bevel:.010,
      outline:trace([[727,323],[752,311],[891,311],[910,322],[910,360],[896,370],[729,370]])},
    {kind:'profile',name:'receiver-top',material:'rail',depth:.145,bevel:.006,
      outline:trace([[731,322],[752,310],[891,310],[905,319],[899,325],[732,331]])},
    {kind:'profile',name:'right-recess',material:'inset',depth:.011,bevel:.002,at:[.093,0,0],
      outline:trace([[838,319],[896,319],[896,347],[838,347]])},
    {kind:'profile',name:'right-inset-face',material:'charcoal',depth:.007,at:[.100,0,0],
      outline:trace([[846,327],[895,327],[895,342],[846,342]])},
    {kind:'profile',name:'left-panel',material:'charcoal',depth:.009,bevel:.002,at:[-.092,0,0],
      outline:trace([[826,335],[900,333],[899,342],[826,344]])},
    ...[-1,1].map(side=>box(`receiver-pin-${side}`,'charcoal',
      [side*.094,up(352),-forward(748)],[.008,.009,.010])),
    {kind:'profile',name:'guard-rear',material:'charcoal',depth:.070,bevel:.003,
      outline:trace([[751,366],[760,366],[759,386],[770,396],[764,400],[750,389]])},
    {kind:'profile',name:'guard-loop',material:'charcoal',depth:.070,bevel:.003,
      outline:trace([[764,395],[802,395],[810,386],[810,365],[817,365],[817,390],[805,401],[764,401]])},
    {kind:'profile',name:'guard-insert',material:'charcoal',depth:.030,bevel:.002,
      outline:trace([[770,368],[777,368],[777,380],[785,389],[782,392],[773,385],[770,380]])},
    tube('forward-tube','iron',894,1245,326,.064),
    tube('muzzle-band','iron',1239,1254,326,.062),
    tube('muzzle-shadow','inset',1253,1256,326,.044),
    tube('lower-tube','charcoal',895,1251,362,.055),
    {kind:'profile',name:'fore-collar',material:'charcoal',depth:.152,bevel:.004,
      outline:trace([[907,314],[920,314],[920,374],[907,374]])},
    box('top-rib','charcoal',[0,up(307),-forward(847)],[.105,.015,.212]),
    ...[-1,1].map(side=>box(`rear-notch-${side}`,'charcoal',
      [side*.036,up(299),-forward(786)],[.019,.018,.031])),
    box('sight-marker','charcoal',[0,up(304.5),-forward(1221)],[.023,.042,.032]),
    {kind:'group',name:'pump',at:[0,0,-forward(1073)],parts:[
      {kind:'profile',name:'pump-wood',material:'walnut',depth:.151,bevel:.010,
        outline:trace([[977,353],[987,349],[1161,349],[1171,356],[1171,376],[1162,383],[984,383],[977,376]],1073)},
      {kind:'profile',name:'pump-comb',material:'woodEdge',depth:.142,bevel:.003,
        outline:trace([[984,350],[993,347],[1160,347],[1169,352],[1164,357],[984,358]],1073)},
      {kind:'profile',name:'pump-band',material:'woodShade',depth:.153,bevel:.007,
        outline:trace([[1147,351],[1156,351],[1156,381],[1147,381]],1073)},
      {kind:'group',name:'support-hand',view:'first-person',parts:[
        box('support-palm','palm',[-.067,-.107,.007],[.143,.085,.158],[.09,0,.17]),
        box('support-knuckles','glove',[-.106,-.066,-.023],[.047,.098,.126],[.12,0,.13]),
        box('support-thumb','glove',[-.106,-.015,.066],[.053,.061,.076],[-.29,0,-.15]),
        box('support-cuff','cuff',[-.113,-.209,.168],[.135,.133,.165],[-.57,-.12,-.09]),
        box('support-sleeve','cuff',[-.146,-.281,.28],[.152,.159,.248],[-.59,-.18,-.1]),
      ]},
    ]},
    {kind:'group',name:'firing-hand',view:'first-person',parts:[
      box('grip-palm','glove',[.046,-.102,-forward(662)],[.100,.113,.112],[-.29,0,-.15]),
      box('grip-knuckles','palm',[-.047,-.066,-forward(672)],[.060,.089,.077],[-.25,-.08,.10]),
      box('grip-cuff','cuff',[.073,-.189,-forward(641)],[.132,.118,.154],[-.39,.02,-.20]),
      box('grip-sleeve','cuff',[.105,-.293,-forward(606)],[.168,.190,.251],[-.41,.05,-.22]),
    ]},
  ],
} satisfies WeaponRecipe;

export const weaponRecipes:Partial<Record<WeaponId,WeaponRecipe>> = {p12};
