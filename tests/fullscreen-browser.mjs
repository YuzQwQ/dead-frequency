import {chromium} from 'playwright';

const chrome=process.env.DF_CHROME_PATH;
const offline=new URL('../死寂频段.html',import.meta.url).href;
for (const [name,options] of [['Edge',{channel:'msedge'}],['Chrome',chrome ? {executablePath:chrome} : {channel:'chrome'}]]) {
  const browser=await chromium.launch({headless:false,...options,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const context=await browser.newContext({viewport:null});
    const page=await context.newPage();
    await page.addInitScript(()=>{
      const lock=navigator.keyboard.lock.bind(navigator.keyboard);
      navigator.keyboard.lock=async codes=>{
        await lock(codes);
        window.keyboardLockReady=true;
      };
    });
    await page.goto(offline);
    await page.getByRole('button',{name:'开始出击',exact:true}).click();
    const field=()=>page.waitForFunction(()=>Boolean(document.pointerLockElement));
    const bag=page.getByRole('heading',{name:'背包与装备',exact:true});
    const pause=page.getByRole('button',{name:'放弃行动',exact:true});
    await page.waitForFunction(()=>window.keyboardLockReady && document.fullscreenElement);
    await field();
    await page.keyboard.press('Escape');await pause.waitFor();
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.keyboard.press('Escape');await field();
    await page.keyboard.press('Tab');await bag.waitFor();
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.keyboard.press('Tab');await field();
    await page.keyboard.press('Tab');await bag.waitFor();
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.keyboard.press('Escape');await field();
    await page.mouse.move(350,280);
    await page.mouse.down();await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('[data-hud=rounds]').textContent==='11');
    await page.evaluate(()=>document.exitFullscreen());
    await pause.waitFor();
    await page.waitForFunction(()=>!document.fullscreenElement && !document.pointerLockElement);
    await page.getByRole('button',{name:'返回现场',exact:true}).click();
    await field();
    console.log(name,browser.version(),'passed: fullscreen, Escape, Tab, immediate attack, fullscreen exit and windowed recovery.');
  } finally {
    await browser.close();
  }
}
