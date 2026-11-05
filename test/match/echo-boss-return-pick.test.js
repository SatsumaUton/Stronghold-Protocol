// 深潜 16 层以后返场的 boss：随机换一只，**隐秘核心的 boss 也要能返场**
//（维护者 2026-11-05：之前 16 层以后翻来覆去只有 R14 那只）。
//
// 三处必须同一个 id，否则会出现「面板写一只、场上刷另一只、血池又是第三只」：
//   · 波次：phases.js _planBossWaves
//   · 共享血池：bossRounds.js startFinalAssault
//   · 准备阶段面板：echoPhase._echoPublic().echo.bossId
// 现在三处都走 `_echoBossIdFor(r)`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const dive = (seed = 5) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed, fake: true, variant: 'deepecho' });

test('返场池：排除本局 R14 那只，但**保留隐秘核心**（能抽到）', (t) => {
  let hiddenHits = 0;
  let sawBossId = false;
  const rounds = [25, 35, 45, 55];
  for (let seed = 1; seed <= 40; seed++) {
    const h = dive(seed);
    const m = h.m;
    try {
      for (const d of rounds) {
        m.round = d;
        const id = m._echoBossIdFor(d);
        assert.ok(m.gd.boss(id), `第 ${d} 层选的 ${id} 必须是真实 boss`);
        assert.notEqual(id, m.bossId, `第 ${d} 层不该再固定 R14 那只`);
        if (id === m.hiddenBossId) hiddenHits++;
        if (id === m.bossId) sawBossId = true;
      }
    } finally { m.dispose(); }
  }
  assert.equal(sawBossId, false, '返场永远不该是本局 R14 那只');
  assert.ok(hiddenHits > 0, `隐秘核心必须能出现在返场里（40 个种子里一次都没抽到）`);
});

test('深度 14 是原版 boss 回合：打本局那只，不是随机返场', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m._echoBossReturn(14), true, '深度 14 走 boss 专用场地');
  assert.equal(m._echoBossIdFor(14), m.bossId, '深度 14 就是本局 bossId');
});

test('准备阶段面板显示的就是这一层真正打的那只', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  for (const d of [25, 35, 45]) {
    m.round = d;
    const pub = m._echoPublic();
    assert.equal(pub.bossRound, true, `第 ${d} 层是 boss 关`);
    assert.equal(pub.bossId, m._echoBossIdFor(d), `第 ${d} 层面板 boss 要与实际一致`);
  }
  // 普通层没有 boss
  m.round = 21;
  const pub = m._echoPublic();
  assert.equal(pub.bossRound, false);
  assert.equal(pub.bossId, null);
});

test('波次与共享血池都走同一个 id（源码钉住，避免三处各写各的）', () => {
  const phases = read('server/match/match/phases.js');
  assert.match(phases, /const bossId = this\.echoVariant === 'deepecho'\s*\n?\s*\? this\._echoBossIdFor\(r\)/);
  const boss = read('server/match/match/bossRounds.js');
  assert.match(boss, /this\.echoVariant === 'deepecho' && typeof this\._echoBossIdFor === 'function'[\s\S]{0,120}this\._echoBossIdFor\(this\.round\)/);
  const echo = read('server/match/match/echoPhase.js');
  assert.match(echo, /bossId: \(this\._echoBossReturn\(\) \|\| this\._echoHiddenBossRound\(\)\) \? this\._echoBossIdFor\(\) : null/);
});
