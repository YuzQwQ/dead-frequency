import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

  await page.goto(offline.href);
  await page.getByRole('button', {name: '仓库与整备', exact: true}).click();
  for (const [item,action] of [['P-12 泵动霰弹枪','主武器'], ['12 号鹿弹','放入背包']]) {
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
  await page.keyboard.press('1',{delay:80});
  await page.waitForFunction(() => !document.querySelector('[data-hud="ammo-count"]').hidden &&
    document.querySelector('[data-hud="rounds"]').textContent==='05');

  await page.keyboard.press('Tab', {delay: 80});
  await page.getByRole('heading', {name: '背包与装备', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.pointerLockElement), null);
  await page.getByRole('button', {name: '返回现场', exact: true}).click();
  await page.waitForFunction(() => Boolean(document.pointerLockElement));
  await page.getByRole('heading', {name: '背包与装备', exact: true}).waitFor({state:'hidden'});
  await page.evaluate(() => document.exitPointerLock());
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
  assert.deepEqual(profile.kit, {gear: {}, bag: []});
  await knifeDeployment.click();
  await reopened.waitForFunction(() => Boolean(document.pointerLockElement) &&
    document.querySelector('[data-hud="weapon"]')?.textContent==='简易小刀');
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log('Offline file: Pointer Lock, audio, fire, reload, knife switching, alternating slashes, thrust and unarmed fallback passed.');
} finally {
  await browser.close();
}
