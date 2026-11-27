import './editor.css';
import p12 from '../models/p12.json' with { type:'json' };
import ar56 from '../models/ar56.json' with { type:'json' };
import k9 from '../models/k9.json' with { type:'json' };
import knife from '../models/knife.json' with { type:'json' };
import p12Drawing from '../../art/p12-reference.svg?url';
import ar56Drawing from '../../art/m4a1-reference.svg?url';
import k9Drawing from '../../art/glock17-reference.svg?url';
import knifeDrawing from '../../art/knife-reference.svg?url';
import { parseModel } from '../models/format.ts';
import type { EditableModelId, EditablePart, EditableRecipe } from '../models/format.ts';
import { EditorViewport } from './editor-viewport.ts';
import type { Angle, Tool } from './editor-viewport.ts';
import { duplicatePart, findPart, listNames, stringifyModel, uniqueName } from './editor-parts.ts';

const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const source={p12,ar56,k9,knife};
const defaultPart={p12:'receiver',ar56:'receiver',k9:'slide',knife:'blade'};
const reference={p12:p12Drawing,ar56:ar56Drawing,k9:k9Drawing,knife:knifeDrawing};
const isModelId=(value:string|null):value is EditableModelId=>value!==null && Object.hasOwn(source,value);
const names={box:'方盒',barrel:'八边圆柱',profile:'挤出轮廓',loft:'八边截面体',group:'分组'};
const labels:Record<string,string>={
  stock:'枪托',heel:'托底',comb:'枪托上缘',grip:'握把','grip-heel':'握把尾部',
  receiver:'机匣','receiver-top':'机匣上缘','right-recess':'右侧凹面','right-inset-face':'右侧内衬','left-panel':'左侧面板',
  'forward-tube':'枪管','lower-tube':'下方管身','fore-collar':'前接环','muzzle-band':'枪口外缘','muzzle-shadow':'枪口暗面',
  'top-rib':'顶轨','sight-marker':'前准星',pump:'泵柄','pump-wood':'泵柄木件','pump-comb':'泵柄上缘','pump-band':'泵柄束带',
  'support-hand':'支撑手','firing-hand':'持枪手','right-hand':'持刀手',blade:'刀身',
  'left-hand':'左手','left-sleeve':'左臂与袖口','left-mitt':'左手掌部与四指','left-thumb':'左拇指',
  'fingers-base':'四指第一节','fingers-middle':'四指第二节','fingers-tip':'四指第三节',
  'support-sleeve':'支撑臂与袖口','grip-sleeve':'持枪臂与袖口','support-glove':'支撑手套','grip-glove':'持枪手套',
  'support-thumb':'拇指','grip-thumb':'拇指','sleeve':'手臂与袖口','mitt':'掌部与四指',
  'blade-channel':'刀面槽纹','handle-pin':'握柄铆钉','tail-mark':'橙色尾标',
  'barrel-assembly':'枪管组件','handguard-assembly':'护木组件','receiver-assembly':'机匣组件',
  'carry-handle':'提把','magazine-assembly':'弹匣组件','magazine':'弹匣','grip-assembly':'握把与扳机',
  'stock-assembly':'枪托组件','front-sight-frame':'三角准星','handguard':'护木',
  'slide-assembly':'套筒组件',slide:'套筒','slide-window':'抛壳口','grip-panel':'握把侧面','grip-base':'握把底板',
  guard:'护手',handle:'握柄','spine-mark':'橙色识别块',palm:'掌部',thumb:'拇指',knuckles:'指关节',wrist:'手腕',forearm:'前臂',
};
const axes=['X','Y','Z'];
const format=(n:number)=>Number(n.toFixed(5));
const degrees=(n:number)=>format(n*180/Math.PI);
const html=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]!);
const option=(value:string,label:string,selected:string)=>`<option value="${html(value)}" ${value===selected?'selected':''}>${html(label)}</option>`;
type FileHandle={name:string; getFile():Promise<File>; createWritable():Promise<{write(data:string):Promise<void>;close():Promise<void>;abort():Promise<void>}>};
const picker=(window as Window & {showOpenFilePicker?:(options:object)=>Promise<FileHandle[]>}).showOpenFilePicker;
type ViewportInputs={angle:Angle;pose:number};

