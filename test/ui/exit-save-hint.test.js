// 单人房的「24 小时保存」要在**保存的位置**告诉玩家怎么回来（维护者 2026-11-08）：
// 离开模拟的对话框里，单人房（单人模式 / 1 真人 + 3 AI / 单人深潜）必须有一段说明 ——
// 「直接关掉页面就行，24 小时内用同一浏览器打开会回到这一局；换设备就在大厅右上角点「恢复对局」」。
//
// 为什么：服务端的 24 小时窗口（lobby.soloLikeRun / soloResumeWindowMs）早就有了，但界面上只有一个
// 「放弃模拟」按钮，玩家以为「离开 = 丢局」，于是不敢关页面，或者关了以为没了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const chrome = read('public/js/ui/matchChrome.js');
const css = read('public/css/screens/game.css');
const observer = read('public/js/ui/accountObserver.js');

test('离开模拟的对话框里有「关掉页面 = 存档」的说明块', () => {
  assert.match(chrome, /class="exitm__save"/);
  assert.match(chrome, /t\('想留着这局？直接关掉页面就行'\)/);
  assert.match(chrome, /t\('24 小时内用同一浏览器打开本站会自动回到这一局；换设备就在大厅右上角点「恢复对局」。'\)/);
});

test('只有单人房才显示：单人模式或房间里只有一个真人（AI 座位不算人）', () => {
  // loneHuman 由 m.public.players 现算，AI 队友不参与计数
  assert.match(chrome, /const loneHuman = \(\(\) => \{/);
  assert.match(chrome, /ps\.filter\(\(p\) => !p\.isBot\)\.length <= 1/);
  assert.match(chrome, /\(solo \|\| loneHuman\) \? html`<div class="exitm__save"/);
});

test('说明里点名的入口是「大厅右上角的恢复对局」（按钮就在顶栏右侧）', () => {
  assert.match(chrome, /大厅右上角点「恢复对局」/);
  assert.doesNotMatch(chrome, /右下角「恢复对局」/);
  // 另一个提到恢复对局位置的提示也一起改成右上角（lobby.js 的 .topbar__right）
  assert.match(observer, /点大厅右上角的「恢复对局」/);
  assert.doesNotMatch(observer, /右下角「恢复对局」/);
  assert.match(read('public/js/screens/lobby.js'), /<div class="topbar__right">[\s\S]{0,120}<\\?\$\{ResumeMatchButton\}/);
});

test('样式：说明块有独立边框、不抢按钮的注意力，并且跟对话框一样随文字大小缩放', () => {
  const block = /\.exitm__save \{([^}]*)\}/.exec(css);
  assert.ok(block, '.exitm__save 要有样式');
  assert.match(block[1], /border-left/);
  assert.match(block[1], /padding/);
  assert.match(/\.exitm__save-d \{[^}]*font-size: \.92em/.exec(css)?.[0] || '', /font-size: \.92em/, '正文比标题小一号');
});

test('文案在 5 个语言包里都有（en / ja / ko / zh-TW）', () => {
  const keys = ['想留着这局？直接关掉页面就行', '24 小时内用同一浏览器打开本站会自动回到这一局；换设备就在大厅右上角点「恢复对局」。'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read('public/i18n', `${lang}.json`));
    for (const k of keys) assert.ok(typeof pack[k] === 'string' && pack[k].length > 0, `${lang} 缺「${k}」`);
    assert.ok(!Object.hasOwn(pack, '对局已在另一设备/标签页继续。要在这台切回来，点大厅右下角的「恢复对局」。'),
      `${lang} 的旧「右下角」文案要删掉（键改了）`);
  }
});
