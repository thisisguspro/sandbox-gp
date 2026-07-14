# SANDBOX GP — v23 (all 15 goals complete)

## What changed since v22

### 1. The Sandcastle Grand Circuit (2,029 m)
A real figure-8 circuit replacing the old 336 m oval. Elevated bridge cresting
at ~9 m, a 34 m **jump gap** with a launch kicker, and a crossing where two
decks stack — the sim resolves which road you're on **by altitude**, so the
lower straight and the upper bridge never get confused.

* Flat-out lap ≈ 77 s; average pace ≈ 2 min.
* Jump outcomes are contract-tested: full commit clears it, a timid entry
  drops you to the straight below or strands you at the lip (rescue).

### 2–3. HUD + item-box waves
Boxes now spawn in **stations of three** across the ribbon (~110 m apart) so a
pack arriving together all get a pickup instead of the leader sweeping a lone box.

### 4. Box → Hoop Run → tiered loot
Every box starts a **6-hoop run with a 15-second window**. Every 2 hoops =
one tier up (0–1 bronze · 2–3 silver · 4–5 gold · 6 = S). The tier picks a
**weighted loot table**: bronze is kite-heavy, S-tier is a jackpot.

### 5. The roulette + aiming
The item chip spins **exactly two full cycles** through the wheel, decelerating
onto the server's roll. The **kite is the dud** — it never sits in your hand; it
latches onto *you* the moment the wheel lands (and flashes red). Shot items
(balloon / squirt / wave) project **coral aim chevrons** on the road ahead.

### 6. Bumpers + off-road rescue
Candy-striped pool-noodle rails; beached karts snap back to the centerline.

### 7–9. The karts are anime karts now
Rewritten from scratch: lathe-built teardrop shell, cockpit ring, chunky
fenders, a big rear wing, and a **chibi driver** (big helmet, blue visor, mitts).
* **Wheels are car mods** — the `shoes` slot restyles all four (rim colour + hub).
* **Every equipped cosmetic renders on the kart**: headpiece, snorkel, bandana
  scarf, floaty ring, tow-rope, rear tool. Unknown IDs still show up (stable
  hash → colour), so new purchases never render as nothing.

### 10. Sunset Boardwalk retheme
Deep-lagoon panels, warm sand paper, coral + gold + sea-glass. **Zero purple**
anywhere (the legacy `--violet` token now carries sun-orange; "epic" rarity is
hibiscus). Sunset radial glow behind the whole app.

### 11. The podium
Results open on a **rotating 3D diorama** — the top three, in their actual karts,
on gold/silver/bronze steps. Final standings rows are framed with each racer's
avatar + border; **tap one to open their profile card** (level, races, wins,
podiums, best lap, splashes, S-tiers, achievements).

### 12. Music
Two **original** tracks, composed for this build (no licensing exposure):
* **Lobby** — *Sunset Boardwalk*: 115 s bubbly summer loop, steel drum over
  marimba (was a 50 s placeholder).
* **Race** — *Sandcastle Grand Circuit*: 102 s kart-racer rock — driving power
  chords, backbeat, hooky square lead.
Both are **circular loops** (the ring-out is folded back over the head), so
there's no dead air on repeat. They cross-fade on scene change.

### 13–14. Persistence + admin
Postgres-backed stats; admin claim via `ADMIN_KEY`.

### 15. Perk Garage
Eight racing perks, **equip two**, level-gated (2 → 16). The creed is enforced
and tested: **every kart is identical — always.** Perks bend item luck, hoop
windows, seashell payouts, and information. They never touch speed, accel, or grip.

| Perk | Lv | Effect |
|---|---|---|
| 🍀 Lucky Scoop | 2 | Hoop runs count one extra ring toward your tier |
| ⏳ Long Summer | 4 | Hoop window is 18 s instead of 15 |
| 🧲 Magnet Mitts | 6 | Hoops are 45% easier to snag |
| 🪣 Bucket Boy | 8 | Start every race holding a shield charge |
| 🥄 Second Scoop | 10 | Reform from a wipeout holding a bronze item |
| 🌊 Tide Reader | 12 | Danger warnings reach 50% farther |
| 🐚 Beach Economist | 14 | Race payouts drop 25% more Seashells |
| 🎭 Encore | 16 | Your first dud kite each race re-rolls itself |

## The game-feel layer (threat → impact → reward)

* **Anticipation** — anything hostile closing on you burns the screen edges red,
  shows **⚠ INCOMING!**, and ticks faster as it gets nearer.
