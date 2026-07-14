// SANDBOX GP — THE MODE SYSTEM
//
// The engine used to BE a race engine: laps, checkpoints, a finish line, four
// players. Every mode here breaks at least one of those. The rules are pluggable
// now — the engine owns physics, items and erosion; a MODE owns the win
// condition. These tests defend that boundary, and each mode's actual game.
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { MODES, MODE_LIST, hasLineOfSight } from "./bridge-gameserver/src/engine/modes.js";
import { ARENAS, getArena, insideWall } from "./bridge-gameserver/src/engine/shared/arenas.js";
import { CAR } from "./bridge-gameserver/src/engine/shared/carSim.js";

const DT = 1 / 30;
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

const clearCountdown = (e) => {
  for (let s = 0; s < 30 && (e.startFreezeUntil - e.now) > 0; s += DT) e.tick(DT);
  e.tick(DT);
};

// spin up a mode with a full grid of bots and run it to a conclusion
function play(mode, { seconds = 500, players = null, seedOverride = 5 } = {}) {
  const e = new RaceEngine({ config: { seed: seedOverride, mode } });
  const n = players ?? e.map.maxPlayers;
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(e.addPlayer(`P${i}`, { userId: `u${i}`, isBot: true, botTier: "pilot" }));
  }
  e.start({ force: true });
  clearCountdown(e);
  const seen = {};
  let secs = 0;
  for (let s = 0; s < seconds && e.phase !== "ended"; s += DT) {
    e.tick(DT);
    secs = s;
    for (const id of ids) {
      for (const ev of e.eventsFor(id)) seen[ev.type] = (seen[ev.type] || 0) + 1;
    }
  }
  return { e, ids, seen, secs };
}

// ---- the mode registry ----
{
  const listed = MODE_LIST.map((m) => m.id).sort();
  const impl = Object.keys(MODES).sort();
  (JSON.stringify(listed) === JSON.stringify(impl))
    ? ok(`${listed.length} modes, and the lobby list matches the implementations`)
    : no(`lobby lists [${listed}] but engine has [${impl}]`);

  // 8 is the ceiling everywhere. The netcode is tuned for it; a mode that
  // quietly asks for 12 would be shipping a lobby that can't hold together.
  const over = MODE_LIST.filter((m) => m.max > 8);
  (over.length === 0)
    ? ok("no mode exceeds the 8-player ceiling")
    : no(`modes over the cap: ${over.map((m) => `${m.id}=${m.max}`).join(", ")}`);
}

// ---- EVERY MODE MUST BE SELECTABLE IN THE LOBBY ----
{
  // A mode's `view()` and `worldView()` read state that only exists AFTER init()
  // runs at match start. But the LOBBY builds a view too — that's how the picker
  // knows what you've chosen. Four of them threw there, which killed the whole
  // broadcast, so the client never learned the mode had changed and the button
  // simply did nothing. Derby, CTF, Sand Artist and Pearl Rush were unselectable.
  const e = new RaceEngine({ config: {} });
  const id = e.addPlayer("A", { userId: "a" });

  const broken = [];
  for (const m of MODE_LIST) {
    try {
      e.setMode(m.id);
      const v = e.viewFor(id);                      // this is what threw
      const got = typeof v.mode === "string" ? v.mode : v.mode?.id;
      if (got !== m.id) broken.push(`${m.id} (view says "${got}")`);
    } catch (err) {
      broken.push(`${m.id} THREW: ${err.message.slice(0, 40)}`);
    }
  }
  (broken.length === 0)
    ? ok(`all ${MODE_LIST.length} modes can be selected in the lobby`)
    : no(`modes that cannot be selected: ${broken.join(", ")}`);

  // and switching back and forth must keep working
  let flip = true;
  for (const m of ["derby", "race", "artist", "pearl", "ctf", "race"]) {
    try { e.setMode(m); e.viewFor(id); } catch { flip = false; }
  }
  flip
    ? ok("you can switch between modes freely, in any order")
    : no("switching modes back and forth breaks the lobby");
}

