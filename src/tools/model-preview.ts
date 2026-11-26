import * as T from 'three';
import { AssetFactory } from '../assets.ts';
import type { WeaponModel } from '../assets.ts';
import { items, weapons } from '../data.ts';
import type { WeaponId } from '../data.ts';

const params=new URLSearchParams(location.search);
const stage=document.querySelector<HTMLElement>('#stage')!;
const weapon=document.querySelector<HTMLSelectElement>('#weapon')!;
const angle=document.querySelector<HTMLSelectElement>('#angle')!;
const pose=document.querySelector<HTMLInputElement>('#pose')!;
const ids=Object.keys(weapons) as WeaponId[];
for (const id of ids) weapon.add(new Option(items[id].name,id));
const requested=params.get('weapon') as WeaponId;
weapon.value=ids.includes(requested) ? requested : 'p12';
angle.value=params.get('view')==='perspective' ? 'perspective' : 'side';
pose.value=String(T.MathUtils.clamp(Number(params.get('pose'))||0,0,1));

const renderer=new T.WebGLRenderer({antialias:true,alpha:true});
renderer.outputColorSpace=T.SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
stage.append(renderer.domElement);
const assets=new AssetFactory();
const scene=new T.Scene();
scene.add(new T.HemisphereLight(0xe2eee5,0x746c61,1.8));
for (const [x,y,z,color,power] of [[1.6,3,1.5,0xffdfbf,2.3],[-2,2,-2,0xbcd3db,1.4],[2,-.5,-3,0xc7ded4,.62]]) {
  const light=new T.DirectionalLight(color,power);
  light.position.set(x,y,z);
  scene.add(light);
}
let model:WeaponModel;
const bounds=new T.Box3();
const center=new T.Vector3();
const size=new T.Vector3();

function draw() {
  const width=stage.clientWidth,height=stage.clientHeight,aspect=width/height;
  const span=Math.max(size.z*1.19,size.y*aspect*2.35);
  model.posePump?.(Number(pose.value));
  const pump=model.root.getObjectByName('pump');
  if (pump) stage.dataset.pumpDepth=String(pump.position.z);
  else delete stage.dataset.pumpDepth;
  let camera:T.Camera;
  if (angle.value==='side') {
    const ortho=new T.OrthographicCamera(-span/2,span/2,span/(2*aspect),-span/(2*aspect),.01,20);
    ortho.position.copy(center).add(new T.Vector3(3,0,0));
    camera=ortho;
  } else {
    const perspective=new T.PerspectiveCamera(28,aspect,.01,20);
    const distance=span/(2*Math.tan(T.MathUtils.degToRad(14))*aspect)*1.15;
    perspective.position.copy(center).addScaledVector(new T.Vector3(.82,.43,-.34).normalize(),distance);
    camera=perspective;
  }
  camera.lookAt(center);
  renderer.setSize(width,height);
  renderer.render(scene,camera);
  stage.dataset.ready='true';
}

function select() {
  model?.root.removeFromParent();
  const id=weapon.value as WeaponId;
  model=assets.gun(id,false);
  model.flash.removeFromParent();
  scene.add(model.root);
  bounds.setFromObject(model.root).getCenter(center);
  bounds.getSize(size);
  document.querySelector('#title')!.textContent=items[id].name;
  document.querySelector<HTMLElement>('#travel')!.hidden=!model.posePump;
  draw();
}

select();
weapon.addEventListener('change',select);
angle.addEventListener('change',draw);
pose.addEventListener('input',draw);
const observer=new ResizeObserver(draw);
observer.observe(stage);
if (import.meta.hot) import.meta.hot.dispose(() => {
  observer.disconnect();
  assets.dispose();
  renderer.dispose();
});
