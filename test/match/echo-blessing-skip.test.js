// 祝福三选一的「放弃本次」被拦成「无效的请求」—— 回归测试（维护者 2026-11-05 玩家反馈）。
//
// 症状：点第四张「放弃本次」再按确认，什么都没发生，右上角刷出「无效的请求 ×13」。
//
// 原因：协议白名单 `g.echoBlessing` 的 `pick` 上限还停在 2（只有三张卡的时候写的），
// 而「放弃本次」的下标是 `offer.options.length` = 3 —— net.js 在**客户端**就把它拦掉了，
// 服务端 intents.js 的 case 永远收不到。
//
// 这里钉住三件事：
//   1. 协议允许 0..3，4 以上仍然拒绝；
//   2. 客户端「放弃本次」用的下标确实是 options.length；
//   3. 服务端接受 i === offer.length（第四张），超界才 BAD_TARGET。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C2S } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('协议：g.echoBlessing 接受 0..3（3 = 放弃本次），4 以上拒绝', () => {
  const rule = C2S['g.echoBlessing'];
  assert.ok(rule && typeof rule.pick === 'function', 'g.echoBlessing.pick 必须登记');
  for (const v of [0, 1, 2, 3]) assert.equal(rule.pick(v), true, `${v} 要放行`);
  for (const v of [4, 5, -1, 1.5, '3', null, undefined]) assert.equal(rule.pick(v), false, `${v} 要拒绝`);
});

test('客户端：「放弃本次」的下标是 offer.options.length', () => {
  const src = read('public/js/ui/echoBlessing.js');
  assert.match(src, /const i = offer\.options\.length;/, '放弃卡的下标必须跟着候选数量走');
  assert.match(src, /actions\.echoBlessing\(armed\)/, '确认时提交的是选中的下标');
});

test('服务端：接受 i === offer.length（放弃本次），超界才拒绝', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 3, fake: true, variant: 'deepecho' });
  const m = h.m;
  t.after(() => m.dispose());
  const ps = h.ps('p_0');
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  m._echoBlessingRound = m.round;
  // 3 = 放弃本次（offer.length）
  const ok = m.setEchoBlessingVote(ps, 3);
  assert.equal(ok && ok.error, undefined, '放弃本次不能被当成非法下标');
  // 4 = 超界
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  const bad = m.setEchoBlessingVote(ps, 4);
  assert.equal(bad && bad.error, 'BAD_TARGET', '超界要拒绝');
});
