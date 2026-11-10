#!/usr/bin/env node
// tools/record-dive.mjs — 录一局**深渊回响**的真实战斗，格式与 tools/record-battle.mjs 完全一致
// （public/dev/render-demo.html 能直接播，见它的 recordingScene）。宣传片 / 演示用的素材来源。
//
// 与 record-battle 的区别：那边录的是原版的普通战 / 联防 / 最终攻势，**没有深潜**。
// 这边真的建一个 `variant: 'deepecho'` 的 Match，跳到指定回合（`startRound`），
// 用 Match 自己算出来的 `_normalOpts(ps)` 当战斗参数 —— 于是侵蚀词条（`flags.echoRules.words`）、
// 深层敌人的血量 / 护甲 / 护盾、精英数量，全都是**线上那一局真会发生的**，不是手搓的。
//
// 用法：
//   node tools/record-dive.mjs                        # 默认 30 / 71 / 120 层
//   node tools/record-dive.mjs --depths 20,45,71      # 指定深度
//   node tools/record-dive.mjs --out public/dev/recordings --seed 7 --difficulty HARD
//   node tools/record-dive.mjs --max 40               # 每个场景最多录多少游戏秒
//
// 产物：`<out>/dive-d<深度>.json` + 合并进 `<out>/index.json`（已存在的条目保留）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { getData } from '../server/data.js';
import { getDefaultSource } from '../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  opt[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}

const OUT = path.resolve(ROOT, typeof opt.out === 'string' ? opt.out : 'public/dev/recordings');
const SEED = Number(opt.seed ?? 7) >>> 0;
const DIFFICULTY = String(opt.difficulty || 'HARD').toUpperCase();
const MAX_SECONDS = Number(opt.max ?? 60);
const DEPTHS = String(opt.depths || '30,71,120').split(',').map((n) => Number(n.trim())).filter((n) => n > 0);

const quiet = { info() {}, debug() {}, warn() {}, error() {} };
const data = getData({ log: quiet });
const ds = getDefaultSource();

/** 按名字找棋子的 id（`名字*` = 精英形态），与 tools/record-battle.mjs 同一套规则。 */
function chessByName(name, golden = false) {
  for (const id of ds.chessIds()) {
    const r = ds.rawChess(id);
    if (r && r.name === name && !r.isGolden && r.visible !== false) return golden ? (r.goldenId || id.replace(/_a$/, '_b')) : id;
  }
  throw new Error(`unknown chess ${name}`);
}

/** 在可部署格上摆一套阵容：近战靠前、远程上高台（同 record-battle）。 */
function lineup(stageId, names, uid0 = 1) {
  const st = data.stages?.[stageId] ?? ds.getStage?.(stageId);
  const dt = st?.deployTiles?.normal || { melee: [], rangedOnly: [] };
  const melee = [...dt.melee].sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  const ranged = [...(dt.rangedOnly || [])];
  const taken = new Set();
  const units = [];
  let uid = uid0;
  for (const raw of names) {
    const golden = raw.endsWith('*');
    const name = golden ? raw.slice(0, -1) : raw;
    const chessId = chessByName(name, golden);
    const rec = ds.rawChess(chessId);
    const pool = rec?.position === 'MELEE' ? melee : [...ranged, ...melee.slice().reverse()];
    const tile = pool.find(([r, c]) => !taken.has(`${r},${c}`));
    if (!tile) continue;
    taken.add(`${tile[0]},${tile[1]}`);
    units.push({ uid: uid++, kind: 'chess', chessId, row: tile[0], col: tile[1] });
  }
  return units;
}

/** 深潜阵容：越深越要靠精英与高台，和玩家真到那层时的选择接近。 */
const LINEUP = ['塞雷娅*', '山*', '史尔特尔*', '夕*', '缇缇', '烛煌*', '铃兰', '异客'];

const KIND_TITLE = { normal: '常规战', unite: '联防', boss: '最终攻势', hidden: '隐秘核心' };

/**
 * 录一个深度：建 Match → 跳回合 → 拿真实 opts → 用 spec 跑一场 → 每 3 tick 存一帧。
 * @param {number} depth 深潜深度（第几层）
 * @returns {object|null} 与 record-battle 同形的录像对象
 */
