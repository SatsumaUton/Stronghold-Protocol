// test/match/dive-projection-version.test.js —— 盟约投影按**房间版本**派生（维护者 2026-11-21）。
//
// 规则：规程的新内容只在玩家选择规程版本时生效，**不能跨版本**。
//   · 参与判定的候选 / 名字 / 描述都取自房间自己的 gd（不是写死的 8 条）；
//   · 规程房看得到 乌萨斯 / 伊比利亚 / 莱塔尼亚，看不到 拉特兰；
//   · 第二期下半房仍然只有原来那 8 条，规程新增的核心不会漏进来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ECHO_PROJECTIONS, projectionsForGd, pickProjectionOfferForGd } from '../../server/match/match/echoProjection.js';

const bondsOf = (rel) => {
  const j = JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
  return Array.isArray(j) ? j : Object.values(j);
};

const gdOf = (rel) => {
  const list = bondsOf(rel);
  return { raw: { bonds: Object.fromEntries(list.map((r) => [r.bondId, r])) } };
};

const DEFAULT_GD = gdOf('data/bonds.json');
const REG_GD = gdOf('data/versions/act3autochess-v3_1/bonds.json');

const idsOf = (gd) => projectionsForGd(gd).map((p) => p.id);

test('第二期下半：仍是写死的那 8 条，顺序也一样（不跨版本拿到规程的新核心）', () => {
  const ids = idsOf(DEFAULT_GD);
  assert.deepEqual(ids, ECHO_PROJECTIONS.map((p) => p.id), '顺序也要一致（金标稳定性）');
  assert.equal(ids.length, 8);
  assert.ok(!ids.includes('ursusShip'), '规程的乌萨斯不能出现在第二期下半');
  assert.ok(!ids.includes('iberiaShip'));
  assert.ok(!ids.includes('lethaniaShip'));
});

test('规程：新增的 3 条核心盟约进候选，缺失的拉特兰不出现', () => {
  const ids = idsOf(REG_GD);
  assert.equal(ids.length, 10, '规程有 10 条核心盟约');
  for (const id of ['ursusShip', 'iberiaShip', 'lethaniaShip']) assert.ok(ids.includes(id), `${id} 要在规程候选里`);
  assert.ok(!ids.includes('lateranoShip'), '规程没有拉特兰');
  // 顺序：原来那几条保持在前，新增的追加在后面
  assert.deepEqual(ids.slice(0, 7), ECHO_PROJECTIONS.map((p) => p.id).filter((id) => id !== 'lateranoShip'));
});

test('名字与描述取自房间版本：规程改过的效果，投影文案跟着变', () => {
  const p = projectionsForGd(REG_GD).find((x) => x.id === 'siracusaShip');
  assert.ok(p, '规程也有叙拉古');
  assert.equal(p.name, '叙拉古');
  // 规程的叙拉古描述与第二期下半不同（官方改过效果）
  const d = projectionsForGd(DEFAULT_GD).find((x) => x.id === 'siracusaShip');
  assert.notEqual(p.desc, d.desc, '两版描述应当不同（规程改过效果）');
  assert.ok(p.desc.includes('异常状态'), '规程的描述是规程的原文：' + p.desc.slice(0, 60));
});

test('满档门槛取自该版本的 thresholds（不是写死的 6）', () => {
  const yan = projectionsForGd(DEFAULT_GD).find((p) => p.id === 'yanShip');
  assert.equal(yan.tier, 9, '第二期下半的炎有 9 人档');
  const yanReg = projectionsForGd(REG_GD).find((p) => p.id === 'yanShip');
  assert.equal(yanReg.tier, 6, '规程的炎只到 6 人档');
});

test('抽候选：只在房间版本的池里抽，含「不换」的当前项', () => {
  const rng = () => 0.42;
  const offer = pickProjectionOfferForGd(rng, null, REG_GD);
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer).size, 3);
  for (const id of offer) assert.ok(idsOf(REG_GD).includes(id), `${id} 必须属于规程池`);
  const keep = pickProjectionOfferForGd(() => 0.7, 'ursusShip', REG_GD);
  assert.ok(keep.includes('ursusShip'), '当前投影一定在候选里');
});

test('没有 gd 时退回写死的表（单测 / 旧调用点不受影响）', () => {
  assert.deepEqual(idsOf(null), ECHO_PROJECTIONS.map((p) => p.id));
  assert.deepEqual(idsOf({}), ECHO_PROJECTIONS.map((p) => p.id));
});
