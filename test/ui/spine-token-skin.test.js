// 召唤物随主人皮肤换皮：**本地素材包形态**（tokens[id].skins[x].spineLocal）必须真的被用上。
//
// 维护者 2026-11-18：「我这里切换了干员皮肤并没有看到干员的召唤物被改变 … 这个是干员白铁」，
// 随后追加「凯瑟琳的召唤物也没变 … 确保所有拥有召唤物的干员的召唤物都会根据皮肤更换」。
//
// 根因：assets.js 的 spineEntry() 对 token 原本只看 `skin.spine`（资源站地址形态），
// 而 tools/import-token-skins.mjs / import-from-resource-zip.mjs 写的是 **spineLocal**
// （本地素材包，data/local-assets.json 的分组）—— 于是 21 套召唤物皮肤一套都用不上。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spineEntry } from '../../public/js/assets.js';

const file = (group, name) => ({ path: `/assets/local/${group}/${name}`, kind: 'TextAsset' });
const groupOf = (g, base) => ({
  [`${base}.atlas`]: file(g, `${base}.atlas`),
  [`${base}.png`]: file(g, `${base}.png`),
  [`${base}.skel`]: file(g, `${base}.skel`),
});
const spineLocal = (g, base) => ({ group: g, skel: `${base}.skel`, atlas: `${base}.atlas`, textures: [`${base}.png`], pim: false, anims: { idle: 'Idle' } });

const BASE = 'token_10041_cathy_catsld';
const SKIN = 'token_10041_cathy_catsld_kitchen_5';
const manifest = {
  tokens: {
    [BASE]: {
      avatar: '/assets/token/avatar/x.png',
      spineLocal: spineLocal(`spine/token/${BASE}`, BASE),
      skins: { char_4162_cathy_kitchen_5: { spineLocal: spineLocal(`spine/token/${SKIN}`, SKIN) } },
    },
  },
};
const local = {
  groups: {
    [`spine/token/${BASE}`]: groupOf(`spine/token/${BASE}`, BASE),
    [`spine/token/${SKIN}`]: groupOf(`spine/token/${SKIN}`, SKIN),
  },
};

test('★ 召唤物皮肤（本地素材包形态）会被用上', () => {
  const withSkin = spineEntry(manifest, BASE, { skin: 'char_4162_cathy_kitchen_5', local });
  assert.ok(withSkin, '带皮肤时必须拿到一个模型');
  assert.match(withSkin.skel, new RegExp(SKIN), '★ 要画皮肤那套模型，而不是召唤物本体');
});

test('不穿皮肤时画召唤物本体（回退不变）', () => {
  const plain = spineEntry(manifest, BASE, { local });
  assert.ok(plain);
  assert.match(plain.skel, new RegExp(`${BASE}\\.skel$`), '不穿皮肤要回落到本体模型');
});

test('皮肤在清单里但本地没有文件 → 回落到本体模型，不报错', () => {
  const partial = { groups: { [`spine/token/${BASE}`]: groupOf(`spine/token/${BASE}`, BASE) } };
  const r = spineEntry(manifest, BASE, { skin: 'char_4162_cathy_kitchen_5', local: partial });
  assert.ok(r);
  assert.match(r.skel, new RegExp(`${BASE}\\.skel$`));
});
