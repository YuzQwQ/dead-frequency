import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Vector3 } from 'three';
import { AssetFactory } from '../src/assets.ts';
import { armor, BAG_CAPACITY, items, lootTables, STASH_CAPACITY } from '../src/data.ts';
import { equip, insert, inventoryCount, rollLoot, stack, transfer, usedSpace } from '../src/inventory.ts';
import { Collision, Navigator } from '../src/collision.ts';
import { buildings, containerSites, exits, sectorSolids, starts } from '../src/sector.ts';
import { decode, needsRelief, newProfile, SAVE_KEY, Saves, stashHasRoom, supplyRelief } from '../src/save.ts';
import { Melee, meleeAttacks, sweepMelee } from '../src/melee.ts';

const memory = () => {
  const data=new Map();
  return {getItem:key => data.get(key) ?? null,setItem:(key,value) => data.set(key,value)};
};

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
  const bag=[stack('9mm',29),stack('ar56'),stack('ar56'),stack('p12')];
  const source=[stack('9mm',10)];
  assert.equal(usedSpace(bag),BAG_CAPACITY);
  assert.equal(transfer(source,bag,source[0],BAG_CAPACITY),1);
  assert.equal(inventoryCount(bag,'9mm'),30);
  assert.equal(source[0].qty,9);
  assert.equal(transfer(source,bag,source[0],BAG_CAPACITY),0);
});

test('equipment swaps preserve ammo and reject incompatible or oversized items',() => {
  const rifle=stack('ar56');
  rifle.rounds=4;
  const kit={gear:{primary:rifle},bag:[stack('k9'),stack('ar56'),stack('ar56'),stack('vest')]};
  const hand=kit.bag[0];
  assert.equal(equip(kit,kit.bag,'primary',hand),false);
  assert.equal(equip(kit,kit.bag,'armor',hand),false);
  assert.equal(equip(kit,kit.bag,'secondary',hand),true);
  assert.equal(kit.gear.primary.rounds,4);
  assert.equal(kit.gear.secondary.id,'k9');
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

test('loot tables return marked items and cap per-stack quantities',() => {
  for (const [kind,def] of Object.entries(lootTables)) {
    for (let i=0;i<12;i++) {
      const loot=rollLoot(kind);
      assert.ok(loot.length>=def.count[0] && loot.length<=def.count[1]);
      for (const row of loot) {
        assert.ok(row.found);
        assert.ok(row.qty>0 && row.qty<=items[row.id].stack);
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
  assert.equal(migrated.profile.version,2);
  assert.equal(migrated.profile.kit.gear.armor.integrity,0);
  assert.equal(migrated.profile.kit.gear.secondary.rounds,3);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version,2);
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

test('escaping credits the stash once, while death and interruption forfeit the kit',() => {
  const storage=memory(), saves=new Saves(storage);
  const kit=saves.deploy();
  insert(kit.bag,stack('core',1,true),BAG_CAPACITY);
  const result={outcome:'escaped',kills:2,elapsed:72,haul:1200,lost:0,found:1,searched:1};
  saves.finish(result,kit);
  saves.finish(result,kit);
  assert.equal(saves.profile.stats.escapes,1);
  assert.equal(saves.profile.stats.kills,2);
  assert.equal(inventoryCount(saves.profile.stash,'core'),1);
  assert.ok(saves.profile.kit.gear.secondary);
  const next=saves.deploy();
  const interrupted=new Saves(storage);
  assert.equal(interrupted.profile.active,false);
  assert.deepEqual(interrupted.profile.kit,{gear:{},bag:[]});
  saves.finish({...result,outcome:'dead'},next);
  assert.deepEqual(new Saves(storage).profile.kit,{gear:{},bag:[]});
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

test('stash capacity blocks new stacks but still accepts merges',() => {
  const profile=newProfile();
  profile.stash=[];
  for (let i=0;i<STASH_CAPACITY;i++) profile.stash.push({key:'slot-'+i,id:'relay',qty:1});
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

test('P-12 pumps without entering the receiver collar and carries only the support hand',() => {
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
    assert.equal(studio.root.getObjectByName('receiver').geometry,receiver.geometry);
    assert.ok(studio.root.getObjectByName('stock') && held.root.getObjectByName('stock-neck'));
    assert.ok(studio.root.getObjectByName('grip') && held.root.getObjectByName('grip'));
    assert.equal(held.root.getObjectByName('heel'),undefined);
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
