import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root=new URL('../',import.meta.url);
const cache=new URL('.browser/',root);
if (existsSync(cache) && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(cache);
}
const {chromium}=await import('playwright');
const url=new URL('建模编辑器.html',root);
assert.ok(existsSync(url),'Run pnpm build:editor before testing.');
await mkdir(new URL('test-output/',root),{recursive:true});

const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:840}});
  const page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{ if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(url.href);
  await page.locator('#part-name').waitFor();
  await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#part-name').inputValue(),'receiver');
  const action=name=>page.getByRole('button',{name,exact:true}).click();
  async function edit(input,value) {
    const field=page.getByRole('spinbutton',{name:input,exact:true});
    await field.fill(String(value));
    await field.press('Tab');
  }
  async function exported() {
    const [download]=await Promise.all([page.waitForEvent('download'),action('导出 JSON')]);
    return {name:download.suggestedFilename(),value:JSON.parse(await readFile(await download.path(),'utf8'))};
  }
  const position=page.getByRole('spinbutton',{name:'位置 X',exact:true});
  await edit('位置 X',.15);
  assert.equal(await position.inputValue(),'0.15');
  await action('撤销');
  assert.equal(await position.inputValue(),'0');
  await action('重做');
  assert.equal(await position.inputValue(),'0.15');

  const point=page.locator('.contour circle[data-point="0"]');
  await point.scrollIntoViewIfNeeded();
  const mark=await point.boundingBox();
  assert.ok(mark);
  const before=await page.getByRole('spinbutton',{name:'向上 V',exact:true}).inputValue();
  await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);
  await page.mouse.down();
  await page.mouse.move(mark.x+mark.width/2+10,mark.y+mark.height/2-6,{steps:5});
  await page.mouse.up();
  const after=await page.getByRole('spinbutton',{name:'向上 V',exact:true}).inputValue();
  assert.notEqual(after,before);
  await action('复制为独立材质');
  const p12=await exported();
  assert.equal(p12.name,'p12.json');
  const receiver=p12.value.parts.find(part=>part.name==='receiver');
  assert.equal(receiver.at[0],.15);
  assert.equal(receiver.outline[0][1],Number(after));
  assert.match(receiver.material,/copy/);
  assert.ok(p12.value.motion.part);
  const pump=p12.value.parts.find(part=>part.name==='pump');
  assert.equal(pump.parts.find(part=>part.name==='support-hand').hand,true);
  assert.ok(!p12.value.parts.some(part=>part.name==='stock-neck'));
  await page.locator('[data-part="support-hand"]').click();
  assert.equal(await page.getByLabel('可见部件').inputValue(),'with-hands');
  await page.getByLabel('可见部件').selectOption('weapon');
  assert.equal(await page.locator('#part-name').count(),0);
  await page.reload();
  await page.locator('#part-name').waitFor();
  assert.equal(await position.inputValue(),'0.15');
  await page.getByLabel('镜头视角').selectOption('side');
  await page.screenshot({path:fileURLToPath(new URL('test-output/model-editor.png',root))});

  await page.getByLabel('当前模型').selectOption('knife');
  assert.equal(await page.locator('#part-name').inputValue(),'blade');
  await edit('刃口厚度',.002);
  const knifeBlade=(await exported()).value.parts.find(part=>part.name==='blade');
  assert.equal(knifeBlade.edgeDepth,.002);
  await action('撤销');
  assert.equal(await page.getByRole('spinbutton',{name:'刃口厚度',exact:true}).inputValue(),'0.001');
  await page.locator('[data-part="tail-mark"]').click();
  await edit('距中线',.031);
  assert.equal((await exported()).value.parts.find(part=>part.name==='tail-mark').sideOffset,.031);
  await action('撤销');
  await page.locator('[data-part="sleeve"]').click();
  await page.getByLabel('当前截面').selectOption({value:'5'});
  /* 源配方里这一格原本就是 .111；填同一个值不会产生撤销记录，这里刻意换成 .117。 */
  await edit('截面宽度',.117);
  const editedHand=(await exported()).value.parts.find(part=>part.name==='right-hand');
  assert.equal(editedHand.parts.find(part=>part.name==='sleeve').sections[5][3],.117);
  await action('撤销');
  await page.locator('[data-part="blade"]').click();
  await action('添加');
  await edit('尺寸 X',.22);
  await action('复制部件');
  const copied=await exported();
  assert.equal(copied.name,'knife.json');
  assert.equal(copied.value.parts.find(p=>p.name==='box-copy').size[0],.22);
  await action('删除部件');
  assert.ok(!(await exported()).value.parts.some(p=>p.name==='box-copy'));
  const legacy=structuredClone(p12.value);
  const stock=legacy.parts.find(part=>part.name==='stock');
  stock.view='external';
  legacy.parts.push({...stock,name:'stock-neck',view:'first-person'});
  const oldHand=legacy.parts.find(part=>part.name==='pump').parts.find(part=>part.name==='support-hand');
  delete oldHand.hand;
  oldHand.view='first-person';
  await page.locator('#file').setInputFiles({
    name:'p12.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy)),
  });
  await page.getByText('已导入 p12.json。',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('当前模型').inputValue(),'p12');
  assert.equal(await position.inputValue(),'0.15');
  assert.deepEqual((await exported()).value,p12.value);
  await page.locator('#file').setInputFiles({
    name:'p12.json',mimeType:'application/json',buffer:Buffer.from('{"parts":[]}'),
  });
  await page.getByText('配方需要包含材质表和部件列表。',{exact:true}).waitFor();
  assert.equal(await position.inputValue(),'0.15');
  await action('参考图');
  await page.waitForFunction(()=>document.querySelector('#reference-image').naturalWidth>0);
  await action('关闭');
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);

  // Supply a file handle at the picker boundary without a native dialog.
  const linked=await context.newPage();
  await linked.addInitScript(contents=>{
    window.editorFixture=contents;
    window.showOpenFilePicker=async()=>[{
      name:'p12.json',
      getFile:async()=>new File([window.editorFixture],'p12.json'),
      createWritable:async()=>{
        let pending;
        return {
          write:async(text)=>{pending=text;},
          close:async()=>{window.editorFixture=pending;},
        };
      },
    }];
  },JSON.stringify(p12.value));
  await linked.goto(url.href);
  await linked.getByRole('button',{name:'打开配方',exact:true}).click();
  await linked.getByRole('button',{name:'写回文件',exact:true}).waitFor();
  const height=linked.getByRole('spinbutton',{name:'位置 Y',exact:true});
  await height.fill('.23');
  await height.press('Tab');
  await linked.getByRole('button',{name:'写回文件',exact:true}).click();
  await linked.getByText('已写回 p12.json。',{exact:true}).waitFor();
  const saved=await linked.evaluate(()=>JSON.parse(window.editorFixture));
  assert.equal(saved.parts.find(part=>part.name==='receiver').at[1],.23);
  await linked.evaluate(()=>{window.editorFixture+='\n';});
  await linked.getByRole('button',{name:'写回文件',exact:true}).click();
  await linked.getByText(/源文件已在编辑器外改动/).waitFor();
  await page.getByLabel('当前模型').selectOption('ar56');
  const rifle=await exported();
  assert.equal(rifle.name,'ar56.json');
  assert.ok(rifle.value.parts.some(part=>part.name==='carry-handle'));
  await page.getByLabel('当前模型').selectOption('k9');
  assert.equal(await page.locator('#part-name').inputValue(),'slide');
  assert.equal((await exported()).name,'k9.json');
  await action('参考图');
  await page.waitForFunction(()=>document.querySelector('#reference-image').naturalWidth>0);
  await action('关闭');
  console.log('Editor: offline viewport, transforms, contour dragging, materials, undo, draft restore, import/export and guarded write-back passed.');
} finally {
  await browser.close();
}
