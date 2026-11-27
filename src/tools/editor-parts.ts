import type { EditablePart } from '../models/format.ts';

export function findPart(parts:EditablePart[],name:string):{part:EditablePart;list:EditablePart[];index:number}|undefined {
  for (const [index,part] of parts.entries()) {
    if (part.name===name) return {part,list:parts,index};
    if (part.kind==='group') {
      const found=findPart(part.parts,name);
      if (found) return found;
    }
  }
}

export function listNames(parts:EditablePart[],names=new Set<string>()) {
  for (const part of parts) {
    names.add(part.name);
    if (part.kind==='group') listNames(part.parts,names);
  }
  return names;
}

export function uniqueName(names:Set<string>,stem:string) {
  let name=stem;
  for (let n=2;names.has(name);n++) name=`${stem}-${n}`;
  names.add(name);
  return name;
}

export function duplicatePart(part:EditablePart,names:Set<string>):EditablePart {
  const copy=structuredClone(part);
  const rename=(node:EditablePart) => {
    node.name=uniqueName(names,node.name+'-copy');
    if (node.kind==='group') node.parts.forEach(rename);
  };
  rename(copy);
  return copy;
}

export const stringifyModel=(model:unknown) => JSON.stringify(model,null,2)
  .replace(/\[\s*(-?[\d.eE+-]+(?:\s*,\s*-?[\d.eE+-]+)+)\s*\]/g,
    (_whole,values:string)=>'['+values.split(',').map(value=>value.trim()).join(', ')+']')+'\n';