// ---- every arena is playable ----
{
  for (const [id, a] of Object.entries(ARENAS)) {
    // spawn pads must not be inside a wall, or a kart starts the match wedged
    const bad = a.spawns.filter((s) => insideWall(a, s.x, s.z, CAR.BODY_RADIUS));
    (bad.length === 0)
      ? ok(`${id}: all ${a.spawns.length} spawn pads are clear of walls`)
      : no(`${id}: ${bad.length} spawn pads are INSIDE a wall`);

    // and inside the rim
    const outside = a.spawns.filter((s) => Math.hypot(s.x, s.z) > a.radius - 2);
    (outside.length === 0)
      ? ok(`${id}: all spawns are inside the arena`)
      : no(`${id}: ${outside.length} spawns are outside the rim`);
  }
}

// ---- racing is UNTOUCHED ----
{
  const e = new RaceEngine({ config: { seed: 5, trackId: "sandcastle" } });
  (e.rules === null && e.arena === null && e.map.maxPlayers === 4)
    ? ok("a race is still a race: no mode rules, no arena, 4 players")
    : no("the mode layer leaked into plain racing");
}

// ---- 1. DEMOLITION DERBY ----
{
  const { e, seen } = play("derby");
  const living = [...e.players.values()].filter((p) => !p.eliminated);

  (e.phase === "ended" && living.length === 1)
    ? ok(`derby: 8 karts in, 1 out (${e.winReason})`)
    : no(`derby: phase=${e.phase}, ${living.length} survivors`);

  (seen.eliminated > 0 && seen.life_lost > 0)
    ? ok(`derby: ${seen.eliminated / 8} eliminations, ${seen.life_lost / 8} lives lost`)
    : no("derby: nobody was ever eliminated");

  (seen.wrecker_hit > 0)
    ? ok(`derby: the wreckers actually hunt (${Math.round(seen.wrecker_hit / 8)} rams)`)
    : no("derby: the wreckers never hit anyone");

  // The ram used to fire EVERY TICK while a wrecker sat on you — 2,000+ "hits"
  // in one derby, which is a blender, not a wrecking ball.
  (seen.wrecker_hit / 8 < 200)
    ? ok("derby: wrecker rams have a cooldown (not one per tick)")
    : no(`derby: ${Math.round(seen.wrecker_hit / 8)} rams — the wreckers are grinding, not ramming`);

  (e.mode_ring < ARENAS.pit.radius)
    ? ok(`derby: the ring closed (${ARENAS.pit.radius}m → ${Math.round(e.mode_ring)}m) — no stalemates`)
    : no("derby: the ring never closed");
}

// ---- 2. CAPTURE THE FLAG ----
{
  const { e, seen } = play("ctf", { seconds: 500 });

  (seen.flag_taken > 0)
    ? ok(`ctf: flags get stolen (${seen.flag_taken / 8})`)
    : no("ctf: nobody ever took a flag");
  (seen.flag_captured > 0)
    ? ok(`ctf: flags get captured (${seen.flag_captured / 8})`)
    : no("ctf: nobody ever scored");
  (e.phase === "ended")
    ? ok(`ctf: reaches a conclusion (${e.winReason})`)
    : no("ctf: never ended");

  // teams must be balanced, or a 5-player game is 5v0
  const t0 = [...e.players.values()].filter((p) => p.team === 0).length;
  const t1 = [...e.players.values()].filter((p) => p.team === 1).length;
  (Math.abs(t0 - t1) <= 1)
    ? ok(`ctf: teams are balanced (${t0} v ${t1})`)
    : no(`ctf: lopsided teams ${t0} v ${t1}`);
}

