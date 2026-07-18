# Project BRIDGE — Game Server (Slice 4, mechanics v0.2)

The authoritative real-time server: rooms, secret role/impostor assignment,
the breather/oxygen system, the energy plane, sabotage, movement, continuous
voting, and all win conditions. Built in two layers:

- **`src/engine/`** — the pure game engine. Holds the full truth of a match and
  exposes only *redacted per-player views*. No networking, fully unit-testable.
- **`src/net/`** — a thin Socket.IO layer that receives inputs, calls engine
  methods, and pushes each player their own view. It makes **no** game
  decisions, so all authority stays in one auditable place.

## Run

    npm install
    npm run dev        # game server on :5000  (health: /health)
    npm test           # engine simulation suite (131 assertions); a headless balance sim; and a live two-server shakedown

## Core mechanic: breathers, oxygen, and the energy plane

Every player wears a breather fed by a backpack oxygen tank. The tank drains
over the match, so at least once per match everyone must reach a **refill
station** to top up — which pulls people into the open and exposes them.

A player is **downed** when their tank empties, when an impostor detaches their
air cable, or when a vote against them passes. Downing does **not** remove them.
Instead they cross to the **energy plane**: a dreamlike mirror of the same map
where they interact only with energy and non-physical objects, receive a
different (energy-themed) task set, and — crucially — those tasks still feed the
ship's power (see below). The downed keep helping the mission.

## Power economy: tasks fuel the ship

Tasks are no longer a win bar — they generate **power** into a running pool.
Three systems drain that pool per second while crew run them at their stations:

- **Oxygen machine** (the refill stations) — needs power to work. If the pool
  empties or the system is switched off, refills go offline and everyone drains
  toward the energy plane. Suffocation is now a *consequence of an unpowered
  ship*, not just individual neglect.
- **Engines** — drain power to advance toward the next landing location.
- **Shields** — drain power to absorb attack damage.

Crew control each system's draw at its station. **Engaging engines forces
shields fully OFF** (a hard binary): you can sprint toward the destination but
take heavy hull damage while you do. Impostors' fake tasks generate **no**
power, so suppressing real task completion starves the whole ship — their most
powerful indirect lever.

## Hull, combat, and turrets

The ship is under attack. Attack waves hit on a cadence: with shields up the
hull barely scratches; with shields down (because engines are running, or the
pool is empty) the hull takes heavy damage. **Hull at zero is a crew loss.**

"Fight off boarders" tasks spawn at **turret stations**, and like all tasks they
feed the power pool — so manning turrets both defends and fuels the ship. Turret
count scales with the map and is always at least 2 and at least 2× the impostor
count:

| Map | Impostors | Turrets |
|---|---|---|
| Nebula Drift (small) | 1 | 2 |
| Ironhold Station (large) | 2 | 4 |

**Repair stations** divert power into the hull (a flat heal, costs power, makes
no journey progress) — the turtle option when the hull is in danger.

## Sabotage

The saboteur has an active toolkit. A single **global cooldown** gates
triggering *any* sabotage, so they can't be chained — but the cable-pull keeps
its own separate cooldown, so detaching cables isn't blocked by sabotage timing.
Different sabotages can be active at the same time.

- **Life Support Offline** — disables every refill station; anyone low on air
  crosses over if crew don't restore it. No timer.
- **Reactor Meltdown** — a hard fuse; if not resolved in time, impostors win.
- **EMP Power Outage** — freezes task completion on **both** planes (no power
  income at all) until repaired. No timer; needs a **multi-location** fix
  (three resolve points), making it the scariest play.
- **Position Leaked (Attract Attackers)** — leaks the ship's position so attack
  waves come faster and hit harder. Auto-expires, or crew can repair it early.
- **Lights Out** — crew get a dimmed, low-info view (they see only their own
  room); the impostor sees normally via nightvision. Auto-expires or is repaired.
- **Comms Blackout** — disrupts comms. No timer.

Each repairable sabotage is cleared by enough crew acting at its resolve rooms.

## Voting (continuous, on a clock)

There is no separate meeting phase. Votes accumulate continuously against living
players, and majority-of-living is the bar:

