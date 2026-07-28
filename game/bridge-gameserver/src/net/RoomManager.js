// Room manager: one RaceEngine per room, plus the socket<->player mapping and
// matchmaking. Pure bookkeeping + lobby logic — all game truth lives in the engine.

import { RaceEngine } from "../engine/RaceEngine.js";
import { PHASE } from "../engine/constants.js";

// Code alphabet excludes easily-confused chars (0/O, 1/I/L) for spoken codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 5;

// Streamer-mode decoy code: a FIXED, format-valid (alphabet+length) code shown in
// the lobby instead of a streamer's real code, identical for every streamer-mode
// user. It never maps to a real room — anyone who joins with it lands on a joke
// screen — so generation excludes it and lookups never resolve it to a room.
export const DECOY_CODE = "QX7K2";

export class Room {
  constructor(id, config) {
    this.id = id;
    this.config = config;                       // kept so a rematch reuses host config
    this.engine = new RaceEngine({ config });   // host config drives the match
    this.isPublic = !!config.isPublic;
    this.sockets = new Map(); // socketId -> playerId
    this.players = new Map(); // playerId -> socketId
    this.joinInfo = new Map(); // socketId -> { name, account } (for rematch rebuild)
    this.botState = new Map();  // botPlayerId -> per-bot scratch (cadence, draft vote)
    this.bots = [];             // [{ name, tier }] so rematch can re-add them
    this.hostSocketId = null;
    this.ticker = null;
    this.matchSeq = 0;          // increments per rematch so each round has a unique id
    // B7 — READY-UP. Real players must mark themselves ready before the host can
    // start; the host is implicitly always ready. Keyed by playerId. Bots are
    // never in here (they're always considered ready).
    this.ready = new Set();
  }

  // Stable-unique id for the CURRENT round: room code + match sequence. Used as
  // the backend ingestion idempotency key — unique per finished round (so
  // rematches each count once) while still carrying the room context.
  roundId() {
    return `${this.id}:${this.matchSeq}`;
  }

  attach(socketId, playerId, info) {
    this.sockets.set(socketId, playerId);
    this.players.set(playerId, socketId);
    if (info) this.joinInfo.set(socketId, info);
    if (!this.hostSocketId) this.hostSocketId = socketId;
  }
  detach(socketId) {
    const playerId = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    this.joinInfo.delete(socketId);
    if (playerId) this.players.delete(playerId);
    // If the host left, hand the role to whoever's next (keeps the lobby alive).
    if (socketId === this.hostSocketId) this.hostSocketId = this.sockets.keys().next().value || null;
    return playerId;
  }

