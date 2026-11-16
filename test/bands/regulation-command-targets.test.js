// 逐个验证：服务器给出的每个「有效目标」是否真的能被 useCommand 接受。
// 若某个目标被拒（ERR.BAD_TARGET），玩家看到的就是「无效的目标」——而客户端只会在高亮目标上拖放。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch } from '../match/harness.js';
import { beginCommandPrep, commandView } from '../../server/match/bandCommands.js';
import { fileURLToPath } from 'node:url';

const data = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {}, error() {}, info() {} } });
before(() => setGameData(data));
after(() => setGameData(null));

const setup = (t, band, round = 1) => {
  const h = makeMatch({ data, mode: 'coop', humans: 2, bots: 0, fake: true, seed: 137, registry: createRegistry() }).start();
  t.after(() => h.m.dispose());
  h.m.disabledBonds = []; h.m.bannedChess = []; h.m.pool = new SharedPool(h.m.gd);
  h.toPrep(1);
  const ps = h.ps('p_0');
  h.m.round = round; ps.bandId = band; ps.funds = 100; ps.offers = []; ps.commandDrafts = [];
  ps.recompute(); beginCommandPrep(ps);
  return { h, ps };
};

// 规程里带 MAP_TILE / SHOP_SLOT / COMMON_CHESS 主动指令的策略，逐轮验证
const CASES = [
  ['band_dance', 1], ['band_dance', 4], ['band_dance', 8], ['band_dance', 12],
  ['band_survive', 1], ['band_transfer', 1],
];

for (const [band, round] of CASES) {
  test(`every offered target is accepted: ${band} round ${round}`, (t) => {
    const { ps } = setup(t, band, round);
    const view = commandView(ps);
    if (!view) return;                       // 这个策略在这一轮没有主动指令
    const effectId = ps.command.currentEffectId;
    assert.equal(view.effectId, effectId);
    assert.ok(Array.isArray(view.targets));
    const rejected = [];
    for (const target of view.targets) {
      // 复制一份再解一次 move，避免「上一发已经生效」干扰：每发都在新的 prep 里做
      const fresh = setup(t, band, round);
      const v2 = commandView(fresh.ps);
      if (!v2) continue;
      const snapshot = JSON.parse(JSON.stringify(target));
      const res = fresh.ps.useCommand(fresh.ps.command.currentEffectId, snapshot);
      if (res && res.error) rejected.push({ target, error: res.error, detail: res.detail });
    }
    assert.deepEqual(rejected, [], `这些「有效目标」被服务器拒了：${JSON.stringify(rejected)}`);
  });
}
