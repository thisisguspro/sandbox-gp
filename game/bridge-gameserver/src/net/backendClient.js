// Thin client the game server uses to talk to the backend, plus session-token
// verification. Identity model (chosen): SHARED JWT SECRET. The backend signs a
// session token at login; because we hold the same secret, we can verify it here
// with no per-join round-trip and learn which real account is connecting.

import jwt from "jsonwebtoken";
import { config } from "./config.js";

// Verify a player session token. Returns { userId, name } or null if invalid.
export function verifySession(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return { userId: payload.sub, name: payload.name };
  } catch {
    return null;
  }
}

// Fetch a player's match profile (loadout + unlocked perks) from the backend.
// Returns null on any failure so the caller can fall back to guest defaults.
export async function fetchMatchProfile(userId) {
  try {
    const res = await fetch(`${config.backendUrl}/internal/match-profile/${userId}`, {
      headers: { "x-service-key": config.serviceKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile;
  } catch {
    return null;
  }
}

// Check the friendship between two accounts so the game server can gate lobby
// invites (sender must have added the recipient) and mutual-friend direct-joins.
// Returns { aFollowsB, bFollowsA, mutual } (all false on any failure).
export async function checkFriendship(a, b) {
  try {
    const res = await fetch(`${config.backendUrl}/internal/friendship?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, {
      headers: { "x-service-key": config.serviceKey },
    });
    if (!res.ok) return { aFollowsB: false, bFollowsA: false, mutual: false };
    return await res.json();
  } catch { return { aFollowsB: false, bFollowsA: false, mutual: false }; }
}

// Fetch active events (windows + their config/mode) the match may apply.
export async function fetchActiveEvents() {
  try {
    const res = await fetch(`${config.backendUrl}/internal/active-events`, {
      headers: { "x-service-key": config.serviceKey },
    });
    if (!res.ok) return [];
    return (await res.json()).events || [];
  } catch { return []; }
}

// Report a bounty take-down so the backend grants the reward (once).
export async function reportBountyClaim(claim) {
  try {
    const res = await fetch(`${config.backendUrl}/internal/bounty-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-key": config.serviceKey },
      body: JSON.stringify(claim),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// Report a finished match so the backend can award XP server-to-server.
// Fire-and-forget; failures are logged but never block the game.
export async function reportMatchResult(payload) {
  try {
    const res = await fetch(`${config.backendUrl}/internal/match-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-key": config.serviceKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`[reportMatchResult] backend responded ${res.status} ${res.statusText}`);
    return res.ok ? await res.json() : null;
  } catch (e) {
    console.error("[reportMatchResult] failed to reach backend:", e?.message || e);
    return null;
  }
}
