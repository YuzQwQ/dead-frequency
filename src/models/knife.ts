import type { ModelPart, ModelRecipe, XY, XYZ } from '../model-parts.ts';

const trace=(points:readonly XY[]):XY[] => points.map(([u,v])=>[(725-u)*.00122,(283-v)*.00124]);
const profile=(name:string,material:string,points:readonly XY[],depth:number,bevel=0,x=0):ModelPart =>
  ({kind:'profile',name,material,outline:trace(points),depth,bevel,at:[x,0,0]});
const box=(name:string,material:string,at:XYZ,size:XYZ,rotation?:XYZ):ModelPart =>
  ({kind:'box',name,material,at,size,rotation});

export const knifeRecipe:ModelRecipe={
  materials:{
    steel:0x788382, spine:0x939e9c, edge:0xb3b9b5, recess:0x495655,
    navy:0x273a4c, shell:0x3c5367, lining:0x1d2d39, orange:0xb77b4d,
    glove:0x6a6952, palm:0x535645, sleeve:0x414d43, cuff:0x546052,
  },
  parts:[
    profile('blade','steel',[[158,286],[285,235],[505,233],[543,247],[543,322],[517,337],[286,337],[205,308]],.025,.003),
    profile('upper-facet','spine',[[159,286],[285,235],[505,233],[532,246],[516,281],[261,281]],.033,.001),
    profile('lower-facet','edge',[[159,286],[290,325],[516,325],[516,337],[286,337],[205,308]],.028,.001),
    ...[-1,1].map(side=>profile(`blade-inset-${side}`,'recess',
      [[303,255],[322,246],[472,244],[453,255]],.004,0,side*.018)),
    profile('guard','steel',[[513,199],[529,194],[536,236],[552,242],[552,328],[537,335],[542,375],[525,375],[517,334]],.091,.004),
    profile('handle','lining',[[535,240],[735,235],[854,240],[893,228],[925,240],[946,273],[945,293],
      [921,328],[891,339],[854,328],[733,329],[687,313],[656,310],[620,319],[605,332],[544,332],[521,286]],.085,.006),
    ...[-1,1].flatMap(side=>[
      profile(`handle-panel-${side}`,'navy',[[541,247],[736,243],[852,249],[892,235],[921,246],[939,271],[935,295],
        [916,319],[893,330],[854,318],[738,319],[691,304],[658,301],[617,311],[601,323],[548,323],[529,286]],.018,.004,side*.045),
      profile(`tail-mark-${side}`,'orange',[[894,238],[920,248],[936,273],[934,288],[916,316],[895,323],
        [900,305],[915,298],[924,280],[913,264],[897,258]],.005,.001,side*.056),
      {kind:'barrel' as const,name:`handle-pin-${side}`,material:'spine',
        at:[side*.058,0,-.191] as XYZ,size:[.042,.010,.042] as XYZ,rotation:[0,0,Math.PI/2] as XYZ},
      box(`spine-mark-edge-${side}`,'orange',[side*.054,.044,-.153],[.010,.021,.030]),
    ]),
    box('spine-mark','orange',[0,.062,-.163],[.105,.011,.030]),
    {kind:'group',name:'right-hand',view:'first-person',parts:[
      box('palm','palm',[.038,-.043,.005],[.113,.144,.159],[.14,-.2,.13]),
      box('knuckles','glove',[-.043,-.005,-.002],[.048,.106,.145],[.10,-.13,.08]),
      box('thumb','glove',[-.019,.055,-.110],[.071,.061,.104],[.24,0,-.26]),
      box('wrist','cuff',[.064,-.114,.109],[.124,.122,.131],[-.36,-.14,-.22]),
      box('forearm','sleeve',[.105,-.201,.229],[.159,.154,.227],[-.44,-.18,-.27]),
    ]},
  ],
};
