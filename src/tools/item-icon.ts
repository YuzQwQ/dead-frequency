import * as T from 'three';
import { AssetFactory } from '../assets.ts';
import { items, weapons } from '../data.ts';
import type { WeaponId } from '../data.ts';
import { hasProp, propScale } from '../props.ts';

/* 单件物品的图标舞台：透明背景、自动适配包围盒。
   武器走 side（正交侧视，枪口向左），收集品走 iso（25°~30° 轻俯视 + 弱透视 / 近似等轴测）。
   页面铺满视口，截图时把 viewport 设成目标图标尺寸即可得到正方形图。
   调试：?elev=28&azim=45&persp=12 可临时改俯角、方位与透视强度。 */

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? 'k9';
const view = params.get('view') === 'iso' ? 'iso' : 'side';
if (params.has('bg')) document.body.classList.add('checker');

/* 俯角取 28°（25°~30° 区间中值）：比原来的 45° 更能看到正面，顶面收窄但不至于压成一条线。
   方位 45° 让正面（-Z）与右侧（+X）对称露出，即「近似等轴测」的方位。
   persp = 相机距离 / 画面半高，越大越接近正交；12 → 垂直 FOV 约 9.5°，属长焦弱透视，
   只在方块边缘留一点近大远小，不产生肉眼可见的畸变，缩到 54px 也不会互相打架。 */
const tune = (key:string, fallback:number) => {
  const n = Number(params.get(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ELEVATION = tune('elev', 28) * Math.PI / 180;
const AZIMUTH = tune('azim', 45) * Math.PI / 180;
const PERSP = tune('persp', 12);

const stage = document.querySelector<HTMLElement>('#stage')!;
const renderer = new T.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setClearAlpha(0);
stage.append(renderer.domElement);

const assets = new AssetFactory();
const scene = new T.Scene();

/* 灯挂成相机的子节点：无论转到哪个视角，主光、补光、轮廓光都保持同样的相对位置，
   省得每换一个角度就重新调灯。相机局部 -Z 是「朝物体」的方向。 */
const key = new T.DirectionalLight(0xffe8c8, 3.0);
key.position.set(1.7, 2.3, -2.6);
const fill = new T.DirectionalLight(0xc4dae2, 1.15);
fill.position.set(-2.6, 0.9, -1.2);
const rim = new T.DirectionalLight(0xd9f0e2, 2.2);
rim.position.set(-0.9, 1.7, 3.0);
scene.add(new T.HemisphereLight(0xe4ece6, 0x6a6356, 1.45));

let camera: T.OrthographicCamera | T.PerspectiveCamera;
let halfSpan = 1;      // 画面半高（正方形视口），也用作裁剪基准
let baseFov = 0;       // iso 在正方形视口下的垂直 FOV
const root = new T.Group();
scene.add(root);
if (Object.hasOwn(weapons, id)) {
  const gun = assets.gun(id as WeaponId, false);
  gun.flash.removeFromParent();
  root.add(gun.root);
} else if (hasProp(id)) {
  root.add(assets.prop(id));
} else {
  throw new Error(`No icon model for ${id}`);
}

const bounds = new T.Box3().setFromObject(root);
const center = bounds.getCenter(new T.Vector3());
const size = bounds.getSize(new T.Vector3());
/* 手调了一点点缩放，让平铺的文件类和立体的电器在 64px 格子里观感接近 */
const bias = propScale[id] ?? 1;

if (view === 'side') {
  /* 相机放在 -X：屏幕上「右」是 +Z，枪口朝 -Z 就会落在画面左边。
     枪是最长的物品，纯正交保证枪管不会被透视拉成梯形。 */
  halfSpan = Math.max(size.y, size.z) / 2 * 1.08 / bias;
  camera = new T.OrthographicCamera(-halfSpan, halfSpan, halfSpan, -halfSpan, .01, 40);
  camera.position.copy(center).add(new T.Vector3(-8, 0, 0));
} else {
  /* 画面占比沿用正交时代的 halfSpan（包围球半径 ×1.12），反推相机距离，
     换成弱透视后图标大小与留白不变；近大远小只作用在深度方向上。 */
  halfSpan = size.length() / 2 * 1.12 / bias;
  const dist = halfSpan * PERSP;
  baseFov = 2 * Math.atan(1 / PERSP) * 180 / Math.PI;
  const dir = new T.Vector3(
    Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    Math.sin(ELEVATION),
    -Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  );
  camera = new T.PerspectiveCamera(baseFov, 1, Math.max(.01, dist * .25), dist * 4);
  camera.position.copy(center).addScaledVector(dir, dist);
}
camera.lookAt(center);
camera.add(key, fill, rim);
scene.add(camera);

function draw() {
  const width = stage.clientWidth, height = stage.clientHeight;
  const aspect = width / height;
  /* 视口不是正方形时按长边撑满，避免图标被压扁 */
  if (camera instanceof T.PerspectiveCamera) {
    camera.aspect = aspect;
    /* 窄高视口时放大垂直 FOV，保证水平视野不小于正方形视口 */
    const k = Math.max(1, 1 / aspect);
    camera.fov = 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) * k) * 180 / Math.PI;
  } else {
    camera.left = -halfSpan * Math.max(1, aspect);
    camera.right = halfSpan * Math.max(1, aspect);
    camera.top = halfSpan * Math.max(1, 1 / aspect);
    camera.bottom = -halfSpan * Math.max(1, 1 / aspect);
  }
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.render(scene, camera);

  /* 把包围盒八角投影到屏幕，给出紧贴模型的裁剪框。
     步枪是 16:5 的长条，如果保留方形画布，缩到 40px 格子里只剩一条细线；
     按紧框裁剪后图标本身就有正确的宽高比。
     凸体的透视投影极值仍落在顶点上，所以八角外接矩形不会裁掉模型。 */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const v = new T.Vector3(x, y, z).project(camera);
        const sx = (v.x * .5 + .5) * width, sy = (-v.y * .5 + .5) * height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
  stage.dataset.box = [x0, y0, x1 - x0, y1 - y0].map(n => n.toFixed(1)).join(',');
  stage.dataset.ready = 'true';
}

draw();
window.addEventListener('resize', draw);
if (import.meta.hot) import.meta.hot.dispose(() => {
  assets.dispose();
  renderer.dispose();
});
