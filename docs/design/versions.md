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
| M2 | 上半 fidelity: the rule switches, the same-key-different-meaning audit, the 19 missing kits and the review of the 31 borrowed ones, the blackboard gaps of §36.5, 上半 research data, golden and bot runs | 上半 playable |
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
  `':(glob)data/*.json'`. A plain `'data/*.json'` also matches below `data/` and lists every version file.
- **G2**: the default `config.json` has no `version`. The gameplay file lists and the vanilla content cover exactly the 16
  top-level files, nothing under `data/versions/`.
- **G3**: the cs formula, through known-answer vectors of `shared/plugins/identity.js`, and `CONTENT_HASH_VERSION` 1.
- **G4**: a fresh co-op / NORMAL `room.state` deep-equals the fixture. The code, ids, name and `content.cs` are
  normalised; `content.cs` must equal the welcome's vanilla hash. The welcome has no `versions`.

`node tools/golden.mjs` reports every scenario unchanged: roster 49, bonds 46, fields 22, matches 21, standins 10 and diy
140. `test/versions-keying.test.js` checks the default data against `test/fixtures/versions-keying-baseline.json`. That
baseline was generated before the keying change and covers the item handler of every item, the battle-effect list, the
meta wraps and the default meta registry's 305 keys and hooks.

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
| 盟约·上半 V1_2 | 200 | 95 | 18 | 30 | 89 | 281 | 174 | 197 | 4 852 026 |
| 盟约·上半 V1_1 | 200 | 95 | 18 | 20 | 89 | 279 | 170 | 197 | 4 754 560 |

- Both 上半 builds pass validation with 0 errors. Each version directory holds 16 files: the 15 built ones and a byte
  copy of `tuning.json`. Offline rebuilds are byte-identical (`test/data-versions.test.js`).
- **Pins.** V1_2 reads `21b1f240`, with enemies at `ee2cabff`. V1_1 reads `8303c922` for everything and has no enemy
  pin, so no V1_2 enemy record leaks in.
- **V1_1 is launch day, before the 11-18 hotfix [ASSUMED].** `ea164ef7` is still V1_1 by `versionInfoDict`: about 4 of
  its 11 days ran before the hotfix and about 7 on it. The hotfix changed only activity_table:
  - leader HP ×0.75 on Funny / Normal and −5…−12.5% on Hard;
  - `modeFactorInfo.SINGLE` 1.0 → 1.25;
  - `borrowCount` 8 → 20;
  - the enemy effects 攻坚装备II / III;
  - the m06 / m07 battlefield weights and two special-enemy weights.

  One added pin (`activity: ea164ef7…`) builds the hotfixed state instead.
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
  bounty drafts) do not apply, so those draws are uniform [ASSUMED]. Every research-derived 上半 field keeps its 下半
  value until a per-version research folder exists [ASSUMED]. For V1_1 that is wrong in one more way: PRTS dates the
  solo 70% / co-op 80% enemy multipliers from 11-18.
- **Config.** `hiddenCore` 300 / 1000 comes from PRTS 卫戍协议：盟约, and `tuning.json` is the same for every version
  [ASSUMED]. The 上半 rule switches are inert in M0: `deployOrder: 'rowBottomUp'`, `soloTimed`, no bench equipment, no
  full-bench swap and no shared boss.
- **Loader.** `server/data.js` provides `versionDataDir`, `getVersionData` (lazy, cached and frozen) and
  `resetVersionData`. Nothing at run time calls them in M0. `loadData(DATA_DIR)` reads the top level only.

### 36.4 Behaviour keyed by charId and effectId

上半 reuses the default data's ids for other things. 50 of its 100 shop chess ids name another operator than 下半:
`chess_char_1_02_a` is 讯使, not 角峰. 72 item ids carry another effect and 6 are absent in 下半. Everything
hand-written that was found by id is now found by what the record *is*. On the default data every lookup resolves
exactly as before (§36.2).

- **Kits** (SIM.md §7.2).
  - `KIT_CHAR_IDS` names the charId each tier kit was written for. The first line of every kit file names the same one.
  - `officialKitKey` uses the by-id kit only when it was written for the record's charId. Otherwise it takes that
    operator's tier kit (the one at the record's tier when the operator has two: 锡人 → `2_19`, 耶拉 → `3_20`, 华法琳 →
    `4_26`), then a 自选 `op-*` kit registered under the charId, then none (the generic kit).
  - Test fixtures and plugin `chess_x_` records keep the by-id lookup, and so do stand-ins and 自选 pieces.
