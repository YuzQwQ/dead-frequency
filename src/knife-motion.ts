import type { Group } from 'three';
import { meleeAttacks } from './melee.ts';
import type { MeleeMotion } from './melee.ts';

type Pose=readonly [x:number,y:number,z:number,rx:number,ry:number,rz:number];
type Frame=readonly [at:number,pose:Pose];
const rest:Pose=[.32,-.335,-.60,.46,.58,.36];
const light=(side:-1|1):Frame[]=>[
  [0,rest],
  [.22,[.30+side*.32,-.25,-.50,.36,-side*.92,side*.56]],
  [meleeAttacks.light.windup/.30,[.15,-.225,-.77,.16,side*.25,side*.76]],
  [.57,[.21-side*.50,-.35,-.68,.05,side*1.32,side*.90]],
  [1,rest],
];
const heavy:Frame[]=[
  [0,rest],
  [.30,[.43,-.265,-.41,.24,-.57,-.64]],
  [.38,[.39,-.230,-.34,.19,-.42,-.48]],
  [meleeAttacks.heavy.windup/.92,[.045,-.18,-1.04,.19,-.02,-.30]],
  [.52,[.052,-.185,-.99,.18,.01,-.30]],
  [.74,[.18,-.33,-.72,.18,.18,.10]],
  [1,rest],
];
const slashes={[-1]:light(-1),1:light(1)};

export function setKnifePose(mount:Group,attack:Readonly<MeleeMotion>|null,step:number,pace:number,sprint:number) {
  if (!attack) {
    mount.position.set(rest[0]+Math.sin(step)*pace*.017+sprint*.08,rest[1]+Math.cos(step*2)*pace*.017-sprint*.12,rest[2]);
    mount.rotation.set(rest[3]-sprint*.34,rest[4]-sprint*.25,rest[5]+sprint*.47);
    return;
  }
  const {windup,recovery}=meleeAttacks[attack.kind];
  const t=Math.min(1,attack.elapsed/(windup+recovery));
  const frames=attack.kind==='light' ? slashes[attack.side] : heavy;
  let i=1;
  while (i<frames.length-1 && frames[i][0]<t) i++;
  const [a,from]=frames[i-1], [b,to]=frames[i];
  const u=(t-a)/(b-a), blend=u*u*(3-2*u);
  const value=(axis:0|1|2|3|4|5)=>from[axis]+(to[axis]-from[axis])*blend;
  mount.position.set(value(0),value(1),value(2));
  mount.rotation.set(value(3),value(4),value(5));
}