// ---- THE CTF DEADLOCK: it must never come back ----
{
  // The classic rule ("your own flag must be home to score") locks solid in a
  // kart game: both teams grab at once, neither can force a drop, and the match
  // runs to timeout with 0-0. Measured before the fix: 300 seconds, both flags
  // carried, zero captures. A capture must ALWAYS score.
  const e = new RaceEngine({ config: { seed: 5, mode: "ctf" } });
  const a = e.addPlayer("A", { userId: "a" });
  const b = e.addPlayer("B", { userId: "b" });
  e.start({ force: true });
  clearCountdown(e);
  const pa = e.players.get(a), pb = e.players.get(b);
  const ar = e.arena;

  // engineer the exact standoff: each team holds the other's flag
  e.mode_flags[1 - pa.team].carrier = pa.id;
  e.mode_flags[1 - pb.team].carrier = pb.id;
  // and walk A onto their own base
  pa.x = ar.bases[pa.team].x;
  pa.z = ar.bases[pa.team].z;
  for (let i = 0; i < 5; i++) e.tick(DT);

  (e.mode_captures[pa.team] > 0)
    ? ok("ctf: a capture scores even when your own flag is stolen (no deadlock)")
    : no("ctf: DEADLOCKED — both flags held, nobody can ever score");

  // and carrying must actually cost you something, or the run home is free
  const e2 = new RaceEngine({ config: { seed: 6, mode: "ctf" } });
  const c = e2.addPlayer("C", { userId: "c" });
  e2.addPlayer("D", { userId: "d" });
  e2.start({ force: true });
  clearCountdown(e2);
  const pc = e2.players.get(c);
  e2.mode_flags[1 - pc.team].carrier = pc.id;
  const ero0 = pc.erosion || 0;
  for (let i = 0; i < 60; i++) e2.tick(DT);
  (pc.modeSpeedMult < 1 && (pc.erosion || 0) > ero0)
    ? ok(`ctf: carrying the flag makes you slow (${pc.modeSpeedMult}×) and scours you — the run home IS the game`)
    : no("ctf: carrying the flag is free");
}

// ---- LINE OF SIGHT: enforced at the SOURCE, not just hidden on the client ----
{
  const e = new RaceEngine({ config: { seed: 2, mode: "ctf" } });
  const a = e.addPlayer("A", { userId: "a" });
  const b = e.addPlayer("B", { userId: "b" });
  e.start({ force: true });
  clearCountdown(e);
  const pa = e.players.get(a), pb = e.players.get(b);
  (pa.team !== pb.team) ? ok("ctf: the two players are on opposite teams") : no("both on the same team");

  // behind a pillar
  pa.x = -40; pa.z = 0;
  pb.x = 0; pb.z = 0;
  for (let i = 0; i < 3; i++) e.tick(DT);
  const hidden = e.viewFor(a);
  const bHidden = hidden.players.find((p) => p.id === b);

  (hidden.you.mode.visible[b] === false && bHidden.hidden === true)
    ? ok("line of sight: an enemy behind a pillar is hidden, and their REAL position is not sent")
    : no(`line of sight failed: visible=${hidden.you.mode.visible[b]} hidden=${bHidden?.hidden}`);

  // in the open
  pb.x = -30; pb.z = 0;
  for (let i = 0; i < 3; i++) e.tick(DT);
  const open = e.viewFor(a);
  (open.you.mode.visible[b] === true && !open.players.find((p) => p.id === b).hidden)
    ? ok("line of sight: step into the open and they appear")
    : no("line of sight: an enemy in the open is still hidden");

  // teammates are ALWAYS visible — that's what a team is. Build a fresh match:
  // you can't add a player to a race that's already running.
  const e3 = new RaceEngine({ config: { seed: 2, mode: "ctf" } });
  const x = e3.addPlayer("X", { userId: "x" });
  const y = e3.addPlayer("Y", { userId: "y" });
  const z = e3.addPlayer("Z", { userId: "z" });
  e3.start({ force: true });
  clearCountdown(e3);
  const px = e3.players.get(x);
  // force Z onto X's team and park them behind the same pillar
  const pz = e3.players.get(z);
  pz.team = px.team;
  px.x = -40; px.z = 0;
  pz.x = 0; pz.z = 0;
  for (let i = 0; i < 3; i++) e3.tick(DT);
  const v = e3.viewFor(x);
  (v.you.mode.visible[z] === true)
    ? ok("line of sight: teammates are always visible, walls or not")
    : no("a teammate was hidden behind a wall");
}

// ---- 3. SAND ARTIST ----
{
  const { e, seen } = play("artist", { seconds: 700, players: 4 });

  (seen.round_start > 0 && seen.round_end > 0)
    ? ok(`sand artist: rounds cycle (${seen.round_start / 4} started)`)
    : no("sand artist: rounds never ran");

  (e.phase === "ended" && e.winReason === "all_drawn")
    ? ok("sand artist: ends when everyone has drawn exactly once")
    : no(`sand artist: phase=${e.phase} reason=${e.winReason}`);

  // A wrong guess must destroy you. The bots pick a hallway at random, so on any
  // ONE seed they can all happen to be right — run a few and assert that wrong
  // guesses occur across them.
  let wrongTotal = 0;
  for (let seed = 21; seed <= 24; seed++) {
    const r = play("artist", { seconds: 700, players: 4, seedOverride: seed });
    wrongTotal += r.seen.guess_wrong || 0;
  }
  (wrongTotal > 0)
    ? ok(`sand artist: a wrong guess blows you up (${wrongTotal / 4} across four matches)`)
    : no("sand artist: nobody ever guessed wrong, across four whole matches");
}

