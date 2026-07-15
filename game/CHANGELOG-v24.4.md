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
