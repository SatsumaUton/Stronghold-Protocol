// test/match/codex-version.test.js —— 深渊图鉴必须按请求的版本生成
// （玩家 2026-11-23：「深渊回响中的图鉴没有更新」）。
//
// 根因两处：
//   ① `parts.query` 是**原始查询字符串**（server/http/common.js），旧代码写 `parts.query?.version`
//      → 永远是 undefined → 不管选哪个版本都走默认分支，图鉴一直显示第二期下半的 8 条投影。
//   ② 本服的服务器默认版本是规程（`versions.defaultId`），而 `safeData()` 给的是 vanilla 目录
//      （= 第二期下半）—— 所以不能按「是不是服务器默认」去挑数据源。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectionsForGd } from '../../server/match/match/echoProjection.js';
import { getVersionData } from '../../server/data.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

const QUIET = { warn() {}, error() {}, info() {} };

test('图鉴路由：用 URLSearchParams 解析 version（不是 parts.query.version）', () => {
  const src = read('server/http/routes.js');
  const i = src.indexOf("parts.rawPath === '/api/deepecho/codex'");
  assert.ok(i > 0, '找得到图鉴路由');
  const body = src.slice(i, src.indexOf('// 「深渊回响」深潜排行榜', i));
  // 注意：注释里会**引用**旧写法作为说明，所以这里只断言「代码形态」不再出现
  assert.ok(!/String\(parts\.query\?\.version/.test(body), '不能再写 String(parts.query?.version)（query 是字符串）');
  assert.match(body, /new URLSearchParams\(parts\.query \|\| ''\)\.get\('version'\)/, '要用 URLSearchParams 解析');
  // 数据源：版本数据优先，safeData 只作兜底
  assert.match(body, /versions\?\.data\?\.\(wanted\) \|\| health\?\.lobby\?\.safeData\?\.\(\)/, '版本数据优先，safeData 兜底');
  assert.ok(!body.includes('const isServerDefault'), '不要按「是不是服务器默认」挑数据源（safeData 是 vanilla）');
});

test('投影列表跟着版本走：规程 10 条（含乌萨斯/伊比利亚/莱塔尼亚、无拉特兰），第二期下半 8 条', () => {
  const reg = getVersionData('act3autochess@V3_1', { log: QUIET });
  const def = getVersionData('act2autochess', { log: QUIET });
  assert.ok(reg && reg.bonds && def && def.bonds, '两个版本的数据都读得到');

  const regIds = projectionsForGd({ raw: { bonds: reg.bonds } }).map((p) => p.id);
  const defIds = projectionsForGd({ raw: { bonds: def.bonds } }).map((p) => p.id);

  assert.equal(defIds.length, 8, `第二期下半应为 8 条，实际 ${defIds.length}`);
  assert.ok(defIds.includes('lateranoShip'), '第二期下半有拉特兰');
  assert.equal(regIds.length, 10, `规程应为 10 条，实际 ${regIds.length}`);
  assert.ok(!regIds.includes('lateranoShip'), '规程没有拉特兰（内容不跨版本）');
  for (const id of ['ursusShip', 'iberiaShip', 'lethaniaShip']) {
    assert.ok(regIds.includes(id), `规程应包含 ${id}`);
  }
});

test('投影文案用该版本自己的 desc（规程的叙拉古没有隐匿）', () => {
  const reg = getVersionData('act3autochess@V3_1', { log: QUIET });
  const def = getVersionData('act2autochess', { log: QUIET });
  const pick = (gd, id) => projectionsForGd({ raw: { bonds: gd.bonds } }).find((p) => p.id === id);

  const regSi = pick(reg, 'siracusaShip');
  const defSi = pick(def, 'siracusaShip');
  assert.ok(regSi && defSi, '两边都有叙拉古投影');
  assert.ok(!regSi.desc.includes('隐匿'), '规程的叙拉古不该写隐匿');
  assert.ok(regSi.desc.includes('异常状态'), '规程的叙拉古写异常状态');
  assert.ok(defSi.desc.includes('隐匿'), '第二期下半的叙拉古有隐匿');
});
