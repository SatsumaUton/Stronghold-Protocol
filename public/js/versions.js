// versions.js — which official version this page shows (DESIGN §35.23, M1; the maintainer's decisions of 2026-10-22).
//
//   * The lobby: each player's own choice (a browser preference, `sp.pref.lobby.version`), among the versions the server
//     enables (welcome.versions: registry order, the server's default marked) — a preference the server does not list
//     falls back to its default, else to 第二期下半 (shared/versions.js DEFAULT_VERSION, a code constant). Without
//     welcome.versions the switch is off and the page shows the default data, as before M1.
//   * A room: the room's version (room.state.version; absent = 第二期下半), whatever the preference — joining a room of
//     another version loads that version, leaving restores the preference.
//   * A result shown after the room is gone (a kick, a grace timeout: the lobby replays the result after room.closed,
//     also to a freshly loaded page; a settlement screen left open) keeps the version of the match it came from: the
//     frames say it (m.public / m.result `version`, a non-default match only), so its operators are read from the data
//     they played.
//   * 统计数据's replay of a stored match of another version (outside a room): the store's `replayVersion` while it is
//     open (screens/stats.js) — the lobby preference is not touched.
// The difficulties a version offers (its config's modes) and the fallback for one it does not offer follow the server's
// rule (the highest offered one below it, else the lowest offered: ABYSS → HARD), re-implemented here because the page
// imports no server code. content.js loads and checks the version's data (loadVersionSet); every screen reads it through
// data.js as it reads a gameplay plugin's content set.
// Texts go through t() (docs/I18N.md).

import { DEFAULT_VERSION, VERSIONS, versionById, versionSlug } from '../../shared/versions.js';
import { DIFFICULTIES, modeIdFor } from '../../shared/constants.js';
import { t, N_ } from '../../shared/i18n.js';
import { loadPref, savePref, store as appStore } from './store.js';

export { DEFAULT_VERSION, versionById, versionSlug };

/** The lobby preference (`sp.pref.lobby.version`): a registry id. */
export const LOBBY_VERSION_PREF = 'lobby.version';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** The stored lobby preference, or null (junk, or an id the registry does not know). */
export function storedLobbyVersion() {
  const v = loadPref(LOBBY_VERSION_PREF, null);
  return typeof v === 'string' && versionById(v) ? v : null;
}

/**
 * welcome.versions as the page keeps it (protocol §2): entries of registry ids only, each `{ id, cs, family, label,
 * roomModes, default? }`, in the order the server sent (registry order); null without the key or when nothing is left.
 * @param {unknown} list
 * @returns {Array<{ id: string, cs: string, family: string, label: string, roomModes: string[], default?: true }> | null}
 */
export function sanitizeVersions(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const e of list.slice(0, VERSIONS.length + 4)) {
    if (!isObj(e) || typeof e.id !== 'string' || seen.has(e.id) || !versionById(e.id) || !isHex64(e.cs)) continue;
    seen.add(e.id);
    const reg = versionById(e.id);
    const roomModes = Array.isArray(e.roomModes) ? e.roomModes.filter((m) => m === 'solo' || m === 'coop') : [...reg.roomModes];
    out.push({ id: e.id, cs: e.cs, family: reg.family, label: reg.label, roomModes, ...(e.default === true ? { default: true } : {}) });
  }
  return out.length ? out : null;
}

/** The server's default version (welcome.versions' `default` entry), else 第二期下半. @param {any} s the app store's state */
export function serverDefaultVersion(s) {
  const list = Array.isArray(s?.versions) ? s.versions : null;
  return list?.find((e) => e.default)?.id ?? DEFAULT_VERSION;
}

/**
 * The lobby's version: the preference when welcome lists it, else the server's default, else 第二期下半.
 * @param {any} s the app store's state
 */
export function lobbyVersion(s) {
  const list = Array.isArray(s?.versions) ? s.versions : null;
  if (!list) return DEFAULT_VERSION;
  const pref = s.lobbyVersion;
  if (typeof pref === 'string' && list.some((e) => e.id === pref)) return pref;
  return serverDefaultVersion(s);
}

/** A room's version (room.state.version; absent = 第二期下半). @param {any} room */
export const roomVersion = (room) => (typeof room?.version === 'string' && room.version ? room.version : DEFAULT_VERSION);

/**
 * The version a match's frames say they played (m.result / m.public `version`; absent = 第二期下半, the server writes it
 * for a non-default match only). @param {any} match the store's `match`
 */
export function matchFrameVersion(match) {
  const v = match?.result?.version ?? match?.public?.version;
  return typeof v === 'string' && versionById(v) ? v : DEFAULT_VERSION;
}