const asset=byId<HTMLSelectElement>('asset');
const tree=byId('tree');
const props=byId('properties');
const filter=byId<HTMLInputElement>('filter');
const file=byId<HTMLInputElement>('file');
const pose=byId<HTMLInputElement>('pose');
const view=byId<HTMLSelectElement>('view');
const angle=byId<HTMLSelectElement>('angle');
const dialog=byId<HTMLDialogElement>('reference-dialog');
const status=byId('status');
const viewHelp=document.querySelector<HTMLElement>('.view-help')!;
const getButton=(action:string)=>document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

const requested=new URLSearchParams(location.search).get('weapon');
let id:EditableModelId=isModelId(requested) ? requested : 'p12';
let model:EditableRecipe;
let selected:string|undefined;
let point=0;
let section=0;
let past:EditableRecipe[]=[];
let future:EditableRecipe[]=[];
let linkedFile:{handle:FileHandle;contents:string}|undefined;
let inputs:ViewportInputs={angle:'perspective',pose:0};
let viewport:EditorViewport;
let dragging:undefined|{
  svg:SVGSVGElement; id:number; name:string; index:number; scale:number;
  minU:number; maxV:number; padX:number; padY:number; points:[number,number][];
};

function report(message:string,error=false) {
  status.textContent=message;
  status.classList.toggle('error',error);
}

const draftKey=()=>`dead-frequency.model-editor.v1.${id}`;
function saveDraft(message:string) {
  try {
    localStorage.setItem(draftKey(),JSON.stringify(model));
    report(message);
  } catch {
    report('草稿无法写入浏览器，请用「导出 JSON」保存。',true);
  }
}

function loadAsset(next:EditableModelId) {
  id=next;
  asset.value=id;
  model=parseModel(structuredClone(source[id]),id);
  let restored=false;
  let invalidDraft=false;
  try {
    const draft=localStorage.getItem(draftKey());
    if (draft) { model=parseModel(JSON.parse(draft),id); restored=true; }
  } catch { invalidDraft=true; }
  past=[];
  future=[];
  linkedFile=undefined;
  selected=findPart(model.parts,defaultPart[id]) ? defaultPart[id] : model.parts[0]?.name;
  point=0;
  inputs.pose=0;
  pose.value='0';
  filter.value='';
  drawModel(true);
  report(invalidDraft ? '草稿无法读取，已打开随编辑器附带的配方。'
    : restored ? '已恢复此模型的本地草稿。' : '已打开模型。',invalidDraft);
}

function checkpoint(next:EditableRecipe,message='本地草稿已保存。') {
  parseModel(next,id);
  if (JSON.stringify(next)===JSON.stringify(model)) return false;
  past.push(model);
  if (past.length>48) past.shift();
  model=next;
  future=[];
  saveDraft(message);
  return true;
}

function change(update:(draft:EditableRecipe)=>void,selection=selected) {
  try {
    const draft=structuredClone(model);
    update(draft);
    if (checkpoint(draft)) {
      selected=selection;
      drawModel();
    }
  } catch (error) {
    report(error instanceof Error ? error.message : String(error),true);
    drawProperties();
  }
}

function history(direction:'undo'|'redo') {
  const from=direction==='undo' ? past : future;
  const to=direction==='undo' ? future : past;
  const next=from.pop();
  if (!next) return;
  to.push(model);
  model=next;
  saveDraft(direction==='undo' ? '已撤销。' : '已重做。');
  drawModel();
}

function selectPart(name:string|undefined) {
  selected=name;
  point=0;
  section=0;
  if (name && !viewport.hasPart(name)) {
    view.value='with-hands';
    drawModel();
    return;
  }
  viewport.select(selected);
  drawTree();
  drawProperties();
}

