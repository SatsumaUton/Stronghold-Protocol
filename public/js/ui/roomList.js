// 公开同盟（同盟列表）：大厅的「公开同盟」列表 + 房主建房后的「要不要公开」询问。
//
// 服务端见 server/lobby.js 的 setListed / roomList（room.setListed / room.list）。
// 列表只在弹窗开着、页面可见时问（ROOM_LIST_POLL_MS），服务端自己 3 秒内共用一次扫描，
// 从不主动推。加入走页面平常的密钥加入，服务端会再全部校验一遍 —— 行过期了只是被正常拒绝。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_COLORS, DIFFICULTY_NAMES, ROOM_LIST_MIN_CAPACITY } from '../../../shared/constants.js';
import { html, Button, DifficultyIcon, Icon, Modal, Spinner } from './components.js';
import { net } from '../net.js';
import { versionLabel } from '../versions.js';
import { t } from '../../../shared/i18n.js';

/** 列表开着时多久再问一次（毫秒）。 */
export const ROOM_LIST_POLL_MS = 10_000;

/**
 * 别的节点上正在等人的公开同盟（跨节点列表）。
 *
 * `room.list` 只能看见**本节点**的房间 —— 本服是 30 个独立进程，各自一个 Lobby。
 * 所以这里另外问一次匹配服务 `/mm/api/rooms/open`：它从 Redis 把所有节点的
 * `lobby:rooms` 哈希扫一遍，挑出「挂了公开同盟 + 没开局 + 有空位」的房，并带上节点号。
 * 每条都带 `node`，客户端据此用 nginx 的 `?n=<node>` 直接连到那台节点。
 * 失败就当没有（列表照旧只显示本节点，不报错、不挡住本节点的房）。
 */
async function fetchRemoteRooms() {
  try {
    const r = await fetch('/mm/api/rooms/open', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.rooms) ? j.rooms : [];
  } catch { return []; }
}

/**
 * 一行规则摘要（参考版有 ui/experimental.js 的 experimentalSummary，本服没有那个模块，
 * 这里只挑玩家真正关心的几条）。没有改动就回「标准规则」。
 */
export function expSummary(exp) {
  const e = exp && typeof exp === 'object' ? exp : {};
  const bits = [];
  const cap = Number(e.playerCapacity) || 0;
  if (cap > 4) bits.push(t('{n} 人', { n: cap }));
  if (e.revivalEnabled) bits.push(t('复活'));
  if (e.disableSharedPool) bits.push(t('独立卡池'));
  if (e.disableDuckLord) bits.push(t('禁用鸭爵'));
  if (e.layerCapOff) bits.push(t('关闭层数上限'));
  if (e.hitLimitOff) bits.push(t('关闭命中上限'));
  if (Number(e.enemyHp) > 1) bits.push(t('敌方生命 ×{n}', { n: e.enemyHp }));
  if (Number(e.enemyAtk) > 1) bits.push(t('敌方攻击 ×{n}', { n: e.enemyAtk }));
  if (Array.isArray(e.poolPlan) && e.poolPlan.length) bits.push(t('手动卡池'));
  return bits.length ? bits.join(' · ') : t('标准规则');
}

function RoomRow({ row, disabled, onJoin }) {
  const bots = row.filled - row.humans;
  return html`<li class="rlist__row" style=${`--d-color:${DIFFICULTY_COLORS[row.difficulty]}`} data-testid="room-row" data-code=${row.code}>
    <span class="rlist__diff"><${DifficultyIcon} difficulty=${row.difficulty} />${t(DIFFICULTY_NAMES[row.difficulty])}</span>
    <span class="rlist__who"><b class="selectable">${row.host}</b><small title=${expSummary(row.experimental)}>${expSummary(row.experimental)}</small></span>
    ${row.node ? html`<span class="rlist__node" title=${t('这间同盟在节点 {n} 上，加入时会直接连过去', { n: row.node })} data-testid="room-node"><${Icon} name="server" />${row.node}</span>` : null}
    ${row.version ? html`<span class="rlist__ver"><${Icon} name="book" />${versionLabel(row.version)}</span>` : html`<span></span>`}
    <span class="rlist__seats num" title=${t('{humans} 名博士，{bots} 名 AI', { humans: row.humans, bots })}>${row.filled}<i>/</i>${row.capacity}</span>
    <${Button} size="sm" variant="primary" class="rlist__join" disabled=${disabled} onClick=${() => onJoin(row.code, row.node || 0)}>${t('加入同盟')}<//>
  </li>`;
}

/**
 * 公开同盟列表。
 * @param {{ online: boolean, queued?: boolean, busy?: string | null, onJoin: (code: string) => void, onClose: () => void }} props
 */
