// Lobby screen, laid out like the event's entry (PR #643 split 6, PR #812): the official entry backdrop (assets
// `entry/entry_bkg_01` / `entry_bkg_02`, a plain dark field without the art pack; their position, size and opacity in
// css/screens/lobby.css are eyeballed from the event video [ASSUMED]), the emblem in radar rings and the title in the
// middle, the 成就统计 card, the 密钥加入 tile and 作战提示 at the left, the light S.W.E.E.P.报告 (screens/sweep.js: 盟约 /
// 策略 / 敌方资料 and the enemy codex) and 干员调配 plates at the right, and the two entries at the bottom right:
//   - 独立模拟 → 选择模拟协议 (ProtocolSelect): the difficulty (标准/险境/绝境/终极) cards beside its official picture
//     (`modeChoice/*_rhodes_island`), then 开始独立模拟.
//   - 同盟模拟 (or 密钥加入) → 选择同盟方式 (AllianceSelect), as in the event's 联合模拟 (research 06 §3.2): 创建同盟 creates
//     the room at once — at the remembered difficulty (`sp.pref.lobby.difficulty`, 标准 at first), which the host changes
//     in the room (screens/room.js: the difficulty pill opens this module's ProtocolSelect with 确认; the maintainer's
//     decision of 2026-10-21 — the event's own 选择模拟协议 before a co-op room belongs to 搜寻队友 (finding
//     teammates), which the remake dropped) — or join one with a 同盟密钥 (recent codes remembered) as a player
//     (加入同盟) or in one of its MAX_SPECTATORS spectator seats (观战: room.spectate, also while its match runs;
//     community report #26, a remake feature — the official room has none). The key field is the project's TextField (IME-safe Enter, the normalised
//     key written back, no length cap before normalizeCode: a long pasted invite link must reach it whole).
// The 成就统计 card is the lobby's statistics entry (the maintainer's decision of 2026-10-21: the top bar's 统计数据 chip
// is gone): it opens the 成就统计 window (screens/stats.js AchievementDialog), whose 查看完整统计 opens 统计数据. The
// 密钥加入 tile is a remake shortcut to 选择同盟方式 [ASSUMED: the event's hub has no such tile].
// Both dialogs are the project's Modal (focus trap, Esc, focus restored) styled to fill the screen. The top bar shows
// connection status + ping, and 大厅背景与音乐 (ui/lobbyMedia.js, PR #643 split 8): a lobby scene, the player's own
// picture / video over the official backdrop and own lobby music, kept in this browser only.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Official versions (DESIGN §35.23, M1; versions.js): with welcome.versions the top bar shows the version chip (ui/
// versionPicker.js VersionSwitch — this browser's choice, its data loaded and checked by content.js), the title names a
// version other than 第二期下半, 选择模拟协议 offers the difficulties of the version shown (its config's modes: 第一期 and
// 第二期上半 have no 终极; the remembered difficulty, when it is not offered, shows as the server's fallback — the highest
// offered below it — and stays remembered until the player picks one; the cards wait while the version loads), 创建同盟 /
// 独立模拟 create the room in that version (room.create `version`), and the 成就统计 card counts the records of its season.
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { TestMark } from '../ui/testConsole.js';
import { EchoCodex, EchoCodexButton } from '../ui/echoCodex.js';
import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR } from '../../../shared/constants.js';
import { PLAYER_CAPACITIES } from '../../../shared/playerCapacity.js';
import { html, confirmDialog, Button, Icon, MicroLabel, Modal, PingPill, Spinner, DifficultyIcon, TextField } from '../ui/components.js';
import { Sprite, Img } from '../ui/gameComponents.js';
import { uiUrl } from '../ui/assetUrls.js';
import { peekStatsRecords, trophyMedalOf, aggregateStats, recordsOfSeason } from '../ui/stats.js';
import { levelProgress, levelOf } from './settle.js';
import { OwnBackdrop, LobbyScene, LobbyMediaButton } from '../ui/lobbyMedia.js';
import { toast, toastError } from '../ui/toasts.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { RadarScene, CreateArt, JoinArt } from '../ui/allyArt.js';
import { ProtocolScene } from '../ui/protocolScene.js';
import { AchievementDialog, useStatsOpen } from './stats.js';
import { SweepReport } from './sweep.js';
import { Emblem } from './title.js';
import { SettingsButton } from '../ui/settings.js';
import { PwaInstallButton, detectFeatures, useMediaQuery, SHORT_SCREEN_QUERY } from '../ui/device.js';
import { LoadoutButton } from './loadout.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { data, getConfig, getMode, getStage, useData } from '../data.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { NoticesButton } from '../ui/notices.js';
import { RoomListDialog, markListPrompt } from '../ui/roomList.js';
// 搜寻中面板：直接用同盟模拟里「匹配队友」那套界面（品牌行 + 像素侦察兵 + 轮换提示 + 停止搜寻）
import { SearchPanel } from '../ui/matchFlow.js';
import { currentNode } from '../ui/stickyNode.js';
import { VersionSwitch } from '../ui/versionPicker.js';
import { contentSet, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, lobbyVersion, offeredDifficulties, fallbackDifficulty, seasonOf, soloTimedOf, soloTimeMsgid, versionLabel } from '../versions.js';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

/**
 * 「深渊回响」开放的难度（维护者 2026-11-03 选 B：不给 4 档，只给 3 档）。
 *
 * 排除「标准模拟 FUNNY」的原因：它的敌人强度曲线是按前 14 回合设计的，R15 之后压力太低，
 * 谁去打都能潜到底，深度就失去区分度了。所以深潜只留 险境 / 绝境 / 终极 三档。
 */
export const DEEP_ECHO_DIFFICULTIES = Object.freeze(['NORMAL', 'HARD', 'ABYSS']);
/** 深潜的默认难度：大厅记住的那档不在子集里时用它。 */
export const DEEP_ECHO_DEFAULT_DIFFICULTY = 'HARD';

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，共享干员池，联防协作抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 可由 AI 队友补位'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
    // 卡片上方的说明行（按重要性排：人数 → 人数可调）。
    // 以前「支持匹配队友」压在卡片内部的薄荷底上，和卡片标题挤在一起、还把卡片撑得很宽。
    // 现在统一移到卡片上方，按「先讲人数、再讲人数可调」的语序。
    // ★ 2026-11-02：凑人这件事改成**大厅独立的「多人匹配」入口**（参考版同款整屏），
    //   同盟模拟里不再提「匹配队友」，房间设置里也没有那个开关了。
    pointExtra: [N_('房间内可调整 5–20 人')],
    // the hub's line above the entry on a short screen, where the whole line is wider than the entry (§35.51)
    pointShort: N_('1–{n} 名博士'),
  },
  {
    // 参考版的第三个入口：公开多人匹配。点它进的是**整屏**（MatchmakingSelect，参考版
    // 「选择模拟协议 / 同盟集结」那一屏），不是原地开房 —— 先选难度，再按「开始多人匹配」。
    id: 'match', name: N_('多人匹配'), en: 'PUBLIC MATCHMAKING', icon: 'search',
    desc: N_('选一个难度开始等人：系统先找正在等人的同盟，没有就替你开一间，人满或等待超时后自动开局。'),
    points: [N_('与陌生博士组队 · 不自动补 AI'), N_('人满即开 · 也可等待超时开局')],
    pointExtra: [N_('公开同盟：等不到人就自己开一间')],
    pointShort: N_('与陌生博士组队'),
  },
  {
    // ★ 2026-11-03：第三模式「深渊回响」（mode: coop + variant: deepecho）。
    //   **未开放**：普通玩家点不进（openMode 里拦 + 服务端三处门禁兜底），按钮上显示「未开放」。
    //   正式开放时把 `adminOnly` 去掉即可。
    id: 'deepecho', name: N_('深渊回响'), en: 'DEEP ECHO', icon: 'target',
    desc: N_('打完最后一个领袖后继续深潜：无尽波次、侵蚀词条与祝福，深度就是成绩。'),
    points: [N_('无尽深潜 · 深度即成绩'), N_('敌人按威胁预算随机组合')],
    pointShort: N_('无尽深潜'),
    adminOnly: true,
  },
];

/**
 * 大厅两张卡片上方「说明区」统一占的最大行数（主说明 1 行 + 补充说明）。
 * 同盟卡比独立卡多了「可调整人数」「支持匹配队友」两句，
 * 让所有卡片都补空行到同一个行数，两张卡才会完全同高同宽。
 */
const MAX_HUB_LINES = 3;

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'} roomMode
 * @param {string} difficulty
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty) {
  const fallback = MODE_TEXT[roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•・･\s]+/, '')).filter(Boolean)
    : fallback.effects.map((e) => t(e));
  const rounds = Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: difficulty !== 'FUNNY',
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code, test = false) {
  if (!CODE_RE.test(code)) return;
  const recent = [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4);
  const marks = loadPref('recentTestRooms', []);
  savePref('recentTestRooms', recent.filter(c => c === code ? test : Array.isArray(marks) && marks.includes(c)));
  savePref('recentRooms', recent);
}

/**
 * 等账号身份送到服务端（`sp-account-token` 事件），最多 `ms`。
 *
 * 刷新后 `window.__SP_ACCOUNT_TOKEN` 要等 account-title.js 的 `/api/auth/me` 返回才有，
 * 而服务端要靠它认人。玩家在身份到达之前点「加入同盟」，服务端会回 IDENTITY_PENDING，
 * 这里等一下再重试，就能认回自己的座位。
 * @param {number} ms
 * @returns {Promise<boolean>} 超时前拿到账号令牌了没有
 */
function waitAccountToken(ms = 6000) {
  const have = () => typeof window.__SP_ACCOUNT_TOKEN === 'string' && window.__SP_ACCOUNT_TOKEN.length > 0;
  if (have()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { window.removeEventListener('sp-account-token', onTok); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve(ok);
    };
    const onTok = () => { if (have()) finish(true); };
    try { window.addEventListener('sp-account-token', onTok); } catch { /* ignore */ }
    const timer = setTimeout(() => finish(have()), ms);
  });
}

/**
 * 房间不在本节点时，问匹配服务它在哪台节点上，然后跳过去。
 *
 * 30 个节点是独立进程，`room.join` 只认得本节点的房间：邀请链接 `?room=CODE`
 * 或「公开同盟」里别的节点的房，在本节点直接加入只会拿到 ROOM_NOT_FOUND。
 * 匹配服务有 `sp:n<节点>:lobby:rooms` 的全局目录，能答出节点号，我们再用 nginx 的
 * `?n=<节点>&room=<码>` 换过去 —— 落到那台节点后 `?room=` 深链会自动加入。
 *
 * 防死循环：同一个房间码只在 sessionStorage 里允许跳一次。跳过去还是找不到
 * （房刚解散），就不再跳，让它照常报「房间不存在」。
 * @returns {Promise<boolean>} 真的跳走了就 true（调用方别再弹错）
 */