function drawModel(fit=false,revealSelection=true) {
  if (selected && !findPart(model.parts,selected)) selected=model.parts[0]?.name;
  viewport.setModel(model,view.value==='with-hands');
  if (selected && !viewport.hasPart(selected)) {
    if (revealSelection) {
      view.value='with-hands';
      viewport.setModel(model,true);
    } else selected=undefined;
  }
  viewport.select(selected);
  if (fit) viewport.angle(inputs.angle);
  byId('pose-control').hidden=!model.motion;
  updateViewHelp();
  byId('target-file').textContent=linkedFile ? `已关联 ${linkedFile.handle.name}` : `src/models/${id}.json`;
  byId('write-file').hidden=!linkedFile;
  byId('view-caption').textContent=`${angle.selectedOptions[0]?.textContent} · ${view.selectedOptions[0]?.textContent}`;
  getButton('undo').disabled=!past.length;
  getButton('redo').disabled=!future.length;
  drawTree();
  drawProperties();
}

function drawTree() {
  byId('count').textContent=String(listNames(model.parts).size);
  const term=filter.value.trim().toLowerCase();
  const rows=(parts:EditablePart[],depth:number):string => parts.map(part=>{
    const children=part.kind==='group' ? rows(part.parts,depth+1) : '';
    const label=Object.hasOwn(labels,part.name) ? labels[part.name] : part.name;
    if (term && !part.name.toLowerCase().includes(term) && !label.toLowerCase().includes(term) && !children) return '';
    return `<button class="tree-row" data-part="${html(part.name)}" aria-current="${selected===part.name}" style="--indent:${depth}" title="${html(part.name)}">
      <span class="part-icon ${part.kind}" aria-hidden="true">${part.kind==='group'?'+':''}</span>
      <span class="name">${html(label)}</span><small>${part.hand?'手部':''}</small></button>${children}`;
  }).join('');
  tree.innerHTML=rows(model.parts,0) || '<p class="empty">没有匹配的部件。</p>';
}

const input=(caption:string,value:number,attr:string)=>`<label class="field">${caption}<input aria-label="${caption}" type="number" step=".001" ${attr} value="${format(value)}"></label>`;
const coords=(label:string,field:string,values:readonly number[])=>`<p class="help">${label}</p>
  <div class="coords">${values.map((value,axis)=>`<label><span class="axis axis-${axes[axis].toLowerCase()}">${axes[axis]}</span>
    <input aria-label="${label} ${axes[axis]}" type="number" step="${field==='rotation'?'1':'.001'}" data-vector="${field}" data-axis="${axis}" value="${format(value)}"></label>`).join('')}</div>`;
const colorHex=(color:number)=>'#'+color.toString(16).padStart(6,'0');

function contourFit(outline:[number,number][]) {
  const u=outline.map(p=>p[0]),v=outline.map(p=>p[1]);
  const minU=Math.min(...u),maxV=Math.max(...v);
  const width=Math.max(.0001,Math.max(...u)-minU),height=Math.max(.0001,maxV-Math.min(...v));
  const scale=Math.min(216/width,102/height);
  return {scale,minU,maxV,padX:(240-width*scale)/2,padY:(126-height*scale)/2};
}

function plot(outline:[number,number][]) {
  return `<svg class="contour" viewBox="0 0 240 126" aria-label="拖动以编辑轮廓点">
    <polygon></polygon>${outline.map((_,i)=>`<circle data-point="${i}" r="5"></circle>`).join('')}</svg>`;
}

function paintPlot(svg:SVGSVGElement,outline:[number,number][],fit=contourFit(outline)) {
  const points=outline.map(([u,v])=>[fit.padX+(u-fit.minU)*fit.scale,fit.padY+(fit.maxV-v)*fit.scale]);
  svg.querySelector('polygon')!.setAttribute('points',points.map(pair=>pair.join(',')).join(' '));
  svg.querySelectorAll('circle').forEach((circle,i)=>{
    circle.setAttribute('cx',String(points[i][0]));
    circle.setAttribute('cy',String(points[i][1]));
    circle.classList.toggle('selected',i===point);
  });
}

