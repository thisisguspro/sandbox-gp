// ============================================================
// Network layer (Socket.IO). It does ONE job: receive player inputs,
// call the matching authoritative engine method, then push each player
// their OWN redacted view. It never computes game outcomes itself.
//
// Every action is wrapped so an engine validation error becomes a clean
// error back to just that socket — the server never trusts the client.
// ============================================================

import http from "http";
import crypto from "crypto";
import { Server } from "socket.io";
import { RoomManager, DECOY_CODE } from "./RoomManager.js";
import { PHASE } from "../engine/constants.js";
import { config } from "./config.js";
import { verifySession, fetchMatchProfile, reportMatchResult, checkFriendship } from "./backendClient.js";
import { social } from "./social.js";

const PORT = process.env.PORT || 5000;

// How long a mid-match seat is held for a dropped socket to reconnect and
// reclaim it (rejoin_room) before the player is actually removed.
const REJOIN_GRACE_MS = 90_000;

// Per-seat secret handed back on every join. Guest seats can ONLY be reclaimed
// with this token (playerIds are sequential and visible to the whole room, so
// they must never gate a rejoin by themselves). Account seats are additionally
// reclaimable via their session's userId.
function mintRejoinToken(room, playerId) {
  const tok = crypto.randomBytes(16).toString("hex");
  room.rejoinTokens = room.rejoinTokens || new Map();
  room.rejoinTokens.set(playerId, tok);
  return tok;
}

// When run directly, the game server owns its own HTTP server (with a /health
// route). When embedded in the combined deploy server, attachGameServer(server)
// is called with the shared HTTP server instead, so Socket.IO rides the same port.
let server;
let io;

function setupIo(httpServer) {
  io = new Server(httpServer, { cors: { origin: "*" } });
  wireConnections();
}
const rooms = new RoomManager();

// Push every player in a room their personalized, redacted state + events.
function broadcast(room) {
  const hostId = room.sockets.get(room.hostSocketId) || null; // playerId of the host
  for (const [socketId, playerId] of room.sockets) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    // Streamer-mode players see a fixed decoy join code in their own lobby view
    // (so their on-stream code can't be used to join); everyone else sees the
    // real code. The REAL room.id still drives all socket ops on every client.
    const viewer = room.engine.players.get(playerId);
    const code = viewer?.streamerMode ? DECOY_CODE : room.id;
    sock.emit("state", {
      roomId: room.id,
      hostId,
      code,
      matchId: room.roundId(), // stable id of the current round (for karma targeting)
      // B7: who's readied up, and whether the host can start yet
      ready: room.readySnapshot(),
      allReady: room.allHumansReady(),
      view: room.engine.viewFor(playerId),
      events: room.engine.eventsFor(playerId),
    });
  }
}

// Authoritative clock. Runs at 10 Hz so continuous movement looks real-time;
// every game system is dt-scaled, so dt=0.1 keeps per-second tuning identical to
// the old 1 Hz loop. We broadcast every tick (10/sec) during active play.
const TICK_HZ = 20;
const TICK_DT = 1 / TICK_HZ;
function ensureTicker(room) {
  if (room.ticker) return;
  room.ticker = setInterval(() => {
    const before = room.engine.phase;
    room.engine.tick(TICK_DT);
    const ph = room.engine.phase;
    // Bots need no driver in the Batch 1 stub — the engine advances every
    // racer's progress itself. Real bot drivers return with the RaceEngine.
    if (ph === PHASE.ACTIVE || ph !== before) broadcast(room);
    if (ph === PHASE.ENDED) {
      clearInterval(room.ticker); room.ticker = null; broadcast(room);
      const result = room.engine.matchResult();
      if (result.participants.length > 0) {
        // Forward the full report (winner, map, mode, per-player stats) so the
        // backend can roll lifetime stats, history, achievements, and rankings.
        reportMatchResult({ matchId: room.roundId(), ...result });
      }
    }
  }, 1000 / TICK_HZ);
}

