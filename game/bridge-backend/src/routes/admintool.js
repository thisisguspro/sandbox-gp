import { Router } from "express";
import { db } from "../store/index.js";
import { requireAdminRole, requireSuperadmin } from "../middleware/auth.js";
import { COSMETICS } from "../config/cosmetics.js";
import { EVENT_FLAGS, GAME_MODE_IDS } from "../config/events.js";
import { getObjectEntityUploadURL } from "../lib/objectStorage.js";
import { translateStrings, translatorConfigured } from "../lib/translator.js";

// The admin TOOL API. Lives under /admintool, gated by account role (not a shared
// key). The standalone admin web app (built next) consumes these. Every action is
// tied to a real admin identity, giving an audit trail.
export const adminToolRouter = Router();

// ---- Production admin bootstrap ----
// Dev-login (which auto-grants superadmin) is hard-disabled in production, so a
// live deploy has NO path to a first admin — the panel simply never appears.
// Fix: the operator sets ADMIN_KEY in the environment; any signed-in account
// that presents the matching key ONCE is promoted to superadmin. No key in the
// env → the route is inert. The claim is audited like every other admin action.
import { requireAuth } from "../middleware/auth.js";
adminToolRouter.post("/claim", requireAuth, async (req, res) => {
  const key = process.env.ADMIN_KEY || "";
  if (!key) return res.status(404).json({ error: "Admin claim is not enabled on this server." });
  if (String(req.body?.key || "") !== key) return res.status(403).json({ error: "Wrong admin key." });
  await db.setAdminRole(req.userId, "superadmin");
  try { await db.logAdminAction?.(req.userId, "claim", { via: "ADMIN_KEY" }); } catch {}
  res.json({ ok: true, role: "superadmin" });
});

// Who am I / am I an admin? (the web app calls this on load)
adminToolRouter.get("/me", requireAdminRole, async (req, res) => {
  res.json({ role: req.adminRole, userId: req.userId });
});

// Catalogue helpers for the UI (what items/currencies can be granted).
adminToolRouter.get("/catalogue", requireAdminRole, (_req, res) => {
  res.json({ cosmetics: Object.values(COSMETICS), currencies: ["CREDITS", "PREMIUM"], modes: GAME_MODE_IDS, eventFlags: Object.values(EVENT_FLAGS) });
});

