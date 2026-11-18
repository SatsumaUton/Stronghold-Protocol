// test/render/vfx-plan-preload.test.js —— 「过程特效看不到」的回归闸门。
//
// 维护者 2026-11-18： 玩家反馈遥 / 塔露拉 / 凛御银灰「还是没有过程特效」。
//
// 根因链（本条测试盯住的两处）：
//   ① plan 里新增的桶（`modeCast`）**没进 planKeys** —— 而 battle 前的预加载走 keysFor → planKeys。
//      漏了 → spawn 走 pending 分支（system.js），超过 LATE_START（0.6 s）的一击性特效被丢弃
//      （system.js:202 `if (!important && this.time - handle.t0 > LATE_START) return;`）。
//      技能施放特效粒子多、体积大，最容易超时 —— 表现正是「开了技能但看不到特效」。
//   ② 预加载集合必须覆盖**每个** plan 桶里的 key，一个都不能漏。
//
// 这里用真实 index + 真实 FxWiring，断言 keysFor 覆盖 planKeys 的全部输出。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const IDX_PATH = join(SP, 'shared/assets/local/fx/index.json');
const GD_PATH = join(ROOT, 'data/versions/act3autochess-v3_1/chess.json');
const SKIP = existsSync(IDX_PATH) && existsSync(GD_PATH) ? false : '本机没有特效索引';

const { planFor, planKeys } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/skills.js')).href);
const { FxWiring } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/wiring.js')).href);

/** A stand-in ofx: `has` answers from the real effect list, `def` is null (so spawn would go pending). */
function makeOfx(list, index) {
  return {
    active: true, time: 0, lite: false, tier: 'full', timers: [], dropped: 0,
    lib: {
      has: (k) => !!list.groups['fx/prefabs'][String(k).toLowerCase()],
      def: () => null,
      index: async () => index,
      preload: async (keys) => keys.length,
      defs: new Map(),
    },
    spawn() { return null; },
  };
}

test('★ plan.modeCast 必须进 planKeys（否则预加载漏掉，spawn 超时丢弃）', () => {
  const plan = {
    start: [{ key: 'a' }], loop: [{ key: 'b' }], end: [{ key: 'c' }], ready: [{ key: 'd' }],
    range: [{ key: 'e' }], trigger: [{ key: 'f' }], targets: [{ key: 'g' }],
    modeCast: [{ key: 'mode_x' }],
    attacks: [], each: { cast: [], hit: [[]] }, pulse: [], cond: [],
  };
  assert.ok(planKeys(plan).includes('mode_x'), '★ modeCast 的 key 必须出现在 planKeys 里');
});

test('planKeys 覆盖全部桶（含新增桶的回归）', () => {
  const all = {
    start: ['s'], loop: ['l'], end: ['e'], ready: ['r'], range: ['rg'], trigger: ['t'], targets: ['tg'],
    modeCast: ['m'], pulse: ['p'], cond: ['c'],
    attacks: [{ cast: [{ key: 'ac' }], range: [{ key: 'ar' }], aim: [{ key: 'aa' }], hit: [[{ key: 'ah' }]] }],
    each: { cast: [{ key: 'ec' }], hit: [[{ key: 'eh' }]] },
  };
  const keys = planKeys({
    start: all.start.map((k) => ({ key: k })), loop: all.loop.map((k) => ({ key: k })),
    end: all.end.map((k) => ({ key: k })), ready: all.ready.map((k) => ({ key: k })),
    range: all.range.map((k) => ({ key: k })), trigger: all.trigger.map((k) => ({ key: k })),
    targets: all.targets.map((k) => ({ key: k })), modeCast: all.modeCast.map((k) => ({ key: k })),
    pulse: all.pulse.map((k) => ({ key: k })), cond: all.cond.map((k) => ({ key: k })),
    attacks: [{ cast: [{ key: 'ac' }], range: [{ key: 'ar' }], aim: [{ key: 'aa' }], hit: [[{ key: 'ah' }]] }],
    each: { cast: [{ key: 'ec' }], hit: [[{ key: 'eh' }]] },
  });
  for (const k of ['s', 'l', 'e', 'r', 'rg', 't', 'tg', 'm', 'p', 'c', 'ac', 'ar', 'aa', 'ah', 'ec', 'eh']) {
    assert.ok(keys.includes(k), `planKeys 漏了 ${k}`);
  }
});

test('keysFor 覆盖每套 plan 的全部 key（遥 / 塔露拉 / 银灰 S3）', { skip: SKIP }, async () => {
  const IDX = JSON.parse(readFileSync(IDX_PATH, 'utf8'));
  const LIST = JSON.parse(readFileSync(join(SP, 'shared/data/local-fx.json'), 'utf8'));
  const GD = JSON.parse(readFileSync(GD_PATH, 'utf8'));

  for (const [cid, si] of [['char_1045_svash2', 2], ['char_4202_haruka', 2], ['char_4247_oxi', 2]]) {
    const rec = Object.values(GD).find((c) => c && c.charId === cid) || {};
    const ofx = makeOfx(LIST, IDX);
    const views = new Map();
    const w = new FxWiring(ofx, {
      speed: () => 10, record: () => rec,
      unitKey: (info) => [info?.spine, info?.defId].filter(Boolean),
      view: (id) => views.get(id) || null,
    });
    await w.ready();
    const v = {
      id: 7, x: 20, y: 10, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, anim: 0,
      sp: 60, spMax: 60, energy: null, skillIndex: si,
      info: { id: 7, spine: cid, defId: cid, side: 'ally', kind: 'op', skillIndex: si },
    };
    views.set(7, v);
    w.sync([...views.values()]);
    w.tick();
    w.skill(v, true);

    const plan = w.skills.of(v)?.plan;
    assert.ok(plan, `${cid} 要有 plan`);
    const need = planKeys(plan);
    const got = new Set(w.keysFor([...views.values()]));
    const miss = need.filter((k) => !got.has(k));
    assert.deepEqual(miss, [], `${cid} S${si + 1} 的 plan key 没被预加载：${miss.join(',')}`);
  }
});
