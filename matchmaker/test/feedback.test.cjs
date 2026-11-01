// matchmaker/test/feedback.test.cjs — 玩家反馈板。
//
// 跑法：`node --test matchmaker/test/`
//
// 分两类：
//   * 纯函数（文本清洗 / 长度 / 查询参数解析）——不碰数据库，任何环境都能跑；
//   * 数据库（建表 / 写入 / 列表 / 搜索 / 服主操作 / 删除）——需要 `.secrets/secrets.json` 里的库配置，
//     连不上就整体跳过，不会让 CI 变红。写入用 account_id = 990001 这个不可能存在的账号，
//     结束时按这个 id 清干净，不污染真实数据。
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const path = require('node:path');

const fb = require(path.join(__dirname, '..', 'feedback.cjs'));

const TEST_ACCOUNT = 990001;
// ★ 2026-11-02：未读用例需要一个**和发帖人不同**的管理员账号。
//   一开始 admin 也用了 TEST_ACCOUNT，结果 unreadFor 的「排除自己发的」把
//   发帖人自己也排除了，未读永远是 0 —— 那是测试写错，不是代码错。
const TEST_ADMIN = 990002;
// 发帖人也要另用一个：上面「限流」那个用例会故意把 TEST_ACCOUNT 的配额用光
// （10 分钟 3 条，存在 feedback.cjs 的内存 Map 里，测试没法清），
// 未读用例再用它发帖就只会拿到 RATE_LIMITED。
const TEST_POSTER = 990003;

/** 造一个假的 req：JSON 请求体 + 必要头。 */
function fakeReq(body, { ip = '10.0.0.1', headers = {} } = {}) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  const req = Readable.from([buf]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', 'x-real-ip': ip, ...headers };
  req.socket = { remoteAddress: ip };
  return req;
}

// ── 纯函数 ──────────────────────────────────────────────────────────────────

test('cleanLine：空白压缩、控制字符剔除、首尾去空白', () => {
  assert.equal(fb.cleanLine('  你好   世界  '), '你好 世界');
  assert.equal(fb.cleanLine('a\u0000b\u0007c'), 'abc');
  assert.equal(fb.cleanLine('a\tb\nc'), 'a b c');
  assert.equal(fb.cleanLine('　全角空格　'), '全角空格');
  assert.equal(fb.cleanLine(null), '');
  assert.equal(fb.cleanLine(123), '');
});

