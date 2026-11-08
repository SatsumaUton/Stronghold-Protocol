#!/usr/bin/env node
// tools/restore-room.mjs — 把被回收的房间从「墓碑」里救回来（维护者 2026-11-09）。
//
// 背景：`disposeRoom` 删房间文档 / 检查点是**真删除**。2026-11-09 有 15 间「保存中的单人深潜」
// 被误当僵尸房回收，Redis 又没有 AOF / 从库 / 快照可回滚 —— 数据全没了。
// 现在 persister 在删除前会写一张墓碑 `sp:nN:tomb:<房号>`（TTL 24 小时，见 server/persist/store.js 的
// saveTombstone）。这个脚本读它、把房间文档与检查点写回去，节点下次重启就能照常恢复。
//
// 用法：
//   node tools/restore-room.mjs --list                     # 列出所有墓碑（房号 / 时间 / 原因 / 有没有检查点）
//   node tools/restore-room.mjs --code AXVU                # 看这间房的墓碑内容（不写）
//   node tools/restore-room.mjs --code AXVU --apply        # 写回 lobby:rooms + cp:<id>，然后重启一次节点
//   node tools/restore-room.mjs --code AXVU --apply --node 4   # 指定节点（默认按墓碑里的记录找）
//
// ⚠ 写回之后**必须重启那台节点**：恢复只在启动时做（restoreLobby）。重启纪律不变 ——
//   有对局的节点不要动，等它空。
// ⚠ 只会写回「墓碑指向的节点」，且不会覆盖活着的那间房（同房号还在就拒绝，防止把好房间顶掉）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { storeConfig, createCheckpointStore } from '../server/persist/store.js';

const log = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a), debug() {} };

/** 命令行参数（不做复杂解析：只有这几个开关）。 */
function argsOf(argv) {
  const out = { list: false, code: null, apply: false, node: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--code') out.code = String(argv[++i] || '').toUpperCase();
    else if (a === '--node') out.node = Number(argv[++i]) || null;
    else if (a === '--help' || a === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
  }
  return out;
}

/**
 * 某个节点的 store。每个节点的键前缀是 `sp:n<node>:`
 * （见 server/persist/index.js：prefix 来自 SP_REDIS_PREFIX，线上是 `sp:n<N>:`）。
 */
function storeForNode(node, config) {
  return createCheckpointStore({ ...config, prefix: `sp:n${node}:` }, { log });
}

const healthz = async (node) => {
  try {
    const r = await fetch(`http://127.0.0.1:${3000 + node}/healthz`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

const fmtTime = (ms) => new Date(Number(ms) || 0).toLocaleString('zh-CN', { hour12: false });

async function main() {
  const args = argsOf(process.argv.slice(2));
  const config = storeConfig({ url: process.env.SP_REDIS_URL || 'redis://127.0.0.1:6379', prefix: 'sp:' });
  if (!config) { console.error('✗ 没有配置 Redis（SP_REDIS_URL）'); process.exit(1); }

  if (args.list) {
    let total = 0;
    for (let n = 1; n <= 30; n++) {
      const store = storeForNode(n, config);
      const listed = await store.listTombstones();
      await store.close();
      if (!listed.ok || !listed.value.length) continue;
      for (const code of listed.value) {
        const store2 = storeForNode(n, config);
        const got = await store2.loadTombstone(code);
        await store2.close();
        if (!got.ok || !got.value) continue;
        const t = got.value;
        total++;
        console.log(`node-${String(n).padStart(2)}  ${code}  ${fmtTime(t.at)}  原因=${t.reason || '?'}  ` +
          `${t.checkpoint ? '有检查点' : '无检查点'}  ${t.room ? `第 ${t.room.matchCount || 0} 局` : '无房间文档'}`);
      }
    }
    console.log(total ? `\n共 ${total} 张墓碑（24 小时后自动过期）` : '没有墓碑');
    return;
  }

  if (!args.code) { console.error('✗ 需要 --code，或 --list'); process.exit(1); }

  // 挨个节点找这张墓碑（--node 指定时只查那一台）
  const nodes = args.node ? [args.node] : Array.from({ length: 30 }, (_, i) => i + 1);
  const hits = [];
  for (const n of nodes) {
    const store = storeForNode(n, config);
    const got = await store.loadTombstone(args.code);
    await store.close();
    if (got.ok && got.value) hits.push({ node: n, tomb: got.value });
  }
  if (!hits.length) { console.error(`✗ 没有 ${args.code} 的墓碑（可能已经过期，或本来就没写成功）`); process.exit(1); }

  for (const { node, tomb } of hits) {
    console.log(`\n=== ${args.code} @ node-${node} ===`);
    console.log(`回收时间：${fmtTime(tomb.at)}   原因：${tomb.reason || '?'}`);
    console.log(`房间文档：${tomb.room ? '有（' + tomb.room.mode + '/' + tomb.room.difficulty + (tomb.room.variant ? '/' + tomb.room.variant : '') + '）' : '无'}`);
    console.log(`对局检查点：${tomb.checkpoint ? tomb.checkpoint.id : '无'}`);
    if (!tomb.room) { console.log('⚠ 没有房间文档，救不回来（墓碑只记了时间与原因）'); continue; }

    // 活着的那间房不能顶掉
    const alive = await healthz(node);
    if (alive && Number(alive.rooms) > 0) {
      const store = storeForNode(node, config);
      const rooms = await store.hashRead('lobby:rooms');
      await store.close();
      if (rooms.ok && rooms.value.has(args.code)) {
        console.log(`✗ node-${node} 上 ${args.code} 还活着，拒绝覆盖（先确认是不是同一间房）`);
        continue;
      }
    }

    if (!args.apply) { console.log('（只看不写。要写回加 --apply）'); continue; }

    const store = storeForNode(node, config);
    // 1) 房间文档写回 lobby:rooms
    const okRoom = await store.hashUpdate('lobby:rooms', [[args.code, JSON.stringify(tomb.room)]]);
    // 2) 检查点写回 cp:<id>
    let okCp = true;
    if (tomb.checkpoint?.id && tomb.checkpoint?.json) okCp = await store.saveCheckpoint(tomb.checkpoint.id, tomb.checkpoint.json);
    await store.close();
    console.log(okRoom ? `✓ 房间文档已写回 sp:n${node}:lobby:rooms` : '✗ 房间文档写回失败');
    if (tomb.checkpoint) console.log(okCp ? `✓ 检查点已写回 sp:n${node}:cp:${tomb.checkpoint.id}` : '✗ 检查点写回失败');
    if (okRoom) {
      console.log(`\n下一步：重启 node-${node} 让它走恢复流程（restoreLobby）。`);
      console.log('  重启纪律：有对局的节点不要动。查空闲：');
      console.log(`    (Invoke-RestMethod http://127.0.0.1:${3000 + node}/healthz).matches`);
      console.log(`  空闲后： pm2 restart node-${node} --update-env`);
      console.log('  重启后确认：日志里应有 "[persist] room ' + args.code + ' restored"');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
