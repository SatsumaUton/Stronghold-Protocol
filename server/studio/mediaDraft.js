// One staged document/media candidate for author saves and existing upload endpoints.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginFiles, StudioError, STUDIO_LIMITS } from './files.js';
import { isPackPath } from '../../shared/plugins/manifest.js';
import { checkGameplayDraft } from './gameplayCheck.js';
import { validatePng } from './mediaValidation.js';

export function snapshotDocuments(files, id) {
  return Object.fromEntries(files.list(id).map(f => {
    if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
    return [f.rel, fs.readFileSync(files.stat(id, f.rel).abs)];
  }));
}

export function stageUploads(input, documents, manifest) {
  if (input.uploads === undefined) return;
  if (input.template !== 'fx' || !Array.isArray(input.uploads) || input.uploads.length > 128)
    throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'uploads: at most 128 flipbook PNG files' });
  const images = new Set(Object.values(manifest.assets?.fx?.flipbooks || {}).map(b => b.image)), seen = new Set();
  for (const upload of input.uploads) {
    const rel = upload?.path;
    if (!isPackPath(rel) || !rel.endsWith('.png') || !images.has(rel) || seen.has(rel))
      throw new StudioError('PLUGIN_STUDIO_PATH', 400, { detail: 'upload must name a distinct declared flipbook PNG' });
    seen.add(rel);
    if (typeof upload.data !== 'string' || upload.data.length > Math.ceil(STUDIO_LIMITS.fileBytes / 3) * 4)
      throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { file: rel });
    const bytes = Buffer.from(upload.data, 'base64');
    validatePng(bytes, rel, { fx: true });
    documents[rel] = bytes;
  }
}

// Preflight every changed file using the ordinary size/path/type limits. Roll back a failed synchronous commit.
export function commitDocuments(files, id, documents, sidecar = null) {
  const before = snapshotDocuments(files, id), changed = Object.entries(documents)
    .filter(([rel, bytes]) => !before[rel]?.equals(Buffer.from(bytes)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-write-'));
  try {
    const staged = createPluginFiles(tmp); staged.root(id, { create: true });
    for (const [rel, bytes] of Object.entries(before)) staged.write(id, rel, bytes, { generated: true });
    for (const [rel, bytes] of changed) { files.resolve(id, rel, { forWrite: true }); staged.write(id, rel, Buffer.from(bytes), { generated: true }); }
    const oldSidecar = files.readSidecar(id, '.studio.json');
    if (sidecar) staged.writeSidecar(id, '.studio.json', sidecar);
    const written = [];
    try {
      // Media precedes the manifest so the manifest never points to a not-yet-written new file.
      for (const [rel, bytes] of changed.sort(([a], [b]) => Number(a === 'plugin.json') - Number(b === 'plugin.json'))) {
        files.write(id, rel, Buffer.from(bytes), { generated: true }); written.push(rel);
      }
      if (sidecar && oldSidecar !== sidecar.toString()) files.writeSidecar(id, '.studio.json', sidecar);
    } catch (e) {
      for (const rel of written.reverse()) {
        if (before[rel]) files.write(id, rel, before[rel], { generated: true }); else files.remove(id, rel);
      }
      throw e;
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function editMediaDraft(files, id, edit, { dataDir }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-media-'));
  try {
    const staged = createPluginFiles(tmp); staged.root(id, { create: true });
    for (const [rel, bytes] of Object.entries(snapshotDocuments(files, id))) {
      // Lock files are read-only through the studio API.
      if (rel === 'plugin.lock.json') fs.writeFileSync(path.join(staged.root(id), rel), bytes);
      else staged.write(id, rel, bytes, { generated: true });
    }
    const side = files.readSidecar(id, '.studio.json');
    if (side) staged.writeSidecar(id, '.studio.json', Buffer.from(side));
    edit(staged);
    const documents = snapshotDocuments(staged, id), manifest = JSON.parse(documents['plugin.json']);
    const checked = checkGameplayDraft(id, { manifest, files: documents }, { dataDir, pluginsDir: files.base, strict: true });
    if (!checked.ok) {
      const p = checked.problems[0];
      throw new StudioError(p.code, 400, { where: p.path, detail: p.message });
    }
    commitDocuments(files, id, documents);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
