// test/deploy-sync-atomic.test.js —— 部署脚本必须原子替换文件。
//
// 现场（2026-11-18，玩家报错）：
//   GET /sim/content/kits/ops/chess_char_5_01-excu2.js net::ERR_FAILED
//   [content] failed to load kits/ops/chess_char_5_01-excu2.js
//
// 排查结论：文件在 30 个节点 hash 完全一致、公开域名 200 / 7147 字节、
// 清单 270/270 登记齐全 —— 不是缺文件，而是**读取撞上写入**：
// fs.copyFileSync 会先截断目标再写，浏览器此刻动态 import() 该模块就读到半截 → ERR_FAILED。
// 这个隐患每次 --apply 都存在。
//
// 修法：写同目录临时文件 → 设 mtime → renameSync 原子替换。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'deploy/sync-nodes.cjs'), 'utf8');

test('复制走「临时文件 + rename」而不是就地覆盖', () => {
  assert.match(SRC, /const tmp = x\.target \+ '\.sptmp';/, '要写同目录临时文件');
  assert.match(SRC, /fs\.copyFileSync\(x\.full, tmp\);/, '先复制到临时文件');
  assert.match(SRC, /fs\.renameSync\(tmp, x\.target\)/, '★ 再用 rename 原子替换');
  assert.doesNotMatch(SRC, /fs\.copyFileSync\(x\.full, x\.target\);/, '★ 不能再直接覆盖目标文件（读者会看到半截）');
});

test('mtime 设在临时文件上，rename 之后才落到目标', () => {
  assert.match(SRC, /fs\.utimesSync\(tmp,/, '★ mtime 必须设在 tmp 上');
  const iMtime = SRC.indexOf('fs.utimesSync(tmp,');
  const iRename = SRC.indexOf('fs.renameSync(tmp, x.target)');
  assert.ok(iMtime > 0 && iRename > iMtime, '★ 先设 mtime 再 rename（rename 不保留源时间戳）');
});

test('walk 不把残留的临时文件当成内容', () => {
  assert.match(SRC, /endsWith\('\.sptmp'\)/, '残留临时文件要排除，否则差异比较会误报');
});
