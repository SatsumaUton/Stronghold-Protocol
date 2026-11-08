// 换设备恢复对局：跳转地址要带「房间所在节点」。
//
// 维护者 2026-11-06：玩家 271002724@qq.com（账号 344「暴戾皇女」）在**深渊回响**房 PBJH（node-26）
// 换设备后点「前往该房间继续对局」，落回首页并弹「当前节点没有可恢复的账号对局」。
//
// 原因：深潜房码只进节点上报的 `echoCodes`，而按房号反查节点的 /api/resolve-room、
// /api/room-redirect、/api/find-room 只看 `codes`（matchmaker/roomDir.cjs 的约定）。
// 实测：/api/resolve-room?code=PBJH → 403；/api/room-redirect?code=PBJH → 302 Location: /。
// 而 /mm/api/account/room 本来就回了 room.node，前端却把它丢了，只会拼 /r/CODE。
//
// 现在：节点已知 → `/?room=CODE&n=N`（nginx 的显式目标通道，map $arg_n $sp_room_node 会钉死节点）；
// 节点未知 → 退回 /r/CODE。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeRoomUrl } from '../../public/js/ui/resumeMatch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('深潜房：知道节点时用 ?room=&n= 钉住那台节点（不再是 /r/CODE）', () => {
  // 玩家实测的那一局：深渊回响 PBJH 在 node-26
  assert.equal(resumeRoomUrl({ code: 'PBJH', node: 26 }), '/?room=PBJH&n=26');
});

test('普通房同样受益：带节点就不再依赖「节点十秒一上报」的房号目录', () => {
  assert.equal(resumeRoomUrl({ code: 'RMMM', node: 4 }), '/?room=RMMM&n=4');
});

test('节点未知 / 越界 / 非数字 → 退回 /r/CODE', () => {
  for (const node of [null, undefined, NaN, 0, 31, -1, '26x', '']) {
    assert.equal(resumeRoomUrl({ code: 'PBJH', node }), '/r/PBJH', `node=${String(node)} 要走兜底`);
  }
  assert.equal(resumeRoomUrl({ code: 'PBJH' }), '/r/PBJH');
});

test('节点边界 1 与 30 都算合法', () => {
  assert.equal(resumeRoomUrl({ code: 'AAAA', node: 1 }), '/?room=AAAA&n=1');
  assert.equal(resumeRoomUrl({ code: 'AAAA', node: 30 }), '/?room=AAAA&n=30');
});

test('房间码做 URL 编码，而且没有房间码时返回 null', () => {
  assert.equal(resumeRoomUrl({ code: 'a b', node: 2 }), '/?room=a%20b&n=2');
  assert.equal(resumeRoomUrl(null), null);
  assert.equal(resumeRoomUrl({}), null);
  assert.equal(resumeRoomUrl({ code: '' }), null);
});

