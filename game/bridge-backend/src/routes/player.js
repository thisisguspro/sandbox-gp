import { Router } from "express";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";

export const playerRouter = Router();

// Everything the player owns.
playerRouter.get("/inventory", requireAuth, async (req, res) => {
  res.json({ items: await db.getInventory(req.userId) });
});

// Current currency balances (for the shop header, etc.) + live premium state.
playerRouter.get("/wallet", requireAuth, async (req, res) => {
  const prem = await db.getPremium(req.userId);
  res.json({
    CREDITS: await db.getBalance(req.userId, "CREDITS"),
    PREMIUM: await db.getBalance(req.userId, "PREMIUM"),
    premiumUntil: prem.premiumUntil,
    premium: prem.premium,
  });
});

// ----- news (player-facing announcements) -----
// Live tiles only (published, or scheduled past their time), each flagged unread
// against this account's last-seen revision. `unread` = at least one new tile.
// ---- SANDBOX GP: daily quests + streak ----
playerRouter.get("/daily", requireAuth, async (req, res) => {
  console.log('[daily] route hit, user', req.userId);
  try { const out = await db.getDaily(req.userId); console.log('[daily] store returned'); res.json(out); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
playerRouter.post("/daily/claim", requireAuth, async (req, res) => {
  try {
    const out = await db.claimDailyQuest(req.userId, String(req.body?.questId || ""));
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rank ladder: where the player stands and what the next level unlocks.
playerRouter.get("/progress", requireAuth, async (req, res) => {
  try { res.json(await db.getProgress(req.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Weekly best-lap leaderboard (time-trial mode). Auth'd so we can mark "you".
playerRouter.get("/leaderboard/laps", requireAuth, async (req, res) => {
  const board = await db.weeklyBestLaps(10);
  const youRow = board.rows.find((r) => r.userId === req.userId) || null;
  const u = await db.getUser(req.userId);
  const you = youRow || (u?.weeklyLap?.weekKey === board.weekKey && u.weeklyLap.bestLapSec > 0
    ? { userId: u.id, name: u.name, bestLapSec: u.weeklyLap.bestLapSec, totalSec: u.weeklyLap.totalSec }
    : null);
  res.json({ ...board, you });
});

playerRouter.get("/news", requireAuth, async (req, res) => {
  const news = await db.listLiveNews(req.userId);
  res.json({ news, unread: news.filter((n) => n.unread).length });
});
// Full HTML body for one live tile (fetched when the player expands it).
playerRouter.get("/news/:slot", requireAuth, async (req, res) => {
  const item = await db.getLiveNewsBody(req.params.slot);
  if (!item) return res.status(404).json({ error: "No such news." });
  res.json({ item });
});
// Mark a tile seen (clears its "new" badge) — called when the player opens it.
playerRouter.post("/news/:slot/seen", requireAuth, async (req, res) => {
  await db.markNewsSeen(req.userId, req.params.slot);
  res.json({ ok: true });
});

// Usable stash: consumable definitions + this account's owned counts.
playerRouter.get("/consumables", requireAuth, async (req, res) => {
  res.json(await db.listConsumables(req.userId));
});

// Set the account's preferred UI language (persisted server-side). The client
// also caches the choice in localStorage, which drives the active UI language.
playerRouter.post("/language", requireAuth, async (req, res) => {
  try {
    const lang = await db.setUserLanguage(req.userId, String((req.body || {}).language || ""));
    res.json({ language: lang });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Pop one consumable: applies its reward (currency or XP) and decrements the count.
playerRouter.post("/consumables/:id/use", requireAuth, async (req, res) => {
  try { res.json(await db.useConsumable(req.userId, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Frontier Loyalty ladder: lifetime spend, milestones, and claim state.
playerRouter.get("/loyalty", requireAuth, async (req, res) => {
  res.json(await db.getLoyalty(req.userId));
});
// Claim a reached milestone (grants its premium time + exclusive cosmetic once).
playerRouter.post("/loyalty/:id/claim", requireAuth, async (req, res) => {
  try { res.json(await db.claimLoyalty(req.userId, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Rewarded ads: status (how many Silver Nugget claims are left today) + claim.
// The claim is server-authoritative — it enforces the per-UTC-day cap and grants
// through the same balance funnel as everything else. The client plays a (for now
// stubbed) rewarded ad first; when a real ad network is added, gate the claim
// behind its Server-Side Verification callback instead of trusting the client.
playerRouter.get("/ad-reward", requireAuth, async (req, res) => {
  try { res.json(await db.getAdReward(req.userId)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
playerRouter.post("/ad-reward/claim", requireAuth, async (req, res) => {
  try { res.json(await db.claimAdReward(req.userId)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Redeem a code. Server validates existence + single-use-per-account, then grants.
playerRouter.post("/redeem", requireAuth, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a code." });

  const payload = await db.getCode(code);
  if (!payload) return res.status(404).json({ error: "Invalid code." });

  if (await db.hasRedeemed(req.userId, code)) {
    return res.status(409).json({ error: "Code already redeemed on this account." });
  }

  await db.markRedeemed(req.userId, code);

  const granted = {};
  if (payload.amount) {
    granted.balance = await db.adjustBalance(
      req.userId, payload.currency, payload.amount, `redeem:${code}`);
    granted.currency = payload.currency;
    granted.amount = payload.amount;
  }
  if (payload.reward) {
    const entry = await db.addItem(req.userId, payload.reward.item, payload.reward.rarity, `code:${code}`);
    if (payload.reward.cosmeticId) await db.grantCosmetic(req.userId, payload.reward.cosmeticId, `code:${code}`);
    granted.reward = { item: payload.reward.item, rarity: payload.reward.rarity,
      cosmeticId: payload.reward.cosmeticId || null, inventoryId: entry.id };
  }

  res.json({ ok: true, granted });
});

// ===================== FRIENDS / KARMA / REPORTS (Task #3) =====================

// List the player's friends (each with a `mutual` flag + public card).
playerRouter.get("/friends", requireAuth, async (req, res) => {
  res.json({ friends: await db.listFriends(req.userId) });
});

// Add a friend (one-directional). Body: { targetId }.
playerRouter.post("/friends", requireAuth, async (req, res) => {
  const { targetId } = req.body || {};
  try { res.json(await db.addFriend(req.userId, targetId)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Remove a friend.
playerRouter.delete("/friends/:id", requireAuth, async (req, res) => {
  try { res.json(await db.removeFriend(req.userId, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Give karma to one match participant. Body: { matchId, targetId }.
// Cap of 2 per match, once each, enforced in the store.
playerRouter.post("/karma", requireAuth, async (req, res) => {
  const { matchId, targetId } = req.body || {};
  try { res.json(await db.giveKarma(req.userId, { matchId, targetId })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// File a moderation report. Body: { reportedId, reason, matchId?, context?, optInEmail? }.
// Returns a privacy message; the outcome is never shared with the reporter.
playerRouter.post("/report", requireAuth, async (req, res) => {
  const { reportedId, reason, matchId, context, optInEmail } = req.body || {};
  try { res.json(await db.createReport(req.userId, { reportedId, reason, matchId, context, optInEmail })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
