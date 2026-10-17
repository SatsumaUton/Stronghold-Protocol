// Validate staged PNG payloads before any live file changes. Every PNG upload must be a well-formed PNG: signature,
// header, chunk checksums and an end. Only effect textures are held to the FX loader's bounded 8-bit RGB/RGBA subset
// (server/plugins/fxAssets.js) and decoded here; other art (skins, portraits, Spine pages) is what the browser decodes.
import { inflateSync } from 'node:zlib';
import { StudioError } from './files.js';

const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/** @param {Buffer} bytes @param {string} rel @param {{ fx?: boolean }} [opts] `fx`: an effect texture */
export function validatePng(bytes, rel, { fx = false } = {}) {
  const fail = detail => { throw new StudioError('PLUGIN_PART_SHAPE', 400, { where: rel, detail: `${rel}: ${detail}` }); };
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('image must be PNG');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25];
  if (!w || !h || !DEPTHS[color]?.includes(depth) || bytes[26] || bytes[27] || bytes[28] > 1) fail('invalid PNG header');
  // [ASSUMED] Effect textures use the FX loader's subset, non-interlaced so that the exact pixel data can be checked.
  if (fx && (w > 2048 || h > 2048 || depth !== 8 || ![2, 6].includes(color) || bytes[28])) fail('effect texture: 8-bit non-interlaced RGB/RGBA PNG, at most 2048 square');
  let end = false, palette = false;
  const chunks = [];
  for (let off = 8; off < bytes.length;) { // loop-cap: every pass advances off by at least 12 bytes
    if (off + 12 > bytes.length) fail('truncated PNG chunk');
    const n = bytes.readUInt32BE(off), type = bytes.toString('ascii', off + 4, off + 8);
    if (off + 12 + n > bytes.length) fail('truncated PNG chunk');
    if (type === 'IHDR' && (off !== 8 || n !== 13)) fail('invalid PNG header');
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) fail('unsupported PNG chunk');
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(off + 4, off + 8 + n)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(off + 8 + n)) fail('PNG checksum mismatch');
    if (type === 'PLTE') palette = true;
    if (type === 'IDAT') chunks.push(bytes.subarray(off + 8, off + 8 + n));
    off += 12 + n;
    if (type === 'IEND') { end = true; if (n || off !== bytes.length) fail('invalid PNG end'); break; }
  }
  if (!end || !chunks.length) fail('incomplete PNG');
  if (color === 3 && !palette) fail('palette PNG without PLTE');
  if (!fx) return;
  const channels = color === 6 ? 4 : 3, stride = w * channels + 1, size = stride * h;
  let raw;
  try { raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: size }); } catch { fail('invalid PNG encoding'); }
  if (raw.length !== size) fail('invalid PNG pixel data');
  for (let y = 0; y < h; y++) if (raw[y * stride] > 4) fail('invalid PNG filter');
}