/**
 * The version the page shows: the room's in a room; a stored match's while 统计数据 replays it (`replayVersion`); a
 * result's after its room is gone (its frames' version while m.public / m.result are on screen); else the lobby's.
 * @param {any} s the app store's state
 */
export function shownVersion(s) {
  if (s?.room) return roomVersion(s.room);
  if (typeof s?.replayVersion === 'string' && versionById(s.replayVersion)) return s.replayVersion;
  if (s?.match?.public || s?.match?.result) return matchFrameVersion(s.match);
  return lobbyVersion(s);
}

/**
 * Save the lobby preference and show it (the store's `lobbyVersion`; content.js follows the store).
 * @param {string} id a registry id
 * @param {{ store?: typeof appStore }} [opts]
 */
export function setLobbyVersion(id, { store = appStore } = {}) {
  if (!versionById(id)) return;
  savePref(LOBBY_VERSION_PREF, id);
  if (store.get().lobbyVersion !== id) store.set({ lobbyVersion: id });
}

/** A version's name in the interface language (its registry msgid), or the id itself for an unknown one. */
export function versionLabel(id) {
  const v = versionById(id);
  return v ? t(v.label) : String(id ?? '');
}

/** The welcome entry of a version (its cs), or null. @param {any} s @param {string} id */
export const welcomeVersion = (s, id) => (Array.isArray(s?.versions) ? s.versions.find((e) => e.id === id) || null : null);

/**
 * The official period of each version (docs/DATA.md "Official versions (M0)"): the official half it is, its
 * versionInfoDict sub-version and its dates (Beijing time). Shown in the version picker.
 */
export const VERSION_PERIODS = Object.freeze({
  act2autochess: { half: 'second', sub: 'V2_2', from: '2026-03-27', to: '2026-04-25' },
  'act2autochess@V2_1': { half: 'second', sub: 'V2_1', from: '2026-03-14', to: '2026-03-27' },
  act1autochess: { half: 'first', sub: 'V1_2', from: '2025-11-25', to: '2025-12-12' },
  'act1autochess@V1_1': { half: 'first', sub: 'V1_1', from: '2025-11-14', to: '2025-11-25' },
});

const PERIOD_TEXT = { first: N_('官方「盟约·上半」{sub}（{from} – {to}）'), second: N_('官方「盟约·下半」{sub}（{from} – {to}）') };

/** The official period line of a version (VERSION_PERIODS), or '' for one the table lacks. @param {string} id */
export function periodLine(id) {
  const p = VERSION_PERIODS[id];
  return p ? t(PERIOD_TEXT[p.half], { sub: p.sub, from: p.from, to: p.to }) : '';
}

/**
 * The difficulties a version offers in a room mode: DIFFICULTIES whose mode its config lists (config.modes[modeIdFor()]);
 * all four without a config (the page has not loaded it yet).
 * @param {any} config the shown data's config.json
 * @param {'solo'|'coop'} roomMode
 * @returns {string[]}
 */
export function offeredDifficulties(config, roomMode) {
  const modes = isObj(config?.modes) ? config.modes : null;
  if (!modes) return [...DIFFICULTIES];
  const list = DIFFICULTIES.filter((d) => isObj(modes[modeIdFor(roomMode, d)]));
  return list.length ? list : [...DIFFICULTIES];
}

/**
 * The difficulty to use when `d` is not offered — the server's rule (protocol §4): the highest offered one below it, else
 * the lowest offered. `d` itself when it is offered.
 * @param {string[]} offered @param {string} d
 */
export function fallbackDifficulty(offered, d) {
  const list = DIFFICULTIES.filter((x) => offered.includes(x));
  if (!list.length || list.includes(d)) return d;
  const i = DIFFICULTIES.indexOf(d);
  const below = list.filter((x) => DIFFICULTIES.indexOf(x) < i);
  return below.length ? below[below.length - 1] : list[0];
}

/**
 * Whether the page has to load a room's content before it may ready (protocol §5 `room.needsContent`): gameplay plugins,
 * or another official version (ui/pluginTag.js isModdedRoom, inlined: this module loads before the interface). @param {any} room
 */
export const needsContent = (room) => !!room && ((!!room.content && room.content.vanilla === false) || typeof room.version === 'string');

/** The activity a version belongs to (its season: 第一期 / 第二期), the default's for an unknown id. @param {unknown} id */
export const seasonOf = (id) => versionById(id)?.season ?? DEFAULT_VERSION;

/**
 * Whether a version is the default's data (第二期下半) or another's — what `version` the records and logs carry (only a
 * non-default one is written).
 * @param {unknown} id
 */
export const isDefaultVersion = (id) => id == null || id === DEFAULT_VERSION;