function contourFields(part:Extract<EditablePart,{kind:'profile'}>) {
  point=Math.min(point,part.outline.length-1);
  return `<section class="contour-section"><h3 class="part-title">侧面轮廓</h3>${plot(part.outline)}
    <div class="coords point-fields">${part.outline[point].map((n,i)=>`<label>${i===0?'前向 U':'向上 V'}
      <input aria-label="${i===0?'前向 U':'向上 V'}" data-point-axis="${i}" type="number" step=".001" value="${format(n)}"></label>`).join('')}</div>
    <div class="contour-controls"><button data-action="add-point">插入点</button><button data-action="drop-point" ${part.outline.length<=3?'disabled':''}>删除点</button></div></section>`;
}

function drawProperties() {
  const part=selected ? findPart(model.parts,selected)?.part : undefined;
  byId('part-kind').textContent=part ? names[part.kind] : '';
  if (!part) { props.innerHTML='<p class="empty">从视口或部件列表选择一个部件。</p>';return; }
  props.innerHTML=`<section class="name-block"><label>名称<input id="part-name" value="${html(part.name)}"></label></section>
    <section class="fields"><h3 class="part-title">变换</h3>
      ${coords('位置','at',part.at ?? [0,0,0])}
      ${coords('旋转°','rotation',(part.rotation ?? [0,0,0]).map(degrees))}
      <label class="field">部件归属<select id="part-layer">
        ${option('','随上级（根部件为武器）',part.hand?'hand':'')}${option('hand','手部',part.hand?'hand':'')}
      </select></label>
      ${part.kind==='box'||part.kind==='barrel' ? coords('尺寸','size',part.size) : ''}
      ${part.kind==='profile' ? `<div class="stacked">${input(part.edgeDepth!==undefined?'主体厚度':'厚度',part.depth,'data-dimension="depth"')}
        ${part.edgeDepth!==undefined
          ? input('刃面宽度',part.bevel??0,'data-dimension="bevel"')+input('刃口厚度',part.edgeDepth,'data-dimension="edgeDepth"')
          : input('倒角',part.bevel??0,'data-dimension="bevel"')}
        ${part.sideOffset!==undefined ? input('距中线',part.sideOffset,'data-dimension="sideOffset"') : ''}</div>` : ''}
    </section>
    ${part.kind==='group' ? '' : `<section class="fields"><h3 class="part-title">材质</h3><div class="palette">
      <select id="material" aria-label="材质">${Object.keys(model.materials).map(name=>option(name,name,part.material)).join('')}</select>
      <input id="swatch" aria-label="材质颜色" type="color" value="${colorHex(model.materials[part.material])}">
      </div>
      ${part.kind==='profile' ? `<label class="field">边缘材质<select id="rim-material">
        ${option('','与主体相同',part.rimMaterial??'')}${Object.keys(model.materials).map(name=>option(name,name,part.rimMaterial??'')).join('')}
      </select></label>` : ''}
      <p class="help">同名材质共享颜色。</p><button data-action="copy-material">复制为独立材质</button></section>`}
    ${part.kind==='profile' ? contourFields(part) : ''}
    ${part.kind==='loft' ? loftFields(part) : ''}
    <div class="part-actions"><button data-action="duplicate">复制部件</button><button class="danger" data-action="delete">删除部件</button></div>`;
  if (part.kind==='profile') paintPlot(props.querySelector<SVGSVGElement>('.contour')!,part.outline);
}

function loftFields(part:Extract<EditablePart,{kind:'loft'}>) {
  section=Math.min(section,part.sections.length-1);
  const labels=['截面 X','截面 Y','截面 Z','截面宽度','截面厚度'];
  return `<section class="fields"><h3 class="part-title">截面</h3>
    <label class="field">当前截面<select id="loft-section">
      ${part.sections.map((_,i)=>option(String(i),String(i+1),String(section))).join('')}
    </select></label>
    <div class="stacked">${part.sections[section].map((value,i)=>input(labels[i],value,`data-section-axis="${i}"`)).join('')}</div>
    ${part.sections.length>=4 ? `<label class="field">袖口材质<select id="cuff-material">
      ${option('','与主体相同',part.cuffMaterial??'')}${Object.keys(model.materials).map(name=>option(name,name,part.cuffMaterial??'')).join('')}
    </select></label>` : ''}</section>`;
}

function patchPart(update:(part:EditablePart,draft:EditableRecipe)=>void,nextName=selected) {
  if (!selected) return;
  const name=selected;
  change(draft=>update(findPart(draft.parts,name)!.part,draft),nextName);
}

