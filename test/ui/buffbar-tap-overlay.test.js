// 「深渊回响」常驻 buff 栏的三条约定（维护者 2026-11-07）：
//
//   1) 不许压在 HUD 之上：它原来 z-index 8（HUD 是 3），手机窄屏时横跨顶栏中间，
//      芯片又是 pointer-events: auto —— 顶栏的 🔍 和「本局信息」抽屉的标签页都被吃掉点击。
//   2) 但也不能只是「压到 HUD 底下」：z-index 2 之后它被顶栏的 HUD 子元素盖住，
//      鼠标悬停落在 HUD 上，圆片的 title 气泡再也不出现（玩家反馈「buff 栏没有悬浮框了」）。
//      所以整条栏挪到顶栏**下方**的空白战场区，既不挡按钮，又能被悬停。
//   3) 触屏没有 hover：圆片要一直可点，点一下在栏里弹出说明（`echo-buff-tip`）。
//      以前用 `@media (pointer: coarse), (any-pointer: coarse) { pointer-events: none }` 整个禁掉，
//      连「带触摸屏的笔记本」（any-pointer: coarse）都跟着失去鼠标悬停。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const panels = readFileSync(join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
const game = readFileSync(join(ROOT, 'public/css/screens/game.css'), 'utf8');
const status = readFileSync(join(ROOT, 'public/js/ui/echoStatus.js'), 'utf8');

/** The z-index of the first rule whose selector is `sel` (0 when it has none). Comments are stripped first: the
 *  rules carry notes naming other z-indexes, which must not be read as declarations. */
function zIndexOf(css, sel) {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `${sel} 的规则应当存在`);
  const block = css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = block.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** The first rule body of `sel`, comments stripped. */
function ruleOf(css, sel) {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `${sel} 的规则应当存在`);
  return css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('buff 栏在 HUD 之下：不再遮挡放大镜与抽屉的「敌方情报」「深渊回响」标签页', () => {
  const bar = zIndexOf(panels, '.echo-buffbar');
  const hud = zIndexOf(game, '.gm__hud');
  assert.ok(bar < hud, `.echo-buffbar (z ${bar}) 必须低于 .gm__hud (z ${hud})`);
});

test('buff 栏挪到顶栏下方：不再被 HUD 子元素盖住（悬停要能落在圆片上）', () => {
  const body = ruleOf(panels, '.echo-buffbar');
  const m = body.match(/top:\s*([0-9.]+)rem/);
  assert.ok(m, '.echo-buffbar 要有 rem 单位的 top');
  assert.ok(Number(m[1]) >= 0.6, `top 必须让开顶栏（现在 ${m[1]}rem，顶栏高度约 0.5–0.6rem）`);
});

test('触屏也能看：芯片不参与命中测试的旧规则已经删掉，且圆片可点', () => {
  // 注释里会提到那条旧规则，先去掉注释再断言（否则测的是注释文字）
  const css = panels.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.echo-buffbar \.ecochip\.ecochip[\s\S]{0,160}pointer-events: none/.test(css),
    '不能再有把芯片整个禁掉的 pointer-events: none 规则');
  assert.ok(!/any-pointer: coarse/.test(css), 'any-pointer: coarse 会让触屏笔记本也失去悬停，已删除');
  const chip = ruleOf(panels, '.echo-buffbar .ecochip');
  assert.match(chip, /pointer-events:\s*auto/, '圆片必须可命中（悬停 / 点击）');
});

test('点圆片弹出说明框（触屏看全文的入口）', () => {
  assert.match(status, /data-testid="echo-buff-tip"/, '说明框要有测试标记');
  assert.match(status, /onClick=\$\{\(\) => toggle\(/, '圆片点击要打开说明框');
  assert.match(panels, /\.echo-buffbar__tip \{/, '说明框要有样式');
});

test('观战 / 前往查看时，盟约投影取屏幕上那位玩家的（不是自己的）', () => {
  assert.match(status, /const watchTarget = useStore\(\(s\) => s\.ui\?\.watchTarget/, 'buff 栏要读 watchTarget');
  assert.match(status, /echoBuffChips\(echo, watchTarget \|\| myId\)/, '有 watchTarget 时用它取投影');
  assert.match(readFileSync(join(ROOT, 'public/js/screens/game.js'), 'utf8'),
    /store\.patch\('ui', \{ watchTarget:/, 'game.js 要发布正在看的玩家');
});
