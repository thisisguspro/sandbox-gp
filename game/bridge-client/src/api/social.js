// Persistent "social" Socket.IO connection to the game server (Task #3).
//
// Separate from the in-match game connection: this one lives for the whole
// signed-in session (held by App) so the player shows as online, can poll
// friend presence, receive lobby invites, and direct-join a mutual friend's
// open lobby — all without being in a match.

import { io } from "socket.io-client";
import { GAME_URL, TOKEN_KEY, tokenStore } from "./config.js";

export function createSocialConnection({ onInvite, onConnect, onDisconnect } = {}) {
  const socket = io(GAME_URL, { transports: ["websocket"], forceNew: true });
  const token = () => tokenStore.getItem(TOKEN_KEY);
  const cb = (resolve) => (res) => resolve(res || {});

  // Identify ourselves on every (re)connect so presence survives reconnects.
  socket.on("connect", () => {
    socket.emit("identify", { token: token() }, (res) => onConnect && onConnect(res));
  });
  socket.on("disconnect", () => onDisconnect && onDisconnect());
  // A friend invited us to their lobby: { roomId, fromName, expiresAt }.
  socket.on("lobby_invite", (msg) => onInvite && onInvite(msg));

  return {
    socket,
    // Live presence for a list of friend userIds.
    friendStatus: (ids) => new Promise((r) => socket.emit("friend_status", { ids }, cb(r))),
    // Accept a pending invite → returns { ok, roomId } if still valid.
    acceptInvite: (roomId) => new Promise((r) => socket.emit("accept_invite", { roomId }, cb(r))),
    // Drop into a mutual friend's open lobby → returns { ok, roomId }.
    directJoin: (friendId) => new Promise((r) => socket.emit("direct_join", { friendId }, cb(r))),
    disconnect: () => socket.close(),
  };
}
