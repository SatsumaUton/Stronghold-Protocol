// The wizard owns only visible fields. Validate the complete merged folder before saving.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createPlugin, templateById, manifestText } from './templates/index.js';
import { createTargetIndex, targetOf } from './targets.js';
import { numericFields, officialOperator, readStudioData, itemParams } from './gameData.js';
import { dslExample } from './dslExamples.js';
import { validateDsl } from '../sim/content/dsl/validate.js';
import { bbCap, officialBbRange, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { MOD_KEYS } from '../../shared/plugins/skillSpec.js';
import { dslBoundForPath } from '../sim/content/dsl/bounds.js';
import { jsonProblems } from '../../shared/plugins/dataUtils.js';
import { StudioError } from './files.js';
import { GAMEPLAY_TEMPLATES, gameplayDefaults } from '../../public/studio/js/gameplayModel.js';
import { checkGameplayDraft } from './gameplayCheck.js';
import { mergeAuthorText, mergeAuthorValue, reviseJson, mergeWidgetText, removeAuthorOwned } from './authorMerge.js';
import { readAuthorOptions } from './authorOptions.js';

export function authorRevision(files, id) {
  const h = createHash('sha256');
  for (const f of files.list(id).sort((a, b) => a.rel < b.rel ? -1 : 1)) {
    if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
    h.update(f.rel).update('\0').update(fs.readFileSync(files.stat(id, f.rel).abs));
  }
  return h.digest('hex');
}

export function createAuthoring({ files, dataDir }) {
  let data;
  const official = () => (data ||= readStudioData(dataDir));
  const targets = createTargetIndex(dataDir);
  const read = id => {
    let side;
    try { side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}'); } catch { side = {}; }
    if (!side.authoring) return null;
    const revision = authorRevision(files, id), documents = snapshot(id);
    const manifest = JSON.parse(documents['plugin.json'].toString());
    const options = GAMEPLAY_TEMPLATES.includes(side.authoring.template)
      ? readAuthorOptions(id, side.authoring, documents, manifest, official()) : side.authoring.options;
    return { ...side.authoring, options, revision };
  };
  const details = (template, target) => {
    const t = targetOf(targets().targets, target);
    const d = official();
    if (GAMEPLAY_TEMPLATES.includes(template)) {
      const defaults = gameplayDefaults(template, 'draft-plugin');
      if (template === 'trait' && t) defaults.charId = t.key;
      if (template === 'item' && t) defaults.base = Object.values(d.items).find(r => !r.isGolden && (r.id === t.key || r.iconId === t.key))?.id || defaults.base;
      rememberOfficialBounds(d);
      const keys = [...new Set(Object.values(d.items).flatMap(r => (r.buffs || []).flatMap(b => Object.keys(b.bb || {}))))];
      return { defaults, items: d.items, bounds: Object.fromEntries(keys.map(k => [k, officialBbRange(k)])),
        dslBounds: Object.fromEntries(MOD_KEYS.map(k => [k, bbCap(dslBoundForPath(`mods.${k}`).key)])) };
    }
    if (template === 'numbers') return { fields: numericFields(d, t || { kind: 'operator', key: 'char_102_texas' }) };
    if (['operator', 'dsl'].includes(template)) {
      const source = officialOperator(d, t?.key || 'char_102_texas');
      return { source, branches: [...new Map(Object.values(d.chess).map(r => [r.subProfessionId, { id: r.subProfessionId, profession: r.profession, name: r.subProfessionName || r.subProfessionId }])).values()], bonds: Object.entries(d.bonds).map(([id, r]) => ({ id, name: r.name })) };
    }
    return { modes: Object.values(d.config.modes).filter(m => m.inScope).map(m => ({ id: m.modeId, name: m.name })) };
  };
  const generate = (id, input, manifest = null, { validate = true } = {}) => {
    const tpl = templateById(input.template);
    if (!tpl?.build || !input.options || typeof input.options !== 'object' || Array.isArray(input.options)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'wizard template and options required' });
    const problems = jsonProblems(input.options, 'options');
    if (problems.length) throw new StudioError(problems[0].code, 400, { where: problems[0].path, detail: problems[0].message });
    const target = input.target ? targetOf(targets().targets, input.target) : null;
    if (input.target && (!target || !tpl.kinds.includes(target.kind))) throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: input.target });
    const name = typeof manifest?.name === 'string' ? manifest.name : manifest?.name?.zh || manifest?.name?.en || id;
    const made = createPlugin(tpl, { id, name, target, options: input.options, data: official() });
    if (validate && GAMEPLAY_TEMPLATES.includes(tpl.id)) {
      const result = checkGameplayDraft(id, made, { dataDir });
      if (!result.ok) {
        const p = result.problems[0];
        throw new StudioError(p.code, 400, { where: p.path || p.params?.where || '', detail: p.message || p.text || p.zh });
      }
    }
    return made;
  };
  const snapshot = id => Object.fromEntries(files.list(id).map(f => {
    if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
    return [f.rel, fs.readFileSync(files.stat(id, f.rel).abs)];
  }));
  const prepare = (id, input, { validate = true, allowUntracked = false } = {}) => {
    // Existing trial API also previews templates in folders without a studio sidecar; only trials allow that.
    const old = read(id) || (allowUntracked ? { template: input.template, target: input.target, options: {} } : null);
    if (!old || old.template === 'script' || input.template !== old.template) throw new StudioError('PLUGIN_STUDIO_REQUEST', 409, { detail: 'this plugin is not editable with this wizard' });
    if (input.revision !== undefined && input.revision !== old.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const documents = snapshot(id), source = documents['plugin.json'].toString(), manifest = JSON.parse(source);
    const before = generate(id, old, manifest, { validate: false });
    const made = generate(id, input, manifest, { validate: false });
    for (const [rel, text] of Object.entries(made.files)) {
      if (rel === 'README.md') continue;
      if (rel === 'assets/studio-bond.png' && manifest.assets?.bonds?.[`bond_x_${id.replaceAll('-', '_')}_one`] !== rel) continue;
      if (documents[rel] && rel.endsWith('.json') && before.files[rel]) {
        documents[rel] = Buffer.from(mergeAuthorText(documents[rel].toString(), JSON.parse(before.files[rel]), JSON.parse(text)));
      } else if (documents[rel] && input.template === 'ui' && rel === 'ui/index.html') {
        documents[rel] = Buffer.from(mergeWidgetText(documents[rel].toString(), String(before.files[rel]), String(text)));
      } else if (!documents[rel]) documents[rel] = Buffer.from(text);
      // Existing binary assets and hand-authored non-JSON files are not form fields.
    }
    for (const [rel, text] of Object.entries(before.files)) {
      if (!rel.endsWith('.json') || made.files[rel] || !documents[rel]) continue;
      const source = documents[rel].toString(), remaining = removeAuthorOwned(JSON.parse(source), JSON.parse(text));
      if (remaining === undefined) continue;
      documents[rel] = Buffer.from(reviseJson(source, remaining));
      for (const key of ['operators', 'data', 'dsl', 'modes', 'offers']) if (before.manifest[key]?.includes(rel))
        (made.manifest[key] ||= []).push(rel);
    }
    if (input.template === 'item') {
      const rel = 'data/item.json', text = documents[rel].toString(), doc = JSON.parse(text);
      for (const r of doc.entries || doc.ops || []) if (r.file === 'items' &&
        ['a', 'b'].some(suffix => r.id === `item_x_${id.replaceAll('-', '_')}_${suffix}`)) {
        const value = r.value || r.set;
        value.params = itemParams(value.buffs || []);
      }
      documents[rel] = Buffer.from(reviseJson(text, doc));
    }
    mergeAuthorManifest(manifest, made.manifest, before.manifest, documents);
    documents['plugin.json'] = Buffer.from(reviseJson(source, manifest));
    const result = { ...made, manifest, files: documents };
    if (validate) {
      const checked = checkGameplayDraft(id, result, { dataDir, pluginsDir: files.base });
      if (!checked.ok) {
        const p = checked.problems[0];
        throw new StudioError(p.code, 400, { where: p.path || '', detail: p.message || p.text || p.zh });
      }
    }
    return result;
  };
  const save = (id, input) => {
    const old = read(id);
    if (input.revision !== old?.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const made = prepare(id, input);
    if (authorRevision(files, id) !== old.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    for (const [rel, text] of Object.entries(made.files)) {
      if (rel === 'plugin.lock.json') continue;
      const bytes = Buffer.from(text);
      let current;
      try { current = fs.readFileSync(files.stat(id, rel).abs); } catch { /* new generated file */ }
      if (!current?.equals(bytes)) files.write(id, rel, bytes, { generated: true });
    }
    const side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}');
    files.writeSidecar(id, '.studio.json', Buffer.from(manifestText({ ...side, authoring: made.authoring })));
  };
  return { read, save, generate, prepare, details,
    validateDraft(input) {
      try {
        if (files.ids().includes(input.id)) prepare(input.id, input);
        else generate(input.id, input);
        return { ok: true, problems: [] };
      } catch (e) { return { ok: false, problems: [{ code: e.code || 'PLUGIN_STUDIO_REQUEST', path: e.params?.where || '',
        message: e.params?.detail || e.message, params: e.params }] }; }
    },
    example: dslExample,
    // the official caps the build applies (contentSet.js), or a literal over them would pass here and fail on save
    validate: spec => { rememberOfficialBounds(official()); return validateDsl(spec, { bounds: true }); },
    source(id) {
      const manifest = JSON.parse(fs.readFileSync(files.stat(id, 'plugin.json').abs, 'utf8'));
      const rel = manifest.entry?.sim;
      return typeof rel === 'string' ? { rel, text: fs.readFileSync(files.stat(id, rel).abs, 'utf8').slice(0, 100000) } : null;
    },
  };
}

/** Preserve metadata, settings, dependencies and other unowned parts in both save and unsaved trials. */
export function mergeAuthorManifest(manifest, generated, before, documents) {
  const paths = value => typeof value === 'string' ? [value] : value || [];
  for (const key of ['operators', 'data', 'dsl', 'modes', 'slots', 'entry', 'offers', 'rules']) {
    if (Array.isArray(before[key]) || Array.isArray(generated[key])) {
      const retained = paths(manifest[key]).filter(x => !(before[key] || []).includes(x) || (generated[key] || []).includes(x));
      const next = [...retained];
      for (const rel of generated[key] || []) if (!next.includes(rel)) next.push(rel);
      if (next.length) {
        if (!(typeof manifest[key] === 'string' && next.length === 1 && next[0] === manifest[key])) manifest[key] = next;
      } else delete manifest[key];
    } else if (before[key] !== undefined || generated[key] !== undefined) {
      manifest[key] = mergeAuthorValue(manifest[key], before[key], generated[key]);
      if (manifest[key] === undefined) delete manifest[key];
    }
  }
  // Retained declarations still need their permissions. Never infer ownership from a template's class.
  const needed = p => p === 'dsl' ? manifest.dsl?.length || [...paths(manifest.operators), ...paths(manifest.data)].some(rel => {
    const d = JSON.parse(documents[rel]?.toString() || 'null');
    return (Array.isArray(d) ? d : d?.entries || [d]).some(r => r?.kit?.dsl || r?.trait?.dsl);
  }) : p === 'data.patch' || p === 'data.add' ? manifest.data?.length || manifest.operators?.length || manifest.modes?.length
    : p === 'offers' ? manifest.offers?.length : true;
  const permissions = (manifest.permissions || []).filter(p =>
    !(before.permissions || []).includes(p) || (generated.permissions || []).includes(p) || needed(p));
  for (const permission of generated.permissions || []) if (!permissions.includes(permission)) permissions.push(permission);
  if (manifest.permissions !== undefined || permissions.length) manifest.permissions = permissions;
  return manifest;
}
