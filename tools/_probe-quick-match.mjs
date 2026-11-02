// 多人匹配端到端验证：4 个真实账号 → WS → room.quickMatch → 排队 → 成形 → 开局
// 只用真实接口，不 mock。用完删掉。
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';

const NODE = Number(process.argv[2] || 5);
const PORT = 3000 + NODE;
const MM = 'http://127.0.0.1:3090';
const DIFF = process.argv[3] || 'FUNNY';
const COUNT = Number(process.argv[4] || 4);

const accounts = JSON.parse(fs.readFileSync('D:/Stronghold-Protocol/.secrets/test-accounts.json', 'utf8')).accounts;

const jar = new Map();
async function req(p, o = {}) {
  const res = await fetch(MM + p, {
    ...o,
    headers: { 'Content-Type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) },
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';'); const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  return res.json().catch(() => null);
}

async function login(who) {
  const cap = await req('/api/auth/captcha');
  const chars = [...(cap?.svg || '').matchAll(/<text[^>]*>([^<])<\/text>/g)].map((m) => m[1]);
  const r = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: who.email, password: who.password, captchaId: cap?.id, captcha: chars.join('') }),
  });
  if (!r?.ok) throw new Error('login failed: ' + JSON.stringify(r));
  return r.userToken;
}

function wsConnect() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = Buffer.alloc(0); let upgraded = false;
    const msgs = []; const waiters = [];
    const push = (m) => { msgs.push(m); for (const w of waiters.splice(0)) w(m); };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        if (!/101/.test(buf.slice(0, i).toString())) { reject(new Error('handshake failed')); return; }
        upgraded = true; buf = buf.slice(i + 4); resolve(api);
      }
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f; let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 1) { let m = null; try { m = JSON.parse(payload.toString()); } catch { /* ignore */ } if (m) push(m); }
        else if (op === 8) { push({ t: '__close' }); }
      }
    });
    sock.on('error', reject);
    let seq = 0;
    const api = {
      msgs,
      send(obj) {
        const rid = ++seq;
        const data = Buffer.from(JSON.stringify({ rid, ...obj }));
        const len = data.length; let head;
        if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
        else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
        const mask = crypto.randomBytes(4);
        const m = Buffer.alloc(len);
        for (let i = 0; i < len; i++) m[i] = data[i] ^ mask[i % 4];
        sock.write(Buffer.concat([head, mask, m]));
      },
      lastRid() { return seq; },
      next(ms = 5000) { return new Promise((res) => { const t = setTimeout(() => res(null), ms); waiters.push((m) => { clearTimeout(t); res(m); }); }); },
      close() { try { sock.destroy(); } catch { /* ignore */ } },
    };
  });
}

async function waitFor(cli, pred, ms = 8000) {
  const hit = cli.msgs.find(pred);
  if (hit) return hit;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = await cli.next(Math.max(120, end - Date.now()));
    if (pred(m)) return m;
    if (!m) break;
  }
  return null;
}
async function waitType(cli, type, ms = 6000, rid = null) {
  const match = (m) => m && m.t === type && (rid == null || m.rid === rid);
  const hit = cli.msgs.find(match);
  if (hit) return hit;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = await cli.next(Math.max(120, end - Date.now()));
    if (match(m)) return m;
    if (!m) break;
  }
  return null;
}

const players = [];
for (let i = 0; i < COUNT; i++) {
  const who = accounts[i];
  const token = await login(who);
  const cli = await wsConnect();
  cli.send({ t: 'hello', name: who.nickname || `T${i}`, accountToken: token });
  const w = await waitType(cli, 'welcome');
  if (!w) throw new Error(`client ${i} 没有 welcome`);
  players.push({ i, who, cli, name: who.nickname, accountId: w.accountId ?? w.playerId });
  console.log(`  连接 ${i}: ${who.nickname}  accountId=${w.accountId ?? '(无)'}`);
}

const me = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
console.log(`  节点 ${NODE} 现状: matches=${me.matches} rooms=${me.rooms}\n`);

console.log('===  人依次点「开始多人匹配」 ===');
const tickets = [];
for (const p of players) {
  p.cli.msgs.length = 0;
  p.cli.send({ t: 'room.quickMatch', difficulty: DIFF, seats: 'four', rules: 'standard' });
  const rid = p.cli.lastRid();
  const ok = await waitType(p.cli, 'ok', 6000, rid);
  const errMsg = await waitType(p.cli, 'error', 600, rid);
  if (errMsg) { console.log(`  ${p.name}: ✗ 被拒 ${errMsg.code} / ${errMsg.detail || ''}`); continue; }
  if (ok?.queued && ok.ticket) { tickets.push({ p, ticket: ok.ticket }); console.log(`  ${p.name}: 排队 ticket=${ok.ticket}`); }
  else if (ok?.code) { console.log(`  ${p.name}: 直接进房 ${ok.code}（joined=${ok.joined}）`); tickets.push({ p, code: ok.code }); }
  else console.log(`  ${p.name}: 答复异常 ${JSON.stringify(ok)}`);
}