  // Rematch: spin up a fresh engine and re-seat everyone currently attached,
  // preserving their account/name. Returns to the lobby phase so the host can
  // start a new draft. Keeps the same room code, host, and config.
  rematch() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    // Carry the finished round's winning perks (and winner) into the fresh lobby so
    // players can see what the squad ran last time before drafting again.
    const prevPerks = this.engine?.activePerks ? [...this.engine.activePerks] : [];
    const prevWinner = this.engine?.winner || null;
    this.matchSeq++;
    this.ready = new Set();   // B7: everyone must ready-up again next lobby
    this.engine = new RaceEngine({ config: this.config });
    this.engine.previousPerks = prevPerks;
    this.engine.previousWinner = prevWinner;
    const remap = new Map(); // old socketId -> new playerId
    for (const [socketId, info] of this.joinInfo) {
      const pid = this.engine.addPlayer(info.name, info.account);
      remap.set(socketId, pid);
    }
    this.sockets = new Map(); this.players = new Map();
    for (const [socketId, pid] of remap) { this.sockets.set(socketId, pid); this.players.set(pid, socketId); }
    // re-seat the bots too (fresh scratch state)
    this.botState = new Map();
    for (const b of this.bots) {
      this.engine.addPlayer(b.name, { isBot: true, botTier: b.tier });
    }
    // host stays whoever it was if still present, else first seat
    if (!this.sockets.has(this.hostSocketId)) this.hostSocketId = this.sockets.keys().next().value || null;
  }

  // Add a bot of the given tier (host action, lobby only). Tracked so rematch
  // can re-seat it. Returns the new bot's playerId.
  addBot(tier = "pilot") {
    const n = this.bots.length + 1;
    const name = `${tierName(tier)} Bot ${n}`;
    const id = this.engine.addPlayer(name, { isBot: true, botTier: tier });
    this.bots.push({ name, tier });
    return id;
  }
  removeBot(playerId) {
    const p = this.engine.players.get(playerId);
    if (!p || !p.isBot) return false;
    this.engine.players.delete(playerId);
    this.bots = this.bots.filter((b) => b.name !== p.name);
    this.botState.delete(playerId);
    return true;
  }

  // Auto-fill the grid up to `target` racers with bots. Empty/half-empty lobbies
  // are the #1 retention killer in real-time multiplayer — a solo player should
  // always drop into a full, lively race rather than an empty track. Tiers are
  // spread (a mix of Puddle/Splasher/Riptide) so the field feels varied, and the
  // added bots are tracked like manual ones so rematch re-seats them. Returns the
  // number of bots added.
  fillBots(target = this.engine.map.maxPlayers) {
    const cap = Math.min(target, this.engine.map.maxPlayers);
    // Rotate tiers so a filled grid isn't all one difficulty.
    const spread = ["pilot", "recruit", "ace", "pilot"];
    let added = 0;
    while (this.engine.players.size < cap) {
      const tier = spread[(this.bots.length) % spread.length];
      this.addBot(tier);
      added++;
    }
    return added;
  }
  playerIdOf(socketId) { return this.sockets.get(socketId); }
  isEmpty() { return this.sockets.size === 0; }

  // After the engine trims its roster (a cap-lowering mode/track change), bring
  // the room's bookkeeping back in line with the engine's surviving players:
  //   • drop bot records whose engine player no longer exists
  //   • detach any seated socket whose player was trimmed (rare: only if a human
  //     was over the cap), so we don't broadcast to a seat that isn't in the race
  reconcileRoster() {
    const live = this.engine.players;
    // bots the engine still has, by name (bot ids aren't tracked in this.bots)
    const liveBotNames = new Set([...live.values()].filter((p) => p.isBot).map((p) => p.name));
    this.bots = this.bots.filter((b) => liveBotNames.has(b.name));
    for (const pid of [...this.botState.keys()]) if (!live.has(pid)) this.botState.delete(pid);
    for (const [socketId, playerId] of [...this.sockets]) {
      if (!live.has(playerId)) {
        this.sockets.delete(socketId);
        this.players.delete(playerId);
        this.rejoinTokens?.delete(playerId);
      }
    }
    if (this.hostSocketId && !this.sockets.has(this.hostSocketId)) {
      this.hostSocketId = this.sockets.keys().next().value || null;
    }
  }

  // Joinable by Join Random: public, still in the lobby, and below the map cap.
  isOpenForRandom() {
    return this.isPublic
      && this.engine.phase === PHASE.LOBBY
      && this.engine.players.size < this.engine.map.maxPlayers;
  }
  // Has the minimum players the map needs to start?
  canStart() {
    return this.engine.players.size >= this.engine.map.minPlayers;
  }

  // ----- B7: ready-up -----
  // The host's own player counts as ready implicitly. Bots are always ready.
  hostPlayerId() { return this.sockets.get(this.hostSocketId) || null; }
  setReady(playerId, val) {
    if (!this.engine.players.has(playerId)) return;
    if (val) this.ready.add(playerId); else this.ready.delete(playerId);
  }
  isReady(playerId) {
    return playerId === this.hostPlayerId() || this.ready.has(playerId);
  }
  // Every seated HUMAN (non-bot) must be ready. The host is implicitly ready.
  allHumansReady() {
    for (const [, playerId] of this.sockets) {
      const p = this.engine.players.get(playerId);
      if (!p || p.isBot) continue;
      if (!this.isReady(playerId)) return false;
    }
    return true;
  }
  // Public snapshot for the lobby view: which seated players are ready.
  readySnapshot() {
    const out = {};
    for (const [, playerId] of this.sockets) {
      const p = this.engine.players.get(playerId);
      if (!p) continue;
      out[playerId] = p.isBot ? true : this.isReady(playerId);
    }
    return out;
  }

  // Count of REAL (human) players seated — bots excluded. For the games browser.
  humanCount() {
    let n = 0;
    for (const [, playerId] of this.sockets) {
      const p = this.engine.players.get(playerId);
      if (p && !p.isBot) n++;
    }
    return n;
  }
}

