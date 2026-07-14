# SANDBOX GP vs the classics — UI & feature comparison

A feature-by-feature audit against **Mario Kart** (the modern kart-racer benchmark)
and **Rock & Roll Racing** (the combat-racer ancestor this game descends from),
tracking what we've adopted, adapted, or deliberately skipped.

## Race HUD

| Element | Mario Kart | Rock & Roll Racing | Sandbox GP |
|---|---|---|---|
| Position badge | Big animated ordinal | Small text | ✅ Big ordinal chip, **flashes green/​red on overtakes** (batch 12) |
| Lap counter | LAP x/y | LAP x/y | ✅ LAP x/y chip |
| Lap timer / best lap | Time trial modes | Per-lap money bonus | ✅ **Live lap clock + session best** (batch 12) |
| Minimap with racers | ✅ (track map, character heads) | ✅ (isometric = whole track visible) | ✅ **Canvas minimap: track ribbon + colored dots, you highlighted** (batch 12) |
| Wrong-way indicator | ✅ (Lakitu sign) | n/a (fixed camera) | ✅ **U-turn arrow + "WRONG WAY!" + soft chime** (batch 12) |
| Item slot | ✅ with **roulette spin** | Weapon ammo counts | ✅ Item chip with tier border + **roulette spin on grant** (batch 12) |
| Item-hit feedback | Spin-out animation | Explosions, announcer | ✅ Soak tint, splash bursts, toasts, sfx |
| Damage indicator | n/a | ✅ armor bar per car | ✅ Sand-armor pips (erosion) + bucket-shield icon |
| Rear-view mirror | Button-held look-back | n/a | ✅ Persistent framed mirror + SHIFT look-back |
| Standings sidebar | Live positions | Live positions | ✅ Mini standings, you bolded |
| Speedometer | n/a (feel-based) | n/a | ✅ mph chip (fits the toy-car fantasy) |

## Race moments

| Moment | Mario Kart | RRR | Sandbox GP |
|---|---|---|---|
| Countdown | Lights + jingle | "3-2-1" + announcer | ✅ 3-2-1 ticks + GO stinger |
| Final lap | ✅ banner + music shifts up | Announcer call | ✅ **"FINAL LAP!" banner + rising sting** (batch 12) |
| Lead changes | Implicit | ✅ Announcer ("...takes the lead!") | ✅ **Leader ticker toast** ("X TAKES THE LEAD!") (batch 12) |
| Win celebration | Podium sequence | Cash + taunts | ✅ VICTORY flash + CG happytime confetti |
| Blue-shell moment | ✅ (leader-seeking shell) | Homing missiles | ✅ The Wave (hunts the leader, spends itself) |
| Comeback catch-up | Item-odds by position | Money → upgrades | ➖ Deliberately none yet: identical cars is the design creed; challenge-tier skill is our "rubber band" |

## Deliberately skipped (for now) + why

- **Drift + boost sparks (MK)** — biggest feel upgrade available, but it's a
  physics/handling project (carSim + netcode + bot driver), not a UI patch.
  Logged as the top candidate for a dedicated batch.
- **Coins (MK)** — Seashells already fill the "pickup currency" role in the
  economy; on-track coins would fight the item-box challenge loop.
- **Vehicle upgrades between races (RRR)** — violates the identical-cars rule
  that keeps the game fair for a free web audience. Cosmetic-only forever.
- **Announcer voice (RRR's Larry)** — the single most iconic RRR feature.
  Text ticker ships now; a synth/recorded voice pack is a great future
  personality layer once real audio assets exist.
- **Podium/awards cinematic (MK)** — results screen covers it functionally;
  a 3D podium beat is polish for after real car/driver art lands.
- **Battle mode (MK)** — the item sandbox supports it later (arena + last-car
  -standing on erosion); scope-fenced until the racing core has traction.

## QA-driven fixes this batch

- **Stranded-after-leave bug (real, found by sweep)**: leaving a lobby or race
  killed the socket and left Host Match permanently disabled. Now an explicit
  `leave_room` unseats you server-side and keeps the connection alive.
- Ghost seat after Return-to-Lobby from results (client never told the server).
- `shop.tab.loyalty` label missed in the beach retheme → "Boardwalk".
