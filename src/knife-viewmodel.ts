import * as T from 'three';
import preset from './models/knife-viewmodel.json' with { type:'json' };
import { setKnifeAttack } from './knife-motion.ts';
import type { MeleeMotion } from './melee.ts';

type Vector=[number,number,number];
type Transform={position:Vector;rotation:Vector};
export const jointControls=[
  ['armRoot','手臂根部',-25,25],['wrist','手腕',-25,25],['palm','掌心',-20,20],
  ['fingerBase','四指第一节',-30,35],['fingerMiddle','四指第二节',-30,40],['fingerTip','四指第三节',-30,35],
  ['thumb','拇指关节',-25,30],
] as const;
type JointName=typeof jointControls[number][0];
export type ViewModelConfig={
  fov:number;
  scale:number;
  root:Transform;
  rightArm:Transform;
  wrist:Transform;
  itemSocket:Transform;
  joints:Record<JointName,number>;
  animation:{paused:boolean;breathing:number;sway:number};
};

const wristAnchor:Vector=[.042,-.048,.05];
const palmAnchor=new T.Vector3(.014,-.024,.006);
const elbow=new T.Vector3(.187,-.151,.256);
function defaults():ViewModelConfig {
  const {version:_,asset:__,...config}=structuredClone(preset);
  return config as ViewModelConfig;
}

function group(name:string,parent?:T.Group) {
  const node=new T.Group();
  node.name=name;
  parent?.add(node);
  return node;
}

function transform(node:T.Group,pose:Transform) {
  node.position.set(...pose.position);
  const [x,y,z]=pose.rotation;
  node.rotation.set(T.MathUtils.degToRad(x),T.MathUtils.degToRad(y),T.MathUtils.degToRad(z));
}

