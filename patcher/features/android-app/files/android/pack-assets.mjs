// android/pack-assets.mjs — 往已生成的 APK 里塞「自带资源包」（维护者 2026-11-17）。
//
// 为什么不用 aapt2 的 `-A`：Windows 上的 aapt2 把 assets 的 ZIP 条目名写成**反斜杠**
// （`assets/sp\local\map\fx\[opt]merged_textures.png`），而 Android 的 AssetManager 只认正斜杠，
// 装到手机上会一个都读不到。这个脚本直接写 ZIP，条目名一律用 `/`（实测验证，见 .cache/aapt-probe5）。
//
// 压缩策略：png / jpg / webp / mp3 / m4a / ogg / opus / woff2 这些本来就已经压过，
// 再压一遍只是白烧 CPU（2 GB 的资源要压很久，体积还几乎不变），所以按扩展名**存而不压**（STORE，method 0）；
// 其余（json / atlas / skel / txt / js / css / fnt）照常 deflate。STORE 的条目按 zipalign 的要求对齐到 4 字节
// （本地头的 extra 字段补位），这样不必再跑 zipalign。
//
// 用法：
//   node android/pack-assets.mjs --apk <in.apk> --out <out.apk> \
//     --dirs "public/assets:assets,public/fonts:fonts,public/icons:icons,public/vendor:vendor" [--prefix sp]
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

/** 已压缩过的扩展名：存而不压。 */
const STORED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
  '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav',
  '.woff2', '.woff', '.ttf', '.otf',
]);

const LOCAL_HEADER = 30;
const UTF8_FLAG = 0x0800;

function parseArgs(argv) {
  const o = { apk: '', out: '', dirs: [], prefix: 'sp', level: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') o.apk = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    // `--dir "<源目录>=<APK 里的子目录>"`：用 '=' 当分隔符 —— 冒号会和 Windows 的 `D:` 撞车。
    else if (a === '--dir') o.dirs.push(argv[++i]);
    else if (a === '--prefix') o.prefix = argv[++i];
    else if (a === '--level') o.level = Number(argv[++i]) || 6;
  }
  if (!o.apk || !o.out) throw new Error('用法：pack-assets.mjs --apk <in.apk> --out <out.apk> --dir "<src>=<sub>" [--dir …] [--prefix sp]');
  return o;
}

