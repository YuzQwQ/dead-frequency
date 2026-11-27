import { AmbientLight, Box3, DirectionalLight, Group, Scene, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { AssetFactory } from './assets.ts';
import { items } from './data.ts';
import type { WeaponId } from './data.ts';
import type { Kit, Stack } from './inventory.ts';

export class InventoryPreview {
  private renderer?:WebGLRenderer;
  private assets?:AssetFactory;
  private scene=new Scene();
  private camera=new PerspectiveCamera(31,.8,.01,25);
  private mount?:HTMLElement;
  private model?:Group;
  private signature='';
  private angle=.22;
  private pointer?:number;
  private resize=new ResizeObserver(()=>this.draw());
  private unavailable=false;

  constructor() {
    const key=new DirectionalLight(0xf4ead2,2.55);
    key.position.set(-2,4,-3);
    this.scene.add(key,new AmbientLight(0xb4c7c8,1.65));
  }

  show(mount?:HTMLElement,kit?:Kit,item?:Stack|'knife') {
    if (this.mount!==mount) {
      this.resize.disconnect();
      this.mount=mount;this.pointer=undefined;
      if (mount) this.resize.observe(mount);
    }
    if (!mount || this.unavailable) return;
    if (!this.renderer) {
      try {
        this.renderer=new WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
        this.renderer.setClearColor(0,0);
        this.assets=new AssetFactory();
      } catch {
        this.unavailable=true;
        mount.textContent='3D 预览不可用';
        return;
      }
      const canvas=this.renderer.domElement;
      canvas.addEventListener('pointerdown',event=>{
        if (event.button!==0) return;
        canvas.setPointerCapture(event.pointerId);this.pointer=event.pointerId;
      });
      canvas.addEventListener('pointermove',event=>{
        if (event.pointerId!==this.pointer) return;
        this.angle+=event.movementX*.016;this.draw();
      });
      canvas.addEventListener('lostpointercapture',()=>{this.pointer=undefined;});
    }
    const signature=kit ? 'actor:'+['armor','helmet','headset','rig','backpack'].map(slot=>kit.gear[slot as keyof Kit['gear']]?.id).join(',')
      : typeof item==='string' ? item : item?.id ?? '';
    if (signature!==this.signature) {
      this.signature=signature;
      this.model?.removeFromParent();
      const assets=this.assets!;
      this.model=kit ? assets.actor('scav',kit).root
        : item==='knife' ? assets.knife(false)
        : item && items[item.id].kind==='weapon' ? assets.gun(item.id as WeaponId,false).root : undefined;
      if (this.model) {
        const box=new Box3().setFromObject(this.model), center=box.getCenter(new Vector3());
        const radius=box.getSize(new Vector3()).length()/2;
        const root=this.model;
        root.position.sub(center);
        this.model=new Group();
        this.model.add(root);
        this.scene.add(this.model);
        /* 角色预览拉近相机，让模型占满纵向空间；物品检视保持原来的距离 */
        this.camera.position.set(0,radius*.12,-radius*(kit ? 3.3 : 3.35));
        this.camera.lookAt(0,0,0);
        this.angle=kit ? .22 : 1.05;
      }
    }
    if (this.renderer.domElement.parentElement!==mount) mount.append(this.renderer.domElement);
    this.draw();
  }

  private draw() {
    if (!this.mount?.isConnected || !this.renderer || !this.model) return;
    const {clientWidth:width,clientHeight:height}=this.mount;
    if (!width || !height) return;
    this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;
    this.camera.updateProjectionMatrix();
    this.model.rotation.y=this.angle;
    this.renderer.render(this.scene,this.camera);
  }

  dispose() {
    this.resize.disconnect();
    this.renderer?.dispose();
    this.assets?.dispose();
    this.renderer?.forceContextLoss();
  }
}