- A vote round runs **2 minutes**. At the 2:00 mark, if more than half of living
  players have voted **and** someone holds a majority, that player is eliminated.
- If no majority at 2:00, a **grace minute** runs to 3:00 targeting the current
  leader — but the instant anyone crosses majority during that minute, they're
  eliminated immediately. Then the clock resets.
- Elimination auto-unplugs the target's tank (they cross to the energy plane),
  announced by the robotic UI line **"Player eliminated."**

## Why this design (anti-cheat)

The engine never hands a client the full state. `viewFor(playerId)` returns a
view where other players' roles read `"unknown"` unless the viewer is allowed to
know (a fellow impostor, a downed player, or post-game). The private `downed`
cause event is stripped from living crew via `eventsFor(playerId)`. A cheating
client reading its own memory therefore learns nothing it shouldn't — the secret
simply isn't there.

Every player action validates before mutating (in-room checks for tasks, cable
pulls, and refills; commander-only energy; cooldowns; capacity limits). Invalid
inputs become a clean per-socket error, never a state change.

## Maps: modular generator + balance

Maps are assembled by a generator (`src/engine/mapgen.js`) from a room library,
scaled to the player count, then connected into a graph that obeys layout rules:
guaranteed connectivity, no single-exit rooms (no death traps), a hub spine with
branching function rooms (chokepoints, not a uniform mesh), spread-out refill
stations, and turrets at the perimeter. Pass `mapId: "procedural"` with a player
count (or `"procedural:12"`) to generate; movement then respects room adjacency.
Named maps are frozen generator outputs, so fixed and procedural share one path.

Balance numbers are documented in `TUNING.md` and validated by the headless sim
harness `sim.balance.js` (`node sim.balance.js [runs] [players] [map]`, or
`node sim.balance.js sweep <players> <runs>` to search lever combinations). The
sim drives the engine with bot AI and reports win rates, match length, and red
flags against the targets (~55% crew, 8–12 min). It surfaced the core
journey/hull/cable interactions and the two-plane elimination model below.

## Map-driven scaling

Crew size and impostor count come from the map definition in
`src/engine/constants.js`, never hardcoded:

| Map | Crew | Impostors | Refill stations |
|---|---|---|---|
| Nebula Drift (small) | 5–10 | 1 | Medbay, Engineering |
| Ironhold Station (large) | 10–20 | 2 | Medbay, Engineering, Hangar |

Adding a map is a new entry in that file — no logic changes.

## Socket events

Client → server: `create_room`, `join_room`, `start_match`, `move`, `allocate`,
`refill`, `set_system`, `repair`, `complete_task`, `detach_cable`, `sabotage`,
`resolve_sabotage`, `vote`, `start_draft`, `vote_perk`, `voice_command`, `speech`.

Server → client: `state` ({ roomId, view, events }) pushed on every change, and
`error_msg` for rejected actions.

## Communication scope

Living players can communicate only with others **in the same room** (proximity).
Downed players share **one map-wide energy channel**. The planes are asymmetric:
the **downed hear everyone** (living speech near them, plus the energy channel),
but the **living never hear the downed**. The engine exposes channel membership
in each player's view and routes every message to an explicit recipient list.

**Voice commands & captions.** Players send canned voice commands (no free
typing) — language-agnostic keys like `SOS`, `SABOTAGE_HERE`, `REFILL_HERE`,
`SUSPECT` — with params auto-resolved (a `room` command captures the speaker's
location; a `player` command names a target). The client localizes each key into
the listener's chosen language, so "SOS in Reactor" arrives translated. Routing
matches voice (proximity for living, map-wide for downed).

Every audible message — a voice command, or proximity speech — is also emitted
as a **caption**: text tagged with who said it, delivered to exactly the players
who would have heard it. This serves accessibility and players without audio. The
engine carries no audio itself; it owns the routing and the captions, so real
WebRTC voice can be layered on later using the same recipient lists. Optional
speech-to-text transcripts can be attached to a `speech` event for captioning.

Socket events: `voice_command` ({ command, targetId? }) and `speech` ({ text? }).

## Lobbies, matchmaking & host config

