// 跨设备恢复对局要用的两件小事：**房间在哪个节点**，以及**跳过去用哪个地址**。
//
// 单独一个模块（2026-11-08）的理由：这两件事 `ui/resumeMatch.js`（大厅右上角的按钮）和
// `ui/accountObserver.js`（落地后的自动恢复，失败时要告诉玩家「对局还在、在哪台节点」）都要用，
// 而 accountObserver 已经被 resumeMatch import 了 —— 再反向 import 就成了循环依赖。
//
// 为什么「节点」是关键：`account.resume` 只在**同一个节点的会话表**里认人，落到别的节点就会报
// 「当前节点没有可恢复的账号对局」。`/mm/api/account/room` 会回 `room.node`，所以跳转地址必须带上它。

/**
 * 恢复对局该跳到哪个地址。
 *
 * ★ 2026-11-06：以前一律跳 `/r/CODE`，由 matchmaker 按房号反查节点。但**深渊回响房不参与按房号
 *   跳转**（节点上报时它们进的是 `echoCodes` 而不是 `codes`，见 matchmaker/roomDir.cjs），于是
 *   `/r/<深潜房号>` 一律 302 回首页：玩家点「前往该房间继续对局」后落在大厅的另一个节点上，
 *   那里的 account.resume 当然没有他的座位 —— 看到「当前节点没有可恢复的账号对局」。
 *   （实测：/api/resolve-room?code=PBJH → 403，/api/room-redirect?code=PBJH → 302 /）
 *
 *   `/mm/api/account/room` 本来就回了 `room.node`，前端以前把它丢掉了。节点已知时改用 nginx 的
 *   显式目标通道 `/?room=CODE&n=N`（`?n=` 会无条件把请求钉到那台节点，见 nginx.conf 的
 *   `map $arg_n $sp_room_node`），普通房也一起受益：不再依赖「节点每 10 秒上报一次房号」。
 *   节点未知（老数据 / 昵称兜底）时才退回 `/r/CODE`。
 * @param {{ code?: string, node?: number|string }|null|undefined} room
 * @returns {string|null} 目标地址；没有房间码时 null
 */
export function resumeRoomUrl(room) {
  const isObj = !!room && typeof room === 'object';
  const code = String(isObj ? (room.code ?? '') : (room ?? '')).trim();
  if (!code) return null;
  const node = Number(isObj ? room.node : NaN);
  const known = Number.isInteger(node) && node >= 1 && node <= 30;
  return known
    ? `/?room=${encodeURIComponent(code)}&n=${node}`
    : `/r/${encodeURIComponent(code)}`;
}

/** 账号名下的房间：`{ code, node } | null`（node 可能为 null：老数据只有昵称兜底）。 */
export async function findAccountRoom() {
  let name = window.__SP_ACCOUNT_USER || '';
  if (!name) {
    try {
      const me = await fetch('/mm/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (me.ok) {
        const j = await me.json();
        name = String(j?.user?.name || j?.user?.nickname || '');
      }
    } catch { /* ignore */ }
  }
  if (!name) return null;
  try {
    const r = await fetch('/mm/api/account/room', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const code = j?.room?.code;
    if (!code) return null;
    const node = Number(j?.room?.node);
    return { code: String(code), node: Number.isInteger(node) && node >= 1 && node <= 30 ? node : null };
  } catch { /* ignore */ }
  return null;
}
