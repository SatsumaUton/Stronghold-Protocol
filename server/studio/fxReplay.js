// A saved plugin's visual test uses the same record resolution and checked preview as a room, without author code.
import { createPreviews } from './preview.js';

export function addFxReplay(result, registry, selected, data, files) {
  if (!result?.ok) return result;
  const ids = new Set();
  const visit = (id, depth = 0) => {
    if (depth > 32 || ids.has(id)) return;
    const p = registry.plugin(id); if (!p) return;
    for (const dep of Object.keys(p.manifest.requires || {})) visit(dep, depth + 1);
    ids.add(id);
  };
  visit(selected);
  const fx = {}, previews = createPreviews({ vanilla: () => registry.vanillaAssets() });
  for (const id of ids) for (const op of previews.preview(id, files.root(id)).ops) if (op.at?.[0] === 'fx' && op.value) fx[id] = op.value;
  const infos = [...result.plugin.field.units, ...result.plugin.frames.flatMap(f => f.ev.filter(e => e[0] === 'spawn').map(e => e[1]))];
  const records = { chess: {}, enemies: {}, tokens: {}, backups: { units: {} } };
  for (const info of infos) {
    const file = info.side === 'enemy' ? 'enemies' : info.kind === 'token' ? 'tokens' : 'chess';
    const r = data[file]?.[info.defId]; if (r) records[file][info.defId] = r;
    if (info.diy?.charId && data.backups?.units?.[info.diy.charId]) records.backups.units[info.diy.charId] = data.backups.units[info.diy.charId];
  }
  if (Object.keys(fx).length || Object.values(records.chess).some(r => r.fx) || Object.values(records.backups.units).some(r => r.fx)) {
    result.plugin.fxAssets = fx; result.plugin.renderRecords = records;
  }
  return result;
}
