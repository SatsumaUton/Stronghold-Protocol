// 「深渊回响」常驻 buff 栏的四条约定（维护者 2026-11-07 起，2026-11-08 修正层叠关系）：
//
//   1) 它必须渲染在 **.gm（.screen）里面**，不能是 `.screen` 的兄弟。
//      2026-11-07 那版把它留在屏幕包装层里、只把 z-index 从 8 降到 2 —— 数字上 2 < 3（.gm__hud），
//      但两者**不在同一个层叠上下文**：`.screen` 自己是 `z-index: var(--z-screen) = 1` 的独立层叠上下文，
//      兄弟关系下 fixed + z-index 2 的它其实压在**整个游戏画面**之上（含 .gm__hud 3、抽屉 9）。
//      于是里面 `pointer-events: auto` 的圆片和「本回合诅咒」提示条（width: 100%）会吃掉抽屉顶部
//      标签页的点击 —— 玩家反馈 2026-11-08「有广播时只能点到按钮上半部分」（广播 = 诅咒/词条的 m.ticker，
//      同时那条提示条出现，栏变高，正好压到标签页上）。放进 .gm 之后 2 < 3 才有意义。
//   2) 不许压在 HUD 之上：低于 `.gm__hud`，也就是低于放大镜抽屉。
//   3) 但也不能只是「压到 HUD 底下」：整条栏要落在顶栏**下方**的空白战场区，圆片才悬停得到。
//   4) 触屏没有 hover：圆片要一直可点，点一下在栏里弹出说明（`echo-buff-tip`）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const panels = readFileSync(join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
const game = readFileSync(join(ROOT, 'public/css/screens/game.css'), 'utf8');
const status = readFileSync(join(ROOT, 'public/js/ui/echoStatus.js'), 'utf8');
const screen = readFileSync(join(ROOT, 'public/js/screens/game.js'), 'utf8');
const theme = readFileSync(join(ROOT, 'public/css/theme.css'), 'utf8');

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

test('buff 栏渲染在 .gm 里面，不是 .screen 的兄弟（否则 fixed + z-index 会盖住整个画面）', () => {
  const at = screen.indexOf('function MatchScreen');
  assert.ok(at > 0, 'game.js 里应当有 MatchScreen');
  const render = screen.indexOf('<${EchoBuffBar}');
  assert.ok(render > at,
    'EchoBuffBar 必须渲染在 MatchScreen 的 .gm 里 —— 在它外面就是 .screen 的兄弟，fixed + z-index 2 会压在整个游戏画面之上');
  assert.equal(screen.indexOf('<${EchoBuffBar}', render + 1), -1, '只渲染一次（包装层不要再放一份）');
});

test('buff 栏在 HUD 之下：不再遮挡放大镜与抽屉的「敌方情报」「深渊回响」标签页', () => {
  const bar = zIndexOf(panels, '.echo-buffbar');
  const hud = zIndexOf(game, '.gm__hud');
  assert.ok(bar < hud, `.echo-buffbar (z ${bar}) 必须低于 .gm__hud (z ${hud})`);
  // .screen 是 z-index 1 的独立层叠上下文：它里面 2 < 3 才成立，所以上面那条「渲染在 .gm 里」是前提
  assert.ok(zIndexOf(theme, '.screen') < bar, '.screen 自己的 z-index 要低于 buff 栏，栏才能显示在战场之上');
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

test('「本回合诅咒」提示条是 100% 宽且可点 —— 它出现时（同一条诅咒的播报）栏会变高，必须已被层叠修好', () => {
  const alert = ruleOf(panels, '.echo-buffbar__alert');
  assert.match(alert, /width:\s*100%/, '提示条占满整栏宽');
  assert.match(alert, /pointer-events:\s*auto/, '提示条可点（点开说明）');
  // 这两条一起意味着：只要它压在抽屉上，就会吃掉一整条宽度的点击 —— 所以「渲染在 .gm 里」是硬要求
  assert.ok(screen.indexOf('<${EchoBuffBar}') > screen.indexOf('function MatchScreen'),
    '提示条宽 100% + 可点，栏绝不能回到 .screen 兄弟的位置');
});

test('观战 / 前往查看时，盟约投影取屏幕上那位玩家的（不是自己的）', () => {
  assert.match(status, /const watchTarget = useStore\(\(s\) => s\.ui\?\.watchTarget/, 'buff 栏要读 watchTarget');
  assert.match(status, /echoBuffChips\(echo, watchTarget \|\| myId\)/, '有 watchTarget 时用它取投影');
  assert.match(readFileSync(join(ROOT, 'public/js/screens/game.js'), 'utf8'),
    /store\.patch\('ui', \{ watchTarget:/, 'game.js 要发布正在看的玩家');
});
