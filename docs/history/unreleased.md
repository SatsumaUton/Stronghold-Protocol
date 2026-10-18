# DESIGN §35 — Unreleased

Part of [DESIGN.md](../DESIGN.md). Changes after 0.3.1; not yet released.

## 35. Unreleased

### 35.1 AI strategy extension interface (#673)

Source: maintainer review of PR #673. Normative contract: DESIGN §6.6; implementation reference:
[META §1.6](../META.md#16-selectable-ai-implementations) and [the strategy guide](../BOT_STRATEGIES.md).

Match resolves a trusted server-side AI definition per match: an explicit `botStrategy` option (ID or definition)
overrides `SP_BOT_STRATEGY`. An unset or empty selection uses the original bot, `legacy`, the only built-in.
`botStrategyContract.js` provides frozen definitions that inherit unspecified hooks and pure registries that
reject duplicate IDs. Implementations import the contract, separately from the registry, to avoid import cycles.
`startServer()` validates the environment selection before loading data or listening, reporting the variable,
rejected value, available IDs and how to restore the default when the ID is unknown.

Band/card/private-bounty picks and both sliced prep stages use the selected object. Match still owns cancellation,
host-delegated rehearsal, cleanup and Ready, including exceptions thrown before an iterator exists. Prep generator
steps are counted by `testSlice`, and local rehearsal jobs receive the same slice controller. Replays use the
journalled step budget instead of wall-clock timing, so inputs between slices keep their original order.
The input journal records the resolved `botStrategy` ID; replay explicitly uses it, with `legacy` for older records
that omit it, regardless of `SP_BOT_STRATEGY` on the replay host. An unavailable recorded ID fails explicitly.

Matchrun and botbench select registered IDs; benchmark records and bounty calibration use the selected bot.
Solo `--band` forces only the opening picker, preserving `gd.bandIds()` / `gd.bandBondIds()` for later effects and
skipping the original picker's RNG draw. The earlier override replaced both methods for the entire match;
these are different experiments and require fresh comparison runs.

No alternate policy, new weights, extra legacy RNG draws or priority AI seats ship with this interface. Band
selection keeps the existing draft order, including the room's existing AI-last option. General and specialist
policies are future, separate contributions. The original `bot.js` policy and legacy Golden results stay unchanged.

Validation covers real HTTP/WebSocket room startup with unset/empty/explicit legacy selections, inherited hooks,
seeded choices/RNG, match isolation, private drafts, sliced prep/rehearsal replay and failure cleanup. Recorded and
old journals are replayed after changing the environment, checking strategy identity, state and RNG.