test('cleanBody：CRLF/CR 统一成 LF，保留换行与 TAB，去掉其他控制字符', () => {
  assert.equal(fb.cleanBody('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(fb.cleanBody('a\tb'), 'a\tb');
  assert.equal(fb.cleanBody('\u0001\u0002x'), 'x');
  assert.equal(fb.cleanBody('  \n 正文 \n '), '正文');
  assert.equal(fb.cleanBody(undefined), '');
});

test('cps：按码点计数（emoji / 汉字都算一个字）', () => {
  assert.equal(fb.cps('你好'), 2);
  assert.equal(fb.cps('👍'), 1);
  assert.equal(fb.cps('a👍b'), 3);
  assert.equal(fb.cps(''), 0);
});

test('LIMITS 与文档一致', () => {
  assert.deepEqual(fb.LIMITS.title, [2, 80]);
  assert.deepEqual(fb.LIMITS.body, [5, 4000]);
  assert.deepEqual(fb.LIMITS.reply, [0, 2000]);
  assert.deepEqual([...fb.CATEGORIES], ['bug', 'gameplay', 'ui', 'other']);
  assert.deepEqual([...fb.STATUSES], ['unassigned', 'unplanned', 'planned', 'updated']);
});

test('parseQuery：默认值、上限、非法值', () => {
  const ok = (qs) => fb.parseQuery(new URL('http://x/api/feedback/items' + qs));
  assert.deepEqual(ok(''), { status: '', category: '', q: '', before: null, limit: 20 });
  assert.equal(ok('?limit=999').limit, 50);          // 超过 50 按 50
  assert.equal(ok('?limit=5').limit, 5);
  assert.equal(ok('?status=planned').status, 'planned');
  assert.equal(ok('?status=all').status, 'all');
  assert.equal(ok('?status=bogus').error, 'status');
  assert.equal(ok('?category=bogus').error, 'category');
  assert.equal(ok('?before=abc').error, 'before');
  assert.equal(ok('?before=-1').error, 'before');
  assert.equal(ok('?limit=0').error, 'limit');
  assert.equal(ok('?q=' + 'a'.repeat(65)).error, 'q');
  assert.equal(ok('?q=' + 'a'.repeat(64)).error, undefined);
});

// ── 数据库 ──────────────────────────────────────────────────────────────────

/** 数据库可用吗？连不上就跳过整组。 */
async function dbReady() {
  try {
    await fb.ensureSchema();
    return true;
  } catch {
    return false;
  }
}

test('反馈板（数据库）', async (t) => {
  if (!(await dbReady())) {
    t.skip('数据库不可用（缺 .secrets/secrets.json 或连不上），跳过');
    return;
  }
  const { db } = require(path.join(__dirname, '..', 'account.cjs'));
  const user = { id: TEST_ACCOUNT, name: '测试博士', role: 'player' };
  const admin = { id: TEST_ACCOUNT, name: '测试服主', role: 'owner' };
  // 未读用例专用：管理员必须与发帖人不是同一个账号，否则「排除自己发的」会把
  // 发帖人也排除掉（见 TEST_ADMIN 的注释）
  const boss = { id: TEST_ADMIN, name: '测试服主', role: 'owner' };
  const poster = { id: TEST_POSTER, name: '测试路人', role: 'player' };
  const cleanup = () => db().query('DELETE FROM feedback_items WHERE account_id IN (?,?,?)', [TEST_ACCOUNT, TEST_ADMIN, TEST_POSTER]);
  await cleanup();
  t.after(cleanup);

  await t.test('写入：署名取账号名，忽略客户端自称', async () => {
    const req = fakeReq({ category: 'bug', title: '测试：卡在加载界面', body: '进对局后一直白屏。', author: '我自称的名字' });
    const out = await fb.createItem(req, user);
    assert.ok(out.item, JSON.stringify(out));
    assert.equal(out.item.author, '测试博士');
    assert.equal(out.item.status, 'unassigned');
    assert.equal(out.item.reply, '');
    assert.equal(out.item.replyAt, null);
    assert.equal(out.item.mine, true);
    assert.equal(out.item.hidden, undefined); // 普通玩家看不到 hidden
  });

  await t.test('写入：标题过短 / 正文过短 / 分类非法都被拒', async () => {
    const short = await fb.createItem(fakeReq({ category: 'bug', title: 'x', body: '正文够长了吧' }), user);
    assert.deepEqual([short.error, short.field], ['INVALID', 'title']);
    const noBody = await fb.createItem(fakeReq({ category: 'bug', title: '够长的标题', body: '短' }), user);
    assert.deepEqual([noBody.error, noBody.field], ['INVALID', 'body']);
    const badCat = await fb.createItem(fakeReq({ category: 'nope', title: '够长的标题', body: '正文够长了吧' }), user);
    assert.deepEqual([badCat.error, badCat.field], ['INVALID', 'category']);
  });

  await t.test('写入：24 小时内同标题同正文判重', async () => {
    const body = { category: 'ui', title: '测试：重复提交', body: '同样的内容提交两次。' };
    const first = await fb.createItem(fakeReq(body), user);
    assert.ok(first.item, JSON.stringify(first));
    const second = await fb.createItem(fakeReq(body), user);
    assert.equal(second.error, 'DUPLICATE');
    assert.equal(second.id, first.item.id);
  });

  await t.test('列表：分页、状态筛选、搜索、计数', async () => {
    const url = (qs) => new URL('http://x/api/feedback/items' + qs);
    const all = await fb.listItems(url('?limit=50'), null);
    assert.ok(Array.isArray(all.items));
    assert.ok(all.counts.all >= 2);
    assert.equal(all.counts.all, all.counts.unassigned + all.counts.unplanned + all.counts.planned + all.counts.updated);

    // 搜索命中
    const hit = await fb.listItems(url('?q=' + encodeURIComponent('白屏')), null);
    assert.ok(hit.items.some((i) => i.title.includes('卡在加载界面')));
    // 搜索不命中
    const miss = await fb.listItems(url('?q=' + encodeURIComponent('绝对不存在的词xyzzy')), null);
    assert.equal(miss.items.length, 0);
    // 分类筛选
    const ui = await fb.listItems(url('?category=ui&limit=50'), null);
    assert.ok(ui.items.every((i) => i.category === 'ui'));
    // 分页：limit=1 时 next 有值
    const one = await fb.listItems(url('?limit=1'), null);
    assert.equal(one.items.length, 1);
    assert.ok(one.next == null || one.next > 0);
  });

  await t.test('服主：改状态 / 回复 / 隐藏；玩家视图看不到隐藏条目', async () => {
    const created = await fb.createItem(fakeReq({ category: 'gameplay', title: '测试：服主操作', body: '用于验证状态与回复。' }), user);
    const id = created.item.id;

    const replied = await fb.adminUpdate(id, fakeReq({ status: 'planned', reply: '已排期，下个版本修。' }), admin);
    assert.equal(replied.item.status, 'planned');
    assert.equal(replied.item.reply, '已排期，下个版本修。');
    assert.ok(replied.item.replyAt > 0);
    assert.equal(replied.item.hidden, false); // 服主视图带 hidden

    const hidden = await fb.adminUpdate(id, fakeReq({ hidden: true }), admin);
    assert.equal(hidden.item.hidden, true);

    // 玩家列表里看不到
    const asPlayer = await fb.listItems(new URL('http://x/api/feedback/items?limit=50'), null);
    assert.ok(!asPlayer.items.some((i) => i.id === id));
    // 服主列表里看得到
    const asAdmin = await fb.listItems(new URL('http://x/api/feedback/items?limit=50'), admin);
    assert.ok(asAdmin.items.some((i) => i.id === id && i.hidden === true));

    // 清回复
    const cleared = await fb.adminUpdate(id, fakeReq({ reply: '' }), admin);
    assert.equal(cleared.item.reply, '');
    assert.equal(cleared.item.replyAt, null);

    // 非法状态
    const bad = await fb.adminUpdate(id, fakeReq({ status: 'bogus' }), admin);
    assert.deepEqual([bad.error, bad.field], ['INVALID', 'status']);
    // 不存在的 id
    const missing = await fb.adminUpdate(999999999, fakeReq({ status: 'planned' }), admin);
    assert.equal(missing.error, 'NOT_FOUND');
  });

  await t.test('限流：同一账号 10 分钟内超过 3 条被拦', async () => {
    // 前面几个用例已经用掉了一些配额；这里换一个地址，配额是按账号算的，所以先确认是否已触发
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await fb.createItem(fakeReq({ category: 'other', title: '测试：限流 ' + i, body: '限流用例第 ' + i + ' 条。' }), user));
    }
    assert.ok(results.some((r) => r.error === 'RATE_LIMITED'), '应当至少有一条被限流');
    const limited = results.find((r) => r.error === 'RATE_LIMITED');
    assert.ok(limited.retryAfter > 0);
  });

  // ── 新反馈提醒（2026-11-02）─────────────────────────────────────────────
  // 维护者要求：新消息在服主/管理员上线后提示；普通玩家不提示。
  // 这里测的是「未读怎么算」和「已读怎么推进」，邮件那半用 SP_FEEDBACK_NOTIFY 关掉。

  await t.test('未读：服主看得到别人发的，看不到自己发的', async () => {
    const dbh = db();
    await dbh.query('DELETE FROM feedback_seen WHERE account_id IN (?,?,?)', [TEST_ACCOUNT, TEST_ADMIN, TEST_POSTER]);
    // 从 0 开始：此刻库里所有未隐藏的反馈都算未读（除了自己的）
    const before = await fb.unreadFor(boss);
    assert.ok(before.count >= 0, JSON.stringify(before));
    // 把已读推到底，归零
    await fb.markSeen(boss);
    const zero = await fb.unreadFor(boss);
    assert.equal(zero.count, 0, '标记已读后应为 0');
    assert.deepEqual(zero.latest, []);

    // 普通玩家发一条 → 服主这边应当 +1
    const made = await fb.createItem(fakeReq({ category: 'bug', title: '测试：新反馈提醒', body: '用来验证未读计数。' }), poster);
    assert.ok(made.item, JSON.stringify(made));
    const after = await fb.unreadFor(boss);
    assert.equal(after.count, 1, JSON.stringify(after));
    assert.equal(after.latest.length, 1);
    assert.equal(after.latest[0].id, made.item.id);
    assert.equal(after.latest[0].title, '测试：新反馈提醒');
    assert.equal(after.latest[0].author, '测试路人');
    // 提示条只要摘要，不要正文
    assert.equal(after.latest[0].body, undefined);

    // 服主自己再发一条 → 不该算进自己的未读
    // 注意用 boss 而不是 admin：admin 的 id 就是 TEST_ACCOUNT，上面「限流」用例
    // 已经把它的配额用光了。用 boss 发也正好是这条用例真正要验的语义
    // ——「自己发的不会提醒自己」。
    const own = await fb.createItem(fakeReq({ category: 'other', title: '测试：服主自己发的', body: '自己发的不该提醒自己。' }), boss);
    assert.ok(own.item, JSON.stringify(own));
    const still = await fb.unreadFor(boss);
    assert.equal(still.count, 1, '自己发的不该进未读: ' + JSON.stringify(still));

    // 推进已读后归零
    await fb.markSeen(boss);
    assert.equal((await fb.unreadFor(boss)).count, 0);
  });

  await t.test('未读：lastSeenId 只前进不后退', async () => {
    const dbh = db();
    await dbh.query('DELETE FROM feedback_seen WHERE account_id IN (?,?,?)', [TEST_ACCOUNT, TEST_ADMIN, TEST_POSTER]);
    await fb.markSeen(boss);
    const first = await fb.lastSeenId(TEST_ADMIN);
    assert.ok(first > 0, 'markSeen 之后应当 > 0');
    await fb.markSeen(boss);
    const second = await fb.lastSeenId(TEST_ADMIN);
    assert.ok(second >= first, 'last_seen_id 不能倒退');
  });

  await t.test('未读：隐藏的反馈不算未读', async () => {
    await fb.markSeen(boss);
    const made = await fb.createItem(fakeReq({ category: 'ui', title: '测试：待隐藏', body: '隐藏后不该出现在未读里。' }), poster);
    assert.ok(made.item, JSON.stringify(made));
    assert.equal((await fb.unreadFor(boss)).count, 1);
    await fb.adminUpdate(made.item.id, fakeReq({ hidden: true }), admin);
    assert.equal((await fb.unreadFor(boss)).count, 0, '隐藏后应为 0');
  });

  t.after(() => db().query('DELETE FROM feedback_seen WHERE account_id IN (?,?,?)', [TEST_ACCOUNT, TEST_ADMIN, TEST_POSTER]));
});

// ★ 2026-11-02：关掉 mysql2 连接池，否则 `node --test` 会一直挂着不退出
//   （所有用例都跑完了，进程却卡在事件循环里，之前要人工超时强杀）。
//   放在最后一个 after 里，等上面所有清理查询都跑完再关。
test.after(async () => {
  try {
    const { db } = require(path.join(__dirname, '..', 'account.cjs'));
    await db().end();
  } catch { /* 池没建过 / 已经关了，都不用管 */ }
});