// ---- the drawing itself ----
{
  const e = new RaceEngine({ config: { seed: 9, mode: "artist" } });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(e.addPlayer(`P${i}`, { userId: `u${i}` }));
  e.start({ force: true });
  clearCountdown(e);

  const drawer = e.players.get(e.mode_drawer);
  const a = e.arena;

  // ONLY the drawer knows the word.
  const drawerView = e.viewFor(e.mode_drawer);
  const otherId = ids.find((id) => id !== e.mode_drawer);
  const guesserView = e.viewFor(otherId);
  (drawerView.you.mode.word && !guesserView.you.mode.word)
    ? ok(`sand artist: only the drawer sees the word ("${drawerView.you.mode.word}")`)
    : no("sand artist: the word leaked to the guessers");

  // the word must be one of the four options
  (guesserView.you.mode.options.includes(drawerView.you.mode.word))
    ? ok("sand artist: the real word is among the four hallway options")
    : no("sand artist: the answer isn't on offer");

  // paint INSIDE the canvas — strokes land
  drawer.x = a.canvas.x; drawer.z = a.canvas.z;
  const before = e.mode_strokes.length;
  for (let i = 0; i < 30; i++) {
    e.setInput(e.mode_drawer, { throttle: 1, steer: 0.2, keys: { PAINT: true } });
    e.tick(DT);
  }
  (e.mode_strokes.length > before)
    ? ok(`sand artist: painting inside the canvas lays strokes (${e.mode_strokes.length})`)
    : no("sand artist: the drawer can't draw");

  // paint OUTSIDE it — nothing happens
  drawer.x = a.canvas.x + a.canvas.r + 20;
  drawer.z = a.canvas.z;
  const mid = e.mode_strokes.length;
  for (let i = 0; i < 30; i++) {
    e.setInput(e.mode_drawer, { throttle: 1, steer: 0.2, keys: { PAINT: true } });
    e.tick(DT);
  }
  (e.mode_strokes.length === mid)
    ? ok("sand artist: you can only draw inside the roped-off canvas")
    : no("sand artist: the drawer painted outside the canvas");

  // a GUESSER can't draw at all, wherever they stand
  const guesser = e.players.get(otherId);
  guesser.x = a.canvas.x; guesser.z = a.canvas.z;
  const before2 = e.mode_strokes.length;
  for (let i = 0; i < 30; i++) {
    e.setInput(otherId, { throttle: 0, steer: 0, keys: { PAINT: true } });
    e.tick(DT);
  }
  (e.mode_strokes.length === before2)
    ? ok("sand artist: only the drawer can draw")
    : no("sand artist: a guesser drew on the canvas");
}

// ---- the 5-second hallway lock ----
{
  const e = new RaceEngine({ config: { seed: 11, mode: "artist" } });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(e.addPlayer(`P${i}`, { userId: `u${i}` }));
  e.start({ force: true });
  clearCountdown(e);
  const a = e.arena;
  const guesserId = ids.find((id) => id !== e.mode_drawer);
  const g = e.players.get(guesserId);

  // find the hallway holding the RIGHT answer
  const rightHall = e.mode_options.indexOf(e.mode_word);
  const h = a.halls[rightHall];
  g.x = h.x; g.z = h.z; g.speed = 0;

  let locked = null;
  const t0 = e.now;
  for (let s = 0; s < 8 && !locked; s += DT) {
    e.setInput(guesserId, { throttle: 0, steer: 0 });
    e.tick(DT);
    for (const ev of e.eventsFor(guesserId)) {
      if (ev.type === "guess_correct") locked = e.now - t0;
    }
  }
  (locked && locked >= 4.5 && locked <= 6.5)
    ? ok(`sand artist: you must hold the hallway for 5s to commit (locked at ${locked.toFixed(1)}s)`)
    : no(`sand artist: the guess lock fired at ${locked?.toFixed(1) ?? "never"}s, expected ~5s`);
}

