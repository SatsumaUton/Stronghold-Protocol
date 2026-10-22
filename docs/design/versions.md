# DESIGN §36 — Official versions: 盟约·下半, 盟约·上半 and its launch state

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 36. Official versions (the version switch)

The remake follows today's game, 盟约·下半 (`act2autochess`, V2_2). The version switch adds the earlier half of the same
event, 盟约·上半 (`act1autochess`), in two states: its final state V1_2 and its launch state V1_1 (the maintainer's
「第一期」: 2025-11-14, before the second batch of strategies on 11-25). One engine plays all three: 上半 is the same
auto-chess family with its own data, and the mechanics that differ become rule switches of that engine.

**The maintainer's decisions (2026-10-22)** that bind every milestone:

- The three versions above. The 2024 卫戍协议 (`act1vautochess`, a different rule family) is not done.
- A player's version is a **browser preference**; the server only enables versions and names a default.
- A room has **one version**, switched by unanimous vote like 重刷 (M1).
- The remake's deliberate deviations and convenience features carry over to every version. Where 上半's mechanics
  differ, the 上半 text wins (M2). 上半's solo mode is timed (the official 300 s per round), with an untimed option
  (default off). A lone human stays untimed as today, and co-op opens with 1–4 players.

**Milestones** (the scope of M1–M3 is the plan, not yet built [ASSUMED]):

| | content | players see |
|---|---|---|
| **M0** (§36.1–§36.6) | registry, per-version build profiles and the two 上半 data builds; behaviour keyed by charId / effectId instead of the default data's ids; the default pinned by tests | nothing |
| M1 | one match process per version, the room's version and its vote, the lobby switch, per-version settings and logs | the switch, behind a server option (default off) |
| M2 | 上半 fidelity: the rule switches, the same-key-different-meaning audit, the 19 missing kits and the review of the 31 borrowed ones, the 24 自选 picks with a tier kit only (§36.4), the blackboard gaps of §36.5, 上半 research data, golden and bot runs | 上半 playable |
| M3 | translations, the asset union, a version-differences page, optional sub-versions | polish |

M0–M2 together make 上半 releasable. This section records M0. The later milestones get their own subsections when they
land.

Sources. Official data: Kengxxiao/ArknightsGameData, `zh_CN/gamedata/`, at these commits:

- `8303c922` (2025-11-14): 上半 launch, V1_1.
- `ea164ef7` (2025-11-18): the 上半 hotfix.
- `23c99d5d`: V1_2 and its levels.
- `21b1f240` (2025-12-05): 上半 final.
- `ee2cabff`: the last enemy change inside the season.
- `12e0a020` (2026-03-10): rewrote `act1autochess` into the 下半 schema, so master holds no pure 上半.

