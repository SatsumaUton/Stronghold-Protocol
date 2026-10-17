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
import { inventory, linkFile, candidateLimits } from './candidate.js';
import { readPluginFolder } from '../plugins/registry.js';

export function checkGameplayDraft(id, made, { dataDir = DATA_DIR, pluginsDir = null, strict = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-check-'));
  try {
    const dir = path.join(tmp, id);
    fs.mkdirSync(dir);
    if (made.sourceDir) for (const f of inventory(made.sourceDir)) linkFile(f.abs, path.join(dir, f.rel));
    writeTrialDraftFile(dir, 'plugin.json', JSON.stringify(made.manifest));
    for (const [rel, text] of Object.entries(made.files)) writeTrialDraftFile(dir, rel, text);
    return checkGameplayFolder(dir, { dataDir, pluginsDir, strict, made });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function checkGameplayFolder(dir, { dataDir = DATA_DIR, pluginsDir = null, strict = true, updateLock = true, made = null, enforceLimits = false } = {}) {
  const id = path.basename(dir);
  let modelProblems = [];
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')); } catch { /* the checker reports malformed manifests */ }
  const available = stageAuthorDependencies(path.dirname(dir), id, manifest, { dataDir, pluginsDir });
  if (strict) {
    // The packer's skeleton/atlas readers validate new media and rebuild clip metadata before strict checking.
    const model = buildPluginLock(dir);
    modelProblems = model.issues;
    if (updateLock && Object.keys(model.lock?.spine || {}).length) {
      const bytes = Buffer.from(JSON.stringify(model.lock, null, 2) + '\n');
      const old = path.join(dir, 'plugin.lock.json');
      if (!fs.existsSync(old) || !fs.readFileSync(old).equals(bytes))
        createPluginFiles(path.dirname(dir)).write(id, 'plugin.lock.json', bytes, { generated: true, aggregate: false });
      if (made) made.files['plugin.lock.json'] = bytes;
    }
  }
  if (enforceLimits) candidateLimits({ dir });
  const check = checkPluginFolder(dir, undefined, { dataDir });
  const problems = [...modelProblems, ...check.issues].filter(p => strict || p.level === 'problem').map(p => ({ code: p.code, path: p.params?.where || p.file || p.at?.join('.') || '', message: p.text, params: p.params }));
  const alreadyComposed = Object.values(check.plugin?.content?.documents || {}).some(doc =>
    (Array.isArray(doc) ? doc : doc?.entries ?? [doc]).some(hasOperatorTrait));
  if (!problems.length && !alreadyComposed && check.plugin?.class === 'content') {
    const registry = { contentDirs: { dataDir }, plugin: key => key === id ? check.plugin : available.get(key) };
    problems.push(...buildContentSet({ registry, ids: [id], checkDataOnly: true }).problems);
  }
  return { ok: !problems.length, problems, warnings: check.warnings };
}

export function stageAuthorDependencies(tmp, id, manifest, { dataDir, pluginsDir }) {
  // Required neighbours participate in data-only validation, just as they do in the installed folder.
  // Link regular dependency files after refusing links in their source; never evaluate author scripts.
  const available = new Map();
  if (pluginsDir) {
    const source = createPluginFiles(pluginsDir), queue = [manifest], seen = new Set([id]);
    for (let i = 0; i < queue.length && i < 256; i++) for (const dep of Object.keys(queue[i].requires || {})) {
      if (seen.has(dep)) continue;
      if (seen.size >= 256) throw new StudioError('PLUGIN_STUDIO_SIZE', 413);
      seen.add(dep);
      if (!source.ids().includes(dep)) continue;
      const target = path.join(tmp, dep);
      if (!fs.existsSync(target)) { fs.mkdirSync(target);
        for (const f of inventory(source.root(dep))) linkFile(f.abs, path.join(target, f.rel));
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(target, 'plugin.json'), 'utf8'));
      queue.push(manifest);
      available.set(dep, readPluginFolder(target, { dataDir }).plugin);
    }
  }
  return available;
}
