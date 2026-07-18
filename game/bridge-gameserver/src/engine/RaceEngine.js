// ============================================================
// SANDBOX GP — RaceEngine v2 (real race).
//
// Replaces the Batch 1 stub behind the SAME netcode contract (see README):
// the net layer stays untouched. What's new:
//   • players carry real transforms (x, z, heading, speed) driven by the shared
//     deterministic car sim (shared/carSim.js) at the server tick
//   • race_input per player: { throttle, steer } — applied every tick
//   • laps + ordered checkpoints on the shared track (anti-shortcut)
//   • bot drivers: pure-pursuit steering toward a lookahead point with
//     curvature-based braking — same car constants as humans, ALWAYS
//   • reset button: shovel-scoop back to the centerline at a dead stop
//
// All race-visible state is authoritative here. The client renders + predicts
// its own car with the same shared sim, then reconciles.
// ============================================================

import { PHASE } from "./constants.js";
import { makeTrack } from "./shared/track.js";
import { stepCar, stepCarFree, separateCars, CAR } from "./shared/carSim.js";
import { makeItemBoxes, makeArenaBoxes, tickChallenges, tickArenaBoxes, challengeView } from "./challenges.js";
import { addEffect, crumble, erode, rollItem, useItem as fireItem, kiteTap, tickItems, computeMods, itemsView, statusFlags, ITEMS } from "./items.js";
import { getMode, hasLineOfSight } from "./modes.js";

// Can `viewer` see `target`? Only meaningful in a mode that cares (CTF), and
// only in an arena (a track has no walls to hide behind). Teammates always see
// each other — that's what a team is.
function losHidden(engine, viewer, target) {
  if (!engine.arena) return false;
  if (!engine.rules?.view) return false;
  if (engine.mode?.id !== "ctf") return false;
  if (viewer.team === target.team) return false;
  return !hasLineOfSight(engine.arena, viewer.x, viewer.z, target.x, target.z);
}
import { getArena, stepArena } from "./shared/arenas.js";
import { makeRng } from "./rng.js";

let _idSeq = 0;
function newId(prefix) { return `${prefix}${++_idSeq}_${Math.random().toString(36).slice(2, 6)}`; }

// Long enough for the pre-race flythrough to show off the circuit AND give
// slower machines time to finish loading the world before anyone can move.
// The last 3.6s of it are the red->yellow->GREEN light sequence.
const START_FREEZE_SEC = 11;
const EMOTE_SECONDS = 3;
const RESET_STOP_SEC = 0.9;      // shovel scoop: brief held-still beat after reset
const TIMEOUT_AFTER_WINNER = 45; // once someone finishes, stragglers get this long
// Hard ceiling on a lap race so a match can never run forever (an all-stuck or
// all-AFK grid still resolves). Comfortably longer than any real 3-lap race.
const RACE_TIME_LIMIT_SEC = 420;

export class RaceEngine {
  constructor({ config = {} } = {}) {
    this.config = { isPublic: false, ...config };
    // In the lobby a "random" room still needs SOME track object to exist (grid
    // poses, box layout). It gets replaced at start(); the client just never
    // shows which one until then.
    this.track = makeTrack(
      (this.config.trackId && this.config.trackId !== "random") ? this.config.trackId : "sandcastle"
    );
    const d = this.track.def;
    // Player cap: a track says 4, but a derby wants 8. The MODE wins when it has
    // an opinion — otherwise the track's cap stands.
    // ---- THE MODE LAYER ----
    // The engine owns physics, items, erosion and the tick loop. A MODE owns the
    // win condition and whatever makes it that mode. `null` = stock racing,
    // which is what the engine did before modes existed and still does.
    this.rules = getMode(this.config.mode) || null;
    this.arena = this.rules?.arena ? getArena(this.rules.arena) : null;
    this.mode = this.rules
      ? { id: this.rules.id, label: this.rules.label }
      : { id: "race", label: "Race" };

    this.map = {
      id: d.id, name: d.name,
      minPlayers: this.rules?.minPlayers ?? RaceEngine.raceMin(this.config.mode),
      maxPlayers: this.rules?.maxPlayers ?? RaceEngine.raceMax(this.config.mode),
    };
    if (this.arena) {
      this.map = { ...this.map, id: this.arena.id, name: this.arena.name, arena: this.arena.id };
    }
    this.laps = Number(this.config.laps) > 0 ? Number(this.config.laps) : d.laps;
    this.finishTimeout = Number(this.config.finishTimeoutSec) > 0 ? Number(this.config.finishTimeoutSec) : TIMEOUT_AFTER_WINNER;
    this.phase = PHASE.LOBBY;
    this.players = new Map();
    this.now = 0;
    this.winner = null;
    this.winReason = null;
    this.startFreezeUntil = 0;
    this.hardEndAt = Infinity;
    this.finishOrder = [];
    this.activePerks = [];
    this.previousPerks = [];
    this.previousWinner = null;
    this._events = [];
    this._colorSeq = 0;
    this.rng = makeRng(this.config.seed ?? Math.floor(Math.random() * 1e9));
    // Item boxes: track modes string minigame boxes along the racing line; arena
    // modes scatter direct-grant boxes across the bowl. Either way, items:false
    // (Time Attack, Sand Artist) means no boxes.
    const itemsOffCtor = this.config.items === false || this.rules?.items === false;
    this.itemBoxes = itemsOffCtor ? [] : (this.arena ? makeArenaBoxes(this.arena, this.rng) : makeItemBoxes(this.track));
    this.entities = [];
    this._entSeq = 0;
  }