The windows of the two sub-versions come from `autoChessData.versionInfoDict`. PRTS covers the event:
[卫戍协议：盟约](https://prts.wiki/w/卫戍协议：盟约), [盟约 下半](https://prts.wiki/w/卫戍协议：盟约_下半) and
[卫戍协议/帮助](https://prts.wiki/w/卫戍协议/帮助) (the skill-strategy history).

### 36.1 The registry and the version identity

`shared/versions.js` is pure and browser-safe. It defines `DEFAULT_VERSION = 'act2autochess'` and a frozen `VERSIONS`
table, with the helpers `versionById`, `versionSlug` and `versionOfData`.

| id | version | official window | data |
|---|---|---|---|
| `act2autochess` | 盟约·下半 V2_2, the default | 2026-03-27 → 04-25 | `data/` (unchanged) |
| `act1autochess` | 盟约·上半 final, V1_2 | 2025-11-25 16:00 → 12-12 | `data/versions/act1autochess/` |
| `act1autochess@V1_1` | 盟约·上半 at launch, V1_1 | 2025-11-14 16:00 → 11-25 16:00 | `data/versions/act1autochess-v1_1/` |

- An id is the official activity id (activity_table `AUTOCHESS_SEASON`). A sub-version adds `@<versionInfoDict id>`.
- Paths and file names use the slug: lowercase, with no `@`.
- Data, rooms and logs without a version mean the **code constant** `act2autochess`, never a server setting. A server
  that changes its default therefore never re-labels old logs or replays.
- A non-default build carries `config.version = { id, family, rules }` as the last key of `config.json`. The default
  build has no such key. `versionOfData(data)` reads that key.
- The labels (盟约·下半 / 盟约·上半 / 盟约·上半（开服）) are msgids in the four UI packs. Their translations are
  [ASSUMED].
- There is no `data/versions/index.json`: M1 reads the registry.

### 36.2 The default version is pinned

The switch must not move the default by one byte. The original cs is the exception: it hashes every served code file,
so any code change moves it, and only its formula is pinned. The guard was recorded on the untouched tree before any
other M0 change, in `test/versions-default-guard.test.js` and `test/fixtures/versions-default-guard.json`:

- **G1**: the sha256 of the 22 tracked default data files (top-level `data/*.json` and `data/i18n/*.json`, never
  `data/versions/`) and of the golden corpus `test/golden/*.json`. Hand checks with `git diff` must use the pathspec
  `':(glob)data/*.json'`. A plain `'data/*.json'` also matches below `data/` and lists every version file. G1 is the
  M0 merge check: it proves that the M0 commits moved neither, and it is **deleted when M1 starts**. After that
  `test/golden.test.js` and the rebuild check of `test/data.test.js` guard both, as before M0. Until then an intended
  golden update or default data rebuild refreshes the fixture in the same commit
  (`SP_UPDATE_GUARD=1 node --test test/versions-default-guard.test.js`, named in `test/golden/README.md` and DATA.md).
- **G2**: the default `config.json` has no `version`. The gameplay file lists and the vanilla content cover exactly the 16
  top-level files, nothing under `data/versions/`.
- **G3**: the cs formula, through known-answer vectors of `shared/plugins/identity.js`, and `CONTENT_HASH_VERSION` 1.
- **G4**: a fresh co-op / NORMAL `room.state` deep-equals the fixture. The code, ids, name and `content.cs` are
  normalised; `content.cs` must equal the welcome's vanilla hash. The welcome has no `versions`.

G2–G4 stay after M1.

`node tools/golden.mjs` reports every scenario unchanged: roster 49, bonds 46, fields 22, matches 21, standins 10 and diy
140. `test/versions-keying.test.js` checks the default data against `test/fixtures/versions-keying-baseline.json`. That
baseline was frozen on `db8e226d` before the keying change. It covers only what M0 changed: the item handler key of
every item, the battle-effect list, the meta wraps and the 18 `item:` entries of the default meta registry with their
hooks. It is never regenerated: an intended change of an item handler or item override edits its entry by hand. The
tests pin which handler key an item reaches, not the handler's body; a swapped body is caught by `test/golden.test.js`.

### 36.3 Build profiles and the 上半 data

`node tools/build-data.mjs --version <id>` builds a version into its directory. An unknown id or a missing value exits
with code 2. Each version has a profile `tools/versions/<slug>.mjs`, which names:

- the pinned commit of each file group;
- the field adapters (`tools/versions/adapters.mjs`);
- the research fallback;
- which 下半-measured tables apply;
- `hiddenCore`, the rule switches and the expected counts.

The default profile changes nothing. DATA.md "Official versions (M0)" holds the full contract: pins, adapters, the
keyed build tables, the hidden inputs and the warning classes.

| | chess | visible non-DIY | bonds | bands | items | effects | garrisons | enemies | bytes (15 built files) |
|---|---|---|---|---|---|---|---|---|---|
| 盟约·下半 (`data/`) | 266 | 112 | 23 | 40 | 115 | 361 | 249 | 249 | 5 810 393 |
| 盟约·上半 V1_2 | 200 | 95 | 18 | 30 | 89 | 281 | 174 | 197 | 4 852 025 |
| 盟约·上半 V1_1 | 200 | 95 | 18 | 20 | 89 | 279 | 170 | 197 | 4 754 559 |

- Both 上半 builds pass validation with 0 errors. Each version directory holds 16 files: the 15 built ones and a byte
  copy of `tuning.json`. Offline rebuilds are byte-identical (`test/data-versions.test.js`).
- **Pins.** V1_2 reads `21b1f240`, with enemies at `ee2cabff`. V1_1 reads `8303c922` for everything and has no enemy
  pin, so no V1_2 enemy record leaks in.
- **V1_1 is launch day, before the 11-18 hotfix [ASSUMED].** `ea164ef7` is still V1_1 by `versionInfoDict`: about 4 of
  its 11 days ran before the hotfix and about 7 on it. Every change the build reads is in activity_table. Among
  its changes:
  - leader HP ×0.75 on Funny / Normal and −5…−12.5% on Hard;
  - `modeFactorInfo.SINGLE` 1.0 → 1.25;
  - `borrowCount` 8 → 20;
  - the enemy effects 攻坚装备II / III;
  - 战场 m06 weight 40 → 60; m07 weight 40 → 5 and Hard modes only (taken out of both Normal modes, whose stage pool
    drops from 6 to 5, as in V1_2);
  - 墨浪 / 枯朽萃聚使徒 special-enemy weight 10 → 0;
  - the leader weight of `boss_2` (假想敌：铳) 5 → 2;
  - 9 more enemies inactive in the Normal modes (one of them, 沉沙 `enemy_1207_sfji`, also in the Funny modes);
  - 拟态物质's `effectDesc` (`eff_acarm069` and the golden `eff_acgarm069`): the operator gained is the 初始干员, of the
    same bond. The hotfixed build's `effects.json` and item descriptions change with it; the wording is a note for
    拟态物质's M2 handler.

  The commit made the same wording change in skill_table, in the two `sktok_acarm069_1` / `_2` descriptions. The table
  is a pinned build input, but the build does not read those rows. It also added a client drag fix, which is not a build
  input. One added pin (`activity: ea164ef7…`) builds the hotfixed state instead. That switch also updates the V1_1 row of
  `test/data-versions.test.js` (`PINNED` effects 279 → 281, as `aceffect_enemy_4` / `_5` come in, and the assertion that
  V1_1's pins hold only `default`), the V1_1 row of the table above (effects 281, 4 756 757 bytes) and the V1_1 row of
  DATA.md's Counts table (effects 279 → 281, 4.75 → 4.76 MB). The bb-audit and keying expectations do not change.
- **Adapters.** `bondActiveType` converts 上半's bond activation (ALL with the deck → BOARD_AND_DECK; MANI → BOARD with
  `['1']`, as 下半's maniShip) [ASSUMED]. `selfBackupPreset` makes 盟约·辅助干员 a PRESET backup with its default skill
  and module, as 下半 writes it [ASSUMED].
- **Keyed build tables.**
  - The shop-excluded items and the item rules are keyed by the normal item's effectId, and research 04 by trapId.
  - The `choices.json` pools are keyed by effectId / charId. An entry the version lacks is dropped: 上半 has no 野鬃, 灰毫
    or 远牙, so `pool_char_pinus` is empty [ASSUMED].
  - `TRIGGER_DEVIATIONS` (§21.29) is keyed by charId and applies only over an official TAKE_DAMAGE row. 上半 has no TANK
    row, so neither 上半 build carries a deviated skill.
- **Left out for 上半.** The four tables measured on 下半 (the stock overrides, the shop draft, the tactic draft and the
  bounty drafts) do not apply, so those draws are uniform [ASSUMED]. Leaving out the stock table removes only the
  per-identity overrides: the tier copies stay the literals cited for 下半 (below). Every research-derived 上半 field keeps its 下半
  value until a per-version research folder exists [ASSUMED]. For V1_1 that is wrong in one more way: PRTS dates the
  solo 70% / co-op 80% enemy multipliers from 11-18. The research overlays keyed by bondId and trapId also write 下半's
  descriptive texts into 上半: `bonds.json` `spec` (上半's 炎 gets 下半's third tier and "hits up to 3 targets") and the
  items' `implFormula` / `howToPlay`. The sim reads none of them; M1's screens (S.W.E.E.P., the guide) must not show
  them as 上半 rules.
- **Carried over for 上半 [ASSUMED].** The bounty cards' `draft` / `draftPool` classification is not one of the four
  tables: `HIDDEN_BOUNTY_IDS` and the effect-id shapes of `bountyDraftPool`, read from 下半's PRTS table and screenshots,
  still sort 上半's 93 cards (excluded perfect 20, unseen 14, hidden 4; drafted boss 19, initial 18, hunter 18), and the
  match honours them. M2's research decides 上半's own pools. Two more build rules sourced only from 下半's PRTS record
  (「卫戍协议：盟约 下半/PRTS盟约记录」) apply to 上半 outside `buildConfig` and the four tables:
  - `DIY_EXTRA_PROTOTYPES` (`tools/build-data.mjs`): the tier-5 自选 slots also offer the six 4★ prototypes (先锋 and 特种
    left out), so both 上半 builds' `backups.json` `diy.prototypes` has 15 at tier 5 and 9 at tier 6, as the default.
    PRTS's 上半 page 卫戍协议：盟约 does not mention 4★ prototypes in 自选; M2 checks the rule against 上半.
  - `BAND_SWAP_LPR` 1: 鸭爵's swapped-in enemies cost 1 LP at the protection point (下半's record, §策略 鸭爵 备注). V1_2's
    `band_ducklord` carries the same `round_start_all_player_change_enemy_2` enemylist, so its `enemies.json`
    `enemy_2001_duckmi_2` / `enemy_2002_bearmi_2` get `lpr` 1 (V1_1 has no 鸭爵 band).
- **Config.** `hiddenCore` 300 / 1000 comes from PRTS 卫戍协议：盟约, and `tuning.json` is the same for every version
  [ASSUMED]. The 上半 rule switches are inert in M0: `deployOrder: 'rowBottomUp'`, `soloTimed`, no bench equipment, no
  full-bench swap and no shared boss. 上半's constData has no `singleReconnectTime` (`12e0a020` added it), so both 上半
  builds write `constants.singleReconnectTime: null` instead of the 下半 value. The lobby's own fallback then keeps a
  dropped solo run resumable for 24 h [ASSUMED] until 上半's solo exit rule is decided, together with the timed solo.
- **Config carried over unreviewed [ASSUMED].** `tools/build-data.mjs` writes many rule constants as literals (its
  `buildConfig` return block is the full set), and both 上半 builds copy them as measured on 下半. Among them: `bans` (NORMAL / HARD 3 core + 4 addon; 下半 has 8 core bonds, 上半 6,
  so the same draw bans half of 上半's), the `hiddenCore` extras (`minTeamLpExclusive`, `checkedAfterRound`, and
  `difficulties`, which names ABYSS although 上半 has no ABYSS mode), `trophies`, the boss overtime and HP scale,
  `unite`, `finalAssault` and `bandDraft`; the economy literals (the tier and item copies `poolCopies` /
  `itemPoolCopies`, which every 上半 chess and item uses with the stock table left out, the golden and merge counts, the
  co-op pool multiplier, the reward offer, the freeze, the temp / equipment / arts-per-round sizes and the alternative
  income cap); `dp` {10, 1, 99}; the timer literals `spFirst` 30, `bandTurn` 50 (the owner's 下半 report of
  2026-10-10) and `soloPrepTimeData` 300 (tied to 上半's timed solo, Q7); and the title stat rules. They equal the
  default, so the blackboard audit cannot list them (§36.5). DATA.md `config` lists the values.
- **Loader.** `server/data.js` provides `versionDataDir`, `getVersionData` (lazy, cached and frozen) and
  `resetVersionData`. Nothing at run time calls them in M0. `loadData(DATA_DIR)` reads the top level only.
- **`config.version` is the gate.** Data that carries it (a version's build) finds hand-written behaviour by charId and
  effectId (§36.4). The default data and the plugin content sets built on it carry none and keep every by-id lookup of
  before M0: a plugin `data.patch` that sets an official chess record's `charId` (a reskin, say) keeps that chess id's
  kit, and one that sets an official item's `effectId` keeps the item key's behaviour. The AI overlays use the same gate.

### 36.4 Behaviour keyed by charId and effectId

上半 reuses the default data's ids for other things. 50 of its 100 shop chess ids name another operator than 下半:
`chess_char_1_02_a` is 讯使, not 角峰. 72 item ids carry another effect and 6 are absent in 下半. On a version's build
(`config.version`, support `isVersionData`) the hand-written behaviour of the id-reused tables, chess (kits, traits,
tokens) and items, is found by what the record *is*. Data without `config.version` — the default and the plugin content
sets on it — resolves exactly as before (§36.2, §36.3).

Band and bond ids still key behaviour by id on every data: `bands/meta.js` (`band_cathy`, `DUCK_BAND` `band_ducklord`),
`bands/battle.js AMEDIC_BAND`, `server/match/gamedata.js` (`band_bldsk`, `band_cannot`), `bonds/core.js INSTALLERS`
(`kjeragShip: installKjerag` …) and `memberOf(…, 'yanShip')` in `items/battle.js`. That is correct while a version
reuses those ids only for the same band or bond: 上半 does (checked: the 29 V1_2 / 19 V1_1 shared band ids keep the
default's name and effectId, and the 18 shared bond ids their name and effectId; only `emptyShip`'s activeCount and 炎's
thresholds differ, both documented). `test/versions-keying.test.js` pins it per directory for the code-keyed band ids
and every shared bond id, so a later build (`SP_VERSION_DATA_DIRS`, 第一期) that reuses one of them for another entity
fails there.

- **Kits** (SIM.md §7.2).
  - `KIT_CHAR_IDS` names the charId each tier kit was written for. The first line of every kit file names the same one.
  - `officialKitKey` uses the by-id kit only when it was written for the record's charId. Otherwise it takes that
    operator's tier kit (the one at the record's tier when the operator has two: 锡人 → `2_19`, 耶拉 → `3_20`, 华法琳 →
    `4_26`), then a 自选 `op-*` kit registered under the charId, then none (the generic kit).
  - Test fixtures and plugin `chess_x_` records keep the by-id lookup, and so do stand-ins and 自选 pieces
    (`KITS[charId]`).
  - A chess whose own kit was written for its operator but failed to load stays generic, as on the default data; it
    never takes the operator's other tier kit. A `char_x_` charId on an official id keeps the by-id kit. Both rules are
    tested through `officialKitKey`'s injectable registries (`{ kits, kitCharIds, tierKeys }`, tests only).
- **Items** (SIM.md §7.2, META.md §2.1).
  - `items/battle.js BY_EFFECT`, 蒸汽之心 (`eff_acarm079`) and its hammers, the `items/meta.js` overrides and 凯瑟琳's
    one-cell allowance (`eff_acarm072`, official normal records only; counted at the prep's pick and in her later offers) all
    go through the normal record's effectId. On the default data they keep the item key (`DEFAULT_ITEM_KEYS`,
    `MUTATION_CELL_ID`, each override's default key).
  - A meta override is bound by its effectId **and** the buff key it reads (`items/meta.js OVERRIDES`): the same
    effectId can carry another mechanic. 上半's 寻呼模块 (`eff_acarm075`) is one special refresh showing operators of one
    bond (`use_equip_add_goods_rule_with_refresh_shop`), not 下半's pick of one of three same-bond operators, so it binds
    nothing until M2 writes its mechanic. The battle handlers already return when their buff is missing.
  - Item keys stay the identity of combo partners, buff keys and fx labels, which the golden digests hash.
- **Traits and tokens.** 远牙's dollSwap trait is the one his own traits grant, found by `char_430_fartth`. 夕's
  generic-kit dragon follows `char_2015_dusk` on official chess.
- **`bonds/core.js reached()`.** On a version's build a threshold the record lacks counts as not reached. Before this
  change, 上半's 炎, which has no 9-member tier, would have summoned two 炎佑 at 6 members. Data without
  `config.version` keeps the old rule (reached), so a plugin or Forge core bond without the threshold plays as before.
- **AI and game texts.** The community overlay and the fixed `data/i18n` overlay are keyed by default ids, so they
  apply only to data without `config.version` (AI-STRATEGY.md §2). The client uses the same gate
  (`public/js/data.js versionFiles`): files whose config carries `version` take only their content set's own game texts
  (`setContent` `overlay`; a per-version overlay is M3), never the language folder's `data/i18n/<lang>.json`. The
  per-text staleness hash (`shared/i18nData.js textHash2`, 2 base-36 characters) cannot stand in for that gate: applied
  to 上半's files the default overlay changes 7 leaves on V1_2 and 6 on V1_1 in each of en, ja, ko and zh-TW (下半's
  战栗维式重锤 text on `chess_item_2_03_e_b`, `eff_acarm054`'s +40% HP, `garrison_69_b` without 上半's "若同一行有至少3名干员",
  `band_dusk` / `aceffect_band_45` with 下半's 【墨色真颜】 clause, `allybuff_select_2_2`'s name). `localeName` still maps
  Chinese names, which mean the same operator in both versions.

**Kit resolution on 上半** (96 normal shop records; V1_2 and V1_1 resolve identically):

| resolution | count | operators |
|---|---|---|
| own id, same operator | 46 | — |
| tier kit by charId | 19 | 幽灵鲨 1_04→2_07, 拉普兰德 1_07→2_16, 蛇屠箱 1_10→3_16, 角峰 2_03→1_02, 深巡 2_07→1_04, 宴 2_09→1_18, 锡人 2_13→2_19, 耶拉 3_14→3_20, 初雪 4_03→3_14, 山 4_08→5_17, 忍冬 4_10→3_18, 华法琳 4_11→4_26, 异客 5_02→6_05, 歌蕾蒂娅 5_06→4_12, 银灰 5_14→4_22, 瑰盐 5_17→4_08, 锏 6_02→6_19, 纯烬艾雅法拉 6_09→6_20, 泥岩 6_16→4_18 |
| 自选 `op-*` kit | 12 | 菲亚梅塔, 森蚺, 煌, 左乐, 涤火杰西卡, 林, 提丰, 娜仁图亚, 澄闪, 死芒, 伊芙利特, 淬羽赫默 |
| **generic** (`PENDING_KIT_CHARS`) | 19 | 讯使, 梅, 远山, 狮蝎, 暴行, 布丁, 万顷, 暴雨, 锡兰, 芳汀, 极光, 槐琥, 海蒂, 蜜莓, 安哲拉, 伊桑, 星源, 桑葚, 亚叶 |

The tier kits were written at their 下半 tier, and the `op-*` kits for 自选. The 31 borrowed kits are used as they are
until M2 reviews each one at its 上半 tier [ASSUMED].

**自选 and 补位 on 上半.** Every 补位 stand-in resolves as on the default data: a stand-in kit, or a 预备干员 with the
generic kit. 上半's owned 自选 pool (72 operators in V1_2, 71 in V1_1) holds 24 that 下半 sells as shop chess: 星熊, 莫斯提马,
塑心, 安洁莉娜, 空弦, 迷迭香, 焰尾, 瑕光, 卡涅利安, 伺夜, 远牙, 耀骑士临光, 焰影苇草, 百炼嘉维尔, 荒芜拉普兰德, 凛御银灰, 圣聆初雪,
溯光星源, 夕, 隐德来希, 号角, 玛恩纳, 仇白 and 妮芙. Their only kit is a tier kit under a chess id. A 自选 piece keeps the
by-charId lookup, so they have no 自选 kit, are listed in `kits/index.js PENDING_DIY_KIT_CHARS` and stay out of
`KITTED_CHARS`. The kitted gate (`diyPool`, `checkDiyPicks`) therefore leaves them out of 上半's 自选 [ASSUMED]: M2 either
reviews each tier kit as a borrowed 自选 kit or writes one. Making the kitted list follow the data would touch the
lobby's and the match's 自选 paths (and the welcome's `diyKitted`), which M1 reorganises per version.

**Items on 上半.** 44 records dispatch to 22 battle handlers, each the handler of its own effectId. The meta overrides
bind 天师古鼎 `chess_item_6_02_e`, 教鞭, “神秘顾客” (both of its overrides) and 画卷. 紧急调度券 (`eff_acarm115`) does not exist
in 上半, and 寻呼模块 `chess_item_5_03_e` carries another buff: neither binds anything. 蒸汽之心 is `chess_item_6_04_e`, and
its hammers are `chess_item_2_03_e`–`2_06_e`. `test/versions-keying.test.js` pins these counts, the kit split above and
the bound keys for each directory (`EXPECT`); a directory without an entry fails.

**The `reached()` proof.** The change cannot alter the default data (and, gated on `config.version`, no data without it):

- Statically: every core bond's main buff carries `power_bond_char_cnt` (5 or 6), and 炎's `ex_bond_char_cnt` is 9.
- Dynamically: a temporary counter on the unchanged `reached()` saw 1349 calls over the 288 golden scenarios and 211
  calls over `test/content/*.test.js`, none with a missing threshold.

### 36.5 The blackboard audit (the M2 work list)

`node tools/bb-audit.mjs --data <dir>…` (with `--json` and `--strict`) reports four kinds of gap for each version
directory, compared with the default data:

- the blackboard fields the version lacks that the code reads with a default, flagged when the default is not neutral;
- the buff keys the code names that the version lacks;
- the skill trigger rules of its chess, backups and tokens that the engine does not implement
  (`shared/plugins/skillSpec.js TRIGGER_RULES`);
- the keys the version carries that the default data lacks and no code under `server/` or `shared/` names, each with
  its records: the buff key and `bbStr.key` of bands, bonds, items and effects, and each garrison's `effectType`,
  `effectKey`, `battleRuneKey` and `bbStr.key`. The first three compare records by id or key, so they never see these.
  Such a mechanic is silently inert: `garrisons/meta.js` runs `H[effectType]` and `garrisons/battle.js`
  `INSTALLERS[key]` only when a handler exists, without a warning.

`kits/` is skipped for the field and buff-key classes, because kits read skill blackboards. Fields are matched by name across tables, so the audit
over-reports (for example `atk`) [ASSUMED]. The default data audited against itself has no finding.

| | field gaps (non-neutral default) | absent code-named buff keys | unknown trigger rules | version-only keys no code names |
|---|---|---|---|---|
| 盟约·上半 V1_2 | 32 (9) | 43 | 1 | 14 |
| 盟约·上半 V1_1 | 36 (9) | 45 | 1 | 14 |

The non-neutral gaps are listed below. Each would silently apply the 下半 meaning and is an M2 item:

- 突袭 `no_attack_duration`, read with 10 in `bonds/addon/battle.js`;
- 拉特兰桥夹 `max_trigger_cnt`, read with 3;
- steadShip `damage_scale`, read with 1;
- 炎's 9-member fields (`atk` and others), which `reached()` now handles.

Besides those:

- V1_1 also lacks 协防干员's (emptyShip) `damage_scale_normal` / `damage_scale_extra`.
- The absent buff keys include the `act2autochess_band12` / `band3` band buffs, the 叙拉古 / 卡西米尔 / 萨尔贡-share bond
  keys and the `act2autochess_equip_acarm*` keys, three of which make these items inert in 上半 until M2: 伪装服, 海沟实验体
  and 耶拉冈德之泪.
- Several 下半 prep keys are also absent. Among them is the key 寻呼模块's override reads; 上半 names its own,
  `use_equip_add_goods_rule_with_refresh_shop`, and the override binds nothing there (§36.4). M2 writes that mechanic.
- **森蚺's `auto_chess_change_map`.** Its key is Touch's, which the default data has, so no class reports it (same key,
  different meaning: the M2 audit).
  上半's 森蚺 (`band_zumama`, `aceffect_band_43`, both builds) carries Touch's key with device aliases
  (`trap_1104_aclasert#1`…`#4`: one 双眼皮 on every field, the alias format of 机变 cards). It is a device switch, not a
  map character. `bands/battle.js isMapCharBuff` accepts only Touch's map-character shape, so 森蚺 reports no battle part
  and the AI playbook does not class it as team support. M2 builds the device switch (`server/sim/content/devices.js`
  already implements the 双眼皮). This shape check (map characters `char_*#n`) is not gated on `config.version`: it
  applies to every data set, so a plugin band on the default data whose `auto_chess_change_map` names device aliases is
  no longer team support either (it was at db8e226d). Such a band spawns nothing in battle, so the new class is the
  accurate one; it is the one by-shape rule of M0 that reaches default content sets.
- **协防干员's damage clause.** In V1_2, 上半's emptyShip has 下半's keys (`damage_resistance`, `damage_scale_normal`
  1.2, `damage_scale_extra` 1.4), but its text drops 下半's 【协防干员】 scope: "所有干员受到的物理和法术伤害-20%，造成伤害提升至
  120%，若为精锐状态则改为造成伤害提升至140%". `bonds/addon/battle.js` gives the 1.2 / 1.4 to emptyShip members only. If 上半
  meant every operator, the 下半 meaning applies silently. PRTS records the clause as a mid-season "盟约效果追加" without
  saying who receives it. M2 question: all operators or only members? (Its `activeCount` is 3 in 上半 against 2 in 下半;
  `bonds.json` `spec` still says "2 distinct", the research-overlay note of §36.3.)
- **The 6 上半-only enemies have no attack clip.** 墨浪 `enemy_1201_sfzhi`, 莱茵生命防卫科成员 `enemy_1249_lysdb`, 实验用动力装甲
  `enemy_1254_lypa`, 萨卡兹王庭军术师 `enemy_1275_dwlock`, 巫王乐团圆号手 `enemy_1373_ltnhor_2` and 残党乐团鼓手
  `enemy_1376_ltndru` (both builds) are absent from `data/enemies.json`, and `data/assets.json`, the manifest
  `enemyAttackAnim` reads, holds only 下半's models. They get no `attackAnim`, so the sim uses `ATTACK_PAUSE` instead of
  the clip timing (`attackStand` / `attackWindup`); 墨浪, 军术师 and 圆号手 are ranged (range 2 / 2.5 / 1.5). This changes
  sim behaviour, so it is M2 work, not M3's visual asset union. Adding their models edits `data/assets.json`, a default
  data file and a hidden input of every version build: rebuild every version directory (§36.6), and refresh G1 if it
  still exists (it is deleted when M1 starts, §36.2). A non-default build warns once per enemy whose model the manifest
  lacks, so the list stays visible in `.cache/build-data-report.<slug>.json`.
- **Version-only keys** (the same 14 in both builds; each is an M2 item):
  - four 上半 traits with no handler: 煌's `SERVER_GAIN_CHAR` (`garrison_52_a` / `_b`, 售出时 she becomes 烛煌, who counts
    as both 炎 and 维多利亚), 蜜莓's `SERVER_ADD_BOND_ACTIVATED_RANDOM` (`garrison_58`), 伊芙利特's
    `SERVER_ADD_BOND_FRONT_ALL_LAYER` (`garrison_83`) and 极光's `act1autochess_gar_event_recoverhp_enemy_abflag_inrange`
    (`garrison_27`);
  - 华法琳 / 寒芒克洛丝's grant to the operator in front (`garrison_72` / `_73`, `battleRuneKey` `give_garrion_to_front`):
    上半 spells the field `give_garrion_id`, and `garrisons/battle.js` reads `give_garrison_id`, so the trait is never
    granted;
  - the 标准模拟 band clause `act1autochess_band31_buff` ("<标准模拟> +30% ATK/DEF/HP") on `band_bldsk`, `band_amiya`,
    `band_duyaoy` and `band_sarkazb`, bandIds 下半 also has;
  - 灵巧's 20-layer award `bond_layer_refresh_shop_award_equip` (the first refreshed equipment of a prep costs 1) and
    远见's 100-layer `bond_layer_char_goods_price_discount` (every operator in the shop costs 1 less);
  - six 上半 equipment keys: `sell_char_count_gain_equip_owner_original` (商业包装方案, `eff_acarm074`),
    `use_equip_give_char_to_player_most_bond` (信标, `eff_acarm109`), `use_equip_add_goods_rule_with_refresh_shop`
    (寻呼模块, above) and `act1autochess_equip_acarm055` / `078` / `102_global_buff`.
- **`bans`.** The per-match bond ban draws 3 of 上半's 6 core bonds, a 下半 count (§36.3, config carried over); very
  likely not 上半's rule.
- **`AUTO_STOP`.** 上半's 斩业星熊 (`char_1044_hsgma2`, a 自选 operator) S3 `skchr_hsgma2_3` triggers on `AUTO_STOP`, one
  of the 15 rows of 上半's skillTriggerDataList. The engine does not implement it (`server/sim/skills.js`), and
  `validateAll` accepts it. M2 builds it; until then 上半's 自选 must not offer 斩业星熊 (round-50 design §2.9).

`test/versions-bb-audit.test.js` pins the 突袭 and 炎 findings, the unknown trigger rules (exactly `AUTO_STOP`) and the
version-only keys with their records on every version directory.

### 36.6 Tests and what stays open

**Tests:**

- `test/versions-default-guard.test.js`: G1 (until M1) and G2–G4.
- `test/data-versions.test.js`:
  - the registry, the profiles and the `--version` CLI;
  - the committed directories and their offline rebuild;
  - the adapters, the keyed pools and the loader.
- `test/versions-keying.test.js`, on `data/`, every `data/versions/*/` and `SP_VERSION_DATA_DIRS`. It checks:
  - every chess resolves to its own charId's kit or is pending;
  - every 自选 pick (owned pool and prototypes, each slot) and 补位 stand-in resolves to its charId's kit, or is a 预备干员
    (generic) or a pending 自选 pick that the kitted gate drops;
  - `auto_chess_change_map`: Touch has a battle part and is team support, 上半's 森蚺 neither;
  - every item runs its own effectId's handler, and each meta override binds only keys carrying its effectId and buff;
  - each directory's pinned counts: kit split, dispatched items and handlers, battle-effect items, 蒸汽之心's hammers
    (the version directory after the default exercises the hammer cache reset), bound meta keys and 突变细胞;
  - 凯瑟琳's cell at the prep's pick and in her later offers (the band's offer leaves out that directory's cell once
    taken, never the default id; V1_1 has no 凯瑟琳 band); the official-record rules of 夕, 远牙 and 凯瑟琳 (a plugin record never counts);
  - the default data matches the baseline, and a plugin patch of an official `charId` / `effectId` on it keeps the old
    lookups;
  - the same patch keeps 凯瑟琳's cell (`isMutationCell` / `mutationCellIds`), 蒸汽之心's hammers, 远牙's granted trait and
    夕's dragon by id; `officialKitKey`'s failed-load and `char_x_` rules;
  - each code-keyed band id and every shared bond id keeps the default's name and effectId;
  - the client store (`public/js/data.js`) applies no `data/i18n` overlay to a version directory, served or as a content
    set without its own texts, and does apply a set's own texts;
  - 炎, 远牙, 夕 and the AI overlays (each of these fails on the code before M0).
- `test/versions-bb-audit.test.js`.
- `test/docs-consistency.test.js` §21.29: the charId-keyed `TRIGGER_DEVIATIONS`.

The per-version rebuild tests need the pinned caches `.cache/gamedata@<sha>/` and skip without them.

**[ASSUMED] in M0** (each listed above where it applies):

- V1_1 without the 11-18 hotfix, and its enemy multipliers.
- The labels.
- The 下半 rule constants of `config.json` (`bans`, the economy literals with the tier copies, `dp`, the timer literals
  `spFirst` / `bandTurn` / `soloPrepTimeData`, the title rules and the rest, §36.3).
- The two adapters.
- The left-out 下半 tables and the research fallback.
- Pool entries dropped.
- The shop-excluded items and item rules held for 上半.
- One `tuning.json`.
- hiddenCore 300 / 1000.
- The first tier kit in `KIT_FILES` order when none matches the record's tier.
- The borrowed kits.
- The 24 自选 picks with a tier kit only left out of 上半's 自选.
- `constants.singleReconnectTime` null for 上半, with the lobby's 24 h fallback.
- Official records only for 夕 / 远牙 / 凯瑟琳.
- A missing threshold is not reached for every core bond, on a version's build.
- The 下半 bounty draft classification and research texts (`spec`, `implFormula`, `howToPlay`) carried into 上半.
- 下半's tier-5 4★ prototype extension of 自选 (`DIY_EXTRA_PROTOTYPES`) and 鸭爵's swapped enemies costing 1 LP
  (`BAND_SWAP_LPR`), both from 下半's PRTS record, carried into 上半 (§36.3).
- `config.version` marks non-default data.
- The audit's name matching.

A version build also reads default-side inputs: the committed `data/assets.json`, `data/tuning.json` (byte-copied) and
`docs/research/*.json`, the fallback. A change to any of them needs every version rebuilt. The rebuild test's failure
message says so; outside a machine with the pinned caches only the `tuning.json` copy is checked.

**Open (for M1):**

- **Browser settings keyed by chess id.** The per-browser loadout (`public/js/ui/loadoutModel.js`,
  `{ [baseChessId]: { skill?, module? } }` in `sp.pref.loadout`) and ownership (`public/js/ui/ownershipModel.js`,
  `notOwned`, a list of base chess ids), and the `room.loadout` / `room.ownership` payloads that carry them
  (`shared/protocol.js checkLoadout` checks each entry against the room data's record of that chess id), are keyed by
  chess id. In a 上半 room `chess_char_1_02` is 讯使, not 角峰: a 下半 choice of 角峰's skill 1 would pass and select 讯使's
  second skill, and 角峰 marked not owned would field 讯使's stand-in. M1 re-keys them by charId, migrating old keys
  through 下半's mapping, before a version room accepts them (round-50 design §2.8). Nothing serves a version room in
  M0, so nothing breaks today.

**Open (for the maintainer):**

- **Which release M0 belongs to.** The docs say "after 0.3.2" (AI-STRATEGY.md, META.md, SIM.md, `kits/README.md`), as the
  round-50 plan does, while its CHANGELOG line sits under 0.3.2 (工具) because no later section exists yet. Once the
  release is named, one wording goes into all five places.
- **Packaging and static serving.** `data/versions/**` (about 9.6 MB, 32 files) ships today in the full package, the
  update zips and Docker (`tools/package.mjs RUNTIME_DIRS` includes `data/`), and `server/http/static.js` serves
  `/data/versions/*` publicly, although nothing reads it before M1. Either exclude it from the packages until M1 (and
  test the exclusion) or ship it and say so in the CHANGELOG.
