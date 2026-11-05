// 「深渊回响」门禁的提示语（维护者 2026-11-05）：
// 以前复用 ERR.TEST_FORBIDDEN，玩家看到的是「这不是测试房间」—— 和真正的原因（模式未开放）对不上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERR, ERR_TEXT } from '../../shared/constants.js';

test('深渊回响门禁有独立错误码，文案不再是「这不是测试房间」', () => {
  assert.equal(ERR.ECHO_FORBIDDEN, 'ECHO_FORBIDDEN');
  assert.notEqual(ERR.ECHO_FORBIDDEN, ERR.TEST_FORBIDDEN);
  const text = ERR_TEXT[ERR.ECHO_FORBIDDEN];
  assert.match(text, /深渊回响/, `文案要说明是模式未开放：${text}`);
  assert.doesNotMatch(text, /测试房间/, `不能再说「这不是测试房间」：${text}`);
  // 原来的测试房间文案保持不变（g.test 用）
  assert.match(ERR_TEXT[ERR.TEST_FORBIDDEN], /测试房间/);
});

// 四处门禁 = 四条**不同的入口**，不是重复代码（维护者 2026-11-06 确认后改为四处）：
//   create()      建房：深潜房只有管理员 / 测试名单能开
//   join()        加入同盟：管理员开的深潜房被设成公开后，普通玩家点「加入同盟」也要挡
//   spectate()    观战席：和玩家席同一道门
//   quickMatch()  多人匹配池：深潜接入匹配队列时新增（只和深潜房配对，普通房永远进不来）
test('lobby 的四处深渊回响门禁都返回 ECHO_FORBIDDEN', () => {
  const src = readFileSync(new URL('../../server/lobby.js', import.meta.url), 'utf8');
  const echoGates = src.split('\n').filter((l) => l.includes("'「深渊回响」暂未开放"));
  assert.equal(echoGates.length, 4, `门禁数量：${echoGates.length}`);
  for (const line of echoGates) assert.match(line, /ERR\.ECHO_FORBIDDEN/, `门禁要用新错误码：${line.trim()}`);
  assert.equal(src.includes('ERR.TEST_FORBIDDEN, \'「深渊回响」'), false, '不能再用 TEST_FORBIDDEN');
});