function addPart() {
  const kind=byId<HTMLSelectElement>('new-kind').value as EditablePart['kind'];
  const name=uniqueName(listNames(model.parts),kind);
  const material=Object.keys(model.materials)[0] ?? 'default';
  let part:EditablePart;
  if (kind==='group') part={name,kind,parts:[]};
  else if (kind==='profile') part={name,kind,material,depth:.05,bevel:.005,outline:[[-.11,-.04],[.11,-.04],[.11,.04],[-.11,.04]]};
  else if (kind==='loft') part={name,kind,material,sections:[[0,0,0,.12,.10],[0,0,-.10,.10,.08],[0,0,-.18,.075,.058],[0,0,-.20,.07,.05]]};
  else part={name,kind,material,size:kind==='box' ? [.10,.10,.16] : [.09,.16,.09]};
  const parent=selected && findPart(model.parts,selected)?.part;
  const group=parent && parent.kind==='group' ? parent.name : undefined;
  change(draft=>{
    if (!Object.hasOwn(draft.materials,material)) draft.materials[material]=0x9b9d89;
    const target=group ? findPart(draft.parts,group)?.part : undefined;
    (target?.kind==='group' ? target.parts : draft.parts).push(part);
  },name);
}

function duplicate() {
  const current=selected ? findPart(model.parts,selected) : undefined;
  if (!current) return;
  const part=duplicatePart(current.part,listNames(model.parts));
  const at=part.at ?? [0,0,0];
  part.at=[format(at[0]+.05),at[1],at[2]];
  change(draft=>{
    const match=findPart(draft.parts,current.part.name)!;
    match.list.splice(match.index+1,0,part);
  },part.name);
}

function remove() {
  const current=selected ? findPart(model.parts,selected) : undefined;
  if (!current) return;
  if (model.motion && findPart([current.part],model.motion.part)) {
    report('该部件包含泵柄动画节点，请保留此节点以便预览和游玩。',true);
    return;
  }
  change(draft=>{
    const match=findPart(draft.parts,current.part.name)!;
    match.list.splice(match.index,1);
  });
}

function pointAction(action:string) {
  patchPart(part=>{
    if (part.kind!=='profile') return;
    if (action==='add-point') {
      const a=part.outline[point],b=part.outline[(point+1)%part.outline.length];
      part.outline.splice(point+1,0,[format((a[0]+b[0])/2),format((a[1]+b[1])/2)]);
      point++;
    } else if (part.outline.length>3) part.outline.splice(point,1);
  });
}

function changeField(target:HTMLInputElement|HTMLSelectElement) {
  const {vector,axis,dimension,pointAxis,sectionAxis}=target.dataset;
  const number=target instanceof HTMLInputElement ? target.valueAsNumber : NaN;
  if (target.id==='part-name') {
    const name=target.value.trim();
    if (!name) { report('请输入部件名称。',true);drawProperties();return; }
    patchPart((part,draft)=>{
      if (draft.motion?.part===part.name) draft.motion.part=name;
      part.name=name;
    },name);
  } else if (target.id==='part-layer') {
    patchPart(part=>{
      if (target.value==='hand') part.hand=true;
      else delete part.hand;
    });
  } else if (target.id==='material') patchPart(part=>{if (part.kind!=='group') part.material=target.value;});
  else if (target.id==='rim-material') patchPart(part=>{
    if (part.kind!=='profile') return;
    if (target.value) part.rimMaterial=target.value;
    else delete part.rimMaterial;
  });
  else if (target.id==='loft-section') {
    section=Number(target.value);
    drawProperties();
  } else if (target.id==='cuff-material') patchPart(part=>{
    if (part.kind!=='loft') return;
    if (target.value) part.cuffMaterial=target.value;
    else delete part.cuffMaterial;
  });
  else if (sectionAxis!==undefined) patchPart(part=>{
    if (part.kind==='loft') part.sections[section][Number(sectionAxis)]=number;
  });
  else if (target.id==='swatch') patchPart((part,draft)=>{
    if (part.kind!=='group') draft.materials[part.material]=parseInt(target.value.slice(1),16);
  });
  else if (axis!==undefined && (vector==='at'||vector==='rotation'||vector==='size')) {
    patchPart(part=>{
      const index=Number(axis) as 0|1|2;
      if (vector==='size') {
        if (part.kind==='box'||part.kind==='barrel') part.size[index]=number;
      } else {
        const values=part[vector] ?? [0,0,0];
        values[index]=vector==='rotation' ? number*Math.PI/180 : number;
        part[vector]=values;
      }
    });
  } else if (dimension==='depth'||dimension==='bevel'||dimension==='edgeDepth'||dimension==='sideOffset') patchPart(part=>{
    if (part.kind==='profile') part[dimension]=number;
  });
  else if (pointAxis!==undefined) patchPart(part=>{
    if (part.kind==='profile') part.outline[point][Number(pointAxis) as 0|1]=number;
  });
}

