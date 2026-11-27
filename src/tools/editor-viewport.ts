import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ModelParts } from '../model-parts.ts';
import type { EditableRecipe } from '../models/format.ts';

export type Angle='perspective'|'side'|'front'|'top';
export type Tool='translate'|'rotate'|'select';
const directions:Record<Angle,T.Vector3>={
  perspective:new T.Vector3(.9,.5,-.42).normalize(), side:new T.Vector3(1,0,0),
  front:new T.Vector3(0,0,-1), top:new T.Vector3(0,1,0),
};

export class EditorViewport {
  private renderer: T.WebGLRenderer;
  private scene=new T.Scene();
  private perspective=new T.PerspectiveCamera(33,1,.005,200);
  private orthographic=new T.OrthographicCamera(-1,1,1,-1,.005,200);
  private camera:T.PerspectiveCamera|T.OrthographicCamera=this.perspective;
  private orbit:OrbitControls;
  private gizmo:TransformControls;
  private grid=new T.GridHelper(8,40,0x566758,0x36483e);
  private bounds=new T.Box3();
  private highlight=new T.Box3Helper(new T.Box3(),0xedb37b);
  private ray=new T.Raycaster();
  private pointer=new T.Vector2();
  private startPointer=new T.Vector2();
  private manipulated=false;
  private selected?:T.Object3D;
  private tool:Tool='translate';
  private mode:Angle='perspective';
  private motion?:{node:T.Object3D; base:T.Vector3; distance:T.Vector3};
  private pose=0;
  private model?:ReturnType<ModelParts['build']>;
  private observer:ResizeObserver;
  private primitives={box:new T.BoxGeometry(),barrel:new T.CylinderGeometry(.5,.5,1,8)};
  private materials=new Map<number,T.Material>();
  private parts=new ModelParts(this.primitives,color=>{
    let material=this.materials.get(color);
    if (!material) {
      material=new T.MeshStandardMaterial({color,roughness:.9,flatShading:true});
      this.materials.set(color,material);
    }
    return material;
  });

  constructor(private host:HTMLElement, pick:(part:string)=>void,
    transform:(name:string,position:[number,number,number],rotation:[number,number,number])=>void) {
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
    this.renderer.outputColorSpace=T.SRGBColorSpace;
    const canvas=this.renderer.domElement;
    canvas.setAttribute('aria-label','三维模型视口');
    host.prepend(canvas);
    this.orbit=new OrbitControls(this.camera,canvas);
    this.orbit.minDistance=.04;
    this.orbit.maxDistance=35;
    this.orbit.addEventListener('change',this.draw);

    this.gizmo=new TransformControls(this.camera,canvas);
    this.gizmo.setSize(.70);
    this.gizmo.setSpace('local');
    this.gizmo.addEventListener('change',this.draw);
    this.gizmo.addEventListener('mouseDown',()=>{this.manipulated=true;});
    this.gizmo.addEventListener('dragging-changed',event=>{this.orbit.enabled=!event.value;});
    this.gizmo.addEventListener('mouseUp',()=>{
      const node=this.gizmo.object;
      if (node) {
        const position=node.position.toArray(), {x,y,z}=node.rotation;
        queueMicrotask(()=>transform(node.name,position,[x,y,z]));
      }
    });
    this.highlight.visible=false;
    this.scene.add(this.grid,this.highlight,this.gizmo.getHelper(),new T.HemisphereLight(0xf3f5df,0x797767,2.1));
    for (const [x,y,z,color,power] of [[2,3,1,0xffdfba,2.75],[-2,2,-3,0xc9e5f1,1.45]]) {
      const light=new T.DirectionalLight(color,power);
      light.position.set(x,y,z);
      this.scene.add(light);
    }
    canvas.addEventListener('pointerdown',event=>{
      this.startPointer.set(event.clientX,event.clientY);
      this.manipulated=false;
    },{capture:true});
    canvas.addEventListener('pointerup',event=>{
      if (event.button!==0 || this.manipulated || !this.model ||
        Math.hypot(event.clientX-this.startPointer.x,event.clientY-this.startPointer.y)>4) return;
      const rect=canvas.getBoundingClientRect();
      this.pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
      this.ray.setFromCamera(this.pointer,this.camera);
      const hit=this.ray.intersectObject(this.model.root,true)[0];
      if (hit) pick(hit.object.name);
    });
    this.observer=new ResizeObserver(()=>this.resize());
    this.observer.observe(host);
  }

