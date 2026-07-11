// ============================================================
// SANDBOX GP — RaceEngine (Batch 1 STUB)
//
// This is the authoritative race engine placeholder. It satisfies the exact
// contract the network layer (net/server.js + net/RoomManager.js) consumes,
// so the entire shell — lobby, friends, invites, rejoin, bots, results,
// XP/economy reporting — runs end-to-end TODAY with a placeholder race.
//
// The placeholder "race": on start(), a 3-2-1 freeze plays, then every
// player's progress advances 0→100 at a slightly randomized pace. First to
// 100 wins. Real car physics, tracks, items, and the hoop/challenge system
// replace the tick() internals in Batch 2+ WITHOUT touching the contract.
//
// Contract consumed by the net layer (do not break):
//   .players (Map)  .phase  .config  .mode  .map  .winner
//   .activePerks  .previousPerks  .previousWinner
//   addPlayer(name, account)  removePlayer(id)  start({force})
//   tick(dt)  viewFor(id)  eventsFor(id)  matchResult()
//   drainBountyClaims()  isEventHost(id)  setEmote(id, emoteId)
//   sendSpeech(id, text)
// ============================================================

import { PHASE } from "./constants.js";

// Sequential-but-opaque player ids (p1, p2, ...) with a per-process nonce so
// ids from different engine instances can't collide in logs.
let _idSeq = 0;
function newId(prefix) { return `${prefix}${++_idSeq}_${Math.random().toString(36).slice(2, 6)}`; }

// Placeholder track definition. Real tracks arrive with the Three.js engine;
// the shape here (id/name/min/max) is what the lobby + results UI reads.
const TRACKS = {
  sandbox_oval: { id: "sandbox_oval", name: "Sandbox Oval", minPlayers: 1, maxPlayers: 4 },
};

const START_FREEZE_SEC = 3;     // 3-2-1 "GO!" — client already renders this
const STUB_RACE_SECONDS = 45;   // placeholder race auto-resolves in ~45s (host
                                // config.raceSeconds overrides; tests use this)
const EMOTE_SECONDS = 3;

export class RaceEngine {
  constructor({ config = {} } = {}) {
    this.config = { isPublic: false, ...config };
    this.map = TRACKS[this.config.trackId] || TRACKS.sandbox_oval;
    this.mode = { id: "race", label: "Race" };
    this.phase = PHASE.LOBBY;
    this.players = new Map();
    this.now = 0;                 // engine-local clock (seconds)
    this.winner = null;           // playerId of 1st place once someone finishes
    this.winReason = null;
    this.startFreezeUntil = 0;
    this.raceEndsAt = 0;
    this.finishOrder = [];        // playerIds in finish order
    this.activePerks = [];        // carried concepts from BRIDGE; unused in stub
    this.previousPerks = [];
    this.previousWinner = null;
    this._events = [];            // per-tick transient events (client toasts)
    this._colorSeq = 0;
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
      loadout: account?.loadout || {},       // equipped cosmetics (visual only)
      eventFlags: account?.eventFlags || [],
      streamerMode: !!account?.streamerMode,
      idColor: this._assignIdColor(),
      connected: true,
      // race state (stub)
      progress: 0,          // 0..100 along the track
      pace: 0,              // set at start(); per-player placeholder speed
      finished: false,
      finishTime: null,
      place: null,
      emote: null,
      emoteUntil: 0,
      speech: null,
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

  // ---- race lifecycle ----
  start({ force = false } = {}) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Race already started.");
    if (!force && this.players.size < this.map.minPlayers)
      throw new Error(`Need at least ${this.map.minPlayers} racer(s).`);
    this.phase = PHASE.ACTIVE;
    const raceSecs = Number(this.config.raceSeconds) > 0 ? Number(this.config.raceSeconds) : STUB_RACE_SECONDS;
    this.startFreezeUntil = this.now + START_FREEZE_SEC;
    this.raceEndsAt = this.startFreezeUntil + raceSecs + 15; // hard cap safety
    // Placeholder pacing: everyone identical base speed (the design rule!)
    // with a small per-player wobble so the stub produces varied standings.
    for (const p of this.players.values()) {
      p.pace = (100 / raceSecs) * (0.92 + Math.random() * 0.16);
    }
  }

