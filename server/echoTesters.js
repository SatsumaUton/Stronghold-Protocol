// server/echoTesters.js — 「深渊回响」测试名单（维护者 2026-11-05）。
//
// 用途：新模式开放前，先让一小批玩家帮忙测试。名单里的账号（accountId）在
// `lobby.create` 时可以和管理员一样开 `variant: 'deepecho'` 的房。
//
// 数据文件：`content/echo-testers.json`，形如 { "ids": ["acc_xxx", ...], "updatedAt": 0 }。
// 面板（dashboard）负责读写；这里只读，并做 5 秒缓存（避免每次建房都读盘）。
//
// 路径：优先 `SP_ROOT/content/...`（部署根，面板写的那份），
// 其次相对本模块的 `../../content/...`（仓库/节点自己的那份）。两边合并取并集。

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const CACHE_MS = 5000;
let cache = { at: 0, ids: new Set() };

function candidatePaths() {
  const out = [];
  const root = process.env.SP_ROOT;
  if (root) out.push(join(root, 'content', 'echo-testers.json'));
  out.push(fileURLToPath(new URL('../../content/echo-testers.json', import.meta.url)));
  return out;
}

function readOne(p) {
  try {
    if (!existsSync(p)) return [];
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    const ids = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.ids) ? doc.ids : []);
    return ids.map((x) => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}

/** 当前名单（Set<string>）。 */
export function echoTesters() {
  const now = Date.now();
  if (now - cache.at < CACHE_MS) return cache.ids;
  const ids = new Set();
  for (const p of candidatePaths()) for (const id of readOne(p)) ids.add(id);
  cache = { at: now, ids };
  return ids;
}

/** 这个账号是不是测试玩家。 */
export function isEchoTester(accountId) {
  if (!accountId) return false;
  return echoTesters().has(String(accountId));
}

/** 测试用：清缓存。 */
export function _resetEchoTesterCache() {
  cache = { at: 0, ids: new Set() };
}
