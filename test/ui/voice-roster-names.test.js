// test/ui/voice-roster-names.test.js — 语音下载面板的干员名（维护者 2026-11-16）。
//
// 症状：面板里一部分干员显示成 `char_215_mantic` 这种文件代号。
// 原因：名字只从「本版 chess.json + backups」查，而语音包里 245 名干员中有 53 名不在本赛季卡池里。
// 修法：新增生成物 `data/char-names.json`（官方 character_table 的 name），面板兜底查它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const { voiceRoster } = await import('../../public/js/ui/voiceLibrary.js');
const { VOICE_TREES } = await import('../../public/js/voicePrefs.js');

const assets = readJson('data/assets.json');
const names = readJson('data/char-names.json');
const chess = readJson('data/chess.json');
const backups = readJson('data/backups.json');
const records = [
  ...(Array.isArray(chess) ? chess : Object.values(chess)),
  ...Object.values(backups.units || {}),
  ...Object.entries(backups.diy?.operators || {}).map(([charId, r]) => ({ ...r, charId })),
];

test('data/char-names.json 与数据源一致（跑 node tools/build-char-names.mjs 重新生成）', () => {
  assert.ok(existsSync(path.join(ROOT, 'data/char-names.json')), '生成物要在');
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-char-names.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('★ 每一个有语音的干员都显示成名字，不再显示文件代号', () => {
  const roster = voiceRoster(assets.audio, records, names);
  const ids = new Set(['voice', ...Object.values(VOICE_TREES)].flatMap((t) => Object.keys(assets.audio?.[t] || {})));
  assert.ok(roster.length >= ids.size, '名单要覆盖所有语音 id');
  const raw = roster.filter((r) => /^char_\d+_[a-z0-9_]+$/i.test(r.name));
  assert.deepEqual(raw.map((r) => r.charId), [], `仍然显示文件代号的：${raw.slice(0, 10).map((r) => r.charId).join(',')}`);
});

test('已知的几个：狮蝎 / 讯使 / 梅 之前是代号，现在是名字', () => {
  const roster = voiceRoster(assets.audio, records, names);
  const byId = new Map(roster.map((r) => [r.charId, r.name]));
  assert.equal(byId.get('char_215_mantic'), '狮蝎');
  assert.equal(byId.get('char_198_blackd'), '讯使');
  assert.equal(byId.get('char_133_mm'), '梅');
});

test('本版卡池里的名字仍然优先（不被代号表覆盖）', () => {
  const roster = voiceRoster({ voice: { char_102_texas: ['a.ogg'] } }, [{ charId: 'char_102_texas', name: '德州（本服改名）' }], { char_102_texas: '德克萨斯' });
  assert.equal(roster.find((r) => r.charId === 'char_102_texas')?.name, '德州（本服改名）');
});

test('没有代号表时退回原来的行为（不抛错）', () => {
  const roster = voiceRoster({ voice: { char_215_mantic: ['a.ogg'] } }, [], null);
  assert.equal(roster[0].name, 'char_215_mantic');
});
