// test/ui/version-content.test.js — the browser side of the official versions' data (DESIGN §35.23, M1; protocol §3):
//   * content.js loadVersionSet: a version's /cs/<cs16>/index.json (vanilla, its `version` the id expected, no plugins or
//     settings, its composition hashing to the cs), every data file under /data/versions/<slug>/ checked by its bytes, the
//     official-bounds snapshot under /cs/<cs16>/; refused: a changed byte, a file outside the version's folder, another
//     version's manifest, another cs, plugins in the manifest, a bounds address elsewhere;
//   * content.js installContentSet: the version the page shows — the lobby's choice (welcome.versions' cs, never told to a
//     room), a room's version (room.state.content.cs, told with room.contentReady, again when the seat shows 'loading' — a
//     reconnect), the set on screen kept until the next one is checked, the last two kept (a lobby ⇄ room round trip
//     downloads nothing twice), a gameplay plugin room inside a version lobby (the plugins' own path), a failure said once;
//   * simContent / contentFor hand the runner the version's data with its bounds snapshot (and `version`);
//   * data.js keeps a version set's texts Chinese (versionFiles: the language folder is keyed by 第二期下半's ids).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installContentSet, contentSet } from '../../public/js/content.js';
import { createDataStore } from '../../public/js/data.js';
import { createStore, initialState } from '../../public/js/store.js';
import { sanitizeVersions } from '../../public/js/versions.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { sha256Hex } from '../../shared/sha256.js';
import { validateC2S } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred, what) => { for (let i = 0; i < 400; i++) { if (pred()) return; await tick(); } assert.fail(`timed out: ${what}`); };
const noWait = () => Promise.resolve();
// 重发是 4 秒后的事：这里按真实毫秒等（最多 12 秒）
const untilMs = async (pred, what, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail(`timed out: ${what}`);
};
const FILES = ['config', 'chess', 'bonds'];

/** A version set as the server would serve it (protocol §3): its index, the files by URL, its cs. */
function versionServed(id, slug, { files = FILES, app = '0.3.2-test', edit = null } = {}) {
  const bodies = new Map();
  const data = {};
  for (const name of files) {
    const buf = fs.readFileSync(path.join(ROOT, 'data/versions', slug, `${name}.json`));
    const sha256 = sha256Hex(new Uint8Array(buf));
    const url = `/data/versions/${slug}/${name}.json?v=${sha256.slice(0, 8)}`;
    bodies.set(url, buf);
    data[name] = { url, sha256, bytes: buf.length };
  }
  const cs = contentHashOf({ app, sim: 'sim-test', data: Object.fromEntries(Object.entries(data).map(([n, f]) => [n, f.sha256])) });
  const cs16 = cs.slice(0, 16);
  const bounds = Buffer.from(JSON.stringify({ v: 1, bb: {}, fields: {}, bbMin: {}, fieldMin: {}, text: {} }));
  const boundsUrl = `/cs/${cs16}/bounds/official.json`;
  bodies.set(boundsUrl, bounds);
  let index = { v: 1, cs, app, vanilla: true, version: id, sim: 'sim-test', simFiles: {}, data, plugins: [], settings: {},
    bounds: { official: { url: boundsUrl, sha256: sha256Hex(new Uint8Array(bounds)), bytes: bounds.length } } };
  if (edit) index = edit(index);
  bodies.set(`/cs/${cs16}/index.json`, Buffer.from(JSON.stringify(index)));
  return { id, slug, cs, bodies, entry: { id, cs, family: 'covenant', label: 'x', roomModes: ['solo', 'coop'] } };
}

const bytesRes = (buf, status = 200) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
/** A fetch serving these sets (`flip`: a URL whose body gets one byte changed); `seen` lists every request. */
function serve(sets, { flip = null } = {}) {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    for (const s of sets) {
      const body = s.bodies.get(url);
      if (body) { const b = Buffer.from(body); if (flip === url) b[b.length - 3] ^= 1; return bytesRes(b); }
    }
    return bytesRes(Buffer.from('nope'), 404);
  };
  return { fetchFn, seen };
}

const V1 = versionServed('act1autochess', 'act1autochess');
const V21 = versionServed('act2autochess@V2_1', 'act2autochess-v2_1');

// ★ 2026-11-17（维护者线上反馈）：房间重启后卡在「版本数据载入中」。
// 根因之一是客户端只在「版本集刚加载完」和「座位从 ready 变回 loading」时发 room.contentReady；
// 那一次若丢了（重连瞬间 / 服务端刚重启），页面又不再变化，座位就永远 loading，整个房间开不了局。
// 修好之后：告诉房间后几秒座位仍是 loading 就自己重发（同一 cs 最多 5 次）。
describe('room.contentReady 的重发（座位一直 loading）', () => {
  test('座位一直 loading：几秒后自己重发（不是只发一次就算）', async () => {
    const store = createStore(initialState);
    const requests = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({ vanilla: true }) }), retryDelays: [] });
    const { fetchFn } = serve([V1]);
    const stop = installContentSet({ store, data, net, fetch: fetchFn, toast: () => {}, wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, versions: [{ id: 'act1autochess', cs: V1.cs }] });
      store.set({ room: { code: 'ABCD', mode: 'coop', version: 'act1autochess', hostId: 'p1',
        content: { cs: V1.cs, vanilla: true, version: 'act1autochess', plugins: [] },
        seats: [{ seat: 0, playerId: 'p1', content: 'loading' }] } });
      await until(() => contentSet.get().status === 'ready', '版本集加载完成');
      await until(() => requests.length >= 1, '第一次 contentReady');
      // 座位仍是 loading：应当自己重发（RESEND_MS = 4s，等到 12s 足够）
      await untilMs(() => requests.length >= 2, '重发了一次 contentReady');
      assert.equal(requests[1].cs, V1.cs, '重发的还是同一份 cs');
    } finally { stop(); }
  });

  test('座位已 ready：不再重发（不打扰服务端）', async () => {
    const store = createStore(initialState);
    const requests = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({ vanilla: true }) }), retryDelays: [] });
    const { fetchFn } = serve([V1]);
    const stop = installContentSet({ store, data, net, fetch: fetchFn, toast: () => {}, wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, versions: [{ id: 'act1autochess', cs: V1.cs }] });
      store.set({ room: { code: 'ABCD', mode: 'coop', version: 'act1autochess', hostId: 'p1',
        content: { cs: V1.cs, vanilla: true, version: 'act1autochess', plugins: [] },
        seats: [{ seat: 0, playerId: 'p1', content: 'loading' }] } });
      await until(() => contentSet.get().status === 'ready', '版本集加载完成');
      await until(() => requests.length >= 1, '第一次 contentReady');
      store.set({ room: { code: 'ABCD', mode: 'coop', version: 'act1autochess', hostId: 'p1',
        content: { cs: V1.cs, vanilla: true, version: 'act1autochess', plugins: [] },
        seats: [{ seat: 0, playerId: 'p1', content: 'ready' }] } });
      await new Promise((r) => setTimeout(r, 6000));
      assert.equal(requests.length, 1, '座位已 ready 就不再发');
    } finally { stop(); }
  });
});