export function RoomListDialog({ online, queued = false, busy = null, onJoin, onClose }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const load = async () => {
    if (!online || inFlight.current || document.hidden) return;
    inFlight.current = true;
    try {
      // 本节点的房间（快、字段全）+ 别的节点的房间（跨节点）；本节点有的优先，按房间码去重。
      const [answer, remote] = await Promise.all([net.request('room.list'), fetchRemoteRooms()]);
      if (!alive.current) return;
      const local = Array.isArray(answer?.rooms) ? answer.rooms : [];
      const seen = new Set(local.map((r) => r.code));
      const merged = [...local, ...remote.filter((r) => r && r.code && !seen.has(r.code))];
      setRows(merged);
      setFailed(false);
    } catch { if (alive.current) setFailed(true); } finally { inFlight.current = false; }
  };
  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, ROOM_LIST_POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [online]);
  return html`<${Modal} open=${true} title=${t('公开同盟')} micro="OPEN ALLIANCES"
      class="lobby-dialog rlist-dialog" onClose=${onClose}
      actions=${html`<${Button} variant="secondary" icon="refresh" disabled=${!online} onClick=${load}>${t('刷新')}<//><${Button} icon="close" onClick=${onClose}>${t('关闭')}<//>`}>
    <p class="modal__text">${t('{n} 人及以上、由创建者公开且尚未开局的同盟显示在这里。', { n: ROOM_LIST_MIN_CAPACITY })}</p>
    <p class="modal__text rlist__cross">${t('包括别的节点上的同盟：点「加入同盟」会直接连到那台节点并进入房间。')}</p>
    ${failed ? html`<p class="rlist__note" role="status"><${Icon} name="warn" />${t('列表暂时无法更新，稍后自动重试')}</p>` : null}
    ${rows === null ? html`<p class="rlist__note" role="status"><${Spinner} size="sm" />${t('正在载入同盟列表…')}</p>`
      : rows.length ? html`<ul class="rlist" data-testid="room-list">${rows.map((row) => html`<${RoomRow} key=${row.code} row=${row} disabled=${!online || queued || !!busy} onJoin=${onJoin} />`)}</ul>`
      : html`<p class="rlist__note" data-testid="room-list-empty">${t('暂时没有等待博士的公开同盟')}</p>`}
  <//>`;
}

/** 建房后询问的会话标记（同一个标签页内跨页面跳转有效，关掉标签页就忘）。 */
export const LIST_PROMPT_KEY = 'sp.listPrompt';
/** 「以后不要再问」的持久偏好：勾过以后建房就不再弹这个询问。 */
export const LIST_SKIP_KEY = 'sp.lobby.skipListPrompt';

/** 玩家勾过「下次不再提醒」吗？ */
export function isListPromptSkipped() {
  try { return localStorage.getItem(LIST_SKIP_KEY) === '1'; } catch { return false; }
}

/** 打开 / 关掉「下次不再提醒」（关掉 = 建房时重新询问）。 */
export function setListPromptSkipped(on) {
  try {
    if (on) localStorage.setItem(LIST_SKIP_KEY, '1');
    else localStorage.removeItem(LIST_SKIP_KEY);
  } catch { /* 隐私模式忽略 */ }
  // 偏好变了，同一标签页里挂着的会话标记也要跟着失效
  if (on) { try { sessionStorage.removeItem(LIST_PROMPT_KEY); } catch { /* ignore */ } }
}

/** 房主刚建好一个合作房时记一笔，进房后问一次要不要公开（勾过「不再提醒」就不记）。 */
export function markListPrompt() {
  if (isListPromptSkipped()) return;
  try { sessionStorage.setItem(LIST_PROMPT_KEY, '1'); } catch { /* 隐私模式忽略 */ }
}

/** 取走标记（只问一次）。 */
export function takeListPrompt() {
  try {
    const on = sessionStorage.getItem(LIST_PROMPT_KEY) === '1';
    sessionStorage.removeItem(LIST_PROMPT_KEY);
    return on && !isListPromptSkipped();
  } catch { return false; }
}

/**
 * 建房后的询问：要不要把房间公开到同盟列表，让其他博士看得见、能进来。
 * 「下次不再提醒」勾上以后（无论点公开还是先不公开），以后建房不再弹这个框 ——
 * 大厅的「公开同盟」入口和房间里的开关都还在，随时可以手动公开。
 * @param {{ busy?: boolean, onPublic: (skip: boolean) => void, onPrivate: (skip: boolean) => void }} props
 */
export function ListPromptDialog({ busy = false, onPublic, onPrivate }) {
  const [skip, setSkip] = useState(false);
  return html`<${Modal} open=${true} title=${t('要公开这个同盟吗？')} micro="OPEN ALLIANCE"
      class="lobby-dialog listask-dialog" onClose=${() => onPrivate(skip)}
      actions=${html`
        <${Button} variant="secondary" onClick=${() => onPrivate(skip)} disabled=${busy}>${t('先不公开')}<//>
        <${Button} variant="primary" icon="link" onClick=${() => onPublic(skip)} disabled=${busy}>${t('公开同盟')}<//>`}>
    <p class="modal__text">${t('公开以后，你创建的这个同盟会出现在大厅的「公开同盟」列表里，其他博士可以直接看到并加入。')}</p>
    <label class="listask__skip">
      <input type="checkbox" checked=${skip} onChange=${(e) => setSkip(e.target.checked)} data-testid="listask-skip" />
      <span>${t('下次不再提醒')}</span>
    </label>
    <p class="modal__text rlist__hint">${t('勾选后建房不再询问。以后想公开时：进房后打开「同盟设置」，把里面的「公开同盟」打开即可；大厅「同盟模拟 → 公开同盟」里能看别人的同盟。')}</p>
  <//>`;
}
