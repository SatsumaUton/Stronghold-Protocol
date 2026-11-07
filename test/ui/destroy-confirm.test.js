// 销毁道具（维护者 2026-11-08）：提示框加「下次不再提醒」勾选框、设置里能重新打开、并给销毁加一个可改的快捷键。
//
//   * 设置 `confirmDestroy` 默认开；勾了「下次不再提醒」由 ui/destroyConfirm.js 写 off；设置页的开关写同一个键。
//   * 两处销毁入口（underframe / 详情面板的道具卡）共用 ui/destroyConfirm.js，不能一处记住、另一处还弹。
//   * 快捷键 destroy（默认 G）：加入 HOTKEY_ACTIONS 之后，老存档的键位表不能被整体重置 —— 要像 buy 那样补一个空位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SETTINGS, sanitizeSettings, HOTKEY_ACTIONS, DEFAULT_HOTKEYS, sanitizeHotkeys, rebindHotkey,
  actionForKey, hotkeyLabel, isDefaultHotkeys,
} from '../../public/js/ui/gameLogic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('设置：销毁道具前确认默认开，显式 false 才关，垃圾值按开', () => {
  assert.equal(DEFAULT_SETTINGS.confirmDestroy, true);
  assert.equal(sanitizeSettings({}).confirmDestroy, true);
  assert.equal(sanitizeSettings(null).confirmDestroy, true);
  assert.equal(sanitizeSettings({ confirmDestroy: 'nope' }).confirmDestroy, true);
  assert.equal(sanitizeSettings({ confirmDestroy: false }).confirmDestroy, false);
  // 其它设置不受影响（存档里没有这个键的老档案）
  assert.equal(sanitizeSettings({ bgm: 0.2 }).bgm, 0.2);
});

test('快捷键：销毁道具是一个可改的动作，默认 G，且所有动作的默认键互不相同', () => {
  assert.ok(HOTKEY_ACTIONS.includes('destroy'), 'destroy 要在可改快捷键的列表里');
  assert.equal(DEFAULT_HOTKEYS.destroy, 'KeyG');
  assert.equal(hotkeyLabel(DEFAULT_HOTKEYS.destroy), 'G');
  assert.equal(new Set(HOTKEY_ACTIONS.map((a) => DEFAULT_HOTKEYS[a])).size, HOTKEY_ACTIONS.length, '默认键不能重复');
  assert.ok(isDefaultHotkeys(DEFAULT_HOTKEYS));
});