A lobby is just a room in its waiting (`lobby`) phase. The host **creates a
room** and gets a **5-character join code** (a confusion-free alphabet, no
0/O/1/I/L, so it's easy to read aloud). Three entry paths:

- **Join Friend** — `join_room` with the code.
- **Join Random** — `join_random` drops you into any open *public* lobby still
  waiting and under the map cap; if none exist, it **spins up a fresh public
  lobby** with default config (so you never land in someone's extreme custom
  game uninvited).
- **Public/private** — the host's `isPublic` flag controls whether Join Random
  can find the lobby; private lobbies are code-only.

The host configures the match via `create_room` (and can tweak it live in the
lobby with `update_config`, host-only). Config is **freely settable — no bounds
enforced**, by design, so custom games can be as wild as you like. The schema
(`CONFIG_SCHEMA` in `src/engine/constants.js`) groups knobs as **standard**
(movement speed, visibility, attack frequency/damage, impostor count, sabotage
cooldown, oxygen drain, task power, journey length) and **crazy** (off by
default: body/head size, low gravity, infinite oxygen, glass hull, no voting).
The engine reads the merged config at match start; impostor-count and
infinite-oxygen overrides, the multipliers, and the cosmetic/feel flags all flow
through. The host hits `start_draft` once the lobby has enough players for the
map (`minPlayers`), which runs the perk draft, then roles are assigned.

Socket events: `create_room` ({ config, name, token }), `join_room`,
`join_random`, `update_config`, `start_draft` / `start_match`.

## Perk draft (pre-match)
Before roles are revealed, the lobby enters a **draft phase**. The team sees a
single **mixed list** of crew and impostor perks and votes on perks *directly*;
the **top 3** win and apply globally for the match. Because the list mixes both
sides and perks are never tied to a player, the draft can't leak who's the
impostor. There's a timer (default 25s); if everyone votes it resolves early,
otherwise the highest-voted perks win when the clock runs out.

Perks are deliberately subtle and live in one place (`PERKS` in
`src/engine/constants.js`) for easy balancing. Examples: a larger power pool,
slower oxygen drain (you still must refill, just later), more power per task,
slightly faster movement for *everyone* including the impostor, and impostor-side
perks like shorter cooldowns or longer-lasting Lights Out. Crew perks buff the
crew, impostor perks buff the impostors, symmetric perks affect all.

Flow: `start_draft` (host) → players `vote_perk` → resolves on timer or when all
have voted → roles are assigned and the match begins. `start_match` still works
for a quick match with no draft.

## Win conditions

- **Crew win:** engines carry the ship to the next landing location, or every
  impostor is downed (by vote or oxygen — only impostors detach cables).
- **Crew lose / impostors win:** the hull is destroyed, impostors reach
  numerical parity with living crew, or the reactor sabotage fuse expires.
- Impostors don't have to throw a punch: starving the power pool by suppressing
  tasks knocks out oxygen and stalls the engines on its own.

## Not yet wired

- Persistence — matches are in-memory; results aren't yet reported to the app
  backend (that connection comes when integrating the stack).
- Reconnection keeps a player's slot on disconnect during a match, but the
  client-side resume flow isn't built.
- The robotic-voice announcement is a UI concern; the engine emits the
  `player_eliminated` event that the client turns into the spoken line.

## Integration with the backend

The game server and backend are wired together (shared-secret model):

- **Identity:** players join with the session token the backend issued at login.
  The game server holds the same `JWT_SECRET`, so it verifies the token itself
  and knows which real account is connecting — no per-join round-trip. Set
  `ALLOW_GUESTS=false` to require sign-in.
- **Loadout & perks on join:** the server calls the backend's `/internal`
  service API (with a shared `SERVICE_KEY`) to fetch each player's equipped
  cosmetics and unlocked perks. The draft candidate list is **pooled** from the
  team's unlocked perks (topped up from the catalogue if the pool is thin).
- **Identity colors:** every player is force-assigned a unique color + a
  colorblind-friendly shape (in `ID_COLORS`). The color is carried by the
  always-visible breather (mouth/nose piece) and the O2 tank, and the shape
  floats above the player's head — both independent of cosmetics, so players are
  always distinguishable. (The bandana is now a pure cosmetic, not an ID.)
- **Results & XP:** when a match ends, the server reports participants and the
  winner to `/internal/match-result`; the backend awards XP server-to-server, so
  clients can never grant themselves XP. Guests (no account) are skipped.

Env: `JWT_SECRET`, `SERVICE_KEY`, `BACKEND_URL`, `ALLOW_GUESTS`.
Run `node integration.test.js` with both services up to verify the full wiring.

## Events & bounties (game-server side)

The game server applies backend-owned events at match time. On join it receives
the player's active-event flags in the match profile. If a player is a
`BOUNTY_TARGET` and a saboteur cable-pulls them down, the engine queues a bounty
claim (`drainBountyClaims()`), which the net layer reports to the backend to
grant the reward once. An `EVENT_HOST` may force-start a match below the map
minimum (`startDraft({force})` / `start({force})`). Game modes named by an event
(`mode`) are reserved for pluggable modules added later.

## Pluggable game modes

Game modes are optional engine modules in `src/engine/modes/` that hook into the
match lifecycle. A mode may **replace** the base win conditions and override what
happens when a player is downed. The interface (`modes/index.js`) is a set of
optional hooks — `onMatchStart`, `onDown`, `checkWin`, `tick` — the engine calls
when a mode is active; with no mode, base rules run unchanged.

Modes are selected **only via an event**: an event names a `mode`, and an
event-host sets it on the lobby (the `mode` config key is rejected for anyone
who isn't an event host, or for a mode no active event names). This keeps modes
as curated live-ops rather than fragmenting normal matchmaking.

**Modes ship so far:**

- **Infection** (`infection`) — a few start infected (reusing the impostor side);
  downing a survivor *converts* them to a hunter instead of crossing them to the
  energy plane. Infected win when all are converted; survivors win by reaching
  the location. This mode keeps the full ship simulation (`usesBaseSimulation`).
- **King of the Hill** (`koth`) — a random room is the hill; players in it score
  each tick, full rate when alone and split when shared; first to the threshold
  wins. Cable-pull is repurposed as a non-lethal *shove* that drops a rival to
  25% air (clear the hill without killing).
- **Hot Potato** (`hotpotato`) — one holder carries a fused bomb, passed by an
  action to a same-room player (`pass_potato`); on detonation the holder is
  downed and a fresh, faster potato spawns. Last player standing wins.
- **Musical Chairs** (`musicalchairs`) — rounds of music (free movement) then a
  random safe room is announced; anyone not in it when the grace window closes
  is out. Repeat until one remains.
- **Who Did It?** (`whodidit`) — a deduction round: a random **detective** is
  chosen; during a strike window a **culprit** pulls the detective's cable
  (which arms a guess instead of downing them); the detective names a suspect.
  Wrong costs 20% air; correct instantly downs the culprit and banks a case.
  Three solved cases wins for the detective; if the detective's air runs out the
  pullers win. The culprit is never exposed in the view — guessing is the game.
  New actions: `guess`. The culprit's identity stays server-side.

The last three are bespoke survival modes: they skip the ship simulation
(power/combat/journey/sabotage/voting) but keep oxygen, and drive their own
clocks via the mode `tick` hook. Adding another mode is a new module registered
in `modes/index.js` — no engine rewrite.

## Live shakedown

`shakedown.test.js` is a full end-to-end harness: it boots BOTH servers as child
processes, then drives a complete scenario over real HTTP + Socket.IO — accounts,
an admin-created Infection event with a reward, an event-host lobby, real-token
joins, event-gated mode selection, a force-start, the match played to a real
winner, and server-to-server XP award — then tears both servers down. Run with
`node shakedown.test.js` (needs both services' deps installed). It runs in one
process so nothing leaks. This is what surfaced the cable-cooldown fix below.

> Fix found via the shakedown: the cable-pull cooldown *reset* now honors the
> effect multiplier (`_eff("cableCooldown")`) like the initial value does, so the
> QUICK_FUSES perk and the host's `cablePullCooldownMult` actually affect repeat
> pulls — previously the reset used the raw map value and ignored both.
