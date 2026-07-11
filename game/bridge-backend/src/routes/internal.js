import { Router } from "express";
import { db } from "../store/index.js";
import { config } from "../config/index.js";

export const internalRouter = Router();

// Gate: only callers holding the shared service key (the game server) get in.
// This is NOT the player or admin path.
internalRouter.use((req, res, next) => {
  if ((req.headers["x-service-key"] || "") !== config.serviceKey) {
    return res.status(403).json({ error: "Service access required." });
  }
  next();
});

// The game server fetches a player's match profile on join: equipped loadout
// (what others render) and unlocked perks (pooled into the draft candidate list).
internalRouter.get("/match-profile/:userId", async (req, res) => {
  const profile = await db.getMatchProfile(req.params.userId);
  if (!profile) return res.status(404).json({ error: "Account not found." });
  res.json({ profile });
});

// The game server reports a finished match. The store awards XP+Credits, rolls
// each participant's lifetime stats, appends their match-history row, updates the
// weekly win-rate bucket, and grants any newly-unlocked achievement rewards —
// all server-to-server so clients can never grant themselves progression.
internalRouter.post("/match-result", async (req, res) => {
  const { matchId, winner, map, mode, participants } = req.body || {};
  if (!Array.isArray(participants)) return res.status(400).json({ error: "participants[] required." });
  const awarded = await db.ingestMatchResult({ matchId, winner, map, mode, participants });
  res.json({ matchId, winner, awarded });
});

// Friendship check between two accounts (the game server gates lobby invites and
// mutual-friend direct-joins with this). Returns { aFollowsB, bFollowsA, mutual }.
internalRouter.get("/friendship", (req, res) => {
  const { a, b } = req.query || {};
  if (!a || !b) return res.status(400).json({ error: "a and b required." });
  res.json(db.friendship(String(a), String(b)));
});

// Active events the game server may apply this match (global windows + their config).
internalRouter.get("/active-events", async (_req, res) => {
  res.json({ events: await db.activeEvents() });
});

// The game server reports a bounty take-down; backend grants the reward once.
internalRouter.post("/bounty-claim", async (req, res) => {
  const { eventId, targetId, byUserId } = req.body || {};
  if (!eventId || !targetId || !byUserId) return res.status(400).json({ error: "eventId, targetId, byUserId required." });
  const result = await db.claimBounty(eventId, targetId, byUserId);
  res.json(result);
});