if (!tickets.length) { console.log('\n没有任何人成功排队 —— 失败'); process.exit(1); }

if (COUNT < 4) {
  console.log('\n=== 人不够（' + COUNT + '/4）：应停在排队，显示位置与还差几人 ===');
  let sawQueued = false;
  for (let t2 = 0; t2 < 4; t2++) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const it of tickets) {
      it.p.cli.send({ t: 'room.quickState', ticket: it.ticket });
      const qrid = it.p.cli.lastRid();
      const st = await waitType(it.p.cli, 'ok', 3000, qrid);
      if (st?.state === 'queued') {
        sawQueued = true;
        console.log(`  ${it.p.name}: state=queued 位置=${st.position} 还差=${st.need} 已等=${Math.round((st.elapsedMs || 0) / 1000)}s`);
      } else if (st?.state === 'matched') {
        console.log(`  ${it.p.name}: 竟然已成形 ${st.code}`);
      }
    }
  }
  console.log('\n=== 取消匹配（room.quickLeave）===');
  for (const it of tickets) {
    it.p.cli.send({ t: 'room.quickLeave', ticket: it.ticket });
    const lrid = it.p.cli.lastRid();
    const r = await waitType(it.p.cli, 'ok', 3000, lrid);
    const e = await waitType(it.p.cli, 'error', 400, lrid);
    console.log(`  ${it.p.name}: 取消 -> ${e ? '错误 ' + e.code : (r ? 'ok' : '无回复')}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const h = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
  console.log(`\n  取消后节点 ${NODE}: matches=${h.matches} rooms=${h.rooms}（应仍为 0 / 0）`);
  for (const p2 of players) p2.cli.close();
  console.log(`\n结果：排队态${sawQueued ? '可见' : '不可见'}`);
  process.exit(sawQueued && h.rooms === 0 ? 0 : 1);
}

console.log(`\n=== 等待成形（最多 20 秒）===  排队 ${tickets.length} 人`);
let formed = null;
for (let t = 0; t < 20 && !formed; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  for (const it of tickets) {
    if (!it.ticket) continue;
    it.p.cli.send({ t: 'room.quickState', ticket: it.ticket });
    const srid = it.p.cli.lastRid();
    const latest = await waitType(it.p.cli, 'ok', 3000, srid);
    if (t === 0 && it.ticket === tickets[0].ticket) {
      const raw = it.p.cli.msgs.filter((m) => m.rid === srid);
      console.log('  [调试] quickState 原始回复: ' + JSON.stringify(raw.slice(-1)[0] || null));
    }
    if (latest?.state === 'matched' && latest.code) { formed = { code: latest.code, by: it.p.name }; break; }
    if (latest?.state === 'queued') {
      if (t % 4 === 0) console.log(`  ${it.p.name}: 排队中 位置 ${latest.position} 还差 ${latest.need} 已等 ${Math.round((latest.elapsedMs || 0) / 1000)}s`);
    }
  }
}

if (!formed) { console.log('\n✗ 20 秒内没有成形'); process.exit(1); }
console.log(`\n✓ 成形：房间 ${formed.code}（由 ${formed.by} 的票据先看到）`);

await new Promise((r) => setTimeout(r, 2500));
const after = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
console.log(`  节点 ${NODE} 之后: matches=${after.matches} rooms=${after.rooms}`);

// 每个人应当收到 room.state，且里面已经开打
let started = 0;
for (const p of players) {
  // 缓冲区里可能已经有「进房那一刻」的 room.state（那时还没开局）。要等的是 inMatch=true 的那条。
  const st = await waitFor(p.cli, (m) => m.t === 'room.state' && m.inMatch === true, 12000);
  if (p.i === 0 && st) console.log('  [调试] room.state 顶层键: ' + Object.keys(st).join(','));
  // room.state 用 inMatch 表示「这一局已经开了」（没有 started/phase 字段）
  const startedFlag = st?.inMatch === true;
  console.log(`  ${p.name}: room.state ${st ? '收到' : '未收到'}  已开局(inMatch)=${startedFlag}  房间=${st?.code || '?'}  难度=${st?.difficulty || '?'}  人数=${st?.capacity ?? '?'}`);
  if (startedFlag) started++;
}
console.log(`\n结果：${started}/4 人已在同一局里`);
for (const p of players) p.cli.close();
process.exit(started >= 4 ? 0 : 1);
