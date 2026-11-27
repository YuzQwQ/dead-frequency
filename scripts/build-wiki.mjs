/* 从 src/data.ts + src/sector.ts 生成静态图鉴（wiki/index.html + wiki/data.json）。
   数据只有一处来源：改完数值跑 `npm run wiki` 就会重新生成，不用手抄。 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BAG_CAPACITY, EXTRACT_SECONDS, RAID_SECONDS, STASH_CAPACITY,
  armor, catNames, healing, items, lootNames, lootTables, rarityNames, vendors, weapons,
} from '../src/data.ts';
import { containerSites } from '../src/sector.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sell = def => Math.max(1, Math.floor(def.price * (def.kind === 'salvage' ? .8 : .54)));
const round = (n, digits = 0) => Number(n.toFixed(digits));
const num = n => n.toLocaleString('zh-CN');
/* 图标直接内联成 data URI：wiki 是单文件，不能依赖旁边的 assets 目录 */
const iconCache = new Map();
const iconOf = id => {
  if (!iconCache.has(id)) {
    const file = join(root, 'assets', 'icons', id + '.png');
    iconCache.set(id, existsSync(file) ? 'data:image/png;base64,' + readFileSync(file).toString('base64') : null);
  }
  return iconCache.get(id);
};

/* ---------- 物品 ---------- */
const catalog = Object.entries(items).map(([id, def]) => ({
  id,
  name: def.name,
  short: def.short ?? def.name,
  mark: def.mark,
  icon: iconOf(id),
  kind: def.kind,
  cat: def.cat,
  catName: catNames[def.cat],
  r: def.r,
  rarity: rarityNames[def.r],
  w: def.w,
  price: def.price,
  sell: sell(def),
  /* 尺寸走格子系统：宽×高，数量是两者乘积（占几格） */
  size: def.width + '×' + def.height,
  slots: def.width * def.height,
  stack: def.stack,
  description: def.description,
  /* 单格价值：拿着占地方的东西值不值，主要看这个 */
  perSlot: round(sell(def) / (def.width * def.height)),
}));

/* ---------- 武器 ---------- */
const weaponRows = Object.entries(weapons).map(([id, w]) => {
  const def = items[id];
  const perShot = w.damage * w.pellets;
  const dps = perShot / w.interval;
  return {
    id, name: def.name, ammo: items[w.ammo].name, ammoId: w.ammo,
    damage: w.damage, pellets: w.pellets, perShot,
    rpm: round(60 / w.interval),
    capacity: w.capacity, reload: w.reload,
    spread: round(w.spread * 1000), range: w.range,
    dps: round(dps),
    mode: w.automatic ? '全自动' : (w.pellets > 1 ? '泵动' : '半自动'),
    recoil: w.recoil, price: def.price, sell: sell(def), weight: def.w, size: def.size,
  };
});

/* ---------- 护甲 / 医疗 ---------- */
const armorRows = Object.entries(armor).map(([id, a]) => ({
  id, name: items[id].name,
  protection: round(a.protection * 100), durability: a.durability,
  weight: items[id].w, price: items[id].price, sell: sell(items[id]),
  note: items[id].description,
}));
const healingRows = Object.entries(healing).map(([id, amount]) => ({
  id, name: items[id].name, amount, weight: items[id].w, price: items[id].price,
  stack: items[id].stack, note: items[id].description,
}));

/* ---------- 容器与掉落 ---------- */
const siteCount = containerSites.reduce((acc, site) => {
  acc[site.kind] = (acc[site.kind] ?? 0) + 1;
  return acc;
}, {});
const loot = Object.entries(lootTables).map(([kind, table]) => {
  const total = table.pool.reduce((s, [, weight]) => s + weight, 0);
  const rows = table.pool.map(([id, weight, min = 1, max = min]) => {
    const avgQty = (min + max) / 2;
    const chance = weight / total;
    return {
      id, name: items[id].name, mark: items[id].mark, catName: catNames[items[id].cat],
      r: items[id].r, rarity: rarityNames[items[id].r],
      chance: round(chance * 100, 1), min, max,
      per: round(chance * avgQty * sell(items[id])),
    };
  }).sort((a, b) => b.per - a.per);
  const draws = (table.count[0] + table.count[1]) / 2;
  return {
    kind, name: lootNames[kind], sites: siteCount[kind] ?? 0,
    draws: table.count, expected: round(rows.reduce((s, row) => s + row.per, 0) * draws),
    max: Math.max(...rows.map(row => row.chance)),
    rows,
  };
}).sort((a, b) => b.expected - a.expected);

