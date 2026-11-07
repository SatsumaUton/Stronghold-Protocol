// test/assets-skins.test.js — 皮肤的登记**不许被静默清空**（2026-11-07 事故：一次 data/assets.json 的重写
// 把已登记的皮肤条目冲掉，界面退回到「只有默认」，而且没有任何测试会红）。
//
// 这道闸只守「规模」和「形状」，不校验具体某套皮肤（那是数据维护的事）：
//   1. `chars[<id>].skins` 的干员数与皮肤条目数不得低于 `data/assets.skins-floor.json` 里记录的地板；
//   2. 每条皮肤必须有 name + portrait + avatar，且 spine（若有）三段齐全。
// 地板文件由 `node tools/skins-floor.mjs --update` 刷新；**只允许调高**，调低必须在提交信息里写明原因。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8'));

const assets = load('assets.json');
const floorPath = join(ROOT, 'data', 'assets.skins-floor.json');
const floor = existsSync(floorPath) ? load('assets.skins-floor.json') : { owners: 0, entries: 0 };

const withSkins = Object.entries(assets.chars || {}).filter(([, v]) => v && v.skins && Object.keys(v.skins).length);
const entries = withSkins.reduce((n, [, v]) => n + Object.keys(v.skins).length, 0);

test('皮肤的规模不得低于记录的地板（防止被静默清空）', () => {
  assert.ok(withSkins.length >= floor.owners,
    `有皮肤的干员从 ${floor.owners} 掉到 ${withSkins.length}：data/assets.json 被重写过？`);
  assert.ok(entries >= floor.entries,
    `皮肤条目从 ${floor.entries} 掉到 ${entries}：data/assets.json 被重写过？`);
});

test('每条皮肤都有名字与立绘/头像路径', () => {
  for (const [charId, v] of withSkins) {
    for (const [key, s] of Object.entries(v.skins)) {
      assert.ok(s && typeof s.name === 'string' && s.name, `${charId}/${key}: name`);
      assert.ok(typeof s.portrait === 'string' && s.portrait, `${charId}/${key}: portrait`);
      assert.ok(typeof s.avatar === 'string' && s.avatar, `${charId}/${key}: avatar`);
      if (s.spine) {
        for (const side of ['front', 'back']) {
          if (!s.spine[side]) continue;
          assert.ok(typeof s.spine[side].skel === 'string' && s.spine[side].skel, `${charId}/${key}: spine.${side}.skel`);
          assert.ok(typeof s.spine[side].atlas === 'string' && s.spine[side].atlas, `${charId}/${key}: spine.${side}.atlas`);
        }
      }
    }
  }
});
