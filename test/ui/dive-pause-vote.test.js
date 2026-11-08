// 「暂停游戏」投票的界面（维护者 2026-11-08）：
//
//   * 按钮**放在右上角「准备就绪」下面**（不是塞进「离开深潜」那种对话框里 —— 维护者明确要求）；
//   * 只在服务端下发 `m.public.pauseVote` 时渲染（深渊回响多人局），观战者看不到；
//   * 暂停之后弹一个「对局已暂停」浮层（和「服务器重启导致对局中断」同款风格），
//     列出每个人的确认状态，按钮写「继续游戏」，全员确认才恢复。
//
// 这个测试对源码做断言（不需要浏览器），和 test/ui/echo-altar-visible.test.js 同一套路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('按钮：在右上角「准备就绪」下面，只在对局里且有 pauseVote 时出现', () => {
  const hud = read('public/js/ui/hud.js');
  // 顺序：ReadyToggle 之后才是 PauseVote（维护者：按钮就加在准备就绪的下面）
  const ready = hud.indexOf('<${ReadyToggle}');
  const vote = hud.indexOf('<${PauseVote} pub=${pub}');
  assert.ok(ready > 0 && vote > 0, '两块都要在 TopBar 里');
  assert.ok(vote > ready, 'PauseVote 必须排在「准备就绪」之后（视觉上就在它下面）');
  // 没有 pauseVote（单人 / 普通房）时一行都不渲染
  assert.match(hud, /\$\{onPauseVote \? html`<\$\{PauseVote\}[^`]*` : null\}/, '没有 onPauseVote 就整个不渲染');
  assert.match(hud, /export function PauseVote\(\{ pub, myId, spectator = false, onVote \}\)/, '组件签名');
  assert.match(hud, /if \(!v \|\| spectator\) return null;/, '观战者看不到');
  assert.match(hud, /data-testid="pause-vote"/, '有测试标记');
});

test('按钮三态：暂停游戏 → 暂停中（自己投过）→ 已暂停', () => {
  const hud = read('public/js/ui/hud.js');
  assert.match(hud, /const label = paused \? t\('已暂停'\) : mine \? t\('暂停中'\) : t\('暂停游戏'\)/, '三种文案');
  assert.match(hud, /data-state=\$\{paused \? 'paused' : mine \? 'voted' : 'idle'\}/, '三种状态标记');
  assert.match(hud, /const count = `\$\{agreed\.length\}\/\$\{Math\.max\(1, Number\(v\.need\) \|\| 1\)\}`/, '显示 n/N');
  assert.match(hud, /onClick=\$\{press\}/, '点击投票');
  assert.match(hud, /await onVote\?\.\(!mine\)/, '自己投过再点就是撤回');
  assert.match(hud, /disabled=\$\{busy \|\| paused\}/, '暂停中按钮只读（继续要点浮层）');
  // 空格是「准备就绪」的快捷键，别让按钮把它吃掉
  assert.match(hud, /if \(e\.key === ' '\) e\.stopPropagation\(\)/, '空格不冒泡到准备就绪');
});

test('浮层：对局已暂停，列出每个人的确认状态，全员确认才恢复', () => {
  const ov = read('public/js/screens/game/overlays.js');
  assert.match(ov, /export function PauseVoteOverlay\(/, '组件存在');
  assert.match(ov, /data-testid="pause-vote-overlay"/, '有测试标记');
  assert.match(ov, /class="awayov"/, '和「重启导致对局中断」同款浮层');
  assert.match(ov, /PAUSED · \$\{t\('全员确认后继续'\)\}/, '浮层小标题');
  assert.match(ov, /<h2>\$\{t\('对局已暂停'\)\}<\/h2>/, '标题');
  assert.match(ov, /t\('\{name\} 发起了暂停。/, '说明里点名发起人');
  assert.match(ov, /t\('已确认'\) : t\('等待中'\)/, '每人一行确认状态');
  assert.match(ov, /t\('继续游戏'\)/, '按钮叫「继续游戏」');
  assert.match(ov, /t\('已确认 · 等待队友（\{n\}\/\{m\}）'/, '确认后按钮变成等待队友');
  assert.match(ov, /t\('暂停超过 10 分钟会自动继续。'\)/, '写明兜底');
  assert.match(ov, /disabled=\$\{mine\}/, '自己确认过就不能再点');
});

test('接线：动作走 g.pauseVote / g.pauseResume，单人的 Space 暂停浮层不会被顶掉', () => {
  const actions = read('public/js/ui/gameActions.js');
  assert.match(actions, /pauseVote: \(agree\) => act\('g\.pauseVote', \{ agree: !!agree \}/, 'g.pauseVote');
  assert.match(actions, /pauseResume: \(\) => act\('g\.pauseResume', \{\}/, 'g.pauseResume');

  const game = read('public/js/screens/game.js');
  assert.match(game, /import \{[^}]*PauseVoteOverlay[^}]*\} from '\.\/game\/overlays\.js';/, '引入浮层');
  assert.match(game, /onPauseVote=\$\{pub\?\.pauseVote && !spectator \? votePause : null\}/, '把回调传给 TopBar');
  assert.match(game, /const soloPaused = paused && !pub\?\.pauseActive;/, '投票暂停时不再显示单人的暂停浮层');
  assert.match(game, /\$\{pub\?\.pauseActive \? html`<\$\{PauseVoteOverlay\}/, '暂停中渲染投票浮层');

  // 服务端：协议白名单 + 意图
  const proto = read('shared/protocol.js');
  assert.match(proto, /'g\.pauseVote': \{ agree: isBool \}/, '协议：agree 必填布尔');
  assert.match(proto, /'g\.pauseResume': \{\}/, '协议：继续无参数');
  const intents = read('server/match/match/intents.js');
  assert.match(intents, /case 'g\.pauseVote': return this\.setPauseVote\(ps, msg\.agree === true\);/, '意图 → setPauseVote');
  assert.match(intents, /case 'g\.pauseResume': return this\.pauseResume\(ps\);/, '意图 → pauseResume');
});

test('CSS：按钮与浮层都有自己的样式（不靠内联）', () => {
  const css = read('public/css/screens/game.css');
  for (const cls of ['.pausevote {', '.pausevote__glyph', '.pausevote__label', '.pausevote__count', '.pausevote__box', '.pausevote__list', '.pausevote__who', '.pausevote__mark']) {
    assert.ok(css.includes(cls), `缺少样式 ${cls}`);
  }
});