function recordDepth(depth) {
  const sched = new VirtualScheduler();
  const seats = [0, 1].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));
  const m = new Match({
    roomCode: 'DIVE', mode: 'coop', difficulty: DIFFICULTY, seats, seed: SEED, data, scheduler: sched,
    variant: 'deepecho', log: quiet, send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  try {
    m.start();
    // 深潜从第 1 回合开始（echoDiveStart = 1），所以「第几层」就是回合号
    const round = depth;
    m.round = round;
    m.startRound(round);
    for (let i = 0; i < 4000 && !m.wave; i++) sched.advance(100);
    if (!m.wave) { console.warn(`  ! 深度 ${depth}：这一层没有普通波次（boss 层？），跳过`); return null; }

    const ps = [...m.players.values()][0];
    const opts = m._normalOpts(ps);
    const words = opts.flags?.echoRules?.words || [];
    const units = lineup(opts.stageId, LINEUP);
    const spec = buildBattleSpec({
      ...opts,
      battleId: `dive-${depth}`,
      fieldId: `n:${ps.playerId}`,
      kind: 'normal',
      players: [{ playerId: ps.playerId, seat: 0, side: 'L', colOffset: 0, units }],
    });
    const b = createBattleFromSpec(spec, m.ds ?? ds);
    const frames = [];
    let field = null;
    let ticks = 0;
    const maxT = Math.min(MAX_SECONDS, (Number(opts.timeLimit) || 60) + 1);
    while (!b.finished) {
      b.step();
      ticks++;
      if (!field) field = b.fieldMeta();
      if (ticks % 3 === 0) frames.push({ snap: b.snapshot(), ev: b.drainEvents() });
      if (b.time >= maxT) b.forceEnd('timeout');
    }
    const tail = { snap: b.snapshot(), ev: b.drainEvents() };
    const last = frames[frames.length - 1];
    if (!last || tail.snap.t > last.snap.t) frames.push(tail);
    else last.ev.push(...tail.ev);

    const r = b.result();
    const counts = {};
    for (const f of frames) for (const e of f.ev) counts[e[0]] = (counts[e[0]] || 0) + 1;
    const name = `dive-d${depth}`;
    return {
      version: 1, name, title: `深渊回响 · 深度 ${depth} · ${KIND_TITLE.normal}`,
      kind: 'normal', stageId: opts.stageId, modeId: opts.modeId, round, wave: m.wave.templateId,
      tick: 1 / 30, snapEvery: 3, duration: Math.round(b.time * 100) / 100, recordedAt: new Date().toISOString().slice(0, 10),
      // 宣传片要用的元信息（render-demo 忽略不认识的字段）
      dive: { depth, difficulty: DIFFICULTY, words: words.map((w) => ({ name: w.name, desc: w.desc || '' })) },
      field,
      frames,
      result: {
        reason: r.reason, time: Math.round(r.time * 10) / 10, killed: r.killed, total: r.total,
        bossHpLeft: r.bossHpLeft ?? null,
        perPlayer: Object.fromEntries(Object.entries(r.perPlayer || {}).map(([k, v]) => [k, { killed: v.killed, total: v.total, leaked: v.leaked?.length ?? 0, deaths: v.deaths }])),
        events: counts, errors: b.errors?.length ?? 0,
      },
    };
  } finally {
    try { m.dispose(); } catch { /* ignore */ }
  }
}

fs.mkdirSync(OUT, { recursive: true });
// 索引写成**单独一份** `extra.json`：`index.json` 是公开仓库跟踪的文件，
// 深潜录像由本脚本按需生成、且**不进公开仓库**（.gitignore：public/dev/recordings/extra.json 与 dive-d*.json）。
// render-demo 会额外读这一份（见 public/dev/render-demo.js）。
const indexFile = path.join(OUT, 'extra.json');
const prev = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
const index = [];

for (const depth of DEPTHS) {
  const t0 = performance.now();
  const rec = recordDepth(depth);
  if (!rec) continue;
  const json = JSON.stringify(rec);
  fs.writeFileSync(path.join(OUT, `${rec.name}.json`), json);
  const maxUnits = Math.max(...rec.frames.map((f) => f.snap.units.length));
  index.push({
    name: rec.name, title: rec.title, kind: rec.kind, stageId: rec.stageId, duration: rec.duration,
    frames: rec.frames.length, maxUnits, file: `${rec.name}.json`, bytes: json.length,
    depth, words: rec.dive.words.map((w) => w.name),
    result: { reason: rec.result.reason, killed: rec.result.killed, total: rec.result.total },
  });
  console.log(`${rec.name.padEnd(12)} 深度 ${String(depth).padStart(3)}  ${rec.duration.toFixed(1).padStart(5)} s  frames ${String(rec.frames.length).padStart(4)}  units≤${String(maxUnits).padStart(3)}  ${(json.length / 1024).toFixed(0).padStart(5)} KB  ${rec.result.killed}/${rec.result.total}  词条 ${rec.dive.words.map((w) => w.name).join('·')}  (${(performance.now() - t0).toFixed(0)} ms)`);
}

// 没重录的旧条目保留（同一次运行里重复跑 --depths 的并集）
for (const p of prev) if (p && !index.some((x) => x.name === p.name) && fs.existsSync(path.join(OUT, p.file || `${p.name}.json`))) index.push(p);
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
console.log(`wrote ${index.length} dive recordings → ${path.relative(ROOT, indexFile)}`);
