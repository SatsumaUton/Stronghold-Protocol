// 跨版本敌人的信息（维护者 2026-11-05 反馈）：
//
// 症状：有的敌对目标在「查看即将迎击的敌方单位」里查不到信息（名字 / 图标都没有），
//       战斗中它明明显示出来了，但点它不出说明框。
//
// 原因：深潜的波次从各版本的模板库里抽怪（server/match/match/echoCrossVersion.js），抽到
//       第一期独有的敌人时 key 带 `act1autochess:` 前缀；客户端加载的是本房版本的数据表，
//       那 6 条记录根本不在里面（enemy_1201_sfzhi / 1249_lysdb / 1254_lypa / 1275_dwlock /
//       1373_ltnhor_2 / 1376_ltndru）。于是 groupEnemies 与 resolveDetail 都拿不到记录。
//
// 修法：服务端把**本回合真正会出场**的跨版本记录随 m.public.echo.crossEnemyDefs 发下来，
//       客户端统一走 ui/enemyRecords.js 的 enemyRecord() 查找（本房数据表 → 跨版本记录）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from './harness.js';
import { pickEnemyRecord, unknownEnemyRecord } from '../../public/js/ui/enemyRecords.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** 深潜房（fake 战斗）。seed 7 + 第 20 回合的波次里就有 `act1autochess:` 前缀的怪。 */
const dive = () => makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 7, fake: true, variant: 'deepecho' });

const CROSS_KEYS = [
  'enemy_1201_sfzhi', 'enemy_1249_lysdb', 'enemy_1254_lypa',
  'enemy_1275_dwlock', 'enemy_1373_ltnhor_2', 'enemy_1376_ltndru',
];

test('本房数据表里确实没有这 6 条（问题的前提）', () => {
  const main = JSON.parse(read('data/enemies.json'));
  const arr = Array.isArray(main) ? main : (main.enemies || Object.values(main));
  const keys = new Set(arr.map((e) => e.key || e.id));
  for (const k of CROSS_KEYS) assert.equal(keys.has(k), false, `${k} 不该在本房数据表里`);
});

test('服务端把本回合的跨版本敌人记录一起发下来', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 19;
  m.startRound(20);
  const pub = m._echoPublic();
  assert.ok(pub && pub.crossEnemyDefs, 'm.public.echo 要带 crossEnemyDefs');
  // 本回合波次里出现的每一个带前缀的 key，都必须能在 crossEnemyDefs 里查到记录
  const prefixed = new Set((m.wave.spawns || []).map((s) => s.enemyKey).filter((k) => typeof k === 'string' && k.includes(':')));
  assert.ok(prefixed.size > 0, '这个回合的波次里应有跨版本敌人（否则本用例没意义）');
  for (const k of prefixed) {
    const rec = pub.crossEnemyDefs[k];
    assert.ok(rec, `${k} 的记录要一起发`);
    // 记录自身的 key 是数据表里的原名（不带版本前缀）—— 图标按它查资源
    assert.equal(rec.key, k.split(':').pop());
    assert.equal(typeof rec.name, 'string');
    assert.ok(rec.name.length > 0, '要有名字（列表与说明框都用它）');
    assert.ok(rec.stats && typeof rec.stats === 'object', '要有数值（说明框的数据表）');
  }
  // 没有前缀的普通敌人不重复发（客户端数据表里有）
  for (const k of Object.keys(pub.crossEnemyDefs)) assert.ok(k.includes(':'), `${k} 不该进 crossEnemyDefs`);
});

test('准备阶段的敌方情报：带前缀的行也能查到记录（客户端回退路径）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 19;
  m.startRound(20);
  const ps = h.ps('p_0');
  const rows = m.nextEnemiesFor(ps);
  const cross = m._echoPublic().crossEnemyDefs;
  const prefixedRows = rows.filter((r) => String(r.enemyKey).includes(':'));
  assert.ok(prefixedRows.length > 0, '情报里应有跨版本敌人');
  for (const r of prefixedRows) {
    // 客户端 groupEnemies 的回退：本房数据表没有 → 用 crossEnemyDefs
    const rec = pickEnemyRecord(r.enemyKey, null, cross);
    assert.ok(rec, `${r.enemyKey} 要能查到记录（否则列表里只有一串英文 key）`);
    assert.notEqual(rec.name, r.enemyKey);
  }
});

test('boss 返场回合的分组波次也覆盖（crossEnemyDefs 不能只看普通波次）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // 合成一个 boss 分组波次：结构同 phases.js 的 this.bossWaves = [{ players, wave }]
  m.bossWaves = [{ players: ['p_0'], wave: { spawns: [{ enemyKey: 'act1autochess:enemy_1376_ltndru', count: 1 }] } }];
  m.wave = null;
  const defs = m._echoCrossEnemyDefs();
  assert.ok(defs['act1autochess:enemy_1376_ltndru'], 'boss 波次里的跨版本敌人也要带上');
});

test('普通房间一行都不发（不受影响）', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, seed: 7, fake: true });
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m._echoPublic(), null);
});

test('客户端查找：本房数据表优先，其次跨版本记录，都没有就 null', () => {
  const direct = { key: 'enemy_x', name: '本地' };
  assert.equal(pickEnemyRecord('enemy_x', direct, { enemy_x: { name: '跨版本' } }), direct);
  assert.deepEqual(pickEnemyRecord('act1autochess:enemy_y', null, { 'act1autochess:enemy_y': { name: '跨版本' } }), { name: '跨版本' });
  assert.equal(pickEnemyRecord('nope', null, {}), null);
  assert.equal(pickEnemyRecord(null, null, null), null);
});

test('被「迷雾 / 遮蔽」藏起来的占位敌人有可读的名字（不再显示英文 key）', () => {
  const rec = unknownEnemyRecord();
  assert.equal(rec.key, 'enemy_unknown');
  assert.equal(typeof rec.name, 'string');
  assert.notEqual(rec.name, 'enemy_unknown');
  assert.ok(rec.unknown === true);
});

test('客户端所有「按 key 查敌人」的地方都走 enemyRecord（防止再各查各的）', () => {
  const drawer = read('public/js/ui/enemyDrawer.js');
  assert.match(drawer, /groupEnemies\(priv\?\.nextEnemies, \(k\) => enemyRecord\(k\)\)/);
  assert.doesNotMatch(drawer, /groupEnemies\(priv\?\.nextEnemies, \(k\) => data\.lookup\('enemies'/);
  const detail = read('public/js/ui/detailPanel.js');
  assert.doesNotMatch(detail, /data\.lookup\('enemies',/);
  assert.match(detail, /enemyRecord\(u\.defId\)/);
  assert.match(detail, /enemyRecord\(target\.id\)/);
});
