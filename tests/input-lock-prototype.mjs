import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=new URL('../art/input-lock-prototype.html',import.meta.url).href;
const chrome=process.env.DF_CHROME_PATH;
for (const [name,options] of [['Edge',{channel:'msedge'}],['Chrome',chrome ? {executablePath:chrome} : {channel:'chrome'}]]) {
  const browser=await chromium.launch({headless:false,...options});
  try {
    const context=await browser.newContext({viewport:null});
    const page=await context.newPage();
    await page.goto(url);
    await page.locator('#start').click();
    await page.waitForFunction(()=>lockPrototype.state.keyboard==='locked' && lockPrototype.state.mouse==='locked');
    const expect=(screen,mouse)=>page.waitForFunction(([screen,mouse])=>
      lockPrototype.state.screen===screen && lockPrototype.state.mouse===mouse,[screen,mouse]);

    for (const [key,screen,mouse] of [
      ['Escape','pause','free'],['Escape','field','locked'],['Escape','pause','free'],['Escape','field','locked'],
      ['Tab','bag','free'],['Tab','field','locked'],['Tab','bag','free'],['Escape','field','locked'],
      ['e','container','free'],['Escape','field','locked'],
    ]) {
      await page.keyboard.press(key);
      await expect(screen,mouse);
    }
    const movement=await page.evaluate(()=>lockPrototype.state.dx);
    await page.mouse.move(290,240);
    await page.mouse.click(310,240);
    await page.waitForFunction(previous=>lockPrototype.state.attacks===1 && lockPrototype.state.dx!==previous,movement);

    await page.keyboard.press('e');
    await expect('container','free');
    await page.waitForFunction(()=>!navigator.userActivation.isActive);
    await page.keyboard.press('Escape');
    await expect('field','locked');

    const other=await context.newPage();
    await other.bringToFront();
    await expect('pause','free');
    await page.bringToFront();
    await page.locator('#resume').click();
    await expect('field','locked');
    await page.keyboard.press('Escape');
    await expect('pause','free');
    await page.locator('#exit').click();
    await page.waitForFunction(()=>!document.fullscreenElement && lockPrototype.state.keyboard==='off' && lockPrototype.state.mouse==='free');

    await page.goto(url+'?fallback');
    await page.locator('#start').click();
    await expect('field','locked');
    assert.equal(await page.evaluate(()=>lockPrototype.state.keyboard),'fallback');
    await page.keyboard.press('Tab');
    await expect('bag','free');
    await page.keyboard.press('Tab');
    await expect('field','locked');
    const denied=await context.newPage();
    await denied.addInitScript(()=>Object.defineProperty(navigator,'keyboard',{value:{
      lock:()=>Promise.reject(new DOMException('Test rejection','NotAllowedError')),
      unlock:()=>{},
    }}));
    await denied.goto(url);
    await denied.locator('#start').click();
    await denied.waitForFunction(()=>!document.fullscreenElement && lockPrototype.state.keyboard==='fallback' && lockPrototype.state.mouse==='free');
    await denied.locator('#resume').click();
    await denied.waitForFunction(()=>lockPrototype.state.screen==='field' && lockPrototype.state.mouse==='locked');
    console.log(name,browser.version(),'passed: Esc, Tab, container, movement, attack, idle Esc, focus recovery, fullscreen cleanup and Pointer Lock fallback.');
  } finally {
    await browser.close();
  }
}
