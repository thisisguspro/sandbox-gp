# SANDBOX GP

A 3–4 player online combat kart racer where **everything is secretly made of sand**.
Toy-box aesthetic (think putt-putt course meets Toca Boca), chibi big-head racers in
kid-sized ride-on cars, water-based weapons, and the signature mechanic: mid-race item
boxes trigger **personal skill challenges** (hoops, gates, secret missions, visible only
to you) — the better you perform, the better the item tier you pull.

Forked from the Iron Frontier / Project BRIDGE codebase: the entire **shell**
(accounts, friends, invites, lobby netcode, bots, shop, payments, cosmetics,
achievements, admin, i18n) is carried over intact. The social-deduction **gameplay**
was fully removed and replaced by a race engine.

---

## Current state — Batch 1 (shell fork, verified)

**What works end-to-end right now:**

- Full account/economy shell: dev sign-in → profile → 40-item store → wallet → settings
- Lobby lifecycle over real Socket.IO: create/join/join-random/rejoin, friend invites,
  direct-join, streamer-mode decoy code, host bot add/remove, rematch
- A **placeholder race** (`RaceEngine` stub): host starts → 3-2-1 freeze → all racers'
  progress advances server-side → finish order → placements → results screen →
  XP/match reporting to the backend. Bots fill seats and race.
- Combined single-port deploy server (backend + game socket + built client on one port)

**What is intentionally a stub:** the race itself. Cars drive themselves. There is no
track, no input, no items yet. That is Batch 2.

**Verification (all green):**

- `game/smoke-test.mjs` — 9/9: services healthy, dev sign-in, profile, store, wallet, settings
- `game/race-flow.test.mjs` — 15/15: socket → room → 3 bots → start → freeze →
  progress advancing → ended → 4 placements → winner === 1st place → win reason →
  full lobby→active→ended lifecycle → rematch back to lobby with roster intact
- Client production build: clean (92 modules)

## Run it locally

```bash
cd game/bridge-backend   && npm install
cd ../bridge-gameserver  && npm install
cd ../bridge-client      && npm install && npm run build
cd ../bridge-deploy      && npm install
PORT=8080 node server.js
# open http://localhost:8080  (dev sign-in is enabled outside production)
```

Verify:

```bash
cd game
BACKEND_URL=http://localhost:8080 GAME_URL=http://localhost:8080 CLIENT_URL=http://localhost:8080 node smoke-test.mjs
node race-flow.test.mjs
```

## Repo map

| Path | What it is |
|---|---|
| `game/bridge-backend/` | Accounts, economy, cosmetics, store, Stripe (test), achievements, admin, i18n |
| `game/bridge-gameserver/` | Authoritative Socket.IO server. `src/net/` = rooms/social/rejoin (kept from BRIDGE). `src/engine/RaceEngine.js` = **the race** (stub) |
| `game/bridge-client/` | Vite + React UI. Shell screens kept; `RaceStub` renders the placeholder race |
| `game/bridge-deploy/` | Combined single-port server (Render-style hosting) |
| `lib/` | Shared db schema / api spec |

Internal package names still say `bridge-*` — renaming them is pure regression risk
with zero player value, so they stay until there's a reason.

## The engine contract (how Batch 2 slots in)

`net/RoomManager.js` instantiates one engine per room. The netcode only consumes this
surface, so the real race engine replaces the stub **without touching the net layer**:

```
players (Map)  phase  config  mode  map  winner
addPlayer(name, account)  removePlayer(id)  start({force})
tick(dt)  viewFor(playerId)  eventsFor(playerId)  matchResult()
drainBountyClaims()  isEventHost(id)  setEmote(id, e)  sendSpeech(id, t)
```

Driving inputs will arrive as a single `race_input` socket event (reserved, not yet wired).

## Roadmap (build order)

1. ~~**Batch 1** — fork shell, strip deduction, stub race, verify loop~~ ✅
2. **Batch 2** — Three.js race core: one track, car physics (identical stats for all),
   over-the-shoulder camera + rear-view mirror, full driving input at 20–30 Hz tick
3. **Batch 3** — multiplayer sync polish + real bot drivers
4. **Batch 4** — the signature mechanic: item boxes → personal in-world challenges
   (narrowed ribbon / hoops / gates / secret missions) → item **tiers**
5. **Batch 5** — the item pool (data-driven loot table): water balloons, squirt stream,
   sprinkler patch, The Wave, beach kite (drag-to-stop), bucket shield, juice-box turbo
6. **Batch 6** — sand physics identity: erosion damage, sand-pile death hazards,
   bucket-mold respawn, shovel reset button
7. **Batch 7** — Sandbox GP retheme of the shell: Sand Dollars / Seashells currencies,
   Lemonade Stand shop, beach-warm palette (no purple), cosmetic slot definitions for
   racers/cars/kits

## Design rules (do not break)

- **All cars identical** — same speed/accel/handling. Cosmetics are visual only.
  Only in-race earned items alter performance. Never pay-to-win.
- **Challenges are in-world, not overlays** — you keep driving the shared track while
  your personal hoops/ribbon render only for you.
- **Everything is sand** — damage erodes, deaths leave sand-pile hazards, weapons are water.
- Kid-friendly rating target: no guns, no gore.
