// 手输房号「加入 / 观战」跨节点跳转后不该再输一次房号。
//
// 维护者 2026-11-08：「使用加入深潜功能输入房间号以后会先跳转到对应的节点，然后再重新输入一次」
// +「跳到大厅需要重新点进深潜界面再输一遍，我想要的是输入后直接进入对应的深潜房间」。
//
// 30 个节点是独立进程，`room.join` 只认本节点的房间。跨节点只能靠 nginx 的 `?n=<节点>&room=<码>`
// 换页，落地页再由 main.js 的 schedulePendingJoin 自动加入。手输房号这条跳法（hopToRoomNode）
// 和「公开同盟」列表那条（enterRoom / spectateRoom）差了三件事，每一条都会让落地页丢掉这次加入：
//
//   ① 没写 `sp_join_from_list` —— validatePendingInvite 会用 /mm/api/find-room 再查一次房间，
//      而那个目录有十秒级延迟，查不到就把 pendingJoin 清掉 → 玩家「跳过去了，停在大厅」。
//      列表那条路 2026-11-02 就补过这个标记（904befbb），手输这条漏了。
//   ② 观战根本不跳 —— joinKnown 只在 ROOM_NOT_FOUND && type === 'room.join' 时调 hopToRoomNode，
//      所以跨节点的「观战深潜」只能报「没有找到该同盟密钥对应的房间」。实测 node-1 上观战 node-2 的
//      深潜房（ZCGK）就是这个问题。
//   ③ 观战跳过去不带 `spectate=1` —— 落地页会按「加入」进，已经开局的房必然 ROOM_STARTED。
//
// 还有一条与跳转无关、但同样让人「再点一次」的：深潜房一开局就不能中途加入（服务端一律回
// ROOM_STARTED），玩家点了「加入深潜」只拿到一句「模拟已开始」就被丢回大厅，还得自己点观战。
// 深潜房此时只剩观战这一条路，所以直接按观战进并说明；普通同盟房保持原样（确实不能中途加入）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const lobby = read('public/js/screens/lobby.js');
const main = read('public/js/main.js');

/** hopToRoomNode 的函数体（到 joinKnown 之前）。 */
const hopBody = (() => {
  const at = lobby.indexOf('async function hopToRoomNode(');
  const end = lobby.indexOf('export async function joinKnown(', at);
  assert.ok(at > 0 && end > at, 'hopToRoomNode 与 joinKnown 都还在');
  return lobby.slice(at, end);
})();

test('跨节点跳转要留下「这次是玩家自己要进的房」标记（否则落地页会把它清掉）', () => {
  assert.match(hopBody, /sessionStorage\.setItem\('sp_join_from_list', k\)/,
    '手输房号这条路也要写这个标记（列表那条路 2026-11-02 就写了）');
  // 与列表那条路一致：marker + guard 都在 try 里
  assert.match(hopBody, /sessionStorage\.setItem\(guardKey, k\)/, '防死循环的 guard 还在');
  assert.match(main, /sessionStorage\.getItem\('sp_join_from_list'\)/, 'main.js 要认这个标记');
  const guardAt = main.indexOf("sessionStorage.getItem('sp_join_from_list')");
  const clearAt = main.indexOf('clearPendingJoin();', guardAt);
  assert.ok(guardAt > 0 && clearAt > guardAt, '标记存在时跳过那次清理');
});

