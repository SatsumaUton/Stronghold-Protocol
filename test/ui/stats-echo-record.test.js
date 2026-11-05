// 对局记录里的「深渊回响」：模式列显示深渊回响（不是难度名），并且**算作第二期下半**。
//
// 维护者 2026-11-05：记录里原来只存难度，深潜的对局在列表里显示成「终极模拟 / 险境模拟」，
// 看不出这是深渊回响；版本归属也要固定成第二期下半。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecord, recordToResult, recordVersion } from '../../public/js/ui/stats.js';
import { DEFAULT_VERSION, versionById } from '../../shared/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** A settled result payload (the shape m.result has) with me on it. */
const baseResult = (over = {}) => ({
  victory: false,
  roundsPassed: 40,
  reason: 'eliminated',
  modeId: 'coop',
  difficulty: 'ABYSS',
  seed: 7,
  durationMs: 1000,
  players: [
    { playerId: 'p1', seat: 0, name: '我', isBot: false, left: false, alive: false, victory: false, roundsPassed: 40, lp: 0, bandId: null, lineup: [], bonds: [], stats: {} },
  ],
  ...over,
});

test('深潜对局：记录带 variant + echoDepth，且版本固定成第二期下半', () => {
  const rec = buildRecord(baseResult({ variant: 'deepecho', echoDepth: 40 }), { myId: 'p1', roomMode: 'coop', version: 'act1autochess' });
  assert.ok(rec, '要能建出记录');
  assert.equal(rec.variant, 'deepecho', '记录要记住这是深渊回响');
  assert.equal(rec.echoDepth, 40, '深度要一起存下来');
  // 就算房间版本是别的（这里故意传第一期），深潜也固定算第二期下半
  assert.equal(rec.version, undefined, '深潜不写 version（= 默认版本）');
  assert.equal(recordVersion(rec), DEFAULT_VERSION, '按第二期下半统计');
  assert.equal(versionById(recordVersion(rec))?.label, '第二期下半');
});

test('普通对局不受影响：照旧用房间的版本', () => {
  const rec = buildRecord(baseResult(), { myId: 'p1', roomMode: 'coop', version: 'act1autochess' });
  assert.equal(rec.variant, undefined, '普通对局没有 variant');
  assert.equal(rec.echoDepth, undefined);
  assert.equal(recordVersion(rec), 'act1autochess', '房间版本照旧');
});

test('回看结算：variant / 深度 要带回去（保持深渊主题）', () => {
  const rec = buildRecord(baseResult({ variant: 'deepecho', echoDepth: 40 }), { myId: 'p1', roomMode: 'coop' });
  const res = recordToResult(rec);
  assert.ok(res, '能回看');
  assert.equal(res.variant, 'deepecho');
  assert.equal(res.echoDepth, 40);
});

test('对局记录：深渊回响在「模式」列，难度列照旧显示难度名', () => {
  const src = read('public/js/screens/stats.js');
  assert.match(src, /rec\.variant === 'deepecho'/, '要按 variant 判断');
  assert.match(src, /st-mode is-echo/, '要有深渊回响角标');
  assert.match(src, /\$\{t\('深渊回响'\)\}/, '文案是深渊回响');
  // 列的顺序：表头 难度 在 模式 前面；行里难度格在前，深渊回响角标在模式格里（难度格后面）
  const headAt = src.indexOf('<th>${t(\'时间\')}</th>');
  const head = src.slice(headAt, src.indexOf('</thead>', headAt));
  assert.ok(head.indexOf('难度') < head.indexOf('模式'), '表头顺序 难度 → 模式');
  const rowStart = src.indexOf('<td class="st-t">');
  const rowEnd = src.indexOf('<td><span class="st-band">', rowStart);
  const cells = src.slice(rowStart, rowEnd);
  assert.ok(cells.includes('difficultyName(rec.difficulty)'), '难度格要显示难度名');
  const diffAt = cells.indexOf('difficultyName(rec.difficulty)');
  const echoAt = cells.indexOf('is-echo');
  assert.ok(diffAt >= 0 && echoAt > diffAt, '深渊回响角标要在难度格之后的模式格里');
  // 角标有样式
  const css = read('public/css/screens/stats.css');
  assert.match(css, /\.st-mode\.is-echo\s*\{/);
});
