// shared/versions.js — the official versions this remake can play (DESIGN §36.1, docs/DATA.md "Official versions
// (M0)"). Pure ESM, no Node APIs: the server, the browser and the tools read the same table.
//
//   id         the official activity id (activity_table AUTOCHESS_SEASON key), plus `@<versionInfoDict id>` for a
//              sub-version (autoChessData.versionInfoDict: V1_1 from 2025-11-14 16:00, V1_2 from 2025-11-25 16:00)
//   season     the activity id the build reads (`config.season` of the built data)
//   family     'covenant' (盟约, AUTOCHESS_SEASON): the build adapters and the rule switches of one engine
//   label      a msgid (public/i18n/*.json) [ASSUMED] names
//   roomModes  the room modes the version offers
//   dir        where the built data lives under data/: '' for the default (data/*.json, unchanged), otherwise
//              versions/<slug>/ — lowercase and safe on every OS (no '@'); a path or a file name uses versionSlug()
//
// The default is a code constant, never a server setting: data, rooms and logs without a version mean act2autochess.
// tools/versions/<slug>.mjs holds each version's build profile (pins, adapters, expected counts). M0 builds the data
// only; nothing at run time reads a non-default version yet.

import { N_ } from './i18n.js';

/** The version every record without one means (today's 盟约·下半, V2_2). */
export const DEFAULT_VERSION = 'act2autochess';

/**
 * @typedef {{ id: string, season: string, family: 'covenant', label: string, roomModes: readonly string[], dir: string }} OfficialVersion
 */

/** @type {readonly OfficialVersion[]} */
export const VERSIONS = Object.freeze([
  { id: 'act2autochess', season: 'act2autochess', family: 'covenant', label: N_('盟约·下半'), roomModes: ['solo', 'coop'], dir: '' },
  { id: 'act1autochess', season: 'act1autochess', family: 'covenant', label: N_('盟约·上半'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess/' },
  { id: 'act1autochess@V1_1', season: 'act1autochess', family: 'covenant', label: N_('盟约·上半（开服）'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess-v1_1/' },
].map((v) => /** @type {OfficialVersion} */ (Object.freeze({ ...v, roomModes: Object.freeze(v.roomModes) }))));

/**
 * The registry entry of a version id.
 * @param {unknown} id
 * @returns {OfficialVersion | null}
 */
export function versionById(id) {
  return VERSIONS.find((v) => v.id === id) || null;
}

/**
 * The file-system name of a version: the last segment of its dir, or its id for the default ('act2autochess').
 * @param {OfficialVersion} entry
 * @returns {string}
 */
export function versionSlug(entry) {
  if (!entry.dir) return entry.id;
  const parts = entry.dir.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

/**
 * The version a loaded data set belongs to: config.version.id of a non-default build, else the default.
 * @param {{ config?: { version?: { id?: unknown } } } | null | undefined} data
 * @returns {string}
 */
export function versionOfData(data) {
  const id = data?.config?.version?.id;
  return typeof id === 'string' ? id : DEFAULT_VERSION;
}