  tick(dt) {
    this.now += dt;
    if (this.phase !== PHASE.ACTIVE) return;
    if (this.now < this.startFreezeUntil) return; // 3-2-1 freeze

    for (const p of this.players.values()) {
      if (p.finished) continue;
      p.progress = Math.min(100, p.progress + p.pace * dt);
      if (p.progress >= 100) {
        p.finished = true;
        p.finishTime = this.now;
        this.finishOrder.push(p.id);
        p.place = this.finishOrder.length;
        if (!this.winner) { this.winner = p.id; }
        this._events.push({ kind: "finish", playerId: p.id, place: p.place });
      }
      if (p.emote && this.now > p.emoteUntil) { p.emote = null; }
    }

    const everyoneDone = [...this.players.values()].every((p) => p.finished);
    const timedOut = this.now >= this.raceEndsAt;
    if (everyoneDone || timedOut) {
      // Anyone unfinished at timeout gets ranked by current progress.
      const stragglers = [...this.players.values()]
        .filter((p) => !p.finished)
        .sort((a, b) => b.progress - a.progress);
      for (const p of stragglers) {
        p.finished = true;
        this.finishOrder.push(p.id);
        p.place = this.finishOrder.length;
      }
      this.phase = PHASE.ENDED;
      this.winReason = timedOut && !everyoneDone ? "timeout" : "finish";
    }
  }

  // ---- social passthroughs the net layer keeps ----
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
    this._events.push({ kind: "speech", playerId, name: p.name, text: clean });
  }

  // ---- reporting ----
  drainBountyClaims() { return []; } // no bounty events in the stub

  matchResult() {
    const participants = [];
    for (const p of this.players.values()) {
      if (!p.accountId) continue; // guests earn no XP
      participants.push({
        userId: p.accountId, name: p.name, role: "racer",
        won: p.place === 1,
        // Stat keys the backend already ingests. Race-specific stats
        // (bestLap, itemsUsed, challengesAced) arrive with the real engine.
        tasksDone: 0, sabotages: 0, kills: 0,
        survived: true,
        place: p.place ?? null,
      });
    }
    return {
      winner: this.winner ? (this.players.get(this.winner)?.name || "racer") : null,
      map: { id: this.map.id, name: this.map.name },
      mode: { id: this.mode.id, label: this.mode.label },
      participants,
    };
  }

  // ---- per-player redacted view ----
  // Racing hides far less than deduction did, but the shape stays per-player:
  // the real engine will redact opponents' hidden challenges here.
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
      progress: Math.round(p.progress * 10) / 10,
      finished: p.finished,
      place: p.place,
      emote: p.emote,
    }));
    const standings = [...players].sort((a, b) =>
      (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress);
    return {
      phase: this.phase,
      mode: this.mode,
      map: { id: this.map.id, name: this.map.name, minPlayers: this.map.minPlayers, maxPlayers: this.map.maxPlayers },
      config: { isPublic: !!this.config.isPublic },
      startFreezeLeft: Math.max(0, this.startFreezeUntil - this.now),
      timeLeft: this.phase === PHASE.ACTIVE ? Math.max(0, this.raceEndsAt - this.now) : 0,
      winner: this.winner,
      winReason: this.winReason,
      previousPerks: this.previousPerks,
      previousWinner: this.previousWinner,
      you: { id: me.id, role: "racer", place: me.place, finished: me.finished },
      players,
      standings,
    };
  }

  eventsFor(_playerId) {
    // Transient events are shared (nothing secret in the stub); drained per broadcast.
    const out = this._events;
    this._events = [];
    return out;
  }
}
