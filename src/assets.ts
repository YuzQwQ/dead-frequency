import * as T from 'three';
import { buildings, containerSites, exits } from './sector.ts';
import type { Building, Exit, Solid } from './sector.ts';
import type { EnemyKind, LootKind, WeaponId } from './data.ts';
import { ModelParts } from './model-parts.ts';
import type { XYZ } from './model-parts.ts';
import { weaponRecipes } from './models/weapons.ts';
import { knifeRecipe } from './models/knife.ts';
import { buildProp } from './props.ts';
import type { Kit } from './inventory.ts';

type Shape = 'box' | 'barrel' | 'wedge' | 'shard' | 'plane' | 'cone';
type Stamp = {shape:Shape; color:number; matrix:T.Matrix4};
type Build = (shape:Shape,color:number,x:number,y:number,z:number,w:number,h:number,d:number,rx?:number,ry?:number,rz?:number) => void;
export type ActorModel = {root:T.Group; torso:T.Group; head:T.Group; limbs:T.Group[]; flash:T.Mesh; hit:T.Mesh};
export type WeaponModel = {root:T.Group; flash:T.Mesh; sightHeight:number; viewDepth:number; posePump?:(amount:number)=>void};

const containers:Record<LootKind, [number,number]> = {
  tool:[0x57674e,0xb79756], file:[0x687b75,0xa1a796], supply:[0x405846,0xa8a467],
  medical:[0xb4bcab,0x9a4741], sealed:[0x3d5352,0xa8d0af], corpse:[0x6b6450,0xbe9a61],
  anomaly:[0x5b7976,0x8acec2], drop:[0x646f55,0xa79c70],
};

export class AssetFactory {
  private materials = new Map<number,T.MeshStandardMaterial>();
  private extra: (T.Material | T.Texture)[] = [];
  /* 同一类容器外形一致，描边几何复用；材质每箱一份，因为透明度各不相同 */
  private outlines = new Map<string,T.EdgesGeometry>();
  readonly geometry:Record<Shape,T.BufferGeometry> = {
    box:new T.BoxGeometry(), barrel:new T.CylinderGeometry(.5,.5,1,8),
    wedge:new T.CylinderGeometry(.5,.5,1,3), shard:new T.OctahedronGeometry(.5),
    plane:new T.PlaneGeometry(), cone:new T.CylinderGeometry(.16,.5,1,8),
  };
  readonly impact = new T.MeshBasicMaterial({color:0xffffff});
  private modelParts=new ModelParts(this.geometry,color=>this.material(color));

  dispose() {
    this.modelParts.dispose();
    Object.values(this.geometry).forEach(g => g.dispose());
    this.materials.forEach(m => m.dispose());
    this.extra.forEach(resource => resource.dispose());
    this.outlines.forEach(g => g.dispose());
    this.impact.dispose();
  }

  material(color:number) {
    let material = this.materials.get(color);
    if (!material) {
      material = new T.MeshStandardMaterial({color, flatShading:true, roughness:.91});
      this.materials.set(color,material);
    }
    return material;
  }

  mesh(shape:Shape,color:number,x:number,y:number,z:number,w:number,h:number,d:number,rx=0,ry=0,rz=0) {
    const mesh = new T.Mesh(this.geometry[shape],this.material(color));
    mesh.position.set(x,y,z);
    mesh.scale.set(w,h,d);
    mesh.rotation.set(rx,ry,rz);
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    return mesh;
  }

  private assembly(root:T.Object3D):Build {
    return (...args) => root.add(this.mesh(...args));
  }

  private sign(text:string, base:string, ink:string, w:number,h:number) {
    const canvas=document.createElement('canvas');
    canvas.width=512; canvas.height=96;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle=base; ctx.fillRect(0,0,512,96);
    ctx.strokeStyle=ink; ctx.lineWidth=3; ctx.strokeRect(7,7,498,82);
    ctx.textBaseline='middle'; ctx.fillStyle=ink; ctx.textAlign='center';
    ctx.font='bold 47px "Microsoft YaHei", monospace';
    ctx.fillText(text,256,48,461);
    const map=new T.CanvasTexture(canvas);
    map.colorSpace=T.SRGBColorSpace;
    const material=new T.MeshBasicMaterial({map});
    this.extra.push(map,material);
    const sign=new T.Mesh(this.geometry.plane,material);
    sign.scale.set(w,h,1);
    return sign;
  }

