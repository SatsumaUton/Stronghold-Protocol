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

// 立绘 / 头像 / 模型：**文件存在**且**属于本人**（2026-11-07 维护者要求：「确认所有干员的立绘显示正常，
// 不要因为切换皮肤导致立绘使用错误」）。
// 只有拿到素材目录时才校验（纯代码检出没有 public/assets，自动跳过）；
// 归属规则：路径里必须出现本人的 charId（或这套皮肤自己的 skinId），否则就是「用了别人的图」。
test('立绘 / 头像 / 模型文件都在，且都属于本人', () => {
  const candidates = [join(ROOT, 'public', 'assets'), join(ROOT, '..', 'shared', 'assets')];
  const assetsDir = candidates.find((p) => existsSync(p));
  if (!assetsDir) return; // 没有素材（纯代码检出）：跳过
  const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
  const has = (u) => { const r = relOf(u); return !r || existsSync(join(assetsDir, r)); };
  const belongs = (u, charId, skinId = null) => {
    const r = relOf(u);
    return !r || r.includes(charId) || (skinId ? r.includes(skinId) : false);
  };
  const problems = [];
  const check = (where, url, charId, skinId = null) => {
    if (!url) return;
    if (!has(url)) problems.push(`缺文件 ${where} → ${relOf(url)}`);
    else if (!belongs(url, charId, skinId)) problems.push(`别人的图 ${where} → ${relOf(url)}`);
  };
  for (const [charId, ch] of Object.entries(assets.chars || {})) {
    for (const k of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) check(`${charId}.${k}`, ch[k], charId);
    for (const side of ['front', 'back']) {
      const s = ch.spine && ch.spine[side];
      if (!s) continue;
      check(`${charId}.spine.${side}.skel`, s.skel, charId);
      check(`${charId}.spine.${side}.atlas`, s.atlas, charId);
      for (const t of Array.isArray(s.textures) ? s.textures : []) check(`${charId}.spine.${side}.tex`, t, charId);
    }
    for (const [skinId, sk] of Object.entries(ch.skins || {})) {
      for (const k of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) check(`${charId}/${skinId}.${k}`, sk && sk[k], charId, skinId);
      for (const side of ['front', 'back']) {
        const s = sk && sk.spine && sk.spine[side];
        if (!s) continue;
        check(`${charId}/${skinId}.spine.${side}.skel`, s.skel, charId, skinId);
        check(`${charId}/${skinId}.spine.${side}.atlas`, s.atlas, charId, skinId);
        for (const t of Array.isArray(s.textures) ? s.textures : []) check(`${charId}/${skinId}.spine.${side}.tex`, t, charId, skinId);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `素材缺失或串图 ${problems.length} 处（只列前 20）`);
});