async function hopToRoomNode(code) {
  const k = String(code || '').toUpperCase();
  if (!k) return false;
  const guardKey = 'sp.hopNode';
  try {
    if (sessionStorage.getItem(guardKey) === k) { sessionStorage.removeItem(guardKey); return false; }
  } catch { /* ignore */ }
  let node = 0;
  try {
    const r = await fetch('/mm/api/find-room?code=' + encodeURIComponent(k), { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) { const j = await r.json(); node = Number(j?.node) || 0; }
  } catch { return false; }
  if (!(node >= 1 && node <= 30)) return false;
  if (node === currentNode()) return false; // 已经在本节点上了，跳了也没用
  try { sessionStorage.setItem(guardKey, k); } catch { /* ignore */ }
  const u = new URL(location.href);
  u.searchParams.set('n', String(node));
  u.searchParams.set('room', k);
  u.searchParams.delete('adminWatch');
  location.assign(u.toString());
  return true;
}

export async function joinKnown(type, key) {
  const attempt = (extra) => net.request(type, { code: key, ...(extra || {}) });
  try {
    return await attempt();
  } catch (err) {
    // 房间满员，但服务端说「还没有账号身份」—— 这说明它判断不了这次是不是原座位的主人
    // （很可能就是玩家自己刷新后留下的幽灵座位占着）。等身份送达后重试一次即可。
    if (err?.code === ERR.IDENTITY_PENDING) {
      const got = await waitAccountToken();
      if (got) {
        // 身份到了：重新握手让服务端拿到 accountToken，再试一次
        try { net.close(); net.connect(); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 800));
        return await attempt();
      }
      // 等不到身份（未登录 / 网络慢）：退化成原来的「房间已满」，不再无限等
      throw Object.assign(new Error('房间已满'), { code: ERR.ROOM_FULL });
    }
    // 本节点没有这间房：可能是别的节点上的（邀请链接 / 公开同盟里的跨节点房）。
    // 查得到节点就跳过去，跳成功了就别再弹「房间不存在」。
    if (err?.code === ERR.ROOM_NOT_FOUND && type === 'room.join') {
      if (await hopToRoomNode(key)) return { ok: true };
    }
    if (err?.code !== ERR.TEST_CONFIRM) throw err;
    const text = type === 'room.spectate'
      ? t('这是测试房间，不计入任何记录。确认观战？')
      : t('这是测试房间，不计入任何记录。确认加入？');
    if (await confirmDialog({ title: t('测试'), text })) {
      return attempt({ testAck: true });
    }
  }
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__pager">
        <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
        <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
        <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
      </span>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {
  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}

/** A difficulty's rounds (+ 隐秘核心) and battlefields: on its card's meta line, and in the brief when the cards show only their names.
 *  `endless`: 「深渊回响」是无尽模式，不存在「打完 14 回合」——标成「深度无上限」而不是回合数。 */
function DifficultyRounds({ info, endless = false }) {
  return [
    endless
      ? html`<span key="r"><b class="num">∞</b> ${t('深度无上限')}</span>`
      : html`<span key="r"><b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? html` ${t('+ 隐秘核心')}` : null}</span>`,
    info.stageNote ? html`<span key="s" class="pcard__stage"><${Icon} name="rook" />${info.stageNote}</span>` : null,
  ];
}

/**
 * One difficulty of 选择模拟协议: name, text, effects, then code / rounds / 隐秘核心 / battlefields; the selected one slides
 * out with a glow in the difficulty's colour and the 已选定 stamp. `disabled`: shown, not chosen (a room's other doctors).
 */
function DifficultyCard({ roomMode, difficulty, selected, onSelect, disabled = false }) {
  const info = difficultyInfo(roomMode, difficulty);
  return html`<button type="button" class=${`pcard diff-card${selected ? ' is-on is-selected' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      disabled=${disabled} onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <${DifficultyRounds} info=${info} />
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * 深潜用的难度卡：**视觉与原版 DifficultyCard 完全一致**（同一套 `pcard diff-card` 类、难度图标、
 * 描述、要点列表、「已选定」印章），只有一处不同 —— 编号是「深潜-1/2/3」而不是全模式共用的 `AC-x`。
 * 深潜只开三档，沿用 AC 编号（从 2 起）会让人以为漏了第一档（维护者 2026-11-03）。
 */
function EchoDifficultyCard({ difficulty, index, selected, onSelect }) {
  const info = difficultyInfo('coop', difficulty);
  return html`<button type="button" class=${`pcard diff-card${selected ? ' is-on is-selected' : ''}`}
      style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      <span class="num">${'DE'}-${index + 1}</span>
      <${DifficultyRounds} info=${info} endless=${true} />
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * How much 选择模拟协议's cards show on a screen taller than 520 px (§35.18's leftover there: at 大 / 特大, in a small
 * window or a long language the four cards ran under 开始独立模拟, 终极模拟 out of view, even at 小 in 16:9 by a few px):
 * the first level at which they fit their column — 'full' (the name, the description, the effects, the rounds), 'brief'
 * (the description only in the brief at the left, where the chosen difficulty's already is), 'names' (a line each, as on
 * a phone; the brief adds the chosen difficulty's effects and rounds). A list that still does not fit scrolls.
 * `overflows(level)` lays the cards out at that level and says whether they spill. [ASSUMED] the levels and their order
 */
export const CARD_FIT_LEVELS = ['full', 'brief', 'names'];
export function pickCardFit(overflows) {
  return CARD_FIT_LEVELS.find((level) => !overflows(level)) || CARD_FIT_LEVELS[CARD_FIT_LEVELS.length - 1];
}

/**
 * Sets 选择模拟协议's `data-fit` (pickCardFit; css/screens/lobby.css) before the screen paints: at every render (a new
 * difficulty, language or label), when the list's box changes (the window, 文字大小 through the header and the button) and
 * whenever a font finishes loading (a web font that arrives late — after a resize, say — makes the lines taller). A level
 * only changes what the cards show, never the list's box, so measuring cannot loop.
 */
function ProtoFit() {
  const ref = useRef(null);
  const fit = () => {
    const body = ref.current?.closest('.proto__body');
    const list = body?.querySelector('.proto-list');
    if (!list) return;
    body.dataset.fit = pickCardFit((level) => { body.dataset.fit = level; return list.scrollHeight > list.clientHeight + 1; });
  };
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const list = ref.current?.closest('.proto__body')?.querySelector('.proto-list');
    if (!list) return undefined;
    let live = true;
    const refit = () => { if (live) fit(); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null;
    ro?.observe(list);
    const fonts = document.fonts;
    fonts?.ready?.then(refit);
    fonts?.addEventListener?.('loadingdone', refit);
    return () => { live = false; ro?.disconnect(); fonts?.removeEventListener?.('loadingdone', refit); };
  }, []);
  return html`<i ref=${ref} class="proto__fit" hidden></i>`;
}

/**
 * One of the two entries at the bottom right of the hub (独立模拟 / 同盟模拟), with its line above it: opens its dialog.
 * `timePoint` (the solo card only): the version's time rule after 「1 名博士」. Absent, the markup is today's — the
 * co-op card's long/short pair, or the solo card's single line. `timeShort` replaces the phone line; absent, the phone
 * keeps points[0] (「1 名博士」).
 */
export function HubEntry({ card, onOpen, timePoint = null, timeShort = null, locked = false }) {
  const line = timePoint
    ? html`<span class="hub-entry__long">${t(card.points[0], card.pointParams)} · ${t(timePoint)}</span><span class="hub-entry__short">${timeShort ? t(timeShort) : t(card.points[0], card.pointParams)}</span>`
    : card.pointShort
      ? html`<span class="hub-entry__long">${t(card.points[0], card.pointParams)}</span><span class="hub-entry__short">${t(card.pointShort, card.pointParams)}</span>`
      : t(card.points[0], card.pointParams);
  // 卡片上方的补充说明：可以是一句，也可以是多句（各占一行）
  const extraLines = Array.isArray(card.pointExtra) ? card.pointExtra : (card.pointExtra ? [card.pointExtra] : []);
  // 说明区固定占 MAX_HUB_LINES 行：同盟卡比独立卡多几句说明，
  // 不补空行的话多出来的行会把卡片顶高（两张卡尺寸就不一样了）。
  const pad = Math.max(0, MAX_HUB_LINES - 1 - extraLines.length);
  return html`<div class="hub-entry-wrap">
    <div class="hub-entry__lines">
      <span class="hub-entry__group"><${Icon} name=${card.icon} />${line}</span>
      ${extraLines.map((txt, i) => html`<span key=${i} class="hub-entry__group hub-entry__group2"><${Icon} name=${card.icon} />${t(txt, card.pointParams)}</span>`)}
      ${Array.from({ length: pad }, (_, i) => html`<span key=${'pad' + i} class="hub-entry__group hub-entry__group2 hub-entry__group--pad" aria-hidden="true"><${Icon} name=${card.icon} /><span>${PAD_LABEL}</span></span>`)}
    </div>
    <button type="button" class=${`mode-card hub-entry hub-entry--${card.id}${locked ? ' hub-entry--locked' : ''}`} data-mode=${card.id}
        disabled=${locked ? true : undefined}
        onClick=${() => onOpen(card.id)}
        aria-disabled=${locked ? 'true' : 'false'}
        title=${locked ? t('暂未开放，仅管理员可进入') : t(card.desc, card.params)}>
      <span class="hub-entry__icon" aria-hidden="true"><${Icon} name=${card.icon} /></span>
      <span class="hub-entry__en">${card.en}</span>
      <span class="hub-entry__name">${t(card.name)}</span>
      ${/* 未开放：右上角一条横幅；按钮本身 disabled + 灰色（无权限的人点不动） */ null}
      ${locked ? html`<span class="hub-entry__ribbon">${t('暂未开放')}</span>` : null}
      ${/* 「全新玩法」角标（维护者 2026-11-06）：只贴在**能点**的深渊回响卡右上角，斜着放；锁住时保持原样 */ null}
      ${!locked && card.id === 'deepecho' ? html`<span class="hub-entry__new">${t('全新玩法')}</span>` : null}
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/**
 * The hub's top-left 成就统计 card (#643's, from the event video) — the lobby's statistics entry: a dusk scene with the
 * emblem, the trophy medal and count, and the label strip with the LV, all from this browser's records (ui/stats.js
 * peekStatsRecords, read only; no account). The LV is counted as the settlement counts it (screens/settle.js
 * levelProgress), the trophies as the window it opens counts them (ui/stats.js aggregateStats, the same number as its
 * 获得奖杯 and 统计数据's). Read again whenever 统计数据 closes (an import or 清空 there changes them). Opens the 成就统计
 * window (screens/stats.js AchievementDialog; its 查看完整统计 opens 统计数据).
 */
function AchievementCard({ onOpen }) {
  useData('config'); useData('assets');
  const cfg = data.get('config');
  const statsOpen = useStatsOpen();
  // the LV of the season shown (DESIGN §35.23: 第一期's records count toward 第一期's levels)
  const season = useStore((s) => seasonOf(lobbyVersion(s)));
  const { prog, trophies } = useMemo(() => {
    const records = recordsOfSeason(peekStatsRecords(), season);
    return { prog: levelProgress(records, { counted: false, rewards: cfg?.rewards }), trophies: aggregateStats(records).trophies };
  }, [cfg, statsOpen, season]);
  const lv = levelOf(prog.before, cfg?.rewards?.milestones);
  const medal = trophyMedalOf(trophies, cfg?.trophies?.medals);
  return html`<button type="button" class="hub-ach" onClick=${onOpen} title=${t('成就统计（本机记录）')}>
    <span class="hub-ach__scene" aria-hidden="true">
      <svg class="hub-ach__land" viewBox="0 0 320 110" preserveAspectRatio="none">
        <defs><linearGradient id="hubAchSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a2114" /><stop offset=".5" stop-color="#b8741c" /><stop offset="1" stop-color="#f0a636" /></linearGradient></defs>
        <rect width="320" height="110" fill="url(#hubAchSky)" />
        <path d="M0 110V80l28-12 22 9 34-27 27 18 30-13 41 23 27-11 31 17 33-21 47 25V110z" fill="#3a2a16" />
        <path d="M0 110V94l46-11 41 8 50-15 44 13 50-9 40 11 49-7V110z" fill="#18120b" />
        <path d="M262 110V70M262 80l-9-8M262 76l8-7M262 86l10-6" stroke="#18120b" stroke-width="2.5" fill="none" />
      </svg>
      <span class="hub-ach__mark"><${Emblem} /></span>
      <span class="hub-ach__rank">
        <${Img} src=${medal ? uiUrl(data.get('assets'), `medalIcon/${medal.iconId}`) : null} class="hub-ach__medal" fallback=${html`<${Icon} name="rook" />`} />
        <small><${Icon} name="crown" /><b class="num">${trophies}</b></small>
      </span>
    </span>
    <span class="hub-ach__label">
      <${AchBadge} class="hub-ach__badge" />
      <span>${t('成就统计')}</span><b class="hub-ach__lv num">LV.${lv.lv}</b>
    </span>
  </button>`;
}

/** The 成就统计 label's badge (original drawing). */
function AchBadge({ class: cls }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h14v12l-7 6-7-6zm4 5v2h2V8zm4 0v2h2V8zm-4.5 4.2a4.5 4.5 0 0 0 7 0l-1.3-1a3 3 0 0 1-4.4 0z" fill-rule="evenodd" /></svg>`;
}

/**
 * 成就统计 on short screens (≤ 520 px tall, a phone in landscape), where the left column with the card gives way: a plate
 * under S.W.E.E.P. and 干员调配 that opens the same window, so the lobby keeps its statistics entry there too [ASSUMED: a
 * remake layout for small screens; css/screens/lobby.css shows it only then].
 */
function AchievementPlate({ onOpen }) {
  return html`<button type="button" class="hub-plate hub-plate--ach" onClick=${onOpen} title=${t('成就统计（本机记录）')}>
    <span class="hub-plate__glyph"><${AchBadge} /></span>
    <span class="hub-plate__label">${t('成就统计')}</span>
  </button>`;
}

/** A tile of the hub's left column (密钥加入). */
function HubTile({ icon, label, en, onClick, class: cls = '' }) {
  return html`<button type="button" class=${`hub-tile ${cls}`} onClick=${onClick}>
    <span class="hub-tile__icon" aria-hidden="true"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
  </button>`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/** S.W.E.E.P.报告: a light plate with bracket marks; opens the report (screens/sweep.js). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep lobby-sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">${t('S.W.E.E.P.报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/**
 * The event entry's backdrop: the official glow (`entry/entry_bkg_01`) and Rhodes Island hologram (`entry/entry_bkg_02`)
 * over a dark field with a faint grid; without the art pack only the field and the grid.
 */
function HubBackdrop() {
  return html`<div class="hub-bg" aria-hidden="true">
    <${Sprite} k="entry/entry_bkg_01" class="hub-bg__glow" />
    <${Sprite} k="entry/entry_bkg_02" class="hub-bg__ship" />
    <span class="hub-bg__grid"></span>
    <${LobbyScene} />
    <${OwnBackdrop} />
  </div>`;
}

/** The radar rings behind the emblem (original drawing; the sweep stops under 减少动态效果). */
function HubRadar() {
  return html`<div class="hub-radar" aria-hidden="true">
    <svg viewBox="-240 -240 480 480">
      <circle r="92" /><circle r="152" /><circle class="hub-radar__ticks" r="214" />
      <path d="M-236 0H-176M176 0H236M0 -236V-176M0 176V236" />
    </svg>
    <i class="hub-radar__sweep"></i>
  </div>`;
}

/** The emblem (official `entry/season_logo`, the title's dot emblem without the art pack) in its radar, and the title. */
function HubTitle() {
  // a title in an alphabetic script (English …) is set like the title screen's: no wordmark above it, ": " between
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  // another official version (DESIGN §35.23): its name under the title
  const version = useStore(lobbyVersion);
  return html`<div class="hub-center">
    <div class="hub-center__mark"><${HubRadar} /><${Sprite} k="entry/season_logo" class="hub-center__logo" fallback=${html`<${Emblem} />`} /></div>
    ${alphabetic ? null : html`<div class="hub-center__en">STRONGHOLD PROTOCOL <b>ALLIANCE</b></div>`}
    <h1 class=${`hub-center__title${alphabetic ? ' hub-center__title--latin' : ''}`}>${t('卫戍协议')}<span>${alphabetic ? ': ' : '：'}</span><em>${t('盟约')}</em></h1>
    ${version !== DEFAULT_VERSION ? html`<div class="hub-center__ver" data-testid="hub-version">· ${versionLabel(version)}</div>` : null}
  </div>`;
}

/** File names of the official 选择模拟协议 pictures (assets `modeChoice/<name>_rhodes_island`). */
const PROTOCOL_ART = { FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' };

/** The selected difficulty's scene (ui/protocolScene.js): the official picture on the drawn grid, squares and cable. */
function ProtocolArt({ difficulty }) {
  useData('assets');
  return html`<${ProtocolScene} difficulty=${difficulty} art=${uiUrl(data.get('assets'), `modeChoice/${PROTOCOL_ART[difficulty]}_rhodes_island`)} />`;
}

/** The ‹ + dotted rook plate at the top left of the full-screen dialogs: back to the hub (or the dialog below). */
function BackPlate({ onClick, class: cls = '' }) {
  return html`<button type="button" class=${`proto-back ${cls}`} onClick=${onClick} title=${t('返回')} aria-label=${t('返回')}>
    <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
  </button>`;
}

/**
 * 选择模拟协议 (laid out after the event's second screen): full screen — the selected difficulty's official picture and
 * brief at the left, the four difficulty cards down the right (the chosen one slides out with the 已选定 stamp), the hint
 * and 开始独立模拟 below them (with the test-room box while the server runs in test mode). The project's Modal (focus
 * trap, Esc, focus restored) styled to fill the screen. The lobby opens it for 独立模拟 only (a co-op room is created
 * from 选择同盟方式 and its difficulty changed in the room); the room (screens/room.js) opens it with `action` / `hint`
 * replacing the button's label and the hint (the host's 确认), or `readOnly` — the cards shown, not chosen, and no
 * button (the other doctors: the host chooses).
 */
export function ProtocolSelect({ roomMode, difficulty, onDifficulty, onClose, onCreate, busy, online, testMode, asTest, onTest, action = null, hint = null, readOnly = false,
  difficulties = DIFFICULTIES, loading = false, failed = false, soloTime = null, createLocked = false }) {
  const card = MODE_CARDS.find((c) => c.id === roomMode) || MODE_CARDS[0];
  const info = difficultyInfo(roomMode, difficulty);
  const label = action || (roomMode === 'solo' ? t('开始独立模拟') : t('创建同盟'));
  return html`<${Modal} open=${true} onClose=${onClose} class="proto" veilClass="proto-veil">
    <div class="proto__body" style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} data-difficulty=${difficulty} data-mode=${roomMode}>
      <div class="proto__bg" aria-hidden="true"></div>
      <${ProtoFit} />
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="proto__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择模拟协议')}</h2>
          <span class="proto-title__mode"><${Icon} name=${card.icon} />${t(card.name)}<i>${card.en}</i></span>
        </div>
      </header>
      <div class="proto-body">
        <section class="proto-stage">
          <div key=${difficulty} class="proto__pic"><${ProtocolArt} difficulty=${difficulty} /></div>
          <div class="proto-brief">
            <span class="proto-brief__code num">${info.code}</span>
            <b class="proto-brief__name">${t(DIFFICULTY_NAMES[difficulty])}</b>
            <p>${info.desc}</p>
            <div class="proto-brief__more" data-testid="proto-brief-more">
              <span class="proto-brief__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
              <span class="proto-brief__meta"><${DifficultyRounds} info=${info} /></span>
            </div>
          </div>
        </section>
        <section class="proto-side">
          <div class="proto-list" role="group" aria-label=${t('模拟难度')} aria-busy=${loading ? 'true' : 'false'}>
            ${failed ? html`<p class="proto-list__wait is-failed" data-testid="proto-failed"><${Icon} name="warn" />${t('版本数据校验失败')}
                <${Button} size="sm" variant="secondary" data-testid="proto-retry" onClick=${retryContentSet}>${t('重试')}<//></p>`
              : loading ? html`<p class="proto-list__wait" data-testid="proto-loading"><${Spinner} size="sm" />${t('正在载入版本数据…')}</p>` : null}
            ${difficulties.map((d) => html`<${DifficultyCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} onSelect=${onDifficulty} disabled=${readOnly || loading} />`)}
          </div>
          ${readOnly ? html`<div class="proto-foot proto-foot--ro">
            <p class="proto-hint proto-hint--ro"><${Icon} name="info" />${hint || t('由创建者选择')}</p>
          </div>` : html`<div class="proto-foot create-box">
            ${soloTime && !readOnly ? html`<label class="create-box__test" data-testid="solo-unlimited">
              <input type="checkbox" role="switch" checked=${soloTime.on} onChange=${(e) => soloTime.onToggle(e.target.checked)} />
              <span>${t('不限时')}</span>
              <em class="t-dim">${t('关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。')}</em>
            </label>` : null}
            ${testMode ? html`<label class="create-box__test" data-testid="create-test">
              <input type="checkbox" checked=${asTest} onChange=${(e) => onTest(e.target.checked)} />
              <span>${t('测试房间')}</span>
              <em class="t-dim">${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
            </label>` : null}
            <p class="proto-hint">
              ${online
                ? (createLocked ? t('服务器暂时关闭了创建房间，请稍后再试') : hint ?? (roomMode === 'solo' ? t('创建后即可开始模拟') : t('创建后可邀请好友或添加 AI 队友')))
                : html`<${Spinner} size="sm" label="CONNECTING" /> ${t('正在连接服务器…')}`}
            </p>
            <button type="button" class="proto-start" disabled=${!online || busy === 'create' || loading || createLocked} aria-busy=${busy === 'create' ? 'true' : 'false'} onClick=${onCreate}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${busy === 'create' ? html`<${Spinner} size="sm" />` : null}${label}</span>
              <span class="proto-start__deco" aria-hidden="true"></span>
            </button>
          </div>`}
        </section>
      </div>
    </div>
  <//>`;
}
/** 多人匹配可选的人数档：标准 4 人同盟，以及 PLAYER_CAPACITIES 里大于 4 的那几档。 */
const MULTI_CAPACITIES = PLAYER_CAPACITIES.filter((n) => n > MAX_SEATS);

/** 「多人同盟」那一档的区间文字参数：{a} 最小、{b} 最大。参考版 ui/matchmaking.js 的 multiSeats()。 */
// 「多人同盟」的范围 = 5–20 人。房间设置里的人数可以是 4~20 的**任意整数**（shared/playerCapacity.js
// 的 isPlayerCapacity），所以多人档的起点是 MAX_SEATS + 1 = 5，不是预设档 PLAYER_CAPACITIES 的第一个
// （那是 8，只用来给「没人时按多少人建房」做默认值）。以前显示成 8–20，跟房间设置对不上。
function multiSeats() { return { a: MAX_SEATS + 1, b: PLAYER_CAPACITIES[PLAYER_CAPACITIES.length - 1] ?? MAX_SEATS + 1 }; }

/**
 * 多人匹配的范围（参考版 ui/matchmaking.js 的 `matchScope`）：两组多选，每组至少留一个。
 * `seats`：'four'（标准 4 人同盟）/ 'multi'（5–20 人的多人同盟）。
 * `rules`：'standard'（没改过规则）/ 'experimental'（改过规则的，如复活、敌人倍率）。
 * 默认 `MATCH_SCOPE_DEFAULT` = 只要标准 4 人 + 标准规则，也就是「怎么都能开起来」的那一档。
 */
export const MATCH_SCOPE_DEFAULT = Object.freeze({ seats: Object.freeze(['four']), rules: Object.freeze(['standard']) });

const SCOPE_VALUES = { seats: ['four', 'multi'], rules: ['standard', 'experimental'] };

/** 读回上次的选择；非法值退回默认（参考版 matchScope(saved)）。 */
export function matchScope(saved) {
  const clean = (axis) => {
    const list = Array.isArray(saved?.[axis]) ? saved[axis].filter((v) => SCOPE_VALUES[axis].includes(v)) : [];
    return list.length ? [...new Set(list)] : [...MATCH_SCOPE_DEFAULT[axis]];
  };
  return { seats: clean('seats'), rules: clean('rules') };
}

/** 点一下某组的某个值：取消要留最后一个（和参考版 toggleMatchScope 一致）。 */
export function toggleMatchScope(scope, axis, value) {
  const list = Array.isArray(scope?.[axis]) ? scope[axis] : [];
  if (!SCOPE_VALUES[axis]?.includes(value)) return matchScope(scope);
  if (list.includes(value)) {
    if (list.length <= 1) return matchScope(scope);     // 每组至少留一个
    return matchScope({ ...scope, [axis]: list.filter((v) => v !== value) });
  }
  return matchScope({ ...scope, [axis]: [...list, value] });
}

/** 发给服务端的形式：服务端只认 'four' | 'multi' | 'both' 与 'standard' | 'experimental' | 'both'。 */
export function matchScopeRequest(scope) {
  const one = (axis, a, b) => (scope[axis].length > 1 ? 'both' : scope[axis][0] === a ? a : b);
  return { seats: one('seats', 'four', 'multi'), rules: one('rules', 'standard', 'experimental') };
}

/** 开始按钮上面那行：这次范围在等多少真人。 */
function matchHint(scope) {
  const { a, b } = multiSeats();
  const multi = scope.seats.includes('multi');
  return multi
    ? t('{a}–{b} 名真人 · 不自动补 AI · 人满或等待超时后自动开局', { a: scope.seats.includes('four') ? MAX_SEATS : a, b })
    : t('{n} 名真人 · 不自动补 AI · 人满或等待超时后自动开局', { n: MAX_SEATS });
}

/**
 * 多人匹配下方的范围开关（参考版 `MatchScope`）：人数 / 规则两组，每组多选、至少留一个。
 * 带 `data-testid="match-scope-<值>"`，测试直接按值点。
 */
function MatchScope({ scope, onToggle, disabled }) {
  const row = (axis, label, options) => html`<div class="proto-scope__row" role="group" aria-label=${label}>
    <span class="proto-scope__k">${label}</span>
    ${options.map(({ id, name, note, why }) => {
      const on = scope[axis].includes(id);
      return html`<button key=${id} type="button" class=${`proto-scope__opt${on ? ' is-on' : ''}`} aria-pressed=${on ? 'true' : 'false'} disabled=${disabled}
          title=${why} data-testid=${`match-scope-${id}`} onClick=${() => onToggle(axis, id)}>
        <${Icon} name="check" /><span>${name}${note ? html`<small class="num">${note}</small>` : null}</span>
      </button>`;
    })}
  </div>`;
  return html`<div class="proto-scope" data-testid="match-scope">
    ${row('seats', t('人数'), [
      { id: 'four', name: t('{n} 人同盟', { n: MAX_SEATS }), why: t('标准的 {n} 人同盟', { n: MAX_SEATS }) },
      { id: 'multi', name: t('多人同盟'), note: t('{a}–{b} 人', multiSeats()), why: t('{a}–{b} 人的同盟，最先集满的人数开局', multiSeats()) },
    ])}
    ${row('rules', t('规则'), [
      { id: 'standard', name: t('标准规则'), why: t('所有规则保持原样的同盟') },
      { id: 'experimental', name: t('实验性规则'), why: t('房主改过规则的同盟，如复活、敌人倍率；进房后可以在同盟设置里看到') },
    ])}
  </div>`;
}

/** 多人匹配规则说明（参考版 `MatchRules`）。 */
function MatchRules() {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant="ghost" size="sm" icon="info" class="matchmaking__help" data-testid="match-rules"
      onClick=${() => setOpen(true)}>${t('匹配说明')}<//>
    ${open ? html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div class="modal__box hub-dialog__box brackets" role="dialog" aria-modal="true" aria-label=${t('多人匹配规则')}>
        <div class="modal__stripe" aria-hidden="true"></div>
        <header class="hub-dialog__head"><${MicroLabel} tone="mint">MATCHMAKING RULES<//>
          <div class="hub-dialog__title-row"><h2 class="modal__title">${t('多人匹配规则')}</h2>
            <button type="button" class="mm-modal__close" onClick=${() => setOpen(false)} aria-label=${t('关闭')}><${Icon} name="close" /></button></div>
        </header>
        <div class="hub-dialog__body">
          <p class="modal__text">${t('按所选的人数和规则匹配真人，不自动补 AI。')}</p>
          <p class="modal__text">${t('先找正在等人的公开同盟；一个都没有就替你开一间并挂上公开同盟。人满或等待超时后自动开局。')}</p>
          <p class="modal__text">${t('「多人同盟」是最先集满的那一档人数开局；「实验性规则」指房主改过规则的同盟，例如复活、敌人倍率。')}</p>
          <p class="modal__text">${t('难度决定这一局的规则数值，进房后房主仍可在同盟设置里更改。')}</p>
        </div>
      </div>
    </div>` : null}`;
}

/**
 * 「开始多人匹配」之后的等待态（参考版 `QueueFlow` 的位置与写法）。
 *
 * 参考版这里是服务端队列（搜寻中 → 确认入场 → 搜寻成功），我们这边 `room.quickMatch`
 * 是「找一个正在等人的公开房，没有就自己开一间」，请求一回来页面就进房，
 * 所以这一屏通常只闪一下 —— 但网络慢或服务端在筛选时它是玩家看到的第一个反馈，
 * 所以照参考版把它做完整：搜寻中、已等秒数、这次的范围、取消。
 */
function MatchQueue({ difficulty, scope, elapsed, online, onCancel, queue = null, variant = null }) {
  // 排队信息（服务端 room.quickState 的答复）：还有几个人在等这个池、我排第几、还差几人。
  const waiting = Number(queue?.waiting) || 0;
  const need = Number(queue?.need) || 0;
  const position = Number(queue?.position) || 0;
  const multi = multiSeats();
  // 「深渊回响」：深潜的匹配池是**固定 4 人 + 标准规则**（维护者 2026-11-06 玩家反馈：
  // 搜寻中面板还写着「多人同盟 5–20 人」，那是普通房的范围，和实际排队的 4 人池不符）。
  const echo = variant === 'deepecho';
  const seatTags = echo
    ? [{ key: 'seat-echo', color: '#b79cff', label: t('{n} 人同盟', { n: MAX_SEATS }) }]
    : scope.seats.map((s, i) => ({
      key: `s${i}`, color: '#4ed8af',   // 人数：薄荷绿（照参考版第二颗标签）
      label: s === 'four' ? t('{n} 人同盟', { n: MAX_SEATS }) : t('多人同盟 {a}–{b} 人', { a: multi.a, b: multi.b }),
    }));
  const ruleTags = scope.rules.map((r, i) => ({
    key: `r${i}`, color: '#8d9391',    // 规则：灰
    label: r === 'standard' ? t('标准规则') : t('实验性规则'),
  }));
  // 「深渊回响」：深潜的匹配池是固定的（4 人 + 标准规则），规则标签换成「深渊回响」
  const tags = [
    { key: 'difficulty', label: t(DIFFICULTY_NAMES[difficulty]), color: DIFFICULTY_COLORS[difficulty] },
    ...seatTags,
    ...(echo ? [{ key: 'echo', label: t('深渊回响'), color: '#b79cff' }] : ruleTags),
  ];
  // 面板只显示「本难度等待队列 N 人」（与匹配器一致）；位置/还差几人另起一行。
  const waitCount = waiting > 0 ? waiting : (online ? 1 : 0);
  return html`<div class="proto-side proto-side--search">
    <${SearchPanel} elapsed=${elapsed} tags=${tags} waiting=${waitCount} onStop=${onCancel} />
    ${position > 0 && need > 0 ? html`<p class="mm-ov__pop" style="margin-top:.06rem">${t('你排第 {p} 位 · 还差 {n} 人', { p: position, n: need })}</p>` : null}
  </div>`;
}

/**
 * 多人匹配（参考版「选择模拟协议 / 同盟集结」那一屏，`ProtocolSelect` 的 match 用途）。
 *
 * 为什么单独一屏而不是原地开房：参考版点「多人匹配」进的是整屏 —— 左边是所选难度的
 * 画面（ProtocolArt），右边是难度卡和「开始多人匹配」。维护者 2026-11-02 要求同款：
 * 大厅点「多人匹配」、以及同盟模拟里的「多人匹配」胶囊，都进这一屏。
 *
 * 难度卡**必须**和独立模拟那一屏一样大：两边用的是同一个 `DifficultyCard`、同一个
 * `proto-list` 容器、同一套 CSS，这一屏不额外加任何压缩规则（维护者 2026-11-02 明确要求）。
 *
 * 下方的设置项照参考版移植（`MatchScope` + `MatchRules`）：人数（标准 4 人 / 多人同盟）
 * 与规则（标准 / 实验性）两组开关，外加「匹配说明」。它们直接决定服务端筛选与开房参数
 * （server/lobby.js `quickMatch` 的 seats / rules）。
 *
 * 和参考版的差别：参考版按下按钮后是**服务端队列**（排队 → 确认入场 → 分配节点），
 * 我们这边 `room.quickMatch` 是「找一个正在等人的公开房，没有就替你开一间」，
 * 按下即进房，所以这一屏只负责**选难度 + 选范围 + 说明将要发生什么**，
 * 等待状态由房间里显示（`room-opt-listed`）。
 *
 * `busy` 用 `run()` 的 'quick' 键；`onStart` 收到 `{ difficulty, seats, rules }`。
 */
export function MatchmakingSelect({ difficulty, onDifficulty, onClose, onStart, busy, online, createLocked = false,
  difficulties = DIFFICULTIES, scope = MATCH_SCOPE_DEFAULT, onScope = () => {},
  searching = false, elapsed = 0, onCancel = () => {}, queue = null, variant = null }) {
  const info = difficultyInfo('coop', difficulty);
  const working = busy === 'quick';
  // 已经按过「开始多人匹配」：照参考版把右列换成搜寻中（proto--searching），
  // 标题「同盟集结 / PUBLIC MATCHMAKING」不变，左边还是所选难度的画面。
  if (searching) {
    return html`<${Modal} open=${true} onClose=${onClose} class="proto proto--match proto--searching" veilClass="proto-veil">
      <div class="proto__body" style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} data-difficulty=${difficulty} data-mode="match" data-fit="full">
        <div class="proto__bg" aria-hidden="true"></div>


        <header class="proto-top">
          <${BackPlate} onClick=${onClose} class="proto__back" />
          <div class="proto-title">
            <h2 class="modal__title">${t('同盟集结')}</h2>
            <span class="proto-title__mode"><${Icon} name="search" />${t('多人匹配')}<i>PUBLIC MATCHMAKING</i></span>
          </div>
        </header>
        <div class="proto-body">
          <section class="proto-stage">
            <div key=${difficulty} class="proto__pic"><${ProtocolArt} difficulty=${difficulty} /></div>
            <div class="proto-brief">
              <span class="proto-brief__code num">${info.code}</span>
              <b class="proto-brief__name">${t(DIFFICULTY_NAMES[difficulty])}</b>
              <p>${info.desc}</p>
            </div>
          </section>
          <${MatchQueue} difficulty=${difficulty} scope=${scope} elapsed=${elapsed} online=${online} onCancel=${onCancel} queue=${queue} variant=${variant} />
        </div>
      </div>
    <//>`;
  }
  return html`<${Modal} open=${true} onClose=${onClose} class="proto proto--match" veilClass="proto-veil">
    <div class="proto__body" style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} data-difficulty=${difficulty} data-mode="match" data-fit="full">
      <div class="proto__bg" aria-hidden="true"></div>


      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="proto__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('同盟集结')}</h2>
          <span class="proto-title__mode"><${Icon} name="search" />${t('多人匹配')}<i>PUBLIC MATCHMAKING</i></span>
        </div>
      </header>
      <div class="proto-body">
        <section class="proto-stage">
          <div key=${difficulty} class="proto__pic"><${ProtocolArt} difficulty=${difficulty} /></div>
          <div class="proto-brief">
            <span class="proto-brief__code num">${info.code}</span>
            <b class="proto-brief__name">${t(DIFFICULTY_NAMES[difficulty])}</b>
            <p>${info.desc}</p>
            <div class="proto-brief__more" data-testid="proto-brief-more">
              <span class="proto-brief__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
              <span class="proto-brief__meta"><${DifficultyRounds} info=${info} /></span>
            </div>
          </div>
        </section>
        <section class="proto-side">
          <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
            ${difficulties.map((d) => html`<${DifficultyCard} key=${d} roomMode="coop" difficulty=${d} selected=${difficulty === d}
              onSelect=${onDifficulty} disabled=${working} />`)}
          </div>
          <div class="proto-foot proto-foot--match">
            ${variant === 'deepecho' ? null : html`<${MatchScope} scope=${scope} onToggle=${onScope} disabled=${working} />`}
            <div class="proto-opts">
              <span class="proto-mode-chip"><${Icon} name="search" />${variant === 'deepecho' ? t('深渊回响') : t('多人匹配')}</span>
              ${variant === 'deepecho' ? null : html`<${MatchRules} />`}
            </div>
            <p class="proto-hint" data-testid="match-hint">
              ${!online
                ? html`<${Spinner} size="sm" label="CONNECTING" /> ${t('正在连接服务器…')}`
                : createLocked
                  ? t('服务器暂时关闭了创建房间，请稍后再试')
                  : variant === 'deepecho'
                    ? t('深潜匹配池固定 4 人 · 标准规则，只会和深潜房配对')
                    : matchHint(scope)}
            </p>
            <button type="button" class="proto-start" data-testid="match-start"
              disabled=${!online || working || createLocked} aria-busy=${working ? 'true' : 'false'}
              onClick=${() => onStart({
                difficulty,
                ...(variant === 'deepecho' ? { seats: 'four', rules: 'standard' } : matchScopeRequest(scope)),
                ...(variant ? { variant } : {}),
              })}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${working ? html`<${Spinner} size="sm" />` : null}${t('开始多人匹配')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span>
            </button>
          </div>
        </section>
      </div>
    </div>
  <//>`;
}

/** 本机深潜最佳成绩的存储键（只在当前浏览器，和成就统计一样）。 */
const PAD_LABEL = '占位';  // i18n-ignore: 列表补齐用的纯视觉占位（aria-hidden）
const ECHO_BEST_KEY = 'sp.echo.best';
const echoReadBest = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(ECHO_BEST_KEY) || 'null');
    return raw && Number.isFinite(raw.depth) ? raw : null;
  } catch { return null; }
};

/**
 * 「深渊回响」的专属整屏（2026-11-03）。
 *
 * 骨架**照搬 多人匹配（MatchmakingSelect）**：`Modal` + `.proto*` —— 左边是所选难度的画面与简介，
 * 右边是难度卡列 + 底部开始按钮。这样排版、背景、按钮样式都自动和原版一致，
 * 不用再自己造一套（第一版自造的紫底整屏被维护者评价为「太丑」）。
 *
 * 内容上只比 多人匹配 多两块：本机/本周最佳，以及深潜排行榜（`/api/dive/board`）。
 * 难度只给 险境 / 绝境 / 终极 三档（标准模拟的曲线不适合 R15 之后）。
 */
export function EchoSelect({ onClose, onStart, onPublic = null, onQuick = null, quickBusy = false }) {
  // 记住上次选的深潜难度（维护者 2026-11-03：重开大厅不该跳回默认档）。
  // 用大厅同一套 loadPref / savePref，键名与同盟难度分开，互不影响。
  const remembered = (() => {
    const v = loadPref('lobby.deepechoDifficulty', null);
    return DEEP_ECHO_DIFFICULTIES.includes(v) ? v : DEEP_ECHO_DEFAULT_DIFFICULTY;
  })();
  const [difficulty, setDifficulty] = useState(remembered);
  /** 榜单看哪一档（可以和「准备开始」的难度不同：先看看极限榜再决定打哪档） */
  const [boardDiff, setBoardDiff] = useState(remembered);
  const pickDifficulty = (d) => {
    if (!DEEP_ECHO_DIFFICULTIES.includes(d)) return;
    setDifficulty(d);
    savePref('lobby.deepechoDifficulty', d);
  };
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  /** 排行榜是否可以收起（收起后难度选择顶上来，画面留给简介与开始） */
  const [boardOpen, setBoardOpen] = useState(true);
  /** 「深渊图鉴」浮层（维护者 2026-11-06：入口在顶部右侧，局内放大镜不加） */
  const [codexOpen, setCodexOpen] = useState(false);
  const [best] = useState(() => echoReadBest());
  useEffect(() => {
    let alive = true;
    setRows(null);
    setOpenRow(null);
    fetch(`/api/dive/board?limit=20&difficulty=${boardDiff}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setRows(Array.isArray(j?.rows) ? j.rows : []); })
      .catch(() => { if (alive) { setRows([]); setFailed(true); } });
    return () => { alive = false; };
  }, [boardDiff]);
  const weekBest = useMemo(() => {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = (rows || []).filter((r) => (r.at || 0) >= since);
    return recent.length ? Math.max(...recent.map((r) => r.depth)) : null;
  }, [rows]);
  const info = difficultyInfo('coop', difficulty);
  // 深潜自己的关卡编号：**用简称 `DE`**（DEEP ECHO 的缩写，和右上角副标题一致），从 1 开始。
  // 不用原版的 AC-x：那是全模式共用的编号，深潜只有三档，从 2 起会让人以为漏了第一档。
  const ECHO_CODE_PREFIX = 'DE';
  const diffNo = Math.max(1, DEEP_ECHO_DIFFICULTIES.indexOf(difficulty) + 1);
  const diffCode = `${ECHO_CODE_PREFIX}-${diffNo}`;
  return html`<${Modal} open=${true} onClose=${onClose} class="proto proto--match" veilClass="proto-veil">
    <div class="proto__body" style=${'--d-color:#b79cff'} data-difficulty=${difficulty} data-mode="deepecho" data-fit="full">
      <div class="proto__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="proto__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('深渊回响')}</h2>
          <span class="proto-title__mode"><${Icon} name="target" />${t('深渊回响')}<i>DEEP ECHO</i></span>
        </div>
        ${/* 维护者 2026-11-06：图鉴入口放顶部右侧，不进底部三个等大按钮那一排 */ null}
        <${EchoCodexButton} onOpen=${() => setCodexOpen(true)} />
      </header>
      <div class="proto-body">
        ${/* 左：立绘 + 左下简介（原版版式），排行榜作为**浮层**贴左边，不挤动任何元素 */ null}
        <section class="proto-stage">
          <div key=${difficulty} class="proto__pic"><${ProtocolArt} difficulty=${difficulty} /></div>

          <aside class=${`echo-boardfloat${boardOpen ? '' : ' is-closed'}${rows != null && rows.length === 0 ? ' is-empty' : ''}`} aria-label=${t('排行榜')}>
            <div class="echo-boardhead">
              <b class="echo-boardhead__t">${t('排行榜')}</b>
              <div class="echo-boardtabs" role="tablist" aria-label=${t('排行榜难度')}>
                ${DEEP_ECHO_DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="tab"
                    aria-selected=${boardDiff === d ? 'true' : 'false'}
                    class=${`echo-tab${boardDiff === d ? ' is-on' : ''}`}
                    onClick=${() => setBoardDiff(d)}>${t(DIFFICULTY_NAMES[d] || d)}</button>`)}
              </div>
              <button type="button" class="echo-tab echo-boardtoggle" aria-expanded=${boardOpen ? 'true' : 'false'}
                onClick=${() => setBoardOpen(!boardOpen)}>${boardOpen ? t('收起') : t('展开')}</button>
            </div>
            ${boardOpen ? html`<ol class="echo-boardlist" aria-label=${t('排行榜')}>
              <li class="echo-boardhead__cols" aria-hidden="true">
                <span>#</span><span>${t('层数')}</span><span>${t('玩家')}</span><span>${t('核心盟约')}</span><span>${t('最高盟约数')}</span><span>${t('通关时间')}</span>
              </li>
              ${rows == null
                ? html`<li class="echo-board__state">${t('读取中…')}</li>`
                : rows.length
                  ? rows.map((r) => {
                    // 维护者 2026-11-05 定的五列：层数 / 玩家（全部写出）/ 核心盟约 / 最高盟约数 / 通关时间
                    const squads = Array.isArray(r.squads) && r.squads.length ? r.squads : null;
                    const names = squads ? squads.map((s) => s.name) : (Array.isArray(r.players) ? r.players : []);
                    const cores = [...new Set(squads ? squads.flatMap((s) => (Array.isArray(s.cores) ? s.cores : [])) : [])];
                    // 最高盟约层数（维护者 2026-11-05）：只看层数，不看词条/稀有度
                    const maxLayers = Number(r.maxLayers) || 0;
                    const secs = Math.max(0, Math.floor((Number(r.clearMs) || 0) / 1000));
                    const time = r.clearMs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '—';
                    // 「通关时间」这一列显示**年月日 + 时分**（维护者 2026-11-05）：榜单要能看出是哪天打的，
                    // 纯 mm:ss 的时长放到展开明细里（只有新记录才有 clearMs）。r.at 是这条记录的结算时刻。
                    const atText = (() => {
                      const ms = Number(r.at);
                      if (!(ms > 0)) return '—';
                      const d = new Date(ms);
                      const p2 = (n) => String(n).padStart(2, '0');
                      return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
                    })();
                    return html`<li key=${r.member} class=${`echo-rank${r.rank <= 3 ? ` is-top is-top${r.rank}` : ''}`}>
                      <button type="button" class="echo-row echo-row--cols" aria-expanded=${openRow === r.member ? 'true' : 'false'}
                        onClick=${() => setOpenRow(openRow === r.member ? null : r.member)}>
                        <b class="echo-rank__no num">${r.rank}</b>
                        <span class="echo-rank__depth"><b class="num">${r.depth}</b><i>${t('层')}</i></span>
                        <span class="echo-rank__players">${names.length ? names.join('、') : (r.roomCode || '----')}</span>
                        <span class="echo-rank__cores" title=${cores.join('、')}>${cores.length ? cores.join('、') : '—'}</span>
                        <span class="echo-rank__bonds num" title=${t('所有人里最高的盟约层数（只看层数，不看词条与稀有度）')}>${maxLayers || '—'}</span>
                        <span class="echo-rank__time num" title=${time !== '—' ? `${t('通关时间')} ${time}` : atText}>${atText}</span>
                      </button>
                      ${openRow === r.member ? html`<div class="echo-detail">
                        <div><span>${t('深度')}</span><b>${r.depth}</b></div>
                        <div><span>${t('难度')}</span><b>${t(DIFFICULTY_NAMES[r.difficulty] || r.difficulty || '—')}</b></div>
                        <div><span>${t('结果')}</span><b>${r.victory ? t('通关') : t('团灭')}</b></div>
                        <div><span>${t('通关时间')}</span><b>${atText}${time !== '—' ? ` · ${time}` : ''}</b></div>
                        ${/* 「到达回合」与「队伍」原来总是显示 —/未记录：服务端根本没发这两个字段，
                              留着只是噪音（维护者 2026-11-04）。有数据才显示。 */ null}
                        ${/* 维护者 2026-11-05：展开明细也要有「玩家 / 核心盟约 / 最高盟约数」，缺数据时写 — 而不是整块消失 */ null}
                        <div class="echo-detail__full"><span>${t('玩家')}</span><b>${names.length ? names.join('、') : '—'}</b></div>
                        <div class="echo-detail__full"><span>${t('核心盟约')}</span><b>${squads
                          ? squads.map((s) => t('{name}：{cores} · 最高 {n} 层', {
                            name: s.name,
                            cores: (s.cores || []).join('、') || t('无核心'),
                            n: s.maxLayers || 0,
                          })).join(' ｜ ')
                          : (cores.length ? cores.join('、') : '—')}</b></div>
                        <div><span>${t('最高盟约数')}</span><b>${maxLayers ? t('{n} 层', { n: maxLayers }) : '—'}</b></div>
                        <div class="echo-detail__full"><span>${t('房间')}</span><b>${r.roomCode || '----'}</b></div>
                      </div>` : null}
                    </li>`;
                  })
                  : html`<li class="echo-board__state echo-board__state--empty">
                      <${Icon} name="target" class="echo-board__glyph" />
                      <b>${failed ? t('排行榜暂时不可用') : t('这一档还没有人留下深度记录')}</b>
                      <span>${t('第一条深度记录会出现在这里。')}</span>
                    </li>`}
            </ol>` : null}
          </aside>

          <div class="proto-brief">
            <span class="proto-brief__code num">${diffCode}</span>
            <b class="proto-brief__name">${t(DIFFICULTY_NAMES[difficulty])}</b>
            <p>${info.desc}</p>
            <div class="proto-brief__more">
              <span class="proto-brief__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
            </div>
            <p class="proto-hint">${t('打完最后一个领袖后继续深潜：无尽波次、侵蚀词条与祝福，深度就是成绩。')}</p>
          </div>
        </section>

        ${/* 右：难度卡竖排 + 成绩 + 开始（原版版式，位置不动） */ null}
        <section class="proto-side">
          <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
            ${DEEP_ECHO_DIFFICULTIES.map((d, i) => html`<${EchoDifficultyCard} key=${d} difficulty=${d} index=${i}
              selected=${difficulty === d} onSelect=${pickDifficulty} />`)}
          </div>
          <div class="echo-stats">
            <div class="echo-stat"><span class="echo-stat__k">${t('本机最佳')}</span><b class="echo-stat__v">${best ? best.depth : '—'}</b></div>
            <div class="echo-stat"><span class="echo-stat__k">${t('本周最佳')}</span><b class="echo-stat__v">${weekBest == null ? '—' : weekBest}</b></div>
          </div>
          <div class="proto-foot proto-foot--match proto-foot--triple">
            <button type="button" class="proto-start proto-start--alt" data-testid="echo-public"
              onClick=${() => onPublic({ difficulty })} title=${t('浏览公开的深潜房（进房仍需深潜资格）；想公开自己的房，进房后打开「公开深潜」')}>
              <span class="proto-start__label"><${Icon} name="link" />${t('公开深潜')}</span>
            </button>
            <button type="button" class="proto-start proto-start--alt" data-testid="echo-quick" disabled=${quickBusy}
              onClick=${() => onQuick({ difficulty })} title=${t('进入深潜匹配池，和其他深潜房配对（只会配到深潜）')}>
              <span class="proto-start__label"><${Icon} name="search" />${t('开始多人匹配')}</span>
            </button>
            <button type="button" class="proto-start" data-testid="echo-start" onClick=${() => onStart({ difficulty })}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>DEEP<br />ECHO</small></span>
              <span class="proto-start__label">${t('开始深渊回响')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span>
            </button>
          </div>
        </section>
      </div>
    </div>
    ${/* 深渊图鉴：全屏浮层，内容来自 /api/deepecho/codex */ null}
    <${EchoCodex} open=${codexOpen} onClose=${() => setCodexOpen(false)} />
  <//>`;
}

/**
 * 选择同盟方式 (laid out after the event's screen after 同盟模拟, research 06 §3.2): full screen — a radar at the left with * 玩法说明 under it, at the right the 创建同盟 card (creates the room at once at `difficulty`, the remembered one, which the
 * host changes in the room; the test-room box under it while the server runs in test mode; AI teammates are added in the
 * room) and the 加入同盟 card (the key field — the project's TextField — with 观战, the recent keys that only fill it,
 * 加入同盟). The project's Modal styled to fill the screen. `short`: the screen is at most 520 px tall (the lobby's
 * useMediaQuery(SHORT_SCREEN_QUERY)) — the key field, beside 观战 in a column about 300 px wide, is about 150 px there,
 * so its placeholder is the field's name alone (同盟密钥) instead of the whole 输入同盟密钥 / 粘贴邀请链接, which ran under
 * 观战 at 特大 in English and Japanese (§35.18's leftover); the line under the field still tells where a key comes from.
 * On a taller screen the field's name stands in too wherever the whole sentence does not fit the field (TextField
 * `placeholderShort`, by the field's width: English and Japanese at 特大 on every desktop, the default Chinese at 特大
 * in a 1024 px window — it ended in an ellipsis there).
 */
export function AllianceSelect({ onClose, onCreate, difficulty = 'FUNNY', code, onCode, codeOk, online, busy, onJoin, onSpectate, recent, marks, focusKey,
  testMode = false, asTest = false, onTest = () => {}, short = false, createLocked = false,
  capacity = 4, onCapacity = null, onBrowse = null, onQuickMatch = null }) {
  const diffName = DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '';
  return html`<${Modal} open=${true} onClose=${onClose} class="ally" veilClass="proto-veil">
    <div class="ally__body">
      <div class="proto__bg ally__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="ally__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择同盟方式')}</h2>
          <span class="proto-title__mode ally__mode"><${Icon} name="users" />${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span>
        </div>
      </header>
      <div class="proto-body ally-body">
        <section class="ally-stage">
          <${RadarScene} />
          <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('玩法说明')}</button>
        </section>
        <section class="ally-side">
          <button type="button" class="ally-card ally-card--create ally-create" data-testid="alliance-create" data-difficulty=${difficulty}
              disabled=${!online || busy === 'create' || createLocked} aria-busy=${busy === 'create' ? 'true' : 'false'} onClick=${() => onCreate()}>
            <span class="ally-card__art"><${CreateArt} /></span>
            <span class="ally-card__bar"><span class="ally-card__icon">${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="plus" />`}</span><span class="ally-card__name">${t('创建同盟')}</span>
              <small>${!online ? t('正在连接服务器…') : createLocked ? t('服务器暂时关闭了创建房间，请稍后再试') : t('难度：{name}（可在同盟内更改）', { name: diffName })}</small></span>
          </button>
          ${/* 同盟人数选择器已按维护者要求移除（2026-10-26）：房间创建后在同盟内设置，
               大厅这里不再提供入口，也不显示相关提示语。 */ null}
          ${testMode ? html`<label class="create-box__test ally-test" data-testid="create-test">
            <input type="checkbox" checked=${asTest} onChange=${(e) => onTest(e.target.checked)} />
            <span>${t('测试房间')}</span>
            <em class="t-dim">${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
          </label>` : null}
          ${/* 公开同盟（同盟列表）：照参考版做成右对齐的胶囊按钮，夹在「创建同盟」和密钥卡之间。
               多人匹配做完以后跟它并排放在这里（参考版就是这么摆的）。 */ null}
          ${onBrowse || onQuickMatch ? html`<div class="ally-links">
            ${onBrowse ? html`<button type="button" class="ally-pill" data-testid="alliance-browse"
                title=${t('看看有哪些同盟正在等博士，直接加入')} disabled=${!online} onClick=${() => onBrowse()}>
              <${Icon} name="users" />${t('公开同盟')}
            </button>` : null}
            ${onQuickMatch ? html`<button type="button" class="ally-pill" data-testid="alliance-quick"
                title=${t('一键进一个还缺人的同盟；没有就自己开一间开始等人，人满或等待超时后自动开局')}
                disabled=${!online || busy === 'create'} onClick=${() => onQuickMatch()}>
              <${Icon} name="search" />${t('多人匹配')}
            </button>` : null}
          </div>` : null}
          <div class="ally-card ally-card--join ally-join join-row">
            <span class="ally-card__art"><${JoinArt} /></span>
            <div class="ally-key">
              <${TextField} class="ally-key__field" size="key" icon="key" value=${code} transform=${normalizeCode} onInput=${onCode} onEnter=${() => onJoin()}
                placeholder=${short ? t('同盟密钥') : t('输入同盟密钥 / 粘贴邀请链接')} placeholderShort=${t('同盟密钥')} ariaLabel=${t('同盟密钥')}
                modalFocus=${!!focusKey} />
              <button type="button" class="ally-key__spec join-spectate" disabled=${!codeOk || !online || busy === 'spectate'} onClick=${() => onSpectate()}
                title=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
                ${busy === 'spectate' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="eye" />`}${t('观战')}</button>
            </div>
            <span class="ally-recent join-foot">
              ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
                ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
                  onClick=${() => onCode(c)}>${c}${Array.isArray(marks) && marks.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
                : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
            </span>
            <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
              <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
            </button>
          </div>
        </section>
      </div>
    </div>
  <//>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const conn = useStore((s) => s.connection, shallowEqual);
  // 「服务器已更新，请刷新页面」那个按钮刷新前会把房间号写进 sessionStorage（维护者 2026-11-05）：
  // 刷新回来如果已经不在房间里，就用它**自动回一次房间** —— 否则玩家点了刷新就被踢出准备室。
  // 只认这个按钮留下的标记：普通刷新 / 新标签页不会自动回房（2026-10-27 的「恢复要玩家自己点」仍然成立）。
  const inRoom = useStore((s) => !!s.room && !!s.room.code);
  useEffect(() => {
    if (conn.status !== 'online' || inRoom) return undefined;
    let code = null;
    try { code = sessionStorage.getItem('sp.rejoinRoom'); } catch { return undefined; }
    if (!code) return undefined;
    try { sessionStorage.removeItem('sp.rejoinRoom'); } catch { /* ignore */ }
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      joinKnown('room.join', code).catch(() => { /* 房间没了就老实待在大厅 */ });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [conn.status, inRoom]);
  useData('config', 'assets');
  // 清理旧版本留下的「上次选过的同盟人数」：大厅的人数选择器已移除，建房固定默认 4 人，
  // 人数到房间里的「实验性选项」再调。这个值留着会让之前进过大房间的人每次建房都变成大房。
  try { localStorage.removeItem('sp.roomCapacity'); } catch { /* ignore */ }
  const [difficulty, setDifficulty] = useState(() => {
    const d = loadPref('lobby.difficulty', 'FUNNY');
    return DIFFICULTIES.includes(d) ? d : 'FUNNY';
  });
  // 「不限时」 for the next timed solo (DESIGN §35.23.10; default off). The room's 模拟设置 is the authority once the
  // room exists; this pref is what the lobby card and the create message say before that.
  const [soloFree, setSoloFree] = useState(() => loadPref('lobby.soloUnlimited', false) === true);
  // the open dialogs: 选择同盟方式 (同盟模拟 / 密钥加入) and 选择模拟协议 (独立模拟)
  const [allyOpen, setAllyOpen] = useState(false);
  const [soloOpen, setSoloOpen] = useState(false);
  // 多人匹配：整屏（参考版同款「同盟集结」）。大厅入口和同盟模拟里的胶囊都开这一屏。
  const [matchOpen, setMatchOpen] = useState(false);
  // 多人匹配的范围（人数 / 规则）：上次的选择记在本地，默认标准 4 人 + 标准规则
  const [matchScopeState, setMatchScopeState] = useState(() => matchScope(loadPref('lobby.matchScope', null)));
  // 已按下「开始多人匹配」：显示搜寻中那屏；null = 还在选难度
  const [matchSearch, setMatchSearch] = useState(null);
  // 这次「开始多人匹配」是哪个模式发起的（null / 'coop' / 'deepecho'）：
  // 用来把两个模式的按钮忙碌态隔开 —— 普通房在搜寻时，深潜的按钮不该跟着转。
  const [quickVariant, setQuickVariant] = useState(null);
  const [matchWait, setMatchWait] = useState(0);
  // 公开同盟（同盟列表）：从「选择同盟方式」里的入口打开
  const [browseOpen, setBrowseOpen] = useState(false);
  const [code, setCode] = useState('');
  const [asTest, setAsTest] = useState(false);
  const testMode = useStore((s) => s.testMode === true);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const marks = loadPref('recentTestRooms', []);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [achOpen, setAchOpen] = useState(false);
  const [coarse] = useState(() => detectFeatures().coarse);
  const shortScreen = useMediaQuery(SHORT_SCREEN_QUERY);
  // 同盟人数：建房默认 4 人，具体人数到房间里的「实验性选项」再调。
  // 大厅的人数选择器已移除，所以这里不再读 localStorage 的「上次选择」——
  // 否则玩家之前在哪个 5–20 人房里设置过，之后每次建房都会沿用那个大房间。
  // 顺带把旧版本留下的 sp.roomCapacity 清掉，免得以后又被读到。
  try { localStorage.removeItem('sp.roomCapacity'); } catch { /* ignore */ }
  const [coopCapacity, setCoopCapacity] = useState(4);
  const pickCapacity = (n) => {
    const v = Number.isInteger(n) && n >= 4 && n <= 20 ? n : 4;
    setCoopCapacity(v);
  };
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const online = conn.status === 'online';
  const codeOk = CODE_RE.test(code);
  // official versions (DESIGN §35.23): the lobby's version, the difficulties it offers and the one shown — the remembered
  // one, or the server's fallback when the version lacks it (the pref is only overwritten when the player picks)
  const versions = useStore((s) => s.versions);
  const version = useStore(lobbyVersion);
  const versionLoading = useStore((c) => version !== DEFAULT_VERSION && (c.kind !== 'version' || c.version !== version || c.status !== 'ready'), Object.is, contentSet);
  // its set failed to load or its check (the chip's 重试 sits under the modal): 选择模拟协议 says so and offers 重试 too
  const versionFailed = useStore((c) => version !== DEFAULT_VERSION && c.kind === 'version' && c.version === version && c.status === 'failed', Object.is, contentSet);
  const cfg = getConfig();
  // null while that version's data is not on screen: the card states no time rule and the dialog hides the switch
  const soloTimed = soloTimedOf(versionLoading ? null : cfg, version);
  const solo = offeredDifficulties(versionLoading ? null : cfg, 'solo');
  const coop = offeredDifficulties(versionLoading ? null : cfg, 'coop');
  const shownSolo = fallbackDifficulty(solo, difficulty);
  const shownCoop = fallbackDifficulty(coop, difficulty);

  // 后台维护开关（admin「维护开关」）：创建房间关闭时，大厅两个入口按钮置灰并给出原因。
  // 服务端同样会拒绝（CREATE_DISABLED），这里只负责让玩家在点之前就知道。
  // 管理员/服主无视维护开关（服务端 session.admin 同样放行），维护期间可自测。
  // window.__SP_ACCOUNT_ROLE 是账号接口异步写入的，可能晚于本组件首帧。
  // 一次性读取会把「令牌还没到」误判成普通玩家、之后永远置灰，所以这里跟着
  // 账号观察者一起刷新（accountObserver 会派发 sp:account-changed）。
  const [accountRole, setAccountRole] = useState(() => {
    try { return window.__SP_ACCOUNT_ROLE || null; } catch { return null; }
  });
  useEffect(() => {
    const sync = () => { try { setAccountRole(window.__SP_ACCOUNT_ROLE || null); } catch { /* ignore */ } };
    sync();
    window.addEventListener('sp:account-changed', sync);
    // 兜底轮询：个别入口（冷启动恢复）不发事件，只写变量
    const t = setInterval(sync, 2000);
    return () => { window.removeEventListener('sp:account-changed', sync); clearInterval(t); };
  }, []);
  const isAdminUser = !!accountRole && accountRole !== 'player';
  const [createGateOpen, setCreateGateOpen] = useState(true);
  useEffect(() => {
    let stop = false;
    const load = () => {
      fetch('/maintenance.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!stop && j) setCreateGateOpen(j.create !== false); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  const createOpen = isAdminUser || createGateOpen;
  // 身份门（owner/admin 账号）：第三张卡「深渊回响」只对它开放，其余人点进去只得到「未开放」提示
  const adminId = useStore((s) => s.adminId === true);
  const echoTester = useStore((s) => s.adminId === true || s.echoTester === true);
  /**
   * 验收用：`?unreleased=1` 让管理员也看到「未开放」的样子（灰色卡 + 斜纹横幅 + 点不动）。
   * 只影响这张卡的**外观与可点性**，不改任何权限判定 —— 服务端该拦的照样拦。
   */
  const previewLocked = useMemo(() => {
    try { return new URLSearchParams(location.search).get('unreleased') === '1'; } catch { return false; }
  }, []);
  /** 深潜专属大厅是否打开（只有管理员能打开） */
  const [echoOpen, setEchoOpen] = useState(false);
/** 「公开深潜」列表（深潜专属，维护者 2026-11-06）：只列公开的深潜房，和普通「公开同盟」分开 */
/** 多人匹配当前进的是不是深潜池（决定标签与难度来源，维护者 2026-11-06） */
  const [matchVariant, setMatchVariant] = useState(null);
  const [echoBrowseOpen, setEchoBrowseOpen] = useState(false);
  /** 「公开深潜」列表里点「开一间公开的」时用的难度（跟当前选的深潜难度一致） */
  const [echoPick, setEchoPick] = useState(null);
  const openMode = (m) => {
    if (m === 'deepecho') {
      // 「深渊回响」未开放：普通玩家点了只给提示；管理员进专属大厅（难度 / 排行榜 / 开始）。
      if (!echoTester) { toast(t('「深渊回响」暂未开放，仅管理员与测试名单可进入'), 'warn'); return; }
      setEchoOpen(true);
      return;
    }
    if (m === 'solo') setSoloOpen(true);
  else if (m === 'match') { setMatchVariant(null); setMatchOpen(true); }
    else setAllyOpen(true);
  };
  const pickDifficulty = (d) => { setDifficulty(d); savePref('lobby.difficulty', d); };
  const setSoloFreePref = (on) => { const next = on === true; setSoloFree(next); savePref('lobby.soloUnlimited', next); };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const guest = !(window.__SP_ACCOUNT_USER || window.__SP_ACCOUNT_TOKEN);
  // 5–20 人房：所有已登录玩家都可以建，不再只限 owner/admin。
  // 以前这里要求 window.__SP_ACCOUNT_ROLE 是非 player 角色，等于只有服主能开多人大厅，
  // 普通玩家建房永远是 4 人，匹配池里也就永远只有 4 人局。
  // 人数优先级：URL ?capacity=N（或 ?exp=N）> 4。
  // 大厅已移除人数选择器，因此不再沿用「上次选过的人数」——那样玩家在某个大房间
  // 调过人数后，之后每次建房都会莫名变成那个大房间。人数到房间里的「实验性选项」再调。
  const experimentalForCreator = () => {
    try {
      const q = new URLSearchParams(location.search);
      const capacity = Number(q.get('capacity') || q.get('exp') || 0);
      if (!(Number.isInteger(capacity) && capacity >= 4 && capacity <= 20)) return null;
      if (capacity <= 4) return null;   // 4 人是默认房间，不带实验选项，保持原来的协议
      return {
        revivalEnabled: q.get('revive') === '1',
        disableSharedPool: q.get('pool') === '1',
        playerCapacity: capacity,
        ...(q.get('duck') === '1' ? { disableDuckLord: true } : {}),
      };
    } catch { return null; }
  };
  // 独立模拟: at the difficulty picked on 选择模拟协议; 创建同盟: at the remembered one, changed in the room by the host
  // (`version`: the lobby's, only when welcome.versions is present — protocol §4; omitted when the server offers 第二期下半 alone)
  const create = (mode, variant = null, overrides = null) => {    // 后台维护开关关闭创建房间：与新版其它提示一致，用页面顶部的 toast，而不是标题/弹窗。
    if (!createOpen) { toast(t('服务器暂时关闭了创建房间，请稍后再试'), 'warn'); return; }
    // 本服账号功能：游客不能建房，先提示，服务端还会再校验一次。
    if (guest) {
      toast(mode === 'solo' ? t('游客不能开始独立模拟，请先登录') : t('游客不能创建同盟模拟房间，请先登录'), 'warn');
      return;
    }
    // 深潜只用 3 档：大厅记住的同盟难度若不在子集里（比如「标准」），退到默认档。
    // 从深潜大厅进来时会带 overrides.difficulty（玩家刚选的），优先用它。
    const picked = overrides && DEEP_ECHO_DIFFICULTIES.includes(overrides.difficulty) ? overrides.difficulty : null;
    const difficulty = variant === 'deepecho'
      ? (picked || (DEEP_ECHO_DIFFICULTIES.includes(shownCoop) ? shownCoop : DEEP_ECHO_DEFAULT_DIFFICULTY))
      : (mode === 'solo' ? shownSolo : shownCoop);
    return run('create', async () => {
      const answer = await net.request('room.create', {
        mode, difficulty, ...(testMode && asTest ? { test: true } : {}), ...(versions ? { version } : {}),
        ...(mode === 'solo' && soloFree && soloTimed === true ? { soloUnlimited: true } : {}),
        // 「深渊回响」：第三个模式，底层仍是 coop，靠 variant 区分（协议只接受 'deepecho'）。
        // 它不支持实验性功能（服务端会拒），所以这里一个 experimental 都不带。
        ...(variant
          ? { variant, ...(overrides && overrides.echo ? { echo: overrides.echo } : {}) }
          : (() => { const experimental = experimentalForCreator(); return experimental ? { experimental } : {}; })()),
      });
      // 「公开深潜」：建房时带 listed，建完立刻挂到公开同盟列表（深潜房以前压根不公开）
      if (variant === 'deepecho' && overrides && overrides.listed) {
        try { await net.request('room.setListed', { listed: true }); } catch { /* 挂不上就还是私有房 */ }
      }
      // 建好合作房以后，进房时问一次「要不要公开到同盟列表」（ui/roomList.js 的 ListPromptDialog）：
      // 大厅到房间是一次跳转，用 sessionStorage 把这个问题带过去。深潜房不公开，所以不问。
      // 深潜房也会问一次（问的是「公开深潜」，维护者 2026-11-06）；已经用「公开深潜」建好的不再问
      if (mode === 'coop' && !(variant === 'deepecho' && overrides && overrides.listed)) markListPrompt();
      return answer;
    });
  };
  // 「多人匹配」：从整屏（MatchmakingSelect）按「开始多人匹配」进来的。
  // 服务端（Lobby.quickMatch）先找本节点上正在匹配、还缺人的公开房间，找不到就自己开一间并立刻进入匹配状态。
  // 进房后的等待状态由服务端广播过来，这里只负责关掉整屏并给个提示。
  // `req` = { difficulty, seats, rules }（MatchmakingSelect 的 onStart 直接把它传进来）。
  const quickMatch = (req) => {
    const d = req?.difficulty ?? shownCoop;
    // ★ 服务端只认 'four' | 'multi' | 'both' 与 'standard' | 'experimental' | 'both' 这几个字符串；
    //   界面传进来的却可能是数组（人数 / 规则都是多选）。以前这里原样把数组发出去，请求在
    //   协议校验那一层就被拒，玩家每次点「开始多人匹配」都只看到一句「无效的请求」。
    //   数组一律先过 matchScopeRequest 归一化，字符串原样放行。
    const seatArg = Array.isArray(req?.seats)
      ? matchScopeRequest({ seats: req.seats, rules: ['standard'] }).seats
      : req?.seats;
    const ruleArg = Array.isArray(req?.rules)
      ? matchScopeRequest({ seats: ['four'], rules: req.rules }).rules
      : req?.rules;
    const seatsRaw = seatArg ?? matchScopeRequest(matchScopeState).seats;
    const rulesRaw = ruleArg ?? matchScopeRequest(matchScopeState).rules;
    // 「深渊回响」的匹配池是固定的 4 人 + 标准规则：不管界面上的范围开关怎么选，深潜一律钉死，
    // 否则会把普通房的「5–20 人」范围发给服务端（维护者 2026-11-06 玩家反馈）。
    const echoPool = req?.variant === 'deepecho';
    setQuickVariant(echoPool ? 'deepecho' : 'coop');
    const seats = echoPool ? 'four' : seatsRaw;
    const rules = echoPool ? 'standard' : rulesRaw;
    if (!createOpen) { toast(t('服务器暂时关闭了创建房间，请稍后再试'), 'warn'); return; }
    if (guest) { toast(t('游客不能参与多人匹配，请先登录'), 'warn'); return; }
    // ★ 别只看 `guest`：它是渲染时算的，可能已经过期。真正决定服务端怎么认人的是
    //   hello 里带的 accountToken —— 没有令牌，服务端一律按游客处理，点下去只会换回
    //   一句「无效的请求」（BAD_MSG 的通用文案）。这种情况直接说清楚要重新登录。
    if (!window.__SP_ACCOUNT_TOKEN) {
      toast(t('登录状态已失效，请重新登录后再点「开始多人匹配」'), 'warn');
      return;
    }
    // 先把右列换成「搜寻中」，再去请求：网络慢的时候玩家至少知道在等什么。
    setMatchSearch({ difficulty: d, seats, rules });
    setMatchWait(0);
    return run('quick', async () => {
      try {
        // 服务端 net.js 把 reply 的字段平铺在 ok 帧顶层（{ ...res.reply, t:'ok', rid }），没有套一层 reply。
        const ask = () => net.request('room.quickMatch', { difficulty: d, seats, rules, ...(req?.variant === 'deepecho' ? { variant: 'deepecho' } : {}) });
        let reply;
        try {
          reply = (await ask()) || {};
        } catch (err) {
          // 刷新后立刻点「开始多人匹配」时，accountToken 可能还没送到服务端，它会回
          // IDENTITY_PENDING（「还没收到账号身份」）。这不是游客，等身份到了重新握手再试一次，
          // 和 joinKnown 同一套做法。以前这里直接把这个码翻成「无效的请求」，玩家完全看不懂。
          //
          // ★ 还要兼容旧节点：没有这次修复的节点不知道 IDENTITY_PENDING，它把「身份还没到」
          //   直接压成 BAD_MSG + detail「游客不能参与多人匹配，请先登录」。我们手里明明有登录
          //   凭证，就不该被当成游客打发 —— 同样等身份 + 重新握手 + 重试一次。
          //   判据看 detail 而不是只看码：BAD_MSG 在别处另有含义，不能一律重试。
          const identityRace = err?.code === ERR.IDENTITY_PENDING
            || (err?.code === ERR.BAD_MSG && typeof err?.detail === 'string' && err.detail.includes('游客'));
          if (!identityRace) throw err;
          if (!window.__SP_ACCOUNT_TOKEN && !window.__SP_ACCOUNT_USER) throw err;   // 真游客：没法重试
          const got = await waitAccountToken();
          if (!got) {
            setMatchSearch(null);
            setQuickVariant(null);
            toast(t('还没读到你的账号信息，请稍等一秒再点一次；如果一直这样，请重新登录'), 'warn');
            return;
          }
          // 重新把账号令牌带给服务端：优先用 rehandshake（同一连接上重复 hello，服务端会重新同步身份），
          // 它不可用或拒绝时再退回断开重连。实测：补发令牌后同一条连接立刻就能排队。
          let sent = false;
          try { sent = net.rehandshake?.() === true; } catch { sent = false; }
          if (!sent) { try { net.close(); net.connect(); } catch { /* ignore */ } }
          await new Promise((r) => setTimeout(r, 600));
          reply = (await ask()) || {};
        }
        // 直接进了别人正在等人的房（服务端找到合适的公开房）：跳进去
        if (reply.code && !reply.queued) { enterRoom(reply.code); return; }
        // 没人可加入：**停在匹配界面排队等**（维护者 2026-11-02：不要给玩家开一间房让他等）
        if (reply.queued && reply.ticket) {
          setMatchSearch((cur) => ({ ...(cur || { difficulty: d, seats, rules }), ticket: reply.ticket, queue: reply.state }));
          return;
        }
        if (reply.matchmaking === false) toast(t('已开好同盟，但匹配没能开启，请在大厅再点一次多人匹配'), 'warn');
        else if (reply.code) enterRoom(reply.code);
      } catch (e) {
        // 失败就退回选择那一屏，让玩家改难度/范围再试
        setMatchSearch(null);
        setQuickVariant(null);
        // BAD_MSG 的通用文案是「无效的请求」，可服务端在这里的拒绝其实都有具体原因
        // （例如「游客不能参与多人匹配，请先登录」）。detail 比错误码有用得多，原样说出来。
        if (typeof e?.detail === 'string' && e.detail) {
          toast(t(e.detail), 'warn');
          return;
        }
        // 没有 detail 才是真正难查的情况：说明拒绝发生在协议校验那一层（那里不带原因）。
        // 把错误码和原始错误一并打出来 —— 玩家截图就能定位，省掉一轮来回猜。
        const code = e?.code || e?.message || '?';
        try { console.warn('[quickMatch] 失败', e); } catch { /* ignore */ }
        toast(t('匹配失败（{code}），请把这句发给服主', { code: String(code) }), 'error');
      }
    });
  };
  // 取消匹配：先把服务端的票据撤掉（不然别人会跟一个已经走掉的人凑成一局），再关界面
  const cancelMatch = () => {
    const ticket = matchSearch?.ticket;
    setMatchSearch(null);
    setQuickVariant(null);
    if (ticket) net.request('room.quickLeave', { ticket }).catch(() => {});
  };
  // 排队中：每 2 秒问一次票据状态；成局了就进房（房间凑满会立刻开局，所以进房即进对局）
  useEffect(() => {
    const ticket = matchSearch?.ticket;
    if (!ticket) return undefined;
    let alive = true;
    const ask = async () => {
      try {
        const st = (await net.request('room.quickState', { ticket })) || {};
        if (!alive) return;
        if (st.state === 'matched' && st.code) { enterRoom(st.code); return; }
        // 服务端放弃了这一局（例如管理员临时关掉建房）：告诉玩家原因，并把界面退回选择那一屏
        if (st.state === 'failed') {
          toast(t('匹配失败：服务端暂时无法创建同盟，请稍后再试'), 'warn');
          setMatchSearch(null);
          setQuickVariant(null);
          return;
        }
        setMatchSearch((cur) => (cur && cur.ticket === ticket
          ? { ...cur, queue: { ...st, state: st.state || 'queued' } } : cur));
      } catch { /* 下一轮再问；断线由 net 自己提示 */ }
    };
    const id = setInterval(ask, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [matchSearch?.ticket]);
  // 搜寻中的秒数（只在那屏显示时走）
  useEffect(() => {
    if (!matchSearch) return undefined;
    const id = setInterval(() => setMatchWait((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [matchSearch]);
  // 范围改动落盘，下次进这一屏还是上次的选择
  const pickScope = (axis, value) => {
    const next = toggleMatchScope(matchScopeState, axis, value);
    setMatchScopeState(next);
    savePref('lobby.matchScope', next);
  };
  const join = (c = code) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('join', () => joinKnown('room.join', k));
  };
  /**
   * 从「公开同盟」列表进房：本节点直接发 room.join；
   * 房间在**别的节点**上时，用 nginx 的 `?n=<节点>` 连过去 ——
   * 页面落到那台节点后，`?room=` 深链会自动加入，玩家看到的就是「列表 → 房间」一步。
   *
   * 为什么要跳一下：30 个节点是各自独立的进程，每个 Lobby 只认识自己的房间，
   * 在本节点发 room.join 只会拿到「房间不存在」。
   */
  const enterRoom = (c, node) => {
    const k = codeArg(c, code);
    if (!k) return;
    const mine = currentNode();
    if (node && node !== mine) {
      // 直接换页到那台节点并带上房间码：不用先进大厅再点一次
      // ★ 留一个「这次是玩家自己点的公开同盟」标记：落地后 main.js 的 validatePendingInvite
      //   会用 /mm/api/find-room 检查房间是否还在，而那个目录有十秒级延迟 —— 查不到就把
      //   待加入清掉，玩家于是「跳过去了但没进房」。标记存在时跳过那次清理。
      try { sessionStorage.setItem('sp_join_from_list', k); } catch { /* 隐私模式 */ }
      const u = new URL(location.href);
      u.searchParams.set('n', String(node));
      u.searchParams.set('room', k);
      u.searchParams.delete('adminWatch');
      location.assign(u.toString());
      return;
    }
    join(k);
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('spectate', () => joinKnown('room.spectate', k).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };

  return html`<div class="screen lobby-screen lobby-hub">
    <${HubBackdrop} />
    <header class="topbar">
      <div class="topbar__left">
        <${Button} variant="ghost" size="sm" icon="chevronLeft" onClick=${backToTitle} title=${t('返回标题')}>${t('返回')}<//>
        <${PingPill} ms=${conn.ping} online=${online} />
        <span class="topbar__sep" aria-hidden="true"></span>
        <div class="topbar__tools">
          <${NoticesButton} />
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${GuideButton} class="lobby-guide" variant="secondary" square=${true} />
          <${LobbyMediaButton} />
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      <div class="topbar__right">
        <${VersionSwitch} />
        <${ResumeMatchButton} />
      </div>
    </header>

    <main class="hub-stage">
      <${HubTitle} />
      <aside class="hub-side">
        <${AchievementCard} onOpen=${() => setAchOpen(true)} />
        <${HubTile} icon="key" label=${t('密钥加入')} en="JOIN WITH KEY" class="hub-tile--key" onClick=${() => setAllyOpen(true)} />
        <${TipsPanel} />
      </aside>
      <aside class="hub-right">
        <${SweepPlate} onClick=${() => setSweepOpen(true)} />
        <${LoadoutButton} from="lobby" size="lg" class="hub-plate hub-plate--loadout lobby-loadout" label=${t('干员调配')} />
        <${AchievementPlate} onOpen=${() => setAchOpen(true)} />
      </aside>
      <section class="hub-entries" aria-label=${t('模拟方式')}>
        ${MODE_CARDS.map((c) => {
          const timedCard = c.id === 'solo';
          const timePoint = timedCard ? soloTimeMsgid('card', { timed: soloTimed, unlimited: soloFree }) : '';
          const timeShort = timedCard ? soloTimeMsgid('short', { timed: soloTimed, unlimited: soloFree }) : '';
          return html`<${HubEntry} key=${c.id} card=${c} onOpen=${openMode} timePoint=${timePoint || null} timeShort=${timeShort || null}
            locked=${c.adminOnly === true && (!echoTester || previewLocked)} />`;
        })}
      </section>
    </main>

    ${/* 公开同盟（同盟列表）：列表**叠在**同盟模拟上面，不关掉它（参考版就是 listOpen && allyOpen）。
          以前这里顺手 setAllyOpen(false)，看着就是「点一下直接跳回大厅」—— 浮层先消失、
          列表才出来，中间那一下就没有了「我还在同盟模拟里」的上下文。
          ★ 这些说明必须留在标签**外面**：写在 <${'AllianceSelect'} …/> 里面的话，htm 会把
          // 开头的行当成属性名，后面的属性（onBrowse）就整条丢掉 —— 表现就是
          「同盟模拟里根本没有『公开同盟』按钮」（2026-11-02 玩家反馈，browser 探针复现）。 */ null}
    ${allyOpen ? html`<${AllianceSelect} onClose=${() => { setAllyOpen(false); setBrowseOpen(false); }} onCreate=${() => create('coop')} difficulty=${shownCoop}
      code=${code} onCode=${(v) => setCode(normalizeCode(v))} codeOk=${codeOk} online=${online} busy=${busy}
      onJoin=${join} onSpectate=${spectate} recent=${recent} marks=${marks} focusKey=${!coarse}
      testMode=${testMode} asTest=${asTest} onTest=${setAsTest} short=${shortScreen} createLocked=${!createOpen}
      capacity=${coopCapacity} onCapacity=${pickCapacity}
      onBrowse=${() => setBrowseOpen(true)}
      onQuickMatch=${() => { setAllyOpen(false); setBrowseOpen(false); setMatchVariant(null); setMatchOpen(true); }} />` : null}
    ${/* 「深渊回响」专属整屏（只有管理员能打开）：骨架照 多人匹配，样式天然一致 */ null}
    ${echoOpen ? html`<${EchoSelect} onClose=${() => setEchoOpen(false)}
      onStart=${({ difficulty: pickedDifficulty }) => {
        setEchoOpen(false);
        create('coop', 'deepecho', { difficulty: pickedDifficulty });
      }}
      onPublic=${({ difficulty: pickedDifficulty }) => {
        // 「公开深潜」= 浏览别人的公开深潜房（和「公开同盟」同一套）；想开一间就点列表里的「开一间公开的」
        setEchoBrowseOpen(true);
        setEchoPick(pickedDifficulty);
      }}
      onQuick=${({ difficulty: pickedDifficulty }) => {
        // 和「多人匹配」整屏里按「开始多人匹配」完全一样：立刻进队列，右列换成搜寻中
        setEchoPick(pickedDifficulty);
        setEchoOpen(false);
        setMatchVariant('deepecho');
        setMatchOpen(true);
        quickMatch({ difficulty: pickedDifficulty, seats: 'four', rules: 'standard', variant: 'deepecho' });
      }}
      quickBusy=${busy === 'quick' && quickVariant === 'deepecho'} />` : null}
    ${soloOpen ? html`<${ProtocolSelect} roomMode="solo" difficulty=${shownSolo} onDifficulty=${pickDifficulty}
      onClose=${() => setSoloOpen(false)} onCreate=${() => create('solo')} busy=${busy} online=${online}
      testMode=${testMode} asTest=${asTest} onTest=${setAsTest} difficulties=${solo} loading=${versionLoading} failed=${versionFailed}
      soloTime=${soloTimed === true ? { on: soloFree, onToggle: setSoloFreePref } : null} createLocked=${!createOpen} />` : null}
    ${/* 多人匹配：参考版同款整屏（「同盟集结」）。大厅的入口和同盟模拟里的胶囊都开这一屏，
          按下「开始多人匹配」才真正发 room.quickMatch。 */ null}
    ${/* 多人匹配整屏（「同盟集结」）：大厅的入口和同盟模拟里的胶囊都开这一屏。
          按下「开始多人匹配」后同一屏的右列换成搜寻中（我们自己后端是按下即进房，
          所以没有参考版那套 30 秒确认入场，这里也不假装有）。 */ null}
    ${matchOpen ? html`<${MatchmakingSelect} difficulty=${matchVariant === 'deepecho' ? (echoPick || shownCoop) : shownCoop} onDifficulty=${pickDifficulty}
      onClose=${() => { setMatchOpen(false); setMatchSearch(null); setMatchVariant(null); setQuickVariant(null); }}
      onStart=${(req) => quickMatch(req)}
      busy=${busy && (matchVariant === 'deepecho' ? quickVariant === 'deepecho' : quickVariant !== 'deepecho') ? busy : null}
      online=${online} createLocked=${!createOpen} difficulties=${coop}
      scope=${matchScopeState} onScope=${pickScope} variant=${matchVariant}
      searching=${!!matchSearch} elapsed=${matchWait} queue=${matchSearch?.queue ?? null}
      onCancel=${() => {
        cancelMatch();
        if (matchVariant === 'deepecho') { setMatchOpen(false); setEchoOpen(true); setMatchVariant(null); }
      }} />` : null}
    ${/* 和参考版一致：同盟模拟还开着才画这个列表。它叠在上面（Modal 的 modalStack 让
         只有最上层响应 Esc / Tab / 焦点），所以关掉列表 = 回到同盟模拟，而不是回大厅。 */ null}
    ${/* 公开深潜：深潜专属的公开列表（维护者 2026-11-06） */ null}
    ${echoBrowseOpen ? html`<${RoomListDialog} variant="deepecho" online=${online} busy=${busy}
      onJoin=${(c, node) => { setEchoBrowseOpen(false); enterRoom(c, node); }}
      onClose=${() => setEchoBrowseOpen(false)} />` : null}
    ${browseOpen && allyOpen ? html`<${RoomListDialog} online=${online} busy=${busy}
      onJoin=${(c, node) => { setBrowseOpen(false); setAllyOpen(false); enterRoom(c, node); }} onClose=${() => setBrowseOpen(false)} />` : null}
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
    ${achOpen ? html`<${AchievementDialog} onClose=${() => setAchOpen(false)} />` : null}
  </div>`;
}
