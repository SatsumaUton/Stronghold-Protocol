// test/http/view-rate-bucket.test.js —— 切视角（g.watch）不再和写操作抢同一个节流额度。
//
// 玩家诊断（2026-11-26）：PREP 阶段连续 3 次 `NetError: 操作过于频繁 (RATE)`。
// 根因：`g.watch` 与 `room.loadout` / `room.card` / `room.skins` 共用 heavy 桶（2 次/秒、burst 6），
// 而切视角会被玩家连点（切队友 / 双击头像 / 追看某人），正常操作也会被挡。
// 修法：VIEW_TYPES（g.watch）走独立桶（默认 4 次/秒、burst 8），写操作仍是原额度。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEW_TYPES, HEAVY_TYPES } from '../../server/net.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

test('g.watch 属于 VIEW_TYPES，且不再单独占 heavy 桶的判定', () => {
  assert.ok(VIEW_TYPES.has('g.watch'), 'g.watch 要在 VIEW_TYPES 里');
  assert.ok(HEAVY_TYPES.has('g.watch'), 'g.watch 仍然是「大回复」意图（保留在原集合里便于说明）');
  const src = read('server/net.js');
  assert.match(src, /VIEW_TYPES\.has\(msg\.t\) && conn\.session\.admin !== true && !conn\.view\.take\(now\)/, '看盘走 view 桶');
  assert.match(src, /HEAVY_TYPES\.has\(msg\.t\) && !VIEW_TYPES\.has\(msg\.t\)/, '写操作仍然走 heavy 桶，且排除看盘');
});

test('view 桶独立于 heavy 桶，默认更宽松', () => {
  const src = read('server/net.js');
  assert.match(src, /this\.heavy = new TokenBucket\(opts\.heavyPerSec, opts\.heavyBurst, now\);/, 'heavy 桶保留');
  assert.match(src, /this\.view = new TokenBucket\(opts\.viewPerSec \?\? opts\.heavyPerSec, opts\.viewBurst \?\? opts\.heavyBurst, now\);/, 'view 桶另一个实例');
  const viewPerSec = Number((src.match(/viewPerSec: (\d+)/) || [])[1]);
  const viewBurst = Number((src.match(/viewBurst: (\d+)/) || [])[1]);
  const heavyPerSec = Number((src.match(/heavyPerSec: (\d+)/) || [])[1]);
  const heavyBurst = Number((src.match(/heavyBurst: (\d+)/) || [])[1]);
  assert.ok(viewPerSec > heavyPerSec, `看盘额度应更宽松：${viewPerSec} vs ${heavyPerSec}`);
  assert.ok(viewBurst > heavyBurst, `看盘突发应更大：${viewBurst} vs ${heavyBurst}`);
});

test('看盘的额度从房间配置也能覆盖（viewPerSec / viewBurst 进白名单）', () => {
  const cfg = read('server/http/config.js');
  assert.match(cfg, /'viewPerSec'/, 'config.js 白名单要有 viewPerSec');
  assert.match(cfg, /'viewBurst'/, 'config.js 白名单要有 viewBurst');
  const idx = read('server/index.js');
  assert.match(idx, /viewPerSec\?: number, viewBurst\?: number/, 'options 文档要有这两个键');
});
