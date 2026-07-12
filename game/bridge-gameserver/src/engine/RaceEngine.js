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
import { stepCar, separateCars, CAR } from "./shared/carSim.js";
import { makeItemBoxes, tickChallenges, challengeView } from "./challenges.js";
import { rollItem, useItem as fireItem, kiteTap, tickItems, computeMods, itemsView, statusFlags, ITEMS } from "./items.js";
import { makeRng } from "./rng.js";

let _idSeq = 0;
function newId(prefix) { return `${prefix}${++_idSeq}_${Math.random().toString(36).slice(2, 6)}`; }

const START_FREEZE_SEC = 3;
const EMOTE_SECONDS = 3;
const RESET_STOP_SEC = 0.9;      // shovel scoop: brief held-still beat after reset
const TIMEOUT_AFTER_WINNER = 45; // once someone finishes, stragglers get this long

export class RaceEngine {
  constructor({ config = {} } = {}) {
    this.config = { isPublic: false, ...config };
    this.track = makeTrack(this.config.trackId || "sandcastle");
    const d = this.track.def;
    this.map = { id: d.id, name: d.name, minPlayers: d.minPlayers, maxPlayers: d.maxPlayers };
    this.laps = Number(this.config.laps) > 0 ? Number(this.config.laps) : d.laps;
    this.finishTimeout = Number(this.config.finishTimeoutSec) > 0 ? Number(this.config.finishTimeoutSec) : TIMEOUT_AFTER_WINNER;
    this.mode = { id: "race", label: "Race" };
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
    this.itemBoxes = this.config.items === false ? [] : makeItemBoxes(this.track);
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
      x: 0, z: 0, heading: 0, speed: 0, offTrack: false, sampleHint: -1,
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
      bot: account?.isBot ? { look: 14 + this.rng() * 6, aggro: 0.9 + this.rng() * 0.12 } : null,
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
  start({ force = false } = {}) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Race already started.");
    if (!force && this.players.size < this.map.minPlayers)
      throw new Error(`Need at least ${this.map.minPlayers} racer(s).`);
    this.phase = PHASE.ACTIVE;
    this.startFreezeUntil = this.now + START_FREEZE_SEC;
    let slot = 0;
    for (const p of this.players.values()) {
      const pose = this.track.gridPose(slot++);
      p.x = pose.x; p.z = pose.z; p.heading = pose.heading;
      p.speed = 0; p.lap = 0; p.nextCp = 0; p.progress = 0;
      p.sampleHint = this.track.nearest(p.x, p.z, -1);
      p.lastSample = p.sampleHint;
      p._lapStartAt = this.startFreezeUntil;
    }
  }

  // Player driving input (from race_input socket event). Ignored while frozen.
  setInput(playerId, { throttle = 0, steer = 0 } = {}) {
    const p = this.players.get(playerId);
    if (!p) throw new Error("No such player.");
    p.input.throttle = Math.max(-1, Math.min(1, Number(throttle) || 0));
    p.input.steer = Math.max(-1, Math.min(1, Number(steer) || 0));
  }

  // The shovel scoop: back to the centerline where you are, dead stop, small beat.
  requestReset(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== PHASE.ACTIVE || p.finished) return;
    const pose = this.track.centerPose(p.sampleHint);
    p.x = pose.x; p.z = pose.z; p.heading = pose.heading;
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
      if (frozen || this.now < p.resetUntil) { p.speed = 0; continue; }
      if (p.isBot) {
        this._botItems(p);
        // stuck detector: any bot that hasn't gained ground in 6s scoops itself
        // back to the ribbon — no cause (items, pile-ups, bugs) wedges a race.
        if (this.now - (p._stuckAt ?? 0) > 6) {
          if (p.progress - (p._stuckProg ?? -99) < 8 && this.now > p.resetUntil) this.requestReset(p.id);
          p._stuckAt = this.now; p._stuckProg = p.progress;
        }
      }
      const input = p.isBot ? this._botInput(p) : p.input;
      p.mods = computeMods(p, this.now);
      stepCar(p, input, dt, this.track, p.mods);
      this._trackProgress(p);
    }
    // item boxes + personal challenges (disabled entirely in time-trial mode)
    if (!frozen && this.config.items !== false) {
      for (const ev of tickChallenges(this, dt)) this._events.push(ev);
      // projectiles, zones, kites, erosion — the whole water-vs-sand layer
      tickItems(this, dt);
    }

    // car-vs-car bumping (identical masses — the design rule again)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (!list[i].finished && !list[j].finished) separateCars(list[i], list[j]);

    // finish / timeout resolution
    if (this.now >= this.hardEndAt) {
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
        this._events.push({ type: "lap", playerId: p.id, lap: p.lap });
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

  _finish(p, ranked) {
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
  _botInput(p) {
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
    const steer = Math.max(-1, Math.min(1, dh * 2.2));
    // curvature ahead → brake for corners: compare tangents now vs +18m
    let k = j, ahead = 18;
    while (ahead > 0) { const a = t.at(k), b = t.at(k + 1); ahead -= Math.hypot(b.x - a.x, b.z - a.z); k++; }
    const t0 = t.at(p.sampleHint), t1 = t.at(k);
    const turn = Math.abs(t0.tx * t1.tz - t0.tz * t1.tx); // |sin(angle between tangents)|
    const targetSpeed = CAR.MAX_SPEED * p.bot.aggro * (1 - 0.62 * turn);
    const throttle = p.speed < targetSpeed ? 1 : (p.speed > targetSpeed + 2.5 ? -0.5 : 0.15);
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
        tasksDone: 0, sabotages: 0, kills: 0,
        survived: true,
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
      });
    }
    return {
      winner: this.winner ? (this.players.get(this.winner)?.name || "racer") : null,
      map: { id: this.map.id, name: this.map.name },
      mode: { id: this.mode.id, label: this.mode.label },
      participants,
      mode: this.config.mode || "race",
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
      idColor: p.idColor,
      role: "racer",
      x: Math.round(p.x * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      heading: Math.round(p.heading * 1000) / 1000,
      speed: Math.round(p.speed * 100) / 100,
      offTrack: p.offTrack,
      lap: p.lap,
      finished: p.finished,
      place: p.place,
      progress: Math.round(p.progress * 10) / 10,
      emote: p.emote,
      resetting: this.now < p.resetUntil,
      ...statusFlags(p, this.now),
    }));
    const standings = [...players].sort((a, b) =>
      (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress);
    standings.forEach((p, idx) => { p.racePos = idx + 1; });
    return {
      phase: this.phase,
      mode: this.mode,
      map: { ...this.map, trackId: this.track.def.id, laps: this.laps },
      config: { isPublic: !!this.config.isPublic },
      startFreezeLeft: Math.max(0, this.startFreezeUntil - this.now),
      serverNow: Math.round(this.now * 1000) / 1000,
      winner: this.winner,
      winReason: this.winReason,
      previousPerks: this.previousPerks,
      previousWinner: this.previousWinner,
      you: {
        id: me.id, role: "racer", place: me.place, finished: me.finished, lap: me.lap,
        challenge: challengeView(me),
        heldItem: me.heldItem,
        bestLapSec: me.mBestLapSec ?? null,
        totalSec: me.mTotalSec ?? null,
      },
      mode: this.config.mode || "race",
      itemBoxes: this.itemBoxes.map((b) => ({ id: b.id, x: b.x, z: b.z, active: b.active })),
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