function wireConnections() {
io.on("connection", (socket) => {
  // helper: run an engine action with the caller's playerId, guard errors, rebroadcast.
  // `quiet` is for high-frequency inputs (movement): failures are dropped silently
  // instead of toasting — a reconnecting socket flushes queued moves before its
  // rejoin lands, and those must not spam "Room not found." at the player.
  function act(roomId, fn, { quiet = false } = {}) {
    const room = rooms.get(roomId);
    if (!room) { if (!quiet) socket.emit("error_msg", "Room not found."); return; }
    const playerId = room.playerIdOf(socket.id);
    if (!playerId) { if (!quiet) socket.emit("error_msg", "You're not in this room."); return; }
    try { fn(room, playerId); broadcast(room); }
    catch (e) { if (!quiet) socket.emit("error_msg", e.message); }
  }

  // Resolve a joining socket's account from its session token. Returns an
  // account object for addPlayer, or null for a guest (if guests are allowed).
  async function resolveAccount(token, fallbackName) {
    const session = verifySession(token);
    if (!session) {
      if (!config.allowGuests) return { error: "Sign in to play." };
      return { account: null, name: fallbackName || "Guest" };
    }
    const profile = await fetchMatchProfile(session.userId);
    // Even if the backend is unreachable, we still know who they are from the token.
    return {
      account: profile
        ? { userId: session.userId, loadout: profile.loadout, selectedAvatar: profile.selectedAvatar, selectedBorder: profile.selectedBorder, unlockedPerks: profile.unlockedPerks, equippedPerks: profile.equippedPerks || [], eventFlags: profile.eventFlags || [], silenced: profile.silenced, banned: profile.banned, streamerMode: !!profile.streamerMode }
        : { userId: session.userId, loadout: {}, unlockedPerks: [], eventFlags: [] },
      name: (profile && profile.name) || session.name || fallbackName || "Crew",
      banned: profile ? profile.banned : false,
    };
  }

  socket.on("create_room", async ({ config, name, token } = {}, cb) => {
    const r = await resolveAccount(token, name || "Host");
    if (r.error) return cb?.({ error: r.error });
    let room;
    try { room = rooms.create(config || {}); }
    catch (e) { return cb?.({ error: e.message }); } // e.g. unknown mapId
    const playerId = room.engine.addPlayer(r.name, r.account);
    room.attach(socket.id, playerId, { name: r.name, account: r.account });
    socket.join(room.id);
    if (r.account?.userId) { social.connect(r.account.userId, socket.id); social.enterRoom(r.account.userId, socket.id, room.id); }
    cb?.({ roomId: room.id, playerId, code: room.id, isPublic: room.isPublic, rejoinToken: mintRejoinToken(room, playerId) });
    broadcast(room);
  });

  // Join Random: drop into an open public lobby, or spin up a fresh one.
  socket.on("join_random", async ({ name, token, mapId } = {}, cb) => {
    const r = await resolveAccount(token, name || "Racer");
    if (r.error) return cb?.({ error: r.error });
    const room = rooms.findOrCreateRandom(mapId);
    try {
      const playerId = room.engine.addPlayer(r.name, r.account);
      room.attach(socket.id, playerId, { name: r.name, account: r.account });
      socket.join(room.id);
      if (r.account?.userId) { social.connect(r.account.userId, socket.id); social.enterRoom(r.account.userId, socket.id, room.id); }
      cb?.({ roomId: room.id, playerId, code: room.id, rejoinToken: mintRejoinToken(room, playerId) });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
  });

  // B8 — the open-games browser: every public lobby with a free seat. No auth
  // needed; it only exposes code / map / mode / human-count (never bot counts).
  socket.on("list_open_games", (_payload, cb) => {
    try { cb?.({ games: rooms.listOpenGames({ limit: 40 }) }); }
    catch (e) { cb?.({ error: e.message, games: [] }); }
  });

  // B9 — Quick Join: drop into the open game closest to 4 real players (fills
  // lobbies toward a playable size fastest), or spin up a fresh public one.
  socket.on("quick_join", async ({ name, token, mapId } = {}, cb) => {
    const r = await resolveAccount(token, name || "Racer");
    if (r.error) return cb?.({ error: r.error });
    const room = rooms.quickJoin(mapId);
    try {
      const playerId = room.engine.addPlayer(r.name, r.account);
      room.attach(socket.id, playerId, { name: r.name, account: r.account });
      socket.join(room.id);
      if (r.account?.userId) { social.connect(r.account.userId, socket.id); social.enterRoom(r.account.userId, socket.id, room.id); }
      cb?.({ roomId: room.id, playerId, code: room.id, rejoinToken: mintRejoinToken(room, playerId) });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
  });

  // B10 — Quick Race: a fresh hosted race that ROTATES the circuit each time, so
  // back-to-back quick races aren't all the same map. Bot-filled + auto-started
  // by the client the same way Quick Play is.
  socket.on("quick_race", async ({ name, token } = {}, cb) => {
    const r = await resolveAccount(token, name || "Racer");
    if (r.error) return cb?.({ error: r.error });
    const trackId = rooms.nextQuickRaceTrack();
    let room;
    try { room = rooms.create({ isPublic: false, mode: "race", trackId }); }
    catch (e) { return cb?.({ error: e.message }); }
    const playerId = room.engine.addPlayer(r.name, r.account);
    room.attach(socket.id, playerId, { name: r.name, account: r.account });
    socket.join(room.id);
    if (r.account?.userId) { social.connect(r.account.userId, socket.id); social.enterRoom(r.account.userId, socket.id, room.id); }
    cb?.({ roomId: room.id, playerId, code: room.id, trackId, rejoinToken: mintRejoinToken(room, playerId) });
    broadcast(room);
  });

  // Host tweaks match config while still in the lobby (before draft/start).
  socket.on("update_config", async ({ roomId, config } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can change settings.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Can't change settings after the match starts.");
    const incoming = { ...(config || {}) };
    // MODES ARE REAL NOW. Changing the mode rebuilds the engine's rules, arena,
    // player cap and spawns — same as changing the circuit does.
    // Merge freely (no bounds, by design) over the engine's current config.
    Object.assign(room.engine.config, incoming);
    // Changing the circuit means a NEW TRACK — the engine builds its track once
    // at construction, so merging a trackId into config alone would leave
    // everyone racing the old map while the lobby claimed otherwise.
    if (incoming.trackId) room.engine.setTrack(incoming.trackId);
    if (incoming.mode) room.engine.setMode(incoming.mode);
    // A mode/track change can trim the roster to a smaller cap (bots first). Keep
    // the room's own bot list + any seated-socket bookkeeping in sync with what
    // actually survived on the engine, so a later rematch/broadcast is accurate.
    room.reconcileRoster?.();
    room.isPublic = !!room.engine.config.isPublic;
    broadcast(room);
  });

  socket.on("join_room", async ({ roomId, name, token } = {}, cb) => {
    // Streamer-mode decoy: anyone who tries to join with the fixed decoy code is
    // routed to a harmless joke screen instead of resolving to any real room.
    if (String(roomId || "").toUpperCase() === DECOY_CODE) return cb?.({ joke: true });
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room not found." });
    const r = await resolveAccount(token, name || "Racer");
    if (r.error) return cb?.({ error: r.error });
    try {
      const playerId = room.engine.addPlayer(r.name, r.account);
      room.attach(socket.id, playerId, { name: r.name, account: r.account });
      socket.join(room.id);
      if (r.account?.userId) { social.connect(r.account.userId, socket.id); social.enterRoom(r.account.userId, socket.id, room.id); }
      cb?.({ roomId: room.id, playerId, rejoinToken: mintRejoinToken(room, playerId) });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
  });

  // A reconnected socket reclaims its old mid-match seat (grace-period rejoin).
  // Account seats are matched by the session token's userId. Guest seats are
  // matched ONLY by the secret per-seat rejoinToken issued at join time —
  // playerIds are sequential and visible to everyone in the room, so they can
  // never authorize a claim on their own.
  socket.on("rejoin_room", ({ roomId, playerId, token, rejoinToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room not found." });
    room.pendingRejoin = room.pendingRejoin || new Map();
    const session = verifySession(token);
    let seatId = null;
    if (playerId && room.pendingRejoin.has(playerId)) {
      const seatUserId = room.pendingRejoin.get(playerId).info?.account?.userId || null;
      const seatToken = room.rejoinTokens?.get(playerId) || null;
      // An account-held seat can only be reclaimed by that same account; a
      // guest seat only by presenting the matching secret token.
      if (seatUserId ? (session && session.userId === seatUserId)
                     : (seatToken && rejoinToken === seatToken)) seatId = playerId;
    }
    if (!seatId && session) {
      for (const [pid, entry] of room.pendingRejoin) {
        if (entry.info?.account?.userId === session.userId) { seatId = pid; break; }
      }
    }
    if (!seatId) return cb?.({ error: "Your seat is no longer available." });
    const entry = room.pendingRejoin.get(seatId);
    clearTimeout(entry.timer);
    room.pendingRejoin.delete(seatId);
    room.attach(socket.id, seatId, entry.info || undefined);
    socket.join(room.id);
    const userId = entry.info?.account?.userId;
    if (userId) { social.connect(userId, socket.id); social.enterRoom(userId, socket.id, room.id); }
    cb?.({ roomId: room.id, playerId: seatId });
    broadcast(room);
  });

  // Host adds a bot (lobby only) of a chosen tier, up to the map cap. Mixed
  // tiers allowed; bots get roles normally (a bot can be the impostor).
  socket.on("add_bot", ({ roomId, tier } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can add bots.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Bots can only be added in the lobby.");
    if (room.engine.players.size >= room.engine.map.maxPlayers) return socket.emit("error_msg", "Lobby is full.");
    try { room.addBot(tier || "pilot"); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  });
  socket.on("remove_bot", ({ roomId, playerId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can remove bots.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Bots can only be removed in the lobby.");
    if (room.removeBot(playerId)) broadcast(room);
  });

  socket.on("start_match", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can start.");
    const pid = room.playerIdOf(socket.id);
    const force = room.engine.isEventHost(pid); // event hosts may start below the map minimum
    // B7 — READY GATE. Every real player must have readied up first (the host is
    // implicitly ready). Bots don't gate. Event hosts can still force-start.
    if (!force && !room.allHumansReady()) {
      return socket.emit("error_msg", "Everyone needs to ready up first.");
    }
    // Auto bot-fill: top the grid up so nobody races an empty track. On by
    // default; event hosts / custom formats can turn it off via room config.
    if (room.engine.config.autoFill !== false && room.engine.phase === PHASE.LOBBY) {
      room.fillBots();
    }
    try { room.engine.start({ force }); ensureTicker(room); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  });

  // B7 — a real player toggles their ready state in the lobby.
  socket.on("set_ready", ({ roomId, ready } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.engine.phase !== PHASE.LOBBY) return;
    const pid = room.playerIdOf(socket.id);
    if (!pid) return;
    room.setReady(pid, ready !== false);
    broadcast(room);
  });

  // Rematch: host re-runs with the same crew. Spins up a fresh engine in the
  // lobby phase so a new draft/match can start; keeps the room code + roster.
  socket.on("rematch", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can rematch.");
    if (room.engine.phase !== PHASE.ENDED) return socket.emit("error_msg", "Match still in progress.");
    room.rematch();
    broadcast(room);
  });

  // ---- player actions ----
  // Batch 1 stub: the race auto-runs server-side; the only in-race inputs are
  // social (chat bubbles + emotes). Driving inputs (steer/gas/brake/item) land
  // with the real RaceEngine in Batch 2 as: socket.on("race_input", ...).
  socket.on("speech", ({ roomId, text }) => act(roomId, (r, pid) => r.engine.sendSpeech(pid, text ?? null)));
  socket.on("emote", ({ roomId, emoteId }) => act(roomId, (r, pid) => r.engine.setEmote(pid, emoteId)));
  // Driving input: high-frequency, quiet (a reconnecting socket flushes stale
  // inputs before its rejoin lands — those must never toast errors).
  socket.on("race_input", ({ roomId, throttle, steer, keys } = {}) => act(roomId, (r, pid) => r.engine.setInput(pid, { throttle, steer, keys }), { quiet: true }));
  // The shovel scoop: respawn on the centerline at a dead stop (soft penalty).
  socket.on("race_reset", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.requestReset(pid), { quiet: true }));
  socket.on("race_use", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.useItem(pid), { quiet: true }));

  // ===================== SOCIAL: presence + lobby invites (Task #3) =====================

  // A home-screen "social" socket identifies itself so we can track online status
  // and deliver lobby invites even when the user isn't in a match yet. This socket
  // does NOT seat the user into any room (enterRoom is only for match sockets).
  socket.on("identify", async ({ token } = {}, cb) => {
    const session = verifySession(token);
    if (!session) return cb?.({ error: "Sign in first." });
    social.connect(session.userId, socket.id);
    socket.data.userId = session.userId;
    cb?.({ ok: true, userId: session.userId });
  });

  // Live status for a list of friend userIds: { [userId]: { online, inLobby, roomId } }.
  // Requires an identified socket, and only returns presence for accounts the caller
  // has actually friended (prevents enumeration of arbitrary users / room codes).
  // roomId is only surfaced when the friend is in a LOBBY-phase joinable room AND the
  // relationship is mutual (so the client can offer a direct-join button to mutuals).
  socket.on("friend_status", async ({ ids } = {}, cb) => {
    const me = socket.data.userId || social.userOf(socket.id);
    if (!me) return cb?.({ error: "Sign in first." });
    const list = (Array.isArray(ids) ? ids : []).filter((id) => id && id !== me).slice(0, 200);
    const out = {};
    await Promise.all(list.map(async (id) => {
      const { aFollowsB, mutual } = await checkFriendship(me, id);
      if (!aFollowsB) return; // not your friend — reveal nothing
      const roomId = social.roomOf(id);
      const room = roomId ? rooms.get(roomId) : null;
      const inLobby = !!room && room.engine.phase === PHASE.LOBBY;
      const inJoinableLobby = inLobby && room.engine.players.size < room.engine.map.maxPlayers;
      out[id] = {
        online: social.isOnline(id),
        inLobby,
        roomId: mutual && inJoinableLobby ? roomId : null,
      };
    }));
    cb?.({ statuses: out });
  });

  // A user currently in a lobby invites a friend. The sender must be seated in the
  // room (a match socket) and must have added the recipient as a friend. The invite
  // is pushed to every online socket of the recipient and expires in 20s.
  socket.on("invite_friend", async ({ roomId, friendId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room not found." });
    const fromUserId = socket.data.userId || social.userOf(socket.id);
    if (!fromUserId) return cb?.({ error: "Sign in to invite." });
    if (room.engine.phase !== PHASE.LOBBY) return cb?.({ error: "You can only invite from the lobby." });
    // The sender must actually be seated in this room — you can't invite into a
    // lobby you aren't part of.
    const fromPlayerId = room.playerIdOf(socket.id);
    if (!fromPlayerId) return cb?.({ error: "You can only invite from a lobby you're in." });
    if (!friendId) return cb?.({ error: "No friend specified." });
    // Sender must have added the recipient (one-directional is enough to invite).
    const { aFollowsB } = await checkFriendship(fromUserId, friendId);
    if (!aFollowsB) return cb?.({ error: "You can only invite your friends." });
    const fromName = room.engine.players.get(fromPlayerId)?.name || "A friend";
    const invite = social.addInvite({ roomId, fromUserId, fromName, toUserId: friendId });
    for (const sid of social.socketsOf(friendId)) {
      io.sockets.sockets.get(sid)?.emit("lobby_invite", { roomId, fromName, expiresAt: invite.expiresAt });
    }
    cb?.({ ok: true, expiresAt: invite.expiresAt });
  });

  // Recipient accepts an invite: we validate the invite is still live and the room
  // is a joinable lobby, then return the roomId for the client to join normally.
  socket.on("accept_invite", ({ roomId } = {}, cb) => {
    const me = socket.data.userId;
    if (!me) return cb?.({ error: "Sign in first." });
    const inv = social.takeInvite(roomId, me);
    if (!inv) return cb?.({ error: "That invite expired." });
    const room = rooms.get(roomId);
    if (!room || room.engine.phase !== PHASE.LOBBY) return cb?.({ error: "That lobby is no longer open." });
    if (room.engine.players.size >= room.engine.map.maxPlayers) return cb?.({ error: "That lobby is full." });
    cb?.({ ok: true, roomId });
  });

  // Mutual-friend direct join: a user clicks a friend who is in a joinable lobby.
  // Allowed only when the two are MUTUAL friends and the room is LOBBY + has space.
  socket.on("direct_join", async ({ friendId } = {}, cb) => {
    const me = socket.data.userId;
    if (!me) return cb?.({ error: "Sign in first." });
    if (!friendId) return cb?.({ error: "No friend specified." });
    const { mutual } = await checkFriendship(me, friendId);
    if (!mutual) return cb?.({ error: "You can only drop into a mutual friend's lobby." });
    const roomId = social.roomOf(friendId);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room || room.engine.phase !== PHASE.LOBBY) return cb?.({ error: "Your friend isn't in an open lobby." });
    if (room.engine.players.size >= room.engine.map.maxPlayers) return cb?.({ error: "That lobby is full." });
    cb?.({ ok: true, roomId });
  });

  // Intentional exit: unseat the player but KEEP the socket alive so the
  // Play screen stays usable (host again / join again without a reload).
  // Found by QA: leaving via socket-disconnect stranded the client with a
  // permanently disabled Host Match button.
  socket.on("leave_room", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room || !room.sockets.has(socket.id)) return;
    const playerId = room.detach(socket.id);
    if (playerId) {
      try { room.engine.removePlayer(playerId); } catch {}
      room.rejoinTokens?.delete(playerId);
    }
    if (room.isEmpty() && (!room.pendingRejoin || room.pendingRejoin.size === 0)) rooms.destroy(room.id);
    else broadcast(room);
  });

  socket.on("disconnect", () => {
    social.drop(socket.id);
    for (const room of rooms.rooms.values()) {
      if (room.sockets.has(socket.id)) {
        const info = room.joinInfo.get(socket.id) || null;
        const playerId = room.detach(socket.id);
        const ph = room.engine.phase;
        // Mid-match (draft/active), a drop is usually a transient network blip —
        // hold the seat for a grace window so the player can rejoin, instead of
        // instantly removing them (which also destroyed bot-filled rooms and
        // caused the random "Room not found." mid-match).
        if (playerId && ph === PHASE.ACTIVE) {
          room.pendingRejoin = room.pendingRejoin || new Map();
          const timer = setTimeout(() => {
            room.pendingRejoin?.delete(playerId);
            room.rejoinTokens?.delete(playerId); // grace over — token is dead
            if (!rooms.get(room.id)) return; // room already gone
            try { room.engine.removePlayer(playerId); } catch {}
            if (room.isEmpty() && room.pendingRejoin.size === 0) rooms.destroy(room.id);
            else broadcast(room);
          }, REJOIN_GRACE_MS);
          room.pendingRejoin.set(playerId, { info, timer });
          broadcast(room);
        } else {
          if (playerId) { try { room.engine.removePlayer(playerId); } catch {} room.rejoinTokens?.delete(playerId); }
          if (room.isEmpty() && (!room.pendingRejoin || room.pendingRejoin.size === 0)) rooms.destroy(room.id);
          else broadcast(room);
        }
      }
    }
  });
});
} // end wireConnections

// Attach the game server (Socket.IO) to an existing HTTP server — used by the
// combined deploy server so the game shares one port with the backend + client.
export function attachGameServer(httpServer) {
  setupIo(httpServer);
  return io;
}

// Run standalone only when this file is the entry point.
import { fileURLToPath } from "url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
    res.writeHead(404); res.end();
  });
  setupIo(server);
  server.listen(PORT, () => console.log(`SANDBOX GP game server (Socket.IO) on :${PORT}`));
}
