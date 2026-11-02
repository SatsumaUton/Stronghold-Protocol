// 验证「公开同盟」跨节点：建房 → 设为公开 → 看匹配器 /api/rooms/open 是否带节点返回
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';

const NODE = Number(process.argv[2] || 29);
const PORT = 3000 + NODE;
const MM = 'http://127.0.0.1:3090';
const account = JSON.parse(fs.readFileSync('D:/Stronghold-Protocol/.secrets/test-accounts.json', 'utf8')).accounts[0];

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
const cap = await req('/api/auth/captcha');
const chars = [...(cap?.svg || '').matchAll(/<text[^>]*>([^<])<\/text>/g)].map((m) => m[1]);
const login = await req('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: account.email, password: account.password, captchaId: cap?.id, captcha: chars.join('') }),
});
if (!login?.ok) { console.log('登录失败 ' + JSON.stringify(login)); process.exit(1); }
console.log(`  登录 ${account.nickname}`);

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
      }
    });
    sock.on('error', reject);
    let seq = 0;
    const api = {
      msgs,
      lastRid: () => seq,
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
      next(ms = 5000) { return new Promise((res) => { const t = setTimeout(() => res(null), ms); waiters.push((m) => { clearTimeout(t); res(m); }); }); },
      close() { try { sock.destroy(); } catch { /* ignore */ } },
    };
  });
}

async function waitRid(cli, rid, ms = 6000) {
  const end = Date.now() + ms;
  const hit = cli.msgs.find((m) => m.rid === rid);
  if (hit) return hit;
  while (Date.now() < end) {
    const m = await cli.next(Math.max(120, end - Date.now()));
    if (m && m.rid === rid) return m;
    if (!m) break;
  }
  return null;
}

const cli = await wsConnect();
cli.send({ t: 'hello', name: account.nickname || 'P', accountToken: login.userToken });
const w = await waitRid(cli, cli.lastRid());
console.log(`  welcome: ${w ? 'ok' : '未收到'}`);

cli.send({ t: 'room.create', mode: 'coop' });
const made = await waitRid(cli, cli.lastRid());
if (made?.t === 'error') { console.log('  建房失败: ' + JSON.stringify(made)); cli.close(); process.exit(1); }
// create 只回 OK，房间码在随后的 room.state 广播里
const end = Date.now() + 6000;
let st = cli.msgs.find((m) => m.t === 'room.state' && m.code);
while (!st && Date.now() < end) { const m = await cli.next(600); if (m && m.t === 'room.state' && m.code) st = m; }
const code = st?.code;
console.log(`  建房: ${code ? code : '未拿到 room.state'}  source=${st?.mode || '?'}`);
if (!code) { cli.close(); process.exit(1); }

cli.send({ t: 'room.setListed', listed: true });
const listed = await waitRid(cli, cli.lastRid());
console.log(`  设为公开: ${JSON.stringify(listed)}`);

// setListed 之后服务端会广播一条新的 room.state：先看内存里的 listed 到底是不是 true
await new Promise((r) => setTimeout(r, 1200));
const lastState = cli.msgs.filter((m) => m.t === 'room.state').pop();
console.log(`  内存态 room.state: listed=${lastState?.listed}  matchmaking=${lastState?.matchmaking}  code=${lastState?.code}`);
console.log('  保持连接，等待聚合与持久化（最多 25 秒）…');
let found = null;
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const j = await fetch(MM + '/api/rooms/open').then((r) => r.json()).catch(() => null);
  found = (j?.rooms || []).find((x) => x.code === code);
  if (found) { console.log(`    第 ${i + 1} 秒出现在列表里`); break; }
  if (i === 4 || i === 11 || i === 18) {
    const raw = await new Promise((res) => {
      const key = `sp:n${NODE}:lobby:rooms`;
      const parts = ['HGET', key, code];
      let out = `*${parts.length}\r\n`;
      for (const q of parts) out += `$${Buffer.byteLength(q)}\r\n${q}\r\n`;
      const s = net.connect(6379, '127.0.0.1', () => s.write(out));
      let b = ''; s.on('data', (d) => { b += d.toString(); }); s.on('end', () => res(b));
      s.on('error', () => res(''));
      setTimeout(() => { try { s.end(); } catch { /* ignore */ } }, 600);
    });
    const mm2 = raw.match(/\{[\s\S]*\}/);
    let lz = 'no-doc';
    if (mm2) { try { const d = JSON.parse(mm2[0]); lz = `listed=${d.listed} matchmaking=${d.matchmaking} source=${d.source}`; } catch { lz = 'parse-fail'; } }
    console.log(`    [Redis] ${lz}`);
  }
  if (i === 9 || i === 19) {
    // 顺带看一眼 Redis 里 listed 有没有写进去
    const hz = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json()).catch(() => ({}));
    console.log(`    第 ${i + 1} 秒：列表仍空，节点 rooms=${hz.rooms}`);
  }
}
if (found) {
  console.log('  ✓ 出现在跨节点公开同盟列表里：');
  console.log('    ' + JSON.stringify(found));
  console.log(`    节点=${found.node}（应当等于 ${NODE}）`);
} else {
  console.log('  ✗ 15 秒内没有出现在列表里');
  const j = await fetch(MM + '/api/rooms/open').then((r) => r.json()).catch(() => null);
  console.log('    当前列表: ' + JSON.stringify(j?.rooms || []));
}
console.log(`\n  ROOM_CODE=${code}  NODE=${NODE}`);
cli.close();
process.exit(found ? 0 : 1);
