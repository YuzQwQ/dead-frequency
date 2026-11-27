import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Quaternion, Raycaster, Vector3 } from 'three';
import { KnifeViewModel } from '../src/knife-viewmodel.ts';
import { AssetFactory } from '../src/assets.ts';
import { armor, items, lootTables, STASH_CAPACITY } from '../src/data.ts';
import { characterKit, equip, equipmentMove, hearingFor, insert, inventoryCount, kitEntries, protectedDamage, quickGrids, rollLoot, scavKit, splitStack, stack, transfer, transferAcross, usedSpace } from '../src/inventory.ts';
import { Player } from '../src/player.ts';
import { canPlaceItem, findAvailablePosition, gridOf, movePlaced, place, registerInventory } from '../src/grid-inventory.ts';
import { Collision, Navigator } from '../src/collision.ts';
import { buildings, containerSites, exits, sectorSolids, starts } from '../src/sector.ts';
import { decode, needsRelief, newProfile, SAVE_KEY, Saves, stashHasRoom, supplyRelief } from '../src/save.ts';
import { Melee, meleeAttacks, sweepMelee } from '../src/melee.ts';

const memory = () => {
  const data=new Map();
  return {getItem:key => data.get(key) ?? null,setItem:(key,value) => data.set(key,value)};
};

test('knife blade tapers from its faces to the lower edge and tip',() => {
  const assets=new AssetFactory();
  try {
    const knife=assets.knife(false);
    const blade=knife.getObjectByName('blade');
    const vertices=blade.geometry.getAttribute('position');
    let faceHalfDepth=0, edgeHalfDepth=0, tipHalfDepth=0;
    for (let i=0;i<vertices.count;i++) {
      const halfDepth=Math.abs(vertices.getX(i));
      faceHalfDepth=Math.max(faceHalfDepth,halfDepth);
      if (vertices.getY(i)<-.0439) edgeHalfDepth=Math.max(edgeHalfDepth,halfDepth);
      if (vertices.getZ(i)<-.2119) tipHalfDepth=Math.max(tipHalfDepth,halfDepth);
    }
    assert.ok(faceHalfDepth>.007);
    assert.ok(edgeHalfDepth>0 && edgeHalfDepth<faceHalfDepth/10);
    assert.equal(tipHalfDepth,edgeHalfDepth);
    for (const detail of ['blade-channel','handle-pin','tail-mark']) {
      const [left,right]=knife.getObjectByName(detail).children;
      assert.equal(left.geometry,right.geometry);
      assert.equal(left.position.x,-right.position.x);
    }
  } finally {
    assets.dispose();
  }
});

test('first-person grips have a connected sleeve, mitten and thumb',() => {
  const assets=new AssetFactory();
  try {
    const check=(root,sleeveName,mittName,thumbName)=>{
      const sleeve=root.getObjectByName(sleeveName), mitt=root.getObjectByName(mittName);
      const thumb=root.getObjectByName(thumbName);
      assert.ok(sleeve?.geometry.groups.length===2 && mitt?.isMesh && thumb?.isMesh);
      const bounds=part=>new Box3().setFromObject(part);
      assert.ok(bounds(sleeve).intersectsBox(bounds(mitt)),sleeveName);
      assert.ok(bounds(mitt).intersectsBox(bounds(thumb)),thumbName);
    };
    const knife=assets.knife();
    check(knife,'sleeve','mitt','thumb');
    check(knife,'left-sleeve','left-mitt','left-thumb');
    assert.equal(assets.knife(false).getObjectByName('right-hand'),undefined);
    for (const id of ['k9','ar56','p12']) {
      const held=assets.gun(id).root;
      check(held,'grip-sleeve','grip-glove','grip-thumb');
      check(held,'support-sleeve','support-glove','support-thumb');
      assert.equal(assets.gun(id,false).root.getObjectByName('firing-hand'),undefined);
    }
  } finally {
    assets.dispose();
  }
});

