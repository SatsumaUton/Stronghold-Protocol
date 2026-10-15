import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { expandRecords } from '../../shared/plugins/records.js';
import { validateData } from '../../shared/plugins/validate.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { GameData } from '../../server/match/gamedata.js';
import { fixture, guard } from '../helpers/contentFixtures.js';
import { rosterOf } from '../../public/js/ui/loadoutModel.js';
import { chessPortraitUrl } from '../../public/js/ui/assetUrls.js';
import { mergeProgress } from '../../public/js/ui/gameLogic/shop.js';
import { diyRecord } from '../../shared/diy.js';
const base = getData(), pluginId = 'data-demo';
const ids = { normal: 'chess_x_data_demo_seed_b', elite: 'chess_x_data_demo_bloom' };

test('hidden explicit pairs remain addressable, absent from shop, handbook and recruit pools', () => {
  const op = guard();
  op.chess = { ...op.chess, hidden: true, ids };
  op.origin = { chessId: 'chess_char_1_02_a', charId: base.chess.chess_char_1_02_a.charId };
  op.art = { ref: 'char_102_texas', assets: { portrait: 'custom_portrait', spineGolden: 'custom_model', voice: 'custom_voice' } };
  const r = expandRecords(base, [op], { pluginId });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(validateData(r.data), []);
  const a = r.data.chess[ids.normal], b = r.data.chess[ids.elite];
  assert.equal(a.upgradeChessId, ids.elite);
  assert.equal(b.baseId, ids.normal);
  assert.deepEqual(a.origin, op.origin);
  assert.equal(a.assets.portrait, 'custom_portrait');
  assert.equal(b.assets.spine, 'custom_model');
  assert.equal(b.assets.voice, 'custom_voice');
  assert.equal(chessPortraitUrl({ chars: { custom_portrait: { portrait: '/custom.png' } } }, a), '/custom.png');
  assert.ok(!new GameData(r.data).visibleChess.includes(ids.normal));
  assert.ok(!rosterOf(Object.values(r.data.chess)).some(c => c.chessId === ids.normal));
  assert.ok(!r.data.backups.diy.ownedPool.includes(op.charId));
  for (const bond of op.chess.bonds) assert.ok(!r.data.bonds[bond].visibleMembers.includes(ids.normal));
  assert.equal(mergeProgress({ hand: [{ kind: 'chess', id: ids.normal }] }, ids.normal, id => r.data.chess[id]).copies, 1);
  assert.equal(diyRecord('chess_char_5_diy1_a', { charId: op.charId }, { data: r.data }), null);
  op.chess.hidden = false;
  const visible = expandRecords(base, [op], { pluginId });
  const d = diyRecord('chess_char_5_diy1_a', { charId: op.charId, skillIndex: 0 }, { elite: true, data: visible.data });
  assert.equal(d.assets.spine, 'custom_model');
  assert.equal(d.assets.voice, 'custom_voice');
});

test('strict checking and atomic expansion share metadata diagnostics', t => {
  const { put } = fixture(t);
  for (const [change, code] of [
    [r => { r.chess.hidden = 'yes'; }, 'PLUGIN_RECORD_HIDDEN'],
    [r => { r.chess.ids = { normal: ids.normal, elite: ids.normal }; }, 'PLUGIN_RECORD_PAIR'],
    [r => { r.chess.ids = { normal: ids.normal, elite: 'chess_x_other_no' }; }, 'PLUGIN_RECORD_PAIR'],
    [r => { r.art = { assets: { portrait: '../bad.png' } }; }, 'PLUGIN_RECORD_ART'],
    [r => { r.origin = { chessId: 'missing' }; }, 'PLUGIN_RECORD_ORIGIN'],
    [r => { r.origin = { chessId: 'chess_char_1_02_a', charId: 'char_103_angel' }; }, 'PLUGIN_RECORD_ORIGIN'],
  ]) {
    const op = guard(); change(op);
    const r = expandRecords(base, [op], { pluginId });
    assert.equal(r.data, base);
    assert.equal(r.problems[0].code, code);
    const dir = put(pluginId, { operators: ['op.json'] }, { 'op.json': op });
    const check = checkPluginFolder(dir, pluginId);
    assert.ok(check.issues.some(i => i.code === code), JSON.stringify(check));
  }
});
