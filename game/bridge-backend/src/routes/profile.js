import { Router } from "express";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";
import { COSMETICS, SLOTS, LEVEL_UNLOCKS, xpForLevel } from "../config/cosmetics.js";
import { DEFAULT_SETTINGS, WHEEL_SLOTS, VOICE_COMMAND_KEYS } from "../config/settings.js";
import { AVATARS, BORDERS, ACHIEVEMENTS } from "../config/achievements.js";

export const profileRouter = Router();

// Full profile: level, xp, owned cosmetics, equipped loadout, unlocked slots/perks.
profileRouter.get("/", requireAuth, async (req, res) => {
  const profile = await db.getProfile(req.userId);
  if (!profile) return res.status(404).json({ error: "Profile not found." });
  // Decorate owned ids with catalogue detail, and show xp-to-next-level.
  const owned = profile.owned.map((id) => ({ id, ...COSMETICS[id] })).filter((c) => c.slot);
  res.json({
    ...profile,
    owned,
    xpToNext: Math.max(0, xpForLevel(profile.level + 1) - profile.xp),
    nextLevelAt: xpForLevel(profile.level + 1),
  });
});

// Static catalogue: all slots and all cosmetics (for the profile UI to render),
// plus the profile-avatar/border pools and the achievement list.
profileRouter.get("/catalogue", (_req, res) => {
  res.json({
    slots: Object.values(SLOTS),
    cosmetics: Object.values(COSMETICS),
    ladder: LEVEL_UNLOCKS,
    avatars: Object.values(AVATARS),
    borders: Object.values(BORDERS),
    achievements: ACHIEVEMENTS,
  });
});

// ----- profile stats (Task #2): avatar/border picker, rankings, toast ack -----

// Choose an owned avatar for the profile.
profileRouter.post("/avatar", requireAuth, async (req, res) => {
  const { avatarId } = req.body || {};
  if (!avatarId) return res.status(400).json({ error: "avatarId required." });
  try {
    res.json(await db.selectAvatar(req.userId, avatarId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Choose an owned border for the profile.
profileRouter.post("/border", requireAuth, async (req, res) => {
  const { borderId } = req.body || {};
  if (!borderId) return res.status(400).json({ error: "borderId required." });
  try {
    res.json(await db.selectBorder(req.userId, borderId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Drain the pending-achievement toast queue once the client has shown them.
profileRouter.post("/ack-achievements", requireAuth, async (req, res) => {
  res.json(await db.ackAchievements(req.userId));
});

// Drain the player-facing notice queue (e.g. restored-purchase banners) once
// the client has shown them.
profileRouter.post("/ack-notices", requireAuth, async (req, res) => {
  res.json(await db.ackNotices(req.userId));
});

// Weekly win-rate leaderboard (eligible at >= 50 lifetime matches).
profileRouter.get("/rankings", requireAuth, async (req, res) => {
  res.json(await db.getRankings(req.userId));
});

// Equip a cosmetic (must own it and have the slot unlocked).
profileRouter.post("/equip", requireAuth, async (req, res) => {
  const { cosmeticId } = req.body || {};
  if (!cosmeticId) return res.status(400).json({ error: "cosmeticId required." });
  try {
    const result = await db.equipCosmetic(req.userId, cosmeticId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Empty a non-essential slot.
profileRouter.post("/unequip", requireAuth, async (req, res) => {
  const { slot } = req.body || {};
  if (!slot) return res.status(400).json({ error: "slot required." });
  try {
    const result = await db.unequipSlot(req.userId, slot);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Award XP (e.g. after a match). In production this is called by the game-result
// pipeline, not the client — exposed here for the match-report integration.
profileRouter.post("/xp", requireAuth, async (req, res) => {
  const { amount, reason } = req.body || {};
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Positive amount required." });
  const result = await db.addXp(req.userId, amount, reason || "match");
  res.json(result);
});

// ----- settings + radial wheels -----

// Get the player's settings, wheels, and the schema/options to render the menu.
profileRouter.get("/settings", requireAuth, async (req, res) => {
  const data = await db.getSettings(req.userId);
  if (!data) return res.status(404).json({ error: "Not found." });
  res.json({
    ...data,
    schema: { defaults: DEFAULT_SETTINGS, wheelSlots: WHEEL_SLOTS, voiceCommands: VOICE_COMMAND_KEYS },
  });
});

// Update settings (partial — only the categories/keys sent are changed).
profileRouter.post("/settings", requireAuth, async (req, res) => {
  const result = await db.updateSettings(req.userId, req.body || {});
  res.json(result);
});

// Toggle streamer mode (account-level privacy flag). Body: { enabled }.
// While on, the player's real name is redacted in-match and the lobby shows a
// fixed decoy join code instead of the real one.
profileRouter.post("/streamer-mode", requireAuth, async (req, res) => {
  try {
    const result = await db.setStreamerMode(req.userId, !!req.body?.enabled);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Bind (or clear) one radial-wheel slot. Body: { wheel, slotIndex, itemKey|null }.
profileRouter.post("/wheel", requireAuth, async (req, res) => {
  const { wheel, slotIndex, itemKey } = req.body || {};
  // For the comms wheel, validate the key against the known voice commands here.
  if (wheel === "comms" && itemKey !== null && !VOICE_COMMAND_KEYS.includes(itemKey)) {
    return res.status(400).json({ error: "Unknown voice command." });
  }
  try {
    const result = await db.setWheelSlot(req.userId, wheel, slotIndex, itemKey ?? null);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
