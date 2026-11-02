// 预约盟约的客户端（ui/bondPlan.js、screens/bandDraft.js reservedBands）+ 它在对局里的显示。
//
// 玩家报的问题：在大厅 / 选策略时预约了盟约，**进对局以后就看不见了**。
// 原因不是数据没下发（server/match/match/views.js 的 players[].bondPlan 一只是无条件下发的），
// 而是前端只在一个地方渲染它 —— bandDraft 的选人顺序行（dorder__plan）。
// 参考版有两处：bandDraft 的顺序行 **和** 对局内的队伍面板（ui/teamPanel.js，compact）。
// 第二处漏移植，于是「进对局以后不显示」。这里把两处都钉住。
//
// 前半段是参考版 test/ui/bond-plan-ui.test.js 的移植（纯函数）；
// 后半段是本服补的回归断言（队伍面板 + 样式）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { DATA } from '../match/harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { plannableBonds, bondPlanOpen, bondPlanHolders } from '../../public/js/ui/bondPlan.js';
import { reservedBands } from '../../public/js/screens/bandDraft.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- 纯函数（照参考版）

test('可预约的盟约就是服务端那份：每个核心盟约，按数据顺序，每个模式都一样', () => {
  const ids = plannableBonds(Object.values(DATA.bonds)).map((b) => b.bondId);
  for (const modeId of ['mode_single_normal', 'mode_multi_normal', 'mode_multi_abyss']) {
    assert.deepEqual(ids, [...new GameData(DATA, modeId).plannableBondIds()], modeId);
  }
  assert.equal(ids.length, 8);
  assert.ok(ids.includes('lateranoShip') && !ids.includes('preciShip'));
  assert.deepEqual(plannableBonds(null), []);
});

test('能改预约的窗口和服务端一致：从确认本局信息到第 1 回合的战斗之前', () => {
  for (const phase of [PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK]) assert.equal(bondPlanOpen({ phase, round: 0 }), true, phase);
  for (const phase of [PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]) {
    assert.equal(bondPlanOpen({ phase, round: 1 }), true, `${phase} R1`);
    assert.equal(bondPlanOpen({ phase, round: 2 }), false, `${phase} R2`);
  }
  for (const phase of [PHASE.COMBAT, PHASE.UNITE, PHASE.SETTLE, PHASE.FINAL_ASSAULT, PHASE.RESULT]) assert.equal(bondPlanOpen({ phase, round: 1 }), false, phase);
  assert.equal(bondPlanOpen(null), false);
});

test('别人预约了什么按盟约归类，永远不含自己', () => {
  const players = [
    { playerId: 'me', name: 'A', bondPlan: 'yanShip' }, { playerId: 'p2', name: 'B', bondPlan: 'yanShip' },
    { playerId: 'p3', name: 'C', bondPlan: 'egirShip' }, { playerId: 'p4', name: 'D', bondPlan: null },
  ];
  assert.deepEqual([...bondPlanHolders(players, 'me')], [['yanShip', ['B']], ['egirShip', ['C']]]);
});

test('房主给 AI 预留的策略在它选走之前算「已占用」；预留给自己的不算', () => {
  const draft = { reserved: { band_a: 'ai_1', band_b: 'ai_2', band_c: 'me' } };
  const picks = new Map([['ai_2', 'band_b']]);
  assert.deepEqual([...reservedBands(draft, picks, 'me')], [['band_a', 'ai_1']]);
  assert.deepEqual([...reservedBands({}, new Map(), 'me')], []);
  assert.deepEqual([...reservedBands(null, new Map(), 'me')], []);
});

// ---------------------------------------------------------------- 对局内的显示（本服回归）

describe('进对局以后也要看得见预约盟约', () => {
  test('队伍面板渲染它：只在预约了的时候，紧跟在状态后面、眼睛前面', () => {
    const panel = read('public/js/ui/teamPanel.js');
    assert.match(panel, /import \{ BondPlanTag \} from '\.\/bondPlan\.js'/);
    // 条件渲染：没有预约就一个字都不多出（默认对局的视图不变）
    assert.match(panel, /p\.bondPlan \? html`<\$\{BondPlanTag\} bondId=\$\{p\.bondPlan\} compact=\$\{true\} class="team__plan" \/>` : null/);
    // 落在 .team__line 里：状态 → 预约盟约 → 正在查看
    const line = panel.slice(panel.indexOf('<div class="team__line">'), panel.indexOf('team__eye'));
    assert.ok(line.includes('BondPlanTag'), '.team__line 里要有预约盟约的标记');
  });

  test('它的样式在（.team__plan 是紧凑尺寸，比 .bplan 小一号）', () => {
    // 样式不在 node-1 里：node-1/public/css 是指向 <部署根>\shared\public\css 的 junction
    const css = read('../shared/public/css/screens/game.css');
    assert.match(css, /\.team__plan \{[^}]*flex: none/);
    assert.match(css, /\.team__plan \.bglyph \{ width: \.18rem; height: \.18rem; \}/);
    // 底座样式仍在 game-panels.css（bandDraft 也用同一套）
    const base = read('../shared/public/css/screens/game-panels.css');
    assert.match(base, /\.bplan--compact \{ padding: \.01rem; \}/);
  });

  test('队伍面板在对局屏里是无条件渲染的：准备阶段和战斗都覆盖', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /<\$\{TeamPanel\} pub=\$\{pub\} myId=\$\{myId\}/);
    // 不是「只在战斗里渲染」——否则准备阶段又看不见了
    const before = game.slice(Math.max(0, game.indexOf('<${TeamPanel}') - 400), game.indexOf('<${TeamPanel}'));
    assert.doesNotMatch(before, /cc \? html`<\$\{TeamPanel\}/, '不应被 cc（战斗）条件包住');
  });
});