test('knife ViewModel restores its preset and keeps the item attached through wrist edits',() => {
  const assets=new AssetFactory();
  try {
    const rig=new KnifeViewModel(assets.knife());
    const wrist=rig.root.getObjectByName('WristPivot');
    const hand=rig.root.getObjectByName('RightHand');
    const socket=rig.root.getObjectByName('ItemSocket');
    const blade=rig.root.getObjectByName('blade');
    assert.equal(wrist.parent.name,'Forearm');
    assert.equal(hand.parent.name,'PalmPivot');
    assert.equal(hand.parent.parent.parent.parent,wrist);
    assert.equal(socket.parent,hand);
    const preset=structuredClone(rig.config);
    rig.freezeRest();
    const atRest=blade.getWorldPosition(new Vector3());
    rig.update(1,4,1);
    rig.update(1.05,7,1);
    assert.deepEqual(blade.getWorldPosition(new Vector3()),atRest);
    rig.config.wrist.rotation[1]=18;
    rig.apply();
    const attached=socket.worldToLocal(blade.getWorldPosition(new Vector3()));
    assert.ok(attached.distanceTo(blade.position)<1e-6);
    assert.ok(blade.getWorldPosition(new Vector3()).distanceTo(atRest)>.01);
    rig.reset();
    assert.deepEqual(rig.config,preset);
    assert.deepEqual(blade.getWorldPosition(new Vector3()),atRest);
    const tip=rig.root.getObjectByName('fingers-tip-pivot');
    const initial=tip.getWorldPosition(new Vector3());
    rig.config.joints.fingerMiddle=20;
    rig.apply();
    assert.equal(tip.parent.name,'fingers-middle-pivot');
    assert.ok(tip.getWorldPosition(new Vector3()).distanceTo(initial)>.001);
    assert.deepEqual(blade.getWorldPosition(new Vector3()),atRest);
    rig.dispose();
  } finally {
    assets.dispose();
  }
});

test('knife attacks layer over the saved stance while keeping the blade in the socket',() => {
  const assets=new AssetFactory();
  const rig=new KnifeViewModel(assets.knife());
  try {
    const right=rig.root.getObjectByName('KnifeAttack'),left=rig.root.getObjectByName('SupportAttack');
    const blade=rig.root.getObjectByName('blade'),socket=rig.root.getObjectByName('ItemSocket');
    const preset=structuredClone(rig.config);
    rig.update(1,0,0,{kind:'light',side:-1,elapsed:meleeAttacks.light.windup});
    assert.ok(right.position.x>0);
    rig.update(1.016,0,0,{kind:'light',side:1,elapsed:meleeAttacks.light.windup});
    assert.ok(right.position.x<0);
    rig.update(1.032,0,0,{kind:'heavy',side:1,elapsed:.33});
    assert.ok(right.position.z>0);
    rig.update(1.048,0,0,{kind:'heavy',side:1,elapsed:meleeAttacks.heavy.windup});
    const direction=new Vector3(0,0,-1).applyQuaternion(blade.getWorldQuaternion(new Quaternion()));
    assert.ok(direction.z<-.8 && right.position.z<-.25 && left.position.z>0);
    assert.ok(socket.worldToLocal(blade.getWorldPosition(new Vector3())).distanceTo(blade.position)<1e-6);
    rig.update(1.064,0,0);
    assert.equal(right.position.length(),0);
    assert.equal(left.position.length(),0);
    assert.deepEqual(rig.config,preset);
  } finally {
    rig.dispose();
    assets.dispose();
  }
});

test('M4A1 carry handle leaves a clear sight line to the front post',() => {
  const assets=new AssetFactory();
  try {
    const rifle=assets.gun('ar56',false);
    rifle.root.updateMatrixWorld(true);
    const origin=new Vector3(0,rifle.sightHeight-.004,1);
    const ray=new Raycaster(origin,new Vector3(0,0,-1));
    const hits=ray.intersectObject(rifle.root,true).filter(hit=>hit.object!==rifle.flash);
    assert.equal(hits[0]?.object.name,'front-sight-post');
  } finally {
    assets.dispose();
  }
});

