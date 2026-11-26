import * as T from 'three';

export type XY = readonly [number, number];
export type XYZ = readonly [number, number, number];
type Transform = {name:string; at?:XYZ; rotation?:XYZ; view?:'first-person'|'external'};
type Surface = {material:string};
type Primitive = Transform & Surface & {kind:'box'|'barrel'; size:XYZ};
type Profile = Transform & Surface & {kind:'profile'; outline:readonly XY[]; depth:number; bevel?:number};
type Group = Transform & {kind:'group'; parts:readonly ModelPart[]};
export type ModelPart = Primitive | Profile | Group;

export type ModelRecipe = {
  materials:Readonly<Record<string,number>>;
  parts:readonly ModelPart[];
};

export class ModelParts {
  private outlines = new Map<Profile,T.BufferGeometry>();

  constructor(private primitives:Record<'box'|'barrel',T.BufferGeometry>,
    private material:(color:number)=>T.Material) {}

  build(recipe:ModelRecipe, viewmodel=false) {
    const root=new T.Group();
    const nodes=new Map<string,T.Object3D>();
    const view=viewmodel ? 'first-person' : 'external';
    const add=(host:T.Object3D,parts:readonly ModelPart[]) => {
      for (const part of parts) {
        if (part.view && part.view!==view) continue;
        let node:T.Object3D;
        if (part.kind==='group') {
          node=new T.Group();
          add(node,part.parts);
        } else {
          const color=recipe.materials[part.material];
          if (color===undefined) throw new Error(`Unknown material ${part.material} for ${part.name}`);
          const geometry=part.kind==='profile' ? this.profile(part) : this.primitives[part.kind];
          const mesh=new T.Mesh(geometry,this.material(color));
          if (part.kind!=='profile') mesh.scale.set(...part.size);
          mesh.castShadow=true;
          mesh.receiveShadow=true;
          node=mesh;
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
    const cached=this.outlines.get(part);
    if (cached) return cached;
    const shape=new T.Shape(part.outline.map(([u,v])=>new T.Vector2(u,v)));
    const bevel=part.bevel ?? 0;
    const depth=part.depth-bevel*2;
    const geometry=new T.ExtrudeGeometry(shape,{
      depth, steps:1, bevelEnabled:bevel>0, bevelThickness:bevel,
      bevelSize:bevel, bevelSegments:1,
    });
    // Side-view contours use forward/up. Extrusion becomes the sideways thickness.
    geometry.translate(0,0,-depth/2);
    geometry.rotateY(Math.PI/2);
    this.outlines.set(part,geometry);
    return geometry;
  }

  dispose() {
    this.outlines.forEach(geometry=>geometry.dispose());
    this.outlines.clear();
  }
}