// ---- 4. TIME ATTACK ----
{
  const e = new RaceEngine({ config: { seed: 5, mode: "timeattack" } });
  (e.map.maxPlayers === 1)
    ? ok("time attack: strictly one kart")
    : no(`time attack allows ${e.map.maxPlayers} players`);
  (e.rules.items === false)
    ? ok("time attack: no items — you against the clock")
    : no("time attack has items");
  (e.arena === null)
    ? ok("time attack: runs on the real circuits, not an arena")
    : no("time attack got shoved into an arena");
}

// ---- 5. RIPTIDE TAG ----
{
  const { e, seen } = play("tag", { seconds: 250 });

  (seen.tagged > 0)
    ? ok(`riptide tag: IT gets passed around (${seen.tagged / 8} tags)`)
    : no("riptide tag: IT never changed hands");
  (e.phase === "ended" && e.winReason === "horn")
    ? ok("riptide tag: ends on the horn, and whoever's IT loses")
    : no(`riptide tag: phase=${e.phase} reason=${e.winReason}`);
  (e.mode_it)
    ? ok(`riptide tag: someone is always IT`)
    : no("riptide tag: nobody was IT");

  // IT is faster, or a good driver simply never gets caught
  const it = e.players.get(e.mode_it);
  (it?.modeSpeedMult > 1)
    ? ok(`riptide tag: IT is faster (${it.modeSpeedMult}×) — you can't just outrun it forever`)
    : no("riptide tag: IT has no speed advantage");
}

// ---- 6. PEARL RUSH (the researched one) ----
{
  const { e, seen } = play("pearl", { seconds: 250 });

  (seen.pearl_taken > 0)
    ? ok(`pearl rush: pearls get collected (${Math.round(seen.pearl_taken / 8)})`)
    : no("pearl rush: nobody collected anything");
  (e.phase === "ended")
    ? ok("pearl rush: ends on the clock")
    : no("pearl rush: never ended");
  (e.mode_leader)
    ? ok("pearl rush: a leader emerges (and wears the crown)")
    : no("pearl rush: no leader");

  // THE RULE THAT MAKES IT WORK: getting hit costs you pearls. Without it,
  // combat is pointless and the mode is a driving-skill test with no interaction.
  const e2 = new RaceEngine({ config: { seed: 12, mode: "pearl" } });
  const a = e2.addPlayer("A", { userId: "a" });
  e2.addPlayer("B", { userId: "b" });
  e2.start({ force: true });
  clearCountdown(e2);
  const pa = e2.players.get(a);
  pa.pearls = 20;
  const fieldBefore = e2.mode_pearls.filter((x) => !x.taken).length;
  e2.crumblePlayer(pa, { holdSec: 1, cause: "test" });
  for (let i = 0; i < 40; i++) e2.tick(DT);

  (pa.pearls < 20)
    ? ok(`pearl rush: getting wrecked SPILLS your haul (20 → ${pa.pearls})`)
    : no("pearl rush: you keep your pearls when destroyed — combat is pointless");

  (!pa.eliminated)
    ? ok("pearl rush: you respawn — this is the one mode where a weak player still contributes")
    : no("pearl rush eliminated someone");
}

// ---- arena physics: you cannot leave, and you cannot phase through walls ----
{
  const e = new RaceEngine({ config: { seed: 3, mode: "derby" } });
  const id = e.addPlayer("A", { userId: "a" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  const a = e.arena;

  // drive flat out at the rim for 10 seconds
  p.x = 0; p.z = 0;
  p.heading = 0;
  for (let s = 0; s < 10; s += DT) {
    e.setInput(id, { throttle: 1, steer: 0 });
    e.tick(DT);
  }
  (Math.hypot(p.x, p.z) <= a.radius + 0.5)
    ? ok(`arena: the rim contains you (${Math.round(Math.hypot(p.x, p.z))}m of ${a.radius}m)`)
    : no(`arena: escaped to ${Math.round(Math.hypot(p.x, p.z))}m`);

  // and you can't end up inside the central wreck pile
  let insideAny = false;
  for (let s = 0; s < 20; s += DT) {
    e.setInput(id, { throttle: 1, steer: 0.35 });
    e.tick(DT);
    if (insideWall(a, p.x, p.z, -0.2)) insideAny = true;
  }
  (!insideAny)
    ? ok("arena: karts never end up inside a wall")
    : no("arena: a kart phased into a wall");
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
