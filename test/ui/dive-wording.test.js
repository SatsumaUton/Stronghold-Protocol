// 「深渊回响」房里的用语（维护者 2026-11-08）：
//
//   「深渊回响房间里的版本标签不该显示；也别的地方还有『同盟』『模拟』措辞在深潜房里露出来，去全仓扫一遍。」
//
// 深潜在协议里是 `mode:'coop'` + `variant:'deepecho'`：同一套引擎、两个模式。所以对局内的通用组件
// （队伍面板、结算、复活、相位横幅、连接横幅…）天然说的是「同盟 / 模拟」。这里逐个钉住：
//   * 深潜房里**没有**版本胶囊，也切不了版本（服务端也要拒）；
//   * 每个会漏词的地方都走 ui/diveWords.js，两个分支都写在 t('…') 里（否则 i18n 提取器读不到）；
//   * 房间页 / 结算页真正渲染时按 variant 取值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDiveRoom, diveTeam, diveRounds, diveTeamLp, diveBack, diveSoonBanner, diveEntering, diveLoadingData,
  diveWonTimes, diveCleared, diveInterrupted, diveFailed, diveRunEnded, diveClosed, diveReviveGone,
  diveSpectatorExit, diveRecordNote, diveSyncing, diveAlreadyIn, diveSeatGone,
} from '../../public/js/ui/diveWords.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('isDiveRoom：只认 variant，不认 mode（深潜也是 coop）', () => {
  assert.equal(isDiveRoom({ mode: 'coop', variant: 'deepecho' }), true);
  assert.equal(isDiveRoom({ mode: 'coop', variant: null }), false);
  assert.equal(isDiveRoom({ mode: 'solo' }), false);
  assert.equal(isDiveRoom(null), false);
});

test('取词函数：深潜分支里没有任何「同盟 / 模拟」', () => {
  const pairs = [
    ['diveTeam', diveTeam(true)], ['diveRounds', diveRounds(true)], ['diveTeamLp', diveTeamLp(true)], ['diveBack', diveBack(true)],
    ['diveSoonBanner', diveSoonBanner(true)], ['diveEntering', diveEntering(true)], ['diveLoadingData', diveLoadingData(true)],
    ['diveCleared', diveCleared(true)], ['diveInterrupted', diveInterrupted(true)], ['diveFailed', diveFailed(true)],
    ['diveRunEnded', diveRunEnded(true)], ['diveClosed', diveClosed(true)], ['diveReviveGone', diveReviveGone(true)],
    ['diveSpectatorExit', diveSpectatorExit(true)], ['diveSyncing', diveSyncing(true)], ['diveAlreadyIn', diveAlreadyIn(true)],
    ['diveSeatGone', diveSeatGone(true)], ['diveWonTimes', diveWonTimes(true, 3)],
  ];
  for (const [name, text] of pairs) {
    assert.doesNotMatch(text, /同盟|模拟/, `${name} 的深潜分支还在说「同盟 / 模拟」：${text}`);
  }
  // 普通房那一支必须原样保留（逐字不变）
  assert.equal(diveTeam(false), '同盟成员');
  assert.equal(diveRounds(false), '同盟通过回合');
  assert.equal(diveTeamLp(false), '同盟剩余生命');
  assert.equal(diveBack(false), '返回同盟');
  assert.equal(diveCleared(false), '模拟完成');
  assert.equal(diveInterrupted(false), '模拟中断');
  assert.equal(diveFailed(false), '模拟失败');
  assert.equal(diveSoonBanner(false), '模拟即将开始');
  assert.equal(diveEntering(false), '正在进入模拟…');
  assert.equal(diveLoadingData(false), '正在载入模拟数据…');
  assert.equal(diveRunEnded(false), '本局模拟已结束');
  assert.equal(diveClosed(false), '模拟已结束');
  assert.equal(diveReviveGone(false), '本局模拟已经结束，无法救援');
  assert.equal(diveSyncing(false), '正在同步同盟状态…');
  assert.equal(diveAlreadyIn(false), '你已在其他同盟中，请先离开当前同盟');
  assert.equal(diveSeatGone(false), '你已不在该同盟中');
  assert.equal(diveWonTimes(false, 3), '已通过模拟3次');
  assert.equal(diveRecordNote(false, '第一期下半'), '同盟中的数据由房间的版本决定，离开同盟后才能回看「第一期下半」的结算');
});

