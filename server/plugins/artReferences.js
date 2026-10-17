// Optional local art for installed official operators outside the shipped roster (§34.28).
// Uses W5's bounded JSON-only reader, including disabled plugins; never loads plugin code.
import fs from 'node:fs';
import path from 'node:path';
import { installedFxReferences } from './fxReferences.js';

const read = (root, rel) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return {}; }
};

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Optional extracted art belongs to the installation's base, before cosmetic layers.
 * [ASSUMED] Existing base slots win; absent slots use local art. No author-facing fields are added. */
export function mergeLocalChars(base, local) {
  if (!isObj(base) || !isObj(local?.chars)) return base;
  const entries = Object.entries(local.chars).filter(([id, art]) => /^char_[0-9]+_[a-z0-9]+$/.test(id) && isObj(art));
  if (!entries.length) return base;
  const chars = { ...base.chars };
  for (const [id, art] of entries) {
    const existing = chars[id] || {};
    chars[id] = { ...art, ...existing };
    if (art.spine || existing.spine) chars[id].spine = { ...art.spine, ...existing.spine };
  }
  return { ...base, chars };
}

export function installedArtReferences(root) {
  const chess = read(root, 'data/chess.json'), backups = read(root, 'data/backups.json');
  const roster = new Set([...Object.values(chess).map(r => r?.charId), ...Object.keys(backups.units || {})]);
  return installedFxReferences(root, { artPhases: true }).filter(id => !roster.has(id));
}

/** [ASSUMED] Base pictures and both battle directions are required; E2 pictures only for a three-phase operator.
 * Missing files count as a gap too (copying a manifest alone does not install art). */
export function pluginArtGap(root) {
  const local = read(root, 'data/local-assets.json'), table = read(root, '.cache/gamedata/excel/character_table.json');
  const present = url => {
    if (typeof url !== 'string' || !/^\/assets\/local\/[A-Za-z0-9_./-]+$/.test(url)
      || url.split('/').some(p => p === '.' || p === '..')) return false;
    try { return fs.statSync(path.join(root, 'public', url)).isFile(); } catch { return false; }
  };
  return installedArtReferences(root).filter(id => {
    const art = local.chars?.[id];
    const pics = ['avatar', 'portrait', ...(table[id]?.phases?.length >= 3 ? ['avatarE2', 'portraitE2'] : [])];
    if (pics.some(k => !present(art?.[k]))) return true;
    return ['front', 'back'].some(face => {
      const m = art?.spine?.[face];
      return !m || !present(m.skel) || !present(m.atlas) || !m.textures?.length || !m.textures.every(present);
    });
  });
}
