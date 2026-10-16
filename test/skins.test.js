// 干员皮肤 (docs/SKINS.md) — the whole path, in one file: the `room.skins` wire shape, the lobby → Match → PlayerState
// chain, what the renderer resolves, and the client's picker rules.
//
// The things this suite exists to pin, because each of them is silent when it breaks:
//   * the KEY IS AN OPERATOR (charId), not a chess id and not a base id. `chars[<charId>].skins` is where the composed
//     asset manifest groups them (docs/PLUGINS.md §9), so a selection keyed any other way resolves to nothing and the
//     whole feature draws the default model while every test that only checks "the field is on the wire" still passes.
//   * the skinId is NOT an `isId`: an official key carries `@` and `#` (`char_002_amiya@winter#1`), so the generic id
//     validator would refuse every real one.
//   * the choice is PUBLIC: it travels in `m.public` for teammates, and only the lobby seat that sent it changes.
//   * the OWN pieces draw it BEFORE the first battle: the own prep board / hand / 临时整备区 read `piece.skin` (render/app.js
//     pieceInfo) and rebuild a piece whose appearance changed. The renderer itself needs a canvas and a GPU (the browser
//     suites), so that rule is pinned on its source, the way test/ui/standin-ui.test.js and test/ui/diy-ui.test.js pin
//     pieceInfo's other reads — a regression there is silent: the board simply draws the default model.
//   * the client never sends more than the wire accepts (SKIN_LIMITS.entries): the server refuses an over-long selection
//     as a WHOLE (BAD_MSG), so the cap is applied where the selection is read, not where it is shown.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSkinId, isSkinSelection, validateC2S, SKIN_LIMITS } from '../shared/protocol.js';
import { Lobby } from '../server/lobby.js';
import { makeMatch, DATA } from './match/harness.js';
import { Battle } from '../server/sim/Battle.js';
import { avatarUrl, portraitUrl, illustUrl, spineEntry, hasBackSpine, unitPictureUrl, skinsOf, skinHasModel } from '../public/js/assets.js';
import { createStore } from '../public/js/store.js';
import { parseStoredSkins, SKINS_KEY, SKINS_SYNC_KEY } from '../public/js/ui/skins.js';
import { installSkinsSync } from '../public/js/ui/loadoutSync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A real operator of the mode's roster, and one of its official skin keys. */
const OPERATOR = 'char_498_inside';
const OTHER = 'char_003_kalts';
const SKIN = 'char_498_inside@kitchen#2';
const SKIN_OTHER = 'char_003_kalts@boc#6';

/** A composed manifest as the browser sees one: the installation's art with one cosmetic plugin's skins laid over it. */
const MANIFEST = {
  chars: {
    [OPERATOR]: {
      avatar: '/a/inside.png', avatarE2: '/a/inside_2.png', portrait: '/p/inside_1.png', portraitE2: '/p/inside_2.png',
      illust: '/i/inside.png',
      spine: { front: { skel: '/s/inside/front.skel', atlas: '/s/inside/front.atlas', textures: ['/s/inside/front.png'], anims: { idle: 'Idle' } } },
      skins: {
        [SKIN]: {
          name: '厨房', group: '罗德厨房',
          avatar: '/a/inside_kitchen.png', portrait: '/p/inside_kitchen_1.png', illust: '/i/inside_kitchen.png',
          spine: {
            front: { skel: '/s/inside_kitchen/front.skel', atlas: '/s/inside_kitchen/front.atlas', textures: ['/s/inside_kitchen/front.png'], anims: { idle: 'Idle' } },
            back: { skel: '/s/inside_kitchen/back.skel', atlas: '/s/inside_kitchen/back.atlas', textures: ['/s/inside_kitchen/back.png'], anims: { idle: 'Idle' } },
          },
        },
        // a skin the plugin gives art to, with no model: shown nowhere, offered nowhere
        'char_498_inside@art#9': { name: '只有画', group: '', avatar: '/a/only_art.png' },
      },
    },
    // an operator whose plugin writes a skin for another operator's key plus a plain `illust` and nothing else
    [OTHER]: { avatar: '/a/kalts.png', portrait: '/p/kalts_1.png', illust: '/i/kalts.png' },
  },
};

