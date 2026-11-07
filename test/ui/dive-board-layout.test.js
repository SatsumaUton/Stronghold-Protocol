// 深潜排行榜（大厅左侧浮层）的列布局：六列必须把**所有人的信息**都写出来（维护者 2026-11-08：
// 「调整一下排行榜的位置显示把所有人的信息都显示出来」）。
//
// 背景：面板只有 46% 宽、玩家 / 核心盟约两列都是 `white-space: nowrap` + `text-overflow: ellipsis`，
// 一个四人队的长名字和四条核心盟约会被截成「卡西米尔、叙…」，表头「最高盟约数」被截成「最高…」。
// 现在两列改成换行、面板加宽、表头也换行 —— 数值列仍然单行（它们本来就窄且短）。
//
// 这条用例守的是「以后不要再有人把省略号加回来」：CSS 里最后一处（生效的那处）必须允许换行，
// 且表头与数据行必须用同一份 grid-template-columns（否则两行会错位）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 注释先去掉：下面按「规则起始处的选择器」取块，注释里的选择器（这份文件写了很多）不该参与匹配
const css = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const lobby = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');

/** 文件里**最后一处**该选择器的声明块（这个文件靠「后面的规则覆盖前面的」收尾）；选择器必须从规则开头起算 */
function lastBlock(sel) {
  const re = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  let out = null;
  while ((m = re.exec(css))) out = m[1];
  return out || '';
}

const decl = (block, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(block);
  return m ? m[1].trim() : null;
};

test('面板够宽：排行榜浮层从 46% 加宽到 60%，六列才有地方写全', () => {
  assert.match(css, /\.echo-boardfloat\s*\{[^}]*width:\s*min\(30rem,\s*60%\)/);
});

test('玩家 / 核心盟约两列换行而不是省略号截断', () => {
  for (const sel of ['.echo-row--cols .echo-rank__players', '.echo-row--cols .echo-rank__cores']) {
    const b = lastBlock(sel);
    assert.ok(b, `${sel} 要有声明块`);
    assert.equal(decl(b, 'white-space'), 'normal', `${sel} 要允许换行`);
    assert.equal(decl(b, 'overflow-wrap'), 'anywhere', `${sel} 长名字/长盟约名要能断行`);
    assert.equal(decl(b, 'text-overflow'), null, `${sel} 不能再用省略号（信息会被吃掉）`);
    assert.notEqual(decl(b, 'overflow'), 'hidden', `${sel} 不能裁掉内容`);
  }
});

test('表头也换行，不再出现「最高…」这种看不出列名的截断', () => {
  const b = lastBlock('.echo-boardhead__cols > span');
  assert.ok(b);
  assert.equal(decl(b, 'white-space'), 'normal');
  assert.equal(decl(b, 'text-overflow'), null);
});

test('名次 / 层数 / 通关时间 仍然单行；最高盟约数每人一行但整体居中', () => {
  assert.match(decl(lastBlock('.echo-row--cols .echo-rank__time'), 'white-space') || '', /nowrap/);
  assert.match(decl(lastBlock('.echo-row--cols .echo-rank__bonds'), 'text-align') || '', /center/);
});

test('表头与数据行共用同一份 grid-template-columns（否则两行会错位）', () => {
  const row = decl(lastBlock('.echo-row--cols'), 'grid-template-columns');
  const head = decl(lastBlock('.echo-boardhead__cols'), 'grid-template-columns');
  assert.ok(row && head);
  assert.equal(row, head);
  assert.equal((row.match(/minmax\(/g) || []).length, 6, '六列：名次 / 层数 / 玩家 / 核心盟约 / 最高盟约数 / 通关时间');
  // 宽度分配：玩家 2.2fr、核心盟约 1.75fr —— 两列最宽；最高盟约数（表头 5 个字）至少 1fr
  const fr = [...row.matchAll(/minmax\(0,\s*([\d.]+)fr\)/g)].map((m) => Number(m[1]));
  assert.deepEqual(fr, [0.5, 0.9, 2.2, 1.75, 1.05, 1.65]);
  assert.ok(fr[2] > fr[3] && fr[3] > fr[5] && fr[5] > fr[4], '玩家 > 核心盟约 > 通关时间 > 最高盟约数');
});

test('行内把所有人的名字与所有核心盟约都拼出来（不截前 N 个）', () => {
  assert.match(lobby, /const names = squads \? squads\.map\(\(s\) => s\.name\) : \(Array\.isArray\(r\.players\) \? r\.players : \[\]\);/);
  assert.match(lobby, /const cores = \[\.\.\.new Set\(squads \? squads\.flatMap\(\(s\) => \(Array\.isArray\(s\.cores\) \? s\.cores : \[\]\)\) : \[\]\)\];/);
  // 有 squads 时一个队员一行；没有（旧记录）才退回「、」拼接
  assert.match(lobby, /names\.map\(\(n, i\) => html`<i key=\$\{i\}>\$\{n\}<\/i>`\)/);
  assert.match(lobby, /<span class="echo-rank__cores" title=\$\{cores\.join\('、'\)\}>\$\{cores\.length \? cores\.join\('、'\) : '—'\}<\/span>/);
  assert.doesNotMatch(lobby, /names\.slice\(0,/, '不能只显示前几个玩家');
  assert.doesNotMatch(lobby, /cores\.slice\(0,/, '不能只显示前几条核心盟约');
});

// 维护者 2026-11-08：「最高盟约」是**小队里每个人的**最高盟约层数，不是一个人的数字。
test('最高盟约数按人一行：每个队员自己那条 squads[].maxLayers，与「玩家」列同序', () => {
  assert.match(lobby, /const layersOf = squads \? squads\.map\(\(s\) => Math\.max\(0, Math\.floor\(Number\(s\.maxLayers\) \|\| 0\)\)\) : \[\];/);
  // 一个人一个 <i>（不是 join 成一个数字），旧记录没有 squads 才退回聚合值 r.maxLayers
  assert.match(lobby, /layersOf\.map\(\(v, i\) => html`<i key=\$\{i\}>\$\{v \|\| '—'\}<\/i>`\)/);
  assert.match(lobby, /: \(maxLayers \|\| '—'\)\}<\/span>/);
  // 悬停能看到「谁 = 多少层」，长名字换行时也不会认错人
  assert.match(lobby, /const layersTitle = squads\s*\? squads\.map\(\(s, i\) => `\$\{s\.name\} \$\{layersOf\[i\] \|\| '—'\}`\)\.join\(' ｜ '\)/);
  // 展开明细同样按人写
  assert.match(lobby, /squads\.map\(\(s, i\) => `\$\{s\.name\} \$\{layersOf\[i\] \? t\('\{n\} 层', \{ n: layersOf\[i\] \}\) : '—'\}`\)\.join\(' ｜ '\)/);
});

test('两列逐行对齐：同一个 flex 竖排 + 同一个 line-height', () => {
  const players = lastBlock('.echo-row--cols .echo-rank__players');
  const bonds = lastBlock('.echo-row--cols .echo-rank__bonds');
  for (const [name, b] of [['玩家', players], ['最高盟约数', bonds]]) {
    assert.equal(decl(b, 'display'), 'flex', `${name} 要竖排（一个人一行）`);
    assert.equal(decl(b, 'flex-direction'), 'column', `${name} 要竖排`);
  }
  assert.equal(decl(players, 'line-height'), decl(bonds, 'line-height'), '两列行高一致才能逐行对齐');
  assert.match(decl(bonds, 'text-align') || '', /center/);
});
