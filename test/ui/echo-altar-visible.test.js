// 深渊祭坛要**真的出现在界面上**（维护者 2026-11-05：我好像没见过这个功能）。
//
// 原因：祭坛那块 UI 以前叫 EchoInfoBlock，定义了却从来没挂到任何界面上（死代码）——
// 服务端一直在按规则开放（16 层起、每 3 层必开 / 其余 35%），玩家却永远看不到入口。
//
// 现在拆成 EchoAltar，挂在「本局信息 → 深渊回响」页顶部；祭坛开放的层还会在悬浮状态条上打一个
// 「祭坛开放 · 放大镜里献祭」的角标。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true, variant: 'deepecho' });

test('服务端：16 层起才会开放祭坛，且不是每层都开', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  assert.equal(m._echoAltarOpen(), false, '15 层不开放');
  // 16 层以后：%3==0 必开，其余随机 —— 至少有些层是开的
  let opened = 0;
  for (let d = 16; d <= 40; d++) {
    m.round = d;
    m.echoAltarOpenRound = 0;
    if (m._echoAltarOpen()) opened++;
  }
  assert.ok(opened > 0, '16 层以后一定要有开放的层');
  assert.ok(opened < 25, '也不该每层都开');
  // 必开的层
  m.round = 30;
  m.echoAltarOpenRound = 0;
  assert.equal(m._echoAltarOpen(), true, '第 30 层（%3==0）必开');
});

test('服务端：开放时 m.public.echo.altar 带三档价格与购买状态', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 30;
  m.echoAltarOpenRound = m.round;
  m.echoAltarOpen = true;
  const pub = m._echoPublic();
  assert.ok(pub.altar, '祭坛要对准备阶段可见');
  for (const k of ['blessing', 'buff', 'permanent']) {
    assert.ok(pub.altar.costs[k] > 0, `${k} 要有价格`);
    assert.ok(pub.altar.limits[k] > 0, `${k} 要有每层次数上限`);
  }
  assert.equal(pub.altar.permanentMax, 1, '永久项本局上限 1');
  assert.deepEqual(pub.altar.deployBought, Object.fromEntries(m.alivePlayers().map((p) => [p.playerId, 0])));
});

test('客户端：祭坛组件挂在「深渊回响」页，并且状态条会提示开放', () => {
  const drawer = read('public/js/ui/enemyDrawer.js');
  assert.match(drawer, /import \{ EchoAltar \} from '\.\/echoStatus\.js';/, '抽屉要引入祭坛组件');
  assert.match(drawer, /<\$\{EchoAltar\} pub=\$\{pub\} \/>/, '深渊回响页要渲染它');
  const status = read('public/js/ui/echoStatus.js');
  assert.match(status, /export function EchoAltar\(\{ pub \}\)/, '组件导出');
  assert.match(status, /data-testid="echo-altar"/, '祭坛块有测试标记');
  for (const kind of ['blessing', 'buff', 'permanent']) {
    assert.match(status, new RegExp(`row\\('${kind}'`), `${kind} 那一行要渲染`);
  }
  assert.match(status, /data-testid="echo-altar-open"/, '状态条提示祭坛开放');
});