export class KnifeViewModel {
  readonly root=group('ViewModelRoot');
  private motion=group('MotionLayer',this.root);
  private rightArm=group('RightArmRoot',this.motion);
  private attackLayer=group('KnifeAttack',this.rightArm);
  private supportLayer=group('SupportAttack',this.motion);
  private armHinge=group('ArmRootHinge',this.attackLayer);
  private rightModel=group('RightArmScale',this.armHinge);
  private forearm=group('Forearm',this.rightModel);
  private wrist=group('WristPivot',this.forearm);
  private wristAttack=group('WristAttack',this.wrist);
  private wristHinge=group('WristHinge',this.wristAttack);
  private palm=group('PalmPivot',this.wristHinge);
  private hand=group('RightHand',this.palm);
  private socket=group('ItemSocket',this.hand);
  private joints=new Map<JointName,{node:T.Group;axis:T.Vector3;guide:T.Line}>();
  private guideShape=new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,-.10),new T.Vector3(0,0,.10)]);
  private guideMaterial=new T.LineBasicMaterial({color:0xefbc79,depthTest:false,depthWrite:false});
  config=defaults();
  simulateWalk=false;
  private clock=0;
  private lastTime=0;
  private left?:T.Object3D;

  constructor(model:T.Group) {
    const right=model.getObjectByName('right-hand');
    const sleeve=right?.getObjectByName('sleeve');
    this.left=model.getObjectByName('left-hand');
    if (this.left) this.supportLayer.add(this.left);
    this.forearm.position.copy(elbow);
    this.palm.position.copy(palmAnchor).sub(new T.Vector3(...wristAnchor));
    this.hinge('armRoot',this.armHinge,[0,0,1]);
    this.hinge('wrist',this.wristHinge,[1,0,0]);
    this.hinge('palm',this.palm,[0,0,1]);
    if (right && sleeve) {
      right.updateMatrix();
      sleeve.applyMatrix4(right.matrix);
      this.forearm.add(sleeve);
      sleeve.position.sub(elbow);
    }
    if (right) {
      this.hand.add(right);
      right.position.sub(palmAnchor);
      const base=new T.Vector3(-.004,-.003,-.035);
      const middle=new T.Vector3(-.034,.017,-.078);
      const tip=new T.Vector3(-.061,.019,-.106);
      const thumbBase=new T.Vector3(-.025,-.034,.006);
      const knuckleAxis:Vector=[1,0,-.38];
      const first=this.segment(right,'fingers-base','fingerBase',right,base,undefined,knuckleAxis);
      const second=this.segment(right,'fingers-middle','fingerMiddle',first,middle,base,knuckleAxis);
      this.segment(right,'fingers-tip','fingerTip',second,tip,middle,knuckleAxis);
      this.segment(right,'thumb','thumb',right,thumbBase,undefined,[.63,0,-.78]);
    }
    this.socket.add(model);
    this.root.visible=false;
    this.apply();
  }

  private hinge(key:JointName,node:T.Group,axis:Vector) {
    const direction=new T.Vector3(...axis).normalize();
    const guide=new T.Line(this.guideShape,this.guideMaterial);
    guide.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),direction);
    guide.renderOrder=10;
    guide.visible=false;
    node.add(guide);
    this.joints.set(key,{node,axis:direction,guide});
  }

  private segment(model:T.Object3D,name:string,key:JointName,parent:T.Object3D,
    pivot:T.Vector3,parentPivot:T.Vector3|undefined,axis:Vector) {
    const mesh=model.getObjectByName(name);
    const joint=group(name+'-pivot');
    parent.add(joint);
    joint.position.copy(pivot);
    if (parentPivot) joint.position.sub(parentPivot);
    if (mesh) {
      joint.add(mesh);
      mesh.position.sub(pivot);
    }
    this.hinge(key,joint,axis);
    return joint;
  }

  showJointAxes(show:boolean) {
    this.joints.forEach(({guide})=>{guide.visible=show;});
  }

  dispose() {
    this.guideShape.dispose();
    this.guideMaterial.dispose();
  }

  apply() {
    const {root,rightArm,wrist,itemSocket,scale}=this.config;
    transform(this.root,root);
    transform(this.rightArm,rightArm);
    transform(this.wrist,wrist);
    transform(this.socket,itemSocket);
    this.joints.forEach(({node,axis},key)=>node.quaternion.setFromAxisAngle(axis,T.MathUtils.degToRad(this.config.joints[key])));
    this.rightModel.scale.setScalar(scale);
    this.left?.scale.setScalar(scale);
  }

  reset() {
    this.config=defaults();
    this.simulateWalk=false;
    this.clearMotion();
    this.apply();
  }

  freezeRest() {
    this.config.animation.paused=true;
    this.clearMotion();
  }

  private clearMotion() {
    this.clock=0;
    this.motion.position.set(0,0,0);
    this.motion.rotation.set(0,0,0);
    setKnifeAttack(this.attackLayer,this.wristAttack,this.supportLayer,null);
  }

  update(now:number,step:number,pace:number,attack:Readonly<MeleeMotion>|null=null) {
    const dt=this.lastTime ? Math.min(.05,Math.max(0,now-this.lastTime)) : 0;
    this.lastTime=now;
    const {paused,breathing,sway}=this.config.animation;
    if (paused) return;
    setKnifeAttack(this.attackLayer,this.wristAttack,this.supportLayer,attack);
    this.clock+=dt;
    const ease=1-Math.exp(-12*dt);
    const breath=(1-Math.cos(this.clock*1.7))*.5*breathing;
    const phase=this.simulateWalk ? this.clock*7 : step;
    const walking=sway*(this.simulateWalk ? .72 : pace);
    const stride=Math.sin(phase)*walking;
    const lift=(1-Math.cos(phase*2))*.5*walking;
    this.motion.position.x=T.MathUtils.lerp(this.motion.position.x,stride,ease);
    this.motion.position.y=T.MathUtils.lerp(this.motion.position.y,breath+lift,ease);
    this.motion.rotation.z=T.MathUtils.lerp(this.motion.rotation.z,stride*.65,ease);
  }
}
