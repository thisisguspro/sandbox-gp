# SANDBOX GP — CrazyGames submission notes

## Building the upload
```
cd game/bridge-client
./build-crazygames.sh
```
Outputs `sandbox-gp-crazygames-upload.zip` (built with `VITE_CRAZYGAMES=1`, index.html
at zip root). Upload it as an HTML5 game on https://developer.crazygames.com.

The NORMAL build (`npx vite build`, no flag) must be used for Render — it never
loads the CrazyGames SDK and all integration code is a silent no-op.

## What the integration does (src/api/crazygames.js)
- Loads SDK v3 dynamically, `await SDK.init()`, detects environment
  (local / crazygames / disabled). Off-platform or adblocked → the game runs
  fully with every call a no-op (verified: full race completes with the SDK
  script blocked).
- `loadingStart()` at boot → `loadingStop()` when the menu is interactive.
- `gameplayStart()` when a race goes active, `gameplayStop()` at race end and
  on leave. Initial download measured to first gameplayStart: **~1.8 MB**
  (limit 50 MB; ≤20 MB is required for the mobile homepage — we qualify).
- `updateRoom({roomId: joinCode, isJoinable, inviteParams:{code}})` while in a
  lobby (joinable only with a free seat, lobby phase). The platform renders the
  invite button / friend-join from this. A friend arriving via invite lands
  with `getInviteParam("code")` → auto-joins through the normal join path.
- `happytime()` on WINNING a race only (docs say use sparingly).
- Midgame ads via `ad.requestAd("midgame", …)` at the two natural breaks:
  Rematch and Return-to-Lobby after a race. Audio (sfx + music) is hard-muted
  for the ad's duration and restored on finish/error. Local 180s cooldown on
  top of the SDK's own ~3-minute cooldown. Ad errors/unfilled/adblock never
  block the flow.
- Space/arrow-key page scrolling suppressed globally (CG requirement).

## Size audit (against CG technical requirements)
- Total build: ~103 MB (limit 250 MB) ✓
- File count: ~160 (limit 1500) ✓
- Initial download to gameplay: ~1.8 MB (limit 50 / 20 for mobile) ✓

## Pre-submission checklist (developer portal)
- [ ] Thumbnail(s): 16:9 cover, high-contrast; test at small sizes. Portal will
      ask for specific dimensions at upload time.
- [ ] Category: .io / Casual / Racing / Multiplayer tags.
- [ ] Description + controls (WASD/arrows, SPACE item, SHIFT look-back, R reset).
- [ ] Test in the portal Preview / QA tool — the SDK runs in the real
      `crazygames` environment there; verify: demo→real midgame ad on Return to
      Lobby, invite button appears in a lobby, invite link joins the room.
- [ ] Bots fill empty lobbies (already automatic) — required for multiplayer QA.
- [ ] Basic Launch runs ~2 weeks and is judged on playtime, conversion to
      gameplay, and retention; analytics (VITE_ANALYTICS) can mirror what CG
      measures so numbers can be compared.

## Local testing
`VITE_CRAZYGAMES=1 npx vite build` then serve on localhost — the SDK runs in
its `local` environment there (demo ads, simulated behavior). In this repo the
combined server serves `bridge-client/dist`, so build the flag INTO dist for a
local test, and rebuild without the flag afterwards.


## Account integration (portal "save progress" question)
Select: **"Yes, linked to a game account on the game's backend, associated with the CrazyGames User."**
The CG build satisfies the rejection criteria under that option:
- Logged-in CrazyGames users are **auto-signed in**: the SDK user token (RS256 JWT)
  is verified server-side against `https://sdk.crazygames.com/publicKey.json`
  (`POST /auth/crazygames`), and the account is keyed to their CG userId — the
  same account on every device. Username is adopted from CrazyGames.
- CG guests (and adblocked players whose SDK never loads) get a **silent guest
  account** — the game never shows a sign-in screen on CrazyGames builds.
- **No external logins**: Google is compiled out of CG builds (`CG_BUILD`).
- Mid-session CG login triggers a clean reload into the linked account.
Testing locally: the sandbox can't reach the CG key CDN, so `gp-server.sh`
injects `CG_JWT_PUBLIC_KEY` from `test-keys/` and the live suite signs tokens
with the matching private key (registration, cross-device link, tamper/expiry).