// ----- store administration (admins see + edit the hidden worth/dropWeight) -----
adminToolRouter.get("/store", requireAdminRole, async (_req, res) => {
  // Admins get the FULL objects, including worth + dropWeight (never sent to players).
  res.json(await db.adminListStore());
});
// Fields that meaningfully affect revenue/economy and are worth recording in the
// before/after diff of a store edit (mirrors the mutable allow-list in the store).
const STORE_AUDIT_FIELDS = ["name", "price", "priceCents", "currency", "enabled", "dropWeight", "worth"];
const pickStoreFields = (obj) => {
  const out = {};
  if (!obj) return out;
  for (const k of STORE_AUDIT_FIELDS) if (k in obj) out[k] = obj[k];
  return out;
};
adminToolRouter.post("/store/item", requireAdminRole, async (req, res) => {
  try {
    const item = await db.adminCreateStoreItem(req.body || {});
    // Audit the new catalog entry (id + the fields it launched with).
    await db.recordAdminAction({
      adminId: req.userId, action: "store-create", entityId: item.id,
      detail: { after: pickStoreFields(item) },
    });
    res.json({ item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/store/:id", requireAdminRole, async (req, res) => {
  try {
    // Snapshot before mutating (the store updates the entry in place) so we can
    // record only the fields that actually changed (price/currency/worth, etc.).
    const live = await db.adminGetStoreEntry(req.params.id);
    if (!live) return res.status(400).json({ error: "No such store entry." });
    const prev = pickStoreFields(live);
    const entry = await db.adminUpdateStoreEntry(req.params.id, req.body || {});
    const next = pickStoreFields(entry);
    const before = {}, after = {};
    for (const k of STORE_AUDIT_FIELDS) {
      if (k in next && next[k] !== prev[k]) { before[k] = prev[k] ?? null; after[k] = next[k]; }
    }
    // Only log when something actually changed.
    if (Object.keys(after).length > 0) {
      await db.recordAdminAction({
        adminId: req.userId, action: "store-update", entityId: req.params.id,
        detail: { before, after },
      });
    }
    res.json({ entry });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.delete("/store/:id", requireAdminRole, async (req, res) => {
  // Snapshot the entry's fields before it's gone, so the audit log preserves what
  // the deleted entry looked like.
  const live = await db.adminGetStoreEntry(req.params.id);
  const before = pickStoreFields(live);
  const deleted = await db.adminDeleteStoreEntry(req.params.id);
  if (deleted) {
    await db.recordAdminAction({
      adminId: req.userId, action: "store-delete", entityId: req.params.id,
      detail: { before },
    });
  }
  res.json({ deleted });
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

// ----- player segmentation: find accounts by settings / cosmetic / activity -----
// All criteria optional and AND-combined; paginated ({ results, total, hasMore }).
adminToolRouter.get("/segment", requireAdminRole, async (req, res) => {
  const q = req.query;
  res.json(await db.adminSegmentUsers({
    colorblind: q.colorblind || "",
    streamer: q.streamer || "",
    musicOp: q.musicOp || "",
    musicValue: q.musicValue != null ? Number(q.musicValue) : null,
    avatar: q.avatar || "",
    border: q.border || "",
    cosmetic: q.cosmetic || "",
    cosmeticMode: q.cosmeticMode === "equipped" ? "equipped" : "owned",
    ppdOp: q.ppdOp || "",
    ppdValue: q.ppdValue != null ? Number(q.ppdValue) : null,
    limit: q.limit != null ? Number(q.limit) : 50,
    offset: q.offset != null ? Number(q.offset) : 0,
  }));
});
// Aggregate adoption/usage analytics: most/least used avatars, borders, cosmetics
// (owned/equipped/purchased) + settings adoption. Also feeds the filter dropdowns.
adminToolRouter.get("/usage-stats", requireAdminRole, async (_req, res) => {
  res.json(await db.adminUsageStats());
});

// ----- grant / remove (single account) -----
adminToolRouter.post("/users/:id/grant", requireAdminRole, async (req, res) => {
  const { cosmeticId, currency, amount, consumable, qty, premiumMs, spendCents, grantAll } = req.body || {};
  const result = {};
  try {
    if (grantAll) {
      // Dev convenience: drop the ENTIRE cosmetic catalogue on the account at once.
      result.grantedAll = await db.grantAllCosmetics(req.params.id, `admin:${req.userId}`);
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "grant-all",
        detail: { granted: result.grantedAll.granted, total: result.grantedAll.total },
      });
    }
    if (cosmeticId) {
      result.cosmetic = await db.grantCosmetic(req.params.id, cosmeticId, `admin:${req.userId}`);
      // Audit the manual grant (who granted what to whom, when).
      await db.recordAdminAction({ adminId: req.userId, targetUserId: req.params.id, action: "grant", cosmeticId });
    }
    if (currency && amount) {
      const delta = Math.round(amount);
      result.balance = await db.adjustBalance(req.params.id, currency, delta, `admin:${req.userId}`);
      // Audit the currency grant (before/after balance + amount).
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "currency-grant",
        currency, amount: delta, before: result.balance - delta, after: result.balance,
      });
    }
    if (consumable) {
      // Grant a usable stash item (credit/xp pack) by count.
      result.consumable = await db.grantConsumable(req.params.id, consumable, qty || 1);
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "consumable-grant",
        detail: { itemId: consumable, qty: qty || 1, count: result.consumable.count },
      });
    }
    if (premiumMs) {
      // Grant premium ("Gold Trail") time in milliseconds; stacks on any active pass.
      result.premium = await db.grantPremium(req.params.id, premiumMs, `admin:${req.userId}`);
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "premium-grant",
        detail: { ms: premiumMs, until: result.premium.premiumUntil },
      });
    }
    if (spendCents) {
      // Dev convenience: add to lifetime real-money spend so the Frontier Loyalty
      // ladder can be exercised without running real Stripe checkouts.
      const cents = Math.round(spendCents);
      result.lifetimeSpendCents = await db.recordSpend(req.params.id, cents);
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "spend-grant",
        detail: { cents, lifetimeSpendCents: result.lifetimeSpendCents },
      });
    }
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/remove", requireAdminRole, async (req, res) => {
  const { cosmeticId, currency, amount, source } = req.body || {};
  const result = {};
  try {
    if (cosmeticId) {
      // When a specific source is named, reverse only that one acquisition (e.g.
      // a loot-box drop) and keep the item if another valid source (a paid
      // purchase, gift, level unlock) still holds it — preserving the source
      // attribution a later refund relies on. With no source, hard-wipe the
      // cosmetic and every recorded source.
      result.cosmetic = source
        ? await db.removeCosmeticSource(req.params.id, cosmeticId, source)
        : await db.removeCosmetic(req.params.id, cosmeticId);
      // Audit the revoke: a single-source reversal vs. a hard wipe, plus the
      // outcome (whether the item was actually taken and how many sources remain).
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id,
        action: source ? "reverse" : "remove", cosmeticId, source: source || null,
        detail: { removed: result.cosmetic?.removed, remainingSources: result.cosmetic?.remainingSources },
      });
    }
    if (currency && amount) {
      const amt = Math.round(amount);
      result.balance = await db.adjustBalance(req.params.id, currency, -amt, `admin:${req.userId}`);
      // Audit the currency removal (before/after balance + amount taken).
      await db.recordAdminAction({
        adminId: req.userId, targetUserId: req.params.id, action: "currency-remove",
        currency, amount: amt, before: result.balance + amt, after: result.balance,
      });
    }
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Recent admin actions for one account (audit trail, newest first). Paginated
// (limit/offset) so supervisors can export an account's *full* history, not
// just the latest page. Returns { actions, total, hasMore }.
adminToolRouter.get("/users/:id/audit", requireAdminRole, async (req, res) => {
  res.json(await db.listAdminActions(req.params.id, {
    limit: req.query.limit != null ? Number(req.query.limit) : 50,
    offset: req.query.offset != null ? Number(req.query.offset) : 0,
  }));
});
// Global admin-action feed across EVERY account (superadmin-only): a single
// chronological log to spot a rogue or mistaken admin. Optionally filter by
// acting admin and/or target account. Paginated like the reversal log.
adminToolRouter.get("/actions", requireSuperadmin, async (req, res) => {
  res.json(await db.listAllAdminActions({
    adminQuery: req.query.admin || "",
    targetQuery: req.query.target || "",
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  }));
});
adminToolRouter.post("/users/:id/set-balance", requireAdminRole, async (req, res) => {
  const { currency, value } = req.body || {};
  if (!currency || !Number.isFinite(value)) return res.status(400).json({ error: "currency + numeric value required." });
  try {
    const out = await db.setBalance(req.params.id, currency, value);
    // Audit the exact set-balance (before/after).
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: req.params.id, action: "currency-set",
      currency, before: out.before, after: out.balance,
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ----- moderation: ban + silence -----
adminToolRouter.post("/users/:id/ban", requireAdminRole, async (req, res) => {
  const { banned, durationMs, reason } = req.body || {};
  const isBan = banned !== false;
  try {
    const out = await db.setBan(req.params.id, { banned: isBan, durationMs: durationMs ?? null, reason: reason ?? null });
    // Audit the moderation change (ban or in-place unban via banned:false).
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: req.params.id, action: isBan ? "ban" : "unban",
      reason: isBan ? (reason ?? null) : null,
      detail: isBan ? { durationMs: durationMs ?? null, banUntil: out.moderation?.banUntil ?? null } : null,
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/unban", requireAdminRole, async (req, res) => {
  try {
    const out = await db.setBan(req.params.id, { banned: false });
    await db.recordAdminAction({ adminId: req.userId, targetUserId: req.params.id, action: "unban" });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/users/:id/silence", requireAdminRole, async (req, res) => {
  const { silenced } = req.body || {};
  const isSilence = silenced !== false;
  try {
    const out = await db.setSilence(req.params.id, isSilence);
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: req.params.id, action: isSilence ? "silence" : "unsilence",
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
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
  try {
    const out = await db.setAdminRole(req.params.id, role ?? null);
    // Audit this high-impact privilege change (before/after role).
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: req.params.id, action: "admin-role",
      before: out.before, after: out.after,
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== REPORTS / TICKETS (admin, Task #3) =====================
// List moderation tickets (newest first), optionally filtered by ?status=open|dealt.
adminToolRouter.get("/tickets", requireAdminRole, async (req, res) => {
  res.json({ tickets: await db.listTickets({ status: req.query.status || null }) });
});
// Mark a ticket "dealt with" (and send the reporter's single opt-in confirmation).
adminToolRouter.post("/tickets/:id/resolve", requireAdminRole, async (req, res) => {
  try { res.json({ ticket: await db.resolveTicket(req.params.id, req.userId) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== NEWS (admin authoring) =====================
// Six fixed news tiles players see on the News page. Each tile has a title,
// banner (uploaded image or pasted URL), short blurb, a full pasteable HTML body,
// and a status (draft / published / scheduled-auto-publish). Role-gated.
adminToolRouter.get("/news", requireAdminRole, async (_req, res) => {
  res.json({ news: await db.adminListNews() });
});
// Presigned upload URL for a news banner image. MUST be declared before the
// "/news/:slot" route below, or ":slot" would capture "upload-url". Returns
// { uploadURL, objectPath }: the client PUTs the file bytes straight to
// uploadURL (GCS), then saves objectPath as the tile's bannerUrl (served back
// via GET /objects/...).
adminToolRouter.post("/news/upload-url", requireAdminRole, async (req, res) => {
  try {
    const contentType = String((req.body || {}).contentType || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return res.status(400).json({ error: "Only image uploads are allowed." });
    }
    const { uploadURL, objectPath } = await getObjectEntityUploadURL();
    res.json({ uploadURL, objectPath });
  } catch (e) {
    res.status(500).json({ error: e.message || "Could not create upload URL." });
  }
});
adminToolRouter.post("/news/:slot", requireAdminRole, async (req, res) => {
  try {
    const item = await db.saveNewsSlot(req.params.slot, req.body || {});
    await db.recordAdminAction({
      adminId: req.userId, action: "news-save", entityId: `news:${item.slot}`,
      detail: { after: { title: item.title, status: item.status, scheduledAt: item.scheduledAt } },
    });
    res.json({ item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.delete("/news/:slot", requireAdminRole, async (req, res) => {
  const cleared = await db.clearNewsSlot(req.params.slot);
  if (cleared) {
    await db.recordAdminAction({ adminId: req.userId, action: "news-clear", entityId: `news:${Number(req.params.slot)}` });
  }
  res.json({ cleared });
});

// ===================== LOCALIZATION (admin i18n table) =====================
// Every UI string key with its English source and each language column. Admins
// edit translations here; an edit marks that language "human-edited" so the AI
// auto-translate seed won't overwrite it.
adminToolRouter.get("/i18n", requireAdminRole, async (_req, res) => {
  res.json(await db.adminListTranslations());
});
// Save one { key, lang, value }. Clearing (empty value) releases the human lock.
adminToolRouter.post("/i18n", requireAdminRole, async (req, res) => {
  try {
    const { key, lang, value } = req.body || {};
    const saved = await db.saveTranslation(String(key), String(lang), value);
    await db.recordAdminAction({
      adminId: req.userId, action: "i18n-edit", entityId: `i18n:${saved.key}:${saved.lang}`,
      detail: { value: saved.value },
    });
    res.json({ saved });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// AI auto-translate: fill machine translations for one locale. Never touches
// human-edited rows. `onlyMissing` (default true) skips rows that already have a
// machine value so admins can top up new keys without re-spending on every row.
adminToolRouter.post("/i18n/auto-translate", requireAdminRole, async (req, res) => {
  try {
    if (!translatorConfigured()) {
      return res.status(503).json({ error: "AI translation is not configured on this server." });
    }
    const { lang } = req.body || {};
    const onlyMissing = (req.body || {}).onlyMissing !== false;
    const { translatable } = await db.adminListTranslations();
    if (!translatable.includes(lang)) {
      return res.status(400).json({ error: "Locale is not auto-translatable." });
    }
    const items = await db.listTranslatable(lang, { onlyMissing });
    if (items.length === 0) return res.json({ lang, translated: 0, failed: 0, requested: 0 });
    const { pairs, failed } = await translateStrings(lang, items);
    const translated = await db.applyMachineTranslations(lang, pairs);
    await db.recordAdminAction({
      adminId: req.userId, action: "i18n-auto-translate", entityId: `i18n:${lang}`,
      detail: { requested: items.length, translated, failed },
    });
    res.json({ lang, requested: items.length, translated, failed });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== PAYMENT REVERSALS (admin, Task #13) =====================
// The webhook auto-claws back Prisms/cosmetics/name-change credits on a
// refund/chargeback. This surfaces those reversals so an admin can SEE which
// account had a purchase reversed, why, and what was taken back — and re-grant
// the items for a session that was wrongly reversed (e.g. a chargeback later won
// in the merchant's favor). Role-gated like every other admin action.
adminToolRouter.get("/reversals", requireAdminRole, async (req, res) => {
  const status = ["reversed", "restored", "all"].includes(req.query.status) ? req.query.status : "all";
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const { reversals, total, hasMore } = await db.adminListReversals({
    status,
    query: req.query.q || null,
    from: req.query.from || null,
    to: req.query.to || null,
    limit,
    offset,
  });
  res.json({ reversals, total, hasMore });
});
adminToolRouter.post("/reversals/:sessionId/restore", requireAdminRole, async (req, res) => {
  try {
    const result = await db.restoreCheckoutSession(req.params.sessionId, req.userId);
    if (result.notReversed) return res.status(400).json({ error: "This session is not in a reversed state." });
    res.json({ ok: true, session: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== EVENTS (admin) =====================
// Fields of a limited-time event worth recording in the before/after audit diff
// (these shape rewards/visibility). `reward` is an object, so it's stringified
// when picked so the diff renders + compares as plain text (mirrors the store).
const EVENT_AUDIT_FIELDS = ["name", "type", "mode", "startsAt", "endsAt", "enabled", "reward"];
const pickEventFields = (obj) => {
  const out = {};
  if (!obj) return out;
  for (const k of EVENT_AUDIT_FIELDS) {
    if (k in obj) out[k] = (obj[k] && typeof obj[k] === "object") ? JSON.stringify(obj[k]) : obj[k];
  }
  return out;
};
adminToolRouter.get("/events", requireAdminRole, async (_req, res) => {
  res.json({ events: await db.listEvents(), flags: Object.values(EVENT_FLAGS), modes: GAME_MODE_IDS });
});
adminToolRouter.post("/events", requireAdminRole, async (req, res) => {
  try {
    const event = await db.createEvent(req.body || {});
    // Non-user-scoped (like store edits): targetUserId stays null, entityId = event id.
    await db.recordAdminAction({
      adminId: req.userId, action: "event-create", entityId: event.id,
      detail: { after: pickEventFields(event) },
    });
    res.json({ event });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/events/:id", requireAdminRole, async (req, res) => {
  try {
    // Snapshot before mutating (updateEvent assigns in place) so we record only
    // the fields that actually changed.
    const live = await db.getEvent(req.params.id);
    if (!live) return res.status(400).json({ error: "No such event." });
    const prev = pickEventFields(live);
    const event = await db.updateEvent(req.params.id, req.body || {});
    const next = pickEventFields(event);
    const before = {}, after = {};
    for (const k of EVENT_AUDIT_FIELDS) {
      if (k in next && next[k] !== prev[k]) { before[k] = prev[k] ?? null; after[k] = next[k]; }
    }
    if (Object.keys(after).length > 0) {
      await db.recordAdminAction({
        adminId: req.userId, action: "event-update", entityId: req.params.id,
        detail: { before, after },
      });
    }
    res.json({ event });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.delete("/events/:id", requireAdminRole, async (req, res) => {
  // Snapshot the event's fields before it's gone so the audit log preserves it.
  const live = await db.getEvent(req.params.id);
  const before = pickEventFields(live);
  const deleted = await db.deleteEvent(req.params.id);
  if (deleted) {
    await db.recordAdminAction({
      adminId: req.userId, action: "event-delete", entityId: req.params.id,
      detail: { before },
    });
  }
  res.json({ deleted });
});

// Flag / unflag an account for an event (e.g. bounty target, event host).
adminToolRouter.get("/events/:id/flags", requireAdminRole, async (req, res) => {
  res.json({ flags: await db.listEventFlags(req.params.id) });
});
adminToolRouter.post("/events/:id/flag", requireAdminRole, async (req, res) => {
  const { userId, flag, meta } = req.body || {};
  try {
    const result = await db.setEventFlag(req.params.id, userId, flag, meta || {});
    // Flag changes have a target account: populate targetUserId (so they show in
    // that account's per-user log) AND entityId (the event the flag belongs to).
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: userId, action: "event-flag",
      entityId: req.params.id, detail: { flag },
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminToolRouter.post("/events/:id/unflag", requireAdminRole, async (req, res) => {
  const { userId } = req.body || {};
  // Capture the flag being cleared (for the audit detail) before it's removed.
  const existing = (await db.listEventFlags(req.params.id)).find((f) => f.userId === userId);
  const cleared = await db.clearEventFlag(req.params.id, userId);
  if (cleared) {
    await db.recordAdminAction({
      adminId: req.userId, targetUserId: userId, action: "event-unflag",
      entityId: req.params.id, detail: existing ? { flag: existing.flag } : null,
    });
  }
  res.json({ cleared });
});