* **Impact** — layered thud (sub + splash + crack), water burst, camera shake.
* **Takedown, victim side** — the kart *erupts*: a two-tone sand explosion, a
  dust ring, and a **sand pile with a toppled wheel and a little flag** where you
  died. Then a **4-second unskippable cinematic**: letterbox bars, the camera
  orbiting your wreck, **WIPED OUT! — by [name]**, and a live **REFORMING IN 3…2…1…**
  Inputs are dead — *enforced server-side* (a contract test drives full throttle
  into the corpse for 3.5 s and proves it doesn't move an inch).
* **Takedown, attacker side** — impact, then inside the ~300 ms reward window a
  bright rising jingle + sparkle and a banner: **💥 TAKEDOWN!** Chains escalate to
  **DOUBLE TAKEDOWN!** → **RAMPAGE!!**, each bigger and louder. The feed broadcasts it.
* **Lap flags** — every lap crossing flies a **🚩 N LAPS TO GO** banner; the last
  lap gets the **🏁 checkered banner** with a fanfare.

## Payload: 107 MB → 12 MB

The CrazyGames upload was 107 MB, mostly **dead Iron Frontier sprite art**.
* The garage now previews cosmetics on a **live 3D kart** (same builder the race
  uses — one art pipeline, no drift), which retired `characters/` + `overlays/` (52 MB).
* Cosmetic icons were **1024×1024 PNGs** displayed at ~80 px; downscaled to 256 px
  (44 MB → 3 MB).

## Before you deploy

Two env vars on the Render service:
* **`DATABASE_URL`** — the Postgres add-on. Without it, free-tier sleep wipes all
  progress (this was the root cause of the "profile zeros" bug).
* **`ADMIN_KEY`** — any secret. In-game: Settings → Account → ADMIN ACCESS → claim.

## Dev/QA hooks (kept in the build, harmless)

* `?dev_fx=roulette|dud|takedown|death|threat|lapflag|finalflag` — stage any
  feel-layer moment on demand.
* `?dev_orbit=cx,cz,r,h` — orbit camera for looking at the world.
* `?dev_shot=1` — `preserveDrawingBuffer`, so headless screenshots aren't black.
* `?dev_fastrace=1` — 1-lap testloop race, for exercising finish/results quickly.

## v23.16 — driving every map, and finding four dead features

Before shipping I drove **every mode and every map** in a real browser instead of
trusting that the code was there. Two things fell out.

**`tNowMs` was used in ELEVEN places and never declared.** Every one of those paths
threw a ReferenceError the instant it ran, which killed the frame:

* the **kerb rumble** (the thing that tells you you've run out of road)
* the **water pour** in Sand Artist (the entire drawing mechanic's audio)
* the **guess countdown ticks** (the accelerating 5-second lock)
* the **IT pulse** in Riptide Tag

Four features, all silently dead. It only surfaced on **Moonlit Dunes**, because
that happened to be the first map where a car touched a kerb. Every one of those
features was "in the code", and every one of them was broken.

**The playability suite now drives all six circuits** and fails if any of them
throws or fails to get moving. That is the test that would have caught this on day
one, and it is the one I should have written first.

**Verified live, in the running game, at speed:**

| | |
|---|---|
| Tone mapping | ACES (4), exposure 1.15 — was **none** |
| Ambient light | 0.42 — was **0.95**, drowning every shadow |
| Sun shadow box | 46 units, **follows the car** — was a fixed 110-unit box at the origin |
| The kart | **68 meshes, 4 wheels, a driver, no LatheGeometry** — was a blob that swallowed its own wheels |
| Track edge | **18,576 kerb vertices**, 3 colours, both sides |
| World dressing | 150 crowd blobs, 44 parasols, ~2,000 meshes — was **7 palm trees** |
| Camera | 2.3m above the kart — was 3.3m, staring down at a toy |

**All 6 modes**: render, run, show their HUD, zero page errors.
**All 6 maps**: drive at speed, zero page errors.

## v23.15 — the track edge, 100% of it

Gustavo: *"the borders for the 2 sides of the track have not been added properly."*
He was right without even looking, and here is exactly how bad it was.

**The kerbs only existed on TURNS.** The builder opened with
`if (Math.abs(turn) < 0.06) continue;` — so every straight had **no edge marking
at all.** Measured: **25% of Sandcastle had nothing whatsoever** telling you where
the road ended. And even on the turns they were separate boxes placed every third
sample, so the "kerb" was a dashed line of disconnected blocks with gaps between
them.

The third thing claiming to mark the edge — the "painted outline" — was a ribbon
1.1 units wider than the road, laid **flat at y=0.01 and drawn UNDERNEATH the
road**. A half-unit sliver you could not see.

So there was genuinely no continuous, readable "you are in the lane" marker
anywhere in the game.

**Now:** a continuous red/white kerb, unbroken, **both sides, all the way round,
on every circuit** — plus an **unbroken white lane line** just inside it, which is
the thing your eye actually tracks. Verified in the live game: 18,576 kerb
vertices, 153 of them within 12m of the car mid-track, all three colours present
beside you.

Coverage: **100% on five circuits, 98.3% on Sandcastle** — and the missing 35m is
the bridge jump, where there is no road to put a kerb on.

**And the FUNCTIONAL half.** `onCurb` had existed in the sim the whole time and
was **never sent to the client** — the game knew you were riding the kerb and told
you nothing. Now:

* the sim reports `lanePos`: 0 = dead centre, ~1 = on the white line, >1 = off
* a **lane indicator** in the HUD shows exactly where you sit between the lines —
  teal in the lane, amber on the kerb, red off the road
* riding the kerb **rumbles the camera and rattles**, so you feel the edge

**Two performance regressions I caused and the playability test caught:**

* One mesh per kerb band = **1,200 extra draw calls**, and the frame went from
  24ms to **1,541ms**. Baked into three merged meshes instead.
* The gap-check walked every sample calling `track.at()` (a spline evaluation
  each time), making the world build **O(n²)** — a **5,692ms** hitch on load.

That test — drive a real browser, hold a real W key, assert the car moves and the
frame budget holds — caught both within seconds. It is the single most valuable
thing in the suite.

## v23.14 — I FINALLY LOOKED AT THE GAME

Everything below is the consequence of one fact: **until now I had never seen this
game.** Every visual claim I made was verified by counting meshes and triangles in
a headless browser. That is not seeing. When Gustavo said the art was 90% missing,
he was right, and I had no basis to argue.

### The two bugs that made it unplayable

**Shader recompile, every frame, forever.** `animateCar` set
`material.transparent = false` on the kart's shell every frame. In three.js
`transparent` is part of the shader PROGRAM KEY — assigning it, *even to the value
it already holds*, marks the material for recompilation. So every frame, for every
kart, three.js rebuilt and relinked the shader. **51% of all CPU went into
`getShaderInfoLog`. Frames took 1400ms instead of 16.** That is the "stuttering
like the rear-view mirror is being spammed".

**The input lock never cleared.** The lock was released by a client-side
`setInterval` counting the 3-2-1 down. With the main thread stalled by the shader
bug, that interval was starved, never reached zero, and never unlocked. **You could
see the race, see other karts moving, and pressing W did nothing at all.** The lock
is now read straight from the server's `startFreezeLeft`, which is self-healing —
a local timer can only ever add a way to get stuck.

**366 tests passed through all of this**, because the engine was fine. The bug lived
entirely in the browser. There is now a `playable.test.mjs` that drives a real
browser, holds a real W key, and asserts the car moves — plus a frame-budget check
and a shader-cache check that would have caught this on day one.

### Then I looked, and the art was as bad as he said

**The kart was a LATHE** — a body of revolution. Structurally it can only ever be a
blob: no front, no back, no wheel arches, no cockpit. And its radius (0.62) was
exactly the wheel offset (±0.62), so **the shell swallowed all four wheels**. On
screen: a featureless grey lump with a dome on top. Rebuilt as an actual kart — flat
floor pan, tapered nose with a chevron, side pods with intakes, an open cockpit with
a steering wheel and a visible driver, a raised engine deck, exhaust pipes, a rear
wing on posts. The wheels are outside the bodywork, where wheels go.

**No tone mapping.** Colours were dumped to the screen raw, which is why everything
looked like a washed-out beige photocopy. ACES filmic + exposure 1.15.

**Ambient light at 0.95** — so strong it drowned the sun and killed every shadow and
every bit of shape. Now 0.42: a fill, not a flood.

**The shadow camera was a fixed 110-unit box at the world origin**, on a track 400
units across. Drive anywhere but the middle and your kart cast no shadow at all — it
just floated on the sand. It now follows the player.

**The road was invisible.** `sandLight` (f2dca8) and `sandDark` (d9b077) were nearly
the same colour — a beige stripe on beige sand. The road is now properly darker
packed sand with a near-white painted edge.

**The world was empty.** Seven palm trees, hand-placed in a 70-unit box, on a
400-unit track. Now there's dressing scattered along the entire circuit — palms,
parasols, towels, rocks, beach balls, driftwood — plus **crowd stands with
spectators** on the main straight.

**The HUD was a debug overlay** — a 64px position number and solid cream slabs
eating a quarter of the screen. Now dark translucent glass at a sane size, so you
can see the game through it.

**The camera** sat 7.2 units back and 3.3 up, staring down at a toy. Now low and
close, with FOV and distance that open up with speed.

## v23.13 — the weekly competition, and six circuits

**Time Attack is a WEEKLY competition now.** I'd built it wrong: an instant payout
the moment you crossed the line, which meant the first person to post a decent lap
on a quiet board got paid and nobody could take it off them.

How it works now:
* **Unlimited attempts.** Run a map as many times as you like.
* **Only your best time that week is kept**, per map. Grinding for a *faster* lap
  is the point; grinding for more *entries* would just reward having free time.
* **You can see exactly where you stand** — your rank, and the cut line, live.
* **The top 3% on each map are paid when the week turns over.** 1st takes 2,000
  sea glass, 2nd 1,200, the rest of the cut 750 — because a flat prize makes the
  top of the board pointless once you're inside it.
* A week settles **once**. There's a test that fails if it ever double-pays.

**TWO NEW CIRCUITS** — and Grand Prix and Time Attack **share the same map pool,
always** (both are `arena: null` and draw from one list; there's a test asserting
a time-attack map you can't race is impossible).

**Obsidian Shore** — black volcanic sand, a smoking cone in the infield, and lava
still running down its flanks. Two new hazards, and they're the nastiest in the
game:
* **LAVA** — every other hazard costs you a corner. This one costs you the *race*:
  sit in it and your kart erodes until it crumbles.
* **ASH VENTS** — you keep every bit of your speed and you cannot see a thing,
  which at 90mph is the worst combination there is.

**Moonlit Dunes** — night. The desert under a full moon, **bioluminescent tide
pools** that glow and have no grip at all, scorpions, and dunes big enough to jump
(three crests, up to 13m). The one track you run in the dark.

Both are sand-based, both are genuinely new themes (six circuits, six distinct
palettes — the test fails if any two are recolours), and bots finish a full grid
on each.

## v23.12 — hazards on every circuit, and a real prize

Two things you'd asked for that I'd only half-done.

**"Each map has to have hazards and obstacles."** The four circuits had elevation
and one jump — that's it. A track with no hazards is a driving test: you learn the
line once and then you're just holding throttle. **Hazards are what make a lap a
decision**, because the fast line and the safe line have to be different.

| Circuit | Hazards |
|---|---|
| **Sandcastle** | Wet-sand **oil slick** on the T1 exit · loose **beach balls** · **soft sand** on the inside of the hairpin |
| **Valley of Kings** | **Drifting sand** taking the road back · **fallen masonry** in the switchback |
| **Shingle Cove** | **Wet stone** after the tide · **crabs**, exactly where you want to brake |
| **Rose Lagoon Pier** | **Waves** that break over the boards and **shove you sideways** — on a dock with no rails, that's the pink sea |

Each behaves differently on purpose. **Oil keeps your speed and takes your
steering** — far more frightening than something that just slows you down, and the
camera swims so you feel the grip go before you see it. Quicksand is a hard speed
cap, so the only way to be fast is to go *round*. Crabs and rockfall are real
impacts.

**Two bugs the hazard work turned up:**

* **Six of the first seventeen hazards floated 14–55m out in the empty sand**,
  where no kart would ever have touched them. They're authored by *arc fraction*
  now and resolved against the spline — a hazard you can't hit is scenery.
* **The pier's waves were unsurvivable.** They shoved karts off the boards, into
  the water, onto a respawn, and straight back into the same wave — **141 rescues
  in one race, lap 0 of 3.** A hazard that can't be survived isn't a hazard, it's
  a wall. Tuned: a bot now finishes on all 12 seeds, and the pier still claims a
  couple of swims per race.

**"Some kind of prize for the top 3% on each map."** An achievement isn't a prize.
It now pays **750 sea glass**, and it pays **once per circuit** — a leaderboard you
can grind by re-running the same time isn't a leaderboard. There's a test that
fails if it ever becomes farmable.

## v23.11 — the modes get their finish

The six modes worked, but five things you'd asked for weren't there yet.

**The minimap ignored arenas entirely** — it drew a track ribbon in a world with
no track. It now draws the bowl, the walls, the derby's **closing ring**, the
**wreckers**, the pearl field, and **the flags, always**. A carried flag pulses,
so you can tell at a glance it's on the move. Team colours replace kart paint in
CTF, IT is marked in Tag, and the Pearl Rush leader gets a gold ring.

**Spectating.** Guess wrong in Sand Artist and you'd have spent the round staring
at your own wreck. **SPACE now cycles the camera** through whoever's still
playing, with a count of how many are left.

**Every mode has its own voice.** A flag capture is a four-note fanfare; a wrecker
ram is a sub-bass crunch; a pearl pickup is a bright little chime. Sand Artist has
**continuous** audio the events couldn't carry — the trickle of water while you
paint, and a countdown tick that **accelerates** as your 5-second guess lock fills.

**A racing podium is the wrong answer for a mode that isn't a race.** CTF ends on a
team score, a derby ends with one kart standing and seven wrecks, Pearl Rush ends
on a haul. Each mode now shows what it actually measured — then the podium.

**54 achievements in one flat grid is a wall.** They're grouped by mode now, each
with its own progress bar, and the ones you've earned float to the top of their
group — so a Pearl Rush player sees their Pearl Rush progress instead of scrolling
past forty racing achievements.

## v23.10 — six modes, 54 achievements, and the last of the old game

**The engine is no longer a race engine.** It was hard-wired to laps, checkpoints,
a finish line and four players — and every mode you asked for breaks at least one
of those. The rules are pluggable now: the engine owns physics, items and erosion;
a MODE owns the win condition. Racing is untouched (90 engine tests still pass).

**Six new modes, four new arenas, 8-player ceiling:**

* **Demolition Derby** (The Sand Pit) — 3 lives, last kart rolling. **Driverless
  wreckers hunt you**, and the ring closes from 62m to 22m so there are no
  stalemates. Tested: 8 karts in, 1 out, 67 seconds.
* **Capture the Flag** (Temple Standoff, Egypt) — 4v4, **line of sight is real**:
  pillars break the sight lines, and an enemy you can't see **isn't sent over the
  socket at all** — hiding a mesh client-side is a lie a cheater can just turn off.
* **Sand Artist** (The Gallery, white stone) — one player draws by **pouring water
  from the back of the kart** (hold SPACE), stamps props on 1–5, and can only draw
  inside the rope. Everyone else drives to the hallway holding the word they
  believe and **holds it for 5 seconds** with a visible countdown. Wrong answer:
  your kart explodes and you spectate. Faster guesses pay both the guesser and the
  drawer more.
* **Time Attack** — one kart, no items, ranked. **It had no leaderboard at all**:
  the client had been calling `/player/leaderboard/laps` since the mode existed,
  the route never existed, and the fetch failed silently. Built it, plus the
  top-3% percentile the "Elite" achievement needs.
* **Riptide Tag** (The Sand Pit) — IT is **faster** (1.12×) and the sand scours
  you while you hold it. Be IT at the horn and you lose.
* **PEARL RUSH** (Rose Lagoon) — *my pick, from the research.* Every other mode
  you asked for is elimination or a duel: get wrecked early and you sit and
  watch. **Coin Runners has survived every Mario Kart generation since the Wii**
  precisely because collecting is a parallel activity — a weak player still
  contributes every second they're alive. Get hit and you **spill half your haul**;
  the leader wears a **crown everyone can see**.

**Bugs the mode work turned up:**

* **CTF deadlocked, permanently.** The classic rule ("your own flag must be home
  to score") locks solid in a kart game: both teams grab at once, neither can
  force a drop, 300 seconds, 0-0, forever. A capture always scores now — the
  tension is that **carrying the flag makes you slow (0.88×) and scours you**.
* **A wrecker's shove launched karts clean out of the arena** (64m past a 62m
  rim), where they sat unable to drive back in.
* **Every track-only system was firing in arenas** — the off-road rescue, the
  overboard check, the R-reset — each teleporting karts to *track* coordinates in
  a world that has none.

**Achievements: 13 → 54**, across 11 categories, every mode with its own ladder.
The old set was inherited from the social-deduction fork: avatars called
**Saboteur, Phantom and Engineer**, and thirteen achievements measuring about
three racing stats between them. **Six modes had zero.**

The test that guards this refuses to let an achievement exist whose stat nothing
writes — an achievement that never moves doesn't look like a missing feature, it
looks like a broken account. It immediately caught `top3Percent` (nothing recorded
it) and a phantom `resets` stat.

**The legacy sweep.** Still in the codebase from the old game:

* The **Profile's entire stat grid** — "Wins as Crew", "Wins as Impostor", "Tasks
  Completed", "Sabotages", "Ejections". **Eight cards that could only ever show
  zero.** Now: matches, wins, podiums, best lap, splashes, takedowns, ultimates,
  pearls, flags, derby wins, streak, modes played.
* An **"IMP" badge** on match history rows, marking the impostor.
* `rooms.js` — a whole module mapping **Airlock and Turret rooms**. Nothing
  imported it.
* A **"Secret impostor volunteering"** socket call.
* **"Crew won / Impostors won"** in the lobby.
* `matchResult` was reporting `tasksDone`, `sabotages`, `kills` and `survived` —
  hard-coded to zero — into every match row. It also had **two `mode` keys**, and
  the second silently overwrote the first.

## v23.9 — two currencies

**SEA GLASS** — the *only* in-game currency. You earn it racing, you earn it
recycling cosmetics you don't want, and you spend it on everything that isn't
cash-only: **chests and crafting alike**.

**SHELLS** — the cash currency. Real money. The 20 premium cosmetics, nothing else.

There used to be three (Seashells, Sea Glass, Sand Dollars) — *two* of which were
earnable and did the same job, so you could be rich in one and broke in the other
for no reason anyone could explain. They're one now.

**The migration folds stranded glass into the wallet.** Anyone who'd already
scrapped items under the old model keeps every shard (`400 credits + 270 glass →
670 sea glass`), with a test asserting it. Losing someone's crafting material
because we merged two ledgers would be unforgivable.

**And the cash loot box is gone.** The Golden Clam cost real money for a random
drop — which breaks the rule that Shells buy *only* the premium cosmetics, and is
the exact mechanic that gets games age-gated or pulled outright in the EU and UK.
It's now the top-tier Sea Glass chest: **the one you grind for.** Shells buy
premium cosmetics, where you see precisely what you're getting before you pay.
There's a contract test that fails if a cash loot box ever comes back.

**New icons:** Sea Glass is a tumbled, frosted shard of bottle glass. A Shell is
a ribbed scallop. Both drawn inline as SVG, so they're crisp at any size.

## v23.8 — buffs get their moment, and the economy closes

**Every buff now has a visual, not just a sound.** Turbo grows real exhaust
flames that lick harder the faster you go. The Bucket Shield gets an energy dome
with a band that sweeps it (the bucket stays — the bucket is the joke). Being
blinded cakes sand all over your kart so *everyone* can see you took one in the
face. And **HYPERNOVA turns the kart into a comet** — a glowing core, three
counter-rotating rings, and twelve orbiting sparks.

**Ultimates announce themselves to the whole field.** The name-card was only
showing for the caster; now everyone sees `[NAME] UNLEASHED · TSUNAMI` slam onto
the screen, because an anime ultimate that only the caster knows about isn't an
ultimate.

**All 23 powers have a glyph** — at 90mph you read the shape, not 14px of text.
Holding an ultimate makes the HUD chip shimmer like it's alive.

**THE ECONOMY IS NOW CLOSED.** The shop was still selling in-game cosmetics for
Seashells, which walked straight past the entire crafting economy. Now:

* **Seashells → chests.** Nothing else.
* **Sea Glass → craft** any chest item you want.
* **Sand Dollars → 20 premium cosmetics**, none of which can ever be crafted.

Enforced **server-side**, not hidden in the UI — an open endpoint is an open
endpoint, and a hacked client would have used it.

**And the test caught a genuine leak:** nine items were being **sold for real
money** while also being marked as chest drops — meaning they were *craftable*.
Someone could have paid for `head_crown` while a rival melted a duplicate into
sea glass and made the same thing for free. Those nine paywall shortcuts are
gone, and there's now a contract test asserting that **no Sand Dollar item is
ever craftable**.

## v23.7 — 16 new powers, the anime layer, and a car made of sand

**Four exclusive items per tier.** 23 items now, up from 7. The tier you earn is
the tier you fight with — 4,000 bronze rolls can never produce an ultimate.

| Tier | Exclusives |
|---|---|
| **Bronze** | Water Bomb · Puddle Splat · Fizz Pop · Sand Clod (blinds you) |
| **Silver** | Balloon Cluster · Super Soaker · Ice Pop · Bouncing Beachball |
| **Gold** | Hydro Bomb · Geyser Trap (launches you airborne) · Monsoon Cloud (follows you, you cannot leave) · Rocket Floaty |
| **S-TIER** | **TSUNAMI** · **KRAKEN'S GRASP** · **METEOR SPLASH** · **HYPERNOVA** |

The ultimates earn the name. The Tsunami sweeps the *whole field* and doesn't
spend itself. The Kraken grabs **every** racer ahead of you at once. The Meteor
homes on the leader wherever they are. The Hypernova shrugs off every debuff in
the game — nothing sticks while it burns.

**THE CAR IS MADE OF SAND — and now you can see it.** As you take hits, chunks of
the shell are **cut away** and the raw sand core shows through, hole by hole.
The paint dulls and scours. A **trail of sand grains** sloughs off a damaged kart,
falls to the road, and stays there as you drive on — it doesn't follow you, which
is the whole point. Every racer's erosion is in the view, so you can watch a rival
falling apart in front of you.

**The anime layer.** Every power has its own voice and its own visual grammar:
**hard shock rings** that snap outward, **speed lines converging on the impact**,
a **one-frame white flash**, and **pillars of water** for the big stuff. The
S-tier items get the full treatment — a rising wind-up whine, then the name slams
onto the screen on a rotated slab while the world shakes.

**The bug this found:** the projectile hit test required `y < 2.0`, so **any lobbed
shot sailed clean over its target**. A Water Bomb peaks around y=2.6 — a
dead-centre throw passed straight through the kart and buried itself in the sand
behind them. **This affected the original Water Balloon too.** A weapon that can't
connect isn't a weapon, and no test that only asks "did the entity spawn" would
ever have caught it. There's now a suite that fires all 16 offensive items at a
real target and asserts every single one connects.

## v23.6 — 50 new items, and the shape registry

**30 new loot-box items** (craftable/scrappable with Sea Glass) and **20 new Sand
Dollar items** (premium; never craftable, never scrappable — paying money for
something a rival can melt down would be a bad joke). The catalogue is now **115
items**, up from 65.

**The `oxygenTank` slot had zero items** despite being `alwaysFilled` — every kart
wore the same gold ring with no alternatives. It now has 14 floaties: Beachball,
Sprinkle Donut, Swan, Flamingo, Shark, Hibiscus (a real five-petal flower),
Thunder Wave (with a lightning bolt), and more.

**Prices**

| Rarity | Craft (Sea Glass) | Scrap returns | Premium (Sand Dollars) |
|---|---|---|---|
| Common | 40 | 12 | — |
| Rare | 120 | 36 | 2 |
| Epic | 320 | 96 | 4 |
| Legendary | 900 | 270 | 8 |

**Every item now has its own mesh.** The old renderer branched on substring
matches (`/cap|hat/`, `/crown/`, `/mecha/`) and dumped everything else into one
generic cone — so 50 new items would have rendered as three shapes. There's now a
**shape registry** with 89 registered meshes and an explicit anchor contract
(helmet crown at y=0.78, neck at 0.27, rear deck at z=-0.9). Anything
unregistered still gets a sane fallback, so a new item can never render as
nothing.

**A new test builds all 88 wearable items for real and measures their bounding
boxes** against the kart's anatomy. It immediately caught: 22 legacy items with
no shape at all (they'd have been identical cones), and 4 "floaties" that were
just the same torus in a different colour.

**Three bugs the audit found:**

* **71 of 79 loot-box items could never drop.** The three boxes named 8 items
  between them — and an item that can't drop can't be scrapped into the sea glass
  you'd need to craft it. **The economy had no faucet.** Drop tables are now built
  *from* the catalogue, so every box item is reachable.
* **Duplicate object keys were silently overwriting items.** Three of my "new"
  premium items shared ids with existing loot-box items — JS object literals
  overwrite without complaint, so an item a player already owned would have
  quietly become a paid item.
* **The store kept its own copy of every item name**, so the reskin left "Bandit
  Helm" and "Gunslinger Rig" sitting in the shop long after the cosmetics
  themselves were renamed. Names now come from the catalogue.

## v23.5 — random maps, Sea Glass, and Mythic loyalty

**Maps are random by default and secret until you load in.** Equal 25% odds
across all four circuits (tested over 400 rooms — the first roll was 91% pharaoh
because the seeded PRNG's first output correlates with the seed; it now warms up
first). The lobby shows `??? — Random Circuit` and the socket does not leak the
answer — the reveal lands at the green flag. The host can still pin a specific
circuit if they want.

**The currencies.** Three, and each does one job:
* **Seashells** — earned by racing. The everyday currency.
* **Sand Dollars** — real money. Genuinely rare on a real beach.
* **Sea Glass** — the crafting fragment. Literally broken things worn smooth and
  made valuable, which is exactly what scrapping is.

**Scrap and craft, in the Locker.** Break a loot-box cosmetic down into Sea
Glass, spend Sea Glass on the one you actually want. Scrapping returns **30%** of
the craft cost, so it's a way to redirect duplicates — not an arbitrage loop
(there's a test asserting scrapping an item never pays to re-craft it).

**The rule, enforced server-side:** you can only scrap and craft **loot-box**
items. Level unlocks, loyalty rewards, and the starter kit can be neither minted
nor melted. Those are a record of what you did; currency must not touch them.

**Loot boxes show their contents.** Every drop, its exact odds, and a **click to
preview it on your own kart** before you spend a shell.

**Loyalty rewards are now MYTHIC** — the only Mythic tier in the game, and the
only items that can't be bought, crafted, or dropped. They don't just look rare,
they behave differently: a shifting aurora border in the menus, and in-game the
kart gets a **glowing aura, a crown of light, licks of flame, a streaming trail,
and orbiting sparks** that burn harder the faster you go. Aurora Sash · Crown of
the Tides · Molten Sun Regalia · Comet Treads.

**Wheels menu removed** (no emotes or comms to put in it).

**Item placement audit** turned up a real bug: cosmetic attachments were authored
against an older, shorter driver. The cap brim sat at y=0.30 while the head is at
0.48 — **the hat was inside the driver's face**. Snorkel, scarf, and headwear are
all re-anchored to the actual anatomy now (helmet crown at 0.78, neck at 0.27).

## v23.4 — four circuits, and a full reskin

**Three new maps. All sand, none alike.**

* **Valley of Kings** (Egypt) — 1,122m between temple walls, a sunken tomb dip
  (−4.5m) and a crest (+7m). The Great Sphinx sits in the infield as your
  compass; two obelisks mark the far corners. Bleached, hard-edged desert sand.
* **Shingle Cove** (white pebble beach) — 966m, tight and technical, cold-bright.
  A lighthouse in the middle, tide pools, and a jump over the breakwater.
* **Rose Lagoon Pier** (the dangerous one) — 777m, and **the track IS a dock over
  the pink sea**. **No rails, anywhere.** Leave the boards and you go in the
  water and get fished out at the last plank you touched. Narrowest track (9m),
  no shoulder, no forgiveness. In testing, a bot grid needs 5 rescues here versus
  0 on every other map.

Pick your circuit in the lobby — the engine rebuilds the track, the item boxes,
and the grid on the fly.

**Full reskin — no more sci-fi.** The cosmetic vocabulary was still from the old
space game: *Breather*, *Battery*, *Standard Respirator*, *Piston Cell*, plus a
pile of western leftovers (*Gunslinger Rig*, *Coyote Mask*, *Marshal's Pike*).
Every slot and every item is now beach/racing/anime: **Snorkel · Floaty · Beach
Gear · Scarf · Headwear · Racing Suit · Wheels · Tow Rope**, with items like
Shark Snorkel, Hibiscus Floaty, Foam Noodle, Cat-Ear Helmet, Turbo Rims, and
Golden Flip-Flops.

**The podium** already shows the top three in their actual karts on gold/silver/
bronze steps, rotating under warm light.

## v23.3 — three minigames, real item impacts

**Three minigames, one per box colour.** Each station now offers all three, and
the colour tells you which is which — **teal = hoops**, **gold = lane hold**,
**coral = key drill**. The boxes were also 3.1m apart with a 3.2m grab radius,
so they *overlapped*: you got whichever the loop tested first, not the one you
aimed at. They're now 4m apart with a 2.3m reach, so picking your minigame is a
real decision at speed.

**Lane hold** paints a narrow lane on the road ahead with visible boundary lines
you can actually steer against. Drift a wheel out and the whole lane flashes red
and you stop banking credit.

**Key drill** — four pads (W/A/S/D) light one at a time, 2 seconds each. A key
you're *already holding* does not count: you must release and press it again.
Tested: mashing all four keys constantly scores **0**; playing it properly scores
5–6 of 6.

**Items now hit you.** A direct splash doesn't just slow you — it **spins the kart
out** (measured: a balloon wrenches the victim 387°, a full spin). Take enough
hits and you crumble into a sand pile, then press R to dig out.

**Stop off the road and the sand buries you.** Complete stop off-track → the kart
explodes into a sand pile, a 2-second "BURIED! — the sand got you" card, and you
press R when you're ready.

## v23.2 — your five changes

**No more auto-reset.** Being teleported without asking feels worse than being
stuck, so humans are never scooped. Off-track, the sand now *bogs you down* —
speed drains and after ~1.2s it drags you to a dead stop (measured: full
throttle, buried in ~4s). You press **R** when you decide to. Bots still
self-scoop, because nobody is watching them and a wedged bot stalls the race.

**Curbs on both sides of every turn, and they're real.** They used to render only
on the *outside* of a bend — half of every corner had no visual edge at all. Now
both sides, on gentler bends too. And they're functional: the outer strip of paint
is a rumble strip that rattles the camera and scrubs speed, so cutting a corner
costs you.

**Held item moved to top-center**, under the mirror. It was buried in the
bottom-left chip column; the item you're holding is the most decision-relevant
thing on screen.

**Pre-race flythrough.** The countdown is now 11s, and a camera sweeps the
circuit while the grid is frozen — it shows off the track *and* gives slower
machines time to finish loading before anyone can move.

**F1 start lights.** The last 3.6s: three red lamps light one by one with a low
prep beep each, flip to yellow, then **GREEN + GO!** with a bright chord. Driven
off the server's freeze clock, so everyone launches on the same instant.

## v23.1 — the finish-straight wedge

Three bugs, one symptom. You got pinned at 0 mph on the start/finish straight
and sat there ~18 seconds until you found the R key.

**The auto-rescue only ever ran for bots.** The stuck detector lived inside an
`if (p.isBot)` branch — the comment literally says *"any bot that hasn't gained
ground in 6s scoops itself back."* Humans had no safety net at all. That's why
nothing came to get you. It now covers everyone (9s for humans, 6s for bots),
and it measures **speed**, not progress — progress is derived from arc position
and wraps at the start line, which is exactly why the finish straight was the
worst place to get stuck.

**The bumper rails were decorative.** The soft "dune wall" sat at 7.7m — *inside*
the 11.5m rail — so the rail could never fire. The candy-striped noodles you can
see were cosmetic, and what actually stopped you was an invisible wall 3.8m short
of them, which also deleted the entire drivable sand shoulder. The wall now sits
outside the rail as a backstop, so the physics matches what's on screen.

**The rail glued you to it.** It clamped you to the exact rail line every tick
with no release, so a car pressed against it would grind along forever instead of
peeling back onto the road. It now seats you a nudge inside the rail and steers a
wall-pointed nose back along the track.

Nothing to do with the flat blocks or the beach ball, incidentally — there is no
decor collision in the sim at all. Those are purely visual.

## Two real bugs the QA hunt turned up

**The feel layer could never have rendered.** The overlays (threat vignette,
takedown banner, death cinematic, lap flags) were added to the HUD component,
but their state lived in the race component and was never passed down. Every one
of them was dead on arrival. Caught by counting draw calls instead of trusting
screenshots — the "verified" images I'd been looking at were a sign-in page, and
then a frozen frame from a crashed render loop.

**Wrong-way warnings never fired.** Turning on required 10 negative votes, but a
car going the wrong way usually *stops* (wall, rescue, slow reverse) — and a
still car abstains rather than voting negative. The count plateaued at 9 and the
warning was mathematically unreachable. It has been broken since v22. Now fires
~3.6 s after you turn around.

## Tests: 182 passing + 45 browser checks

engine 59 · items 25 · orientation 13 · sockets 28 · backend 25 · progression 5 ·
admin 27 · shared-sync ✓ — plus contract tests locking the circuit design, the
takedown window, the hoop economy, and the perk creed.
