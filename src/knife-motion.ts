import type { Group } from 'three';
import { meleeAttacks } from './melee.ts';
import type { MeleeMotion } from './melee.ts';

type Pose=readonly [x:number,y:number,z:number,pitch:number,yaw:number,roll:number];
type Frame=readonly [seconds:number,pose:Pose];
const rest:Pose=[0,0,0,0,0,0];
const lightHit=meleeAttacks.light.windup;
const heavyHit=meleeAttacks.heavy.windup;
const light=(side:-1|1):Frame[]=>[
  [0,rest],
  [.042,[side*.094,.022,.035,-.14,-side*.38,side*.23]],
  [lightHit,[-side*.115,.072,-.20,.13,side*.62,-side*.20]],
  [.154,[-side*.235,.014,-.105,.07,side*.88,-side*.38]],
  [.23,[-side*.066,-.028,-.031,.02,side*.29,-side*.10]],
  [lightHit+meleeAttacks.light.recovery,rest],
];
const slashes={[-1]:light(-1),1:light(1)};
const heavy:Frame[]=[
  [0,rest],
  [.25,[.071,-.026,.105,-.17,-.49,.26]],
  [.342,[.102,.012,.14,-.15,-.98,.29]],
  [heavyHit,[-.19,.068,-.34,.06,-1.85,.19]],
  [.50,[-.18,.044,-.29,.07,-1.72,.17]],
  [.68,[-.059,-.033,-.073,.14,-.62,.07]],
  [heavyHit+meleeAttacks.heavy.recovery,rest],
];

export function setKnifeAttack(arm:Group,wrist:Group,support:Group,attack:Readonly<MeleeMotion>|null) {
  if (!attack) {
    arm.position.set(0,0,0);
    arm.rotation.set(0,0,0);
    wrist.rotation.set(0,0,0);
    support.position.set(0,0,0);
    return;
  }
  const thrust=attack.kind==='heavy';
  const frames=thrust ? heavy : slashes[attack.side];
  const {windup,recovery}=meleeAttacks[attack.kind];
  const elapsed=Math.min(attack.elapsed,windup+recovery);
  let i=1;
  while (i<frames.length-1 && frames[i][0]<elapsed) i++;
  const [a,from]=frames[i-1], [b,to]=frames[i];
  const t=(elapsed-a)/(b-a), ease=t*t*(3-2*t);
  const lerp=(axis:0|1|2|3|4|5)=>from[axis]+(to[axis]-from[axis])*ease;
  arm.position.set(lerp(0),lerp(1),lerp(2));
  const yaw=lerp(4);
  const wristTurn=thrust ? yaw*.43 : 0;
  arm.rotation.set(lerp(3),yaw-wristTurn,lerp(5));
  wrist.rotation.y=wristTurn;
  const balance=Math.sin(Math.PI*elapsed/(windup+recovery))**2;
  support.position.set(-balance*(thrust ? .068 : .035),-balance*(thrust ? .045 : .026),balance*(thrust ? .077 : .036));
}
