// 跨版本敌人的**素材**解析（维护者 2026-11-07：备战阶段部分敌对目标看不到样子，战斗中也是）。
//
// 深潜的波次会从别的版本的数据表里抽怪（server/match/match/echoCrossVersion.js），key 带
// `<version>:` 前缀，例如 `act1autochess:enemy_1275_dwlock`。而 `data/assets.json`（以及素材站上的
// 文件）一律按**裸 id** 索引 —— 素材与版本无关。以前客户端拿带前缀的 key 直接查清单，查不到：
//   · 备战「敌方情报」列表 / 地图上的预览：占位菱形；
//   · 战斗中的单位：没有模型（spine 也是同一个查法）。
// 现在 `assets.js` / `ui/assetUrls.js` 在查素材前统一剥掉版本前缀（`plainAssetId`）。
//
// 另一件事（本文件也钉住）：这 6 只跨版本敌人**没有网页模型**，素材站上只有图标
// （tools/assets/local-enemy-spines.json：模型只在本地客户端里）。所以它们的画面回退是
// 「菱形 + 敌人自己的图标」，而不是「菱形 + 水滴」。图标能查到就说明回退是对的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssets, plainAssetId } from '../../public/js/assets.js';
import { enemyIconUrl } from '../../public/js/ui/assetUrls.js';

const SPINE = { skel: '/assets/spine/enemy/enemy_1275_dwlock/enemy_1275_dwlock.skel', atlas: '/assets/spine/enemy/enemy_1275_dwlock/enemy_1275_dwlock.atlas', textures: ['/assets/spine/enemy/enemy_1275_dwlock/enemy_1275_dwlock.png'], anims: { idle: 'Idle' } };
const M = {
  enemies: {
    // 素材清单里只有裸 id（跨版本敌人也一样）
    enemy_1275_dwlock: { icon: '/assets/enemy/icon/enemy_1275_dwlock.png', spine: SPINE },
    enemy_1000_gopro_2: { icon: '/assets/enemy/icon/enemy_1000_gopro_2.png' },
    enemy_1000_gopro: { icon: '/assets/enemy/icon/enemy_1000_gopro.png' },
  },
};

test('plainAssetId 只剥版本前缀（裸 id / 其它形状原样返回）', () => {
  assert.equal(plainAssetId('act1autochess:enemy_1275_dwlock'), 'enemy_1275_dwlock');
  assert.equal(plainAssetId('act1autochess-v1_1:enemy_1275_dwlock'), 'enemy_1275_dwlock');
  assert.equal(plainAssetId('enemy_1275_dwlock'), 'enemy_1275_dwlock');
  assert.equal(plainAssetId(''), '');
});

test('战斗单位：跨版本 key 也能查到图标（占位菱形里画的是敌人图标，不是水滴）', () => {
  const a = createAssets({ manifest: M });
  assert.equal(a.picture('act1autochess:enemy_1275_dwlock'), '/assets/enemy/icon/enemy_1275_dwlock.png');
  assert.equal(a.picture('enemy_1275_dwlock'), '/assets/enemy/icon/enemy_1275_dwlock.png', '裸 id 不变');
});

test('战斗单位：跨版本 key 也能查到模型（有网页模型时直接画模型）', () => {
  const a = createAssets({ manifest: M });
  assert.deepEqual(a.spineEntry('act1autochess:enemy_1275_dwlock'), SPINE);
  assert.deepEqual(a.spineEntry('enemy_1275_dwlock'), SPINE);
});

test('只有本地模型的敌人（6 只跨版本怪）：网页上没有模型，但图标一定查得到', () => {
  // 清单形状照 data/assets.json：只有 icon + spineLocal，没有 spine
  const local = { enemies: { enemy_1376_ltndru: { icon: '/assets/enemy/icon/enemy_1376_ltndru.png', spineLocal: { group: 'spine/enemy/enemy_1376_ltndru', skel: 'x.skel', atlas: 'x.atlas', textures: ['x.png'], anims: { idle: 'Idle' } } } } };
  const a = createAssets({ manifest: local });
  assert.equal(a.spineEntry('act1autochess:enemy_1376_ltndru'), null, '没有网页模型（渲染器回退到菱形）');
  assert.equal(a.picture('act1autochess:enemy_1376_ltndru'), '/assets/enemy/icon/enemy_1376_ltndru.png', '菱形里画敌人图标');
});

test('UI 缩略图（敌方情报列表）：跨版本 key 也能查到图标，`_2` / `_3` 变体仍回退到基础怪', () => {
  assert.equal(enemyIconUrl(M, 'act1autochess:enemy_1275_dwlock'), '/assets/enemy/icon/enemy_1275_dwlock.png');
  assert.equal(enemyIconUrl(M, 'enemy_1275_dwlock'), '/assets/enemy/icon/enemy_1275_dwlock.png');
  assert.equal(enemyIconUrl(M, 'act1autochess:enemy_1000_gopro_3'), '/assets/enemy/icon/enemy_1000_gopro.png', '`_3` 回退到基础怪');
  assert.equal(enemyIconUrl(M, 'act1autochess:enemy_nope'), null);
  assert.equal(enemyIconUrl(M, null), null);
});
