// 投票移出：客户端「按钮亮不亮」必须和服务端 `kickTargetEligible` 同一口径。
//
// 维护者 2026-11-07 晚反馈：队友刚掉线、还没被 AI 接管（OFFLINE_TAKEOVER_ROUNDS = 2 个备战）时，
// 队伍面板已经亮出「投票移出」，点下去服务端回 BAD_TARGET，玩家只看到「无效的目标」。
// 现在只有 views.js 下发 `offlineTakeover`（掉线 + 自动接管开启）的座位才亮按钮。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kickable } from '../../public/js/ui/kickVote.js';
import { PHASE } from '../../shared/constants.js';

const row = (over) => ({ playerId: 'x', isBot: false, connected: true, alive: true, ...over });
const basePub = (over = {}) => ({
  phase: PHASE.PREP,
  players: [
    row({ playerId: 'me' }),
    row({ playerId: 'mate', connected: false, offlineTakeover: true }),
    row({ playerId: 'justDropped', connected: false }),
    row({ playerId: 'bot', isBot: true }),
  ],
  ...over,
});
const at = (pub, id) => pub.players.find((p) => p.playerId === id);

test('只有「掉线 + 已被 AI 接管」的队友才亮出投票移出', () => {
  const pub = basePub();
  assert.equal(kickable(pub, 'me', at(pub, 'mate')), true, '掉线且已接管 → 可以提案');
  assert.equal(kickable(pub, 'me', at(pub, 'justDropped')), false, '刚掉线还没被接管 → 不能提案（服务端会回「无效的目标」）');
  assert.equal(kickable(pub, 'me', at(pub, 'bot')), false, '机器人座位');
  assert.equal(kickable(pub, 'me', at(pub, 'me')), false, '自己');
});

test('阶段 / 进行中的投票 / 自己掉线 / 目标已淘汰，都不亮', () => {
  const pub = basePub();
  assert.equal(kickable({ ...pub, phase: PHASE.COMBAT }, 'me', at(pub, 'mate')), false, '只有 SP_DRAFT / PREP');
  assert.equal(kickable({ ...pub, kickVote: { id: 1 } }, 'me', at(pub, 'mate')), false, '同时只允许一个投票');
  const meGone = { ...pub, players: pub.players.map((p) => (p.playerId === 'me' ? { ...p, connected: false } : p)) };
  assert.equal(kickable(meGone, 'me', at(pub, 'mate')), false, '提案人自己掉线');
  const dead = { ...pub, players: pub.players.map((p) => (p.playerId === 'mate' ? { ...p, alive: false } : p)) };
  assert.equal(kickable(dead, 'me', at(dead, 'mate')), false, '目标已淘汰');
});
