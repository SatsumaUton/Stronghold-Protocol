// 「深渊回响」（深潜）的匹配队列：单独排队、后台/控制台看得见、匹配队友界面显示成深潜。
//
// 维护者 2026-11-06：
//   ① 管理后台与节点控制台的「匹配队列」要能看见深潜池；
//   ② 匹配队友的搜寻面板要显示成「深渊回响」，不是「4 人同盟 / 标准规则」。
//
// 关键约束：深潜与普通同盟的规则、数值、结算完全不同，**绝不能配进同一局**。
// 所以 variant 是匹配池的第四个维度（难度 / 版本 / 人数之外），这里把它钉死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const mm = read('matchmaker/server.js');
const mmClient = read('matchmaker/public/client.js');
const adminHtml = read('matchmaker/public/admin.html');
const dashApp = read('dashboard/public/app.js');
const dashHtml = read('dashboard/public/index.html');
const roomJs = read('public/js/screens/room.js');
const roomCss = read('public/css/screens/room.css');

test('匹配服务：variant 是池子的第四维（排队 / 成局 / 统计都带着）', () => {
  assert.match(mm, /const normVariant = \(v\) => \(v === 'deepecho' \? 'deepecho' : null\);/, '要有 variant 归一化');
  // 排队人数按 variant 过滤
  assert.match(mm, /function waitingPartyPlayers\(difficulty, capacity = SEATS, version = null, variant = null\)/,
    'waitingPartyPlayers 要收 variant');
  assert.match(mm, /&& normVariant\(p\.variant\) === normVariant\(variant\)\)/, '按 variant 过滤排队人数');
  // 成局分组键带 variant：深潜只和深潜配
  assert.match(mm, /\$\{normVariant\(p\.variant\) \|\| ''\}`\)\)\];/, '分组键要带 variant');
  assert.match(mm, /&& normVariant\(p\.variant\) === variant/, '等待筛选要按 variant');
  // 成局结果带 variant（房主据此建深潜房）
  assert.match(mm, /\n\s+variant,\n\s+partyIds:/, '成局结果要带 variant');
  // 入队时以房间文档为准
  assert.match(mm, /const variant = normVariant\(info && info\.variant\) \|\| normVariant\(body\.variant\);/, 'variant 以房间文档为准');
  // 状态回执带 variant（客户端据此显示）
  assert.match(mm, /variant: normVariant\(p\.variant\) \}/, 'partyState 要回 variant');
  // 统计里单独一档
  assert.match(mm, /byVariant: \[null, 'deepecho'\]\.map\(\(v\) => \{/, '/api/stats 要有 byVariant');
});

test('匹配队友界面：深潜房显示「深渊回响」，上报 variant，房主按深潜建房', () => {
  assert.match(mmClient, /variant: room\.variant === 'deepecho' \? 'deepecho' : undefined,/, '入队要上报 variant');
  assert.match(mmClient, /const diveRoom = \(\(\) => \{ try \{ return window\.__SP__\.store\.get\(\)\.room\?\.variant === 'deepecho'; \} catch \{ return false; \} \}\)\(\);/,
    '搜寻面板要认深潜房');
  assert.match(mmClient, /深渊回响<\/span><span class="mm-ov__tag" style="--c:#4ed8af">4 人同盟/, '深潜时标签显示深渊回响');
  // 房主自动建房：深潜队伍要建深潜房，否则配出来是普通同盟房
  assert.match(mmClient, /net\.request\('room\.create', \{ mode: 'coop', difficulty: PDIFF, \.\.\.\(PV === 'deepecho' \? \{ variant: 'deepecho' \} : \{\}\) \}\)/,
    '房主要按 pv 建深潜房');
  assert.match(mmClient, /const PV = q\.get\('pv'\);/, '要读 pv 参数');
  assert.match(mmClient, /st\.variant === 'deepecho' \? '&pv=deepecho' : ''/, '领队跳转要带 pv');
  assert.match(mmClient, /'pd', 'pv', 'mm'/, '地址栏清理要认识 pv');
});

test('管理后台：匹配队列里有「深渊回响」一档（紫色，带排队人数与已开局数）', () => {
  assert.match(adminHtml, /const echoPool = \(Array\.isArray\(x\.byVariant\) \? x\.byVariant : \[\]\)\.find\(\(v\) => v && v\.variant === 'deepecho'\)/,
    '要读 byVariant 里的深潜池');
  assert.match(adminHtml, /class="mq-echo"/, '要有深潜池标签');
  assert.match(adminHtml, /\.mq-echo\{/, '标签要有样式');
  assert.match(adminHtml, /verTag \+ echoTag/, '两个 return 都要拼上');
});

test('节点控制台：同样的深潜池标签', () => {
  assert.match(dashApp, /const echoPool = \(Array\.isArray\(x\.byVariant\) \? x\.byVariant : \[\]\)\.find\(\(v\) => v && v\.variant === 'deepecho'\)/,
    '要读 byVariant 里的深潜池');
  assert.match(dashApp, /class="mm-echo"/, '要有深潜池标签');
  assert.match(dashHtml, /\.mm-echo\{/, '标签要有样式');
  assert.match(dashApp, /\$\{verTag\}\$\{echoTag\}/, '两个 return 都要拼上');
});

test('房间里的「正在等人」条：深潜房说深渊回响，不说难度 + N 人同盟', () => {
  assert.match(roomJs, /echoRoom \? html`<span class="rs-matchwait__echo">\$\{t\('深渊回响'\)\}<\/span>`/, '深潜房要显示深渊回响');
  assert.match(roomJs, /其他博士在深潜房里点「匹配队友」就会被配到一起/, '提示语要按深潜说');
  assert.match(roomCss, /\.rs-matchwait__echo \{/, '要有样式');
  // 普通房仍然是难度名
  assert.match(roomJs, /html`<span>\$\{t\(DIFFICULTY_NAMES\[room\.difficulty\] \|\| ''\)\}<\/span>`/, '普通房照旧显示难度');
});