  hasPart(name:string) { return this.model?.nodes.has(name) ?? false; }

  setModel(recipe:EditableRecipe,showHands:boolean) {
    this.gizmo.detach();
    this.selected=undefined;
    this.model?.root.removeFromParent();
    this.parts.dispose();
    this.materials.forEach(material=>material.dispose());
    this.materials.clear();
    this.model=this.parts.build(recipe,showHands);
    this.scene.add(this.model.root);
    const {part,travel}=recipe.motion ?? {};
    const node=part ? this.model.nodes.get(part) : undefined;
    this.motion=node && travel ? {node,base:node.position.clone(),distance:new T.Vector3(...travel)} : undefined;
    this.bounds.setFromObject(this.model.root);
    this.grid.position.y=(this.bounds.isEmpty() ? 0 : this.bounds.min.y)-.085;
    this.setPose(this.pose);
  }

  select(name:string|undefined) {
    this.selected=name ? this.model?.nodes.get(name) : undefined;
    this.bindGizmo();
  }

  setTool(tool:Tool) {
    this.tool=tool;
    this.bindGizmo();
  }

  private bindGizmo() {
    if (this.selected && this.tool!=='select' && this.pose===0) {
      this.gizmo.setMode(this.tool);
      this.gizmo.attach(this.selected);
    } else this.gizmo.detach();
    this.draw();
  }

  setPose(pose:number) {
    this.pose=pose;
    const motion=this.motion;
    if (motion) motion.node.position.copy(motion.base).addScaledVector(motion.distance,pose);
    this.bindGizmo();
  }

  angle(angle:Angle) {
    this.mode=angle;
    this.fit();
  }

  fit() {
    if (this.model) this.bounds.setFromObject(this.model.root);
    const sphere=this.bounds.getBoundingSphere(new T.Sphere());
    const radius=Math.max(.12,sphere.radius);
    this.camera=this.mode==='perspective' ? this.perspective : this.orthographic;
    this.camera.up.set(0,this.mode==='top'?0:1,this.mode==='top'?-1:0);
    this.camera.zoom=1;
    this.orbit.object=this.camera;
    this.gizmo.camera=this.camera;
    const aspect=Math.max(.1,this.host.clientWidth/Math.max(1,this.host.clientHeight));
    const distance=radius*1.18/Math.sin(Math.atan(Math.tan(T.MathUtils.degToRad(16.5))*Math.min(1,aspect)));
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(directions[this.mode],distance);
    this.orbit.update();
    this.resize();
  }

  private resize() {
    const width=this.host.clientWidth,height=this.host.clientHeight;
    if (!width || !height) return;
    const aspect=width/height;
    const box=this.bounds.getSize(new T.Vector3());
    const horizontal=this.mode==='side' ? box.z : box.x;
    const vertical=this.mode==='top' ? box.z : box.y;
    const h=Math.max(.1,horizontal*.62/aspect,vertical*.69);
    this.perspective.aspect=aspect;
    this.perspective.updateProjectionMatrix();
    Object.assign(this.orthographic,{left:-h*aspect,right:h*aspect,bottom:-h,top:h});
    this.orthographic.updateProjectionMatrix();
    this.renderer.setSize(width,height);
    this.draw();
  }

  private draw=()=>{
    this.highlight.visible=false;
    if (this.selected) {
      this.highlight.box.setFromObject(this.selected);
      this.highlight.visible=!this.highlight.box.isEmpty();
    }
    this.renderer.render(this.scene,this.camera);
  };

  dispose() {
    this.observer.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.parts.dispose();
    this.materials.forEach(m=>m.dispose());
    Object.values(this.primitives).forEach(g=>g.dispose());
    this.grid.dispose();
    this.highlight.dispose();
    this.renderer.dispose();
  }
}
