import { Router } from "express";
import { db } from "../store/index.js";
import { requireAdminRole, requireSuperadmin } from "../middleware/auth.js";
import { COSMETICS } from "../config/cosmetics.js";
import { EVENT_FLAGS, GAME_MODE_IDS } from "../config/events.js";

// The admin TOOL API. Lives under /admintool, gated by account role (not a shared
// key). The standalone admin web app (built next) consumes these. Every action is
// tied to a real admin identity, giving an audit trail.
export const adminToolRouter = Router();

// Who am I / am I an admin? (the web app calls this on load)
adminToolRouter.get("/me", requireAdminRole, async (req, res) => {
  res.json({ role: req.adminRole, userId: req.userId });
});

// Catalogue helpers for the UI (what items/currencies can be granted).
adminToolRouter.get("/catalogue", requireAdminRole, (_req, res) => {
  res.json({ cosmetics: Object.values(COSMETICS), currencies: ["CREDITS", "PREMIUM"], modes: GAME_MODE_IDS, eventFlags: Object.values(EVENT_FLAGS) });
});

// ----- account lookup -----
adminToolRouter.get("/users", requireAdminRole, async (req, res) => {
  const results = await db.adminSearchUsers(req.query.q, 25);
  res.json({ results });
});
adminToolRouter.get("/users/:id", requireAdminRole, async (req, res) => {
  const user = await db.adminGetUser(req.params.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user });
});

// ----- grant / remove (single account) -----
adminToolRouter.post("/users/:id/grant", requireAdminRole, async (req, res) => {
  const { cosmeticId, currency, amount } = req.body || {};
  const result = {};
  try {
    if (cosmeticId) result.cosmetic = await db.grantCosmetic(req.params.id, cosmeticId, `admin:${req.userId}`);
    if (currency && amount) result.balance = await db.adjustBalance(req.params.id, currency, Math.round(amount), `admin:${req.userId}`);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/remove", requireAdminRole, async (req, res) => {
  const { cosmeticId, currency, amount } = req.body || {};
  const result = {};
  try {
    if (cosmeticId) result.cosmetic = await db.removeCosmetic(req.params.id, cosmeticId);
    if (currency && amount) result.balance = await db.adjustBalance(req.params.id, currency, -Math.round(amount), `admin:${req.userId}`);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/set-balance", requireAdminRole, async (req, res) => {
  const { currency, value } = req.body || {};
  if (!currency || !Number.isFinite(value)) return res.status(400).json({ error: "currency + numeric value required." });
  try { res.json(await db.setBalance(req.params.id, currency, value)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ----- moderation: ban + silence -----
adminToolRouter.post("/users/:id/ban", requireAdminRole, async (req, res) => {
  const { banned, durationMs, reason } = req.body || {};
  try { res.json(await db.setBan(req.params.id, { banned: banned !== false, durationMs: durationMs ?? null, reason: reason ?? null })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/unban", requireAdminRole, async (req, res) => {
  try { res.json(await db.setBan(req.params.id, { banned: false })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/silence", requireAdminRole, async (req, res) => {
  const { silenced } = req.body || {};
  try { res.json(await db.setSilence(req.params.id, silenced !== false)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ----- bulk operations -----
// Target either an explicit list of userIds, or "all".
async function resolveTargets(body) {
  if (body?.all === true) return await db.allUserIds();
  return Array.isArray(body?.userIds) ? body.userIds : [];
}
adminToolRouter.post("/bulk/grant", requireAdminRole, async (req, res) => {
  const targets = await resolveTargets(req.body);
  if (targets.length === 0) return res.status(400).json({ error: "No targets (userIds[] or all:true)." });
  const { cosmeticId, currency, amount } = req.body || {};
  const results = await db.bulkGrant(targets, { cosmeticId, currency, amount });
  res.json({ count: results.length, results });
});
adminToolRouter.post("/bulk/remove", requireAdminRole, async (req, res) => {
  const targets = await resolveTargets(req.body);
  if (targets.length === 0) return res.status(400).json({ error: "No targets (userIds[] or all:true)." });
  const { cosmeticId, currency, amount } = req.body || {};
  const results = await db.bulkRemove(targets, { cosmeticId, currency, amount });
  res.json({ count: results.length, results });
});

// ----- admin role management (SUPERADMIN only) -----
adminToolRouter.get("/admins", requireSuperadmin, async (_req, res) => {
  res.json({ admins: await db.listAdmins() });
});
adminToolRouter.post("/admins/:id/role", requireSuperadmin, async (req, res) => {
  const { role } = req.body || {};
  if (![null, "admin", "superadmin"].includes(role ?? null)) return res.status(400).json({ error: "role must be null, admin, or superadmin." });
  try { res.json(await db.setAdminRole(req.params.id, role ?? null)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== EVENTS (admin) =====================
adminToolRouter.get("/events", requireAdminRole, async (_req, res) => {
  res.json({ events: await db.listEvents(), flags: Object.values(EVENT_FLAGS), modes: GAME_MODE_IDS });
});
adminToolRouter.post("/events", requireAdminRole, async (req, res) => {
  try { res.json({ event: await db.createEvent(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/events/:id", requireAdminRole, async (req, res) => {
  try { res.json({ event: await db.updateEvent(req.params.id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.delete("/events/:id", requireAdminRole, async (req, res) => {
  res.json({ deleted: await db.deleteEvent(req.params.id) });
});

// Flag / unflag an account for an event (e.g. bounty target, event host).
adminToolRouter.get("/events/:id/flags", requireAdminRole, async (req, res) => {
  res.json({ flags: await db.listEventFlags(req.params.id) });
});
adminToolRouter.post("/events/:id/flag", requireAdminRole, async (req, res) => {
  const { userId, flag, meta } = req.body || {};
  try { res.json(await db.setEventFlag(req.params.id, userId, flag, meta || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/events/:id/unflag", requireAdminRole, async (req, res) => {
  const { userId } = req.body || {};
  res.json({ cleared: await db.clearEventFlag(req.params.id, userId) });
});
