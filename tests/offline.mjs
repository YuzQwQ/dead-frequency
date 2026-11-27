import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browserCache = new URL('../.browser/', import.meta.url);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(browserCache)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(browserCache);
}
const {chromium} = await import('playwright');
const offline = new URL('../死寂频段.html', import.meta.url);
assert.ok(existsSync(offline), 'Run pnpm build:offline before testing.');

const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const context = await browser.newContext({offline: true, viewport: {width: 1080, height: 700}});
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  context.on('request', request => {
    const url = request.url();
    if (url !== offline.href && !url.startsWith('data:')) requests.push(url);
  });
  context.on('weberror', event => errors.push(event.error().message));
  await page.addInitScript(() => {
    window.decodedSamples = 0;
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function(...args) {
      const buffer = await decode.apply(this, args);
      window.decodedSamples++;
      return buffer;
    };
  });
  /* 关面板时浏览器可能拒绝「同一次点击手势里」发起的重新锁定，
     游戏会按设计弹出「点击继续行动」。测试跟真实玩家一样点一下再等锁定。 */
  const relock = async () => {
    const prompt = page.getByRole('button', {name:'点击继续行动', exact:true});
    /* 自动重锁和提示出现有先后，逐次轮询：已锁定直接走，提示还在就点一下，
       点击过程中提示被自动重锁收起也不算失败。 */
    for (let i=0;i<25;i++) {
      if (await page.evaluate(() => Boolean(document.pointerLockElement))) return;
      if (await prompt.isVisible()) await prompt.click({timeout:800}).catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.waitForFunction(() => Boolean(document.pointerLockElement), null, {timeout:8000});
  };

  await page.goto(offline.href);
  await page.getByRole('button', {name: '仓库与整备', exact: true}).click();
  const stashGrid=page.locator('[data-grid="stash"]'),bagGrid=page.locator('[data-carried="backpack"] .inventory-grid');
  const shotgun=grid=>grid.locator('.inventory-item').filter({has:page.locator('.cell[title="Remington 870"]')});
  const startDrag=async item=>{
    await item.scrollIntoViewIfNeeded();
    const box=await item.boundingBox();
    await page.mouse.move(box.x+21,box.y+21);
    await page.mouse.down();
    await page.locator('.inventory-ghost').waitFor();
  };
  const aimGrid=async (grid,x,y)=>{
    const point=await grid.evaluate((node,{x,y})=>{
      const parent=node.parentElement;
      parent.scrollTo({left:Math.max(0,(x+1)*42-parent.clientWidth),top:Math.max(0,(y+1)*42-parent.clientHeight)});
      const rect=node.getBoundingClientRect(),scroll=node.closest('[data-inventory-scroll]');
      scroll.scrollTop+=Math.max(0,rect.top+(y+1)*42-scroll.getBoundingClientRect().bottom+12);
      const after=node.getBoundingClientRect();
      return {x:after.x+(x+.5)*42,y:after.y+(y+.5)*42};
    },{x,y});
    await page.mouse.move(point.x,point.y);
  };
  await startDrag(shotgun(stashGrid));
  await page.keyboard.down('r');
  const ghost=page.locator('.inventory-ghost');
  assert.equal(await ghost.getAttribute('data-rotated'),'true');
  assert.equal((await ghost.boundingBox()).height,252);
  const icon=ghost.locator('.cell-img, .cell-mark');
  assert.match(await icon.evaluate(node=>getComputedStyle(node).transform),/^matrix\(0, 1, -1, 0,/);
  await page.keyboard.down('r'); // repeat must not rotate a second time
  await page.keyboard.up('r');
  assert.equal(await ghost.getAttribute('data-rotated'),'true');
  await aimGrid(bagGrid,4,0);
  await page.locator('.inventory-highlight.valid').waitFor();
  await page.mouse.up();
  await shotgun(bagGrid).waitFor();
  const savedPosition=await shotgun(bagGrid).getAttribute('style');
  await page.reload();
  await page.getByRole('button', {name:'仓库与整备',exact:true}).click();
  assert.equal(await shotgun(bagGrid).getAttribute('style'),savedPosition);
  assert.equal(await shotgun(bagGrid).getAttribute('data-rotated'),'true');
  await startDrag(shotgun(bagGrid));
  await aimGrid(bagGrid,5,1);
  await page.locator('.inventory-highlight:not(.valid)').waitFor();
  await page.mouse.up();
  assert.equal(await shotgun(bagGrid).getAttribute('style'),savedPosition);
  await startDrag(shotgun(bagGrid));
  await page.keyboard.press('r');
  assert.equal(await ghost.getAttribute('data-rotated'),'false');
  await page.keyboard.press('r');
  assert.equal(await ghost.getAttribute('data-rotated'),'true');
  await page.keyboard.press('Escape');
  await ghost.waitFor({state:'hidden'});
  await page.mouse.up();
  assert.equal(await shotgun(bagGrid).getAttribute('style'),savedPosition);
  await startDrag(shotgun(bagGrid));
  await aimGrid(bagGrid,5,0);
  await page.mouse.up();
  assert.notEqual(await shotgun(bagGrid).getAttribute('style'),savedPosition);
  await startDrag(shotgun(bagGrid));
  await aimGrid(stashGrid,0,1);
  await page.mouse.up();
  await shotgun(stashGrid).waitFor();
  for (const [item,action] of [['Remington 870','主武器'], ['12 号鹿弹','放入背包']]) {
    await page.locator(`.screen .cell[title="${item}"]`).first().click({button:'right'});
    await page.locator('.ctx-row').filter({hasText:action}).first().click();
  }
  await page.getByRole('button', {name: '行动简报', exact: true}).click();
  await page.getByRole('button', {name: '开始出击', exact: true}).click();
  await page.waitForFunction(() => document.pointerLockElement === document.querySelector('#viewport canvas') &&
    document.pointerLockElement !== null);
  await page.waitForFunction(() => window.decodedSamples === 12);
  const strike=async (button='left')=>{
    await page.mouse.down({button});
    await page.mouse.up({button});
  };
  await strike();
  await page.waitForFunction(() => document.querySelector('[data-hud="rounds"]')?.textContent === '04');
  await page.waitForFunction(() => document.querySelector('[data-hud="ammo"]')?.textContent !== '泵动中');
  await page.keyboard.press('r', {delay: 80});
  await page.waitForFunction(() => document.querySelector('[data-hud="rounds"]')?.textContent === '05' &&
    document.querySelector('[data-hud="reserve"]')?.textContent.trim() === '/ 9');

  await page.keyboard.press('3',{delay:80});
  await page.waitForFunction(() => document.querySelector('[data-hud="ammo-count"]').hidden);
  await page.screenshot({path:'test-output/knife-first-person.png'});
  for (const side of ['左侧轻击','右侧轻击']) {
    await strike();
    await page.waitForFunction(side=>document.querySelector('[data-hud="ammo"]')?.textContent===side,side);
    await page.waitForFunction(() => document.querySelector('[data-hud="ammo"]')?.textContent.includes('右键'));
  }
  await strike('right');
  await page.waitForFunction(() => document.querySelector('[data-hud="ammo"]')?.textContent==='重击蓄势');
  await page.waitForFunction(() => document.querySelector('[data-hud="ammo"]')?.textContent==='重刺收势');
  await page.waitForFunction(() => document.querySelector('[data-hud="ammo"]')?.textContent.includes('右键'));
  await page.keyboard.press('F8');
  const preview=page.getByRole('complementary',{name:'ViewModel 调试'});
  await preview.waitFor();
  await page.waitForFunction(()=>document.pointerLockElement===null);
  await preview.getByRole('button',{name:'回到静态'}).click();
  await preview.getByRole('spinbutton',{name:'ViewModel FOV'}).fill('62');
  await preview.getByRole('spinbutton',{name:'四指第二节 °'}).fill('16');
  await preview.getByRole('checkbox',{name:'显示旋转轴'}).check();
  await preview.getByRole('group',{name:'ItemSocket 局部'}).getByRole('spinbutton',{name:'位置 X'}).fill('0.04');
  const [configuration]=await Promise.all([
    page.waitForEvent('download'),
    preview.getByRole('button',{name:'导出 JSON'}).click(),
  ]);
  const config=JSON.parse(await readFile(await configuration.path(),'utf8'));
  assert.equal(config.fov,62);
  assert.equal(config.joints.fingerMiddle,16);
  assert.equal(config.itemSocket.position[0],.04);
  assert.equal(config.animation.paused,true);
  await preview.getByRole('button',{name:'预览动画'}).click();
  await preview.getByRole('checkbox',{name:'模拟步行'}).check();
  await preview.getByRole('button',{name:'暂停动画'}).click();
  await preview.getByRole('button',{name:'恢复默认'}).click();
  assert.equal(await preview.getByRole('spinbutton',{name:'ViewModel FOV'}).inputValue(),'55');
  assert.equal(await preview.getByRole('spinbutton',{name:'四指第二节 °'}).inputValue(),'-30');
  await page.screenshot({path:'test-output/knife-viewmodel-panel.png'});
  await preview.getByRole('button',{name:'返回现场'}).click();
  await preview.waitFor({state:'hidden'});
  await relock();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.press('1',{delay:80});
  await page.waitForFunction(() => !document.querySelector('[data-hud="ammo-count"]').hidden &&
    document.querySelector('[data-hud="rounds"]').textContent==='05');

  await page.keyboard.press('Tab', {delay: 80});
  await page.getByRole('heading', {name: '背包与装备', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.pointerLockElement), null);
  await page.getByRole('button', {name: '返回现场', exact: true}).click();
  await relock();
  await page.getByRole('heading', {name: '背包与装备', exact: true}).waitFor({state:'hidden'});
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '放弃行动', exact: true}).click();
  await page.getByRole('button', {name: '确认弃离', exact: true}).click();
  await page.getByRole('heading', {name: '行动弃离', exact: true}).waitFor();

  await page.close();
  const reopened = await context.newPage();
  // A second page in the same browser context shares this file's LocalStorage.
  await reopened.goto(offline.href);
  const knifeDeployment=reopened.getByRole('button', {name: '持刀出击', exact: true});
  await knifeDeployment.waitFor();
  const profile = await reopened.evaluate(() => JSON.parse(localStorage.getItem('dead-frequency.profile')));
  assert.equal(profile.stats.raids, 1);
  assert.equal(profile.active, false);
  assert.deepEqual(profile.kit.gear, {});
  assert.deepEqual(profile.kit.pockets, [[], [], [], []]);
  await knifeDeployment.click();
  await reopened.waitForFunction(() => Boolean(document.pointerLockElement) &&
    document.querySelector('[data-hud="weapon"]')?.textContent==='简易小刀');
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log('Offline file: grid drag, rotation, rollback, persistence, combat and ViewModel controls passed.');
} finally {
  await browser.close();
}
