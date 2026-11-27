import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { items } from '../src/data.ts';
import { hasProp } from '../src/props.ts';

/* 把模型渲染成物品图标。武器走 side（正交侧视，枪口向左），
   收集品走 iso（25°~30° 轻俯视 + 弱透视 / 近似等轴测）。
   输出 assets/icons/<id>.png（透明背景），另外拼一张联系表方便整体校对。
   调试：ICON_ELEV / ICON_AZIM / ICON_PERSP 环境变量可临时改相机参数。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = join(root, 'assets', 'icons');
await mkdir(outDir, { recursive:true });
const cache = join(root, '.browser');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
const { chromium } = await import('playwright');

const SIZE = Number(process.env.ICON_SIZE ?? 512);
const weapons = ['k9', 'ar56', 'p12'];
const props = Object.keys(items).filter(id => hasProp(id));
const all = [...weapons, ...props];
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const ids = only.length ? only : all;
const sheetOnly = process.argv.includes('--sheet-only');

/* 视角参数透传给渲染舞台，方便不改代码就对比不同俯角 / 透视强度 */
const viewParams = new URLSearchParams();
for (const [env, key] of [['ICON_ELEV', 'elev'], ['ICON_AZIM', 'azim'], ['ICON_PERSP', 'persp']])
  if (process.env[env]) viewParams.set(key, process.env[env]);
const tune = viewParams.toString();

const browser = await chromium.launch({ args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let server;
try {
  server = await createServer({ root, server:{ host:'127.0.0.1', port:0 } });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const context = await browser.newContext({ viewport:{ width:SIZE, height:SIZE }, deviceScaleFactor:1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  for (const id of ids) {
    if (sheetOnly && !existsSync(join(outDir, `${id}.png`))) continue;
    const view = weapons.includes(id) ? 'side' : 'iso';
    if (sheetOnly) continue;
    await page.goto(`${url}/art/icon.html?id=${id}&view=${view}${tune ? '&' + tune : ''}`);
    await page.locator('#stage[data-ready="true"]').waitFor();
    /* 舞台会给出紧贴模型的屏幕包围盒；按它裁剪，图标就没有多余空白 */
    const box = String(await page.locator('#stage').getAttribute('data-box')).split(',').map(Number);
    const pad = Math.max(4, Math.round(Math.max(box[2], box[3]) * .035));
    const clip = {
      x: Math.max(0, box[0] - pad), y: Math.max(0, box[1] - pad),
      width: Math.min(SIZE - Math.max(0, box[0] - pad), box[2] + pad * 2),
      height: Math.min(SIZE - Math.max(0, box[1] - pad), box[3] + pad * 2),
    };
    await page.screenshot({ path:join(outDir, `${id}.png`), omitBackground:true, clip });
  }
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));

  /* 联系表：深色底、8 列，按「武器 / 收集品」分组，方便一眼看出哪张图糊了 */
  const cell = id => `<figure><img src="../../assets/icons/${id}.png" alt="${id}"><figcaption>${items[id].name}</figcaption></figure>`;
  const missing = all.filter(id => !existsSync(join(outDir, `${id}.png`)));
  const sheetIds = all.filter(id => existsSync(join(outDir, `${id}.png`)));
  const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:22px 24px 26px; background:#161d19; color:#cfd8cc;
    font:13px/1.4 "Microsoft YaHei", "Segoe UI", sans-serif; }
  h2 { margin:0 0 2px; font:700 13px Consolas, monospace; letter-spacing:.16em; color:#d9ae7d; }
  p { margin:0 0 16px; font-size:11.5px; color:#7c8a7f; }
  .grid { display:grid; grid-template-columns:repeat(8, 1fr); gap:8px; }
  figure { margin:0; background:#1d2621; border:1px solid #33413a; padding:6px 4px 4px; text-align:center; }
  img { width:100%; aspect-ratio:1; object-fit:contain; display:block; }
  figcaption { margin-top:3px; font-size:11px; color:#9dab9f; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis; }
</style>
<h2>DEAD FREQUENCY / ITEM ICONS</h2>
<p>${sheetIds.length} 张 · 武器为正交侧视（枪口向左），收集品为 28° 轻俯视 + 弱透视近似等轴测（方位 45°） · 透明背景${missing.length ? ' · 缺：' + missing.join(' ') : ''}</p>
<div class="grid">${sheetIds.map(cell).join('')}</div>`;
  const sheet = join(root, 'art', 'previews', 'item-icons.png');
  await mkdir(join(root, 'art', 'previews'), { recursive:true });
  /* 联系表放在预览目录，图片用相对路径指过去，file:// 能正常加载 */
  const sheetHtml = join(root, 'art', 'previews', '_sheet.html');
  await writeFile(sheetHtml, html);
  const sheetPage = await context.newPage();
  await sheetPage.setViewportSize({ width:1180, height:600 });
  await sheetPage.goto(`file:///${sheetHtml.replace(/\\/g, '/')}`);
  await sheetPage.waitForTimeout(300);
  await sheetPage.screenshot({ path:sheet, fullPage:true });
  await writeFile(join(outDir, 'index.json'), JSON.stringify({ size:SIZE, ids:sheetIds }, null, 2) + '\n');
  console.log(`Generated ${sheetIds.length} icons (${SIZE}px) -> assets/icons/ ; contact sheet -> art/previews/item-icons.png`);
} finally {
  await browser.close();
  await server?.close();
}
