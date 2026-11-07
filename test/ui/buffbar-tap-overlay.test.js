// 「深渊回响」的常驻 buff 栏不许压在 HUD 之上（维护者 2026-11-07 的手机反馈）：
// 手机窄屏时它（position: fixed; top: .14rem; right: 3.4rem; 196px 宽）横跨顶栏中间，芯片又是
// pointer-events: auto —— 顶栏的 🔍（放大镜）和「本局信息」抽屉顶部的「敌方情报」「深渊回响」标签页
// 都被它吃掉点击，玩家要点很多次才点得中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const panels = readFileSync(join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
const game = readFileSync(join(ROOT, 'public/css/screens/game.css'), 'utf8');

/** The z-index of the first rule whose selector is `sel` (0 when it has none). Comments are stripped first: the
 *  rules carry notes naming other z-indexes, which must not be read as declarations. */
function zIndexOf(css, sel) {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `${sel} 的规则应当存在`);
  const block = css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = block.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

test('buff 栏在 HUD 之下：不再遮挡放大镜与抽屉的「敌方情报」「深渊回响」标签页', () => {
  const bar = zIndexOf(panels, '.echo-buffbar');
  const hud = zIndexOf(game, '.gm__hud');
  assert.ok(bar < hud, `.echo-buffbar (z ${bar}) 必须低于 .gm__hud (z ${hud})`);
});

test('触屏上 buff 栏的芯片不参与命中测试（桌面保留 title 悬停）', () => {
  assert.match(panels, /@media \(pointer: coarse\), \(any-pointer: coarse\) \{[\s\S]{0,240}\.echo-buffbar \.ecochip\.ecochip[\s\S]{0,160}pointer-events: none/);
});
