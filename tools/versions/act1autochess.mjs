// tools/versions/act1autochess.mjs — build profile of 盟约·上半 in its final state V1_2 (2025-11-25 → 2025-12-12; docs/DATA.md
// "Official versions (M0)"). The master activity_table holds no pure 上半 any more: commit 12e0a020 (2026-03-10) migrated
// act1autochess to the 下半 schema and replaced the shared autoChessData, so every table is pinned to a commit of the
// season (Kengxxiao/ArknightsGameData, zh_CN/gamedata; cached in .cache/gamedata@<sha>/).
//   default 21b1f240 (2025-12-05, 上半 final): activity_table — its autochess sections are byte-identical to fdf34ff5 and
//           to every commit up to 3421eaff —, character / skill / uniequip / battle_equip, range_table (equal to the
//           range_table of dcc057f6, 2025-09-04) and the level files (levels/activities/act1autochess/* equal those of
//           23c99d5d, the V1_2 update)
//   enemy   ee2cabff (2025-12-05 17:15): enemy_handbook_table and enemy_database, the last change inside the season
// [ASSUMED] every field the data does not hold falls back to 下半: the rules (inert in M0, read in M2), the research
// (docs/research/ until docs/research/versions/act1autochess/ exists) and the 下半-measured tables, which are left out.

export default Object.freeze({
  id: 'act1autochess',
  season: 'act1autochess',
  pins: Object.freeze({
    default: '21b1f240817dafe486653adda7a5085ff8a1ba17',
    enemy: 'ee2cabffd45de01548cc6dceb23129ce93ac7926',
  }),
  // 上半's bondInfoDict has activeType / isActiveInDeck instead of activeCondition; its 盟约·辅助干员 is a NORMAL row that
  // backs itself up (tools/versions/adapters.mjs)
  adapters: Object.freeze(['bondActiveType', 'selfBackupPreset']),
  research: 'docs/research/versions/act1autochess/',
  // the 下半-measured tables (shop stock overrides, the measured draft weights) are left out: uniform draws [ASSUMED]
  tables: Object.freeze({ stock: null, shopDraft: null, tacticDraft: null, bountyDrafts: null }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 300, multi: 1000 }), // PRTS 卫戍协议：盟约: >300 / >1000 layers
    // [ASSUMED] inert in M0 (nothing reads them before M2): deploy order row by row from the bottom (PRTS 卫戍协议/帮助,
    // changed on 2026-03-14), a timed solo prep (300 s), no bench equipment, no full-bench swap, no boss shared by both
    // sides (news 5114 lists the last three as 下半 additions)
    rules: Object.freeze({ deployOrder: 'rowBottomUp', soloTimed: true, benchEquip: false, benchFullSwap: false, bossMirrorShare: false }),
  }),
  expect: Object.freeze({ bonds: 18, bands: 30, visibleNonDiy: 95, triggerDeviations: 'none' }),
});
