# External AI API (`sp-ai/1`)

This implements the maintainer's **2026-10-17 decision**, requested on 2026-10-19: “observation → intents,
validated like a human, timeout → built-in bot, runs on the host or a third-party service”, as a strategy of
PR #673 by **@HankDUMPLINGZhong**. `legacy` remains the default. Nothing connects or spawns unless the server
operator selects `external` and supplies its configuration. Room clients cannot select a URL, command or token.

This is an extension of the remake, not an official AI protocol. Existing game rules and their sources remain
in [DESIGN §6](design/match.md), [META](META.md) and [PRTS help](https://prts.wiki/w/卫戍协议/帮助).
No economy, pool, placement, timer, draft-order or battle rule changes. All wire format, limits, action scope,
transport lifecycle and example-policy choices below are **[ASSUMED] engineering policy**. The observation /
human-validation / fallback requirements themselves are the maintainer's decision.

## Enable it

Environment configuration follows [the bot strategy selector](BOT_STRATEGIES.md). An explicit
`new Match({ botStrategy: 'external', externalAI: { transport, url, command, seats, timeoutMs, maxIntents,
maxBytes, failureLimit, backoffMs }, ... })` overrides the environment configuration as a whole. Omitted
numeric fields use the defaults below. The bearer token is read only from `SP_EXTERNAL_AI_TOKEN`.
Configuration is validated before server startup; an invalid configuration fails without printing credentials.

| Variable | Meaning / default / bounds |
|---|---|
| `SP_BOT_STRATEGY` | `external` to enable; unset / empty selects `legacy` |
| `SP_EXTERNAL_AI_TRANSPORT` | Required: `http` or `stdio` |
| `SP_EXTERNAL_AI_URL` | HTTP(S) endpoint; no URL credentials or fragment |
| `SP_EXTERNAL_AI_TOKEN` | Optional HTTP bearer token; environment only |
| `SP_EXTERNAL_AI_COMMAND` | Required for stdio: JSON argv array, no shell; 1–64 nonempty strings, each ≤4096 characters |
| `SP_EXTERNAL_AI_SEATS` | Optional comma-separated seat indices, 0–3; omitted means all bot-controlled seats |
| `SP_EXTERNAL_AI_TIMEOUT_MS` | 1000; integer 1–30000, both request timeout and total decision budget |
| `SP_EXTERNAL_AI_MAX_INTENTS` | 64; integer 1–256, cumulative across replies in one decision |
| `SP_EXTERNAL_AI_MAX_BYTES` | 65536; integer 1–1048576, raw response bytes / stdio line, excluding newline |
| `SP_EXTERNAL_AI_FAILURES` | 3; integer 1–20 consecutive failed decisions before match-long fallback |
| `SP_EXTERNAL_AI_BACKOFF_MS` | 1000; integer 1–60000 before the next demand can restart a failed stdio child |

Seat selection applies to AI teammates, opponent seats in modes that use them, and humans under AI takeover.
Unselected seats use `legacy`. INFO_CHECK acknowledgement and combat simulation remain engine-owned; decision
points are band turns, common card turns, prep (including personal choices/rewards), and plugin offer windows.

Example HTTP service (two terminals, POSIX shell):

```sh
node tools/ai/http.mjs 8765
```

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=http \
SP_EXTERNAL_AI_URL=http://127.0.0.1:8765 SP_EXTERNAL_AI_SEATS=1 npm start
```

Example stdio (the game server starts and stops the child):

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' npm start
```

In PowerShell set each variable with `$env:NAME = 'value'`, then run `npm start`. For a service installation use
an absolute command / script path, since relative argv paths resolve against the server's working directory.
The examples choose an untaken universal band, the first unsold card / available offer, personal choice zero,
then Ready. They demonstrate the protocol, not strong play. The four example band IDs come from the public
static `data/bands.json` catalogue; static game catalogues can be installed alongside any AI, just as clients
load them. They are not hidden match state. The service binds only `127.0.0.1`; port `0` prints its assigned port.

## Observation and response

Each request is a complete JSON observation:

```js
{
  v: 'sp-ai/1',
  id: 'ai-3',                         // opaque request ID, unique within this match
  public: { t: 'm.public', /* existing publicView() fields */ },
  private: { t: 'm.private', /* this seat's privateView() fields */ },
  context: {
    kind: 'prep',                     // band | card | prep | offer
    phase: 'PREP', round: 1,
    deadline: 1234567890000,          // absolute server clock ms: decision expires here
    remaining: 64,                    // remaining intent budget for this decision
    legalActions: ['g.buy', /* ... */ 'g.ready']
  },
  results: [
    { intent: { t: 'g.freeze' }, ok: true },
    { intent: { t: 'g.buy', slot: 15 }, error: 'BAD_TARGET' }
  ]
}
```

`public` and `private` are JSON copies of the existing human wire-view builders, including their exact keys;
see [META §5](META.md). No RNG/seed, match object, shared stock counts, future rolls, or another seat's private
view is added. Information already public, including public plugin offer cards, stays public. The normal
public view's `serverNow` gives the clock reference; its `deadline` remains the phase deadline (zero if untimed).
`context.deadline` is the adapter's earlier deadline. `results` carries accepted / rejected intents since the
last observation of this seat, including the preceding decision's last batch; retained results are bounded to
`maxIntents`. Validation returns the same `ok` / `error` / optional `detail` as human intents. The AI should
inspect results and the new views rather than assume a submitted action worked.

Respond with exactly these envelope fields:

```json
{"v":"sp-ai/1","id":"ai-3","intents":[{"t":"g.ready","ready":true}],"done":true}
```

`v` and `id` must match; `done` must be boolean; `intents` must be an array within the remaining budget.
Unknown envelope keys, non-JSON replies, empty `done:false` batches and oversized batches fail the decision
before applying any intent. `done:false` requests another observation after the batch. An accepted terminal
action ends the decision even if `done:false`; subsequent intents in that batch receive `WRONG_PHASE`.
Malformed individual intents are rejected with `BAD_MSG` and still count against the cap. Invalid legal-looking
actions return their actual human error (`NO_FUNDS`, `SOLD_OUT`, `BAD_TARGET`, `WRONG_PHASE`, etc.).

Intent objects use [shared/protocol.js](../shared/protocol.js), including optional `rid`. Each is checked with
`validateC2S`, then the same `_handleSeatIntent` / `_handle` path as `Match.handle`. Bot-seat authorization is
internal to the adapter: network clients still cannot call `handle` for a bot.

| Decision | Allowed action kinds | Completion |
|---|---|---|
| `band` | `g.band`, `g.bandSkip`, `g.bandFocus` | Accepted band or skip ending this turn |
| `card` | `g.choice` | Accepted common draft pick |
| `offer` | `g.offer`, `g.offerRefresh` | Accepted pick in this window |
| `prep` | `g.buy`, `g.sell`, `g.move`, `g.refresh`, `g.freeze`, `g.levelUp`, `g.equip`, `g.unequip`, `g.art`, `g.destroy`, `g.reward`, `g.choice`, `g.ready`, `g.offer`, `g.offerRefresh` | Accepted `g.ready { ready:true }` |

`g.move` covers placement and movement, with the human `uid`, `to` and optional `dir` fields. Personal choices
use `g.choice { idx, choiceId }`; offers require `offerId`, `pluginId`, `seq`, `idx` and optional `cardId`.
`legalActions` lists kinds admitted for the context, not a promise that any target is affordable or legal now.
Ownership, phase, funds, stock, board geometry, equipment, ready state, draft turn and offer freshness are all
checked by existing handlers. Admin/test actions, pause, autoplay changes, leaving and battle-result reports
are outside the API. No remote code is evaluated.

## Transports, timing and fallback

HTTP sends one `POST` per observation with `Content-Type: application/json` and optional
`Authorization: Bearer …`. Only status 200 succeeds. All redirects are rejected, even to the same host;
credentials are never forwarded. The raw response has the configured size cap and total request timeout
(including connection and trickled bodies); compressed responses are not decoded.

Stdio launches argv directly, without a shell, with one long-lived child per match. Each observation and reply
occupies one UTF-8 JSON line. Several seats/windows may be in flight; echo IDs to correlate replies. Stdout is
protocol-only. Stderr is discarded to avoid leaking secrets through server logs. A crash, bad/oversized line,
unknown reply ID, cancellation or timeout kills the child and fails outstanding requests. A subsequent demand
restarts it only after `backoffMs`; requests during backoff fail immediately. Shutdown uses SIGKILL to bound
cleanup, including programs that ignore SIGTERM. The operator remains responsible for any grandchildren its
own program starts. Match end and disposal terminate the child and cancel pending HTTP requests.

A decision has one total budget across all batches: at most `timeoutMs`, further limited to half the remaining
phase/offer time, reserving the rest for fallback. Untimed phases still use the adapter budget. Existing phase
timers stay armed. Requests are asynchronous; no scheduler callback waits on network or child IO. No AI request
can extend a phase. A reply after a phase/turn change, seat elimination or manual takeover cannot mutate state.

Timeout, transport/protocol failure, reaching the intent cap without completion, or `done:true` without the
required terminal action runs the unchanged legacy decision for that seat. Prep fallback retains sliced
shopping/placement, the existing rehearsal/delegation path, cleanup and Ready. Accepted actions before a failure
stay applied, so legacy continues from the current seat state. Offer fallback retains the existing window default.
Three consecutive failed decisions (configurable) disable external decisions for that seat for the rest of the
match and log the switch once; a completed decision resets the streak. Other seats keep their own counters.

## Journals, security and tests

Test mode's [§34.8 journal](history/0.3.1.md) records external replies (including produced/rejected intents),
transport failure outcomes and ordinary scheduler execution/slice counts. Init records only non-secret policy
limits and seat indices, never URL, argv or token. Replay builds pending decisions but performs no IO: recorded
inputs drive the same validators and legacy fallback. It does not need the original program, credentials or
environment. Existing journal size limits still apply. Older journals select `legacy`; normal golden scenarios
remain unchanged. Virtual-time tools that advance without yielding for IO will naturally hit timeout/fallback;
use the running server to try an external service, or replay a captured test journal offline.

Only configure a service/program you intend to trust. Third parties receive the same public/own-private seat
view a human could see, including player names and private shop/hand. Prefer HTTPS off the host. Local programs
run with the server's OS permissions and inherited environment; this is not a script sandbox. Permission-limited
plugin match hosts can refuse process/network access, in which case the normal bounded fallback applies.
Tokens, transport errors, response bodies and commands are not written to normal server logs. Test journals
intentionally contain AI replies and gameplay inputs; treat them as private debugging records.

Tests: [external-ai.test.js](../test/match/external-ai.test.js),
[external-transports.test.js](../test/match/external-transports.test.js),
[bot-strategy-startup.test.js](../test/bot-strategy-startup.test.js). They cover the envelope and human validation,
view equality / isolation, both examples, bounds, timeouts, failure fallback, seat cutoff, cancellation, and full
real-simulation matches with one external seat plus a legacy peer, replayed offline with matching state and RNG.
