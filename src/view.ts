import * as T from 'three';
import { AssetFactory } from './assets.ts';
import type { WeaponModel } from './assets.ts';
import { sectorSolids } from './sector.ts';
import type { Settings } from './save.ts';
import type { Surface, Point } from './sector.ts';
import type { WeaponId } from './data.ts';
import { setKnifePose } from './knife-motion.ts';
import type { MeleeMotion } from './melee.ts';

type Effect = {mesh:T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>; life:number; type:'impact'|'tracer'; velocity:T.Vector3};
const fxColors = {concrete:0xc8b89c,wood:0xc99d67,steel:0xffbe76,glass:0x9ad3dd,enemy:0xd38069,echo:0x8de4ca,tracer:0xf0b977};

export class View {
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly assets = new AssetFactory();
  readonly camera = new T.PerspectiveCamera(71,1,.045,145);
  readonly world = new T.Scene();
  readonly dynamic = new T.Group();
  readonly solids = sectorSolids();
  private gunScene = new T.Scene();
  private gunCamera = new T.PerspectiveCamera(55,1,.035,5);
  private mount = new T.Group();
  private gunModels = new Map<WeaponId,WeaponModel>();
  private knifeModel = this.assets.knife();
  private lamp = new T.SpotLight(0xe4efda,44,28,.46,.53,1.5);
  private lightTarget = new T.Object3D();
  private effects:Effect[] = [];
  private effectCursor=0;
  private tracerAxis=new T.Vector3(0,1,0);
  private tracerVector=new T.Vector3();
  private pixelRatio=1;
  private aspect=1;
  private skyLight: T.HemisphereLight;
  private points: T.Points;
  private motion = new T.Vector3();
  private temp = new T.Vector3();

