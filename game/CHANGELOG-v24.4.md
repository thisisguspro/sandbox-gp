# SANDBOX GP — v24.4.0

Built on v24.3. All offline test suites green (9/13; the other 4 need a live
server/browser — a sandbox transport limitation, not code). Client builds clean.

## Fix-now batch
1. **Posts through the floor** — surface-standing decor (pier lamps, buoys,
   cacti, rocks) now sits at the real local ground/deck height instead of a hard
   `y=0`, so nothing stabs up through an elevated deck or floats over a slope.
2. **Beach ball in the road** — fixed toy scenery (balls, castle, bucket, shovel,
   starfish) is now shoved clear of the racing line and planted on the ground; no
   prop can land on the track on any circuit.
3. **Lobby can't scroll** — the standing-by sidebar (mode picker, circuit list,
   Start) now scrolls independently, so every setting and the Play button are
   always reachable on any window height.
4. **8-in-a-4-cap start** — every mode is now 4 min / 8 max **except Time Attack
   (solo)**. Switching modes trims the roster (bots first) to the new cap, so you
   can never start over-capacity. Grand Prix is 4–8, not the track's old 4.
5. **Engine noise** — the engine bed is now actually audible and responds to the
   gas, not just speed; it starts on a live audio context so flooring it from a
   standstill is instantly heard.
6. **"Press R to respawn"** — a center-screen prompt now appears when you're
   force-stopped off-track and waiting to dig out.
7. **Exit to Lobby** — removed from the in-game HUD; it now lives only in the ESC
   menu (Surrender).

## Before-next-test batch
8. **Match timer on every mode + draws** — all modes now show a countdown; when
   the clock runs out with no clear winner the match is a **draw**. Non-lap modes
   hide the LAP/position readout entirely.
9. **Hazard damage** — arena tar/sink/deep now actually erode you. `sink` is
   handled at last.
10. **Item boxes in every mode** — arena modes get scattered direct-grant item
    boxes (same pickup feel as the race; no racing-line minigame needed).
11. **CTF indicator** — the on-screen arrow now points **home** when you're
    carrying the flag and at the **enemy flag** otherwise (it used to always point
    at the enemy flag).
12. **Pits push you off** — sinkholes grab, slow, damage, and eventually eject you
    if you linger; fort pits moved off the direct base lane so CTF stays winnable.
13. **Item audio + more anime** — arena pickups and pit events have sound; engine
    and hazard feedback punched up.
14. **Ready-up** — real players must tap Ready before the host can start; the host
    is implicitly ready, bots don't gate. Crew cards show a ready check.
15. **Open-games browser** — a scrolling list under Join lists every open public
    lobby with its map, mode, and **real** player count (bots never counted).
16. **Quick Join** — drops you into the open game closest to 4 real players.
17. **Quick Race** — a fresh Grand Prix on a **rotating** circuit each time.

## v24.4.1 — floor + wheels hotfix
- **Everything floating** — the sand embankment started 1.2 units outside the road
  edge, leaving a see-through strip at the kerb line so the road, curbs, cars and
  props all appeared to hover. The skirt now tucks 0.4 units UNDER the road edge
  (continuous surface from tyre to sand) and, on high climbs, settles to a raised
  beach instead of dropping to a flat disc far below. All prop/rock/scenery ground
  formulas updated to the same profile so they sit on the terrain.
- **Wheels turned the wrong way** — the front wheels yawed with `+steer` while the
  whole car mesh lives in a flipped yaw frame (`rotation.y = -heading`) where the
  body roll and driver lean already use `-steer`. Negated the wheel steer so the
  fronts point the way you're actually turning.

## v24.4.2 — visual pass from race screenshots
- **Sand piles → cones** — a crumbled kart now leaves a clean sand CONE (with a
  spade + half-buried wheel) instead of the bubbly cluster of spheres.
- **Race Complete scroll** — both columns of the results screen scroll now, so the
  Final Standings / Final Roster and the Rematch / Return buttons are reachable on
  short windows.
- **Stands faced the wrong way** — the crowd sits on tiers that step back along
  -Z, so the stand's front is +Z; the facing rotation was pointing the back at the
  track on some maps. Corrected to face the road.
- **Floor too high hiding turns** — reverted the 0.33 embankment "settle" from
  24.4.1 that raised the sand of an elevated section OVER the neighbouring
  lower/turning road. The skirt eases back to ground level; the flush inner edge
  that fixed the floating stays.
- **Rails floating on elevated turns** — the boundary rails were seated at the
  road's centreline height, so on raised turns they hung in the air with their
  undersides and posts on show. They now sit on the embankment surface at their
  own offset (~0.9× road height) with a short mounting post.
- **Overpass → tunnel** — where the deck crosses over another road, pillars are no
  longer planted in the middle of the lower lane; the underpass gets solid side
  walls up to the deck soffit (a real tunnel, not a half-there wall).
- **Pier poles through the deck** — pier pilings were placed 0.9 units INSIDE the
  road edge and poked up through the pink deck; moved to just outside the rim.

## v24.4.3 — arena + Sand Artist + how-to
- **Arena borders faced the wrong way** — the rim segments were oriented radially
  (pointing out from the centre like spokes). Now they run tangent to the circle,
  so the border reads as a continuous ring wall.
- **Wrong Way in arenas** — the wrong-way warning is a lap-circuit concept; it no
  longer runs in arena modes (derby, CTF, tag, pearl, artist).
- **Sand Artist paint is a TOGGLE** — tap SPACE to start pouring water, tap again
  to stop (was hold-to-paint, which felt like "it only works once"). HUD shows
  PAINTING / TAP TO START, and the water-trickle SFX follows the toggle.
- **+2 minutes to draw** — Sand Artist rounds are 195s (was 75), with the overall
  match cap widened to match.
- **TAB = How to Play** — a per-mode rules + controls card. It pops up on its own
  before the start lights (so a first-timer reads the rules before GO) and toggles
  any time with TAB.

## v24.4.4 — readability, map cull, collision, options
- **Mode & circuit cards readable** — the lobby pickers had near-transparent
  backgrounds; text was unreadable over the beach. Cards now have a solid dark
  background.
- **Moonlit Dunes removed** — deleted from the track data (both shared copies),
  the circuit picker, the CIRCUITS list, and the Quick Race rotation.
- **Collision launch fixed** — separateCars could fling a kart across the map when
  two overlapped deeply (a reset/respawn onto another, a pile-up, exact spawn
  overlap): the position push was unbounded and the coincident case had no defined
  normal. The push is now clamped per tick, coincident karts get a deterministic
  normal, and the impulse is capped. (Both shared copies kept byte-identical.)
- **Menu speed-lines removed** — the diagonal ambient lines striped every menu and
  made text harder to read; the overlay now renders nothing everywhere.
- **In-game full OPTIONS** — the ESC menu gains an ⚙ OPTIONS button that opens the
  complete Settings (audio sliders, graphics, accessibility, controls) in-match.
  (The old Return-to-Lobby HUD button was already gone; ESC → Surrender leaves.)
