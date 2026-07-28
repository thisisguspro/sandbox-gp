# BRIDGE — Balance & Tuning Reference

This documents every gameplay number, what it does, how it interacts with the
others, and the reasoning behind its current value. Numbers live in
`src/engine/constants.js` (and the mode files for mode-specific values); this is
the *why* behind them. **Targets:** ~55% crew win, 8–12 minute matches (base mode).

> All values are starting points tuned via the headless sim harness
> (`sim.balance.js`) against bot play. They should be refined with real
> playtests — the harness exists precisely to re-tune from real data.

## The core tension (read this first)

The crew win by completing a **journey** (reaching the next landing). The journey
only advances while **engines** are on. But engines-on forces **shields off**
(hard binary), so the hull takes heavy damage during every burn. So the crew
*cannot* simply hold engines on — they must **pulse**: burn toward the landing,
then cut engines to let shields recover and repair the hull, then burn again.
The impostor's job is to make that rhythm fail — sabotage, pull crew to the
energy plane, and run out the clock or destroy the hull.

This is the central knob cluster: **journey distance × engine speed × hull ×
attack damage × attack cadence** together decide both match length and who wins.
Change one and re-run the sim; they are not independent.

## Power economy (`POWER`)

| Value | Current | Role |
|---|---|---|
| MAX | 1000 | pool ceiling |
| START | 200 | opening buffer |
| PER_TASK | 60 | each task adds this — the crew's economic engine |
| OXYGEN_DRAW_PER_SEC | 3 | keeping refills online |
| ENGINE_DRAW_PER_SEC | 6 | running engines (journey) |
| SHIELD_DRAW_PER_SEC | 4 | holding shields |

Tasks fuel everything. If the pool empties, oxygen/engines/shields go dark — a
soft-fail spiral the impostor engineers via sabotage + isolating taskers.

## Journey (`JOURNEY`) — paces the match

- **DISTANCE 1350**, **ENGINE_SPEED_PER_SEC 5** → ~270s of *engine time* to win.
  With pulsed play (engines maybe ~50–60% of the time) that lands matches around
  8–12 min. This is the primary **match-length** lever: raise to lengthen.

## Hull & combat (`HULL`) — the pulse pressure

- **MAX 150**: buffer to survive several burn windows.
- **ATTACK_INTERVAL_SEC 10**: a wave every ~10s.
- **DMG_SHIELDED 2 / DMG_UNSHIELDED 4**: the 2× gap is what *forces* pulsing.
  Unshielded was 12 then 8 in earlier passes (both made play ~100% impostor),
  then 5; eased to **4** when tasks became timed mini-games (see Tasks below).
  Slower power generation meant crews needed slightly less punishing hull loss to
  stay viable — `hull_destroyed` was the dominant impostor win before this change.

Repair stations restore +15 hull per repair (see engine `repairHull`), the crew's
answer to attrition during shield-down windows.

## Oxygen (`OXYGEN`)

- **DRAIN_PER_SEC 0.5** (~200s full→empty), **REFILL_PER_SEC 25**. Air is a slow
  background pressure that pulls players to refill rooms (exposing them to the
  impostor), not a primary kill clock.

## Cable-pull & the two-plane elimination model

This changed materially during tuning. A cable-pull no longer removes a crew
member in one hit:

- **Physical-plane pull** → target crosses to the **energy plane** (still *in
  play*: does energy tasks that feed the same power pool, still counts for parity).
- **Energy-plane pull** (impostor must also be on the energy plane) → **full
  elimination** (removed from parity).
- A **vote** is the crew's tool: a full ejection in one shot.

**Why:** previously a solo impostor reached "parity" almost instantly by shoving
crew to the energy plane once each — the sim showed 100% impostor wins in ~3 min.
Counting downed crew as still-in-play (until truly eliminated) forces the impostor
to do real work and is what brought matches into the target band.

- **cablePullCooldownSeconds**: 45 (small) / 40 (large). Was 30; lengthened so
  pulls are deliberate. `cablePullCooldownMult` (host/perk) scales it — and the
  cooldown *reset* now honors that multiplier (a bug the shakedown found).

## Voting (`VOTE`)

- **ROUND_SECONDS 120** + **GRACE_SECONDS 60** (180 total). Continuous clock;
  majority-of-living instant-eliminates, else leader at grace.

## Draft (`DRAFT`)

- **SECONDS 25** lobby timer; early unanimous votes skip ahead.

## Host config knobs (`MATCH_CONFIG_DEFAULTS` / `CONFIG_SCHEMA`)

Every lever above has a per-match multiplier a host can override (unbounded by
design). The sim's **sweep mode** (`node sim.balance.js sweep <players> <runs>`)
tries combinations of `cablePullCooldownMult × attackDamageMult ×
journeyDistanceMult` and ranks them against the targets — that's how the current
base values were found.

## Modes

Mode-specific numbers live in their files: KotH score-to-win (100) in
`modes/koth.js`; Hot Potato fuse (20→8s) in `modes/hotpotato.js`; Musical Chairs
music/grace windows (10/4s) in `modes/musicalchairs.js`; Who Did It window/air
cost/cases (12s / 20% / 3) in `modes/whodidit.js`. These haven't had a sim pass
yet — they're reasoned starting points.

## Tasks are timed mini-games (`MINIGAMES`, `TASK`)

Tasks are no longer instant. A player **starts** a task, plays a mini-game on the
client, then **completes** it — and the *server* is the timing authority. Each
mini-game has a `minSeconds` (10–13s, landing in the intended 10–20s band) and
the engine refuses a completion that arrives earlier than `minSeconds −
EARLY_GRACE_SEC (1.5s)`. A client therefore cannot skip the game. Started tasks
auto-expire after `ABANDON_SEC (60s)` and must be restarted.

Mini-games: `wire_connect`, `code_sequence`, `alignment`, `hold_timing`
(physical) and `flux_route`, `phase_match` (energy-plane variants). The type is
assigned per task at generation and exposed in the view so the client renders the
right game; the server only checks elapsed time + room presence.

**Balance impact:** timing tasks slowed power generation (power is now gated by
real seconds, not instant clicks), which shifted matches toward impostors —
`hull_destroyed` became the dominant impostor win at 8–10 players. The
compensating change was unshielded hull damage 5 → 4 (above). After that, 8p sits
~59% crew / 4.5m median.

## Current sim results (bots, with timed tasks; DMG_UNSHIELDED 4)

| Players | Crew win | Note |
|---|---|---|
| 5  | ~89% | small crews cruise — lone impostor underpressures |
| 6  | ~67% | crew-favored |
| 8  | ~59% | near target |
| 10 | ~43% | impostor-favored dip |
| 12 | ~85% | 2 impostors but bots don't coordinate |
| 16 | ~61% | reasonable |

**Honest status:** 8/10/16 are in a fine band; **5–6 and 12 still skew crew**.
This is a per-player-count *skew*, not a global imbalance. I tried a per-count
journey-distance scaler to smooth it and **reverted it** — against bots it either
overshot (5p → 0% crew at 1.45×) or didn't cleanly help (12p), i.e. it was
overfitting to bot behavior. The two real levers are impostor *coordination*
(which bots don't model — they don't team up, so 2-impostor counts like 12
under-perform for impostors in sim but would not with real players) and the 1→2
impostor cliff at 11. **Both are best tuned against real playtest data, not bots.**
The sweep harness (`node sim.balance.js sweep <players> <runs>`) and the
per-count win-reason breakdown (now printed by the sim) are the tools to do that
once real games exist.