describe('皮肤: the wire shape of room.skins', () => {
  test('isSkinId accepts the keys the official skin table produces (NOT isId: they carry @ and #)', () => {
    for (const id of [SKIN, 'char_002_amiya@winter#1', 'char_002_amiya#1+', 'char_1039_thorn2@marthe#9']) {
      assert.ok(isSkinId(id), `should accept ${id}`);
    }
    for (const bad of ['', ' ', 'a b', 'char/1', 'char\\1', '<script>', 'x'.repeat(SKIN_LIMITS.idLen + 1), 42, null, undefined, {}, []]) {
      assert.ok(!isSkinId(bad), `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('isSkinSelection: a map of ≤ 160 operator ids → skinIds, and nothing else', () => {
    assert.ok(isSkinSelection({ [OPERATOR]: SKIN }));
    assert.ok(isSkinSelection({}), 'an empty selection clears every skin');
    assert.ok(!isSkinSelection(null));
    assert.ok(!isSkinSelection([]));
    assert.ok(!isSkinSelection([SKIN]), 'not a list');
    assert.ok(!isSkinSelection({ [OPERATOR]: '' }));
    assert.ok(!isSkinSelection({ [OPERATOR]: 'bad id' }));
    assert.ok(!isSkinSelection({ [OPERATOR]: 42 }));
    assert.ok(!isSkinSelection({ 'char 1': SKIN }));
    const big = {};
    for (let i = 0; i <= SKIN_LIMITS.entries; i++) big[`char_${i}_x`] = SKIN;
    assert.ok(!isSkinSelection(big), `more than ${SKIN_LIMITS.entries} entries`);
    // A key of the wrong KIND is not refused here: `isId` is a shape check, and `chess_char_1_01_a` has the shape of an
    // operator id. It is harmless — `chars['chess_char_1_01_a']` of the manifest has no `skins` map, so the entry
    // resolves to nothing and the piece draws the default model. That is what makes the shallow wire check safe, and it
    // is why the error a wrong key produces is not an error at all.
    assert.ok(isSkinSelection({ [OPERATOR]: SKIN, chess_char_1_01_a: SKIN }));
  });

  test('validateC2S: room.skins needs a selection, and room.skin.install does not exist', () => {
    assert.equal(validateC2S({ t: 'room.skins', skins: { [OPERATOR]: SKIN } }), null);
    assert.equal(validateC2S({ t: 'room.skins', skins: {} }), null);
    assert.ok(validateC2S({ t: 'room.skins' }), 'missing field');
    assert.ok(validateC2S({ t: 'room.skins', skins: SKIN }), 'not a map');
    assert.ok(validateC2S({ t: 'room.skins', skins: { [OPERATOR]: 'has space' } }), 'bad skin id');
    // the install channel is NOT ported: an unauthenticated "make the server download and rewrite shared data" message
    // is exactly what upstream closed (#652)
    assert.ok(validateC2S({ t: 'room.skin.install', skinId: SKIN }), 'the installer message must not be routable');
  });
});

describe('皮肤: the lobby seat and the match', () => {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, skins: { [OPERATOR]: SKIN } },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true, skins: { [OPERATOR]: SKIN } },
  ];

  test('the seat carries the selection into PlayerState; a bot is refused whatever its seat says', () => {
    const h = makeMatch({ mode: 'coop', seats });
    assert.deepEqual(h.ps('p_0').skins, { [OPERATOR]: SKIN });
    assert.deepEqual(h.ps('ai_0').skins, {}, 'setSkins refuses bots');
  });

  test('Match.setSkins: only the caller\'s own seat, any phase, and the public view carries it', () => {
    const h = makeMatch({ mode: 'coop', seats });
    // a chess-shaped key is kept by the wire check (it looks like an operator id) but resolves to nothing, so it is
    // inert rather than destructive — the entries beside it still work
    assert.equal(h.m.setSkins('p_0', { [OPERATOR]: SKIN, 'chess_char_1_01_a': SKIN }).ok, true);
    assert.deepEqual(h.ps('p_0').skins, { [OPERATOR]: SKIN, 'chess_char_1_01_a': SKIN });
    assert.equal(spineEntry(MANIFEST, OPERATOR, { skin: 'chess_char_1_01_a' }).skel, '/s/inside/front.skel',
      'a key the manifest does not hold resolves to nothing: the operator\'s own model');
    assert.equal(h.m.setSkins('ai_0', { [OPERATOR]: SKIN }).error, 'NOT_IN_ROOM', 'a bot has no seat to change');
    assert.equal(h.m.setSkins('nobody', { [OPERATOR]: SKIN }).error, 'NOT_IN_ROOM');
    const me = h.m.publicView().players.find((p) => p.playerId === 'p_0');
    assert.deepEqual(me.skins, { [OPERATOR]: SKIN, 'chess_char_1_01_a': SKIN });
    const bot = h.m.publicView().players.find((p) => p.playerId === 'ai_0');
    assert.equal(bot.skins, undefined, 'omitted when empty, so a vanilla payload is byte-identical');
    assert.equal(h.m.setSkins('p_0', {}).ok, true, 'clearing is a valid selection');
    assert.equal(h.m.publicView().players.find((p) => p.playerId === 'p_0').skins, undefined);
  });

  test('a mid-match change is marked public (a teammate sees it on the next m.public)', () => {
    const h = makeMatch({ mode: 'coop', seats });
    h.start();
    let publicMarked = 0;
    const prev = h.m.markPublic;
    h.m.markPublic = () => { publicMarked++; return prev.call(h.m); };
    assert.equal(h.m.setSkins('p_0', { [OPERATOR]: SKIN }).ok, true);
    assert.equal(publicMarked, 1);
    assert.deepEqual(h.m.publicView().players.find((p) => p.playerId === 'p_0').skins, { [OPERATOR]: SKIN });
  });

  test('a reconnecting player keeps the choice (the resync replays m.public)', () => {
    const h = makeMatch({ mode: 'coop', seats });
    h.start();
    h.m.setSkins('p_0', { [OPERATOR]: SKIN });
    h.sent.length = 0;
    h.m.onReconnect('p_0');
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub, 'the reconnect resends m.public');
    assert.deepEqual(pub.players.find((p) => p.playerId === 'p_0').skins, { [OPERATOR]: SKIN });
  });

  test('every view of a piece carries the skin, keyed by the operator of the piece', () => {
    const h = makeMatch({ mode: 'coop', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, skins: { [OPERATOR]: SKIN } }] });
    const ps = h.ps('p_0');
    // the base chess and its elite form are the SAME operator: one entry covers both, which is the whole reason the key
    // is a charId (data/chess.json: assets.spine === charId for 258 of the 266 records)
    const base = ps.newPiece('chess', 'chess_char_1_01_a');
    const golden = ps.newPiece('chess', 'chess_char_1_01_b');
    assert.equal(DATA.chess['chess_char_1_01_a'].charId, OPERATOR);
    assert.equal(DATA.chess['chess_char_1_01_b'].charId, OPERATOR);
    assert.equal(ps.pieceView(base).skin, SKIN);
    assert.equal(ps.pieceView(golden).skin, SKIN, 'the elite keeps the appearance chosen before the merge');
    for (const u of ps.battleInput({ side: 'L' }).units) assert.equal(u.skin, SKIN, 'battleInput carries it into the sim');
    // a 自选 slot's own record has no charId; its piece wears its PICK's operator (server/match/player/round.js)
    const slot = ps.newPiece('chess', 'chess_char_6_diy1_a');
    assert.equal(DATA.chess['chess_char_6_diy1_a'].charId, null);
    assert.ok(!ps.pieceView(slot).skin, 'without a pick there is no operator, so no skin');
  });

  test('the sim puts the skin on UnitInfo (unit → snapshot) and drops the key when there is none', () => {
    const h = makeMatch({ mode: 'coop', seats });
    const b = new Battle({
      fieldId: 'n:p_0', kind: 'normal', data: DATA, log: { warn() {}, error() {}, info() {} },
      players: [{ playerId: 'p_0', units: [{ kind: 'chess', chessId: 'chess_char_1_01_a', row: 9, col: 0, skin: SKIN }] }],
      spawns: [],
    });
    b.start();
    const units = b.fieldMeta().units;
    const mine = units.find((u) => u.defId === 'chess_char_1_01_a');
    assert.equal(mine.skin, SKIN);
    // `undefined`, not null: JSON.stringify drops it, so an install with no skin is byte-identical to before the feature
    const plain = new Battle({
      fieldId: 'n:p_0', kind: 'normal', data: DATA, log: { warn() {}, error() {}, info() {} },
      players: [{ playerId: 'p_0', units: [{ kind: 'chess', chessId: 'chess_char_1_01_a', row: 9, col: 0 }] }],
      spawns: [],
    });
    plain.start();
    const other = plain.fieldMeta().units.find((u) => u.defId === 'chess_char_1_01_a');
    assert.equal(other.skin, undefined);
    assert.ok(!JSON.stringify(other).includes('"skin"'), 'no key on the wire at all');
  });
});

describe('皮肤: the client resolves the appearance (assets.js)', () => {
  test('spineEntry asks for the skin, falls back to the operator\'s own model, and knows Front from Back', () => {
    assert.equal(spineEntry(MANIFEST, OPERATOR, { skin: SKIN }).skel, '/s/inside_kitchen/front.skel');
    assert.equal(spineEntry(MANIFEST, OPERATOR, { skin: SKIN, back: true }).skel, '/s/inside_kitchen/back.skel');
    assert.equal(spineEntry(MANIFEST, OPERATOR).skel, '/s/inside/front.skel');
    // an unknown / missing / art-only skin: the operator's own model, never null
    assert.equal(spineEntry(MANIFEST, OPERATOR, { skin: 'gone' }).skel, '/s/inside/front.skel');
    assert.equal(spineEntry(MANIFEST, OPERATOR, { skin: 'char_498_inside@art#9' }).skel, '/s/inside/front.skel');
    // a skin of ANOTHER operator is not this operator's: there is no such skin under `chars[OTHER].skins`, and OTHER has
    // no model of its own in this manifest, so nothing resolves at all
    assert.equal(spineEntry(MANIFEST, OTHER, { skin: SKIN }), null);
    assert.equal(spineEntry(MANIFEST, OTHER, { skin: SKIN_OTHER }), null);
  });

  test('avatarUrl / portraitUrl / illustUrl prefer the skin and fall back to the operator\'s art, never to a placeholder', () => {
    assert.equal(avatarUrl(MANIFEST, OPERATOR, { skin: SKIN }), '/a/inside_kitchen.png');
    assert.equal(avatarUrl(MANIFEST, OPERATOR, { skin: 'gone' }), '/a/inside.png');
    assert.equal(avatarUrl(MANIFEST, OPERATOR), '/a/inside.png');
    assert.equal(portraitUrl(MANIFEST, OPERATOR, { skin: SKIN }), '/p/inside_kitchen_1.png');
    assert.equal(portraitUrl(MANIFEST, OPERATOR, { skin: 'gone' }), '/p/inside_1.png');
    assert.equal(illustUrl(MANIFEST, OPERATOR, { skin: SKIN }), '/i/inside_kitchen.png');
    assert.equal(illustUrl(MANIFEST, OPERATOR), '/i/inside.png');
    assert.equal(illustUrl(MANIFEST, OTHER, { skin: SKIN }), '/i/kalts.png', 'a skin of another operator: the operator\'s own');
    // an art-only skin still resolves its own picture (the picker shows it) but has no model
    assert.equal(avatarUrl(MANIFEST, OPERATOR, { skin: 'char_498_inside@art#9' }), '/a/only_art.png');
    assert.equal(unitPictureUrl(MANIFEST, OPERATOR, { skin: SKIN }), '/a/inside_kitchen.png');
  });

  test('hasBackSpine asks the skin, then the operator', () => {
    assert.equal(hasBackSpine(MANIFEST, OPERATOR, SKIN), true);
    assert.equal(hasBackSpine(MANIFEST, OPERATOR), false, 'the operator\'s own model has no Back in this manifest');
    assert.equal(hasBackSpine(MANIFEST, OPERATOR, 'gone'), false);
  });

  test('skinsOf / skinHasModel: what the picker offers is what the renderer can wear', () => {
    assert.deepEqual(Object.keys(skinsOf(MANIFEST, OPERATOR)), [SKIN, 'char_498_inside@art#9']);
    assert.deepEqual(skinsOf(MANIFEST, OTHER), {}, 'no skins: the picker draws no section');
    assert.equal(skinHasModel(skinsOf(MANIFEST, OPERATOR)[SKIN]), true);
    assert.equal(skinHasModel(skinsOf(MANIFEST, OPERATOR)['char_498_inside@art#9']), false);
  });
});

describe('皮肤: the own prep view carries the choice (render/app.js)', () => {
  /**
   * The renderer's source: the prep view needs a canvas, a GPU and PIXI, so its rules are pinned on the text the way
   * test/ui/standin-ui.test.js and test/ui/diy-ui.test.js pin pieceInfo's other reads. The extracted body is one
   * top-level function of the factory (its signature up to the line that closes it at function indentation), so an
   * assertion cannot be satisfied by some other function of a 2200-line file.
   */
  const APP_SRC = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
  const appFunctionBody = (signature) => {
    const i = APP_SRC.indexOf(signature);
    assert.ok(i >= 0, `public/js/render/app.js no longer declares ${signature}`);
    const end = APP_SRC.indexOf('\n  }', i);
    assert.ok(end > i, `${signature} is not closed at function indentation`);
    return APP_SRC.slice(i, end);
  };

  test('pieceInfo hands the piece\'s skin to the view (server/match/player/views.js pieceView sends it)', () => {
    const body = appFunctionBody('function pieceInfo(piece, area) {');
    assert.match(body, /\n      skin: piece\.skin \|\| null,/,
      'the op branch must carry it: without it the prep board, the hand and the 临时整备区 draw the default model until '
      + 'the first battle, while a teammate scouting the same board already sees the skin');
  });

  test('the skin is part of the prep signature, so a change rebuilds the piece\'s view (setPrep)', () => {
    const line = APP_SRC.split('\n').find((l) => l.includes('const sig = `${info.kind}'));
    assert.ok(line, 'setPrep still signs its prep pieces');
    // the template the 补位 suite pins verbatim (test/ui/standin-ui.test.js) is not rewritten by this feature …
    assert.match(APP_SRC, /const sig = `\$\{info\.kind\}\|\$\{info\.defId\}\|\$\{info\.golden \? 1 : 0\}\|\$\{info\.spine \|\| ''\}`/,
      'the pinned template stays as it is; the appearance is appended after it');
    // … the appearance is appended to it, so switching it changes the signature and the view is rebuilt instead of
    // keeping the model it was built on (render/app.js dropView)
    assert.ok(line.includes("(info.skin ? `|${info.skin}` : '')"), 'a changed skin must change the signature');
  });

  test('a boss pair\'s read-only pieces follow 设置「显示其他玩家的皮肤」 too (syncReadOnlyPrepUnits)', () => {
    const body = appFunctionBody('function syncReadOnlyPrepUnits(units) {');
    assert.match(body, /info\.skin = shownSkin\(info\);/,
      'the partner half is another seat\'s board: the switch must reach it like it reaches a battle unit (applyInfo)');
    const line = body.split('\n').find((l) => l.includes('const sig = `${info.defId}'));
    assert.ok(line && line.includes("|${info.skin || ''}"), 'a partner switching mid-match rebuilds the piece');
  });
});

describe('皮肤: the client never sends more than the wire accepts', () => {
  /** A selection past SKIN_LIMITS.entries, shaped like one a hand-edited localStorage could hold. */
  const overLimit = () => {
    const m = {};
    for (let i = 0; i < SKIN_LIMITS.entries + 24; i++) m[`char_${i}_x`] = `${OPERATOR}@s#${i}`;
    return m;
  };

  test('parseStoredSkins keeps at most SKIN_LIMITS.entries pairs, in insertion order', () => {
    const big = overLimit();
    assert.equal(isSkinSelection(big), false, 'the raw map is what the server refuses as a whole');
    const kept = parseStoredSkins(big);
    assert.equal(Object.keys(kept).length, SKIN_LIMITS.entries);
    assert.deepEqual(Object.keys(kept), Object.keys(big).slice(0, SKIN_LIMITS.entries));
    assert.ok(isSkinSelection(kept), 'what it yields is what the server stores');
    // a pair that is not a pair does not spend the budget (the first 160 KEPT entries are what fit)
    const junk = { '': 'x', a: '', b: 7, c: null };
    for (let i = 0; i < SKIN_LIMITS.entries; i++) junk[`char_${i}_x`] = `${OPERATOR}@s#${i}`;
    assert.equal(Object.keys(parseStoredSkins(junk)).length, SKIN_LIMITS.entries);
  });

  test('room.skins goes out at the limit however the store was filled (installSkinsSync)', async () => {
    const target = createStore({ [SKINS_KEY]: overLimit(), [SKINS_SYNC_KEY]: 'idle' });
    const net = {
      status: 'online', sent: [], on: () => () => {},
      request: async (t, body) => { net.sent.push({ t, ...body }); return { t: 'ok' }; },
    };
    const sync = installSkinsSync({ net, target });
    try {
      await sync.flush();
    } finally { sync.dispose(); }
    assert.equal(net.sent.length, 1, 'one room.skins');
    assert.equal(net.sent[0].t, 'room.skins');
    assert.equal(Object.keys(net.sent[0].skins).length, SKIN_LIMITS.entries);
    assert.ok(isSkinSelection(net.sent[0].skins), 'a payload the server stores instead of refusing (BAD_MSG)');
    assert.equal(target.get()[SKINS_SYNC_KEY], 'synced');
  });
});

describe('皮肤: the install channel is not in this branch', () => {
  test('no server module downloads a skin, and no route writes data/assets.json', () => {
    const lobby = readFileSync(path.join(ROOT, 'server/lobby.js'), 'utf8');
    assert.ok(!/skinInstall|skin\.install|skins\.changed|installSkinInBackground/.test(lobby),
      'the installer route of feat/skins must not be ported (upstream #652 closed it: an unauthenticated request let any client make the server download files and rewrite the shared manifest)');
    assert.ok(!/install-skins/.test(lobby), 'and it must not reach the CLI installer either');
    // the overlay is the only source of an appearance: nothing is read from data/skins*.json
    const skins = readFileSync(path.join(ROOT, 'public/js/ui/skins.js'), 'utf8');
    assert.ok(!/skinsLocal|skins-local|data\/skins\.json|'skins'\)\.chars/.test(skins), 'the client reads the composed manifest, not a catalogue file');
  });
});
