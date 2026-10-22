// test/ui/ui-leftovers-3527.test.js — the §35.18 UI leftovers fixed in 0.3.2 (DESIGN §35.27), pinned in the stylesheets
// and the markup; the browser checks are test/ui/room-fit.e2e.test.js and lobby-hub.e2e.test.js (text-fit) and the
// measurements in §35.27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (text, head) => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head);
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
};

test('the 机变 overlay leaves the corner\'s buttons uncovered: they wrap within its 2.8rem column, a phone\'s overlay starts past them', () => {
  const panels = css('public/css/screens/game-panels.css');
  assert.match(panels, /\.spov \{ position: absolute; inset: 0 0 0 2\.8rem;/);
  assert.match(block(panels, '@media (min-width: 768px) {\n  .gm.has-sp .gm__corner'),
    /\.gm\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse; align-content: flex-start; max-width: calc\(2\.8rem - \.24rem - \.1rem\); \}/);
  const dev = css('public/css/devices.css');
  // the coarse phone's corner is .24rem + max(96px, 3 × max(.56rem, 34px) + .2rem) wide: the overlay starts 2 px past it
  assert.match(dev, /\.gm\.has-sp > \.spov \{ left: calc\(max\(2\.8rem, \.24rem \+ max\(96px, 3 \* max\(\.56rem, 34px\) \+ \.2rem\) \+ 2px\) \+ var\(--sa-l\)\); \}/);
  assert.match(dev, /\.gm\.is-collapsed\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse;/);
});

test('选择模拟协议 in a portrait window keeps the .5rem the chosen card slides into', () => {
  const lobby = css('public/css/screens/lobby.css');
  assert.match(lobby, /\.proto-list \{[^}]*padding: \.07rem \.06rem \.07rem \.5rem;/);
  assert.match(lobby, /\.pcard\.is-on \{ transform: translateX\(-\.44rem\);/);
  const portrait = block(lobby, '@media (max-aspect-ratio: 1/1) {');
  assert.doesNotMatch(portrait, /\.proto-list[^{]*\{[^}]*padding-left/);
  assert.match(portrait, /\.proto-foot \{ padding-left: \.1rem; \}/);
});

test('short screens: the empty key field takes the placeholder\'s size; 同盟模拟\'s line above its entry keeps 「1–4 名博士」', () => {
  const lobby = css('public/css/screens/lobby.css');
  const short = lobby.slice(lobby.indexOf('@media (max-height: 520px) {'));
  const ph = /\.ally-key input::placeholder \{ font-size: (clamp\([^;]+\)); \}/.exec(short)?.[1];
  assert.ok(ph, 'the placeholder\'s size');
  assert.ok(short.includes(`.ally-key input:placeholder-shown { font-size: ${ph}; }`), 'the empty field at the same size');
  assert.match(lobby, /\.hub-entry__short \{ display: none; \}/);
  assert.match(short, /\.hub-entry__long \{ display: none; \}\s*\.hub-entry__short \{ display: inline; \}/);
  const js = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
  assert.match(js, /pointShort: N_\('1–\{n\} 名博士'\)/);
  assert.match(js, /<span class="hub-entry__long">\$\{t\(card\.points\[0\], card\.pointParams\)\}<\/span><span class="hub-entry__short">\$\{t\(card\.pointShort, card\.pointParams\)\}<\/span>/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
    assert.match(pack['1–{n} 名博士'], /\{n\}/, lang);
  }
});

test('text-fit: a player\'s name may end in a line clamp\'s ellipsis and break inside a word, nothing else may', () => {
  const src = readFileSync(path.join(ROOT, 'test/e2e/text-fit.mjs'), 'utf8');
  assert.match(src, /webkitLineClamp/);
  assert.match(src, /if \(!cut\.matches\('\.seat__name, \.specbar__who, \.room-mode'\)\) out\.push\(`ellipsis \$\{label\}`\);/);
  assert.match(src, /!breakOk\(p, c\) && !el\.closest\('\.seat__name'\)/);
});

test('the room: a 确认 that drops a plugin mode says so to the host', () => {
  const js = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(js, /if \(!\(await setDifficulty\(d\)\)\) return;\n\s+savePref\('lobby\.difficulty', d\);\n[^\n]*\n\s+if \(pluginMode\) toast\(t\('已退出插件模式「\{name\}」', \{ name: pluginMode \}\), 'info'\);/);
});

test('the other event screens at a big 文字大小: 成就统计\'s banner, the briefing\'s header, 已被选择, the top bar\'s ping, the loadout card view', () => {
  const stats = css('public/css/screens/stats.css');
  assert.match(stats, /\.achv__banner \{[^}]*min-height: \.74rem;/);
  assert.doesNotMatch(stats, /\.achv__banner \{[^}]*[^-]height: \.74rem/);
  assert.match(stats, /\.achv__title \{[^}]*grid-template-areas: "mark en" "mark name";/);
  assert.doesNotMatch(stats, /margin: 0 0 0 -\.9rem/, 'the name no longer slides under the decorative ALLIANCE');
  const brief = css('public/css/screens/briefing.css');
  const briefShort = block(brief, '@media (max-height: 520px) {');
  for (const r of [/\.stephead__micro \{ display: none; \}/, /\.stephead__guide \.btn__label \{ display: none; \}/, /\.brief \.brief-h \{ height: auto; min-height: \.66rem; \}/]) assert.match(briefShort, r);
  const draft = block(css('public/css/screens/draft.css'), '@media (max-height: 520px) {');
  assert.match(draft, /\.dband__taken \{ white-space: nowrap;[^}]*font-size: min\(calc\(\.21 \* var\(--t\)\), calc\(12px \+ var\(--t-step\) \/ 2\)\); \}/);
  assert.match(draft, /\.dband__name \{[^}]*text-wrap: balance;[^}]*-webkit-line-clamp: 2;/);
  assert.match(draft, /\.draft\.has-status \.stephead__name \{ display: none; \}/);
  assert.match(draft, /\.draft-skip \{[^}]*white-space: nowrap;/);
  assert.match(readFileSync(path.join(ROOT, 'public/js/screens/bandDraft.js'), 'utf8'), /held && 'is-held', head && 'has-status'\)/);
  assert.match(css('public/css/screens/game.css'), /\.gtop__net \.ping \{ height: auto; min-height: \.32rem; padding-top: 1px; padding-bottom: 1px; \}/);
  const lo = css('public/css/screens/loadout.css');
  assert.match(lo, /\.lo-top__note \{ margin: 0; max-width: min\(8\.4rem, 100%\);/);
  assert.match(lo, /\.lo-bbar__tiers \{[^}]*padding-top: max\(\.24rem, 17px\); \}/);
  assert.match(block(lo, '@media (max-height: 520px) {\n  .lo-deck'), /\.lo-diy__frame \{ width: 46%; \}/);
  const lobby = css('public/css/screens/lobby.css');
  assert.match(lobby, /\.ally-card__bar small \{[^}]*white-space: normal; text-align: right;/);
});

test('the draft\'s name cards fall back to the default picture when an outfit\'s fails, as the seat cards do', () => {
  const js = readFileSync(path.join(ROOT, 'public/js/screens/bandDraft.js'), 'utf8');
  assert.match(js, /const art = seatArtSrc\(arts, badArt\);/);
  assert.match(css('public/css/screens/draft.css'), /\.dorder__art \{[^}]*object-fit: cover; object-position: 50% 16%;/);
});