test('观战也要跳节点（以前只有 room.join 会跳）', () => {
  assert.match(lobby, /if \(err\?\.code === ERR\.ROOM_NOT_FOUND\) \{\s*\n?\s*const wantSpectate = type === 'room\.spectate';/,
    'ROOM_NOT_FOUND 这条兜底不能再只认 room.join');
  assert.match(lobby, /hopToRoomNode\(key, \{ spectate: wantSpectate \}\)/,
    '把「这次是观战」告诉 hopToRoomNode');
  // 跳转地址必须区分观战 / 加入
  assert.match(hopBody, /if \(spectate\) u\.searchParams\.set\('spectate', '1'\);/,
    '观战跳过去要带 spectate=1（落地页靠它走 room.spectate）');
  assert.match(hopBody, /else u\.searchParams\.delete\('spectate'\);/,
    '加入则要清掉上一轮留下的 spectate=1');
  assert.match(main, /const pendingSpectate = \/\(\?:\^\|\[\?&\]\)spectate=1/,
    '落地页确实会读 spectate=1');
});

test('跳转地址与列表那条路一致：?n=节点 & room=码（& spectate=1）', () => {
  assert.match(hopBody, /u\.searchParams\.set\('n', String\(node\)\)/);
  assert.match(hopBody, /u\.searchParams\.set\('room', k\)/);
  assert.match(hopBody, /u\.searchParams\.delete\('adminWatch'\)/, '隐身观战参数不能带到普通跳转里');
  assert.match(hopBody, /location\.assign\(u\.toString\(\)\)/, '真的换页');
  // 节点号来自匹配服务，取不到就不跳（别把人送进一个随机节点）
  assert.match(hopBody, /const info = await findRoomInfo\(k\);/);
  assert.match(hopBody, /if \(!\(node >= 1 && node >= 1|if \(!\(node >= 1/);
  assert.match(hopBody, /node >= 1 && node <= 30/);
  assert.match(hopBody, /node === currentNode\(\)/, '已经在本节点就不跳（跳了也没用）');
});

test('深潜房已开局 → 直接按观战进，而不是丢回大厅让玩家自己再点一次', () => {
  const at = lobby.indexOf("err?.code === ERR.ROOM_STARTED && type === 'room.join'");
  assert.ok(at > 0, '要有 ROOM_STARTED 的兜底分支');
  // 分支体到它自己的收尾 `}`（下一行以 `// 本节点没有这间房` 开头的注释为止，够用且不会被后面的改动绊住）
  const end = lobby.indexOf('// 本节点没有这间房', at);
  assert.ok(end > at, '能定位到分支结束');
  const block = lobby.slice(at, end);
  assert.match(block, /findRoomInfo\(key\)/, '先问这间房是不是深潜');
  assert.match(block, /info\?\.variant === 'deepecho'/, '只对深潜房这么做');
  assert.match(block, /net\.request\('room\.spectate', \{ code: key \}\)/, '改成观战进房');
  assert.match(block, /t\('这间深潜已经开始，无法中途加入：已作为观战者进入。'\)/, '要说明发生了什么');
  // 观战请求必须在 variant 判断**里面**：普通同盟房不在这里被偷偷改成观战
  const guardAt = block.indexOf("info?.variant === 'deepecho'");
  const specAt = block.indexOf("net.request('room.spectate'");
  assert.ok(guardAt > 0 && specAt > guardAt, '观战分支嵌套在深潜判断里');
});

test('find-room 返回 variant，客户端靠它认出深潜房', () => {
  const mm = read('matchmaker/server.js');
  assert.match(mm, /variant: doc\.variant === 'deepecho' \? 'deepecho' : null/, 'matchmaker 要下发 variant');
  assert.match(lobby, /info\?\.variant === 'deepecho'/, '客户端要读它');
});

test('换页会吞掉 toast：提示语要留给落地页念（sp.joinNote）', () => {
  assert.match(hopBody, /sessionStorage\.setItem\('sp\.joinNote', String\(opts\.note\)\)/, '跳转前把话存下');
  assert.match(hopBody, /sessionStorage\.removeItem\('sp\.joinNote'\)/, '没有话时要清掉上一轮的，别念到别人头上');
  // 真的跨节点跳时才走这条路（本节点直接观战的那条会在跳转函数返回 false 之后自己弹 toast）
  assert.match(lobby, /hopToRoomNode\(key, \{ spectate: true, note: '这间深潜已经开始，无法中途加入：已作为观战者进入。' \}\)/);
  assert.match(main, /sessionStorage\.getItem\('sp\.joinNote'\)/, '落地页要读它');
  const readAt = main.indexOf("sessionStorage.getItem('sp.joinNote')");
  const delAt = main.indexOf("sessionStorage.removeItem('sp.joinNote')", readAt);
  assert.ok(readAt > 0 && delAt > readAt, '念一次就删（否则每次进房都重复弹）');
  assert.match(main.slice(readAt, delAt + 120), /toast\(t\(note\)/, '念的是这句 msgid 的译文');
});

test('i18n：新增的提示语四个包都有', () => {
  const keys = ['这间深潜已经开始，无法中途加入：已作为观战者进入。'];
  for (const code of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${code}.json`));
    for (const k of keys) {
      assert.ok(typeof pack[k] === 'string' && pack[k].length > 0, `${code}.json 缺「${k}」`);
    }
  }
});