test('Glock 17 model matches the requested normalized slide and grip proportions',() => {
  const assets=new AssetFactory();
  try {
    const pistol=assets.gun('k9',false);
    pistol.flash.removeFromParent();
    const size=part=>new Box3().setFromObject(part).getSize(new Vector3());
    const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} ≈ ${expected}`);
    const length=size(pistol.root).z;
    const slide=size(pistol.root.getObjectByName('slide-assembly'));
    close(length,1);
    close(slide.x/length,.158);
    close(slide.y/length,.144);
    pistol.root.updateMatrixWorld(true);
    const grip=pistol.root.getObjectByName('grip');
    const edge=(fromZ,dirZ)=>new Raycaster(new Vector3(0,-.27,fromZ),new Vector3(0,0,dirZ))
      .intersectObject(grip)[0].point.z;
    close((edge(1,-1)-edge(-1,1))/length,.2);
  } finally {
    assets.dispose();
  }
});

test('knife alternates light attacks, buffers one follow-up and commits to heavy timing',() => {
  const melee=new Melee(), hits=[];
  const step=(dt,light=false,heavy=false)=>melee.step(dt,light,heavy,kind=>hits.push(kind));
  step(0,true);
  assert.equal(melee.active.side,-1);
  step(.09);
  assert.deepEqual(hits,[]);
  step(.01);
  assert.deepEqual(hits,['light']);
  step(.12);
  step(.02,true);
  step(.06);
  assert.equal(melee.active.side,1);
  step(.10);
  step(.20,false,true);
  assert.equal(melee.active,null);
  assert.deepEqual(hits,['light','light']);
  step(0,false,true);
  step(.41);
  assert.equal(melee.label,'重击蓄势');
  step(.01);
  assert.deepEqual(hits,['light','light','heavy']);
  step(.49,true);
  assert.equal(melee.label,'重刺收势');
  step(.01);
  assert.equal(melee.active,null);
  assert.equal(meleeAttacks.light.damage,20);
  assert.equal(meleeAttacks.heavy.damage,46);
});

test('knife sweep respects attack reach and cannot hit a visible enemy through cover',() => {
  const origin={x:0,y:1.45,z:0,yaw:0,pitch:0};
  const open=new Collision([]);
  const wall=new Collision([{x:0,z:-.7,w:3,d:.25,y:0,h:3,surface:'concrete'}]);
  const target=(_x,_y,_z,_dx,_dy,_dz,limit)=>limit>1.6 ? {victim:'echo',length:1.6} : null;
  assert.equal(sweepMelee('light',origin,open,target),null);
  assert.equal(sweepMelee('heavy',origin,open,target).victim,'echo');
  assert.equal(sweepMelee('heavy',origin,wall,target),null);
});

test('partially filling a stack never duplicates or exceeds capacity',() => {
  const bag=[];
  registerInventory(bag,'drawer');
  insert(bag,stack('9mm',29));
  for (let i=0;i<7;i++) insert(bag,stack('life01'));
  const source=[stack('9mm',10)];
  assert.equal(usedSpace(bag),8);
  assert.equal(transfer(source,bag,source[0]),1);
  assert.equal(inventoryCount(bag,'9mm'),30);
  assert.equal(source[0].qty,9);
  assert.equal(transfer(source,bag,source[0]),0);
});

test('grid placement rotates, checks fragmentation and rolls back illegal moves',() => {
  const source=registerInventory([],'largeBag','source');
  const target=registerInventory([],'smallBag','target');
  const board=stack('board');
  insert(source.items,board);
  const entry=source.items[0];
  for (const [x,y] of [[1,0],[1,1],[1,2],[1,3]]) {
    const blocker=stack('life01');
    place(target,blocker,{x,y,rotation:0});target.items.push(blocker);
  }
  assert.deepEqual(findAvailablePosition(target,entry),{x:0,y:0,rotation:90});
  const snapshot=JSON.stringify([source.items,target.items]);
  assert.equal(movePlaced(source,target,entry,{x:3,y:0,rotation:0}),false);
  assert.equal(movePlaced(source,target,entry,{x:0,y:0,rotation:0}),false);
  assert.equal(JSON.stringify([source.items,target.items]),snapshot);
  assert.equal(movePlaced(source,target,entry,{x:0,y:0,rotation:90}),true);
  assert.equal(movePlaced(target,target,entry,{x:0,y:1,rotation:90}),true);
  const holes=registerInventory([],'toolbox');
  for (const [x,y] of [[1,0],[0,1],[2,1],[1,2]]) {
    const item=stack('life01');place(holes,item,{x,y,rotation:0});holes.items.push(item);
  }
  assert.equal(findAvailablePosition(holes,stack('medkit')),undefined);
  assert.equal(canPlaceItem(target,entry,0,1,90,entry.key),true);
});

test('targeted stack merge preserves the source position of leftovers',() => {
  const source=registerInventory([],'drawer','from');
  const target=registerInventory([],'drawer','to');
  insert(source.items,stack('9mm',8));insert(target.items,stack('9mm',28));
  const entry=source.items[0];
  assert.equal(movePlaced(source,target,entry,{x:-1,y:0,rotation:0},{x:0,y:0}),true);
  assert.equal(target.items[0].qty,30);
  assert.deepEqual([entry.qty,entry.x,entry.y,entry.inventoryId],[6,0,0,'from']);
});

test('legacy migration retains overflow and preserves V3 coordinates in the 6×6 backpack',() => {
  const original=newProfile();
  const oldKit={gear:{secondary:original.kit.gear.secondary},bag:Array.from({length:5},()=>stack('vest'))};
  const migrated=decode({...original,kit:oldKit,version:2});
  assert.equal(inventoryCount(migrated.kit.bag,'vest'),4);
  assert.equal(inventoryCount(migrated.overflow,'vest'),1);
  const shotgun={...stack('p12'),x:5,y:0,rotation:90,inventoryId:'bag'};
  const fromV3=decode({...original,version:3,kit:{...oldKit,bag:[shotgun]}});
  const restored=decode(JSON.parse(JSON.stringify(fromV3)));
  const item=restored.kit.bag[0];
  assert.equal(restored.kit.gear.backpack.id,'packLegacy');
  assert.deepEqual([item.x,item.y,item.rotation,item.inventoryId],[5,0,90,restored.kit.gear.backpack.key+':0']);
  assert.equal(item.key,shotgun.key);
});

test('equipment swaps preserve ammo and reject incompatible or oversized items',() => {
  const rifle=stack('ar56');
  rifle.rounds=4;
  const kit={gear:{primary:rifle},bag:[]};
  registerInventory(kit.bag,'smallBag');
  insert(kit.bag,stack('k9'));
  const hand=kit.bag[0];
  assert.equal(equip(kit,kit.bag,'primary',hand),false);
  assert.equal(equip(kit,kit.bag,'armor',hand),false);
  assert.equal(equip(kit,kit.bag,'secondary',hand),true);
  assert.equal(kit.gear.primary.rounds,4);
  assert.equal(kit.gear.secondary.id,'k9');
});

test('swapping loaded backpacks preserves both item trees, and invalid destinations are atomic',() => {
  const profile=newProfile(), kit=profile.kit, old=kit.gear.backpack;
  insert(old.contents[0],stack('core'));
  const replacement=stack('packSmall');
  insert(replacement.contents[0],stack('tape'));
  insert(profile.stash,replacement);
  const next=profile.stash.find(item=>item.key===replacement.key);
  const stash=gridOf(profile.stash), slot={kit,slot:'backpack'}, at={x:0,y:0,rotation:0};
  const snapshot=JSON.stringify(profile);
  assert.equal(equipmentMove(stash,slot,next,at,[],false),true);
  assert.equal(JSON.stringify(profile),snapshot);
  assert.equal(equipmentMove(stash,slot,next,at,[],true),true);
  assert.equal(profile.stash.find(item=>item.key===old.key).contents[0][0].id,'core');
  assert.equal(kit.bag[0].id,'tape');
  assert.equal(insert(kit.bag,old),0);
  assert.equal(equipmentMove(slot,gridOf(kit.bag),next,{x:2,y:2,rotation:0},[],true),false);
  const restored=decode(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.kit.bag[0].inventoryId,replacement.key+':0');
  assert.equal(restored.stash.find(item=>item.key===old.key).contents[0][0].inventoryId,old.key+':0');
});

test('pockets and rig partitions are separate and only quick grids supply bound medical items',() => {
  const kit=characterKit('test');
  kit.gear.rig=stack('rigStandard');
  kit.gear.backpack=stack('packTactical');
  assert.equal(new Set(kit.pockets.map(grid=>gridOf(grid).inventoryId)).size,4);
  assert.equal(quickGrids(kit).length,12);
  assert.ok(quickGrids(kit).every(grid=>insert(grid,stack('medkit'))===0));
  insert(kit.bag,stack('bandage'));
  const player=new Player({x:0,z:0,heading:0},kit);
  player.hp=50;
  assert.equal(player.heal('bandage'),false);
  insert(kit.pockets[2],stack('bandage'));
  assert.equal(player.heal('bandage',kit.pockets[2][0]),true);
  assert.equal(player.hp,78);
  assert.equal(kit.bag[0].qty,1);
  kit.gear.rig=stack('rigUtility');
  const medkit=stack('medkit');
  assert.ok(quickGrids(kit).some(grid=>insert(grid,medkit)===1));
  player.hp=25;
  assert.equal(player.heal('medkit'),true);
  assert.equal(player.hp,85);
});

test('quick transfer merges before occupying an empty partition and splitting preserves the source on failure',()=>{
  const kit=characterKit('split');
  const origin=[];registerInventory(origin,'toolbox');
  insert(origin,stack('9mm',10));
  insert(kit.pockets[2],stack('9mm',28));
  assert.equal(transferAcross(origin,kit.pockets,origin[0]),10);
  assert.deepEqual(kit.pockets.map(grid=>inventoryCount(grid,'9mm')),[8,0,30,0]);
  const one=kit.pockets[0][0];
  assert.equal(splitStack(kit.pockets[0],one,2),false);
  assert.equal(one.qty,8);
  transfer(kit.pockets[0],origin,one);
  const key=origin[0].key;
  assert.equal(splitStack(origin,origin[0],2),true);
  assert.deepEqual(origin.map(item=>item.qty),[6,2]);
  assert.equal(origin[0].key,key);
  assert.notEqual(origin[1].key,key);
});

test('enemy kits are populated once, share armor rules, and retain exact gear during corpse transfers',() => {
  const sequence=[.98,.1,.1,.1,.1]; let index=0;
  const corpse=scavKit('scav:test',()=>sequence[index++] ?? .4);
  assert.equal(corpse.gear.helmet.id,'helmetHeavy');
  assert.ok(corpse.gear.rig.contents.flat().some(item=>item.id==='556'));
  assert.ok(corpse.bag.length>0);
  for (const row of kitEntries(corpse).filter(item=>item.inventoryId)) {
    const grid=[...corpse.pockets,...corpse.gear.rig.contents,corpse.bag].map(gridOf).find(g=>g.inventoryId===row.inventoryId);
    assert.equal(canPlaceItem(grid,row,row.x,row.y,row.rotation,row.key),true);
  }
  const helmet=corpse.gear.helmet, armorBefore=corpse.gear.armor.integrity;
  assert.ok(protectedDamage(corpse,20,'head')<20);
  assert.equal(corpse.gear.armor.integrity,armorBefore);
  assert.ok(helmet.integrity<62);
  assert.ok(hearingFor(corpse).range<1);
  const player=characterKit('player');
  player.gear.backpack=stack('packLegacy');
  const old=player.gear.backpack;
  const found=corpse.gear.backpack;
  assert.equal(equipmentMove({kit:corpse,slot:'backpack'},{kit:player,slot:'backpack'},found,{x:0,y:0,rotation:0},[],true),true);
  assert.equal(corpse.gear.backpack,old);
  assert.equal(player.gear.backpack,found);
  assert.equal(player.bag,found.contents[0]);
});

test('extraction routes and an approach to every cache are navigable from both starts',() => {
  const collision=new Collision(sectorSolids()), nav=new Navigator(collision);
  for (const start of starts) {
    assert.equal(collision.blocked(start.x,start.z,.31),false);
    for (const exit of exits) {
      const path=nav.path(start,exit);
      assert.ok(path.length>2);
      for (let i=1;i<path.length;i++) assert.ok(collision.clearPath(path[i-1].x,path[i-1].z,path[i].x,path[i].z,.31));
    }
    for (const cache of containerSites) {
      const approaches=[{x:cache.x+1.25,z:cache.z},{x:cache.x-1.25,z:cache.z},{x:cache.x,z:cache.z+1.25},{x:cache.x,z:cache.z-1.25}];
      assert.ok(approaches.some(p => !collision.blocked(p.x,p.z,.34) && nav.path(start,p).length>0),cache.name);
    }
  }
  for (const b of buildings) {
    assert.ok(buildings.length && nav.path(starts[0],b).length>0,b.name);
  }
});

test('sliding cannot tunnel through walls, while doors remain usable and walls occlude fire',() => {
  const collision = new Collision(sectorSolids());
  const p={x:-27,z:26};
  for (let i=0;i<90;i++) collision.slide(p,0,-.11,.31);
  assert.ok(p.z>23.5);
  assert.equal(collision.visible(-27,1.61,27,-27,1.61,21),false);
  const door={x:-21,z:26};
  for (let i=0;i<75;i++) collision.slide(door,0,-.11,.31);
  assert.ok(door.z<20.5);
});

test('loot tables place marked stacks within each container without overlaps',() => {
  for (const [kind,def] of Object.entries(lootTables)) {
    for (let i=0;i<12;i++) {
      const loot=rollLoot(kind);
      assert.ok(loot.length<=def.count[1]);
      for (const row of loot) {
        assert.ok(row.found);
        assert.ok(row.qty>0 && row.qty<=items[row.id].stack);
        assert.ok(canPlaceItem(gridOf(loot),row,row.x,row.y,row.rotation,row.key));
      }
    }
  }
});

test('save round trips, migrates v1, recovers corrupt values, and protects newer versions',() => {
  const storage=memory();
  const initial=newProfile();
  initial.version=1;
  initial.kit.gear.armor.integrity=0;
  initial.kit.gear.secondary.rounds=3;
  storage.setItem(SAVE_KEY,JSON.stringify(initial));
  const migrated=new Saves(storage);
  assert.equal(migrated.profile.version,4);
  assert.equal(migrated.profile.kit.gear.armor.integrity,0);
  assert.equal(migrated.profile.kit.gear.secondary.rounds,3);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version,4);
  storage.setItem(SAVE_KEY,'{broken');
  const recovered=new Saves(storage);
  assert.equal(recovered.profile.credits,900);
  assert.equal(storage.getItem(SAVE_KEY+'.recovery'),'{broken');
  storage.setItem(SAVE_KEY,'{"version":999}');
  const newer=new Saves(storage);
  newer.write();
  assert.equal(storage.getItem(SAVE_KEY),'{"version":999}');
  newer.reset();
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).credits,900);
  initial.kit.gear.armor.integrity=999;
  assert.equal(decode(initial).kit.gear.armor.integrity,armor.vest.durability);
});

test('escaping keeps carried loot in place, while death and interruption forfeit the kit',() => {
  const storage=memory(), saves=new Saves(storage);
  const kit=saves.deploy();
  const core=stack('core',1,true);
  insert(kit.bag,core);
  const ids=kitEntries(kit).map(entry=>entry.key);
  const result={outcome:'escaped',kills:2,elapsed:72,haul:1200,lost:0,found:1,searched:1};
  saves.finish(result,kit);
  saves.finish(result,kit);
  assert.equal(saves.profile.stats.escapes,1);
  assert.equal(saves.profile.stats.kills,2);
  assert.equal(inventoryCount(saves.profile.stash,'core'),0);
  assert.deepEqual(kitEntries(saves.profile.kit).map(entry=>entry.key),ids);
  assert.equal(new Saves(storage).profile.kit.bag[0].found,undefined);
  assert.ok(saves.profile.kit.gear.secondary);
  const next=saves.deploy();
  const interrupted=new Saves(storage);
  assert.equal(interrupted.profile.active,false);
  assert.deepEqual(kitEntries(interrupted.profile.kit),[]);
  assert.equal(interrupted.profile.kit.pockets.length,4);
  saves.finish({...result,outcome:'dead'},next);
  assert.deepEqual(kitEntries(new Saves(storage).profile.kit),[]);
  assert.equal(saves.profile.stats.raids,2);
});

test('free relief restores a weapon and supplies when funds and weapons are exhausted',() => {
  const profile=newProfile();
  profile.credits=0;
  profile.stash=[];
  profile.kit={gear:{},bag:[]};
  assert.equal(needsRelief(profile),true);
  assert.equal(supplyRelief(profile),true);
  assert.equal(profile.kit.gear.secondary.id,'k9');
  assert.equal(inventoryCount(profile.stash,'9mm'),18);
  assert.equal(supplyRelief(profile),false);
});

test('every container tier has at least two sites',() => {
  const counts={};
  for (const site of containerSites) counts[site.kind]=(counts[site.kind]||0)+1;
  for (const kind of ['tool','file','supply','medical','sealed','anomaly']) {
    assert.ok((counts[kind]||0)>=2,`${kind} 只有 ${counts[kind]||0} 个容器`);
  }
});

test('weapon names and calibers follow the tide arsenal',() => {
  /* 型号必须和潮汐线军械库一致，别再出现自造编号 */
  assert.equal(items.k9.name,'Glock 17');
  assert.equal(items.ar56.name,'M4A1');
  assert.equal(items.p12.name,'Remington 870');
  assert.equal(items['9mm'].name,'9×19mm 弹');
  assert.equal(items['556'].name,'5.56×45mm 弹');
  assert.equal(items['12g'].name,'12 号鹿弹');
  assert.ok(items['9mm'].description.includes('Glock 17'));
  assert.ok(items['556'].description.includes('M4A1'));
  assert.ok(items['12g'].description.includes('Remington 870'));
});

test('stash capacity blocks new stacks but still accepts merges',() => {
  const profile=newProfile();
  profile.stash.length=0;
  const grid=gridOf(profile.stash);
  for (let i=0;i<STASH_CAPACITY;i++) {
    const entry=stack('relay',1);
    place(grid,entry,{x:i%grid.columns,y:Math.floor(i/grid.columns),rotation:0});
    profile.stash.push(entry);
  }
  assert.equal(profile.stash.length,STASH_CAPACITY);
  /* 已有一堆没满的同类物资还能并进去 */
  assert.equal(stashHasRoom(profile,'relay'),true);
  /* 没有同类堆的新物资进不来 */
  assert.equal(stashHasRoom(profile,'bandage'),false);
  /* 不可堆叠的装备即使同款也放不进 */
  assert.equal(stashHasRoom(profile,'vest'),false);
  profile.stash.pop();
  assert.equal(stashHasRoom(profile,'bandage'),true);
});

test('Remington 870 pumps without entering the receiver collar and carries only the support hand',() => {
  const assets=new AssetFactory();
  try {
    const studio=assets.gun('p12',false), held=assets.gun('p12');
    const pump=studio.root.getObjectByName('pump');
    const collar=studio.root.getObjectByName('fore-collar');
    const hand=held.root.getObjectByName('support-hand');
    const receiver=held.root.getObjectByName('receiver');
    assert.ok(pump && collar && hand && receiver);
    assert.equal(hand.parent.name,'pump');
    assert.equal(studio.root.getObjectByName('support-hand'),undefined);
    assert.ok(studio.root.getObjectByName('stock') && held.root.getObjectByName('heel'));
    assert.equal(held.root.getObjectByName('stock-neck'),undefined);
    studio.root.traverse(part=>{
      if (!part.isMesh) return;
      const inHand=held.root.getObjectByName(part.name);
      assert.equal(inHand.geometry,part.geometry,part.name);
      assert.deepEqual(inHand.position,part.position,part.name);
      assert.deepEqual(inHand.rotation.toArray(),part.rotation.toArray(),part.name);
    });
    const sight=studio.root.getObjectByName('sight-marker');
    const tube=studio.root.getObjectByName('forward-tube');
    assert.ok(new Box3().setFromObject(sight).intersectsBox(new Box3().setFromObject(tube)));
    const initial=hand.getWorldPosition(new Vector3());
    const muzzle=held.flash.getWorldPosition(new Vector3());
    for (const fraction of [0,.25,.5,.75,1]) {
      studio.posePump(fraction);
      held.posePump(fraction);
      assert.ok(new Box3().setFromObject(pump).max.z < new Box3().setFromObject(collar).min.z);
      assert.deepEqual(held.flash.getWorldPosition(new Vector3()),muzzle);
    }
    assert.ok(hand.getWorldPosition(new Vector3()).z>initial.z);
    held.posePump(0);
    assert.deepEqual(hand.getWorldPosition(new Vector3()),initial);
  } finally {
    assets.dispose();
  }
});
