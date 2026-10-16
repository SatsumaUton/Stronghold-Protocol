import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleLine, roomPluginFacts, pluginTagText } from '../../public/js/ui/pluginTag.js';
import { pieceBondIds, grantedBonds } from '../../public/js/ui/gameLogic/bonds.js';
import { equipReplaces } from '../../public/js/ui/gameLogic/placement.js';
import { replaceRequest } from '../../public/js/ui/equipReplace.js';

test('room and match summaries expose the active rules in words; vanilla adds no text', () => {
  assert.equal(ruleLine(null), '');
  const room = { content: { vanilla: false, plugins: [{ id: 'rule-demo', class: 'content' }], rules: { unequip: 'allow' } } };
  assert.deepEqual(roomPluginFacts(room).rules, { unequip: 'allow' });
  assert.equal(ruleLine(room.content.rules), '规则：可以卸下装备');
  assert.match(pluginTagText(room), /可以卸下装备/);
  assert.equal(pluginTagText({}), '原版');
});

test('client plus pairing and replacement options follow the same slot policy', () => {
  const records = { morph: { canGiveBond: true }, hammer: { giveBondId: 'one' }, shield: { giveBondId: 'two' }, incoming: {} };
  const get = (id) => records[id];
  const items = [{ id: 'morph', uid: 1 }, { id: 'hammer', uid: 2 }, { id: 'shield', uid: 3 }];
  assert.deepEqual(grantedBonds(items, get), ['one', 'two']);
  assert.deepEqual(pieceBondIds({ bonds: ['base'] }, items, get, 'plus'), ['base', 'one']);
  const target = { uid: 9, kind: 'chess', id: 'wearer', items };
  const incoming = { uid: 4, kind: 'item', id: 'incoming' };
  const pieces = new Map([[9, { piece: target }], [4, { piece: incoming }], [5, { piece: { id: 'morph' } }]]);
  const ctx = { pieces, getItem: get, morphMode: 'plus' };
  assert.equal(equipReplaces(ctx, 4, target), true);
  assert.equal(equipReplaces(ctx, 5, target), false, 'morph never requests replacement');
  const request = replaceRequest(ctx, { t: 'g.equip', fields: { itemUid: 4, targetUid: 9 }, confirmReplace: true }, () => null, get);
  assert.deepEqual(request.options.map((it) => it.uid), [2, 3], 'morph is never offered for destruction');
  target.items = items.slice(0, 2);
  assert.equal(equipReplaces(ctx, 4, target), false, 'one real slot is still free');
});
