// Real Socket.IO client for the BRIDGE game server (:5000). Wraps the actual
// match protocol: create/join rooms, lobby config, and the in-match actions.
// The server streams redacted per-player state via the "state" event — this
// client just relays that to React via an onState callback.

import { io } from "socket.io-client";
import { GAME_URL, TOKEN_KEY, tokenStore } from "./config.js";

export function createGameConnection({ onState, onEvents, onError, onConnect, onDisconnect }) {
  const socket = io(GAME_URL, { transports: ["websocket"], forceNew: true });
  socket.on("connect", () => onConnect && onConnect(socket.id));
  socket.on("disconnect", () => onDisconnect && onDisconnect());
  socket.on("state", (msg) => {
    // Server sends { roomId, hostId, matchId, view, events }. Fold hostId and
    // matchId into the view so screens can read view.hostId / view.matchId
    // directly (matchId is needed to target post-game karma), and surface
    // events separately.
    const v = msg.view ?? msg;
    if (v && typeof v === "object") {
      if (msg.hostId) v.hostId = msg.hostId;
      if (msg.matchId) v.matchId = msg.matchId;
      // Per-viewer join code: the decoy code for streamer-mode viewers, the real
      // room id for everyone else. Screens read view.code for what to DISPLAY,
      // but keep using the real roomId for all socket operations.
      if (msg.code) v.code = msg.code;
    }
    onState && onState(v);
    if (msg.events && onEvents) onEvents(msg.events);
  });
  socket.on("error_msg", (m) => onError && onError(m));

  const token = () => tokenStore.getItem(TOKEN_KEY);
  const cb = (resolve) => (res) => resolve(res || {});

  return {
    socket,
    // lobby
    createRoom: (config = {}, name) => new Promise((r) => socket.emit("create_room", { config, name, token: token() }, cb(r))),
    joinRoom: (roomId, name) => new Promise((r) => socket.emit("join_room", { roomId, name, token: token() }, cb(r))),
    joinRandom: (name, mapId) => new Promise((r) => socket.emit("join_random", { name, mapId, token: token() }, cb(r))),
    // Reclaim a held mid-match seat after a transient disconnect (grace rejoin).
    // rejoinToken is the per-seat secret handed back by create/join — it's what
    // authorizes a guest seat claim (accounts are matched by session token too).
    rejoinRoom: (roomId, playerId, rejoinToken) => new Promise((r) => socket.emit("rejoin_room", { roomId, playerId, rejoinToken, token: token() }, cb(r))),
    updateConfig: (roomId, config) => socket.emit("update_config", { roomId, config }),
    addBot: (roomId, tier) => socket.emit("add_bot", { roomId, tier }),
    removeBot: (roomId, playerId) => socket.emit("remove_bot", { roomId, playerId }),
    startMatch: (roomId) => socket.emit("start_match", { roomId }),
    rematch: (roomId) => socket.emit("rematch", { roomId }),
    // Secret impostor volunteering (lobby/draft): privately raise your draw weight.
    // Invite a friend (by userId) to the current lobby (Task #3).
    inviteFriend: (roomId, friendId) => new Promise((r) => socket.emit("invite_friend", { roomId, friendId }, cb(r))),
    // in-match actions
    emote: (roomId, emoteId) => socket.emit("emote", { roomId, emoteId }),
    raceInput: (roomId, throttle, steer) => socket.emit("race_input", { roomId, throttle, steer }),
    raceReset: (roomId) => socket.emit("race_reset", { roomId }),
    raceUse: (roomId) => socket.emit("race_use", { roomId }),
    leaveRoom: (roomId) => socket.emit("leave_room", { roomId }),
    disconnect: () => socket.close(),
  };
}
