import type { ModelPart, ModelRecipe } from '../model-parts.ts';
import type { WeaponRecipe } from './weapons.ts';
import type { WeaponId } from '../data.ts';

export type EditableModelId=WeaponId|'knife';
type Mutable<T>={-readonly [K in keyof T]:Mutable<T[K]>};
export type EditablePart=Mutable<ModelPart>;
export type EditableRecipe=Mutable<ModelRecipe & Partial<Omit<WeaponRecipe,keyof ModelRecipe>>>;

const object=(value:unknown):value is Record<string,unknown> =>
  value!==null && typeof value==='object' && !Array.isArray(value);
const real=(value:unknown):value is number => typeof value==='number' && Number.isFinite(value);
const vector=(v:unknown,length:number):v is number[] => Array.isArray(v) && v.length===length && v.every(real);
const legacyHands=new Set(['support-hand','firing-hand','right-hand']);

export function parseModel(value:unknown,id:EditableModelId):EditableRecipe {
  if (!object(value) || !object(value.materials) || !Array.isArray(value.parts)) {
    throw new Error('配方需要包含材质表和部件列表。');
  }
  const materials=value.materials;
  if (!Object.entries(materials).every(([name,color]) =>
    name.trim() && Number.isInteger(color) && typeof color==='number' && color>=0 && color<=0xffffff)) {
    throw new Error('材质名不能为空，颜色须在 RGB 色值范围内。');
  }
  const names=new Set<string>();
  let hasLegacyViews=false;
  const visit=(part:unknown) => {
    if (!object(part) || typeof part.name!=='string' || !part.name.trim()) throw new Error('部件缺少名称。');
    const name=part.name;
    const fail=(message:string):never=>{ throw new Error(`${name} · ${message}`); };
    if (names.has(name)) fail('名称重复。');
    names.add(name);
    if (part.at!==undefined && !vector(part.at,3)) fail('位置需要三个数字。');
    if (part.rotation!==undefined && !vector(part.rotation,3)) fail('旋转需要三个数字。');
    if (part.view!==undefined) {
      if (part.view!=='external' && part.view!=='first-person') fail('视图类型无效。');
      hasLegacyViews=true;
    }
    if (part.hand!==undefined && part.hand!==true) fail('手部标记无效。');
    if (part.kind==='group') {
      if (!Array.isArray(part.parts)) fail('分组缺少部件列表。');
      for (const child of part.parts as unknown[]) visit(child);
    } else {
      if (typeof part.material!=='string' || !Object.hasOwn(materials,part.material)) fail('找不到指定材质。');
      if (part.kind==='box' || part.kind==='barrel') {
        if (!vector(part.size,3) || part.size.some(d=>d<=0)) fail('尺寸必须为正数。');
      } else if (part.kind==='loft') {
        const sections=part.sections;
        if (!Array.isArray(sections) || sections.length<2 ||
          !sections.every(s=>vector(s,5) && s[3]>0 && s[4]>0)) {
          fail('多面体需要至少两个有效截面，宽度和厚度须为正。');
        }
        const rings=sections as number[][];
        const coincident=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<1e-5;
        if (rings.some((s,i)=>i>0 && coincident(s,rings[i-1]) ||
          i>0 && i<rings.length-1 && coincident(rings[i-1],rings[i+1]))) {
          fail('相邻截面不能重合或立即折返。');
        }
        if (part.across!==undefined && (!vector(part.across,3) || Math.hypot(...part.across)<1e-5)) {
          fail('截面横向需要一个有效方向。');
        }
        if (part.cuffMaterial!==undefined &&
          (rings.length<4 || typeof part.cuffMaterial!=='string' || !Object.hasOwn(materials,part.cuffMaterial))) {
          fail('袖口需要至少四个截面和有效的材质。');
        }
      } else if (part.kind==='profile') {
        if (!Array.isArray(part.outline) || part.outline.length<3 || !part.outline.every(p=>vector(p,2))) {
          fail('轮廓需要至少三个有效点。');
        }
        const points=part.outline as number[][];
        const area=points.reduce((sum,[u,v],i)=>{
          const [nextU,nextV]=points[(i+1)%points.length];
          return sum+u*nextV-v*nextU;
        },0);
        if (Math.abs(area)<1e-9) fail('轮廓面积为零。');
        const bevel=part.bevel ?? 0;
        if (!real(part.depth) || part.depth<=0 || !real(bevel) || bevel<0) {
          fail('厚度必须为正，倒角须为非负数。');
        }
        if (part.edgeDepth!==undefined) {
          if (!real(part.edgeDepth) || part.edgeDepth<=0 || part.edgeDepth>=Number(part.depth) || Number(bevel)<=0) {
            fail('刃口厚度必须大于零且小于主体厚度，刃面宽度必须为正。');
          }
        } else if (Number(bevel)*2>=Number(part.depth)) {
          fail('厚度必须为正，倒角需要小于厚度的一半。');
        }
        if (part.sideOffset!==undefined && (!real(part.sideOffset) || part.sideOffset<=0)) {
          fail('双侧间距必须为正。');
        }
        if (part.rimMaterial!==undefined &&
          (typeof part.rimMaterial!=='string' || !Object.hasOwn(materials,part.rimMaterial))) {
          fail('找不到指定边缘材质。');
        }
      } else fail('部件类型无效。');
    }
  };
  for (const part of value.parts) visit(part);
  if (id!=='knife') {
    if (typeof value.concept!=='string' || !vector(value.muzzle,3) || !real(value.sightHeight) ||
      (value.viewDepth!==undefined && !real(value.viewDepth))) throw new Error('武器配方缺少有效的预览或持枪参数。');
    if (value.motion!==undefined && (!object(value.motion) || typeof value.motion.part!=='string' ||
      !names.has(value.motion.part) || !vector(value.motion.travel,3))) throw new Error('泵柄动画部件或行程无效。');
  } else if (value.muzzle!==undefined || value.motion!==undefined || value.sightHeight!==undefined) {
    throw new Error('当前选择的是小刀，请导入小刀配方。');
  }
  const recipe=value as unknown as EditableRecipe;
  if (!hasLegacyViews) return recipe;
  const sharedStock=id==='p12' && recipe.parts.some(part=>part.name==='stock');
  function migrate(parts:EditablePart[]):EditablePart[] {
    return parts.filter(part=>{
      const legacy=part as EditablePart & {view?:'external'|'first-person'};
      if (sharedStock && legacy.view==='first-person' && part.kind==='profile' &&
        part.name==='stock-neck' && recipe.motion?.part!==part.name) return false;
      if (legacy.view==='first-person' && legacyHands.has(part.name)) part.hand=true;
      delete legacy.view;
      if (part.kind==='group') part.parts=migrate(part.parts);
      return true;
    });
  }
  recipe.parts=migrate(recipe.parts);
  return recipe;
}