export class RoomManager {
  constructor() { this.rooms = new Map(); }

  _newCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LEN }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code) || code === DECOY_CODE);
    return code;
  }

  // Create a room from a host config object (merged over defaults in the engine).
  create(config = {}) {
    const id = this._newCode();
    const room = new Room(id, config);
    room.createdAt = Date.now();
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    const code = id ? String(id).toUpperCase() : "";
    // The decoy code never resolves to a real room (streamer-mode protection).
    if (code === DECOY_CODE) return null;
    return this.rooms.get(code) || null;
  }

  // Join Random: prefer an open public lobby; if none exist, spin up a fresh
  // public one with default config so the player isn't dropped into someone's
  // extreme custom settings.
  findOrCreateRandom(preferredMapId) {
    for (const room of this.rooms.values()) {
      if (room.isOpenForRandom() && (!preferredMapId || room.engine.map.id === preferredMapId)) return room;
    }
    return this.create({ isPublic: true, mapId: preferredMapId || "procedural" });
  }

  // B8 — the open-games browser. Every public room still in the lobby with a
  // free seat, newest first, exposing only what the browser shows: the code, the
  // map/mode, and the REAL (human) player count — bots are never counted here, so
  // a bot-filled lobby doesn't masquerade as busy.
  listOpenGames({ limit = 40 } = {}) {
    const out = [];
    for (const room of this.rooms.values()) {
      if (!room.isOpenForRandom()) continue;
      out.push({
        code: room.id,
        mapId: room.engine.map.id,
        mapName: room.engine.map.name,
        mode: room.engine.mode?.id || "race",
        modeLabel: room.engine.mode?.label || "Race",
        players: room.humanCount(),          // humans only
        maxPlayers: room.engine.map.maxPlayers,
        createdAt: room.createdAt || 0,
      });
    }
    // newest first
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out.slice(0, limit);
  }

  // B9 — Quick Join: pick the open game CLOSEST to 4 real players (so lobbies
  // fill toward a playable size fastest), tie-broken by fewest empty seats, then
  // newest. Falls back to creating a fresh public room if none are open.
  quickJoin(preferredMapId) {
    let best = null, bestScore = Infinity;
    for (const room of this.rooms.values()) {
      if (!room.isOpenForRandom()) continue;
      if (preferredMapId && room.engine.map.id !== preferredMapId) continue;
      const humans = room.humanCount();
      // distance from the target of 4; rooms already at/above 4 are still fine
      // (score 0) but rooms closer to 4 from below win first
      const distTo4 = Math.abs(4 - humans);
      const emptySeats = room.engine.map.maxPlayers - room.engine.players.size;
      const score = distTo4 * 10 + emptySeats;   // primary: near 4; secondary: fuller
      if (score < bestScore) { bestScore = score; best = room; }
    }
    return best || this.create({ isPublic: true, mapId: preferredMapId || "procedural" });
  }

  // B10 — Quick Race map rotation. Rotates through the raceable circuit pool so
  // successive Quick Races aren't all the same track. Persisted on the manager.
  nextQuickRaceTrack() {
    const pool = ["sandcastle", "pharaoh", "shingle", "pier", "volcano"];
    this._qrIdx = ((this._qrIdx ?? -1) + 1) % pool.length;
    return pool[this._qrIdx];
  }

  destroy(id) {
    const r = this.rooms.get(id);
    if (r?.ticker) clearInterval(r.ticker);
    this.rooms.delete(id);
  }
}

// Display name for a bot tier (used in the auto-generated bot name).
function tierName(tier) {
  return { recruit: "Puddle", pilot: "Splasher", ace: "Riptide" }[tier] || "Splasher";
}
