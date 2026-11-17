// 回归测试：**渲染侧**也要能解析「只在 data/echo-stages.json 里」的战场（2026-11-17 玩家反馈进对局黑屏）。
//
// 黑屏链路（当时的真实原因）：
//   screens/game.js → useFieldView → fieldHost.mountFieldView → render/app.js:1634 `data.stage(meta.stageId)`
//   → `if (st) setStage(st)`。渲染侧的 look('stages', id) 没有兜底 → 规程的 10 张返回 null → 棋盘没地形 → 黑屏。
//   （准备阶段正常，因为那条路径走 gd.stage()，本来就带兜底。）
//
// 这里不渲染画面，只钉住「两条查表路径都要能解析到」这条不变量。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const ECHO_STAGES = JSON.parse(read('data/echo-stages.json'));
const STAGES = JSON.parse(read('data/stages.json'));

/** 只在 echo-stages 里、不在 stages.json 里的战场（规程·序列Ⅰ 的 10 张）。 */
const ONLY_IN_ECHO = Object.keys(ECHO_STAGES.stages).filter((id) => !Object.hasOwn(STAGES, id));

test('测试前提：确实存在「只在 echo-stages 里」的战场', () => {
  assert.ok(ONLY_IN_ECHO.length > 0, 'echo-stages.json 应当带着 stages.json 没有的记录');
  assert.ok(ONLY_IN_ECHO.includes('act3autochess_m02'), '规程的一张应当在其中');
});

test('渲染侧的 stage 查表必须有 echo-stages 兜底（否则黑屏）', () => {
  const host = read('public/js/render/app/host.js');
  const line = host.split('\n').find((l) => l.includes('stage: (id) =>'));
  assert.ok(line, '找不到渲染侧的 stage 查表那一行');
  assert.match(line, /look\('stages', id\)/, '基线：仍然先查 data/stages.json');
  assert.match(line, /echoStageRec\(id\)/, '★ 渲染侧必须兜底查 echo-stages（以前缺这一句 → 进对局黑屏）');
  assert.match(host, /import \{ echoStageRec \} from '\.\.\/\.\.\/ui\/echoStages\.js'/, '要真的 import 进来');
});

test('UI 侧的 stage 查表也保持兜底（两条路径不能一条有一半）', () => {
  const comp = read('public/js/ui/gameComponents.js');
  const line = comp.split('\n').find((l) => l.includes('stage: (id) =>'));
  assert.ok(line, '找不到 UI 侧的 stage 查表');
  assert.match(line, /data\.lookup\('stages', id\) \|\| echoStageRec\(id\)/);
});

test('对局画面订阅 echo-stages 的条件不能只认 room.variant（续玩 / 观战时 room 可能不在）', () => {
  const game = read('public/js/screens/game.js');
  const line = game.split('\n').find((l) => l.includes('const echoMatch ='));
  assert.ok(line, '找不到 echoMatch 的定义');
  assert.match(line, /room\.variant === 'deepecho'/, '基线：房间标记仍然认');
  assert.match(line, /match\.public\?\.echo/, '★ 还要认 m.public.echo（断线续玩 / 观战时 room 可能还没到）');
});
