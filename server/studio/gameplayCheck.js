// Run the ordinary checker and composer against generated JSON, without executing author code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPluginLock, checkPluginFolder } from '../plugins/pack.js';
import { buildContentSet } from '../plugins/contentSet.js';
import { DATA_DIR } from '../data.js';
import { writeTrialDraftFile } from './trialDraft.js';
import { hasOperatorTrait } from '../plugins/operatorTraits.js';
import { createPluginFiles, StudioError } from './files.js';
import { readPluginFolder } from '../plugins/registry.js';

export function checkGameplayDraft(id, made, { dataDir = DATA_DIR, pluginsDir = null, strict = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-check-'));
  try {
    const dir = path.join(tmp, id);
    fs.mkdirSync(dir);
    writeTrialDraftFile(dir, 'plugin.json', JSON.stringify(made.manifest));
    for (const [rel, text] of Object.entries(made.files)) writeTrialDraftFile(dir, rel, text);
    const available = stageAuthorDependencies(tmp, id, made.manifest, { dataDir, pluginsDir });
    if (strict) {
      // The packer's skeleton/atlas readers validate new media and rebuild clip metadata before strict checking.
      const model = buildPluginLock(dir);
      if (model.issues.length) return { ok: false, problems: model.issues.map(p => ({ code: p.code,
        path: p.file || p.at?.join('.') || '', message: p.text, params: p.params })), warnings: model.warnings };
      if (Object.keys(model.lock?.spine || {}).length) {
        made.files['plugin.lock.json'] = Buffer.from(JSON.stringify(model.lock, null, 2) + '\n');
        writeTrialDraftFile(dir, 'plugin.lock.json', made.files['plugin.lock.json']);
      }
    }
    const check = checkPluginFolder(dir, undefined, { dataDir });
    const problems = check.issues.filter(p => strict || p.level === 'problem').map(p => ({ code: p.code, path: p.params?.where || p.file || p.at?.join('.') || '', message: p.text, params: p.params }));
    const alreadyComposed = Object.values(check.plugin?.content?.documents || {}).some(doc =>
      (Array.isArray(doc) ? doc : doc?.entries ?? [doc]).some(hasOperatorTrait));
    if (!problems.length && !alreadyComposed && check.plugin?.class === 'content') {
      const registry = { contentDirs: { dataDir }, plugin: key => key === id ? check.plugin : available.get(key) };
      problems.push(...buildContentSet({ registry, ids: [id], checkDataOnly: true }).problems);
    }
    return { ok: !problems.length, problems, warnings: check.warnings };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function stageAuthorDependencies(tmp, id, manifest, { dataDir, pluginsDir }) {
  // Required neighbours participate in data-only validation, just as they do in the installed folder.
  // Stage regular bytes only: neither script evaluation nor filesystem links are needed.
  const available = new Map();
  if (pluginsDir) {
    const source = createPluginFiles(pluginsDir), queue = [manifest], seen = new Set([id]);
    for (let i = 0; i < queue.length && i < 256; i++) for (const dep of Object.keys(queue[i].requires || {})) {
      if (seen.has(dep)) continue;
      if (seen.size >= 256) throw new StudioError('PLUGIN_STUDIO_SIZE', 413);
      seen.add(dep);
      if (!source.ids().includes(dep)) continue;
      const target = path.join(tmp, dep); fs.mkdirSync(target);
      for (const f of source.list(dep)) {
        if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
        writeTrialDraftFile(target, f.rel, fs.readFileSync(source.stat(dep, f.rel).abs));
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(target, 'plugin.json'), 'utf8'));
      queue.push(manifest);
      available.set(dep, readPluginFolder(target, { dataDir }).plugin);
    }
  }
  return available;
}
