// test/ui/gtop-pointer-pf.test.js —— 乌萨斯（prefab）主题下顶部棋盘格不能被顶栏吃掉点击
// （玩家 2026-11-22：「乌萨斯主题最上面 2 排在手机/全屏下都放不了干员」）。
//
// 根因：game.css 的 `.gtop > * { pointer-events: auto; }` 让三个列容器（左/中/右）全都吃点击；
// prefab 主题的中间带比手写 HUD 更高 → 三个列盒子连成一条，盖住棋盘顶上 1–2 排。
//
// 本用例钉住：prefab 主题下三个列容器必须穿透，真正可交互的控件必须恢复 auto；
// 非 prefab 主题（默认 / 手写 HUD）的规则**不被改动**。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

test('game.css 的基规则仍在（普通主题逐字节不变）', () => {
  const css = read('public/css/screens/game.css');
  assert.match(css, /\.gtop \{[^}]*pointer-events: none;/, '顶栏本身穿透');
  assert.match(css, /\.gtop > \* \{ pointer-events: auto; \}/, '列容器默认仍吃点击（默认主题不变）');
});

test('prefab 主题：三个列容器穿透', () => {
  const css = read('public/css/screens/game-reghud.css');
  const block = css.slice(css.indexOf('.gtop--pf > .gtop__left'), css.indexOf('.gtop--pf button'));
  assert.ok(block, '找得到那段规则');
  for (const col of ['gtop__left', 'gtop__center', 'gtop__right']) {
    assert.ok(block.includes(`.gtop--pf > .${col}`), `${col} 要穿透`);
  }
  assert.match(block, /pointer-events: none;/, '穿透');
});

test('prefab 主题：列内部的真实控件恢复 auto', () => {
  const css = read('public/css/screens/game-reghud.css');
  const i = css.indexOf('.gtop--pf > .gtop__left :is(');
  assert.ok(i > 0, '有按角色恢复 auto 的规则');
  const block = css.slice(i, css.indexOf('}', i));
  for (const role of ['button', 'input', 'select', '[role="button"]', '.btn', '.readybtn', '.specpill']) {
    assert.ok(block.includes(role), `${role} 要恢复 auto`);
  }
  assert.match(block, /pointer-events: auto;/, '恢复 auto');
});

test('不用通配放行（否则等于没改）', () => {
  const css = read('public/css/screens/game-reghud.css');
  assert.ok(!css.includes('.gtop--pf * { pointer-events: auto'), '不要用通配把装饰层也放开');
});
