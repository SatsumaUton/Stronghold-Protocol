#!/usr/bin/env node
/* global window, requestAnimationFrame -- only inside page.evaluate callbacks (they run in the page, not here) */
// tools/capture-video.mjs — 用无头浏览器把 render-demo 的一场录像**逐帧**截下来，再交给 ffmpeg 编码。
//
// 为什么不用 MediaRecorder / 录屏：那样拿到的是「实时播放的屏幕」——帧率随机器波动、掉帧、
// 有压缩伪影，而且不能保证每一秒的画面都是想要的那一帧。宣传片要的是**可复现**：
// 同一个 seed、同一段录像、同一个时间点，每次导出都是同一帧。所以这里：
//   1. 起一个本地服务（或复用已开着的）；
//   2. Puppeteer 打开 /dev/render-demo.html，等 window.__demo.ready；
//   3. 用 demo.seek(t) 精确跳到第 t 秒 → 等 requestAnimationFrame 稳定 → 截一张图；
//   4. 每帧一张 PNG，最后 ffmpeg 按固定帧率拼成 mp4。
//
// 用法：
//   node tools/capture-video.mjs --scene dive-d16 --from 0 --to 20 --fps 30 --out .cache/video/dive16
//   node tools/capture-video.mjs --scene dive-d16 --from 8 --to 18 --fps 60 --width 1920 --height 1080
//   node tools/capture-video.mjs --scene dive-d20 --from 0 --to 12 --cam normal --panel 0
//
// 参数：--scene（录像名，见 public/dev/recordings/index.json）--from/--to（秒）--fps（默认 30）
//       --width/--height（默认 1920x1080）--cam（机位，见 render-demo 的 &cam=）--panel 0 隐藏调试面板
//       --out（帧目录，默认 .cache/video/<scene>）--base（默认 http://127.0.0.1:3999）
//       --serve（自己起服务；默认复用 --base 上已经跑着的）
//       --ffmpeg（ffmpeg 可执行文件路径；默认找 PATH）

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

const SCENE = opt('scene', 'dive-d16');
const FROM = Number(opt('from', 0));
const TO = Number(opt('to', 20));
const FPS = Number(opt('fps', 30));
const WIDTH = Number(opt('width', 1920));
const HEIGHT = Number(opt('height', 1080));
const CAM = opt('cam', null);
const PANEL = opt('panel', '0');
const OUT = path.resolve(ROOT, opt('out', `.cache/video/${SCENE}`));
const BASE = opt('base', 'http://127.0.0.1:3999');
const FFMPEG = opt('ffmpeg', null);

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!EDGE) throw new Error('找不到 Edge / Chrome：装一个，或改这个脚本里的 EDGE 列表');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const { default: puppeteer } = await import('puppeteer-core');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const q = new URLSearchParams({ scene: SCENE, paused: '1', panel: PANEL, quality: 'high' });
if (CAM) q.set('cam', CAM);
const url = `${BASE}/dev/render-demo.html?${q}`;
log(`打开 ${url}`);

// 自己起浏览器、再用 CDP 连上去（不用 puppeteer.launch）：
// 这台机器上已经有一个 Edge 在跑（SessionId 2），puppeteer 直接 launch 会被单例/配置文件判掉，
// 进程刚起来就退出（`Failed to launch the browser process: Code: 0`，stderr 还是空的）。
// 用一个独立的 --user-data-dir + 固定的调试端口起，puppeteer 只负责连，稳定得多。
const PORT = Number(opt('port', 9333));
const PROFILE = path.join(ROOT, '.cache', `edge-video-${process.pid}`);
fs.rmSync(PROFILE, { recursive: true, force: true });
const child = spawn(EDGE, [
  '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking', '--mute-audio',
  '--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--disable-lcd-text',
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank',
], { stdio: 'ignore', detached: false });
const stopBrowser = () => { try { child.kill(); } catch { /* ignore */ } try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stopBrowser);

let ws = null;
for (let i = 0; i < 60; i++) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    ws = v.webSocketDebuggerUrl;
    if (ws) break;
  } catch { /* 还没起来 */ }
  await sleep(500);
}
if (!ws) { stopBrowser(); throw new Error(`浏览器没有起来（调试端口 ${PORT} 无响应）`); }
log(`浏览器就绪：${ws}`);
const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') log('  [page error]', m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

// 等 demo 就绪（素材 34k 个文件，首次要几十秒）
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__demo && window.__demo.ready));
  if (ready) break;
  if (i % 10 === 0) log(`  等待渲染器就绪… ${i}s`);
  await sleep(1000);
}
const st0 = await page.evaluate(() => ({ ready: window.__demo?.ready, err: window.__demo?.error, scene: window.__demo?.scene?.stageId, duration: window.__demo?.scene?.duration }));
log('就绪:', JSON.stringify(st0));
if (!st0.ready) { await browser.close(); throw new Error('渲染器没有就绪：' + (st0.err || '超时')); }

// 把 demo 的播放循环冻住（paused=1 已暂停），逐帧 seek + 截图
const total = Math.max(1, Math.round((TO - FROM) * FPS));
log(`录制 ${FROM}s → ${TO}s，${FPS} fps，共 ${total} 帧`);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const t = FROM + i / FPS;
  await page.evaluate(async (tt) => {
    window.__demo?.seek?.(tt);
    // 等两帧：interp 把快照推进缓冲、视图按新的时间重画一次
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);
  const file = path.join(OUT, `f${String(i).padStart(5, '0')}.png`);
  await page.screenshot({ path: file, type: 'png' });
  if (i % 30 === 0) {
    const el = (Date.now() - t0) / 1000;
    log(`  ${i}/${total} 帧  ${(i / Math.max(0.001, el)).toFixed(1)} fps 导出  ${t.toFixed(2)}s`);
  }
}
await browser.close();
stopBrowser();
log(`截图完成：${total} 帧 → ${path.relative(ROOT, OUT)}（${((Date.now() - t0) / 1000).toFixed(1)} s）`);

// 编码
const ff = FFMPEG || [
  'ffmpeg', 'ffmpeg.exe',
  'D:\\ffmpeg\\ffmpeg.exe',
  path.join(ROOT, '.cache', 'ffmpeg.exe'),
].find((p) => { try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!ff) {
  log('没有 ffmpeg：帧已保留，装好后手动编码：');
  log(`  ffmpeg -framerate ${FPS} -i ${path.relative(ROOT, OUT)}/f%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4`);
} else {
  const outFile = path.join(OUT, `${SCENE}.mp4`);
  execFileSync(ff, ['-y', '-framerate', String(FPS), '-i', path.join(OUT, 'f%05d.png'), '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  log(`视频：${outFile}  (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}
