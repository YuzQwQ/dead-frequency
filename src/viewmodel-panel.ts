import type { KnifeViewModel, ViewModelConfig } from './knife-viewmodel.ts';
import { jointControls } from './knife-viewmodel.ts';
import './viewmodel-panel.css';

type Field={input:HTMLInputElement;read:(config:ViewModelConfig)=>number};
const transformFields=[
  ['root','整体'],['rightArm','右臂局部'],['wrist','手腕局部'],['itemSocket','ItemSocket 局部'],
] as const;
const axes=['X','Y','Z'] as const;

export class ViewModelPanel {
  private host=document.createElement('aside');
  private fields:Field[]=[];
  private pause=document.createElement('button');
  private walk=document.createElement('input');
  private guides=document.createElement('input');
  private status=document.createElement('p');
  get open() { return !this.host.hidden; }

  constructor(private rig:KnifeViewModel,onClose:()=>void) {
    this.host.className='viewmodel-panel';
    this.host.hidden=true;
    this.host.setAttribute('aria-label','ViewModel 调试');
    const title=document.createElement('h2');
    title.textContent='ViewModel 调试';
    const bar=document.createElement('header');
    const close=this.button('返回现场',onClose);
    close.title='F8 或 Esc';
    bar.append(title,close);
    this.host.append(bar);
    const optics=this.section('取景');
    this.field(optics,'ViewModel FOV',25,95,1,c=>c.fov,(c,v)=>{c.fov=v;});
    this.field(optics,'模型缩放',.25,2,.01,c=>c.scale,(c,v)=>{c.scale=v;});
    for (const [key,label] of transformFields) {
      const section=this.section(label);
      for (const kind of ['position','rotation'] as const) {
        const row=document.createElement('div');
        row.className='viewmodel-axes';
        const rotation=kind==='rotation';
        axes.forEach((axis,i)=>this.field(row,`${rotation?'旋转':'位置'} ${axis}`,rotation ? -180 : -3,
          rotation ? 180 : 3,rotation ? 1 : .005,c=>c[key][kind][i],(c,v)=>{c[key][kind][i]=v;}));
        section.append(row);
      }
    }
    const joints=this.section('右手关节');
    const angles=document.createElement('div');
    angles.className='viewmodel-axes';
    for (const [key,label,min,max] of jointControls) {
      this.field(angles,label+' °',min,max,1,c=>c.joints[key],(c,v)=>{c.joints[key]=v;});
    }
    joints.append(angles);
    this.guides.type='checkbox';
    this.guides.addEventListener('change',()=>this.rig.showJointAxes(this.guides.checked));
    const guideLabel=document.createElement('label');
    guideLabel.className='viewmodel-check';
    guideLabel.append(this.guides,'显示旋转轴');
    joints.append(guideLabel);
    const animation=this.section('动画预览');
    this.field(animation,'呼吸幅度',0,.05,.001,c=>c.animation.breathing,(c,v)=>{c.animation.breathing=v;});
    this.field(animation,'移动摆动幅度',0,.08,.001,c=>c.animation.sway,(c,v)=>{c.animation.sway=v;});
    this.walk.type='checkbox';
    this.walk.addEventListener('change',()=>{this.rig.simulateWalk=this.walk.checked;});
    const walkLabel=document.createElement('label');
    walkLabel.className='viewmodel-check';
    walkLabel.append(this.walk,'模拟步行');
    this.pause.type='button';
    this.pause.addEventListener('click',()=>{
      this.rig.config.animation.paused=!this.rig.config.animation.paused;
      this.sync();
    });
    animation.append(walkLabel,this.pause,this.button('回到静态',()=>{
      this.rig.freezeRest();
      this.sync();
    }));
    const actions=document.createElement('footer');
    actions.append(this.button('恢复默认',()=>{
      this.rig.reset();
      this.sync();
    }),this.button('导出 JSON',()=>this.export()));
    this.status.setAttribute('role','status');
    this.host.append(actions,this.status);
    document.body.append(this.host);
  }

  show() {
    this.host.hidden=false;
    this.status.textContent='';
    this.sync();
    this.host.querySelector('input')?.focus({preventScroll:true});
  }

  hide() {
    this.host.hidden=true;
    this.rig.simulateWalk=false;
    this.guides.checked=false;
    this.rig.showJointAxes(false);
  }

  dispose() { this.host.remove(); }

  private section(label:string) {
    const section=document.createElement('fieldset');
    const legend=document.createElement('legend');
    legend.textContent=label;
    section.append(legend);
    this.host.append(section);
    return section;
  }

  private field(parent:HTMLElement,label:string,min:number,max:number,step:number,
    read:Field['read'],write:(config:ViewModelConfig,value:number)=>void) {
    const container=document.createElement('label');
    container.append(label);
    const input=document.createElement('input');
    input.type='number';
    input.min=String(min);
    input.max=String(max);
    input.step=String(step);
    input.addEventListener('input',()=>{
      if (!Number.isFinite(input.valueAsNumber)) return;
      write(this.rig.config,Math.max(min,Math.min(max,input.valueAsNumber)));
      this.rig.apply();
    });
    input.addEventListener('change',()=>{input.value=this.formatted(read(this.rig.config));});
    container.append(input);
    parent.append(container);
    this.fields.push({input,read});
  }

  private formatted(value:number) { return String(Number(value.toFixed(4))); }

  private sync() {
    for (const {input,read} of this.fields) input.value=this.formatted(read(this.rig.config));
    this.walk.checked=this.rig.simulateWalk;
    this.pause.textContent=this.rig.config.animation.paused ? '预览动画' : '暂停动画';
  }

  private button(label:string,act:()=>void) {
    const button=document.createElement('button');
    button.type='button';
    button.textContent=label;
    button.addEventListener('click',act);
    return button;
  }

  private export() {
    const json=JSON.stringify({version:1,asset:'knife',...this.rig.config},null,2)+'\n';
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='knife-viewmodel.json';
    link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    this.status.textContent='已导出 knife-viewmodel.json';
  }
}