/** 递归收集一个目录下的全部文件（相对路径用 `/` 分隔）。 */
function collect(root, rel = '', out = []) {
  let entries;
  try { entries = readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) collect(root, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** 读已有 APK 的中央目录，取出每个条目的名字 / 方法 / crc / 原始字节。 */
async function readExisting(apkPath) {
  const fd = await open(apkPath, 'r');
  try {
    const size = (await fd.stat()).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('不是有效的 ZIP / APK：找不到中央目录结尾');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff) throw new Error('这个 APK 用了 ZIP64，本脚本不支持');

    const cd = Buffer.alloc(cdSize);
    await fd.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compSize = cd.readUInt32LE(p + 20);
      const uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      const two = Buffer.alloc(2);
      await fd.read(two, 0, 2, localOffset + 26);
      const lhNameLen = two.readUInt16LE(0);
      await fd.read(two, 0, 2, localOffset + 28);
      const lhExtraLen = two.readUInt16LE(0);
      const dataStart = localOffset + LOCAL_HEADER + lhNameLen + lhExtraLen;
      const data = Buffer.alloc(compSize);
      if (compSize > 0) await fd.read(data, 0, compSize, dataStart);
      entries.push({ name, method, crc, compSize, uncompSize, data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally { await fd.close(); }
}

/** 读一个文件 → crc / 压缩结果。 */
async function prepare(absPath, method, level) {
  const chunks = [];
  await new Promise((res, rej) => {
    const rs = createReadStream(absPath);
    rs.on('data', (c) => chunks.push(c));
    rs.on('error', rej);
    rs.on('end', res);
  });
  const buf = Buffer.concat(chunks);
  const crc = zlib.crc32 ? zlib.crc32(buf) : crc32(buf);
  if (method === 0) return { data: buf, crc, uncompSize: buf.length };
  const z = zlib.deflateRawSync(buf, { level });
  return { data: z, crc, uncompSize: buf.length };
}

/** 手写 crc32（老 Node 没有 zlib.crc32）。 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 写 ZIP：本地头 + 数据 + 中央目录 + EOCD。
 * STORE 条目按 4 字节对齐（本地头 extra 补位），等价于跑过 zipalign。
 */
async function writeZip(outPath, plan) {
  const out = createWriteStream(outPath);
  const write = (chunk) => new Promise((res, rej) => out.write(chunk, (e) => (e ? rej(e) : res())));
  const central = [];
  let offset = 0;

  for (const e of plan) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const compSize = e.data.length;
    const lh = Buffer.alloc(LOCAL_HEADER);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(UTF8_FLAG, 6);
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);           // 1980-01-01，固定值让构建可复现
    lh.writeUInt32LE(e.crc >>> 0, 14);
    lh.writeUInt32LE(compSize, 18);
    lh.writeUInt32LE(e.method === 0 ? compSize : e.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    const localOffset = offset;
    await write(Buffer.concat([lh, nameBuf]));
    if (compSize > 0) await write(e.data);
    offset = localOffset + LOCAL_HEADER + nameBuf.length + compSize;
    central.push({ nameBuf, method: e.method, crc: e.crc >>> 0, compSize, uncompSize: e.method === 0 ? compSize : e.uncompSize, localOffset });
  }

  const cdStart = offset;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(UTF8_FLAG, 8);
    ch.writeUInt16LE(c.method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.compSize, 20);
    ch.writeUInt32LE(c.uncompSize, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28);
    ch.writeUInt32LE(c.localOffset, 42);
    await write(Buffer.concat([ch, c.nameBuf]));
    offset += 46 + c.nameBuf.length;
  }
  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  await write(eocd);
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const base = await readExisting(o.apk);
  console.log(`APK 原有 ${base.length} 个条目`);

  const plan = [...base];
  let added = 0, addedBytes = 0, storedBytes = 0;
  for (const spec of o.dirs) {
    const idx = spec.indexOf('=');
    const src = idx < 0 ? spec : spec.slice(0, idx);
    const sub = idx < 0 ? '' : spec.slice(idx + 1);
    if (!existsSync(src)) { console.log(`跳过（不存在）：${src}`); continue; }
    const files = collect(src);
    for (const rel of files) {
      const abs = path.join(src, rel);
      const entryName = [o.prefix, sub, rel].filter(Boolean).join('/');
      const ext = path.extname(rel).toLowerCase();
      const method = STORED_EXT.has(ext) ? 0 : 8;
      const prep = await prepare(abs, method, o.level);
      plan.push({ name: entryName, method, crc: prep.crc, uncompSize: prep.uncompSize, data: prep.data });
      added++;
      addedBytes += prep.uncompSize;
      if (method === 0) storedBytes += prep.uncompSize;
      if (added % 5000 === 0) console.log(`  已加入 ${added} 个（${(addedBytes / 1048576).toFixed(0)} MB）`);
    }
    console.log(`${src} → ${o.prefix}/${sub}：${files.length} 个文件`);
  }
  console.log(`新条目 ${added} 个，${(addedBytes / 1048576).toFixed(1)} MB（未压缩），其中 ${(storedBytes / 1048576).toFixed(1)} MB 存而不压`);
  await writeZip(o.out, plan);
  const size = statSync(o.out).size;
  console.log(`写出：${o.out}（${(size / 1048576).toFixed(1)} MB）`);
  if (size > 2147483647) console.log('⚠ 超过 2 GB：部分设备/安装器可能装不上');
}

main().catch((e) => { console.error(`pack-assets: ${e.message}`); process.exit(1); });