test('快捷键：老存档（没有 destroy）保留玩家自己的键位，只给销毁补一个空位', () => {
  // 2026-11-07 及以前的存档：只有 7 个动作，而且玩家改过 R → Y
  const legacy = { buy: 'KeyW', refresh: 'KeyY', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space' };
  const map = sanitizeHotkeys(legacy);
  assert.equal(map.refresh, 'KeyY', '玩家改过的键不能被整体重置');
  assert.equal(map.sell, 'KeyX');
  assert.ok(HOTKEY_ACTIONS.every((a) => typeof map[a] === 'string'), '每个动作都有键');
  assert.equal(new Set(Object.values(map)).size, HOTKEY_ACTIONS.length, '键位互不相同');
  assert.equal(map.destroy, 'KeyG', '空着的默认键给销毁');
  // 老存档把 G 用掉了（例如把撤退改成 G）：销毁拿下一个空位，键位仍然不冲突
  const taken = sanitizeHotkeys({ ...legacy, retreat: 'KeyG' });
  assert.equal(taken.retreat, 'KeyG');
  assert.notEqual(taken.destroy, 'KeyG');
  assert.equal(new Set(Object.values(taken)).size, HOTKEY_ACTIONS.length);
});

test('快捷键：把别的动作改到 G 会和销毁交换，不会两个动作共用一个键', () => {
  const r = rebindHotkey(DEFAULT_HOTKEYS, 'sell', 'KeyG');
  assert.equal(r.changed, true);
  assert.equal(r.swapped, 'destroy');
  assert.equal(r.keys.sell, 'KeyG');
  assert.equal(r.keys.destroy, DEFAULT_HOTKEYS.sell, '销毁拿走出售原来的键');
  assert.equal(new Set(Object.values(r.keys)).size, HOTKEY_ACTIONS.length);
});

test('快捷键：G 在默认键位表里解析成 destroy', () => {
  assert.equal(actionForKey({ key: 'g', code: 'KeyG' }), 'destroy');
  // 换成别的键后，原来的 G 不再触发销毁
  const keys = rebindHotkey(DEFAULT_HOTKEYS, 'destroy', 'KeyV').keys;
  assert.equal(actionForKey({ key: 'g', code: 'KeyG' }, keys), null);
  assert.equal(actionForKey({ key: 'v', code: 'KeyV' }, keys), 'destroy');
});

test('确认框：confirmWithCheck 带勾选框，并回 { ok, checked }', () => {
  const src = read('public/js/ui/components.js');
  assert.match(src, /export const confirmWithCheck = \(opts\) => openDialog\(opts, 'confirmCheck'\)/,
    'confirmWithCheck 要作为独立的对话框类型存在');
  assert.match(src, /class="modal__check"/, '对话框里要渲染勾选框');
  assert.match(src, /checkLabel/, '勾选框文案由调用方传入');
  assert.match(src, /closeDialog\(d\.id, isCheck \? \{ ok, checked \}/, '确认/取消都要带上勾选状态');
  // 原有 confirmDialog 仍然只回 boolean（其它调用方不受影响）
  assert.match(src, /export const confirmDialog = \(opts\) => openDialog\(opts, 'confirm'\)/);
  // 被整体关掉（换屏幕 / 会话重置）时按「取消」处理：不放行，也不记住勾选
  assert.match(src, /d\.kind === 'confirmCheck' \? \{ ok: false, checked: false \}/, 'closeAllDialogs 不能把勾选框当成 true');
  assert.match(read('public/css/components.css'), /\.modal__check \{/, '勾选框要有样式');
});

test('销毁确认：设置关掉就直接放行；勾了「下次不再提醒」写回设置', () => {
  const src = read('public/js/ui/destroyConfirm.js');
  assert.match(src, /settingsStore\.get\(\)\.confirmDestroy/, '先看设置');
  assert.match(src, /if \(!settingsStore\.get\(\)\.confirmDestroy\) return true/, '关掉提醒时不再弹框');
  assert.match(src, /checkLabel: t\('下次不再提醒'\)/, '提示框里要有这个勾选框');
  assert.match(src, /r\.checked\) updateSettings\(\{ confirmDestroy: false \}\)/, '勾上并确认后写回设置');
  assert.match(src, /return !!\(r && r\.ok\)/, '取消就是不放行');
});

test('两个销毁入口都走 ui/destroyConfirm.js，不再各自弹 confirmDialog', () => {
  const game = read('public/js/screens/game.js');
  assert.match(game, /import \{ confirmDestroy \} from '\.\.\/ui\/destroyConfirm\.js'/, '棋盘（underframe）入口');
  assert.match(game, /await confirmDestroy\(it\?\.name \|\| t\('道具'\)\)/, '销毁道具走共用的确认');
  assert.doesNotMatch(game, /confirmDialog\(\{ title: t\('销毁道具'\)/, '棋盘入口不应再自己弹一次');

  const panel = read('public/js/ui/detailPanel.js');
  assert.match(panel, /import \{ confirmDestroy \} from '\.\/destroyConfirm\.js'/, '详情面板入口');
  assert.match(panel, /await confirmDestroy\(item\?\.name \|\| ''\)/, '详情面板也走共用确认');
  assert.doesNotMatch(panel, /confirmDialog\(\{ title: t\('销毁道具'\)/, '详情面板不应再自己弹一次');
});

test('设置页：有「销毁道具前确认」开关，快捷键列表里有销毁道具', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /label=\$\{t\('销毁道具前确认'\)\}[\s\S]{0,120}confirmDestroy/, '开关写 confirmDestroy');
  assert.match(src, /destroy: N_\('销毁道具（选中优先）'\)/, '快捷键名字');
  assert.match(src, /销毁道具前弹出确认框/, '开关的说明');
});

test('快捷键动作：销毁只对道具生效（干员走出售），且要能拿到选中 / 指向的那一格', () => {
  const game = read('public/js/screens/game.js');
  const at = game.indexOf("act === 'destroy'");
  assert.ok(at > 0, '键盘处理里要有 destroy 分支');
  const block = game.slice(at, at + 900);
  assert.match(block, /piece\.kind !== 'item'/, '只处理道具 / 技艺');
  assert.match(block, /itemDestroyable\(/, '已配发的装备不能销毁');
  assert.match(block, /sellOwnPiece\(uid\)/, '复用带 busy 保护的销毁路径');
});
