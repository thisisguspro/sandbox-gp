// Social presence layer for the game server (Task #3).
//
// The BACKEND owns friendships/karma/reports but knows nothing about who is
// connected or in a lobby. The GAME SERVER is the only place with live sockets,
// so presence (online / in-lobby) and ephemeral lobby invites live here.
//
// A user may hold more than one socket at once (e.g. a persistent "social"
// connection on the home screen plus a match connection in Play). We therefore
// track presence by userId across all of their sockets.

const INVITE_TTL_MS = 20_000; // a lobby invite is visible for 20s, then expires

// userId -> Set<socketId> of every connected socket that identified as them.
const onlineSockets = new Map();
// socketId -> userId (reverse lookup for disconnect cleanup).
const socketUser = new Map();
// userId -> roomId of the lobby/match they're currently seated in (via a match socket).
const userRoom = new Map();
// socketId -> roomId (so we can clear userRoom when the seating socket drops).
const socketRoom = new Map();
// `${roomId}:${toUserId}` -> { fromUserId, fromName, roomId, expiresAt } pending invites.
const invites = new Map();

function addToSet(map, key, val) {
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  s.add(val);
}
function removeFromSet(map, key, val) {
  const s = map.get(key);
  if (!s) return;
  s.delete(val);
  if (s.size === 0) map.delete(key);
}

export const social = {
  // Register a socket as belonging to userId (called from `identify` and on any
  // authenticated room join).
  connect(userId, socketId) {
    if (!userId || !socketId) return;
    addToSet(onlineSockets, userId, socketId);
    socketUser.set(socketId, userId);
  },

  // Mark that this socket has seated userId into a room (lobby/match).
  enterRoom(userId, socketId, roomId) {
    if (!userId || !roomId) return;
    userRoom.set(userId, roomId);
    if (socketId) socketRoom.set(socketId, roomId);
  },

  // Full cleanup when a socket disconnects: drop it from presence and, if it was
  // the socket seating the user in a room, clear their room.
  drop(socketId) {
    const userId = socketUser.get(socketId);
    socketUser.delete(socketId);
    const roomId = socketRoom.get(socketId);
    socketRoom.delete(socketId);
    if (userId) {
      removeFromSet(onlineSockets, userId, socketId);
      if (roomId && userRoom.get(userId) === roomId) userRoom.delete(userId);
    }
    return userId || null;
  },

  isOnline(userId) { return onlineSockets.has(userId); },
  roomOf(userId) { return userRoom.get(userId) || null; },
  socketsOf(userId) { return [...(onlineSockets.get(userId) || [])]; },
  userOf(socketId) { return socketUser.get(socketId) || null; },

  // ----- ephemeral lobby invites (20s) -----
  addInvite({ roomId, fromUserId, fromName, toUserId }) {
    const key = `${roomId}:${toUserId}`;
    const invite = { roomId, fromUserId, fromName, toUserId, expiresAt: Date.now() + INVITE_TTL_MS };
    invites.set(key, invite);
    return invite;
  },
  // Returns the invite if still valid (and prunes it if expired/used).
  takeInvite(roomId, toUserId) {
    const key = `${roomId}:${toUserId}`;
    const inv = invites.get(key);
    if (!inv) return null;
    invites.delete(key);
    if (inv.expiresAt < Date.now()) return null;
    return inv;
  },
  ttlMs() { return INVITE_TTL_MS; },
};
