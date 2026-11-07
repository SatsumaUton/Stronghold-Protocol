// 称号（维护者 2026-11-07）：账号令牌里带着 `title`（后台可自定义），房间座位卡就靠它显示。
//
// 这道测试守的是 `server/adminAuth.js readUserToken()`：它以前只返回 uid/role/tag/gameTool，
// 把令牌里的 `title` 丢掉了 —— 于是 `net.js` 的 `account.title` 永远 undefined、`session.title`
// 恒为 null，玩家在等待室里永远看不到称号（令牌本身是对的，matchmaker 那边早就修好了）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readUserToken } from '../server/adminAuth.js';

// 节点与 matchmaker 共用 .secrets/watch-secret；纯代码检出没有它 → 跳过（与素材类测试同款处理）
let secret = '';
try { secret = readFileSync(new URL('../../.secrets/watch-secret', import.meta.url), 'utf8').trim(); } catch { secret = ''; }
const skip = secret ? false : '没有 .secrets/watch-secret（纯代码检出）';

/** 按 matchmaker account.cjs userTokenFor 的格式签一枚令牌：base64url(JSON) + '.' + HMAC。 */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const base = (extra = {}) => ({ v: 1, typ: 'user', uid: 8308, role: 'player', tag: '8308', gameTool: false, exp: Date.now() + 60000, ...extra });

test('令牌里的称号会被 readUserToken 带出来', { skip }, () => {
  const title = { id: 'abyss_pioneer', name: '深渊先区者', tone: 'echo', desc: '早期参与深潜测试、帮我们摸清深层机制的博士' };
  const got = readUserToken(sign(base({ title })));
  assert.ok(got, '令牌应校验通过');
  assert.deepEqual(got.title, title, 'title 必须原样带出（id / name / tone / desc）');
  assert.equal(got.uid, 8308);
  assert.equal(got.tag, '8308');
});

test('没有称号的令牌 title 为 null', { skip }, () => {
  assert.equal(readUserToken(sign(base())).title, null);
  assert.equal(readUserToken(sign(base({ title: null }))).title, null);
  assert.equal(readUserToken(sign(base({ title: { id: 'x' } }))).title, null, '只有 id 没有 name 不算称号');
  assert.equal(readUserToken(sign(base({ title: { name: '' } }))).title, null, 'name 为空不算称号');
  assert.equal(readUserToken(sign(base({ title: 'abyss_pioneer' }))).title, null, '字符串不算称号（必须是对象）');
});

test('称号的缺省字段被补成安全值，类型不对的不透传', { skip }, () => {
  const got = readUserToken(sign(base({ title: { name: '社区之星', id: 42, tone: 9, desc: null } })));
  assert.deepEqual(got.title, { id: '', name: '社区之星', tone: 'echo', desc: '' });
});

test('其余字段照旧：admin 令牌仍然被拒、过期令牌无效', { skip }, () => {
  assert.equal(readUserToken(sign(base({ typ: 'admin', role: 'owner' }))), null);
  assert.equal(readUserToken(sign(base({ exp: Date.now() - 1000 }))), null);
  assert.equal(readUserToken('not-a-token'), null);
  assert.equal(readUserToken(null), null);
});
