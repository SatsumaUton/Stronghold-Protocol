// 「深渊回响」不是模拟：退出流程（离开 / 放弃 / 返回 / 暂停盘）在深潜里要换成深潜的说法。
//
// 维护者 2026-11-06：深潜里点右上角退出，弹窗还写着「离开模拟 / 放弃模拟」，看着像别的模式。
// 流程完全一样（暂离 = AI 托管，放弃 = g.leave → room.leave），只换称呼。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitWords, isEchoRun } from '../../public/js/ui/matchChrome.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('深潜：退出流程说「深潜」，一个「模拟」都不留', () => {
  const w = exitWords(true);
  assert.equal(w.title, '离开深潜');
  assert.equal(w.quit, '放弃深潜');
  assert.equal(w.back, '返回深潜');
  assert.equal(w.micro, 'LEAVE DEEP DIVE');
  for (const [k, v] of Object.entries(w)) {
    if (k === 'micro') continue;
    assert.doesNotMatch(v, /模拟/, `${k} 里不能再出现「模拟」：${v}`);
  }
});

test('普通对局不受影响：照旧说「模拟」', () => {
  const w = exitWords(false);
  assert.equal(w.title, '离开模拟');
  assert.equal(w.quit, '放弃模拟');
  assert.equal(w.back, '返回模拟');
  assert.equal(w.micro, 'LEAVE SIMULATION');
});

test('isEchoRun：房间 variant 或本局 public.echo.deepecho 任一命中', () => {
  assert.equal(isEchoRun({ room: { variant: 'deepecho' } }), true);
  assert.equal(isEchoRun({ match: { public: { echo: { deepecho: true } } } }), true);
  assert.equal(isEchoRun({ room: { variant: 'act2autochess' }, match: { public: {} } }), false);
  assert.equal(isEchoRun({}), false);
  assert.equal(isEchoRun(null), false);
});

test('退出弹窗 / 托管浮层 / 阵亡盘 / 暂停盘 都走 exitWords，不再写死模拟', () => {
  const chrome = read('public/js/ui/matchChrome.js');
  assert.match(chrome, /title=\$\{t\(w\.title\)\}/, '弹窗标题走 exitWords');
  assert.match(chrome, /t\(w\.quit\)/, '放弃按钮走 exitWords');
  assert.match(chrome, /t\(w\.back\)/, '托管浮层返回按钮走 exitWords');
  assert.match(chrome, /t\(w\.soloQuit\)/, '单人的放弃说明走 exitWords');
  assert.doesNotMatch(chrome, /t\('离开模拟'\)/, '不能再写死「离开模拟」');
  assert.doesNotMatch(chrome, /t\('放弃模拟'\)/, '不能再写死「放弃模拟」');
  for (const f of ['public/js/ui/downedPlate.js', 'public/js/screens/game/overlays.js']) {
    const src = read(f);
    assert.match(src, /useEchoRun/, `${f} 要读深潜标记`);
    assert.doesNotMatch(src, /t\('离开模拟'\)|t\('放弃模拟'\)/, `${f} 不能再写死模拟`);
  }
});

test('英文包：新增的深潜说法都有译文，占位符不丢', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const key of [exitWords(true).title, exitWords(true).quit, exitWords(true).back,
    exitWords(true).soloRest, exitWords(true).soloQuit, exitWords(true).quitLine]) {
    assert.equal(typeof en[key], 'string', `en.json 缺 ${key}`);
    assert.ok(en[key].length > 0, `${key} 的译文是空的`);
  }
  assert.match(en[exitWords(true).quitLine], /\{quit\}/, '{quit} 占位符要保留');
});
