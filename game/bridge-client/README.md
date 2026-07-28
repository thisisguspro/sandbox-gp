# BRIDGE — Game Client

A single combined React client for **BRIDGE**: pilot progression (Hangar),
cosmetics (Locker), and the live match with a tactical minimap (Play). Built with
Vite + React, wired to the real backend (`:4000`) and game server (`:5000`) over
REST + Socket.IO. Dramatic-shonen aesthetic — speed lines, impact bursts, bold
kanji flourishes, hot sun-red accent.

## Run it

You need the **backend** and **game server** running first (see their READMEs):

```bash
# terminal 1 — backend
cd ../bridge-backend && npm install && npm start      # :4000

# terminal 2 — game server
cd ../bridge-gameserver && npm install && npm start    # :5000

# terminal 3 — this client
npm install
npm run dev                                            # :5173
```

Open http://localhost:5173. Sign in with any call sign (the backend's Google
OAuth is stubbed in dev). Use the email field to sign in as the configured
superadmin if you want admin powers. Progress, cosmetics, and XP are real — they
persist in the backend for your account.

### Pointing at different servers

URLs default to localhost. To override, copy `.env.example` to `.env` and set
`VITE_BACKEND_URL` / `VITE_GAME_URL`.

## What's here

- **Hangar** — progression home. Your rank, the XP bar toward the next level,
  and the full unlock ladder (what each level grants). Real `/profile` +
  `/profile/catalogue` data.
- **Locker** — pick a slot, see owned vs. locked cosmetics, equip/unequip. A live
  SVG pilot preview reflects your loadout. Real equip flow.
- **Shop** — three storefronts wired to the backend: **Credits Store** (buy with
  earned currency), **Cash Store** (real-money / $1 test items via Stripe in test
  mode — no card charged), and **Loot Boxes** (server-rolled, with a reveal
  animation). A balance header shows Credits + Prisms. Players never see the
  admin-only worth/dropWeight.
- **Wheels** — radial editors for the 8-slot **Comms wheel** (bind voice
  commands) and **Emote wheel** (bind owned emotes). Saves each slot to the
  backend; this is the in-match hold-to-open quick-select.
- **Options** — Audio / Graphics / Accessibility / Controls, rendered from the
  backend's settings schema. Sliders, toggles, selects, and live key rebinding;
  partial saves persist per change.
- **Play** — connect to the game server, host a room (5-char join code) or join
  random, run the perk draft, then the live match rendered as a **real-time
  isometric (2.5D) playfield**: you see anime pilot models walking around the
  station in real time. **Click anywhere on the floor to walk there** (the server
  is authoritative; other players are interpolated between its 10 Hz updates for
  smooth motion). Ship-status gauges (hull, power, your O₂, journey) and the
  tactical minimap frame the stage; a floating HUD shows tasks in your room,
  station actions (refill/repair/engines), sabotage, and pull/vote on pilots
  near you. The camera follows your character.

Classic mode is the focus; event/mode pickers are intentionally omitted here.

### Real-time model

Movement is continuous: every player has an authoritative world x/y on the
server, which runs a 10 Hz tick and streams positions. The client renders the
isometric view from the map's `geometry` (room rectangles + corridors) and eases
remote players toward their latest server position each animation frame. Walking
into a station's room lets you use it; walking near another pilot lets you act on
them. This replaced the old room-button navigation.

## How testing this was approached

The client builds clean (`npm run build`), and every field it reads from the
game server's per-player view was verified against the *live* server output (the
match view really does include the map adjacency the minimap draws, the journey/
hull/power values, per-player ID colors, etc.). What hasn't been done is a
human click-through in a browser against running servers — the visuals and feel
are best confirmed by you running it. If a screen looks off, that's the place to
look, not the data wiring.