test('组件不再直接拼 /r/CODE?accountResume=1，而是走 resumeRoomUrl', () => {
  const src = read('public/js/ui/resumeMatch.js');
  assert.doesNotMatch(src, /location\.assign\(`\/r\//, '大厅里的跳转不能再写死 /r/CODE');
  assert.match(src, /const goToRoom = \(\) => \{[\s\S]{0,220}resumeRoomUrl\(elsewhere\)/, 'goToRoom 要用 resumeRoomUrl');
  // 真正起作用的是这个一次性标记，不是 URL 参数
  assert.match(src, /sessionStorage\.setItem\('sp\.accountResume', '1'\)/);
});

// 2026-11-08（玩家反馈「跨设备恢复对局只看到『当前节点没有可恢复的账号对局』」）：
// 这两个函数搬进 ui/accountRoom.js，因为落地后的自动恢复（accountObserver）也要用 —— 它已经被
// resumeMatch import 了，反向 import 会成环。resumeMatch 继续 re-export，旧引用不受影响。
test('节点查询与地址拼接抽到 ui/accountRoom.js，resumeMatch 继续 re-export（避免循环依赖）', () => {
  const room = read('public/js/ui/accountRoom.js');
  assert.match(room, /export function resumeRoomUrl\(room\)/);
  assert.match(room, /export async function findAccountRoom\(\)/);
  assert.match(room, /\/mm\/api\/account\/room/);
  const resume = read('public/js/ui/resumeMatch.js');
  assert.match(resume, /import \{ resumeRoomUrl, findAccountRoom, roomNodeLabel \} from '\.\/accountRoom\.js';/);
  assert.match(resume, /export \{ resumeRoomUrl, findAccountRoom, roomNodeLabel \};/);
});

// 维护者 2026-11-08：「第 N 台节点应该改成 XXX 节点，因为玩家又不知道每个节点的编号。」
// 玩家认得的只有顶栏节点状态胶囊里的名字（「维多利亚 · 正常」），所以提示语说名字，编号只用来拼地址。
test('提示语用节点名：renamed 的键不再带「第 {n} 台节点」', () => {
  const obs = read('public/js/ui/accountObserver.js');
  assert.match(obs, /import \{ findAccountRoom, roomNodeLabel \} from '\.\/accountRoom\.js';/);
  assert.match(obs, /对局还在：房间 \{code\} 在「\{node\}」节点上。/, '有名字时说「在『维多利亚』节点上」');
  assert.match(obs, /对局还在：房间 \{code\}。它不在当前节点上，/, '没有名字时不提编号');
  assert.doesNotMatch(obs, /第 \{n\} 台节点/, '不能再把节点编号说给玩家');
  assert.match(obs, /const where = roomNodeLabel\(room\);/, '名字来自 roomNodeLabel');

  const resume = read('public/js/ui/resumeMatch.js');
  assert.match(resume, /它在「\{node\}」节点上（房间 \{code\}）/, '弹窗里也用名字');
  assert.doesNotMatch(resume, /另一个节点（房间 \{code\}）[\s\S]{0,40}第 \{n\} 台/, '弹窗里不能出现编号');
});

test('roomNodeLabel：有名字给名字，没有就是 null（调用方降级，不暴露编号）', async () => {
  const { roomNodeLabel } = await import('../../public/js/ui/accountRoom.js');
  assert.equal(roomNodeLabel({ code: 'PBJH', node: 26, nodeName: '多索雷斯' }), '多索雷斯');
  assert.equal(roomNodeLabel({ code: 'PBJH', node: 26 }), null, '老服务端没有 nodeName → 不给编号');
  assert.equal(roomNodeLabel({ code: 'PBJH', node: 26, nodeName: '' }), null, '空名字当没有');
  assert.equal(roomNodeLabel(null), null);
  assert.equal(roomNodeLabel({}), null);
});

test('matchmaker：/api/account/room 同时下发 nodeName，名字表只有一份（nodeNames.cjs）', () => {
  const account = read('matchmaker/account.cjs');
  assert.match(account, /const \{ nodeNameOf \} = require\('\.\/nodeNames\.cjs'\);/, 'account.cjs 共用名字表');
  assert.match(account, /nodeName: nodeNameOf\(n\)/, '响应里带 nodeName');
  assert.match(account, /const named = \(code, n\) => \(\{ code, node: Number\(n\) \|\| null, nodeName: nodeNameOf\(n\) \}\)/, '两条返回路径共用 named()');

  const names = read('matchmaker/nodeNames.cjs');
  assert.match(names, /module\.exports = \{ NODE_NAMES, nodeNameOf \}/);
  assert.match(names, /'阿戈尔', '玻利瓦尔'[\s\S]*'多索雷斯', '阿卡胡拉'[\s\S]*'瓦伊凡'/, '30 个名字都在');

  const server = read('matchmaker/server.js');
  assert.match(server, /const \{ NODE_NAMES \} = require\('\.\/nodeNames\.cjs'\);/, 'server.js 也从这里取，别各写一份');
  assert.doesNotMatch(server, /^const NODE_NAMES = \[/m, 'server.js 里的那份已抽走');
});

test('自动恢复失败时不再只说「当前节点没有可恢复的账号对局」，而是指出房间与节点', () => {
  const obs = read('public/js/ui/accountObserver.js');
  assert.match(obs, /import \{ findAccountRoom, roomNodeLabel \} from '\.\/accountRoom\.js';/);
  assert.match(obs, /let room = null;[\s\S]{0,120}room = await findAccountRoom\(\);/, '失败分支要查房间目录');
  // 实在查不到房间才退回原来那句（它是「房间已经没了」的意思，不该是第一选择）
  const dead = obs.indexOf("t('当前节点没有可恢复的账号对局')");
  assert.ok(dead > 0, '兜底提示还在');
  assert.ok(obs.indexOf('对局还在：房间 {code}') < dead, '先给「对局还在」的可操作提示，再考虑兜底');
});
