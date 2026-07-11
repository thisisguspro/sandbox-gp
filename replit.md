# SANDBOX GP

3–4 player online combat kart racer. Toy-box / putt-putt aesthetic, chibi big-head
racers in kid-sized ride-on cars. **Everything in the world is secretly made of sand**
(damage = erosion, deaths leave sand-pile hazards, weapons are water-based). Signature
mechanic: mid-race item pickups trigger PERSONAL skill challenges (hoops/gates/secret
missions visible only to that racer); performance decides the item TIER received.

Forked from Iron Frontier / Project BRIDGE. The shell (accounts, friends, lobby
netcode, bots, shop, payments, cosmetics, admin, i18n) is the BRIDGE shell, kept
intact. The social-deduction gameplay was fully removed.

## Hard design rules — never violate
- ALL cars have identical speed/acceleration/handling. Cosmetics are VISUAL ONLY.
  Only items earned mid-race alter performance. Never pay-to-win.
- Challenges render in-world for one player only; the car keeps racing the shared track.
- No guns, no gore — water weapons only (kid-friendly rating target).
- Palette: warm beach tones (sand/sun/coral/turquoise). NO PURPLE.

## Architecture
- `game/bridge-backend/` — Express REST: auth, profile, store, payments, admin (port 4000 standalone)
- `game/bridge-gameserver/` — authoritative Socket.IO (port 5000 standalone).
  `src/net/` (rooms/social/rejoin) is engine-agnostic and MUST NOT be broken.
  `src/engine/RaceEngine.js` is the race engine — currently a Batch 1 STUB
  (auto-advancing progress race). The engine contract it satisfies is documented
  in README.md; the real Three.js race replaces the stub behind that contract.
- `game/bridge-client/` — Vite/React. Shell screens (SignIn, Hangar, Locker, Shop,
  Wheels, Perks, Profile, News, Settings, Admin) kept from BRIDGE; `screens/Play.jsx`
  holds lobby + `RaceStub` (placeholder) + Results.
- `game/bridge-deploy/` — combined single-port server for hosting (PORT=8080).

## Run
Each game/* package uses plain npm (NOT the root pnpm workspace):
backend/gameserver/client/deploy → `npm install`; client → `npm run build`;
then `PORT=8080 node game/bridge-deploy/server.js`. Dev sign-in auto-enables
outside production (NODE_ENV/REPLIT_DEPLOYMENT gate in backend config).

## Verify before claiming anything works
- `game/smoke-test.mjs` (services + auth + store + wallet) — must be 9/9
- `game/race-flow.test.mjs` (full lobby→race→results→rematch over Socket.IO) — must be 15/15
- `npm run build` in bridge-client must pass clean

## Known intentional state (Batch 1)
- The race is a stub: no track, no driving input, cars auto-advance. Batch 2 = Three.js core.
- Cosmetics/store still show Iron Frontier items (hats/bandanas on chibi pilots) — the
  Sandbox GP retheme is Batch 7; do not delete `public/characters|items|overlays`.
- Internal package names remain `bridge-*` on purpose (rename = regression risk, no value).
- `public/textures/` was deleted (only the removed deduction stage used it).
