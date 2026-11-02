// 大厅「选择同盟方式」底部的两个胶囊：公开同盟 / 多人匹配。
//
// 2026-11-02：维护者要求把参考版的「多人匹配」按钮做出来。它和「公开同盟」并排放在 .ally-links 里
// （参考版就是这么摆的），两个都由 AllianceSelect 的 prop 控制：
//   onBrowse     → 公开同盟（房间列表）
//   onQuickMatch → 多人匹配（room.quickMatch：进一个还缺人的匹配房，没有就自己开一间开始等人）
// 两个 prop 都可能缺省（老调用点 / 只想给一个入口），此时只画给出来的那个；两个都没有就整块不画。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { AllianceSelect } = await import('../../public/js/screens/lobby.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const findAll = (tree, pred) => [...walk(tree)].filter(pred);
const byTestId = (tree, id) => findAll(tree, (v) => v.props?.['data-testid'] === id);
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

const base = { onClose() {}, onCreate() {}, code: '', onCode() {}, codeOk: false, online: true, busy: null,
  onJoin() {}, onSpectate() {}, recent: [], marks: new Set(), focusKey: false };

test('两个入口都给：公开同盟 + 多人匹配 并排出现', () => {
  const tree = AllianceSelect({ ...base, onBrowse() {}, onQuickMatch() {} });
  const browse = byTestId(tree, 'alliance-browse');
  const quick = byTestId(tree, 'alliance-quick');
  assert.equal(browse.length, 1, '有公开同盟');
  assert.equal(quick.length, 1, '有多人匹配');
  assert.match(textOf(browse[0]), /公开同盟/);
  assert.match(textOf(quick[0]), /多人匹配/);
  // 同一排（.ally-links）里，参考版就是这么摆的
  const links = findAll(tree, (v) => typeof v.props?.class === 'string' && v.props.class.split(/\s+/).includes('ally-links'));
  assert.equal(links.length, 1, '有一个 .ally-links');
  const kids = findAll(links[0], (v) => v.type === 'button');
  assert.equal(kids.length, 2, '.ally-links 里正好两个胶囊');
});

test('只给 onBrowse：只剩公开同盟，不画空壳', () => {
  const tree = AllianceSelect({ ...base, onBrowse() {} });
  assert.equal(byTestId(tree, 'alliance-browse').length, 1);
  assert.equal(byTestId(tree, 'alliance-quick').length, 0);
});

test('只给 onQuickMatch：只剩多人匹配', () => {
  const tree = AllianceSelect({ ...base, onQuickMatch() {} });
  assert.equal(byTestId(tree, 'alliance-browse').length, 0);
  assert.equal(byTestId(tree, 'alliance-quick').length, 1);
});

test('两个都不给：整块 .ally-links 不出现（老调用点的视图一个字节都不变）', () => {
  const tree = AllianceSelect({ ...base });
  const links = findAll(tree, (v) => typeof v.props?.class === 'string' && v.props.class.split(/\s+/).includes('ally-links'));
  assert.equal(links.length, 0);
});

test('离线时两个胶囊都禁用（点了也发不出去）', () => {
  const tree = AllianceSelect({ ...base, online: false, onBrowse() {}, onQuickMatch() {} });
  for (const id of ['alliance-browse', 'alliance-quick']) {
    const [btn] = byTestId(tree, id);
    assert.equal(btn.props.disabled, true, `${id} 离线时禁用`);
  }
});