test('diveWords：两个分支都写在 t(…) 字面量里（三元里的字符串 i18n 提取器读不到）', () => {
  // 只看代码行（注释里正好写着这个反例，不能把注释算进去）
  const code = read('public/js/ui/diveWords.js').split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n');
  assert.doesNotMatch(code, /t\(dive \?/, '不能写成 t(dive ? … : …)：提取器只认直接传给 t() 的字面量');
  assert.doesNotMatch(code, /t\(\s*dive\s*\?/, '同上');
  // 每个取词函数都真的有两条 t('…') 字面量
  const fns = code.match(/export const dive\w+ =/g) || [];
  assert.ok(fns.length >= 15, `取词函数要够，实际 ${fns.length}`);
  const literals = code.match(/t\('[^']+'/g) || [];
  assert.ok(literals.length >= fns.length * 2, `每个取词两条字面量：${literals.length} 条字面量 / ${fns.length} 个函数`);
  // 深潜那一支真的存在
  assert.ok((code.match(/'[^']*深潜[^']*'/g) || []).length >= 15, '深潜分支的字面量要够');
});

test('房间页：深潜房没有版本胶囊、也没有版本切换入口', () => {
  const src = read('public/js/screens/room.js');
  assert.match(src, /const showVersion = !echoRoom && \(Array\.isArray\(versions\) \|\| curVersion !== DEFAULT_VERSION\);/, '深潜房不显示版本');
  assert.match(src, /\$\{echoRoom \? null : html`<\$\{VersionTag\} room=\$\{room\} class="rs-clock__ver" \/>`\}/, '版本胶囊包在 echoRoom 之外');
});

test('服务端：深潜房不能切版本（建房拒、进房后 proposeVersion 也要拒）', () => {
  const src = read('server/lobby.js');
  assert.match(src, /if \(variant && version !== DEFAULT_VERSION\) \{[\s\S]*?'「深渊回响」只支持「第二期下半」，不支持其他版本'/, 'create 要拒');
  assert.match(src, /if \(room\.variant === 'deepecho' && version !== DEFAULT_VERSION\) \{[\s\S]*?'「深渊回响」只支持「第二期下半」，不支持其他版本'/, 'proposeVersion 也要拒（以前漏了）');
});

test('队友面板 / 结算 / 复活 / 相位横幅 / 连接横幅 / 主入口都走 diveWords', () => {
  const sites = [
    ['public/js/ui/teamPanel.js', /diveTeam\(isDivePub\(pub\)\)/],
    ['public/js/screens/settle.js', /diveCleared\(dive\)/],
    ['public/js/screens/settle.js', /diveRounds\(dive\)/],
    ['public/js/screens/settle.js', /diveBack\(isDiveResult\(res\) \|\| isDivePub\(pub\)\)/],
    ['public/js/screens/result.js', /diveCleared\(dive\)/],
    ['public/js/screens/result.js', /diveTeam\(dive\)/],
    ['public/js/screens/result.js', /diveTeamLp\(dive\)/],
    ['public/js/ui/bossPlates.js', /diveInterrupted\(dive\)/],
    ['public/js/ui/revival.js', /diveReviveGone\(dive\)/],
    ['public/js/ui/gameLogic/phases.js', /diveSoonBanner\(isDivePub\(pub\)\)/],
    ['public/js/ui/matchChrome.js', /diveSpectatorExit\(echo\)/],
    ['public/js/ui/connBanner.js', /diveSyncing\(inDive\)/],
    ['public/js/main.js', /diveAlreadyIn\(inDive\)/],
    ['public/js/main.js', /diveSeatGone\(room\.variant === 'deepecho'\)/],
    ['public/js/screens/stats.js', /diveRecordNote\(dive, label\)/],
    ['public/js/screens/game.js', /diveLoadingData\(isDivePub\(pub\) \|\| diveRoom\)/],
    ['public/js/screens/bandDraft.js', /diveEntering\(isDivePub\(pub\)\)/],
    ['public/js/screens/bandDraft.js', /diveWonTimes\(isDivePub\(pub\), local\.won\[shownBand\.bandId\]\)/],
  ];
  for (const [file, re] of sites) assert.match(read(file), re, `${file} 少了深潜取词`);
});

test('对局结束浮层：深潜房说深潜，不再说「同盟已返回等待室」', () => {
  const src = read('public/js/screens/game/overlays.js');
  assert.match(src, /function endReasonText\(reason, dive = false\)/, '要能区分');
  assert.match(src, /管理员终止了这一局，深潜已返回等待室/, '深潜分支存在');
  assert.match(src, /export function MatchEnded\(\{ reason = null, dive = false \} = \{\}\)/, 'MatchEnded 收 dive');
  assert.match(src, /diveRunEnded\(dive\)/, '标题');
  assert.match(src, /diveBack\(dive\)/, '返回按钮');
  // 调用方要真的把 dive 传进来
  assert.match(read('public/js/screens/game.js'), /<\$\{MatchEnded\} reason=\$\{endReason\} dive=\$\{isDivePub\(pub\) \|\| diveRoom\} \/>/);
});

test('房间页：深潜房的难度行、提示 toast 也不说「模拟」', () => {
  const src = read('public/js/screens/room.js');
  assert.match(src, /echoRoom \? t\('深潜难度'\) : t\('模拟难度'\)/, '难度行的标题');
  assert.match(src, /title=\$\{isHost \? t\(echoRoom \? '更改深潜难度' : '更改模拟难度'\)/, '更改难度的 tooltip');
  assert.match(src, /room\.variant === 'deepecho' \? '创建者已将深潜难度改为「\{name\}」' : '创建者已将模拟难度改为「\{name\}」'/, '难度变更 toast');
});

test('列表 / 密钥行 / 进入等待态：深潜房不借用同盟的说法', () => {
  assert.match(read('public/js/ui/roomList.js'), /每次深潜最多 \{MAX_SPECTATORS\} 名，深潜进行中也可进入/, '公开深潜列表的观战提示');
  assert.match(read('public/js/screens/lobby.js'), /每次深潜最多 \{MAX_SPECTATORS\} 名，深潜进行中也可进入/, '深潜密钥行的观战提示');
  const entering = read('public/js/screens/entering.js');
  assert.match(entering, /t\('正在进入深潜 \{code\}…'/, '带房号');
  assert.match(entering, /t\('正在进入深潜…'/, '不带房号');
  assert.match(entering, /export function takeJoinDive\(\)/, '一次性标记');
  assert.match(read('public/js/screens/lobby.js'), /sessionStorage\.setItem\('sp\.joinDive'/, '换页前写标记');
});

test('深潜房里不该出现「同盟 / 模拟」的那些字面量，一个都不剩在深潜分支里', () => {
  // 结算 / 队伍 / 复活 / 相位：这些文件里除 diveWords 之外不该再有裸的「同盟成员」等
  for (const file of ['public/js/ui/teamPanel.js', 'public/js/ui/bossPlates.js', 'public/js/ui/revival.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /t\('同盟成员'\)|t\('模拟中断'\)|t\('本局模拟已经结束/, `${file} 还有裸的同盟/模拟文案`);
  }
});