async function readFile(imported:File,fileHandle?:FileHandle) {
  try {
    const basename=imported.name.replace(/\.json$/i,'');
    const next=isModelId(basename) ? basename : id;
    const contents=await imported.text();
    const parsed=parseModel(JSON.parse(contents),next);
    if (next!==id) loadAsset(next);
    checkpoint(parsed,`已打开 ${imported.name}。`);
    selected=findPart(model.parts,defaultPart[id]) ? defaultPart[id] : model.parts[0]?.name;
    linkedFile=fileHandle ? {handle:fileHandle,contents} : undefined;
    inputs.pose=0;
    pose.value='0';
    drawModel(true);
    report(fileHandle ? `已关联 ${imported.name}，点击「写回文件」才会覆盖它。` : `已导入 ${imported.name}。`);
  } catch (error) { report(error instanceof Error ? error.message : String(error),true); }
}

async function openModel() {
  if (picker) {
    try {
      const [picked]=await picker.call(window,{types:[{description:'模型配方',accept:{'application/json':['.json']}}]});
      if (picked) await readFile(await picked.getFile(),picked);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name==='AbortError') return;
    }
  }
  file.click();
}

function exportModel() {
  const url=URL.createObjectURL(new Blob([stringifyModel(model)],{type:'application/json'}));
  const download=document.createElement('a');
  download.href=url;
  download.download=id+'.json';
  download.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),5000);
  report(`已导出 ${id}.json。可替换 src/models/ 下的同名配方。`);
}

async function writeFile() {
  const target=linkedFile;
  if (!target) return;
  const contents=stringifyModel(model);
  let writable:Awaited<ReturnType<FileHandle['createWritable']>>|undefined;
  try {
    const onDisk=await (await target.handle.getFile()).text();
    if (onDisk!==target.contents) {
      report('源文件已在编辑器外改动。请先导出草稿，或重新打开源文件。',true);
      return;
    }
    writable=await target.handle.createWritable();
    await writable.write(contents);
    await writable.close();
    target.contents=contents;
    report(`已写回 ${target.handle.name}。`);
  } catch {
    await writable?.abort().catch(()=>{});
    report('写回被取消或未能完成，可以使用「导出 JSON」。',true);
  }
}