  constructor(host:HTMLElement) {
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.info.autoReset=false;
    this.renderer.setClearColor(0x52645e);
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=T.PCFShadowMap;
    this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.renderer.autoClear=false;
    this.canvas=this.renderer.domElement;
    this.canvas.setAttribute('aria-label','07 号转播站 3D 封锁区');
    host.replaceChildren(this.canvas);

    this.world.background=new T.Color(0x53645e);
    this.world.fog=new T.FogExp2(0x53645e,.020);
    this.camera.rotation.order='YXZ';
    this.world.add(this.assets.sector(this.solids),this.dynamic);
    this.skyLight=new T.HemisphereLight(0xc2d8cc,0x71614d,1.48);
    this.world.add(this.skyLight);
    const sun=new T.DirectionalLight(0xf0d6b0,1.33);
    sun.position.set(-29,40,27);
    sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-48,right:48,top:51,bottom:-51,near:2,far:135});
    sun.shadow.mapSize.set(1536,1536);
    sun.shadow.normalBias=.045;
    sun.shadow.bias=-.0002;
    this.world.add(sun);
    for (const [x,y,z,color,power] of [
      [-21,3.45,16,0xffc17c,39],[23,2.85,21,0xdcebd3,32],[-23,4.5,-13,0xeec28b,54],
      [21,3,-13,0xf1bd77,37],[1,3.35,-27,0x80d9c6,44],[-28,2.2,-35,0x94d697,31],[35,2.2,-3,0x94d697,31],
    ]) {
      const light=new T.PointLight(color,power,14,1.55);
      light.position.set(x,y,z);
      this.world.add(light);
    }
    const glow=new T.PointLight(0x74ddba,32,10,1.55);
    glow.position.set(0,.6,-28);
    this.world.add(glow);
    this.lamp.target=this.lightTarget;
    this.lamp.visible=false;
    this.world.add(this.lamp,this.lightTarget);

    const mist=new Float32Array(210*3);
    for (let i=0;i<mist.length;i+=3) {
      mist[i]=Math.random()*80-40; mist[i+1]=.45+Math.random()*5; mist[i+2]=Math.random()*80-40;
    }
    const mistGeometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(mist,3));
    this.points=new T.Points(mistGeometry,new T.PointsMaterial({
      color:0xbbc7aa,size:.03,transparent:true,opacity:.34,depthWrite:false,
    }));
    this.world.add(this.points);

    this.gunScene.add(this.mount,new T.HemisphereLight(0xd5dfce,0x746e5e,2.15));
    const key=new T.DirectionalLight(0xffdda9,1.65); key.position.set(-2,3,2); this.gunScene.add(key);
    this.knifeModel.visible=false;
    this.knifeModel.scale.setScalar(.87);
    this.mount.add(this.knifeModel);
    for (const id of ['k9','ar56','p12'] as const) {
      const gun=this.assets.gun(id);
      gun.root.visible=false;
      this.mount.add(gun.root); this.gunModels.set(id,gun);
    }
    for (let i=0;i<48;i++) {
      const mesh=new T.Mesh(this.assets.geometry.box,new T.MeshBasicMaterial({color:0xffffff}));
      mesh.visible=false;
      this.dynamic.add(mesh);
      this.effects.push({mesh,life:0,type:'impact',velocity:new T.Vector3()});
    }
    this.resize();
  }

  resize() {
    this.aspect=innerWidth/Math.max(1,innerHeight);
    this.camera.aspect=this.gunCamera.aspect=this.aspect;
    this.camera.updateProjectionMatrix(); this.gunCamera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth,innerHeight,false);
  }

  settings(settings:Settings) {
    this.pixelRatio=settings.resolution===2 ? .74 : Math.min(devicePixelRatio,1.5);
    this.resize();
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as T.PointsMaterial).dispose();
    this.effects.forEach(effect => (effect.mesh.material as T.Material).dispose());
    this.world.traverse(object => { if (object instanceof T.DirectionalLight) object.shadow.dispose(); });
    this.assets.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  resetEffects() {
    for (const e of this.effects) { e.life=0; e.mesh.visible=false; }
  }

  private effect(type:Effect['type'],color:number,life:number) {
    const effect=this.effects[this.effectCursor++%this.effects.length];
    effect.life=life;
    effect.type=type;
    effect.mesh.visible=true;
    effect.mesh.material.color.setHex(color);
    return effect;
  }

  impact(x:number,y:number,z:number,surface:Surface|'enemy'|'echo') {
    for (let i=0;i<3;i++) {
      const e=this.effect('impact',fxColors[surface],.18+i*.065);
      e.mesh.position.set(x,y,z); e.mesh.rotation.set(i,.7,i*.4);
      const size=.028+Math.random()*.038;
      e.mesh.scale.setScalar(size);
      e.velocity.set((Math.random()-.5)*3, .8+Math.random()*2, (Math.random()-.5)*3);
    }
  }

  tracer(x:number,y:number,z:number,tx:number,ty:number,tz:number) {
    const e=this.effect('tracer',fxColors.tracer,.074);
    const vector=this.tracerVector.set(tx-x,ty-y,tz-z);
    const length=Math.max(.02,vector.length());
    e.mesh.position.set((x+tx)/2,(y+ty)/2,(z+tz)/2);
    e.mesh.scale.set(.017,length,.017);
    e.mesh.quaternion.setFromUnitVectors(this.tracerAxis,vector.multiplyScalar(1/length));
  }

  animate(dt:number,time:number) {
    this.points.position.set(Math.sin(time*.11)*.8,Math.sin(time*.2)*.18,Math.cos(time*.13)*.7);
    for (const e of this.effects) {
      if (e.life<=0) continue;
      e.life-=dt;
      e.mesh.visible=e.life>0;
      if (e.type==='impact') {
        e.mesh.position.addScaledVector(e.velocity,dt);
        e.velocity.y-=7*dt;
      }
    }
  }

  aim(x:number,y:number,z:number,yaw:number,pitch:number,fov:number) {
    this.camera.position.set(x,y,z);
    this.camera.rotation.set(pitch,yaw,0,'YXZ');
    if (Math.abs(this.camera.fov-fov)>.015) {
      this.camera.fov=fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  flashlight(on:boolean) {
    this.lamp.visible=on;
    if (!on) return;
    this.camera.getWorldDirection(this.temp);
    this.lamp.position.copy(this.camera.position);
    this.lightTarget.position.copy(this.camera.position).addScaledVector(this.temp,8);
  }

  weapon(id:WeaponId | undefined,ads:number,sprint:number,kick:number,reload:number,pump:number,flash:boolean,phase:number,sway:Point,near:number) {
    this.knifeModel.visible=false;
    const active=id ? this.gunModels.get(id) : undefined;
    for (const model of this.gunModels.values()) model.root.visible=model===active;
    if (active) {
      active.flash.visible=flash;
      if (flash) active.flash.rotation.z=phase*10;
      active.posePump?.(pump);
    }
    const sightHeight=active?.sightHeight ?? .173;
    this.mount.position.set(
      .31*(1-ads)+sway.x*.023*(1-ads*.85)+sprint*.11,
      -.31+ads*(.31-sightHeight)+sway.z*.021-reload*.23-sprint*.14-near*.12,
      -.77+(active?.viewDepth ?? 0)+ads*.18+kick*.135+reload*.08+near*.17,
    );
    this.mount.rotation.set(kick*.21-reload*.43-sprint*.39-near*.24,sprint*.46+near*.29,sway.x*.034-reload*.41-sprint*.16);
  }

  knife(motion:Readonly<MeleeMotion>|null,phase:number,pace:number,sprint:number) {
    for (const model of this.gunModels.values()) model.root.visible=false;
    this.knifeModel.visible=true;
    setKnifePose(this.mount,motion,phase,pace,sprint);
  }

  preview(time:number) {
    this.camera.position.set(4+Math.sin(time*.12)*1.9,3.65,29.5);
    this.camera.lookAt(this.motion.set(-7,3.9,-9));
    if (this.camera.fov!==62) { this.camera.fov=62; this.camera.updateProjectionMatrix(); }
    this.lamp.visible=false;
    this.draw(false);
  }

  draw(showGun:boolean) {
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.world,this.camera);
    if (showGun) {
      this.renderer.clearDepth();
      this.renderer.render(this.gunScene,this.gunCamera);
    }
  }
}
