// tools/versions/act1autochess-v1_1.mjs — build profile of 盟约·上半 at launch, V1_1 (2025-11-14 16:00 → 2025-11-25 16:00;
// the maintainer's 「第一期」, docs/DATA.md "Official versions (M0)"). Every table is pinned to the launch commit 8303c922
// (Kengxxiao/ArknightsGameData, data version 25-11-12-14-06-12): activity_table with the first 20 strategies, the
// character / skill / module / range tables, the enemy tables (enemy_database changed again at 23c99d5d, so there is no
// separate enemy pin: V1_2's ee2cabff would leak V1_2 enemies) and the 43 level files.
// [ASSUMED] the launch day, BEFORE the 11-18 hotfix ea164ef70736ca2d1a356b3bf7b1cd7540960dc1. versionInfoDict still
// counts that hotfix as V1_1 (V1_2 starts 2025-11-25 16:00), and about 7 of V1_1's 11 days ran on it. Every change
// the build reads is in activity_table, among them: leader HP ×0.75 (Funny / Normal pools, −5…−12.5% Hard),
// modeFactorInfo.SINGLE 1.0 → 1.25, borrowCount 8 → 20, the enemy effects 攻坚装备II / III, 战场 m06 weight
// 40 → 60, m07 weight 40 → 5 and Hard modes only (taken out of both Normal modes), 墨浪 / 枯朽萃聚使徒 special-enemy
// weight 10 → 0, the leader weight of boss_2 (假想敌：铳) 5 → 2, 9 more enemies inactive in the Normal modes
// (one of them, 沉沙 enemy_1207_sfji, also in the Funny modes), and 拟态物质's effectDesc (eff_acarm069 and the golden
// eff_acgarm069: 初始干员; effects.json and the item descriptions change with it). The same wording changed in
// skill_table's two sktok_acarm069 descriptions, rows the build does not read; the client drag fix is not a build
// input. To build the hotfixed V1_1 instead, add
// `activity: 'ea164ef70736ca2d1a356b3bf7b1cd7540960dc1'` to the pins below and rebuild; then update the V1_1 row of
// test/data-versions.test.js (PINNED effects 279 → 281, the pins-keys assertion) and of the counts table in DESIGN §36.3.
// The rest is as tools/versions/act1autochess.mjs.

export default Object.freeze({
  id: 'act1autochess@V1_1',
  season: 'act1autochess',
  pins: Object.freeze({
    default: '8303c922f749f0dcf08e03671519421ef6a7748b',
  }),
  adapters: Object.freeze(['bondActiveType', 'selfBackupPreset']),
  research: 'docs/research/versions/act1autochess-v1_1/',
  tables: Object.freeze({ stock: null, shopDraft: null, tacticDraft: null, bountyDrafts: null }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 300, multi: 1000 }),
    rules: Object.freeze({ deployOrder: 'rowBottomUp', soloTimed: true, benchEquip: false, benchFullSwap: false, bossMirrorShare: false }),
  }),
  expect: Object.freeze({ bonds: 18, bands: 20, visibleNonDiy: 95, triggerDeviations: 'none' }),
});