function bind() {
  asset.addEventListener('change',()=>loadAsset(asset.value as EditableModelId));
  filter.addEventListener('input',drawTree);
  props.addEventListener('change',event=>changeField(event.target as HTMLInputElement|HTMLSelectElement));
  file.addEventListener('change',()=>{
    const imported=file.files?.[0];
    if (imported) void readFile(imported);
    file.value='';
  });
  angle.addEventListener('change',()=>{
    inputs.angle=angle.value as Angle;
    viewport.angle(inputs.angle);
    byId('view-caption').textContent=`${angle.selectedOptions[0].textContent} · ${view.selectedOptions[0].textContent}`;
  });
  view.addEventListener('change',()=>{
    drawModel(false,false);
  });
  pose.addEventListener('input',()=>{
    inputs.pose=Number(pose.value);
    viewport.setPose(inputs.pose);
    updateViewHelp();
  });
  document.addEventListener('click',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.part) selectPart(button.dataset.part);
    if (button.dataset.tool) setTool(button.dataset.tool as Tool);
    const action=button.dataset.action;
    switch (action) {
      case 'fit': viewport.fit();break;
      case 'undo':case 'redo':history(action);break;
      case 'import':void openModel();break;
      case 'export':exportModel();break;
      case 'write':void writeFile();break;
      case 'add':addPart();break;
      case 'duplicate':duplicate();break;
      case 'delete':remove();break;
      case 'add-point':case 'drop-point':pointAction(action);break;
      case 'copy-material':patchPart((part,draft)=>{
        if (part.kind==='group') return;
        const name=uniqueName(new Set(Object.keys(draft.materials)),part.material+'-copy');
        draft.materials[name]=draft.materials[part.material];
        part.material=name;
      });break;
      case 'reset':
        if (confirm('恢复编辑器附带的配方？此操作可撤销。')) {
          checkpoint(parseModel(structuredClone(source[id]),id),'已恢复原配方。');
          drawModel(true);
        }
        break;
      case 'reference':byId<HTMLImageElement>('reference-image').src=reference[id];dialog.showModal();break;
      case 'close-reference':dialog.close();break;
    }
  });
  document.addEventListener('keydown',event=>{
    if (dialog.open || (event.target as Element).closest('input,select,textarea')) return;
    if ((event.ctrlKey||event.metaKey) && ['KeyZ','KeyY'].includes(event.code)) {
      event.preventDefault();
      history(event.shiftKey||event.code==='KeyY'?'redo':'undo');
    } else if (event.code==='KeyW') setTool('translate');
    else if (event.code==='KeyE') setTool('rotate');
    else if (event.code==='KeyF') viewport.fit();
  });
  props.addEventListener('pointerdown',event=>{
    const circle=(event.target as Element).closest<SVGCircleElement>('circle[data-point]');
    const svg=circle?.ownerSVGElement;
    const part=selected ? findPart(model.parts,selected)?.part : undefined;
    if (!circle || !svg || part?.kind!=='profile' || event.button!==0) return;
    point=Number(circle.dataset.point);
    dragging={svg,id:event.pointerId,name:part.name,index:point,points:structuredClone(part.outline),...contourFit(part.outline)};
    svg.setPointerCapture(event.pointerId);
    paintPlot(svg,dragging.points,dragging);
    writePointFields(dragging.points[point]);
  });
  props.addEventListener('pointermove',event=>{
    const track=dragging;
    if (!track || track.id!==event.pointerId) return;
    const matrix=track.svg.getScreenCTM();
    if (!matrix) return;
    const at=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    track.points[track.index]=[format((at.x-track.padX)/track.scale+track.minU),format(track.maxV-(at.y-track.padY)/track.scale)];
    paintPlot(track.svg,track.points,track);
    writePointFields(track.points[track.index]);
  });
  props.addEventListener('pointerup',event=>{
    const track=dragging;
    if (!track || track.id!==event.pointerId) return;
    dragging=undefined;
    change(draft=>{
      const part=findPart(draft.parts,track.name)?.part;
      if (part?.kind==='profile') part.outline=track.points;
    });
  });
  props.addEventListener('pointercancel',()=>{dragging=undefined;drawProperties();});
}

function writePointFields(values:[number,number]) {
  props.querySelectorAll<HTMLInputElement>('[data-point-axis]').forEach((field,i)=>{field.value=String(values[i]);});
}

function updateViewHelp() {
  viewHelp.textContent=inputs.pose>0
    ? '泵柄预览中 · 拉回零位即可用操作轴编辑'
    : '拖动空白处旋转 · 滚轮缩放 · 右键拖动平移';
}

function setTool(tool:Tool) {
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
  viewport.setTool(tool);
}

try {
  viewport=new EditorViewport(byId('viewport'),selectPart,(name,position,rotation)=>{
    if (!findPart(model.parts,name)) return;
    change(draft=>{
      const part=findPart(draft.parts,name)!.part;
      part.at=position.map(format) as typeof position;
      part.rotation=rotation.map(format) as typeof rotation;
    },name);
  });
  bind();
  loadAsset(id);
} catch (error) {
  report(error instanceof Error ? error.message : '无法启动三维编辑器。',true);
}
