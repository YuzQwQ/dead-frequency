import * as T from 'three';

export type XY = readonly [number, number];
export type XYZ = readonly [number, number, number];
export type LoftSection = readonly [x:number,y:number,z:number,width:number,depth:number];
type Transform = {name:string; at?:XYZ; rotation?:XYZ; hand?:true};
type Surface = {material:string};
type Primitive = Transform & Surface & {kind:'box'|'barrel'; size:XYZ};
type Profile = Transform & Surface & {
  kind:'profile'; outline:readonly XY[]; depth:number; bevel?:number; edgeDepth?:number;
  sideOffset?:number; rimMaterial?:string;
};
type Loft = Transform & Surface & {kind:'loft'; sections:readonly LoftSection[]; across?:XYZ; cuffMaterial?:string};
type Group = Transform & {kind:'group'; parts:readonly ModelPart[]};
export type ModelPart = Primitive | Profile | Loft | Group;

const octagon:readonly XY[]=[[1,.64],[.64,1],[-.64,1],[-1,.64],[-1,-.64],[-.64,-1],[.64,-1],[1,-.64]];

export type ModelRecipe = {
  materials:Readonly<Record<string,number>>;
  parts:readonly ModelPart[];
};

export class ModelParts {
  private customGeometry = new Map<Profile|Loft,T.BufferGeometry>();

  constructor(private primitives:Record<'box'|'barrel',T.BufferGeometry>,
    private material:(color:number)=>T.Material) {}

  build(recipe:ModelRecipe, showHands=false) {
    const root=new T.Group();
    const nodes=new Map<string,T.Object3D>();
    const add=(host:T.Object3D,parts:readonly ModelPart[]) => {
      for (const part of parts) {
        if (part.hand && !showHands) continue;
        let node:T.Object3D;
        if (part.kind==='group') {
          node=new T.Group();
          add(node,part.parts);
        } else {
          const color=recipe.materials[part.material];
          if (color===undefined) throw new Error(`Unknown material ${part.material} for ${part.name}`);
          const geometry=part.kind==='profile' ? this.profile(part) :
            part.kind==='loft' ? this.loft(part) : this.primitives[part.kind];
          const face=this.material(color);
          const trim=part.kind==='profile' ? part.rimMaterial : part.kind==='loft' ? part.cuffMaterial : undefined;
          const mesh=new T.Mesh(geometry,trim===undefined ? face : [face,this.material(recipe.materials[trim])]);
          if (part.kind==='box' || part.kind==='barrel') mesh.scale.set(...part.size);
          mesh.castShadow=true;
          mesh.receiveShadow=true;
          node=mesh;
          if (part.kind==='profile' && part.sideOffset!==undefined) {
            const pair=new T.Group(), opposite=mesh.clone();
            mesh.name=opposite.name=part.name;
            mesh.position.x=part.sideOffset;
            opposite.position.x=-part.sideOffset;
            pair.add(mesh,opposite);
            node=pair;
          }
        }
        node.name=part.name;
        if (nodes.has(part.name)) throw new Error(`Duplicate model part: ${part.name}`);
        nodes.set(part.name,node);
        if (part.at) node.position.set(...part.at);
        if (part.rotation) node.rotation.set(...part.rotation);
        host.add(node);
      }
    };
    add(root,recipe.parts);
    return {root,nodes};
  }

  private profile(part:Profile) {
    const cached=this.customGeometry.get(part);
    if (cached) return cached;
    const shape=new T.Shape(part.outline.map(([u,v])=>new T.Vector2(u,v)));
    const bevel=part.bevel ?? 0;
    const depth=part.edgeDepth ?? part.depth-bevel*2;
    const geometry=new T.ExtrudeGeometry(shape,{
      depth, steps:1, bevelEnabled:bevel>0, bevelThickness:(part.depth-depth)/2,
      bevelSize:bevel, bevelSegments:1,
      // Tapered profiles use the editable contour as the thin rim and inset the thicker faces.
      bevelOffset:part.edgeDepth===undefined ? 0 : -bevel,
    });
    // Side-view contours use forward/up. Extrusion becomes the sideways thickness.
    geometry.translate(0,0,-depth/2);
    geometry.rotateY(Math.PI/2);
    this.customGeometry.set(part,geometry);
    return geometry;
  }

  private loft(part:Loft) {
    const cached=this.customGeometry.get(part);
    if (cached) return cached;
    const centers=part.sections.map(([x,y,z])=>new T.Vector3(x,y,z));
    const across=new T.Vector3(...(part.across ?? [1,0,0])).normalize();
    const rings=part.sections.map(([, , , width,depth],i)=>{
      const tangent=centers[Math.min(i+1,centers.length-1)].clone()
        .sub(centers[Math.max(i-1,0)]).normalize();
      const normal=new T.Vector3().crossVectors(tangent,across);
      if (normal.lengthSq()<1e-8) {
        normal.crossVectors(tangent,Math.abs(tangent.y)<.9 ? new T.Vector3(0,1,0) : new T.Vector3(0,0,1));
      }
      normal.normalize();
      const side=new T.Vector3().crossVectors(normal,tangent);
      return octagon.map(([u,v])=>centers[i].clone().addScaledVector(side,u*width/2).addScaledVector(normal,v*depth/2));
    });
    const positions:number[]=[];
    const triangle=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>positions.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
    const geometry=new T.BufferGeometry();
    const last=rings.length-1;
    const cuffStart=last-2;
    const cap=(index:number,reverse:boolean)=>{
      const ring=rings[index];
      for (let j=0; j<ring.length; j++) {
        const a=ring[j],b=ring[(j+1)%ring.length];
        triangle(centers[index],reverse ? b : a,reverse ? a : b);
      }
    };
    cap(0,true);
    for (let i=0; i<last; i++) {
      if (part.cuffMaterial && i===cuffStart) geometry.addGroup(0,positions.length/3,0);
      for (let j=0; j<octagon.length; j++) {
        const next=(j+1)%octagon.length;
        const a=rings[i][j],b=rings[i][next],c=rings[i+1][j],d=rings[i+1][next];
        triangle(a,b,c);
        triangle(b,d,c);
      }
    }
    cap(last,false);
    if (part.cuffMaterial) {
      const offset=geometry.groups[0].count;
      geometry.addGroup(offset,positions.length/3-offset,1);
    }
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.computeVertexNormals();
    this.customGeometry.set(part,geometry);
    return geometry;
  }

  dispose() {
    this.customGeometry.forEach(geometry=>geometry.dispose());
    this.customGeometry.clear();
  }
}
