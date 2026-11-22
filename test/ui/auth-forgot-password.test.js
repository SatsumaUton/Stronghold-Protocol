// test/ui/auth-forgot-password.test.js —— 登录/注册页必须有「忘记密码」（维护者 2026-11-22 选 A）。
//
// 背景：后端 matchmaker/account.cjs 早就有 POST /api/auth/reset/send 与 /api/auth/reset，
// 旧标题页（matchmaker/public/account-title.js）也用过；但新的登录前置页 authGate.js 没做入口，
// 玩家忘记密码时没有任何办法。本用例钉住：入口、重置模式的字段、以及它打的是**重置**那两个接口
// （而不是注册那条 /api/auth/send-code）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

test('authSession 导出重置的两个接口地址', () => {
  const src = read('public/js/screens/authSession.js');
  assert.match(src, /export const AUTH_RESET_SEND_URL = '\/api\/auth\/reset\/send';/, '发验证码');
  assert.match(src, /export const AUTH_RESET_URL = '\/api\/auth\/reset';/, '提交新密码');
});

test('登录模式有「忘记密码？」入口，重置模式有「返回登录」', () => {
  const gate = read('public/js/screens/authGate.js');
  assert.match(gate, /data-testid="auth-forgot"/, '登录页的入口');
  assert.match(gate, /t\(N_\('忘记密码？'\)\)/, '按钮文案');
  assert.match(gate, /data-testid="auth-forgot-back"/, '重置模式能返回登录');
  assert.match(gate, /setMode\('reset'\)/, '点入口切到 reset 模式');
});

test('重置模式：发的是重置验证码接口，提交打 /api/auth/reset 并自动登录', () => {
  const gate = read('public/js/screens/authGate.js');
  // 发送验证码按模式分流
  assert.match(gate, /const url = mode === 'reset' \? AUTH_RESET_SEND_URL : AUTH_SEND_CODE_URL;/, '重置模式用 reset/send');
  // doReset 存在且打对接口
  const i = gate.indexOf('async function doReset()');
  assert.ok(i > 0, '有 doReset');
  const body = gate.slice(i, gate.indexOf('const submitNow', i));
  assert.ok(body.includes('AUTH_RESET_URL'), '提交到 /api/auth/reset');
  assert.ok(body.includes('AUTH_LOGIN_URL'), '重置成功后自动登录');
  assert.match(body, /code: code\.trim\(\), password: pass/, 'body 形状：email + code + password');
  // 校验：6 位验证码 + 密码至少 8 位
  assert.ok(body.includes('/^[0-9]{6}$/'), '验证码校验');
  assert.ok(body.includes('PASS_MIN'), '密码长度校验');
});

test('重置模式的文案与字段（新密码 / 重置并登录 / 说明行）', () => {
  const gate = read('public/js/screens/authGate.js');
  assert.match(gate, /t\(N_\('新密码（至少 8 位）'\)\)/, '密码占位写「新密码」');
  assert.match(gate, /t\(N_\('重置密码并登录'\)\)/, '提交按钮文案');
  assert.match(gate, /data-testid="auth-reset-hint"/, '重置说明行');
  // CODE 字段在 login 之外都要出现（注册 + 重置都要 6 位验证码）
  assert.match(gate, /\$\{mode !== 'login' \? html`<\$\{Field\} tag=\$\{html`MAIL<br \/>CODE`\}>/, 'CODE 字段给注册与重置');
});

test('样式：重置入口与说明行都有规则，新增部分不破坏项目 CSS 规则', () => {
  const css = read('public/css/screens/authGate.css');
  assert.match(css, /\.sp-lg-forgot \{/, '容器');
  assert.match(css, /\.sp-lg-forgot__link \{/, '链接');
  assert.match(css, /\.sp-lg-hint--reset \{/, '说明行');
  // 新增的这一段不该用 !important（文件末尾 .mm-icp 那条是既有的，与本功能无关）
  const added = css.slice(css.indexOf('.sp-lg-forgot'), css.indexOf('.sp-lg-hint--reset'));
  assert.ok(!added.includes('!important'), '新增样式不该用 !important');
});
