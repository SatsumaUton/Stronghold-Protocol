// 临时公告的「今日不再提醒」（matchmaker/public/client.js 的 installTempNotice）。
//
// 玩家报的问题：点了「今日不再提醒」，过一会儿公告还是弹出来。
//
// 原因：以前按**公告正文的哈希**记（只记 keys）。管理员一改公告文字 —— 今天就很正常地
// 把重启公告换成了反馈板公告 —— 哈希变了，同一条提醒又弹出来。而按钮上写的是
// 「今日不再提醒」，语义本来就是「今天别再打扰我」。
//
// 现在记成**当天总开关**（muted），keys 保留以兼容老数据。
//
// 这里的做法：把 client.js 里那段真实的静音代码抽出来（不是复制一份），注入一个假的
// localStorage 跑 —— 测的是线上那份代码本身。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// matchmaker 不在 node-1 里面：它在部署根（node-1 的兄弟目录）。仓库里对应 matchmaker/。
const src = readFileSync(path.join(ROOT, '../matchmaker/public/client.js'), 'utf8');

/** 「今日不再提醒」那段原始代码（从 MUTE_KEY 到 muteFor 结束、进入 OVERLAY_SELECTOR 之前）。 */
const block = (() => {
  const a = src.indexOf("    const MUTE_KEY = 'mm.noticeMuted';");
  const b = src.indexOf('    // Any real dialog/overlay');
  assert.ok(a > 0 && b > a, 'client.js 里要能找到静音那段代码');
  return src.slice(a, b);
})();

/** 装一个假的 localStorage，返回 { api, store } —— api 是真实代码里那几个函数。 */
function harness(seed = null) {
  const store = new Map();
  if (seed) store.set('mm.noticeMuted', JSON.stringify(seed));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const factory = new Function('localStorage', `${block}\n return { isMuted, muteFor, dayStamp, textKey, loadMute };`);
  return { ...factory(localStorage), store };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('今日不再提醒：当天总开关', () => {
  test('一开始什么都没静音', () => {
    const h = harness();
    assert.equal(h.isMuted(h.textKey('随便一条公告')), false);
  });

  test('点过以后，当天**任何**临时公告都不再弹（这是这次修的核心）', () => {
    const h = harness();
    const muted = h.textKey('如遇到界面或者其他的BUG可使用左下角反馈板或加群进行反馈');
    h.muteFor(muted);
    assert.equal(h.isMuted(muted), true, '静音的那条当然不弹');
    assert.equal(h.isMuted(h.textKey('管理员后来改成了完全不同的文字')), true, '改过文字的新公告也不弹');
  });

  test('隔天自动恢复（自然日，不是 24 小时）', () => {
    const h = harness();
    h.muteFor(h.textKey('今天的公告'));
    // 把存储里的日期改成昨天，模拟跨日
    const raw = JSON.parse(h.store.get('mm.noticeMuted'));
    h.store.set('mm.noticeMuted', JSON.stringify({ ...raw, day: '2020-01-01' }));
    assert.equal(h.isMuted(h.textKey('今天的公告')), false, '换了一天就照常提醒');
  });

  test('老数据（只记了 keys、没有 muted）照样认，而且只认那一条', () => {
    const key = 'nt1:deadbeef:10';
    const h = harness({ day: today(), keys: [key] });
    assert.equal(h.isMuted(key), true, '以前静音过的那条仍然不弹');
    assert.equal(h.isMuted('nt1:cafe:4'), false, '其它公告照常（老语义）');
  });

  test('没有 key 也能开启当天静音（按条静音失败不该拖累总开关）', () => {
    const h = harness();
    h.muteFor(null);
    assert.equal(h.isMuted(h.textKey('任意公告')), true);
    assert.deepEqual(h.loadMute().keys, [], '没 key 就不往里塞东西');
  });

  test('存储坏掉（非 JSON / 结构不对）不会抛，只是当作没静音', () => {
    const h = harness();
    h.store.set('mm.noticeMuted', '{不是 JSON');
    assert.equal(h.isMuted(h.textKey('x')), false);
    h.store.set('mm.noticeMuted', JSON.stringify({ day: today(), keys: 'not-an-array' }));
    assert.equal(h.isMuted(h.textKey('x')), false);
  });
});

describe('client.js 的接线', () => {
  test('按钮点击走 muteFor，重要公告不给静音', () => {
    assert.match(src, /if \(current && !current\.important\) muteFor\(current\.key\);/);
  });

  test('applyAnnouncement 里先问 isMuted 再决定显示，重要公告绕过', () => {
    assert.match(src, /if \(!important && isMuted\(key\)\)/);
  });
});
