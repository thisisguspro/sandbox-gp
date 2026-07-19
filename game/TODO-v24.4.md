# Sandbox GP — v24.4 Work Order

Baseline: v24.3. Offline suites green (9/13; 4 need live services). Building on top.

## Block A — fix now
- [x] A1. Posts poking up through the floor → reseat to ground height
- [x] A2. Beach ball mid-road → move off to the side
- [x] A3. Lobby can't scroll → settings below fold unreachable, Play unpressable → make scrollable
- [x] A4. Player-count bug: fill 8 in an 8-cap mode, switch to 4-cap → starts with 8.
      Fix: ALL modes 4 min / 8 max. EXCEPT Time Attack = solo only (speed check).
- [x] A5. Engine noise not audible on gas → wire it up so it plays
- [x] A6. Center-screen "Press R to respawn" when force-stopped
- [x] A7. Remove Exit to Lobby from in-game HUD; keep only in ESC options menu

## Block B — before next test
- [x] B1. Non-lap modes: strip lap info top-left; add timer to ALL modes;
          draw the game if no winner when timer expires
- [x] B2. Hazards: every hazard gets a real damage calc
- [x] B3. Item boxes (same pickup mechanic as Race) added to non-race modes
- [x] B4. CTF: flag + home indicators point to correct locations
- [x] B5. Pits not pushing players off → fix
- [x] B6. Audio on ALL items; scale FX + noise up (more anime the better)
- [x] B7. Ready-up: all real players must hit Ready before Go is pressable
- [x] B8. Open-games browser: scrolling section under "Join Friend" listing open
          host games — player count (real only, not bots) + selected map
- [x] B9. Quick Join: joins any open game, prioritizing closest to 4 players
- [x] B10. Quick Race: rotates race-type maps

## Verification
- Machine-only (draw calls, DOM assertions, socket events, unit tests).
- Keep offline suite green; add tests for new behavior.
