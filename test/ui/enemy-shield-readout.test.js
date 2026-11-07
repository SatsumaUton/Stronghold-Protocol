// 敌对目标的护盾（维护者 2026-11-07）：战斗里血条下面那根护盾条按「剩余护盾 / 生命上限」显示长度，敌人的描述面板
// 里也要能看到还剩多少。数据链：sim 的 buff.shield 求和 → b.snap `shield` → render/interp.js → render/units.js 的
// 护盾条；描述面板走 shared/protocol.js unitStatsEntry 的 `shield`（战斗里的实时数值）。
// 渲染那半在 test/render/hud-readouts.test.js，快照那半在 test/sim/hud-readouts.test.js，这里只看面板这一层。
// Run: node --test test/ui/enemy-shield-readout.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('敌人的描述面板：血量条下面一行护盾（图标 + 剩余点数 + 「护盾」），只在有护盾时出现', () => {
  const src = read('public/js/ui/detailPanel.js');
  assert.match(src, /const shield = live && live\.src === 'battle' && Number\.isFinite\(live\.shield\)/, '读战斗里的实时护盾');
  assert.match(src, /data-testid="enemy-shield"/, '有 testid，方便排查');
  assert.match(src, /name="shield"/, '用盾牌图标');
  assert.match(src, /t\('护盾'\)/, '标签走 i18n');
  // 只挂在 EnemyDetail 的血量条下面，且没护盾时不渲染
  const block = src.slice(src.indexOf('data-testid="enemy-shield"') - 400, src.indexOf('data-testid="enemy-shield"') + 200);
  assert.match(block, /\$\{shield \? html`<div class="dshield"/, '没有护盾就不渲染这一行');
});

test('样式：.dshield 是一行小字，跟血量条同一列', () => {
  const css = read('public/css/screens/game-panels.css');
  assert.match(css, /\.dshield\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.dshield\s*\{[^}]*margin-top:\s*\.06rem/s, '紧贴血量条下方');
  assert.match(css, /\.dshield b\s*\{[^}]*color:/s, '数字比标签亮');
});

test('四个语言包都有「护盾」', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const cat = JSON.parse(read(`public/i18n/${lang}.json`));
    assert.equal(typeof cat['护盾'], 'string', `${lang} 缺「护盾」`);
    assert.ok(cat['护盾'].length > 0);
  }
});
