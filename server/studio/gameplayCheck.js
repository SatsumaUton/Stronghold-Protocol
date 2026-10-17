// Run the ordinary checker and composer against generated JSON, without executing author code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPluginFolder } from '../plugins/pack.js';
import { buildContentSet } from '../plugins/contentSet.js';
import { DATA_DIR } from '../data.js';
import { writeTrialDraftFile } from './trialDraft.js';
import { hasOperatorTrait } from '../plugins/operatorTraits.js';

export function checkGameplayDraft(id, made, { dataDir = DATA_DIR } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-check-'));
  try {
    const dir = path.join(tmp, id);
    fs.mkdirSync(dir);
    writeTrialDraftFile(dir, 'plugin.json', JSON.stringify(made.manifest));
    for (const [rel, text] of Object.entries(made.files)) writeTrialDraftFile(dir, rel, text);
    const check = checkPluginFolder(dir, undefined, { dataDir });
    const problems = check.issues.filter(p => p.level === 'problem').map(p => ({ code: p.code, path: p.params?.where || p.file || '', message: p.text, params: p.params }));
    const alreadyComposed = Object.values(check.plugin?.content?.documents || {}).some(doc =>
      (Array.isArray(doc) ? doc : doc?.entries ?? [doc]).some(hasOperatorTrait));
    if (!problems.length && !alreadyComposed) {
      const registry = { contentDirs: { dataDir }, plugin: key => key === id ? check.plugin : null };
      problems.push(...buildContentSet({ registry, ids: [id], checkDataOnly: true }).problems);
    }
    return { ok: !problems.length, problems, warnings: check.warnings };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
