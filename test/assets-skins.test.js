// test/assets-skins.test.js — 皮肤的登记**不许被静默清空**（2026-11-07 事故：一次 data/assets.json 的重写
// 把已登记的皮肤条目冲掉，界面退回到「只有默认」，而且没有任何测试会红）。
//
// 这道闸只守「规模」和「形状」，不校验具体某套皮肤（那是数据维护的事）：
//   1. `chars[<id>].skins` 的干员数与皮肤条目数不得低于 `data/assets.skins-floor.json` 里记录的地板；
//   2. 每条皮肤必须有 name + portrait + avatar，且 spine（若有）三段齐全。
// 地板文件由 `node tools/skins-floor.mjs --update` 刷新；**只允许调高**，调低必须在提交信息里写明原因。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

// 皮肤模型必须带骨骼元数据（2026-11-07 玩家反馈「换了皮肤，战斗中干员的模型没变」）：
// 批量导入的 300 套皮肤模型里有 297 套只有 skel / atlas / textures 三个地址、**没有 `anims`**，
// 而客户端 `assets.js validSpine()` 要求 `anims` 是对象，于是判定模型不可用、退回干员本体模型
// （立绘和头像都换了，战斗里的小人不变）。修法见 tools/fix-skin-spine-meta.mjs。
test('皮肤模型都带骨骼元数据（缺 anims 会退回本体模型）', () => {
  const problems = [];
  for (const [charId, ch] of withSkins) {
    for (const [key, s] of Object.entries(ch.skins || {})) {
      if (!s || typeof s !== 'object' || !s.spine || typeof s.spine !== 'object') continue;
      for (const side of ['front', 'back']) {
        const sp = s.spine[side];
        if (!sp) continue;
        if (typeof sp.skel !== 'string' || !sp.skel) problems.push(`${charId}/${key}.spine.${side}: 缺 skel`);
        if (typeof sp.atlas !== 'string' || !sp.atlas) problems.push(`${charId}/${key}.spine.${side}: 缺 atlas`);
        if (!sp.anims || typeof sp.anims !== 'object' || Array.isArray(sp.anims)) {
          problems.push(`${charId}/${key}.spine.${side}: 缺 anims（客户端会退回本体模型）`);
          continue;
        }
        if (!sp.anims.idle && !sp.anims.move) problems.push(`${charId}/${key}.spine.${side}: anims 里没有 idle/move`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `皮肤骨骼元数据有问题 ${problems.length} 处（只列前 20）`);
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

// 立绘的**比例**与**内容归属**（2026-11-07：7 套皮肤把方形插画（2200×2200 等）写进了
// `char/skin/<皮肤>.png`，卡面按 180×360 显示，只剩中间一条被裁过的插画；另外暴行「又一年秋季」
// 的立绘是拿插画裁成 1:2 的，比例对但内容不是官方胸像）。
//   - portrait / portraitE2 必须是 1:2 的竖图（官方胸像 180×360）；
//   - 非 e2 皮肤的立绘不能和本人本体立绘是同一张图（否则换了皮肤还是本体那张）。
// 内容是否「官方那张」由 `node tools/audit-portrait-mirror.mjs` 对照镜像站核对（要联网，不进 CI）。
test('立绘比例是 1:2，且换皮肤不会退回本体立绘', () => {
  const candidates = [join(ROOT, 'public', 'assets'), join(ROOT, '..', 'shared', 'assets')];
  const assetsDir = candidates.find((p) => existsSync(p));
  if (!assetsDir) return; // 没有素材（纯代码检出）：跳过

  const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
  const fileOf = (u) => { const r = relOf(u); return r ? join(assetsDir, r) : null; };

  /** PNG / WebP 的宽高；读不出来返回 null。 */
  const sizeOf = (file) => {
    if (!file || !existsSync(file)) return null;
    const b = readFileSync(file);
    if (b.length < 30) return null;
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    }
    return null;
  };
  const isPortraitShape = (s) => !!s && Math.abs(s.w / s.h - 0.5) <= 0.015;

  const problems = [];
  const shape = (where, url) => {
    if (!url) return;
    const s = sizeOf(fileOf(url));
    if (!s) return;                                   // 缺文件由上一条测试报
    if (!isPortraitShape(s)) problems.push(`立绘不是 1:2 ${where} → ${relOf(url)}（${s.w}×${s.h}）`);
  };
  const fingerprint = (url) => {
    const file = fileOf(url);
    return file && existsSync(file) ? crypto.createHash('md5').update(readFileSync(file)).digest('hex') : null;
  };

  for (const [charId, ch] of Object.entries(assets.chars || {})) {
    shape(`${charId}.portrait`, ch.portrait);
    shape(`${charId}.portraitE2`, ch.portraitE2);
    const base = new Set([fingerprint(ch.portrait), fingerprint(ch.portraitE2)].filter(Boolean));
    for (const [skinId, sk] of Object.entries(ch.skins || {})) {
      if (!sk || typeof sk !== 'object') continue;
      shape(`${charId}/${skinId}.portrait`, sk.portrait);
      shape(`${charId}/${skinId}.portraitE2`, sk.portraitE2);
      if (sk.type === 'e2') continue;                 // e2 皮肤本来就复用精英二立绘
      for (const k of ['portrait', 'portraitE2']) {
        const fp = fingerprint(sk[k]);
        if (fp && base.has(fp)) problems.push(`皮肤立绘就是本体立绘 ${charId}/${skinId}.${k} → ${relOf(sk[k])}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `立绘比例/归属有问题 ${problems.length} 处（只列前 20）`);
});
