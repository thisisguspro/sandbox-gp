# SANDBOX GP — Run & Getting Started

Toy-box combat kart racer (Batch 1: shell + placeholder race). This guide gets
all the pieces running locally so you can play. See ../README.md for the full
project state and roadmap.

## What's in the box

| Folder / file | What it is | Port |
|---|---|---|
| `bridge-backend/` | Accounts, economy, cosmetics, stores, Stripe (test), admin, events | **4000** |
| `bridge-gameserver/` | Authoritative real-time game server (Socket.IO) | **5000** |
| `bridge-client/` | The game UI (Vite + React) | **5173** |
| `bridge-admin-console.html` | Standalone operator console (double-click to open) | — |
| `bridge-preview.html` | Standalone visual preview of the screens (double-click) | — |
| `smoke-test.mjs` | Checks all services are up & talking | — |

## Prerequisites

- **Node.js 18 or newer** (uses built-in `fetch`). Check with `node -v`.
- Three terminal windows (one per service).

## First-time setup

Install dependencies in each of the three service folders:

```bash
cd bridge-backend     && npm install
cd ../bridge-gameserver && npm install
cd ../bridge-client     && npm install
```

(The client also reads optional `bridge-client/.env`; the defaults already point
at `localhost:4000` and `localhost:5000`, so you don't need one for local play.)

## Run it (three terminals)

**Terminal 1 — backend**
```bash
cd bridge-backend
npm start            # -> "BRIDGE backend on :4000 (store=memory)"
```

**Terminal 2 — game server**
```bash
cd bridge-gameserver
npm start            # -> "BRIDGE game server (Socket.IO) on :5000"
```

**Terminal 3 — client**
```bash
cd bridge-client
npm run dev          # -> Vite prints a http://localhost:5173 URL
```

Open the printed URL (usually <http://localhost:5173>) in your browser.

> Dev sign-in is stubbed — just enter a name to get in. Google OAuth and live
> Stripe are drop-ins for later (see "Payments" below).

## Verify everything's talking

With the backend and game server running, from this top folder:

```bash
node smoke-test.mjs
```

It checks both `/health` endpoints, the client dev server (optional), and runs a
real backend flow (sign-in → profile → store → wallet → settings). Green means
you're good to play. If it fails, the most common cause is a service that isn't
running — re-check the three terminals.

## Play

1. Open the client, sign in with any name.
2. Explore **Hangar** (progression), **Locker** (equip cosmetics), **Shop**,
   **Wheels** (bind your comms/emote wheels), **Options**.
3. Go to **Play** → host a room (you get a 5-character join code) or Join Random.
4. To actually start a match you need enough players for the map's minimum. Two
   ways to get there:
   - **Add bots** (easiest for solo testing): as host, use the **Add a Bot**
     controls in the lobby to add bots at three difficulty tiers — **Recruit**
     (passive), **Pilot** (standard), **Ace** (aggressive). Mix tiers freely up to
     the player cap. Bots get roles normally, so a bot can be the impostor, and
     they play the full match (tasks, movement, sabotage, hunting, voting).
   - **Multiple tabs/people**: open the client URL in several browser tabs/windows
     and join the same code from each. Each tab keeps its own sign-in (the session
     token is per-tab), so you can be a different pilot in each.

   The host then starts the perk **draft**, then the **match**.
5. In match: **WASD** (or click the floor) to move, **E** to do a task / refill /
   repair where you're standing, **F** (impostor) to cable-pull a nearby crew
   member, **Q** for the sabotage menu, **hold C** for the comms wheel, plus the
   **Eject Vote** button. First-time players get **on-screen control hints** in the
   lower corner showing what's pressable right now, plus rotating **gameplay
   tips** — both default ON and can be turned off in Options → Accessibility.
   Getting cable-pulled crosses you to the **energy plane** — still in play. The
   match ends with a results screen (impostor reveal + XP); the host can
   **Rematch** the same crew.

## Admin console

Double-click `bridge-admin-console.html`. It opens in **mock mode** by default so
you can explore (Accounts, Bulk, Events, Store, Admin roles). To point it at your
running backend, set `USE_MOCK = false` near the top of the file and sign in with
an admin account. The **Store** tab is where you edit item prices plus the
admin-only `dropWeight` (loot-box likelihood) and `worth` (internal value) — these
are never sent to players.

## Payments (test mode)

The cash store runs Stripe in **test mode**: the $1 items use a stubbed checkout
that simulates a confirmed payment — no card is charged. To go live you add real
Stripe keys (the live code path is present and commented in
`bridge-backend/src/routes/payments.js`). Real charges have tax/receipt/legal
considerations to handle before shipping.

## Troubleshooting

- **`EADDRINUSE` / port already in use** — a previous server is still running.
  Stop it (Ctrl-C in its terminal) or kill the process on that port, then retry.
  You can also run any service on another port, e.g. `PORT=4001 npm start` for the
  backend or game server (update `bridge-client/.env` to match).
- **Client can't reach the servers** — confirm terminals 1 & 2 are up and
  `node smoke-test.mjs` is green. If you changed ports, set `VITE_BACKEND_URL` /
  `VITE_GAME_URL` in `bridge-client/.env`.
- **"Not enough players to start"** — the map has a minimum; open more tabs and
  join the same code, or host a smaller map.

## Notes on what's verified

The backend, game server, and engine are covered by automated checks (the game
engine has 137 passing tests; the store/payments/voting/sabotage/energy-plane and
rematch flows have all been verified against a live server). What hasn't been done
is a real multi-person browser playtest — that's the next milestone, and the feel
of the in-match UI (movement, wheels, timers) is best confirmed by playing it.
