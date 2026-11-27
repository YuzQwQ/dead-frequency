/* 物品图标：由 scripts/build-item-icons.mjs 从模型直接渲染，透明背景 PNG。
   这里静态 import 而不是运行时拼路径，是为了让离线单文件构建能内联成 base64——
   vite 的 assetsInlineLimit 只作用于构建期已知的静态引用。 */
import k9 from '../assets/icons/k9.png';
import ar56 from '../assets/icons/ar56.png';
import p12 from '../assets/icons/p12.png';
import med02 from '../assets/icons/med02.png';
import med03 from '../assets/icons/med03.png';
import relay from '../assets/icons/relay.png';
import elec01 from '../assets/icons/elec01.png';
import elec03 from '../assets/icons/elec03.png';
import elec02 from '../assets/icons/elec02.png';
import board from '../assets/icons/board.png';
import copper from '../assets/icons/copper.png';
import ind02 from '../assets/icons/ind02.png';
import ind03 from '../assets/icons/ind03.png';
import tape from '../assets/icons/tape.png';
import intel from '../assets/icons/intel.png';
import life02 from '../assets/icons/life02.png';
import art03 from '../assets/icons/art03.png';
import mil06 from '../assets/icons/mil06.png';
import life01 from '../assets/icons/life01.png';
import life06 from '../assets/icons/life06.png';
import life03 from '../assets/icons/life03.png';
import life08 from '../assets/icons/life08.png';
import life11 from '../assets/icons/life11.png';
import life33 from '../assets/icons/life33.png';
import crystal from '../assets/icons/crystal.png';
import core from '../assets/icons/core.png';
import ammo9 from '../assets/icons/9mm.png';
import ammo556 from '../assets/icons/556.png';
import ammo12 from '../assets/icons/12g.png';
import vest from '../assets/icons/vest.png';
import plate from '../assets/icons/plate.png';
import bandage from '../assets/icons/bandage.png';
import medkit from '../assets/icons/medkit.png';
import helmetLight from '../assets/icons/helmetLight.png';
import helmetHeavy from '../assets/icons/helmetHeavy.png';
import headsetScout from '../assets/icons/headsetScout.png';
import headsetQuiet from '../assets/icons/headsetQuiet.png';
import rigLight from '../assets/icons/rigLight.png';
import rigStandard from '../assets/icons/rigStandard.png';
import rigUtility from '../assets/icons/rigUtility.png';
import packSmall from '../assets/icons/packSmall.png';
import packTactical from '../assets/icons/packTactical.png';
import packLegacy from '../assets/icons/packLegacy.png';

export const itemIcons:Readonly<Record<string,string>> = {
  k9, ar56, p12, med02, med03, relay, elec01, elec03, elec02, board, copper, ind02, ind03,
  tape, intel, life02, art03, mil06, life01, life06, life03, life08, life11, life33, crystal, core,
  '9mm':ammo9, '556':ammo556, '12g':ammo12, vest, plate, bandage, medkit,
  helmetLight, helmetHeavy, headsetScout, headsetQuiet,
  rigLight, rigStandard, rigUtility, packSmall, packTactical, packLegacy,
};

/* 没有图标就退回代号，界面不会出现空洞 */
export function itemIcon(id:string):string | undefined {
  return itemIcons[id];
}
