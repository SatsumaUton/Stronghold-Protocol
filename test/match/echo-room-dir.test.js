// 「深渊回响」（深潜）房在**节点控制台**与**管理后台**的房间列表里可见。
//
// 背景（维护者 2026-11-06）：深潜房在节点侧被**故意**排除在上报的 codes 之外 ——
//   不进跨节点「公开同盟」列表，也不会被匹配器选中（管理员 / 测试名单专属，公开前隔离）。
//   代价是 rooms.json 里从来没有它们，控制台和后台的房间列表也就完全看不见深潜房在跑。
//
// 做法：节点把深潜房单独放进 echoCodes 上报。匹配服务把它**只**用于房间目录（rooms.json /
//   后台 /api/admin2/rooms），不并进 codes —— 所以公开列表、按房间码跳转、匹配行为一字未变。
//
// 这里钉住三件事：
//   1. 隔离没被破坏：codes 仍然不含 deepecho，跳转类接口也不读 echoCodes；
//   2. 目录能看到：echoCodes 进了 rooms.json，roomInfo 带出 variant；
//   3. 两个界面都按 variant 显示成「深渊回响」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// roomDir.cjs 是 CommonJS（matchmaker 那边没有 type:module），默认导入后解构
import roomDir from '../../matchmaker/roomDir.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const { dirCodes } = roomDir;

const lobby = read('server/lobby.js');
const mm = read('matchmaker/server.js');
const account = read('matchmaker/account.cjs');
const adminHtml = read('matchmaker/public/admin.html');
const dashApp = read('dashboard/public/app.js');
const dashHtml = read('dashboard/public/index.html');

test('节点上报：深潜房不进 codes，只进 echoCodes', () => {
  const at = lobby.indexOf('/api/rooms/report');
  assert.ok(at > 0, '要能找到房间上报那段');
  const block = lobby.slice(at, at + 900);
  assert.match(block, /codes: \[\.\.\.this\.rooms\.values\(\)\]\.filter\(\(r\) => r\.variant !== 'deepecho'\)/,
    'codes 必须仍然排除深潜房（公开列表 / 匹配隔离）');
  assert.match(block, /echoCodes: \[\.\.\.this\.rooms\.values\(\)\]\.filter\(\(r\) => r\.variant === 'deepecho'\)/,
    '深潜房要单独上报');
});

test('匹配服务：echoCodes 只进房间目录，跳转类接口仍只认 codes', () => {
  // 上报处理：把 echoCodes 存进目录
  assert.match(mm, /echoCodes: Array\.isArray\(d\.echoCodes\)/, '要接收并清洗 echoCodes');
  // 写 rooms.json 时合并两串
  assert.match(mm, /for \(const code of dirCodes\(v\)\)/, 'rooms.json 要包含深潜房（dirCodes 合并）');
  // 后台兜底 provider 也带上
  assert.match(mm, /echoCodes: v\.echoCodes \|\| \[\]/, 'provider 要带 echoCodes');
  // roomInfo 带出 variant（界面靠它认深潜房）
  assert.match(mm, /variant: doc\.variant === 'deepecho' \? 'deepecho' : null/, 'roomInfo 要返回 variant');
  // 按房间码找节点 / 跳转的三处仍只读 v.codes：深潜房不参与路由
  for (const route of ['/api/resolve-room', '/api/room-redirect', '/api/find-room']) {
    const at = mm.indexOf(`pathname === '${route}'`);
    assert.ok(at > 0, `${route} 还在`);
    const next = mm.indexOf('if (pathname ===', at + 10);
    const block = mm.slice(at, next > at ? next : at + 1200);
    assert.match(block, /v\.codes\.includes\(code\)/, `${route} 仍按 codes 找房`);
    assert.doesNotMatch(block, /echoCodes/, `${route} 不能读 echoCodes（深潜房不参与跳转）`);
  }
  // 后台兜底列表合并两串
  assert.match(account, /require\('\.\/roomDir\.cjs'\)\.dirCodes\(x\)/, '后台兜底列表要含深潜房（dirCodes 合并）');
});

test('管理后台：类型列显示「深渊回响」，统计与结束对局文案跟着变', () => {
  assert.match(adminHtml, /const isEcho = r\.variant === 'deepecho';/, '按 variant 判断');
  assert.match(adminHtml, /room-mode is-echo/, '要有紫色角标');
  assert.match(adminHtml, /深渊回响/, '文案是深渊回响');
  assert.match(adminHtml, /#roomBody \.room-mode\.is-echo\{/, '角标要有样式');
  assert.match(adminHtml, /· 深渊回响 ' \+ rooms\.filter\(\(x\) => x\.variant === 'deepecho'\)\.length/, '统计里要有深潜房数');
  assert.match(adminHtml, /深潜第 ' \+ round \+ ' 层/, '结束对局的确认文案要说层数');
  // 单人 / 同盟计数不能把深潜房算进去（否则「同盟」会虚高）
  assert.match(adminHtml, /x\.mode === 'solo' && x\.variant !== 'deepecho'/, '单人不计深潜');
  assert.match(adminHtml, /x\.mode === 'coop' && x\.variant !== 'deepecho'/, '同盟不计深潜');
});

test('节点控制台：同样的角标与统计，回合的 tooltip 说层数', () => {
  assert.match(dashApp, /x\.variant === 'deepecho'/, '按 variant 判断');
  assert.match(dashApp, /room-mode is-echo/, '要有紫色角标');
  assert.match(dashApp, /深渊回响/, '文案是深渊回响');
  assert.match(dashHtml, /#rooms-bar \.room-mode\.is-echo\{/, '角标要有样式');
  assert.match(dashApp, /深潜第 ' \+ x\.round \+ ' 层/, '深潜房的回合 tooltip 说层数');
  assert.match(dashApp, /x\.mode === 'solo' && x\.variant !== 'deepecho'/, '单人不计深潜');
  assert.match(dashApp, /x\.mode === 'coop' && x\.variant !== 'deepecho'/, '同盟不计深潜');
});

test('dirCodes：普通房在前、深潜房在后、去重，缺字段也不炸', () => {
  assert.deepEqual(dirCodes({ codes: ['AAAA', 'BBBB'], echoCodes: ['ZZZZ'] }), ['AAAA', 'BBBB', 'ZZZZ']);
  assert.deepEqual(dirCodes({ codes: ['AAAA'], echoCodes: [] }), ['AAAA']);
  assert.deepEqual(dirCodes({ echoCodes: ['ZZZZ'] }), ['ZZZZ'], '只有深潜房时目录里也要有它');
  assert.deepEqual(dirCodes({ codes: ['AAAA', 'AAAA'], echoCodes: ['AAAA'] }), ['AAAA'], '同一个码只出现一次');
  assert.deepEqual(dirCodes({ codes: ['AAAA', null, 42], echoCodes: ['', 'ZZZZ'] }), ['AAAA', 'ZZZZ'], '非字符串丢掉');
  assert.deepEqual(dirCodes(null), []);
  assert.deepEqual(dirCodes(undefined), []);
});
