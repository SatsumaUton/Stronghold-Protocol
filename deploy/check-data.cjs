#!/usr/bin/env node
// deploy/check-data.cjs —— 线上 data/ 的体检（只读）。2026-11-07 事故后的防呆：
// 有人（或 AI）把仓库里的 vanilla `data/assets.json` 覆盖到线上，全服玩家的皮肤当场消失。
//
//   node deploy/check-data.cjs          # 只报告
//   node deploy/check-data.cjs --strict # 有问题就 exit 1（可挂进部署流程）
//
// 检查项：
//   1. shared/data/assets.json 是不是「各机生成的那份」——必须带 chars[].skins 且 > 3 MB；
//      仓库里那份是 vanilla 生成物（1.98 MB、无 skins），拷过去就是事故。
//   2. 资源清单里的绝对地址域名与 data/config.json 的 assetOrigin 一致。
//   3. data/backups.json 里三位甄选干员（冻河 / 国度 / 塔露拉）还在。
//   4. 各机运行时配置（create-room / room-ttl / config / local-assets / local-fx）没被仓库版覆盖。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SP = process.env.SP_ROOT || ROOT;
const STRICT = process.argv.includes('--strict');
const DIY = ['char_4244_tocka', 'char_4246_dminon', 'char_4247_oxi'];

const problems = [];
const warns = [];
const say = (ok, text) => console.log(`${ok ? '✓' : '✗'} ${text}`);

const readJson = (rel) => {
  const p = path.join(SP, rel);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

// 1) 资源清单必须是「带皮肤」的那份
const assetsPath = path.join(SP, 'shared', 'data', 'assets.json');
const assets = readJson('shared/data/assets.json');
if (!assets) {
  problems.push('shared/data/assets.json 不存在或不是 JSON');
  say(false, 'shared/data/assets.json 缺失');
} else {
  const size = fs.statSync(assetsPath).size;
  const chars = Object.keys(assets.chars || {});
  const withSkins = chars.filter((id) => assets.chars[id] && assets.chars[id].skins && Object.keys(assets.chars[id].skins).length);
  const skinCount = withSkins.reduce((n, id) => n + Object.keys(assets.chars[id].skins).length, 0);
  // ★ 2026-11-07 之后：线上清单可能就是仓库里那份（519 套皮肤、相对地址），
  //   所以判据不再是「>3 MB 的机器生成版」，而是**皮肤规模**——`data/assets.skins-floor.json`
  //   记着地板（216 位 / 519 套），低于它才说明清单被 vanilla 版盖过。
  const floorPath = path.join(SP, 'data', 'assets.skins-floor.json');
  let floor = { owners: 216, entries: 519 };
  try { floor = JSON.parse(fs.readFileSync(floorPath, 'utf8')); } catch { /* 没有地板文件就用默认值 */ }
  const ok = skinCount >= Math.max(1, Number(floor.entries) || 1) && chars.length >= 200;
  say(ok, `资源清单 ${(size / 1048576).toFixed(2)} MB · ${chars.length} 名干员 · ${skinCount} 套皮肤（地板 ${floor.entries}）`);
  if (!ok) problems.push(`assets.json 的皮肤只有 ${skinCount} 套，低于地板 ${floor.entries} —— 清单被 vanilla 版盖过或皮肤被清空`);
  const hash = String(assets.hash || '');
  console.log(`  hash=${hash || '(空)'}  stats.chars=${assets.stats?.chars} skills=${assets.stats?.skills}`);
  if (Number(assets.stats?.chars) !== chars.length) warns.push(`stats.chars(${assets.stats?.chars}) 与 chars 实际数(${chars.length}) 不一致`);

  // 2) 绝对地址域名 vs config.assetOrigin
  const cfg = readJson('shared/data/config.json') || readJson('data/config.json');
  const origin = cfg && cfg.assetOrigin ? String(cfg.assetOrigin).replace(/\/$/, '') : null;
  const hosts = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { const m = v.match(/^(https?:\/\/[^/]+)\/assets\//); if (m) hosts.add(m[1]); }
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(assets.chars || {});
  walk(assets.skills || {});
  if (origin) {
    const bad = [...hosts].filter((h) => h !== origin);
    say(bad.length === 0, `资源域名 ${[...hosts].join(', ') || '(无)'}${origin ? `（config.assetOrigin=${origin}）` : ''}`);
    if (bad.length) problems.push(`资源清单里的域名 ${bad.join(', ')} 与 assetOrigin 不一致`);
  } else warns.push('data/config.json 没有 assetOrigin，跳过域名核对');
}

// 3) 三位甄选干员
const backups = readJson('shared/data/backups.json');
if (!backups) {
  problems.push('shared/data/backups.json 缺失或不是 JSON');
} else {
  const pool = (backups.diy && backups.diy.ownedPool) || [];
  const missing = DIY.filter((id) => !backups.units?.[id] || !backups.diy?.operators?.[id] || !pool.includes(id));
  say(missing.length === 0, `甄选干员 ${DIY.length} 位${missing.length ? `（缺 ${missing.join(', ')}）` : '齐全'}`);
  if (missing.length) problems.push(`backups.json 缺甄选干员：${missing.join(', ')}`);
}

// 4) 各机运行时配置：仓库版与线上版不该相同（相同说明被覆盖过）
//    ★ assets.json 例外：2026-11-07 起仓库里那份**也带皮肤**（519 套，相对地址），
//      线上与它逐字节相同是正常的（客户端本地优先，nginx 仍会回源），不再当成覆盖事故。
const REPO_DATA = path.join(ROOT, 'data');
for (const rel of ['create-room.json', 'room-ttl.json', 'config.json', 'local-assets.json', 'local-fx.json']) {
  const live = path.join(SP, 'shared', 'data', rel);
  const repo = path.join(REPO_DATA, rel);
  if (!fs.existsSync(live) || !fs.existsSync(repo)) continue;
  const same = fs.readFileSync(live).equals(fs.readFileSync(repo));
  if (same) warns.push(`shared/data/${rel} 与仓库版逐字节相同 —— 确认这不是「被覆盖」的结果`);
}
if (warns.length) for (const w of warns) console.log(`! ${w}`);

console.log('');
if (problems.length) {
  console.log(`发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  - ${p}`);
  if (STRICT) process.exit(1);
} else {
  console.log('线上 data/ 体检通过。');
}
