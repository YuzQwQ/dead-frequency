import type { ModelRecipe } from '../model-parts.ts';
import { parseModel } from './format.ts';
import source from './knife.json' with { type:'json' };

export const knifeRecipe:ModelRecipe=parseModel(source,'knife');
