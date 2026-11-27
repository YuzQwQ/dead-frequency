import type { WeaponId } from '../data.ts';
import type { ModelRecipe, XYZ } from '../model-parts.ts';
import { parseModel } from './format.ts';
import p12 from './p12.json' with { type:'json' };
import ar56 from './ar56.json' with { type:'json' };
import k9 from './k9.json' with { type:'json' };

export type WeaponRecipe = ModelRecipe & {
  concept:string;
  muzzle:XYZ;
  sightHeight:number;
  viewDepth?:number;
  motion?:{part:string; travel:XYZ};
};

export const weaponRecipes:Record<WeaponId,WeaponRecipe> = {
  p12:parseModel(p12,'p12') as WeaponRecipe,
  ar56:parseModel(ar56,'ar56') as WeaponRecipe,
  k9:parseModel(k9,'k9') as WeaponRecipe,
};
