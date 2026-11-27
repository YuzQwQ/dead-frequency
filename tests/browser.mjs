import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build, createServer as createVite } from 'vite';

if (existsSync('.browser') && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.browser');
}
const {chromium}=await import('playwright');
let url=process.env.DF_TEST_URL;
let vite;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const waitUntil=async (check,label,timeout=25000) => {
  const until=Date.now()+timeout;
  while (Date.now()<until) {
    const value=await check();
    if (value) return value;
    await sleep(65);
  }
  throw new Error('Timed out: '+label);
};

let browser;
let staticServer;
let productionOutput;
const temporaryRoot=await realpath(tmpdir());
try {
  if (!url) {
    vite=await createVite({server:{host:'127.0.0.1',port:0,watch:null}});
    await vite.listen();
    url=`http://127.0.0.1:${vite.httpServer.address().port}`;
  }
  await waitUntil(() => fetch(url).then(r=>r.ok).catch(()=>false),'Vite');
  await mkdir('test-output',{recursive:true});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-shader-disk-cache']});
  const page=await browser.newPage({viewport:{width:1200,height:720}});
  const errors=[];
  const assets=new Set();
  page.on('pageerror',error=>{
    errors.push(error.message);
    console.error('Browser exception:',error.message);
  });
  page.on('response',response => {
    if (response.ok() && /\.wav$/.test(response.url())) assets.add(response.url());
    if (response.status()>=400 && !response.url().includes('favicon')) errors.push(response.status()+' '+response.url());
  });
  await page.addInitScript(() => {
    /* 固定种子让整局可复现。容器数量变化会改变掉落抽取次数，
       后面所有随机（包括敌人的点射与散布）都会跟着移位，所以这里跟着调整种子。 */
    let seed=466071;
    Math.random=() => ((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  });

  const state=()=>page.evaluate(()=>window.deadFrequencyState());
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dead-frequency.profile')));
  const until=async (check,label,timeout) => {
    try { return await waitUntil(async()=>check(await state()),label,timeout); }
    catch (error) {
      const s=await state().catch(()=>null);
      if (s) console.log(label,JSON.stringify({player:s.player,hud:s.hud,combat:s.combat,panel:s.panel,enemies:s.enemies}));
      throw error;
    }
  };
  const click=label=>page.getByRole('button',{name:label,exact:true}).click({timeout:12000});
  const press=code=>page.keyboard.press(code,{delay:80});
  const shot=()=>page.mouse.down().then(()=>sleep(105)).then(()=>page.mouse.up());
  const screenshot=name=>page.screenshot({path:'test-output/'+name+'.png',timeout:15000});
  /* 物品格改成「单击详情 / 右键菜单 / 双击转移」，测试统一走右键菜单找动作 */
  const kitItem=async(name,action,kind='screen') => {
    await page.locator('.'+kind+' .cell[title="'+name+'"]').first().click({button:'right'});
    await page.locator('.ctx-row').filter({hasText:action}).first().click();
  };
  const cellMenu=async(scope,name,action) => {
    await page.locator(scope+' .cell[title="'+name+'"]').first().click({button:'right'});
    await page.locator('.ctx-row').filter({hasText:action}).first().click();
  };

  async function look(yaw,pitch=0) {
    const {player:p}=await state(), current=p.yaw;
    const angle=Math.atan2(Math.sin(yaw-current),Math.cos(yaw-current));
    await page.evaluate(({dx,dy}) => document.dispatchEvent(new MouseEvent('mousemove',{movementX:dx,movementY:dy,bubbles:true})),
      {dx:Math.round(-angle/.00215),dy:Math.round(-(pitch-p.pitch)/.00192)});
    await until(s=>s.player &&
      Math.abs(Math.atan2(Math.sin(s.player.yaw-yaw),Math.cos(s.player.yaw-yaw)))<.006 &&
      Math.abs(s.player.pitch-pitch)<.006,'look rotation');
  }
  async function lookAt(x,z,y=1.64) {
    const {player:p}=await state();
    /* 行动已经结束（阵亡/撤离）就没必要时再对镜头，交给后面的结算断言 */
    if (!p) return;
    await look(Math.atan2(p.x-x,p.z-z),Math.atan2(y-(p.y+1.64),Math.hypot(x-p.x,z-p.z)));
  }
  async function walk(x,z,sprint=false,tolerance=.43) {
    await lookAt(x,z);
    if (sprint) await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    try {
      await until(async ({player:p,state:run}) => {
        if (run==='result' || !p) return true;
        if (Math.hypot(p.x-x,p.z-z)<tolerance) return true;
        // Correct for wall sliding and tiny overshoots with normal mouse input.
        const difference=Math.atan2(p.x-x,p.z-z)-p.yaw;
        const turn=Math.atan2(Math.sin(difference),Math.cos(difference));
        if (Math.abs(turn)>.033) {
          await page.evaluate(dx=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:dx,bubbles:true})),
            Math.round(-turn/.00215));
        }
        return false;
      },'path to '+x+', '+z,32000);
    } catch (error) {
      const s=await state();
      throw new Error(error.message+' from '+JSON.stringify(s.player));
    } finally {
      await page.keyboard.up('w');
      if (sprint) await page.keyboard.up('Shift');
    }
    await until(s => s.state!=='raid' || s.hud?.moving<.7,'movement settles');
  }
  async function resume() {
    await click('返回现场');
    await until(s=>s.locked && s.panel===null,'pointer lock resumes');
  }
  async function deploy() {
    await click('开始出击');
    await until(s=>s.locked && s.panel===null,'pointer lock starts');
  }

  await page.goto(url+'/?qa');
  await waitUntil(()=>page.evaluate(()=>window.deadFrequencyState?.().rendering?.geometries>0),'WebGL scene');
  await screenshot('hideout');
  await click('仓库与整备');
  /* 仓库：容量读数、分类计数、筛选 / 搜索 / 清除筛选，全部只重绘网格 */
  assert.match(await page.locator('.stash-count').first().textContent(),/^9 \/ 200 格/);
  assert.equal(await page.locator('.stash-filter .pill').count(),9);
  assert.equal(await page.locator('.stash-grid .cell').count(),4);
  const cells=()=>page.evaluate(()=>document.querySelectorAll('.stash-grid .cell').length);
  await page.locator('.stash-filter .pill').filter({hasText:'装备'}).click();
  await waitUntil(async()=>await cells()===3,'stash filter gear');
  await page.locator('.stash-filter .pill').filter({hasText:'医疗'}).click();
  await waitUntil(async()=>await cells()===1,'stash filter medical');
  await page.locator('[data-stash-search]').fill('弹');
  await waitUntil(async()=>await cells()===0,'stash search narrows to empty');
  await page.locator('[data-stash-reset]').click();
  await waitUntil(async()=>await cells()===4,'stash reset clears filter');
  await page.locator('[data-stash-sort]').selectOption('name');
  await waitUntil(async()=>await cells()===4,'stash sort keeps every entry');
  await screenshot('stash');
  await kitItem('Remington 870','主武器');
  await kitItem('12 号鹿弹','放入背包');
  await click('行动简报');
  await deploy();
  await until(s=>s.sounds===12,'12 audio samples decoded');
  assert.equal(assets.size,12);
  await until(s=>s.combat==='p12','equipped Remington 870');
  await screenshot('raid');

  /* ESC 按层级关闭：背包 / 地图里按 ESC 回现场，不弹暂停页 */
  await press('Tab');
  await until(s=>s.panel==='inventory' && !s.locked,'bag opens with tab');
  const playerEquipment=page.getByRole('region',{name:'回收员',exact:true});
  const equipmentLayout=()=>playerEquipment.evaluate(panel=>({
    compact:panel.classList.contains('compact-character'),
    slots:[...panel.querySelectorAll('[data-slot]')].map(slot=>slot.dataset.slot),
    storage:[...panel.querySelectorAll('[data-carried]')].map(section=>section.dataset.carried),
  }));
  await playerEquipment.locator('[data-character-preview] canvas').waitFor();
  const standaloneLayout=await equipmentLayout();
  await page.keyboard.press('Escape');
  await until(s=>s.panel===null && s.locked,'esc closes bag and relocks');
  await press('m');
  await until(s=>s.panel==='map' && !s.locked,'map opens');
  await page.keyboard.press('Escape');
  await until(s=>s.panel===null && s.locked,'esc closes map and relocks');
  /* 浏览器拒绝重新锁定时，面板应保持关闭，等待明确的点击。 */
  await page.evaluate(() => {
    const canvas=document.querySelector('canvas');
    window.__requestLock=canvas.requestPointerLock.bind(canvas);
    canvas.requestPointerLock=() => Promise.reject(new Error('denied'));
  });
  await press('Tab');
  await until(s=>s.panel==='inventory' && !s.locked,'bag reopens');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'点击继续行动',exact:true}).waitFor();
  await until(s=>s.panel===null && !s.locked,'a refused relock leaves the inventory closed');
  await page.evaluate(() => {
    const canvas=document.querySelector('canvas');
    canvas.requestPointerLock=window.__requestLock;
  });
  await click('点击继续行动');
  await until(s=>s.panel===null && s.locked,'resume relocks after a refused lock');
  /* 现场没有面板时按 ESC 进暂停（同时释放鼠标），再按 ESC 回现场 */
  await page.keyboard.press('Escape');
  await until(s=>s.panel==='pause' && !s.locked,'esc opens pause in the field');
  await page.keyboard.press('Escape');
  await until(s=>s.panel===null && s.locked,'esc closes pause and relocks');
  /* 意外丢锁（切窗口、系统回收）：未锁定且无面板就是暂停 */
  await sleep(400);
  await page.evaluate(() => document.exitPointerLock());
  await until(s=>s.panel==='pause' && !s.locked,'a stray unlock pauses the raid');
  await click('返回现场');
  await until(s=>s.panel===null && s.locked,'resume after a stray unlock');
  /* 滚轮换枪：下切副武器、上切回主武器；面板打开时不响应 */
  await page.mouse.wheel(0,120);
  await until(s=>s.combat==='k9','wheel switches to sidearm');
  await page.mouse.wheel(0,-120);
  await until(s=>s.combat==='p12','wheel switches back to primary');
  console.log('Raid: ESC layering and wheel weapon switch verified.');

  await press('f');
  await until(s=>s.hud.flash,'flashlight on');
  await press('c');
  await page.keyboard.down('c');
  await until(s=>s.player.crouched,'crouching');
  await page.keyboard.up('c');
  await until(s=>!s.player.crouched,'standing');
  await press('Space');
  await until(s=>s.player.y>.15,'jump');
  await until(s=>s.player.y===0,'gravity');
  await press('m');
  await until(s=>s.panel==='map' && !s.locked,'raid map releases pointer lock');
  await screenshot('map');
  await resume();
  console.log('First raid: moving, crouching, jumping, flashlight and map verified.');

  await walk(-4,32.25);
  await lookAt(-4,30.5,.54);
  await until(s=>s.hud.prompt.includes('路边工具箱'),'toolbox prompts');
  /* 靠近才亮描边：身边的工具箱有，北侧的密封柜没有 */
  const lit=await state();
  assert.equal(lit.caches.length,21);
  assert.ok(lit.hud.prompt.includes('工具'),'prompt shows the container tier');
  assert.equal(lit.caches.find(cache=>cache.name==='路边工具箱').highlight,true);
  assert.equal(lit.caches.find(cache=>cache.name==='密封档案柜').highlight,false);
  await press('e');
  await until(s=>s.panel==='inventory' && !s.locked,'search completes');
  const cacheGrid=page.locator('.inventory-dialog [data-grid^="c"]');
  const bagGrid=page.locator('.inventory-dialog [data-carried="backpack"] .inventory-grid');
  /* 开箱先扫描：格子盖着面纱，扫完才亮出物品 */
  const veils=cacheGrid.locator('.scan-veil');
  await veils.first().waitFor({state:'visible'});
  assert.ok(await veils.count()>=1,'fresh containers start scanning');
  await page.waitForFunction(()=>[...document.querySelectorAll('.scan-veil')]
    .every(veil=>getComputedStyle(veil).visibility==='hidden'),null,{timeout:6000});
  await playerEquipment.locator('[data-character-preview] canvas').waitFor();
  assert.deepEqual(await equipmentLayout(),standaloneLayout);
  const firstLoot=cacheGrid.locator('.inventory-item').first();
  const lootKey=await firstLoot.locator('.cell').getAttribute('data-key');
  const dragTo=async (item,grid,x,y)=>{
    await item.scrollIntoViewIfNeeded();
    const from=await item.boundingBox();
    await page.mouse.move(from.x+21,from.y+21);
    await page.mouse.down();
    const point=await grid.evaluate((node,{x,y})=>{
      const modal=node.closest('[data-inventory-scroll]');
      const rect=node.getBoundingClientRect();
      modal.scrollTop+=Math.max(0,rect.top+(y+1)*42-modal.getBoundingClientRect().bottom+12);
      const after=node.getBoundingClientRect();
      return {x:after.left+x*42+22,y:after.top+y*42+22};
    },{x,y});
    await page.mouse.move(point.x,point.y,{steps:4});
    await page.locator('.inventory-highlight.valid').waitFor();
    await page.mouse.up();
  };
  const itemByKey=grid=>grid.locator('.inventory-item').filter({has:page.locator(`.cell[data-key="${lootKey}"]`)});
  await dragTo(firstLoot,bagGrid,0,2);
  await itemByKey(bagGrid).waitFor();
  await dragTo(itemByKey(bagGrid),cacheGrid,0,0);
  await itemByKey(cacheGrid).waitFor();
  await click('全部拾取');
  await until(s=>s.bag.some(item=>item.found),'loot entered pack');
  const collected=(await state()).bag.find(item=>item.found).id;
  await screenshot('loot');
  await cellMenu('.inventory-dialog','压缩敷料','放入容器');
  await until(s=>s.caches.find(c=>c.name==='路边工具箱').entries.some(item=>item.id==='bandage'),'item moved back');
  await click('全部拾取');
  await cellMenu('.inventory-dialog','压缩敷料','丢弃');
  await until(s=>s.caches.some(c=>c.name==='遗落物资' && c.entries.some(item=>item.id==='bandage')),'physical drop');
  await playerEquipment.locator('.cell').first().hover();
  await page.keyboard.press('Escape');
  await until(s=>s.panel===null && s.locked,'escape closes the container and restores pointer lock');
  console.log('First raid: search, pickup, transfer and physical drop verified.');

  await walk(35.9,33.0,true,.64);
  await page.mouse.down({button:'right'});
  await until(s=>s.hud.ads>.75,'aim down sights');
  await shot();
  await until(s=>s.hud.rounds===4,'shotgun fires');
  await page.mouse.up({button:'right'});
  await until(s=>s.hud.ammo!=='泵动中','pump cycle ends');
  await press('r');
  await until(s=>s.hud.rounds===5 && s.hud.reserve===9,'shotgun loads one shell');
  await press('2');
  await until(s=>s.combat==='k9','switch to pistol');
  const pistolReserve=(await state()).hud.reserve;
  await sleep(390);
  await shot();
  await until(s=>s.hud.rounds===11,'pistol fires');
  await press('r');
  await until(s=>s.hud.rounds===12 && s.hud.reserve===pistolReserve-1,'pistol reload');
  console.log('First raid: Remington 870 and Glock 17 firing, reload and aiming verified.');
  await walk(35.9,2.35,true,.60);
  await walk(35,-1.7,false,.40);
  await until(s=>s.hud.prompt.includes('撤离'),'east extraction available');
  await press('e');
  await until(s=>s.hud?.extraction>0,'extraction countdown');
  await until(s=>s.state==='result','extraction settlement');
  assert.equal(await page.locator('.result-dialog h1').textContent(),'撤离成功');
  await screenshot('extraction');
  const first=await stored();
  assert.equal(first.stats.raids,1);
  assert.equal(first.stats.escapes,1);
  assert.equal(first.kit.gear.primary.id,'p12');
  assert.ok([first.kit.gear.backpack?.contents,first.kit.gear.rig?.contents,first.kit.pockets].flat(2).some(entry=>entry?.id===collected));
  await click('返回藏身处');
  await page.reload();
  await until(s=>s.state==='hideout','reloaded hideout');
  assert.equal((await stored()).stats.escapes,1);
  console.log('First raid: live east extraction, carried loot and save reload verified.');

  await click('仓库与整备');
  /* 常驻卸下按钮已移除，改走装备槽右键菜单 */
  await page.locator('.gear-slot').filter({hasText:'Remington 870'}).locator('.cell').click({button:'right'});
  await page.locator('.ctx-row').filter({hasText:'卸下'}).first().click();
  await click('交易');
  await cellMenu('.screen-grid > .box','Remington 870','出售');
  await page.getByRole('button',{name:'买入 · 1,150 CR',exact:true}).click();
  await page.getByRole('button',{name:'买入 · 75 CR',exact:true}).click();
  assert.ok((await stored()).stash.some(entry=>entry.id==='ar56'));
  await click('仓库与整备');
  await kitItem('M4A1','主武器');
  await kitItem('5.56×45mm 弹','放入背包');
  await click('行动简报');
  await deploy();
  await until(s=>s.combat==='ar56','rifle loadout');
  await page.mouse.down();
  await sleep(680);
  await page.mouse.up();
  await until(s=>s.hud.rounds<=21,'automatic fire');
  await press('r');
  await until(s=>s.hud.rounds===24 && s.hud.reserve<15,'rifle reload');
  console.log('Second raid: store purchase, M4A1 automatic fire and reload verified.');
  let current=await state();
  assert.ok(current.enemies.some(unit=>unit.kind==='scav'));
  assert.ok(current.enemies.some(unit=>unit.kind==='echo'));

  // Approach the central echo, test the knife against a live target, then let the dispatch guard engage.
  await walk(7,29.2);
  await walk(6.4,23.4);
  await walk(7.2,17.8);
  await until(s=>s.enemies.some(unit=>unit.kind==='echo' && unit.state==='attack'),'echo reaches melee range');
  await press('3');
  await until(s=>s.combat==='knife','knife is equipped');
  const engaging=(await state()).enemies.find(unit=>unit.kind==='echo' && unit.state==='attack');
  await lookAt(engaging.x,engaging.z,1.0);
  await shot();
  await until(s=>s.enemies.some(unit=>unit.kind==='echo' && unit.hp===43),'light attack deals 20 damage');
  await until(s=>!s.melee,'light attack recovers');
  const wounded=(await state()).enemies.find(unit=>unit.kind==='echo' && unit.hp===43);
  await lookAt(wounded.x,wounded.z,1.0);
  await page.mouse.down({button:'right'});
  await page.mouse.up({button:'right'});
  await until(s=>s.enemies?.some(unit=>unit.kind==='echo' && unit.hp===-3 && unit.state==='dead'),'heavy thrust deals 46 and kills',4000);
  await until(s=>!s.melee,'heavy attack recovers');
  await press('1');
  await until(s=>s.combat==='ar56','guns switch back after melee');
  console.log('Second raid: knife light strike, heavy thrust, echo death and switching back to the rifle verified.');
  await walk(7.4,22.5);
  await walk(11.4,23.9);
  await walk(10.1,10.0,true,.60);
  await walk(15.6,5.5);
  await walk(19.25,1.2);
  await walk(20,-2.45);
  await walk(20,-5.15);
  await lookAt(18,-11,1.4);
  await until(s=>s.hud?.hp<100 || s.state==='result','human enemy deals damage',25000);
  await until(s=>s.state==='result','raid death',45000);
  assert.equal(await page.locator('.result-dialog h1').textContent(),'阵亡');
  const second=await stored();
  assert.equal(second.stats.raids,2);
  assert.equal(second.stats.escapes,1);
  assert.ok(second.stats.kills>=1);
  assert.deepEqual(second.kit.gear,{});
  assert.deepEqual(second.kit.pockets,[[],[],[],[]]);
  assert.ok(!second.stash.some(entry=>entry.id==='ar56'));
  await screenshot('death');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('Browser: Pointer Lock, movement, aiming, all three weapons, two enemy types, loot, trade, extraction, death and persisted saves passed.');

  // Serve a dedicated build so another local build can't replace assets during the test.
  productionOutput=await mkdtemp(join(temporaryRoot,'dead-frequency-test-'));
  await build({build:{outDir:productionOutput,emptyOutDir:false},logLevel:'error'});
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.svg':'image/svg+xml'};
  staticServer=createServer(async (request,response) => {
    const pathname=new URL(request.url,'http://127.0.0.1').pathname;
    if (!/^\/dead-frequency\/(assets\/[a-z0-9_.-]+|art\/editor\.html)?$/i.test(pathname)) {
      response.writeHead(404).end();return;
    }
    const relative=pathname.slice('/dead-frequency/'.length)||'index.html';
    try {
      const content=await readFile(join(productionOutput,relative));
      response.writeHead(200,{'content-type':types[relative.slice(relative.lastIndexOf('.'))] ?? 'application/octet-stream'}).end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done=>staticServer.listen(0,'127.0.0.1',done));
  const production=await browser.newPage({viewport:{width:1060,height:680}});
  await production.clock.install();
  const samples=new Set();
  production.on('pageerror',error=>errors.push(error.message));
  production.on('response',r=>{
    if (r.ok() && r.url().endsWith('.wav')) samples.add(r.url());
    if (r.status()>=400 && !r.url().endsWith('/favicon.ico')) errors.push(r.status()+' '+r.url());
  });
  await production.goto('http://127.0.0.1:'+staticServer.address().port+'/dead-frequency/');
  await production.getByRole('button',{name:'开始出击',exact:true}).click();
  await production.waitForFunction(()=>Boolean(document.pointerLockElement));
  await waitUntil(()=>samples.size===12,'production audio at subpath');
  assert.equal(await production.evaluate(()=>typeof window.deadFrequencyState),'undefined');
  await production.clock.fastForward(1500);
  await production.clock.fastForward(15*60*1000);
  await production.getByRole('heading',{name:'信号窗口关闭',exact:true}).waitFor({timeout:7000});
  const expired=await production.evaluate(()=>JSON.parse(localStorage.getItem('dead-frequency.profile')));
  assert.equal(expired.active,false);
  assert.deepEqual(expired.kit.gear,{});
  assert.deepEqual(expired.kit.pockets,[[],[],[],[]]);
  await production.goto('http://127.0.0.1:'+staticServer.address().port+'/dead-frequency/art/editor.html');
  await production.locator('#part-name').waitFor();
  assert.equal(await production.locator('#part-name').inputValue(),'receiver');
  await production.getByLabel('当前模型').selectOption('knife');
  assert.equal(await production.locator('#part-name').inputValue(),'blade');
  assert.deepEqual(errors,[]);
  console.log('Production: local repository subpath boot, Pointer Lock, audio, timeout settlement and model editor passed.');
} finally {
  await browser?.close();
  staticServer?.close();
  await vite?.close();
  if (productionOutput) {
    const path=await realpath(productionOutput);
    if (dirname(path)===temporaryRoot && basename(path).startsWith('dead-frequency-test-')) {
      await rm(path,{recursive:true,force:true});
    }
  }
}
