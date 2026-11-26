import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { weapons } from '../src/data.ts';
import { insert, stack } from '../src/inventory.ts';
import { newProfile, SAVE_KEY } from '../src/save.ts';
import { weaponRecipes } from '../src/models/weapons.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const id=process.argv[2] ?? 'p12';
assert.ok(Object.hasOwn(weapons,id),'Pass a registered weapon ID.');
const output=join(root,'art','previews');
await mkdir(output,{recursive:true});
const cache=join(root,'.browser');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) process.env.PLAYWRIGHT_BROWSERS_PATH=cache;
const {chromium}=await import('playwright');
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let server;
try {
  server=await createServer({root,server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const url=`http://127.0.0.1:${server.httpServer.address().port}`;
  const context=await browser.newContext({viewport:{width:1360,height:780},deviceScaleFactor:1});
  const errors=[];
  context.on('weberror',e=>errors.push(e.error().message));
  const studio=await context.newPage();
  await studio.goto(`${url}/art/preview.html?weapon=${id}`);
  const ready=() => studio.locator('#stage[data-ready="true"]').waitFor();
  const capture=(page,name)=>page.screenshot({path:join(output,`${id}-${name}.png`)});
  await ready();
  await capture(studio,'side');
  const motion=weaponRecipes[id]?.motion;
  if (motion) {
    const stage=studio.locator('#stage');
    const rest=Number(await stage.getAttribute('data-pump-depth'));
    await studio.locator('#pose').fill('1');
    const shifted=Number(await stage.getAttribute('data-pump-depth'));
    assert.ok(Math.abs(shifted-rest-motion.travel[2])<.00001);
    await capture(studio,'pump');
    await studio.locator('#pose').fill('0');
  }
  await studio.locator('#angle').selectOption('perspective');
  await capture(studio,'perspective');
  await studio.close();

  const raid=await context.newPage();
  const profile=newProfile();
  profile.kit.gear.primary=stack(id);
  insert(profile.kit.bag,stack(weapons[id].ammo,7));
  await raid.addInitScript(({key,profile})=>{
    localStorage.setItem(key,JSON.stringify(profile));
    let seed=466064;
    Math.random=() => ((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  },{key:SAVE_KEY,profile});
  await raid.goto(url+'/?qa');
  await raid.getByRole('button',{name:'开始出击',exact:true}).click();
  await raid.waitForFunction(id=>window.deadFrequencyState?.().locked && window.deadFrequencyState().combat===id,id);
  await capture(raid,'first-person');
  await raid.mouse.down({button:'right'});
  await raid.waitForFunction(()=>window.deadFrequencyState().hud.ads>.96);
  await capture(raid,'ads');
  await raid.mouse.up({button:'right'});
  const capacity=weapons[id].capacity;
  const reserve=await raid.evaluate(()=>window.deadFrequencyState().hud.reserve);
  await raid.mouse.click(680,390);
  await raid.waitForFunction(n=>window.deadFrequencyState().hud.rounds===n,capacity-1);
  if (motion) {
    await raid.waitForFunction(()=>!window.deadFrequencyState().hud.ammo.includes('泵动中'));
  }
  await raid.keyboard.press('r',{delay:80});
  await raid.waitForFunction(({capacity,reserve})=>{
    const hud=window.deadFrequencyState().hud;
    return hud.rounds===capacity && hud.reserve===reserve-1;
  },{capacity,reserve});
  assert.deepEqual(errors,[]);
  console.log(`Generated ${id} studio and in-game previews. Fire and reload passed.`);
} finally {
  await browser.close();
  await server?.close();
}