  private gravel() {
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=96;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#48554d';
    ctx.fillRect(0,0,96,96);
    let seed=49607;
    const next=() => ((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    for (let i=0;i<620;i++) {
      ctx.fillStyle=next()<.56 ? 'rgba(182,173,137,.10)' : 'rgba(19,29,24,.16)';
      ctx.fillRect(next()*96,next()*96,1+next()*3,1+next()*3);
    }
    const map=new T.CanvasTexture(canvas);
    map.colorSpace=T.SRGBColorSpace;
    map.wrapS=map.wrapT=T.RepeatWrapping;
    map.repeat.set(20,20);
    const material=new T.MeshStandardMaterial({map,roughness:1});
    this.extra.push(map,material);
    return material;
  }

  sector(solids:Solid[]) {
    const root=new T.Group();
    const stamps:Stamp[]=[];
    const dummy=new T.Object3D();
    const add:Build=(shape,color,x,y,z,w,h,d,rx=0,ry=0,rz=0) => {
      dummy.position.set(x,y,z); dummy.scale.set(w,h,d); dummy.rotation.set(rx,ry,rz);
      dummy.updateMatrix();
      stamps.push({shape,color,matrix:dummy.matrix.clone()});
    };
    const ground=new T.Mesh(this.geometry.plane,this.gravel());
    ground.rotation.x=-Math.PI/2;
    ground.scale.set(140,140,1);
    ground.receiveShadow=true;
    root.add(ground);

    // Container bodies are decorated separately. They still share the solid map geometry.
    for (const solid of solids.slice(0,-containerSites.length)) {
      const {x,z,w,d,y,h,surface,tone}=solid;
      const color=tone ?? (surface==='steel' ? 0x65796f : surface==='wood' ? 0x706858 : surface==='glass' ? 0x557f83 : 0x758278);
      add('box',color,x,y+h/2,z,w,h,d);
      if (surface==='concrete' && y===0 && h>2) {
        add('box',0x4d5b52,x,.24,z,w+.035,.47,d+.035);
      }
      if (surface==='steel' && y===0 && w>1.5 && d>3 && h>1.5) {
        for (let offset=-d/2+.35; offset<d/2; offset+=.4) {
          add('box',0xa4a490,x,h*.5,z+offset,w+.05,h*.92,.075);
        }
        for (const side of [-1,1]) add('box',0x3d4d47,x,h/2,z+side*(d/2-.06),w+.09,h,.13);
      }
      if (surface==='wood') {
        for (const side of [-1,1]) {
          add('box',0x9a8763,x+side*w*.29,h/2,z,.12,h+.04,d+.045);
          add('box',0x4b4d3d,x,h/2,z+side*d*.33,w+.035,.12,.095);
        }
      }
    }
    for (const c of containerSites) this.caseParts(add,c.kind,c.x,c.z,c.h);
    for (const building of buildings) this.building(root,add,building);
    for (const exit of exits) this.exit(root,add,exit);

    // Road paint, drainage grates, concrete jersey barriers, power poles.
    for (let z=-33;z<=36;z+=4) add('box',0x8d8b63,-.5,.012,z,.12,.016,1.55);
    for (let z=-31;z<31;z+=5) {
      add('box',0x3c4a43,33,.012,z,.32,.018,3);
      add('box',0x989777,36,.015,z,.11,.018,2.4);
    }
    for (let i=0;i<11;i++) {
      add('box',0x454d43,10,.012,27+i*.29,1.25,.019,.20);
      add('box',0x82775b,11,.018,26+i*.16,.13,.021,.13,0,.6);
    }
    for (const [x,z] of [[-11,23],[12,27],[14,1],[-7,-16],[15,-31],[-19,-31]]) {
      add('box',0x3c4b44,x,3.1,z,.15,6.2,.15);
      add('box',0x4d554b,x,6.1,z-.56,.14,.13,1.13);
      add('box',0xd1bb8a,x,6.01,z-1.08,.37,.18,.56);
      add('box',0x778475,x,.16,z,.50,.32,.50);
    }
    this.tower(root,add);

    let scatter=84;
    const random=() => ((scatter=(scatter*1664525+1013904223)>>>0)/4294967296);
    for (let i=0;i<92;i++) {
      const x=random()*76-38, z=random()*74-37;
      if (buildings.some(b => Math.abs(x-b.x)<b.w*.53 && Math.abs(z-b.z)<b.d*.53)) continue;
      const size=.15+random()*.45;
      add('box', i%3===0 ? 0x62705c : 0x3e4c44,x,.03,z,size,.055,size*.45,0,random()*Math.PI);
      if (i%4===0) this.grass(add,x,z,random());
    }
    for (const side of [-1,1]) for (let i=0;i<12;i++) {
      const x=side*(42+random()*13), z=-53+i*9+random()*2;
      if (i%3===0) {
        const w=4+random()*7, h=3+random()*6;
        add('box',0x4a5b54,x,h/2,z,w,h,4);
        add('box',0x52615a,x,h+.15,z,w+.45,.3,4.6);
      } else this.tree(add,x,z,1+random()*1.7);
    }
    for (const shape of Object.keys(this.geometry) as Shape[]) {
      const entries=stamps.filter(stamp => stamp.shape===shape);
      if (!entries.length) continue;
      const instances=new T.InstancedMesh(this.geometry[shape],this.material(0xffffff),entries.length);
      const color=new T.Color();
      entries.forEach((entry,i) => {
        instances.setMatrixAt(i,entry.matrix);
        instances.setColorAt(i,color.setHex(entry.color));
      });
      instances.castShadow=true;
      instances.receiveShadow=true;
      root.add(instances);
    }
    return root;
  }

  private building(root:T.Group,add:Build,b:Building) {
    add('box',0x647168,b.x,.016,b.z,b.w-.25,.025,b.d-.25);
    add('box',0x414e48,b.x,b.h+.33,b.z,b.w+.74,.12,b.d+.73);
    const sign=this.sign(b.sign,'#26332c','#ddd0a9',Math.min(6,b.w*.45),.78);
    sign.position.set(b.x+Math.min(2,b.w*.14),b.h-.43,b.z+b.d/2+.18);
    root.add(sign);
    for (const side of ['n','s','e','w'] as const) {
      const horizontal=side==='n'||side==='s';
      const fixed=horizontal ? b.z+(side==='s' ? b.d/2 : -b.d/2) : b.x+(side==='e' ? b.w/2 : -b.w/2);
      for (const [p,width] of b.doors[side] ?? []) {
        for (const offset of [-1,1]) {
          const position=p+offset*(width/2+.045);
          add('box',0x384b43,horizontal ? position : fixed,1.42,horizontal ? fixed : position,
            horizontal ? .16 : .43,2.84,horizontal ? .43 : .16);
        }
        add('box',0xb59258,horizontal ? p : fixed,2.81,horizontal ? fixed : p,
          horizontal ? width+.2 : .42,.15,horizontal ? .42 : width+.2);
        add('box',0x918a66,horizontal ? p : fixed,.024,horizontal ? fixed : p,
          horizontal ? width : .65,.04,horizontal ? .65 : width);
      }
      for (const [p,width] of b.windows?.[side] ?? []) {
        for (const y of [1.25,1.82,2.38]) {
          add('box',0x324942,horizontal?p:fixed,y,horizontal?fixed:p,
            horizontal?width+.12:.38,.085,horizontal?.38:width+.12);
        }
        for (const along of [p-width/2,p,p+width/2]) {
          add('box',0x354d44,horizontal?along:fixed,1.82,horizontal?fixed:along,
            horizontal?.085:.39,1.21,horizontal?.39:.085);
        }
      }
    }
    for (const [offset,depth] of [[-.34,.34],[.39,-.32]]) {
      const x=b.x+b.w*offset,z=b.z+b.d*depth;
      add('box',0x929184,x,b.h-.43,z,1.65,.17,.27);
      add('box',b.light,x,b.h-.53,z,1.47,.09,.17);
    }
    if (b.h<5) {
      add('box',0x536157,b.x-b.w*.25,b.h+.76,b.z-.9,2.2,.89,1.45);
      for (let i=0;i<5;i++) add('box',0x849089,b.x-b.w*.25-.7+i*.35,b.h+1.21,b.z-.9,.08,.08,1.4);
    } else {
      for (const side of [-1,1]) add('box',0x67756a,b.x+side*b.w*.34,b.h+.66,b.z,1.2,.65,b.d*.8);
    }
  }

  private exit(root:T.Group,add:Build,e:Exit) {
    const {x,z}=e;
    add('barrel',0x4d6455,x,.019,z,e.radius*2,.03,e.radius*2);
    for (let i=0;i<12;i++) {
      const a=i*Math.PI/6;
      add('box',0xc3c078,x+Math.cos(a)*2.36,.043,z+Math.sin(a)*2.36,.36,.025,.19,0,-a+Math.PI/2);
    }
    for (const dx of [-2.6,2.6]) {
      add('box',0x4a6357,x+dx,1.65,z-2.15,.22,3.3,.22);
      add('box',0x98e2a9,x+dx,2.92,z-2.15,.37,.36,.35);
    }
    add('box',0x495b52,x,3.04,z-2.15,5.4,.17,.23);
    const sign=this.sign(e.id+' / '+e.name,'#273d32','#c5e4ac',3.95,.56);
    sign.position.set(x,2.47,z-2.0);
    root.add(sign);
  }

  private tower(root:T.Group,add:Build) {
    const x=0,z=-37;
    for (const dx of [-1.25,1.25]) for (const dz of [-1.05,1.05]) {
      add('box',0x706253,x+dx,8,z+dz,.17,16,.17);
    }
    for (let y=2;y<16;y+=2.3) {
      for (const dx of [-1.25,1.25]) {
        add('box',0x9b775c,x+dx,y,z,.14,.14,2.17);
        add('box',0x806d58,x+dx,y+1.12,z,.1,3.13,.10,Math.PI/4);
      }
      for (const dz of [-1.05,1.05]) {
        add('box',0x9b775c,x,y,z+dz,2.62,.14,.14);
        add('box',0x806d58,x,y+1.13,z+dz,.10,3.36,.1,0,0,Math.PI/4);
      }
    }
    add('box',0x474f4a,x,15.3,z,3.35,.29,2.8);
    add('barrel',0xc49875,x+.2,17.3,z,.16,3.5,.16);
    add('box',0xa99c82,x+.2,17.9,z,3.9,.12,.12);
    add('box',0xa99c82,x+.2,18.7,z,2.9,.12,.12);
    const lamp=new T.Mesh(this.geometry.box,new T.MeshBasicMaterial({color:0xf4935c}));
    this.extra.push(lamp.material);
    lamp.position.set(x+.2,19.2,z); lamp.scale.set(.34,.34,.34);
    root.add(lamp);
    const warning=this.sign('DF / 07','#342b23','#e9ac75',2.8,.58);
    warning.position.set(x,10.6,z+1.2);
    root.add(warning);
  }

  private grass(add:Build,x:number,z:number,v:number) {
    for (let i=0;i<3;i++) add('wedge',0x63725a,x+i*.12,.17,z+i*.07,.13,.34+i*.07,.13,0,v+i,.18);
  }

  private tree(add:Build,x:number,z:number,size:number) {
    add('barrel',0x4b5145,x,size*.75,z,size*.19,size*1.5,size*.19);
    for (let i=0;i<3;i++) add('shard',i===1 ? 0x526a5e : 0x485e51,x,size*(1.42+i*.32),z,size*(1.72-i*.38),size*1.25,size*(1.64-i*.4),0,i*.46);
  }

  private caseParts(add:Build,kind:LootKind,x:number,z:number,h:number) {
    const [body,trim]=containers[kind];
    const w=h>1.1 ? .78 : 1.13;
    add('box',body,x,h/2,z,w,h,.58);
    add('box',trim,x,h-.045,z,w+.07,.10,.62);
    if (kind==='file' || kind==='sealed') {
      for (let i=0;i<3;i++) {
        const y=h*(.24+i*.25);
        for (const side of [-1,1]) {
          add('box',0x323b37,x,y-.10,z+side*.298,w*.88,.025,.027);
          add('box',trim,x,y+.02,z+side*.322,.22,.056,.046);
        }
      }
    } else {
      for (const offset of [-.34,.34]) add('box',trim,x+offset,h/2,z,.085,h,.60);
      for (const side of [-1,1]) add('box',0x26332d,x,h*.67,z+side*.309,.25,.092,.073);
      if (kind==='medical') {
        add('box',0xab4a47,x,h*.58,z+.319,.37,.08,.026);
        add('box',0xab4a47,x,h*.58,z+.321,.09,.27,.031);
      }
    }
  }

  cache(kind:LootKind) {
    const group=new T.Group(), add=this.assembly(group);
    if (kind==='anomaly') {
      add('shard',0x70b7a4,0,.18,0,.37,.34,.38,0,.27,.22);
      add('shard',0x507f77,.19,.10,.13,.19,.21,.17,0,-.4);
    } else {
      add('box',containers[kind][0],0,.16,0,.64,.29,.43);
      add('box',containers[kind][1],0,.30,0,.67,.08,.45);
      for (const side of [-1,1]) add('box',0x343c30,side*.20,.18,0,.07,.31,.46);
    }
    /* 贴体的细描边：默认隐形，由 View 按距离给透明度。
       用 EdgesGeometry 而不是缩放模型，线宽恒为 1px，不会随距离变粗。 */
    const box=new T.Box3().setFromObject(group);
    const size=box.getSize(new T.Vector3()).multiplyScalar(1.12);
    const edges=this.outlineGeometry(`crate:${kind}`,size.x,size.y,size.z);
    const line=this.outlineLine(edges,0);
    line.position.copy(box.getCenter(new T.Vector3()));
    group.add(line);
    group.userData.outline=line;
    return group;
  }

  private outlineGeometry(key:string,w:number,h:number,d:number) {
    let edges=this.outlines.get(key);
    if (!edges) {
      const cast=new T.BoxGeometry(w,h,d);
      edges=new T.EdgesGeometry(cast);
      cast.dispose();
      this.outlines.set(key,edges);
    }
    return edges;
  }

  private outlineLine(edges:T.EdgesGeometry,y:number) {
    const line=new T.LineSegments(edges,new T.LineBasicMaterial({
      color:0xffe2b4, transparent:true, opacity:0, depthWrite:false,
    }));
    line.position.y=y;
    line.name='outline';
    line.renderOrder=2;
    line.visible=false;
    return line;
  }

  /* 烤进地图网格的那批静态容器没有独立模型，描边单独生成，尺寸与 caseParts 对齐 */
  containerOutline(kind:LootKind,h:number) {
    const tall=h>1.1;
    const w=(tall ? .78 : 1.13)*1.12;
    const edges=this.outlineGeometry(`${kind}:${tall ? 'tall' : 'low'}`,w,h*1.12,.58*1.12);
    return this.outlineLine(edges,h/2);
  }

  /* 每个箱子的描边材质是独立的（透明度不同），回收时要单独释放 */
  disposeCache(model:T.Object3D) {
    const line=model.userData.outline as T.LineSegments|undefined;
    if (line) (line.material as T.Material).dispose();
    model.removeFromParent();
  }

  gun(id:WeaponId, firstPerson=true):WeaponModel {
    const recipe=weaponRecipes[id];
    const {root,nodes}=this.modelParts.build(recipe,firstPerson);
    const model=this.weaponEffects(root,recipe.muzzle,recipe.sightHeight,recipe.viewDepth);
    if (recipe.motion) {
      const joint=nodes.get(recipe.motion.part);
      if (!joint) throw new Error(`Missing motion part ${recipe.motion.part} for ${id}`);
      const at=joint.position.clone(), travel=new T.Vector3(...recipe.motion.travel);
      model.posePump=amount=>joint.position.copy(at).addScaledVector(travel,amount);
    }
    return model;
  }

  knife(firstPerson=true) {
    return this.modelParts.build(knifeRecipe,firstPerson).root;
  }

  /* 收集品的程序化模型：图标截图与游戏内掉落物共用同一份几何。
     以后要接 GLTF，只需要在这里换一次实现。 */
  prop(id:string) {
    const root=new T.Group();
    buildProp(this.assembly(root),id);
    return root;
  }

  private weaponEffects(root:T.Group,muzzle:XYZ,sightHeight:number,viewDepth=0):WeaponModel {
    const flash=new T.Mesh(this.geometry.shard,this.impact);
    flash.position.set(...muzzle); flash.scale.set(.22,.2,.44); flash.visible=false;
    flash.name='flash'; root.add(flash);
    return {root,flash,sightHeight,viewDepth};
  }

  actor(kind:EnemyKind,preview?:Kit):ActorModel {
    const root=new T.Group(), torso=new T.Group(), head=new T.Group();
    const echo=kind==='echo';
    torso.position.y=echo ? .77 : .94; root.add(torso);
    head.position.set(0,echo ? .40 : .57,echo ? -.19 : 0); torso.add(head);
    const body=this.assembly(torso), face=this.assembly(head);
    const cloth=echo ? 0x42625d : 0x777a5f, trim=echo ? 0x659082 : 0x4c5645;
    body('box',cloth,0,.13,0,echo ? .55 : .49,.53,.3,echo ? -.29 : 0,0,echo ? -.08 : 0);
    if (!preview || preview.gear.armor)
      body('box',preview?.gear.armor?.id==='plate' ? 0x465156 : trim,0,.09,-.15,.39,.26,.09);
    if (!echo) {
      if (preview) body('box',0x77705a,0,.405,0,.18,.18,.16);
      if (!preview || preview.gear.backpack) {
        const tactical=preview?.gear.backpack?.id==='packTactical';
        body('box',!preview ? 0x977950 : tactical ? 0x48625a : 0x827453,0,.14,preview ? .24 : .22,tactical ? .44 : .37,.49,preview ? .28 : .27);
        if (preview) body('box',0x585946,0,.045,.39,.29,.18,.07);
      }
      if (preview?.gear.rig) {
        body('box',0x88785b,0,.025,-.21,.38,.165,.09);
        for (const x of [-.125,0,.125]) body('box',0x61644e,x,.03,-.26,.09,.12,.025);
      }
      body('box',0x38443a,0,-.13,0,.51,.10,.34);
    } else {
      body('shard',0x88c8b1,.11,.27,-.16,.22,.45,.25,0,.27,.31);
      body('shard',0x588b81,-.24,.38,.06,.22,.35,.25,.24,0,-.62);
    }
    face('box',echo ? 0x8cafa0 : 0xa6997f,0,.06,0,.31,.30,.29,0,0,echo ? -.17 : 0);
    if (!preview || preview.gear.helmet)
      face('box',preview?.gear.helmet?.id==='helmetHeavy' ? 0x424d49 : echo ? 0x324e48 : 0x515b4c,0,preview ? .195 : .18,.007,
        preview ? .37 : .35,preview ? .14 : .13,preview ? .35 : .34);
    if (preview?.gear.headset) {
      face('box',0x313939,0,.24,.01,.34,.038,.095);
      for (const x of [-.168,.168]) face('box',0x3f4b44,x,.07,.025,.065,.155,.13);
    }
    face('box',0x26322e,0,.076,-.155,.28,.074,.045);
    for (const dx of [-.078,.078]) face('box',echo ? 0x8be5bf : 0x928675,dx,.085,-.182,.046,.034,.025);
    const limbs:T.Group[]=[];
    for (const side of [-1,1]) {
      const arm=new T.Group(), leg=new T.Group();
      arm.position.set(side*.34,.32,0); torso.add(arm);
      leg.position.set(side*.145,echo ? .67 : .87,.015); root.add(leg);
      const armParts=this.assembly(arm), legParts=this.assembly(leg);
      armParts('box',cloth,0,-.22,0,.16,echo ? .56 : .45,.17);
      armParts('box',echo ? 0x90b6a2 : 0x766f59,0,echo ? -.53 : -.42,-.02,echo ? .13 : .15,.16,.15);
      legParts('box',trim,0,echo ? -.26 : -.31,0,.21,echo ? .55 : .64,.23);
      legParts('box',0x313d36,0,echo ? -.53 : -.69,-.043,.23,.22,.32);
      limbs.push(arm,leg);
    }
    let flash:T.Mesh=new T.Mesh(this.geometry.shard,this.impact);
    if (!echo && !preview) {
      const gun=this.gun('ar56',false);
      gun.root.position.set(.23,.05,.17); gun.root.scale.setScalar(.73);
      gun.root.name='weapon'; torso.add(gun.root);
      flash=gun.flash;
    } else {
      flash.visible=false;
      torso.add(flash);
    }
    // The shared tint is represented as a separate plate, visible for the hit window only.
    const hit=new T.Mesh(this.geometry.box,this.impact);
    hit.position.set(0,.14,-.205); hit.scale.set(.27,.17,.028); hit.visible=false;
    torso.add(hit);
    return {root,torso,head,limbs,flash,hit};
  }
}