  // ---- lobby ----
  addPlayer(name, account = null) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Race already started.");
    if (this.players.size >= this.map.maxPlayers) throw new Error("Race is full.");
    const id = newId("p");
    this.players.set(id, {
      id, name,
      accountId: account?.userId || null,
      isBot: !!account?.isBot,
      botTier: account?.botTier || null,
      loadout: account?.loadout || {},
      eventFlags: account?.eventFlags || [],
      streamerMode: !!account?.streamerMode,
      idColor: this._assignIdColor(),
      connected: true,
      // race state
      x: 0, z: 0, y: 0, vy: 0, airborne: false, heading: 0, speed: 0, offTrack: false, sampleHint: -1,
      perks: new Set(account?.equippedPerks || []),
      avatarId: account?.selectedAvatar || null,
      borderId: account?.selectedBorder || null,
      input: { throttle: 0, steer: 0 },
      lap: 0, nextCp: 0, lastSample: 0,
      progress: 0,          // total meters completed (laps*total + within-lap)
      finished: false, finishTime: null, place: null,
      resetUntil: 0,        // frozen-after-reset window
      mods: {},             // item effects hook (Batch 5)
      challenge: null, heldItem: null, mChallenges: 0, mSTiers: 0,
      effects: [], erosion: 0, kiteTaps: 0, kiteNeed: 0,
      mItemsUsed: 0, mCrumbles: 0, mSplashesCaused: 0, mCrumblesCaused: 0,
      // per-match stats reported at the end
      mResets: 0, mBestLapSec: null, _lapStartAt: 0,
      emote: null, emoteUntil: 0,
      bot: account?.isBot ? this._makeBot(account.botTier) : null,
    });
    return id;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.finishOrder = this.finishOrder.filter((id) => id !== playerId);
  }

  _assignIdColor() {
    const colors = ["#e2574c", "#f2b134", "#4ca7e2", "#58c26a", "#e28b4c", "#4cc2b0", "#d95f9b", "#8a6ce2"];
    return colors[this._colorSeq++ % colors.length];
  }

  isEventHost(playerId) {
    const p = this.players.get(playerId);
    return !!p?.eventFlags?.includes("event_host");
  }

  // ---- lifecycle ----
  // The RACEABLE circuits, equal weight. testloop is a test fixture and is never
  // in the pool — it must never appear in front of a player.
  // The circuit pool. Grand Prix and Time Attack draw from THE SAME LIST, always —
  // a time-attack map you can't race (or a race map you can't set a time on) would
  // be a bug, not a feature. Add a track here and both modes get it.
  static get CIRCUITS() { return ["sandcastle", "pharaoh", "shingle", "pier", "volcano"]; }

  // Grand Prix roster: 4 min / 8 max, matching every arena mode. The ONE
  // exception across the whole game is Time Attack, which is a solo speed check
  // (its own mode object carries 1/1). Keeping these here — rather than leaning
  // on a circuit's authored cap of 4 — is what stops "fill a mode to 8, switch
  // to a 4-cap map, race starts with 8": there is no 4-cap map any more.
  static raceMin(modeId) { return modeId === "timeattack" ? 1 : 4; }
  static raceMax(modeId) { return modeId === "timeattack" ? 1 : 8; }

  // Trim the roster down to the current cap, dropping BOTS first (newest first)
  // and only then extra humans, so lowering the cap can never leave more karts
  // on the grid than the mode allows. Returns the ids removed.
  _trimToCap() {
    const cap = this.map.maxPlayers;
    const removed = [];
    if (this.players.size <= cap) return removed;
    const ids = [...this.players.keys()];
    const bots = ids.filter((id) => this.players.get(id)?.isBot).reverse();
    const humans = ids.filter((id) => !this.players.get(id)?.isBot).reverse();
    const order = [...bots, ...humans];   // bots go first
    while (this.players.size > cap && order.length) {
      const id = order.shift();
      this.removePlayer(id);
      removed.push(id);
    }
    return removed;
  }

  start({ force = false } = {}) {
    // MAP REVEAL: if the host left the circuit on Random (the default), roll it
    // NOW — at the green flag, not in the lobby. Nobody gets to pre-plan for a
    // map, and the reveal lands as everyone loads in. Equal chance, every map.
    if (!this.config.trackId || this.config.trackId === "random") {
      const pool = RaceEngine.CIRCUITS;
      // Burn a few values first: the seeded PRNG's FIRST output is strongly
      // correlated with the seed, so picking straight off it gave 91% pharaoh
      // across 400 rooms. Equal chance means equal chance.
      this.rng(); this.rng(); this.rng();
      const pick = pool[Math.floor(this.rng() * pool.length)];
      this.setTrack(pick, { force: true });
      this.config.randomPick = true;      // so the client can play the reveal
    }
    // perk: Bucket Boy — a shield charge at the green light
    for (const p of this.players.values()) {
      if (p.perks?.has?.("BUCKET_BOY")) {
        p.effects = p.effects || [];
        if (!p.effects.some((e) => e.kind === "shield")) p.effects.push({ kind: "shield", until: this.now + 99999 });
      }
    }
    if (this.phase !== PHASE.LOBBY) throw new Error("Race already started.");
    if (!force && this.players.size < this.map.minPlayers)
      throw new Error(`Need at least ${this.map.minPlayers} racer(s).`);
    this.phase = PHASE.ACTIVE;
    this.startFreezeUntil = this.now + START_FREEZE_SEC;
    // EVERY mode is on a clock now, so nobody ever waits forever for a match that
    // can't resolve. A mode with its own durationSec (the arena modes) uses that;
    // a lap race gets a generous ceiling so a stuck/AFK grid still wraps up and
    // the timer HUD always has something to count. When the clock runs out with
    // no winner the match is a DRAW (see the finish block).
    const dur = this.rules?.durationSec || (this.rules?.id === "timeattack" ? 600 : RACE_TIME_LIMIT_SEC);
    this.hardEndAt = this.startFreezeUntil + dur;
    this.matchDurationSec = dur;
    let slot = 0;
    for (const p of this.players.values()) {
      const pose = this.track.gridPose(slot++);
      p.x = pose.x; p.z = pose.z; p.y = pose.y || 0; p.vy = 0; p.heading = pose.heading;
      p.speed = 0; p.lap = 0; p.nextCp = 0; p.progress = 0;
      p.sampleHint = this.track.nearest(p.x, p.z, -1);
      p.lastSample = p.sampleHint;
      p._lapStartAt = this.startFreezeUntil;
    }

    // ---- ARENA SPAWNS ----
    // A grid pose is a point on a spline facing along it. An arena has no
    // spline, so the pads are authored and the karts face the middle.
    if (this.arena) {
      let slot = 0;
      for (const p of this.players.values()) {
        const pad = this.arena.spawns[slot++ % this.arena.spawns.length];
        p.x = pad.x; p.z = pad.z; p.y = 0; p.vy = 0;
        p.heading = pad.heading ?? 0;
        p.speed = 0;
        p.sampleHint = -1;
      }
    }

    // ---- the mode gets to set itself up ----
    this.rules?.init?.(this);
  }

  // The mode layer needs to hurt and destroy karts without importing items.js
  // and reaching into the engine's guts. These are the two verbs it's allowed.
  erodePlayer(p, amount, byId = null) {
    erode(this, p, amount, byId);
  }
  crumblePlayer(p, opts = {}) {
    crumble(this, p, opts);
  }

  // Player driving input (from race_input socket event). Ignored while frozen.
  // Swap the circuit in the lobby. Rebuilds the track and everything pinned to
  // it (item boxes, grid poses) — the engine builds its track once at
  // construction, so config alone isn't enough.
  // Swap the MODE in the lobby. A mode owns the rules, the arena, the player cap
  // and the spawns — all of which are resolved at construction, so merging a
  // mode id into config alone would leave everyone playing the old game on the
  // old map while the lobby claimed otherwise.
  setMode(modeId) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Can't change the mode after the match starts.");
    this.config.mode = modeId;
    this.rules = getMode(modeId) || null;
    this.arena = this.rules?.arena ? getArena(this.rules.arena) : null;
    this.mode = this.rules
      ? { id: this.rules.id, label: this.rules.label }
      : { id: "race", label: "Race" };

    const d = this.track.def;
    this.map = {
      id: this.arena?.id ?? d.id,
      name: this.arena?.name ?? d.name,
      arena: this.arena?.id ?? null,
      minPlayers: this.rules?.minPlayers ?? RaceEngine.raceMin(modeId),
      maxPlayers: this.rules?.maxPlayers ?? RaceEngine.raceMax(modeId),
    };

    // THE 8→4 BUG. Switching from an 8-player mode you'd filled down to one with
    // a smaller cap used to keep every kart seated, and the match then started
    // over-capacity. Trim to the new cap here (bots first) so the roster always
    // fits the mode you're actually about to play. (With every mode 4–8 except
    // Time Attack, this only really bites when switching TO Time Attack, which
    // drops everyone but one — correct for a solo speed check.)
    const dropped = this._trimToCap();
    if (dropped.length) this._events.push({ type: "roster_trimmed", removed: dropped, cap: this.map.maxPlayers });

    // items may be off entirely (Sand Artist, Time Attack)
    const itemsOff = this.config.items === false || this.rules?.items === false;
    this.itemBoxes = itemsOff ? [] : (this.arena ? makeArenaBoxes(this.arena, this.rng) : makeItemBoxes(this.track));
    this._boxWaveAt = null;
    this._arenaBoxWaveAt = null;

    // re-pose everyone for the new world
    let slot = 0;
    for (const p of this.players.values()) {
      if (this.arena) {
        const pad = this.arena.spawns[slot++ % this.arena.spawns.length];
        p.x = pad.x; p.z = pad.z; p.y = 0; p.heading = pad.heading ?? 0;
      } else {
        const pose = this.track.gridPose(slot++);
        p.x = pose.x; p.z = pose.z; p.y = pose.y || 0; p.heading = pose.heading;
      }
      p.speed = 0; p.lap = 0; p.progress = 0;
      p.sampleHint = -1; p.lastSample = -1;
    }
  }

  setTrack(trackId, { force = false } = {}) {
    if (!force && this.phase !== PHASE.LOBBY) throw new Error("Can't change the circuit after the race starts.");
    this.config.trackId = trackId;
    this.track = makeTrack(trackId);
    // The MODE owns the player cap, not the circuit. A track says 4, but a Derby
    // wants 8 — so changing the circuit inside a Derby lobby must NOT quietly pull
    // the cap back down to the track's number. Keep the mode's cap (or the stock
    // race 4/8) authoritative; only fall back to the track def when no mode and no
    // prior cap have an opinion.
    const modeMin = this.rules?.minPlayers ?? RaceEngine.raceMin(this.config.mode);
    const modeMax = this.rules?.maxPlayers ?? RaceEngine.raceMax(this.config.mode);
    this.map = {
      ...this.map,
      trackId: this.track.def.id,
      minPlayers: modeMin,
      maxPlayers: modeMax,
    };
    // Respect items:false (time trial has no boxes). Rebuilding them
    // unconditionally on a track swap put 54 boxes on a time-trial circuit.
    // And in an ARENA mode the boxes are arena boxes, not track boxes — a track
    // swap (or the random-map roll at start) must not replace them with a strip
    // of boxes laid along a racing line the arena doesn't have.
    const itemsOff = this.config.items === false || this.rules?.items === false;
    this.itemBoxes = itemsOff ? [] : (this.arena ? makeArenaBoxes(this.arena, this.rng) : makeItemBoxes(this.track));
    this._boxWaveAt = null;
    this._arenaBoxWaveAt = null;
    // Defensive: if the resolved cap is below the current roster, trim (bots
    // first) just as setMode does, so the roster and the cap never disagree.
    const dropped = this._trimToCap();
    if (dropped.length) this._events.push({ type: "roster_trimmed", removed: dropped, cap: this.map.maxPlayers });
    let slot = 0;
    for (const p of this.players.values()) {
      const pose = this.track.gridPose(slot++);
      p.x = pose.x; p.z = pose.z; p.y = pose.y || 0;
      p.heading = pose.heading;
      p.sampleHint = -1; p.lastSample = -1; p.progress = 0; p.lap = 0;
    }
  }

  setInput(playerId, { throttle = 0, steer = 0, keys = null } = {}) {
    const p = this.players.get(playerId);
    if (!p) throw new Error("No such player.");
    p.input.throttle = Math.max(-1, Math.min(1, Number(throttle) || 0));
    p.input.steer = Math.max(-1, Math.min(1, Number(steer) || 0));
    // Raw WASD state, for the key-drill minigame. Throttle/steer are derived and
    // can't tell "held" from "pressed again", which is the whole point of that
    // game — you must RELEASE and re-press.
    if (keys && typeof keys === "object") {
      p.input.keys = {
        W: !!keys.W, A: !!keys.A, S: !!keys.S, D: !!keys.D,
        // Sand Artist: the paint key and the five prop stamps
        PAINT: !!keys.PAINT,
        PROP1: !!keys.PROP1, PROP2: !!keys.PROP2, PROP3: !!keys.PROP3,
        PROP4: !!keys.PROP4, PROP5: !!keys.PROP5,
      };
    }
  }

  // The shovel scoop: back to the centerline where you are, dead stop, small beat.
  requestReset(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== PHASE.ACTIVE || p.finished) return;
    // In an arena there IS no centerline to be scooped back onto — `centerPose`
    // would hand back a coordinate from the track's world and fling the kart
    // somewhere it can never drive back from. Reset to a spawn pad instead.
    if (this.arena) {
      const pad = this.arena.spawns[Math.floor(this.rng() * this.arena.spawns.length)];
      p.x = pad.x; p.z = pad.z; p.y = 0; p.vy = 0;
      p.heading = pad.heading ?? 0;
      p.speed = 0;
      p.resetUntil = this.now + RESET_STOP_SEC;
      p.mResets = (p.mResets || 0) + 1;
      this._events.push({ type: "reset", playerId: p.id });
      return;
    }
    const pose = this.track.centerPose(p.groundedHint ?? p.sampleHint);
    p.x = pose.x; p.z = pose.z; p.y = pose.y || 0; p.vy = 0; p.heading = pose.heading;
    p.speed = 0;
    p.resetUntil = this.now + RESET_STOP_SEC;
    p.mResets++;
    this._events.push({ type: "reset", playerId });
  }

  tick(dt) {
    this.now += dt;
    if (this.phase !== PHASE.ACTIVE) return;
    const frozen = this.now < this.startFreezeUntil;

    const list = [...this.players.values()];
    for (const p of list) {
      if (p.finished) { p.speed = Math.max(0, p.speed - CAR.BRAKE * 0.6 * dt); this._integrateCoast(p, dt); continue; }
      // crumbled: dead at the wreck for the full window, then bucket-molded
      // back onto the road (with altitude — the bridge exists now)
      if (p.crumbledUntil) {
        if (this.now < p.crumbledUntil) { p.speed = 0; continue; }
        // The MODE decides what a destroyed kart means. In a derby it's a life
        // gone; in Pearl Rush you spill your haul and carry on; in a race you
        // just reform. If the mode says "handled", we don't respawn them.
        if (this.rules?.onCrumble?.(this, p, p._lastHitBy)) {
          p.crumbledUntil = null;
          p.speed = 0;
          continue;
        }
        if (this.arena) {
          // reform on a spawn pad — there's no centerline to be molded back onto
          const pad = this.arena.spawns[Math.floor(this.rng() * this.arena.spawns.length)];
          p.x = pad.x; p.z = pad.z; p.y = 0; p.vy = 0;
          p.heading = pad.heading ?? 0;
          p.crumbledUntil = null;
          p.resetUntil = this.now + 0.8;
          p.erosion = 0;
          this._events.push({ type: "respawn", playerId: p.id });
          continue;
        }
        const pose = this.track.centerPose(p._respawnHint ?? p.sampleHint ?? 0);
        p.x = pose.x; p.z = pose.z; p.y = pose.y || 0; p.vy = 0;
        p.sampleHint = p._respawnHint ?? p.sampleHint;
        p.heading = pose.heading;
        p.crumbledUntil = null;
        p.resetUntil = this.now + 0.8;   // brief scoop beat after reforming
        if (p.perks?.has?.("SECOND_SCOOP") && !p.heldItem) {   // perk: Second Scoop
          p.heldItem = { id: rollItem(this.rng), tier: "bronze" };
        }
        this._events.push({ type: "respawn", playerId: p.id });
      }
      if (frozen || this.now < p.resetUntil) { p.speed = 0; continue; }
      if (p.isBot) this._botItems(p);

      // NO AUTO-RESET for humans. Being teleported without asking feels worse
      // than being stuck. Off-track now just drags you to a stop (see carSim
      // SAND_DRAG / OFFTRACK_STOP) and you press R when you want out — your
      // call, your timing. Bots still self-scoop, since nobody is watching them
      // and a wedged bot would otherwise stall the race forever.
      // OVERBOARD: on the pier there's no shoulder and no rails — leaving the
      // boards means you're over water. You go straight in, no bogging down,
      // and get fished out at the last plank you actually touched (so falling
      // off can never advance you). This is the map's whole identity: the only
      // track where a single mistake costs you the race.
      if (!this.arena && !p.finished && !p.crumbledUntil && p.inWater) {
        p.speed = 0;
        p.vy = 0;
        this._events.push({ type: "splashdown", playerId: p.id });
        const gi = p.groundedHint ?? p.sampleHint ?? 0;
        const c = this.track.at(gi);
        p.x = c.x; p.z = c.z; p.y = c.y || 0;
        p.sampleHint = gi;
        p.heading = Math.atan2(c.tz, c.tx);
        p.offSince = 0;
        p.inWater = false;
        p.resetUntil = this.now + 1.6;      // hauled out, dripping
        p.mResets = (p.mResets || 0) + 1;
        continue;
      }

      // BURIED IN THE SAND: come to a complete stop off the road and the kart
      // crumbles into a sand pile, same as a takedown. You watch it happen, then
      // press R to dig out. Being stranded is now an EVENT, not just a car that
      // stopped moving.
      // BURIED IN THE SAND — but ONLY if you are genuinely stranded.
      //
      // This used to fire on `offTrack && speed < 0.4 && offSince > 1.6`. Three
      // problems, and together they meant you exploded constantly:
      //
      //   • `offTrack` is true the moment you touch the SHOULDER — a foot off the
      //     kerb, still on perfectly drivable sand.
      //   • speed < 0.4 is any stop at all. Brake to line up a corner with two
      //     wheels on the shoulder and you die.
      //   • 1.6 seconds is nothing.
      //
      // Now: you must be WELL out (past the drivable shoulder), stopped, and stay
      // stopped for a good while. Stop on the shoulder and nothing happens — you
      // just drive on, which is what should have happened all along.
      // Past the shoulder, but INSIDE the bumper rail (width/2 + 6) — otherwise the
      // rails stop you before you can ever reach the threshold, and the burial can
      // never fire at all. width/2 + 4 sits comfortably out in the sand while still
      // being somewhere a kart can actually end up.
      const STRANDED_LAT = this.track.width / 2 + 4;
      const stranded = (() => {
        if (this.arena || p.finished || p.crumbledUntil) return false;
        if (Math.abs(p.speed) > 1.2) return false;
        const i = this.track.nearest(p.x, p.z, p.sampleHint, p.y);
        return Math.abs(this.track.lateral(p.x, p.z, i)) > STRANDED_LAT;
      })();
      if (stranded) {
        p._strandedFor = (p._strandedFor || 0) + dt;
      } else {
        p._strandedFor = 0;
      }
      // PRESS R TO RESPAWN. Humans aren't auto-teleported — they're dragged to a
      // halt off the road and left there until they choose to dig out. That's
      // fine, but with nothing on screen it just looks like the kart died. Once
      // you've been genuinely stopped off-track for a beat (and before the sand
      // swallows you at 4s), flag it so the HUD can prompt "Press R to respawn".
      p.needsReset = (!p.isBot && stranded && p._strandedFor > 1.0
        && this.now > p.resetUntil && !p.finished && !p.crumbledUntil);
      if (p._strandedFor > 4.0) {
        p._strandedFor = 0;
        p.needsReset = false;
        p._lastHitBy = null;                 // nobody's takedown — the sand got you
        crumble(this, p, { holdSec: 2.0, cause: "sand" });
      }

      if (p.isBot) {
        if (p._movingAt == null) p._movingAt = this.now;
        if (Math.abs(p.speed) > 1.5) p._movingAt = this.now;
        if (this.now - p._movingAt > 6 && this.now > p.resetUntil && !p.finished && !p.crumbledUntil) {
          this.requestReset(p.id);
          p._movingAt = this.now;
        }
      }

      const input = p.isBot ? this._botInput(p) : p.input;
      p.mods = computeMods(p, this.now);
      if (this.arena) {
        // ARENA PHYSICS. An arena has no centerline, so none of the track's
        // lateral maths applies — no ribbon, no rails, no off-track sand. It has
        // a rim, walls, and hazards, and that's the whole world.
        p.mods = p.mods || {};
        if (p.modeSpeedMult) p.mods.speedMult = (p.mods.speedMult ?? 1) * p.modeSpeedMult;
        stepCarFree(p, input, dt, p.mods);
        stepArena(p, this.arena, dt, CAR);

        // ---- ARENA HAZARD DAMAGE ----
        // stepArena flags contact; the engine hands out the consequences (same
        // split as lava on the tracks). Before this, arena hazards did nothing
        // but nudge your speed — a "hazard" you could park in all match.
        //   • TAR: bogs AND erodes slowly. Camping in it now costs you.
        //   • SINK / DEEP: a PIT. It grabs you (stepArena pulls you in), erodes
        //     fast, and once it's really got you it FISHES YOU OUT — ejected to a
        //     spawn pad, damaged, briefly stunned. That's "the pits push you off".
        if (p.inTar) {
          erode(this, p, 0.18 * dt, null);
        }
        if (p.inSink || p.inDeep) {
          // light, steady chip while you're in it — crossing costs a little, but
          // it takes real LINGERING before the pit actually throws you out
          erode(this, p, 0.30 * dt, null);
          p._pitFor = (p._pitFor || 0) + dt;
          if (!p._pitWarned || this.now - p._pitWarned > 1.5) {
            p._pitWarned = this.now;
            this._events.push({ type: "pit_grab", playerId: p.id, x: p.x, z: p.z });
          }
          // stuck in the pit for a good beat → thrown out to a pad, dazed. The
          // long dwell requirement means a bot (or player) driving THROUGH is
          // fine; only someone genuinely caught gets ejected.
          if (p._pitFor > 3.0 && this.now > (p.resetUntil || 0)) {
            p._pitFor = 0;
            const pad = this.arena.spawns[Math.floor(this.rng() * this.arena.spawns.length)];
            p.x = pad.x; p.z = pad.z; p.y = 0; p.vy = 0;
            p.heading = pad.heading ?? 0;
            p.speed = 0;
            p.resetUntil = this.now + 1.0;
            erode(this, p, 0.35, null);             // the ejection itself stings
            p.mResets = (p.mResets || 0) + 1;
            this._events.push({ type: "pit_eject", playerId: p.id, x: pad.x, z: pad.z });
          }
        } else {
          p._pitFor = 0;
        }
      } else {
        stepCar(p, input, dt, this.track, p.mods);
      }
      // LAVA BURNS. The sim flags it; the engine is what actually hurts you —
      // erosion is the engine's to hand out, not the physics'.
      if (p.lavaBurn > 0) {
        erode(this, p, 0.9 * p.lavaBurn, null);
        if (!p._lavaWarned || this.now - p._lavaWarned > 1) {
          p._lavaWarned = this.now;
          this._events.push({ type: "lava_burn", playerId: p.id });
        }
      }
      // ASH BLINDS. Same effect a Sand Clod gives you, from the mountain instead.
      if (p.blindedByAsh) addEffect(p, "blinded", 0.5, { now: this.now });

      // ---- offroad rescue: 2.5s in the sand → lifeguard puts you back ----
      // Bumpers stop the horizon-run, but a kart beached in the shoulder (or
      // launched there by items) shouldn't rot: snap to the centerline at a
      // stop, count it like a manual reset, and tell the client to toast it.
      // TRACK-ONLY SYSTEMS. An arena has no off-track, no centerline and no
      // groundedHint — this rescue teleports a kart to `track.at(i)`, which in
      // an arena is a coordinate from an entirely different world. It put a
      // derby kart 5 metres OUTSIDE the rim.
      if (!this.arena && !p.finished && p.isBot) {          // humans are never auto-scooped
        if (p.offTrack) {
          if (p._offSince == null) p._offSince = this.now;
          else if (this.now - p._offSince > 2.5) {
            const gi = p.groundedHint ?? p.sampleHint ?? 0;
            const c = this.track.at(gi);
            p.x = c.x; p.z = c.z; p.y = c.y || 0; p.vy = 0;
            p.sampleHint = gi;
            p.heading = Math.atan2(c.tz, c.tx);
            p.speed = 0;
            p.mResets = (p.mResets || 0) + 1;
            p._offSince = null;
            this._events.push({ type: "rescue", playerId: p.id });
          }
        } else p._offSince = null;
      }
      // Laps and checkpoints only mean something on a track. In an arena there's
      // no start line to cross and no direction of travel to be wrong about.
      if (!this.arena) this._trackProgress(p);
    }

    // ---- THE MODE'S OWN RULES ----
    // Runs after physics (so it sees where everyone actually is) and before the
    // finish check (so a capture or a kill can end the match this same tick).
    if (!frozen && this.rules) {
      this.rules.tick?.(this, dt);
      this.rules.postTick?.(this, dt);
      this._updateLastSeen();
    }

    // item boxes + personal challenges. A mode can turn items off entirely
    // (Sand Artist is a drawing game; Time Attack is you against the clock).
    const itemsOn = this.config.items !== false && this.rules?.items !== false;
    if (!frozen && itemsOn && !this.arena) {
      for (const ev of tickChallenges(this, dt)) this._events.push(ev);
      tickItems(this, dt);
    } else if (!frozen && itemsOn && this.arena) {
      // arenas: direct-grant boxes scattered across the bowl (no racing line for
      // the hoop-run minigames), plus the same held-item firing as the track
      for (const ev of tickArenaBoxes(this, dt)) this._events.push(ev);
      tickItems(this, dt);
    }

    // car-vs-car bumping (identical masses — the design rule again)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (!list[i].finished && !list[j].finished) separateCars(list[i], list[j]);

    // (No post-bump floor re-clamp here. It looked sensible — separateCars can
    // shove a kart sideways onto road at a different height — but it ran on every
    // kart every tick, including ones sitting off-track in the sand, and it was
    // quietly interfering with the off-road bog and the R-reset. stepCar's own
    // clamp already guarantees nobody ends a tick inside the road, which is the
    // bug that actually mattered.)

    // ---- THE MODE DECIDES WHEN IT'S OVER ----
    // Last kart standing, three captures, everyone has drawn, the horn — none of
    // those are "everyone crossed the line N times".
    if (!frozen && this.rules?.onFinishCheck) {
      const r = this.rules.onFinishCheck(this);
      if (r?.done) {
        this.phase = PHASE.ENDED;
        this.winReason = r.reason;
        this.modeResult = r;
        this._rankByMode();
        this._events.push({ type: "match_over", reason: r.reason, ...r });
        return;
      }
    }

    // finish / timeout resolution
    if (this.now >= this.hardEndAt) {
      // THE CLOCK RAN OUT. If nobody has actually won by now, it's a DRAW rather
      // than a hollow "whoever happened to be ahead" — that's what the request
      // asked for. "Nobody won" means: no finisher, and no single leader on
      // progress (everyone level, or nobody's moved). Otherwise fall through to
      // the normal straggler-finish so a real leader still takes the win.
      if (!this._drawResolved && this._isDraw(list)) {
        this._drawResolved = true;
        this.phase = PHASE.ENDED;
        this.winReason = "draw";
        this.winner = null;
        this._rankByMode?.();
        this._events.push({ type: "match_over", reason: "draw", draw: true });
        return;
      }
      const stragglers = list.filter((p) => !p.finished).sort((a, b) => b.progress - a.progress);
      for (const p of stragglers) this._finish(p, true);
    }
    if (list.length && list.every((p) => p.finished)) {
      this.phase = PHASE.ENDED;
      this.winReason = this.now >= this.hardEndAt ? "timeout" : "finish";
    }
  }

  _integrateCoast(p, dt) {
    p.x += Math.cos(p.heading) * p.speed * dt;
    p.z += Math.sin(p.heading) * p.speed * dt;
  }

  // Checkpoint + lap accounting from sample-index motion.
  _trackProgress(p) {
    const t = this.track;
    const i = p.sampleHint;
    const cur = t.at(i).s;
    // within-lap meters, guarded against jumping backwards across the seam
    const lapLen = t.total;
    let within = cur;
    // ordered checkpoints: arm the next one when we pass its sample's arc pos
    const cps = t.checkpoints;
    if (p.nextCp < cps.length) {
      const cpS = t.at(cps[p.nextCp]).s;
      const prevS = t.at(p.lastSample).s;
      if (this._crossed(prevS, cur, cpS, lapLen)) p.nextCp++;
    } else {
      // all checkpoints hit — crossing the start line completes the lap
      const prevS = t.at(p.lastSample).s;
      if (this._crossed(prevS, cur, 0, lapLen)) {
        p.lap++;
        p.nextCp = 0;
        const lapSec = this.now - p._lapStartAt;
        p._lapStartAt = this.now;
        if (p.mBestLapSec == null || lapSec < p.mBestLapSec) p.mBestLapSec = Math.round(lapSec * 100) / 100;
        p.mLaps = (p.mLaps || 0) + 1;
        this._events.push({ type: "lap", playerId: p.id, lap: p.lap });
        // COMEBACK WATCH: when you enter the final lap, remember where you were.
        // If you win from outside the top half, that's a comeback.
        if (p.lap === this.laps - 1) {
          const order = [...this.players.values()]
            .filter((q) => !q.finished)
            .sort((a, b) => b.progress - a.progress);
          p._finalLapPos = order.findIndex((q) => q.id === p.id) + 1;
        }
        if (p.lap >= this.laps) this._finish(p, false);
      }
    }
    p.lastSample = i;
    p.progress = p.lap * lapLen + within;
  }

  // Did arc position move across `mark` going forward (handles the 0-seam)?
  _crossed(prevS, curS, mark, lapLen) {
    let d = curS - prevS;
    if (d < -lapLen / 2) d += lapLen;       // wrapped the seam forward
    if (d <= 0 || d > lapLen / 2) return false; // not forward motion (or a teleport)
    let m = mark - prevS;
    if (m < 0) m += lapLen;
    return m <= d;
  }

  // Standings in a mode are whatever the mode says they are: lives left, flags
  // captured, pearls held, seconds spent as IT (negated — lower is better).
  // Give an arena bot something to want, then drive at it and don't hit walls.
  _arenaBotInput(p) {
    const a = this.arena;
    let tx = 0, tz = 0;                      // the target

    // what does this bot want? ask the mode.
    if (this.rules?.botTarget) {
      const t = this.rules.botTarget(this, p);
      if (t) { tx = t.x; tz = t.z; }
    } else {
      // no opinion: mill about the middle
      tx = Math.cos(this.now * 0.3 + (p.bot?.seed ?? 0)) * a.radius * 0.4;
      tz = Math.sin(this.now * 0.3 + (p.bot?.seed ?? 0)) * a.radius * 0.4;
    }

    // ---- steer at it, but avoid the walls ----
    // A repulsion vector from anything close. Crude, and exactly enough: an
    // arena has a handful of boxes, and a kart only cares about the near ones.
    let ax = tx - p.x, az = tz - p.z;
    const len = Math.hypot(ax, az) || 1;
    ax /= len; az /= len;

    for (const w of a.walls) {
      const dx = p.x - w.x, dz = p.z - w.z;
      const near = Math.max(w.w, w.d) / 2 + 7;
      const d = Math.hypot(dx, dz);
      if (d > near || d < 0.01) continue;
      const push = (near - d) / near;
      ax += (dx / d) * push * 2.2;
      az += (dz / d) * push * 2.2;
    }
    // and away from the rim
    const r = Math.hypot(p.x, p.z);
    if (r > a.radius - 10) {
      ax += (-p.x / (r || 1)) * 1.8;
      az += (-p.z / (r || 1)) * 1.8;
    }

    const want = Math.atan2(az, ax);
    let err = want - p.heading;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;

    // back up if we're wedged nose-first into something
    const wedged = Math.abs(p.speed) < 1.5 && Math.abs(err) > 2.2;
    return {
      throttle: wedged ? -1 : (Math.abs(err) > 1.4 ? 0.45 : 1),
      steer: Math.max(-1, Math.min(1, err * 1.9)),
    };
  }

  // Remember where each player last SAW each other player, so a kart that ducks
  // behind a pillar leaves a ghost at the last honest position instead of
  // vanishing and reappearing somewhere else entirely.
  _updateLastSeen() {
    if (!this.rules?.view || !this.arena) return;
    for (const viewer of this.players.values()) {
      for (const p of this.players.values()) {
        if (p.id === viewer.id) continue;
        if (!losHidden(this, viewer, p)) {
          p._lastSeenX = p.x;
          p._lastSeenZ = p.z;
        }
      }
    }
  }

  _rankByMode() {
    if (!this.rules?.score) return;
    const all = [...this.players.values()];
    all.sort((a, b) => this.rules.score(this, b) - this.rules.score(this, a));
    all.forEach((p, i) => { p.place = i + 1; });
  }

  // Is the match a DRAW at the horn? True when nobody has genuinely won:
  //   • no one has crossed the finish line, AND
  //   • there's no single leader — in a scored mode the top two are tied (and the
  //     top score is meaningful, i.e. > the floor); in a plain race nobody has
  //     made real progress, or the leaders are dead level.
  // A clear leader is NOT a draw — they take the win via the normal path.
  _isDraw(list) {
    if (list.some((p) => p.finished)) return false;
    if (this.rules?.score) {
      const scores = list.map((p) => this.rules.score(this, p)).sort((a, b) => b - a);
      if (scores.length === 0) return true;
      // everyone on zero → nobody did anything → draw
      const top = scores[0], second = scores[1] ?? top;
      if (top === (scores[scores.length - 1])) return true;   // all equal
      return top === second;                                  // tie at the top
    }
    // plain lap race: draw only if the front runners are dead level (or nobody
    // has moved). A genuine leader on progress wins normally.
    const prog = list.map((p) => p.progress || 0).sort((a, b) => b - a);
    if (!prog.length) return true;
    if (prog[0] < 1) return true;                 // nobody meaningfully moved
    return (prog[0] === (prog[1] ?? prog[0]));     // tie for the lead
  }

  _finish(p, ranked) {
    // won from the back half of the field on the final lap?
    if (!p.finished && this.winner == null && p._finalLapPos > Math.ceil(this.players.size / 2)) {
      p.mComeback = true;
    }
    if (p.finished) return;
    p.finished = true;
    p.finishTime = this.now;
    p.mTotalSec = Math.round((this.now - this.startFreezeUntil) * 100) / 100;
    this.finishOrder.push(p.id);
    p.place = this.finishOrder.length;
    if (!this.winner) {
      this.winner = p.id;
      this.hardEndAt = Math.min(this.hardEndAt, this.now + this.finishTimeout);
    }
    this._events.push({ type: "finish", playerId: p.id, place: p.place, ranked });
  }

  _botItems(p) {
    if (!p.heldItem) { p._useAt = null; return; }
    if (p._useAt == null) p._useAt = this.now + 1.5 + this.rng() * 3;
    if (this.now >= p._useAt) { fireItem(this, p); p._useAt = null; }
  }

  // ---- bot driver: pure pursuit + curvature braking, SAME car constants ----
  // ---------------------------------------------------------------------------
  // BOT DIFFICULTY
  //
  // `botTier` was being STORED and then completely ignored — every bot, from
  // "rookie" to "ace", got the identical config (`look: 14-20, aggro: 0.9-1.02`).
  // So the hardest race in the game was driven by exactly the same bots as the
  // easiest one, and a decent human walked it. That's what Gustavo hit.
  //
  // Four real tiers now, differing in the things that actually make a driver:
  //
  //   look     how far ahead they read the track. A short look-ahead means they
  //            turn in late and run wide — the single most human-looking mistake.
  //   aggro    how close to the car's limit they're willing to drive.
  //   brake    how much they lift for a corner. Too much = slow; too little = wide.
  //   err      a slow wander added to their steering. This is what makes a rookie
  //            look like a rookie rather than a perfect driver going slowly.
  //   itemUse  how quickly they fire an item once they have one. An ace uses it
  //            almost immediately; a rookie sits on it.
  //   rubber   how much they're allowed to catch up when far behind (keeps a race
  //            alive without the top tier ever needing it).
  // ---------------------------------------------------------------------------
  _makeBot(tier) {
    const r = this.rng();
    const T = {
      rookie: { look: 22, aggro: 0.72, brake: 0.85, err: 0.16, itemUse: 2.6, rubber: 0.10 },
      pilot:  { look: 18, aggro: 0.86, brake: 0.70, err: 0.08, itemUse: 1.4, rubber: 0.06 },
      expert: { look: 15, aggro: 0.96, brake: 0.58, err: 0.03, itemUse: 0.7, rubber: 0.03 },
      ace:    { look: 13, aggro: 1.04, brake: 0.50, err: 0.00, itemUse: 0.3, rubber: 0.00 },
    }[tier] || { look: 18, aggro: 0.86, brake: 0.70, err: 0.08, itemUse: 1.4, rubber: 0.06 };

    return {
      tier: tier || "pilot",
      // a little spread INSIDE a tier, so four "aces" aren't clones of each other
      look: T.look + r * 3,
      aggro: T.aggro + (r - 0.5) * 0.05,
      brake: T.brake,
      err: T.err,
      errPhase: r * Math.PI * 2,
      itemUse: T.itemUse,
      rubber: T.rubber,
      nextItemAt: 0,
    };
  }

  _botInput(p) {
    // ---- ARENA BOTS ----
    // The racing bot follows the track spline. In an arena there IS no spline,
    // so it drove at a phantom racing line and piled into walls (80 rescues in
    // 60 seconds of Pearl Rush). An arena bot needs a TARGET and the sense to
    // steer around what's in the way — and what it wants depends on the mode.
    if (this.arena) return this._arenaBotInput(p);

    const t = this.track;
    const look = p.bot.look; // meters ahead
    // find sample ~look meters ahead of the bot's nearest sample
    let j = p.sampleHint, left = look;
    while (left > 0) { const a = t.at(j), b = t.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    let target = t.at(j);
    // box magnet: empty-handed bots aim at a nearby active item box instead of
    // the racing line — bots should collect and fight, not just parade.
    // Gated hard: only while ON the ribbon, and only for boxes roughly AHEAD —
    // chasing a box across sand traps pure-pursuit in an orbit (seeds 5/8/12…).
    if (!p.heldItem && !p.challenge && t.onTrack(p.x, p.z, p.sampleHint)) {
      const hx = Math.cos(p.heading), hz = Math.sin(p.heading);
      let best = null, bd = 26;
      for (const b of this.itemBoxes) {
        if (!b.active) continue;
        const dx = b.x - p.x, dz = b.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= bd || d <= 2) continue;
        if ((dx * hx + dz * hz) / d < 0.35) continue;   // behind / hard sideways
        bd = d; best = b;
      }
      if (best) target = best;
    }
    const desired = Math.atan2(target.z - p.z, target.x - p.x);
    let dh = desired - p.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // A slow, smooth wander. This is what separates a rookie from an ace far more
    // than raw speed does: the rookie's line is never quite right, so they scrub
    // speed in every corner and drift wide on the exits.
    const wobble = p.bot.err > 0
      ? Math.sin(this.now * 0.9 + p.bot.errPhase) * p.bot.err
      : 0;
    const steer = Math.max(-1, Math.min(1, dh * 2.2 + wobble));
    // curvature ahead → brake for corners: compare tangents now vs +18m
    let k = j, ahead = 18;
    while (ahead > 0) { const a = t.at(k), b = t.at(k + 1); ahead -= Math.hypot(b.x - a.x, b.z - a.z); k++; }
    const t0 = t.at(p.sampleHint), t1 = t.at(k);
    const turn = Math.abs(t0.tx * t1.tz - t0.tz * t1.tx); // |sin(angle between tangents)|
    // RUBBER-BANDING, but only for the LOWER tiers. An ace never gets a helping
    // hand — if you beat an ace, you beat it clean. A rookie left 200m behind is
    // no fun for anyone, so they get a nudge.
    let catchUp = 1;
    if (p.bot.rubber > 0 && this.leader) {
      const lead = this.players.get(this.leader);
      if (lead && lead.id !== p.id) {
        const behind = (lead.progress || 0) - (p.progress || 0);
        if (behind > 40) catchUp = 1 + Math.min(p.bot.rubber, behind / 900);
      }
    }

    const targetSpeed = CAR.MAX_SPEED * p.bot.aggro * catchUp * (1 - p.bot.brake * turn);
    const throttle = p.speed < targetSpeed ? 1 : (p.speed > targetSpeed + 2.5 ? -0.5 : 0.15);

    // ---- BOTS USE THEIR ITEMS ----
    // They never did. A bot would pick up a TSUNAMI and carry it round for three
    // laps. An ace fires almost the moment it has something; a rookie dithers.
    if (p.heldItem && this.now >= (p.bot.nextItemAt || 0)) {
      p.bot.nextItemAt = this.now + p.bot.itemUse + this.rng() * 0.4;
      try { this.useItem(p.id); } catch { /* nothing to fire */ }
    }

    return { throttle, steer };
  }

  // SPACE: if you're kited, it's a struggle tap; otherwise it fires your item.
  useItem(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== PHASE.ACTIVE || p.finished) return;
    if (kiteTap(this, p)) return;
    if (!p.heldItem) return;
    fireItem(this, p);
  }

  // ---- social passthroughs ----
  setEmote(playerId, emoteId) {
    const p = this.players.get(playerId);
    if (!p) throw new Error("No such player.");
    p.emote = emoteId || null;
    p.emoteUntil = this.now + EMOTE_SECONDS;
  }

  sendSpeech(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) throw new Error("No such player.");
    const clean = (text || "").slice(0, 120);
    if (!clean) return;
    this._events.push({ type: "speech", playerId, name: p.name, text: clean });
  }

  drainBountyClaims() { return []; }

  matchResult() {
    const participants = [];
    for (const p of this.players.values()) {
      if (!p.accountId) continue;
      participants.push({
        userId: p.accountId, name: p.name, role: "racer",
        won: p.place === 1,
        // NOTE: `tasksDone`, `sabotages`, `kills` and `survived` used to be here,
        // hard-coded to 0/true. They're from the social-deduction game this was
        // forked from — there are no tasks and no impostors in a kart racer, and
        // the backend was faithfully recording zeroes into every match row.
        place: p.place ?? null,
        bestLapSec: p.mBestLapSec,
        resets: p.mResets,
        challenges: p.mChallenges,
        sTiers: p.mSTiers,
        itemsUsed: p.mItemsUsed,
        crumbles: p.mCrumbles,
        splashesCaused: p.mSplashesCaused,
        crumblesCaused: p.mCrumblesCaused,
        totalSec: p.mTotalSec ?? null,

        // ---- per-mode stats ----
        // The achievements can only reward what the engine actually counts.
        laps: p.mLaps ?? 0,
        ultimatesFired: p.mUltimates ?? 0,
        krakenBest: p.mKrakenBest ?? 0,
        keyPads: p.mKeyPads ?? 0,
        perfectLanes: p.mPerfectLanes ?? 0,
        // COMEBACK: you were losing on the final lap and still won. Recorded by
        // the engine because only it knows the running order lap by lap.
        comeback: !!p.mComeback,
        derbyKills: p.mDerbyKills ?? 0,
        derbyWin: this.mode.id === "derby" && p.place === 1,
        flagCaptures: p.mFlagCaptures ?? 0,
        flagGrabs: p.mFlagGrabs ?? 0,
        flagReturns: p.mFlagReturns ?? 0,
        correctGuesses: p.mCorrectGuesses ?? 0,
        drawingsGuessed: p.mDrawingsGuessed ?? 0,
        tagsMade: p.mTagsMade ?? 0,
        itTime: Math.round(p.itTime ?? 0),
        pearls: p.mPearls ?? 0,
        modeScore: this.rules?.score ? this.rules.score(this, p) : null,
      });
    }
    return {
      winner: this.winner ? (this.players.get(this.winner)?.name || "racer") : null,
      map: { id: this.map.id, name: this.map.name },
      // ONE mode field. There used to be two — an object and then a string —
      // and the string silently overwrote the object, so every consumer that
      // expected `{ id, label }` got a bare id instead.
      mode: this.config.mode || "race",
      modeLabel: this.mode.label,
      participants,
      laps: this.laps,
    };
  }

  // ---- per-player view ----
  viewFor(playerId) {
    const me = this.players.get(playerId);
    if (!me) throw new Error("No such player.");
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: (p.streamerMode && p.id !== me.id) ? `${p.idColor} Racer` : p.name,
      connected: p.connected,
      isBot: !!p.isBot,
      userId: p.accountId,
      loadout: p.loadout,
      avatarId: p.avatarId, borderId: p.borderId,
      idColor: p.idColor,
      role: "racer",
      x: Math.round(p.x * 100) / 100,
      y: Math.round((p.y || 0) * 100) / 100,
      airborne: !!p.airborne,
      // EROSION, for everyone — you have to be able to SEE a rival falling apart.
      // The car is made of sand: as it erodes, chunks of the shell are cut away
      // and the sand inside shows through.
      erosion: Math.round((p.erosion || 0) * 100) / 100,
      // STUNNED. Everyone needs to SEE that a rival is dazed — that's the whole
      // point of the birds-round-the-head gag: it tells the entire grid, instantly
      // and without a word, that the kart in front of you is helpless.
      stunned: !!(p.crumbledUntil && p.crumbledUntil > this.now) || !!p.spinUntil,
      z: Math.round(p.z * 100) / 100,
      heading: Math.round(p.heading * 1000) / 1000,
      speed: Math.round(p.speed * 100) / 100,
      offTrack: p.offTrack,
      onCurb: !!p.onCurb,
      lanePos: Math.round((p.lanePos ?? 0) * 100) / 100,
      laneSide: p.laneSide ?? 0,
      lap: p.lap,
      finished: p.finished,
      place: p.place,
      progress: Math.round(p.progress * 10) / 10,
      emote: p.emote,
      resetting: this.now < p.resetUntil,
      ...statusFlags(p, this.now),
      // the mode's own number, so the standings panel can show "3 flags" or
      // "12 pearls" instead of pretending everything is a lap count
      modeScore: this.rules?.score ? this.rules.score(this, p) : null,
      // LINE OF SIGHT, enforced at the SOURCE. Hiding the mesh on the client is
      // a lie a cheater can simply turn off — if you can't see them, the socket
      // must not carry where they are. We send a stale last-known position so
      // the kart doesn't teleport when they step back into view.
      ...(losHidden(this, me, p) ? { x: p._lastSeenX ?? p.x, z: p._lastSeenZ ?? p.z, hidden: true } : {}),
      team: p.team ?? null,
      eliminated: !!p.eliminated,
      spectating: !!p.spectating,
    }));
    const standings = [...players].sort((a, b) =>
      (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress);
    standings.forEach((p, idx) => { p.racePos = idx + 1; });
    return {
      phase: this.phase,
      mode: this.mode,
      // MAP SECRECY: a room set to Random must not leak which circuit it rolled —
      // in the lobby the client sees "???" and only learns the truth when the
      // race starts. Sending the real trackId early would let anyone read it
      // straight out of the socket.
      map: (this.phase === PHASE.LOBBY && (!this.config.trackId || this.config.trackId === "random"))
        ? { ...this.map, trackId: "random", trackName: "??? — Random Circuit", laps: this.laps }
        : { ...this.map, trackId: this.track.def.id, trackName: this.track.def.name, laps: this.laps },
      config: { isPublic: !!this.config.isPublic },
      startFreezeLeft: Math.max(0, this.startFreezeUntil - this.now),
      startFreezeTotal: START_FREEZE_SEC,
      // ---- the mode's own view ----
      // `mode` is what EVERYONE sees (flags on the map, the pearl field, the
      // strokes on the canvas). `you.mode` is what only YOU see (your team, your
      // word if you're the artist, who you can actually see through the walls).
      modeWorld: this.rules?.worldView ? this.rules.worldView(this) : null,
      arena: this.arena ? {
        id: this.arena.id, name: this.arena.name, theme: this.arena.theme,
        radius: this.arena.radius,
        walls: this.arena.walls,
        hazards: this.arena.hazards || [],
        canvas: this.arena.canvas || null,
        halls: this.arena.halls || null,
        bases: this.arena.bases || null,
      } : null,
      serverNow: Math.round(this.now * 1000) / 1000,
      // match countdown (seconds left before the horn) — shown for every mode so
      // players never wait indefinitely. Null before the flag drops.
      timeLeft: (this.phase === PHASE.ACTIVE && isFinite(this.hardEndAt))
        ? Math.max(0, Math.round((this.hardEndAt - this.now) * 10) / 10)
        : null,
      // does this mode count laps? Only plain Grand Prix + Time Attack do — the
      // arena modes have no laps, so the HUD hides the LAP readout for them.
      lapBased: !this.arena && this.rules?.id !== "timeattack" ? true
              : this.rules?.id === "timeattack" ? true
              : false,
      winner: this.winner,
      winReason: this.winReason,
      previousPerks: this.previousPerks,
      previousWinner: this.previousWinner,
      you: {
        perks: [...(me.perks || [])],
        // per-player mode data: your team, your word, who you can see
        mode: this.rules?.view ? this.rules.view(this, me) : null,
        id: me.id, role: "racer", place: me.place, finished: me.finished, lap: me.lap,
        challenge: challengeView(me, this.now),
        heldItem: me.heldItem,
        bestLapSec: me.mBestLapSec ?? null,
        totalSec: me.mTotalSec ?? null,
        // force-stopped off-track and waiting on the player to dig out (Press R)
        needsReset: !!me.needsReset,
      },
      // NOTE: `mode` is already set above, from `this.mode` — the engine's real,
      // live mode object. There used to be a SECOND `mode` key right here reading
      // `this.config.mode`, in the same object literal. JavaScript lets the later
      // key win silently, so the view shipped a bare string from config — and
      // config.mode is a field `setMode()` never touches. Switch to Demolition
      // Derby and the lobby kept insisting you were in a Grand Prix, because the
      // engine had changed and the view was reporting a completely different
      // variable. Four of the seven modes could not be selected.
      itemBoxes: this.itemBoxes.map((b) => ({ id: b.id, kind: b.kind, x: b.x, z: b.z, active: b.active })),
      ...itemsView(this, me),
      players,
      standings,
    };
  }

  // Per-player event delivery. The old drain-on-first-call model silently
  // starved every client after the first in multi-human rooms, and leaked
  // personal events (YOUR challenge, YOUR kite) to strangers. Now: an
  // append-only log + per-player cursors; personal event types only reach
  // their owner, everything else reaches everyone.
  eventsFor(playerId) {
    if (!this._eventSeq) { this._eventSeq = 0; this._eventCursors = new Map(); }
    // absorb newly pushed events into the log with sequence numbers
    if (this._events.length) {
      this._eventLog = this._eventLog || [];
      for (const ev of this._events) this._eventLog.push({ seq: ++this._eventSeq, ev });
      this._events = [];
      if (this._eventLog.length > 600) this._eventLog.splice(0, this._eventLog.length - 600);
    }
    const log = this._eventLog || [];
    const from = this._eventCursors.get(playerId) ?? 0;
    const out = [];
    for (const { seq, ev } of log) {
      if (seq <= from) continue;
      if (PERSONAL_EVENTS.has(ev.type) && ev.playerId !== playerId) continue;
      out.push(ev);
    }
    this._eventCursors.set(playerId, this._eventSeq);
    return out;
  }
}

// Events that describe YOUR private moment — never shown to other racers.
const PERSONAL_EVENTS = new Set([
  "challenge_start", "challenge_end", "kited", "kite_break",
  "kite_fizzle", "shield_block", "eroded",
]);