- **Items** (SIM.md §7.2, META.md §2.1).
  - `items/battle.js BY_EFFECT`, 蒸汽之心 (`eff_acarm079`), the `items/meta.js` overrides (bound by effectId to the
    loaded data's item keys) and 凯瑟琳's one-cell allowance (`eff_acarm072`, official normal records only) all go
    through the normal record's effectId.
  - Item keys stay the identity of combo partners, buff keys and fx labels, which the golden digests hash.
- **Traits and tokens.** 远牙's dollSwap trait is the one his own traits grant, found by `char_430_fartth`. 夕's
  generic-kit dragon follows `char_2015_dusk` on official chess.
- **`bonds/core.js reached()`.** A threshold the record lacks counts as not reached. Before this change, 上半's 炎, which
  has no 9-member tier, would have summoned two 炎佑 at 6 members.
- **AI.** The community overlay and the fixed `data/i18n` overlay are keyed by default ids, so they apply only to data
  without `config.version` (AI-STRATEGY.md §2).

**Kit resolution on 上半** (96 normal shop records; V1_2 and V1_1 resolve identically):

| resolution | count | operators |
|---|---|---|
| own id, same operator | 46 | — |
| tier kit by charId | 19 | 幽灵鲨 1_04→2_07, 拉普兰德 1_07→2_16, 蛇屠箱 1_10→3_16, 角峰 2_03→1_02, 深巡 2_07→1_04, 宴 2_09→1_18, 锡人 2_13→2_19, 耶拉 3_14→3_20, 初雪 4_03→3_14, 山 4_08→5_17, 忍冬 4_10→3_18, 华法琳 4_11→4_26, 异客 5_02→6_05, 歌蕾蒂娅 5_06→4_12, 银灰 5_14→4_22, 瑰盐 5_17→4_08, 锏 6_02→6_19, 纯烬艾雅法拉 6_09→6_20, 泥岩 6_16→4_18 |
| 自选 `op-*` kit | 12 | 菲亚梅塔, 森蚺, 煌, 左乐, 涤火杰西卡, 林, 提丰, 娜仁图亚, 澄闪, 死芒, 伊芙利特, 淬羽赫默 |
| **generic** (`PENDING_KIT_CHARS`) | 19 | 讯使, 梅, 远山, 狮蝎, 暴行, 布丁, 万顷, 暴雨, 锡兰, 芳汀, 极光, 槐琥, 海蒂, 蜜莓, 安哲拉, 伊桑, 星源, 桑葚, 亚叶 |

The tier kits were written at their 下半 tier, and the `op-*` kits for 自选. The 31 borrowed kits are used as they are
until M2 reviews each one at its 上半 tier [ASSUMED].

**Items on 上半.** 44 records dispatch to 22 battle handlers, each the handler of its own effectId. The meta overrides
bind 寻呼模块 `chess_item_5_03_e`, 天师古鼎 `6_02_e`, 教鞭, “神秘顾客” and 画卷. 紧急调度券 (`eff_acarm115`) does not exist
in 上半 and binds nothing.

**The `reached()` proof.** The change cannot alter the default data:

- Statically: every core bond's main buff carries `power_bond_char_cnt` (5 or 6), and 炎's `ex_bond_char_cnt` is 9.
- Dynamically: a temporary counter on the unchanged `reached()` saw 1349 calls over the 288 golden scenarios and 211
  calls over `test/content/*.test.js`, none with a missing threshold.

### 36.5 The blackboard audit (the M2 work list)

`node tools/bb-audit.mjs --data <dir>…` (with `--json` and `--strict`) reports two kinds of gap for each version
directory, compared with the default data:

- the blackboard fields the version lacks that the code reads with a default, flagged when the default is not neutral;
- the buff keys the code names that the version lacks.

`kits/` is skipped, because kits read skill blackboards. Fields are matched by name across tables, so the audit
over-reports (for example `atk`) [ASSUMED]. The default data audited against itself has no finding.

| | field gaps (non-neutral default) | absent code-named buff keys |
|---|---|---|
| 盟约·上半 V1_2 | 32 (9) | 39 |
| 盟约·上半 V1_1 | 36 (9) | 41 |

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
  `use_equip_add_goods_rule_with_refresh_shop`.

`test/versions-bb-audit.test.js` pins the 突袭 and 炎 findings on every version directory.

### 36.6 Tests and what stays open

**Tests:**

- `test/versions-default-guard.test.js`: G1–G4.
- `test/data-versions.test.js`:
  - the registry, the profiles and the `--version` CLI;
  - the committed directories and their offline rebuild;
  - the adapters, the keyed pools and the loader.
- `test/versions-keying.test.js`, on `data/`, every `data/versions/*/` and `SP_VERSION_DATA_DIRS`. It checks:
  - every chess resolves to its own charId's kit or is pending;
  - every item runs its own effectId's handler;
  - the default data matches the baseline;
  - 炎, 远牙, 夕 and the AI overlays (each of these fails on the code before M0).
- `test/versions-bb-audit.test.js`.
- `test/docs-consistency.test.js` §21.29: the charId-keyed `TRIGGER_DEVIATIONS`.

The per-version rebuild tests need the pinned caches `.cache/gamedata@<sha>/` and skip without them.

**[ASSUMED] in M0** (each listed above where it applies):

- V1_1 without the 11-18 hotfix, and its enemy multipliers.
- The labels.
- The two adapters.
- The left-out 下半 tables and the research fallback.
- Pool entries dropped.
- The shop-excluded items and item rules held for 上半.
- One `tuning.json`.
- hiddenCore 300 / 1000.
- The first tier kit in `KIT_FILES` order when none matches the record's tier.
- The borrowed kits.
- Official records only for 夕 / 远牙 / 凯瑟琳.
- A missing threshold is not reached for every core bond.
- `config.version` marks non-default data.
- The audit's name matching.

A version build also reads two default-side inputs: the committed `data/assets.json` and `docs/research/*.json`, the
fallback. A change to either needs every version rebuilt. The rebuild test's failure message says so.
