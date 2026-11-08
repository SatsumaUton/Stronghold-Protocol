// 墓碑：房间被回收时留下的最后一份副本（维护者 2026-11-09）。
//
// 背景：2026-11-09 有 15 间「保存中的单人深潜」被误当僵尸房回收，Redis 里 `disposeRoom` → `goneRooms`
// 是**真删除**，而 Redis 没有 AOF / 从库 / 卷影副本，MySQL 的每日备份也不含 Redis —— 数据永久消失。
// 现在删除前先写一张 `tomb:<房号>`（TTL 24 小时），`tools/restore-room.mjs` 能读回来写回。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckpointStore, TOMB_TTL_MS, STORE_TTL_MS } from '../../server/persist/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 一个记账用的假客户端：只实现 store.js 用到的命令，把 SET 的 TTL 记下来。
 * @returns {{ command: (name: string, ...args: any[]) => Promise<any>, sets: Map<string, number>, hashes: Map<string, Map<string,string>> }}
 */
function fakeClient() {
  const sets = new Map();          // key → ttlMs
  const values = new Map();        // key → encoded bytes
  const hashes = new Map();        // key → Map(field → text)
  return {
    sets, hashes, ready: true, stats: {},
    async command(name, ...args) {
      switch (name) {
        case 'SET': values.set(args[0], args[1]); if (args[2] === 'PX') sets.set(args[0], Number(args[3])); return 'OK';
        case 'GET': return values.has(args[0]) ? values.get(args[0]) : null;
        case 'DEL': { const had = values.delete(args[0]); sets.delete(args[0]); return had ? 1 : 0; }
        case 'HSET': {
          const m = hashes.get(args[0]) || new Map();
          for (let i = 1; i + 1 < args.length; i += 2) m.set(args[i], args[i + 1]);
          hashes.set(args[0], m);
          return 1;
        }
        case 'HGETALL': { const m = hashes.get(args[0]); return m ? [...m].flat() : []; }
        case 'HDEL': { const m = hashes.get(args[0]); if (m) for (const f of args.slice(1)) m.delete(f); return 1; }
        case 'PEXPIRE': sets.set(args[0], Number(args[1])); return 1;
        case 'KEYS': {
          const re = new RegExp('^' + String(args[0]).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
          return [...values.keys()].filter((k) => re.test(k));
        }
        default: return null;
      }
    },
    async close() {},
  };
}

function store() {
  const client = fakeClient();
  return { client, store: new CheckpointStore({ url: 'redis://x', client, log: quiet }) };
}

test('saveTombstone / loadTombstone / deleteTombstone：键名与 TTL', async () => {
  const { client, store: s } = store();
  const rec = { v: 1, code: 'AXVU', at: 1_800_000_000_000, reason: 'expired', room: { code: 'AXVU' }, checkpoint: null };
  assert.equal(await s.saveTombstone('AXVU', rec), true);
  assert.equal(client.sets.get('sp:tomb:AXVU'), TOMB_TTL_MS, '墓碑保留 24 小时');
  assert.ok(TOMB_TTL_MS < STORE_TTL_MS, '比普通键的 25 小时短一点点');
  const got = await s.loadTombstone('AXVU');
  assert.equal(got.ok, true);
  assert.deepEqual(got.value, rec, '读回来内容一致');
  assert.equal(await s.deleteTombstone('AXVU'), true);
  assert.equal((await s.loadTombstone('AXVU')).value, null, '删掉就没了');
});

test('墓碑的 TTL 与普通键互不影响', async () => {
  const { client, store: s } = store();
  await s.saveCheckpoint('L.ABCD.1.x', JSON.stringify({ v: 1 }));
  await s.saveTombstone('ABCD', { v: 1, code: 'ABCD' });
  assert.equal(client.sets.get('sp:cp:L.ABCD.1.x'), STORE_TTL_MS, '检查点仍是 25 小时');
  assert.equal(client.sets.get('sp:tomb:ABCD'), TOMB_TTL_MS, '墓碑是 24 小时');
});

test('listTombstones：只列 tomb:* 的房号', async () => {
  const { store: s } = store();
  await s.saveTombstone('AAAA', { v: 1, code: 'AAAA' });
  await s.saveTombstone('BBBB', { v: 1, code: 'BBBB' });
  await s.saveCheckpoint('L.CCCC.1.x', '{}');
  const listed = await s.listTombstones();
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value.sort(), ['AAAA', 'BBBB'], '不带检查点');
});

test('房号非法时不写（防止往 Redis 里塞奇怪的键）', async () => {
  const { store: s } = store();
  assert.equal(await s.saveTombstone('../etc/passwd', { v: 1 }), false);
  assert.equal(await s.saveTombstone('', {}), false);
});

test('persister：墓碑在 disposeRoom 那一刻写（`onRoomDisposing` 钩子），不是等下一轮 flush', () => {
  const src = read('server/persist/persister.js');
  assert.match(src, /lobby\.onRoomDisposing = \(room, reason\) => \{ void this\.tombstone\(room, reason\); \};/, '装钩子');
  assert.match(src, /async tombstone\(room, reason\) \{/, '有实现，收的是房间对象而不是房号');
  assert.match(src, /saveTombstone\(code, \{/, '调用 store');
  assert.match(src, /reason: why,/, '带上回收原因');
  // 墓碑里要能带检查点（否则救回来的只是个空房间）
  assert.match(src, /checkpoint = \{ id: rec\.id, json: rec\.json \}/, '复用已抓的检查点');
  assert.match(src, /reason: 'tombstone'/, '没有现成的就现抓一份');
  // 不能再从 goneRooms 里补写：那时房间已经空了，写出来是空壳
  assert.doesNotMatch(src, /for \(const code of goneRooms\) \{[\s\S]{0,200}this\.tombstone/, 'goneRooms 里不该再写墓碑');
});

test('disposeRoom 记下原因并在动手前调用钩子（那一刻房间还完整）', () => {
  const src = read('server/lobby.js');
  assert.match(src, /room\.disposeReason = reason;/, 'disposeRoom 要记原因');
  // 钩子必须在 room.disposed = true 之前
  const iHook = src.indexOf('this.onRoomDisposing(room, reason)');
  const iDisposed = src.indexOf('room.disposed = true;', src.indexOf('disposeRoom(room, reason)'));
  assert.ok(iHook > 0 && iDisposed > iHook, '钩子要在清空房间之前调用');
});

test('tools/restore-room.mjs：能列、能看、能写回，且拒绝覆盖活着的房间', () => {
  const src = read('tools/restore-room.mjs');
  assert.match(src, /--list/, '列墓碑');
  assert.match(src, /loadTombstone\(args\.code\)/, '按房号读');
  assert.match(src, /hashUpdate\('lobby:rooms', \[\[args\.code, JSON\.stringify\(tomb\.room\)\]\]\)/, '写回房间文档');
  assert.match(src, /saveCheckpoint\(tomb\.checkpoint\.id, tomb\.checkpoint\.json\)/, '写回检查点');
  assert.match(src, /拒绝覆盖/, '活着的房间不能被顶掉');
  assert.match(src, /pm2 restart node-/, '提示重启（恢复只在启动时做）');
  assert.match(src, /prefix: `sp:n\$\{node\}:`/, '按节点前缀取 store');
});