/* ---------- 商人 ---------- */
const vendorRows = vendors.map(v => ({
  name: v.name, call: v.call,
  offers: v.offers.map(([id, qty]) => ({
    name: items[id].name, qty, price: items[id].price * qty,
    unit: items[id].price, mark: items[id].mark, r: items[id].r,
  })),
}));

const data = {
  generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
  limits: { bag: BAG_CAPACITY, stash: STASH_CAPACITY, raid: RAID_SECONDS, extract: EXTRACT_SECONDS },
  catalog, weapons: weaponRows, armor: armorRows, healing: healingRows, loot, vendors: vendorRows,
};

await mkdir(join(root, 'wiki'), { recursive: true });
await writeFile(join(root, 'wiki', 'data.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>死寂频段 · 资料库</title>
<style>
:root{
  --ink:#e9ead7;--muted:#a4b2a5;--dim:#78897c;
  --panel:#19221e;--panel-2:#222d26;--line:#405044;--line-soft:#313e35;
  --amber:#f0bb70;--green:#a2c797;--red:#e38371;
  --r1:#a1a99e;--r2:#94bf88;--r3:#95b9d3;--r4:#d3b273;--r5:#cfade1;
  --mono:"IBM Plex Mono","Cascadia Mono",Consolas,monospace;
}
*{box-sizing:border-box}
body{
  margin:0;background:#141c18;color:var(--ink);
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  line-height:1.55;-webkit-font-smoothing:antialiased;
}
a{color:var(--amber)}
.wrap{max-width:1240px;margin:0 auto;padding:0 1.15rem 4rem}
header.top{
  position:sticky;top:0;z-index:20;background:#141c18ee;backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line-soft);
}
.top-in{max-width:1240px;margin:0 auto;padding:.7rem 1.15rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:.6rem;min-width:0}
.brand b{font-size:1.02rem;letter-spacing:.16em;white-space:nowrap}
.brand small{color:var(--dim);letter-spacing:.22em;font-size:.66rem;text-transform:uppercase}
.top nav{display:flex;gap:.35rem;flex-wrap:wrap;margin-left:auto}
.top nav a{
  color:var(--muted);text-decoration:none;font-size:.82rem;padding:.3rem .62rem;
  border:1px solid transparent;border-radius:2px;
}
.top nav a:hover{color:var(--ink);border-color:var(--line);background:#1c2620}
.hero{padding:2.1rem 0 1.1rem}
.hero h1{margin:0 0 .45rem;font-size:clamp(1.7rem,4vw,2.5rem);letter-spacing:.04em}
.hero p{margin:0;color:var(--muted);max-width:62ch}
.stats{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.05rem}
.stat{background:var(--panel);border:1px solid var(--line-soft);padding:.5rem .8rem;min-width:98px}
.stat small{display:block;color:var(--dim);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase}
.stat b{font:700 1.05rem var(--mono);color:var(--amber)}
h2.sec{margin:2.4rem 0 .3rem;scroll-margin-top:104px;font-size:1.18rem;letter-spacing:.06em;display:flex;align-items:center;gap:.6rem}
h2.sec:before{content:"";width:3px;height:1.05em;background:var(--amber)}
.sec-note{margin:0 0 1rem;color:var(--dim);font-size:.84rem}
.items-sec{position:relative}
.toolbar{
  position:sticky;top:56px;z-index:15;background:#141c18f2;backdrop-filter:blur(8px);
  padding:.6rem 0 .7rem;border-bottom:1px solid var(--line-soft);margin-bottom:1rem;
}
.row{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
.row + .row{margin-top:.45rem}
input[type=search]{
  color:var(--ink);background:#1b2721;border:1px solid #465548;padding:.42rem .6rem;
  min-width:min(100%,260px);font:inherit;font-size:.88rem;border-radius:2px;
}
input[type=search]::placeholder{color:#6d7d70}
input[type=search]:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
select{
  color:var(--ink);background:#1b2721;border:1px solid #465548;padding:.42rem .5rem;
  font:inherit;font-size:.84rem;border-radius:2px;
}
.chip{
  color:var(--muted);background:transparent;border:1px solid #3a483d;padding:.3rem .62rem;
  font:inherit;font-size:.8rem;border-radius:2px;cursor:pointer;transition:.12s;
}
.chip:hover{color:var(--ink);border-color:#6e8272}
.chip[aria-pressed=true]{color:#25271c;background:var(--amber);border-color:#ffcb86;font-weight:700}
.chip .n{opacity:.72;font:700 .72rem var(--mono);margin-left:.3rem}
.chip.r1[aria-pressed=true]{background:var(--r1);border-color:var(--r1)}
.chip.r2[aria-pressed=true]{background:var(--r2);border-color:var(--r2)}
.chip.r3[aria-pressed=true]{background:var(--r3);border-color:var(--r3)}
.chip.r4[aria-pressed=true]{background:var(--r4);border-color:var(--r4)}
.chip.r5[aria-pressed=true]{background:var(--r5);border-color:var(--r5)}
.count{color:var(--dim);font-size:.8rem;margin-left:auto;font-family:var(--mono)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,318px),1fr));gap:.7rem;align-items:start}
.card{
  background:var(--panel);border:1px solid var(--line-soft);border-left:3px solid var(--r1);
  padding:.75rem .85rem .8rem;display:flex;flex-direction:column;gap:.5rem;
  transition:border-color .14s,background .14s;
}
.card:hover{background:#1d2823;border-color:#4a5c4d}
.card[data-r="2"]{border-left-color:var(--r2)}
.card[data-r="3"]{border-left-color:var(--r3)}
.card[data-r="4"]{border-left-color:var(--r4)}
.card[data-r="5"]{border-left-color:var(--r5)}
.card-head{display:flex;gap:.6rem;align-items:flex-start}
.mark{
  flex:0 0 42px;height:42px;display:grid;place-items:center;background:#1b2721;
  border:1px solid #43524a;color:var(--muted);font:700 .78rem var(--mono);
  border-left:2px solid var(--r1);
}
.mark.has-icon{width:auto;height:42px;min-width:42px;max-width:104px;padding:3px 5px;flex:0 0 auto}
.mark.has-icon img{width:auto;height:100%;max-width:100%;object-fit:contain;display:block;
  filter:drop-shadow(0 1px 2px #060b08aa)}
.card[data-r="2"] .mark{border-left-color:var(--r2);color:#cfe4c8}
.card[data-r="3"] .mark{border-left-color:var(--r3);color:#d3e6f2}
.card[data-r="4"] .mark{border-left-color:var(--r4);color:#f0dcb4}
.card[data-r="5"] .mark{border-left-color:var(--r5);color:#ecd9f5}
.title{min-width:0;flex:1}
.title h3{margin:0;font-size:.98rem;font-weight:700;letter-spacing:.01em;overflow-wrap:anywhere}
.tags{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.22rem}
.tag{font-size:.68rem;letter-spacing:.06em;padding:.1rem .4rem;border:1px solid #3f4f44;color:var(--muted)}
.tag.rar{color:var(--r1);border-color:#55605a}
.card[data-r="2"] .tag.rar{color:var(--r2);border-color:#4a6346}
.card[data-r="3"] .tag.rar{color:var(--r3);border-color:#445a67}
.card[data-r="4"] .tag.rar{color:var(--r4);border-color:#6b5738}
.card[data-r="5"] .tag.rar{color:var(--r5);border-color:#5d4a68}
dl.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.3rem;margin:0}
dl.facts div{background:#1b2721;border:1px solid #2f3c33;padding:.3rem .4rem}
dl.facts dt{color:var(--dim);font-size:.63rem;letter-spacing:.1em;text-transform:uppercase}
dl.facts dd{margin:.1rem 0 0;font:700 .82rem var(--mono);color:var(--ink)}
dl.facts dd small{font-weight:400;color:var(--dim);font-size:.72rem}
.desc{margin:0;color:var(--muted);font-size:.83rem;line-height:1.66;white-space:pre-line}
.desc.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.more{align-self:flex-start;color:var(--dim);background:none;border:0;padding:0;font-size:.76rem;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.more:hover{color:var(--amber)}
table{width:100%;border-collapse:collapse;font-size:.84rem;min-width:420px}
td.pw,th.pw{width:180px}
.loot-box>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:.2rem .6rem;flex-wrap:wrap}
.loot-box>summary::-webkit-details-marker{display:none}
.loot-box>summary:before{content:"";width:0;height:0;border-left:5px solid var(--dim);border-top:4px solid transparent;border-bottom:4px solid transparent;align-self:center;transition:transform .15s}
.loot-box[open]>summary:before{transform:rotate(90deg)}
.loot-box>summary .loot-name{font-weight:700;font-size:.98rem}
.loot-box>summary:hover .loot-name{color:var(--amber)}
.loot-box>summary .sub{margin:0}
th,td{text-align:left;padding:.42rem .5rem;border-bottom:1px solid #2c3830}
th{color:var(--dim);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600;white-space:nowrap}
td.n,th.n{text-align:right;font-family:var(--mono)}
tbody tr:hover{background:#1d2823}
.panel{background:var(--panel);border:1px solid var(--line-soft);padding:.9rem 1rem;margin-bottom:.7rem;overflow-x:auto}
.panel h3{margin:0 0 .1rem;font-size:.98rem}
.panel .sub{color:var(--dim);font-size:.78rem;margin:0 0 .7rem}
.prob{display:flex;align-items:center;gap:.5rem}
.prob>span{font-family:var(--mono);font-size:.8rem;min-width:44px;text-align:right;flex:none}
.bar{position:relative;height:5px;background:#28332b;flex:1;min-width:52px}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--amber);opacity:.75}
.two{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.note{color:var(--dim);font-size:.79rem;margin:.5rem 0 0}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line-soft);color:var(--dim);font-size:.78rem}
kbd{font:700 .72rem var(--mono);background:#222d26;border:1px solid #465548;padding:.08rem .32rem}
@media(max-width:760px){
  .two{grid-template-columns:1fr}
  table{min-width:100%}
  th,td{padding:.38rem .34rem;font-size:.78rem}
  td.pw,th.pw{width:104px}
  .prob>span{min-width:36px;font-size:.74rem}
  .bar{min-width:34px}
  .toolbar{top:0;position:static;background:none;backdrop-filter:none}
  dl.facts{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid{grid-template-columns:1fr}
  header.top{position:static}
}
</style>
</head>
<body>
<header class="top"><div class="top-in">
  <div class="brand"><b>死寂频段</b><small>Dead Frequency · 资料库</small></div>
  <nav>
    <a href="#items">物品</a><a href="#weapons">武器</a><a href="#armor">防护</a>
    <a href="#loot">容器</a><a href="#vendors">商人</a><a href="#rules">规则</a>
  </nav>
</div></header>

<div class="wrap">
  <section class="hero">
    <h1>资料库</h1>
    <p>07 号转播站能带出来的所有东西，以及它们值多少、从哪儿来。数据由 <code>src/data.ts</code> 直接生成，改完数值重跑 <code>npm run wiki</code> 即可。</p>
    <div class="stats">
      <div class="stat"><small>物品</small><b>${catalog.length}</b></div>
      <div class="stat"><small>武器</small><b>${weaponRows.length}</b></div>
      <div class="stat"><small>容器</small><b>${containerSites.length}</b></div>
      <div class="stat"><small>背包</small><b>${BAG_CAPACITY} 格</b></div>
      <div class="stat"><small>仓库</small><b>${STASH_CAPACITY} 格</b></div>
    </div>
  </section>

  <section class="items-sec" id="items">
  <h2 class="sec">物品图鉴</h2>
  <p class="sec-note">回收价＝卖给维克托能拿到的信用点。单格价值＝回收价 ÷ 占格，决定「这东西值不值得占背包」。</p>
  <div class="toolbar">
    <div class="row" id="catBar"></div>
    <div class="row" id="rarBar"></div>
    <div class="row">
      <input type="search" id="q" placeholder="搜索名称 / 代号 / 描述…" aria-label="搜索物品">
      <select id="sort" aria-label="排序">
        <option value="cat">按分类</option>
        <option value="value">按回收价</option>
        <option value="slot">按单格价值</option>
        <option value="rarity">按稀有度</option>
        <option value="weight">按重量</option>
      </select>
      <span class="count" id="count"></span>
    </div>
  </div>
  <div class="grid" id="grid"></div>
  </section>

  <h2 class="sec" id="weapons">武器</h2>
  <p class="sec-note">DPS 为「单发伤害 × 弹丸数 ÷ 射击间隔」的理论值，不含装填与后坐力造成的损失。散布为 ×1000 的弧度值，10 约等于 0.57°。</p>
  <div class="panel"><table>
    <thead><tr><th>武器</th><th>弹药</th><th class="n">单发</th><th class="n">弹匣</th><th class="n">射速</th><th class="n">装填</th><th class="n">理论 DPS</th><th class="n">散布</th><th class="n">射程</th><th>价格</th></tr></thead>
    <tbody>${weaponRows.map(w => `<tr>
      <td><b>${w.name}</b><br><small style="color:var(--dim)">${w.mode} · ${w.size} 格 · ${w.weight} kg</small></td>
      <td>${w.ammo}</td>
      <td class="n">${w.perShot}${w.pellets > 1 ? `<br><small style="color:var(--dim)">${w.pellets}×${w.damage}</small>` : ''}</td>
      <td class="n">${w.capacity}</td>
      <td class="n">${w.rpm}<br><small style="color:var(--dim)">rpm</small></td>
      <td class="n">${w.reload}s</td>
      <td class="n">${w.dps}</td>
      <td class="n">${w.spread}</td>
      <td class="n">${w.range} m</td>
      <td>${num(w.price)} <small style="color:var(--dim)">/ 回收 ${num(w.sell)}</small></td>
    </tr>`).join('')}</tbody>
  </table></div>

  <h2 class="sec" id="armor">防护与医疗</h2>
  <div class="two">
    <div class="panel"><h3>护甲</h3><p class="sub">防护＝受击时被吸收的比例；耐久随中弹下降，归零后不再防护。</p>
      <table><thead><tr><th>护甲</th><th class="n">防护</th><th class="n">耐久</th><th class="n">重量</th><th class="n">价格</th></tr></thead>
      <tbody>${armorRows.map(a => `<tr><td>${a.name}</td><td class="n">${a.protection}%</td><td class="n">${a.durability}</td><td class="n">${a.weight} kg</td><td class="n">${num(a.price)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel"><h3>医疗</h3><p class="sub">局内按 <kbd>H</kbd> 使用，读条期间移动会被打断。</p>
      <table><thead><tr><th>物品</th><th class="n">回复</th><th class="n">堆叠</th><th class="n">重量</th><th class="n">价格</th></tr></thead>
      <tbody>${healingRows.map(h => `<tr><td>${h.name}</td><td class="n">+${h.amount}</td><td class="n">${h.stack}</td><td class="n">${h.weight} kg</td><td class="n">${num(h.price)}</td></tr>`).join('')}</tbody></table>
    </div>
  </div>

  <h2 class="sec" id="loot">容器与掉落</h2>
  <p class="sec-note">概率＝该物品在一次抽取里出现的权重占比；期望＝概率 × 平均数量 × 回收价，一箱取 ${loot[0].draws[0]}–${loot[0].draws[1]} 次。</p>
  ${loot.map((box, index) => `<details class="panel loot-box"${index === 0 ? ' open' : ''}>
    <summary><span class="loot-name">${box.name}容器</span><span class="sub">${box.sites} 处 · 每箱 ${box.draws[0]}–${box.draws[1]} 抽 · 单箱期望约 ${num(box.expected)} CR</span></summary>
    <table class="loot-table"><thead><tr><th>物品</th><th class="pw">概率</th><th class="n">数量</th><th class="n">期望值</th></tr></thead>
    <tbody>${box.rows.map(row => `<tr>
      <td>${row.name} <small style="color:var(--dim)">${row.catName} · ${row.rarity}</small></td>
      <td><div class="prob"><span>${row.chance}%</span><div class="bar"><i style="width:${Math.round(row.chance / box.max * 100)}%"></i></div></div></td>
      <td class="n">${row.min === row.max ? row.min : row.min + '–' + row.max}</td>
      <td class="n">${num(row.per)}</td>
    </tr>`).join('')}</tbody></table>
  </details>`).join('')}
  <p class="note">尸体（遗物）与掉落背包（遗落）使用同一套抽取规则，不在上表重复列出；回响体的遗物偏异常件。</p>

  <h2 class="sec" id="vendors">商人</h2>
  <div class="two">${vendorRows.map(v => `<div class="panel">
    <h3>${v.name} <small style="color:var(--dim);font-weight:400">${v.call}</small></h3>
    <table><thead><tr><th>货品</th><th class="n">数量</th><th class="n">单价</th><th class="n">总价</th></tr></thead>
    <tbody>${v.offers.map(o => `<tr><td>${o.name}</td><td class="n">×${o.qty}</td><td class="n">${num(o.unit)}</td><td class="n">${num(o.price)}</td></tr>`).join('')}</tbody></table>
  </div>`).join('')}</div>

  <h2 class="sec" id="rules">规则速查</h2>
  <div class="panel"><table>
    <thead><tr><th>项</th><th>数值</th></tr></thead>
    <tbody>
      <tr><td>行动时长</td><td>${RAID_SECONDS / 60} 分钟，最后 2 分钟提示撤离</td></tr>
      <tr><td>撤离读条</td><td>在撤离区停留 ${EXTRACT_SECONDS} 秒</td></tr>
      <tr><td>背包容量</td><td>${BAG_CAPACITY} 格（按物品占用计）</td></tr>
      <tr><td>仓库容量</td><td>${STASH_CAPACITY} 格（按堆计，撤离带回允许溢出）</td></tr>
      <tr><td>回收折价</td><td>战利品 <b>80%</b>、装备 <b>54%</b>；护甲按剩余耐久折算（22%–100%）</td></tr>
      <tr><td>死亡损失</td><td>随身装备、背包与枪内弹药全部丢失；仓库与安全箱不受影响</td></tr>
    </tbody>
  </table></div>

  <footer>
    生成时间 ${data.generated} · 物品 ${catalog.length} 件 · 数据来源 <code>src/data.ts</code> / <code>src/sector.ts</code>
  </footer>
</div>

<script>
const DATA = ${JSON.stringify(data)};
const grid = document.getElementById('grid');
const q = document.getElementById('q');
const sortSel = document.getElementById('sort');
const countEl = document.getElementById('count');
const CATS = ['all', ...new Set(DATA.catalog.map(i => i.cat))];
const catLabel = {all:'全部'};
DATA.catalog.forEach(i => catLabel[i.cat] = i.catName);
let cat = 'all', rar = 0;

const catBar = document.getElementById('catBar');
CATS.forEach(key => {
  const n = key === 'all' ? DATA.catalog.length : DATA.catalog.filter(i => i.cat === key).length;
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.dataset.cat = key;
  b.setAttribute('aria-pressed', String(key === 'all'));
  b.innerHTML = catLabel[key] + '<span class="n">' + n + '</span>';
  catBar.append(b);
});
for (let r = 1; r <= 5; r++) {
  const n = DATA.catalog.filter(i => i.r === r).length;
  const b = document.createElement('button');
  b.className = 'chip r' + r;
  b.type = 'button';
  b.dataset.rar = String(r);
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = DATA.catalog.find(i => i.r === r).rarity + '<span class="n">' + n + '</span>';
  document.getElementById('rarBar').append(b);
}
const allRar = document.createElement('button');
allRar.className = 'chip'; allRar.type = 'button'; allRar.dataset.rar = '0';
allRar.setAttribute('aria-pressed', 'true'); allRar.textContent = '全部稀有度';
document.getElementById('rarBar').prepend(allRar);

document.getElementById('catBar').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  cat = b.dataset.cat;
  catBar.querySelectorAll('[data-cat]').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
  render();
});
document.getElementById('rarBar').addEventListener('click', e => {
  const b = e.target.closest('[data-rar]'); if (!b) return;
  rar = Number(b.dataset.rar);
  e.currentTarget.querySelectorAll('[data-rar]').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
  render();
});
q.addEventListener('input', render);
sortSel.addEventListener('change', render);
grid.addEventListener('click', e => {
  const btn = e.target.closest('.more'); if (!btn) return;
  const desc = btn.previousElementSibling;
  const open = desc.classList.toggle('clamp') === false;
  btn.textContent = open ? '收起' : '展开全文';
});

const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const order = {weapon:0, ammo:1, armor:2, med:3, elec:4, ind:5, mil:6, intel:7, life:8, odd:9};
const sorters = {
  cat: (a, b) => order[a.cat] - order[b.cat] || a.name.localeCompare(b.name, 'zh'),
  value: (a, b) => b.sell - a.sell,
  slot: (a, b) => b.perSlot - a.perSlot,
  rarity: (a, b) => b.r - a.r || b.sell - a.sell,
  weight: (a, b) => b.w - a.w,
};

const KIND_LABEL = {weapon:'武器', ammo:'弹药', armor:'护甲', medical:'可用'};
function kindTag(item) {
  const label = KIND_LABEL[item.kind];
  /* 分类名已经写过就不再重复一遍（武器/护甲/弹药的 cat 名和 kind 名一样） */
  if (!label || label === item.catName) return '';
  return '<span class="tag">' + label + '</span>';
}

function card(item) {
  const long = item.description.length > 96 || item.description.includes('\\n');
  return '<article class="card" data-r="' + item.r + '">'
    + '<div class="card-head"><div class="mark' + (item.icon ? ' has-icon' : '') + '">'
    + (item.icon ? '<img src="' + item.icon + '" alt="">' : esc(item.mark)) + '</div>'
    + '<div class="title"><h3>' + esc(item.name) + '</h3><div class="tags">'
    + '<span class="tag rar">' + item.rarity + '</span>'
    + '<span class="tag">' + item.catName + '</span>'
    + kindTag(item)
    + '</div></div></div>'
    + '<dl class="facts">'
    + '<div><dt>回收</dt><dd>' + item.sell + '</dd></div>'
    + '<div><dt>单格</dt><dd>' + item.perSlot + '</dd></div>'
    + '<div><dt>占格</dt><dd>' + item.size + '</dd></div>'
    + '<div><dt>重量</dt><dd>' + item.w + '<small>kg</small></dd></div>'
    + '</dl>'
    + '<p class="desc' + (long ? ' clamp' : '') + '">' + esc(item.description) + '</p>'
    + (long ? '<button class="more" type="button">展开全文</button>' : '')
    + '</article>';
}

function render() {
  const needle = q.value.trim().toLowerCase();
  const list = DATA.catalog.filter(i =>
    (cat === 'all' || i.cat === cat) &&
    (!rar || i.r === rar) &&
    (!needle || [i.name, i.mark, i.catName, i.rarity, i.description].join(' ').toLowerCase().includes(needle))
  ).sort(sorters[sortSel.value]);
  grid.innerHTML = list.map(card).join('') || '<p class="note">没有匹配的物品。</p>';
  countEl.textContent = list.length + ' / ' + DATA.catalog.length + ' 件';
}
render();
</script>
</body>
</html>
`;

await writeFile(join(root, 'wiki', 'index.html'), html, 'utf8');
console.log(`wiki: ${catalog.length} 件物品 · ${weaponRows.length} 把枪 · ${containerSites.length} 个容器 → wiki/index.html`);
