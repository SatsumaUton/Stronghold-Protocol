// 「管理员工具 → 盟约」以前和干员/装备共用「自由文本 + datalist」：维护者要么留空、要么手打 id，
// 服务端 gd.bond(id) 查不到就回 BAD_TARGET，面板上只剩一句「无效的目标」，看不出是 id 没填
// （2026-11-02 维护者反馈「是不是没有盟约输入框才不能设置盟约」——本质就是这个）。
//
// 现在改成真正的下拉：只列本模式生效的盟约，按 bondOrder 排。这里守住三件事：
//   1. 数据层：过滤后的数量对不对（标准模式一个都不禁，趣味模式禁 10 个）
//   2. 源码层：bond 不再走自由文本输入，改走 data-testid="test-bond-id" 的 select
//   3. 面板层：漏填时说的是具体哪一项，不再是通用「无效的目标」
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeOffBonds } from '../../public/js/ui/gameLogic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const bonds = read('data/bonds.json');
const config = read('data/config.json');

/** 面板里的那段过滤逻辑（testConsole.js 的 bondChoices） */
const bondChoices = (modeId) => {
  const mode = config.modes ? config.modes[modeId] : null;
  const off = modeOffBonds(mode);
  return Object.entries(bonds)
    .filter(([key]) => !off.has(key))
    .sort((a, b) => (Number(a[1].bondOrder) || 0) - (Number(b[1].bondOrder) || 0))
    .map(([key]) => key);
};

describe('管理员工具：盟约改成下拉选择', () => {
  test('标准/险境/绝境一个盟约都不禁，下拉就是全部 23 个', () => {
    const all = Object.keys(bonds);
    for (const modeId of ['mode_single_normal', 'mode_single_hard', 'mode_single_abyss', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss']) {
      assert.equal(config.modes[modeId].inactiveBondIds.length, 0, `${modeId} 不该禁盟约`);
      assert.deepEqual(bondChoices(modeId).slice().sort(), all.slice().sort(), `${modeId} 应该能选到全部盟约`);
    }
  });

  test('趣味模式禁 10 个，下拉里只剩 13 个，而且禁掉的不出现', () => {
    const off = config.modes.mode_multi_funny.inactiveBondIds;
    assert.equal(off.length, 10);
    const got = bondChoices('mode_multi_funny');
    assert.equal(got.length, Object.keys(bonds).length - 10);
    for (const id of off) assert.equal(got.includes(id), false, `${id} 本模式禁用，不该出现在下拉里`);
  });

  test('按 bondOrder 排（不是按 json 里的键顺序）', () => {
    const orders = bondChoices('mode_single_normal').map((k) => Number(bonds[k].bondOrder) || 0);
    assert.deepEqual(orders, orders.slice().sort((a, b) => a - b));
  });

  test('源码：bond 不再用自由文本输入，改用一个真正的 select', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/ui/testConsole.js'), 'utf8');
    assert.match(src, /data-testid="test-bond-id"/, '盟约要有自己的 select');
    // 旧写法：bond 和干员/装备挤在同一组「自由文本 + datalist」里
    assert.equal(src.includes("cmd === 'item' || cmd === 'bond'"), false, 'bond 不能再挂在自由文本输入上');
    assert.equal(src.includes("cmd === 'bond' ? t('盟约') :"), false, 'bond 不能还在那一组的标签三元里');
    assert.match(src, /bondChoices\s*=\s*cmd === 'bond'/, 'bondChoices 只在盟约命令下计算');
    assert.match(src, /modeOffBonds\(/, '要用 modeOffBonds 过滤本模式禁用的盟约');
  });

  test('源码：漏填说的是具体哪一项，不再是通用「无效的目标」', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/ui/testConsole.js'), 'utf8');
    const at = src.indexOf("if (cmd === 'bond') {");
    assert.ok(at > 0);
    const block = src.slice(at, src.indexOf('return go(', at));
    assert.match(block, /先选一个盟约/);
    assert.match(block, /层数要填一个数字/);
    assert.match(block, /额外盟约人数要填一个数字/);
    assert.equal(block.includes("t('无效的目标')"), false, '盟约这条不能再回通用话');
  });
});
