// Real REST client for the BRIDGE backend (:4000). Every call hits the actual
// server. Auth uses the session token the backend issues at sign-in (stored in
// localStorage). In dev the backend's Google OAuth is stubbed, so signIn() posts
// a name/email and gets a real token back — the same token shape production uses.

import { BACKEND_URL, TOKEN_KEY, tokenStore } from "./config.js";

export function getToken() { return tokenStore.getItem(TOKEN_KEY); }
export function setToken(t) { t ? tokenStore.setItem(TOKEN_KEY, t) : tokenStore.removeItem(TOKEN_KEY); }
export function signOut() { setToken(null); }

async function req(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) { const t = getToken(); if (t) headers.Authorization = `Bearer ${t}`; }
  const res = await fetch(BACKEND_URL + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- auth ---
// Google sign-in is the only path: exchange a verified Google ID token for a
// session token.
// ---- Sprint A/B: guest auth, daily quests, rank ladder, lap board ----
export async function guestLogin(name) { return req("/auth/guest", { method: "POST", body: { name }, auth: false }); }
export async function crazyLogin(token) { return req("/auth/crazygames", { method: "POST", body: { token }, auth: !!getToken() }); }
export async function getDaily() { return req("/player/daily"); }
export async function claimQuest(questId) { return req("/player/daily/claim", { method: "POST", body: { questId } }); }
export async function getProgress() { return req("/player/progress"); }
export async function getLapBoard() { return req("/player/leaderboard/laps"); }
export async function getPublicProfile(userId) { return req(`/profile/public/${userId}`); }
export async function scrapItem(cosmeticId) { return req("/player/scrap", { method: "POST", body: { cosmeticId } }); }
export async function craftItem(cosmeticId) { return req("/player/craft", { method: "POST", body: { cosmeticId } }); }
export async function setPerks(equipped) { return req("/player/perks", { method: "POST", body: { equipped } }); }
export async function claimAdmin(key) { return req("/admintool/claim", { method: "POST", body: { key } }); }

export async function signInGoogle(idToken) {
  const data = await req("/auth/google", { method: "POST", auth: false, body: { idToken } });
  if (data.token) setToken(data.token);
  return data; // { token, user }
}
// Dev-only sign-in bypass (enabled server-side only when NOT in production).
// Exchanges a call sign for a session token, same shape as the Google path.
export async function devSignIn(name) {
  const data = await req("/auth/dev-login", { method: "POST", auth: false, body: { name } });
  if (data.token) setToken(data.token);
  return data; // { token, user }
}
// Public auth config: { googleEnabled, googleClientId, devLoginEnabled }.
export async function authConfig() { return req("/auth/config", { auth: false }); }
export async function me() { return req("/auth/me"); }

// --- onboarding (first-time only) ---
// Record Terms of Service acceptance; returns the refreshed { user }.
export async function acceptTos() { return req("/auth/accept-tos", { method: "POST" }); }
// Set the initial display name (server runs the name filter); returns { user } or
// throws with the rejection reason.
export async function setName(name) { return req("/auth/set-name", { method: "POST", body: { name } }); }

// --- paid name change & streamer mode (Task #4) ---
// Spend a name-change credit to set a new (server-filtered) display name.
// Returns { user, nameChangeCredits } or throws with the rejection reason.
export async function changeName(name) { return req("/auth/change-name", { method: "POST", body: { name } }); }
// Toggle account-level streamer mode. Returns { streamerMode }.
export async function setStreamerMode(enabled) { return req("/profile/streamer-mode", { method: "POST", body: { enabled } }); }

// --- progression / cosmetics ---
export async function getProfile() { return req("/profile"); }                 // { level, xp, owned[], loadout{}, unlockedSlots[], xpToNext, nextLevelAt }
export async function getCatalogue() { return req("/profile/catalogue"); }      // { slots[], cosmetics[], ladder{} }
export async function equip(cosmeticId) { return req("/profile/equip", { method: "POST", body: { cosmeticId } }); }
export async function unequip(slot) { return req("/profile/unequip", { method: "POST", body: { slot } }); }

// --- profile stats / achievements / rankings (Task #2) ---
export async function selectAvatar(avatarId) { return req("/profile/avatar", { method: "POST", body: { avatarId } }); }
export async function selectBorder(borderId) { return req("/profile/border", { method: "POST", body: { borderId } }); }
export async function getRankings() { return req("/profile/rankings"); }
export async function ackAchievements() { return req("/profile/ack-achievements", { method: "POST" }); }
// Drain player-facing notices (e.g. an admin restored a wrongly-reversed purchase).
export async function ackNotices() { return req("/profile/ack-notices", { method: "POST" }); }

// --- settings / wheels ---
export async function getSettings() { return req("/profile/settings"); }
export async function saveSettings(patch) { return req("/profile/settings", { method: "POST", body: patch }); }
export async function setWheelSlot(wheel, slotIndex, itemKey) { return req("/profile/wheel", { method: "POST", body: { wheel, slotIndex, itemKey } }); }

// --- wallet ---
export async function getWallet() { return req("/player/wallet"); }

// --- rewarded ads (watch an ad -> Sea Glass, capped per day) ---
export async function getAdReward() { return req("/player/ad-reward"); }                          // { amount, currency, cap, used, remaining }
export async function claimAdReward() { return req("/player/ad-reward/claim", { method: "POST" }); } // { balance, amount, currency, cap, used, remaining }

// --- consumables (usable stash items -> currency / xp) ---
export async function getConsumables() { return req("/player/consumables"); }         // { items: [{ id, name, glyph, desc, count }] }
export async function useConsumable(id) { return req(`/player/consumables/${id}/use`, { method: "POST" }); }

// --- Frontier Loyalty (P4): lifetime-spend ladder ---
// { lifetimeSpendCents, lastSpendAt, inactivityMs, inactivityReset, milestones:[{ id, label, spendCents, premiumMs, cosmetics[], reached, claimed, claimable }] }
export async function getLoyalty() { return req("/player/loyalty"); }
export async function claimLoyalty(id) { return req(`/player/loyalty/${id}/claim`, { method: "POST" }); }

// --- news (player-facing announcements) ---
export async function getNews() { return req("/player/news"); }                        // { news:[{slot,title,bannerUrl,shortDesc,rev,publishedAt,unread}], unread }
export async function getNewsBody(slot) { return req(`/player/news/${slot}`); }         // { item:{...,bodyHtml} }
export async function markNewsSeen(slot) { return req(`/player/news/${slot}/seen`, { method: "POST" }); }

// --- stores ---
export async function listBoxes(currency) { return req(`/store/boxes${currency ? `?currency=${currency}` : ""}`, { auth: false }); }
export async function openBox(boxId) { return req(`/store/boxes/${boxId}/open`, { method: "POST" }); }
export async function listItems(currency) { return req(`/store/items${currency ? `?currency=${currency}` : ""}`, { auth: false }); }
export async function buyItem(id) { return req(`/store/items/${id}/buy`, { method: "POST" }); }
export async function checkoutItems(itemIds) { return req("/payments/checkout-items", { method: "POST", body: { itemIds } }); }
export async function getPacks() { return req("/payments/packs", { auth: false }); }
export async function checkoutPack(packId) { return req("/payments/checkout", { method: "POST", body: { packId } }); }
// Dev only: in Stripe stub mode, completing a checkout means POSTing the
// simulate-webhook body the checkout returned. With live Stripe this is replaced
// by the real hosted-checkout redirect; here it lets us test the purchase end to end.
export async function devCompleteCheckout(simulateBody) { return req("/payments/webhook", { method: "POST", body: simulateBody, auth: false }); }
export async function redeemCode(code) { return req("/player/redeem", { method: "POST", body: { code } }); }

// --- friends / karma / reports (Task #3) ---
export async function listFriends() { return req("/player/friends"); }                          // { friends: [{ id, name, avatar, border, mutual }] }
export async function addFriend(targetId) { return req("/player/friends", { method: "POST", body: { targetId } }); }
export async function removeFriend(targetId) { return req(`/player/friends/${targetId}`, { method: "DELETE" }); }
export async function giveKarma(matchId, targetId) { return req("/player/karma", { method: "POST", body: { matchId, targetId } }); }
export async function reportPlayer({ reportedId, reason, matchId, context, optInEmail }) {
  return req("/player/report", { method: "POST", body: { reportedId, reason, matchId, context, optInEmail } });
}

// --- admin tool (role-gated; only rendered for accounts with adminRole) ---
export async function adminCatalogue() { return req("/admintool/catalogue"); }
export async function adminListStore() { return req("/admintool/store"); }
export async function adminCreateStoreItem(item) { return req("/admintool/store/item", { method: "POST", body: item }); }
export async function adminUpdateStoreEntry(id, patch) { return req(`/admintool/store/${id}`, { method: "POST", body: patch }); }
export async function adminDeleteStoreEntry(id) { return req(`/admintool/store/${id}`, { method: "DELETE" }); }
export async function adminSearchUsers(q) { return req(`/admintool/users?q=${encodeURIComponent(q || "")}`); }
export async function adminGetUser(id) { return req(`/admintool/users/${id}`); }
// Audit trail (Task #24): recent admin cosmetic grant/remove/reverse actions for an account.
// Paginated (limit/offset) so the per-account export can gather the full history.
export async function adminUserAudit(id, { limit, offset } = {}) {
  const p = new URLSearchParams();
  if (limit != null) p.set("limit", String(limit));
  if (offset != null) p.set("offset", String(offset));
  const qs = p.toString();
  return req(`/admintool/users/${id}/audit${qs ? `?${qs}` : ""}`);
}
export async function adminGrant(id, body) { return req(`/admintool/users/${id}/grant`, { method: "POST", body }); }
export async function adminRemove(id, body) { return req(`/admintool/users/${id}/remove`, { method: "POST", body }); }
export async function adminSetBalance(id, currency, value) { return req(`/admintool/users/${id}/set-balance`, { method: "POST", body: { currency, value } }); }
export async function adminBan(id, body) { return req(`/admintool/users/${id}/ban`, { method: "POST", body }); }
export async function adminUnban(id) { return req(`/admintool/users/${id}/unban`, { method: "POST" }); }
export async function adminSilence(id, silenced) { return req(`/admintool/users/${id}/silence`, { method: "POST", body: { silenced } }); }
export async function adminListAdmins() { return req("/admintool/admins"); }
export async function adminSetRole(id, role) { return req(`/admintool/admins/${id}/role`, { method: "POST", body: { role } }); }
// Moderation tickets (Task #3): list (optionally by status) + resolve.
export async function adminListTickets(status) { return req(`/admintool/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`); }
export async function adminResolveTicket(id) { return req(`/admintool/tickets/${id}/resolve`, { method: "POST" }); }
// Payment reversals (Task #13): list (optionally by status + free-text query) + restore.
export async function adminListReversals({ status, query, from, to, limit, offset } = {}) {
  const p = new URLSearchParams();
  if (status && status !== "all") p.set("status", status);
  if (query) p.set("q", query);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (limit != null) p.set("limit", String(limit));
  if (offset != null) p.set("offset", String(offset));
  const qs = p.toString();
  return req(`/admintool/reversals${qs ? `?${qs}` : ""}`);
}
export async function adminRestoreReversal(sessionId) { return req(`/admintool/reversals/${sessionId}/restore`, { method: "POST" }); }
// Player segmentation (settings/cosmetic/activity filter search) + usage analytics.
export async function adminSegmentUsers(opts = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== "" && v != null) p.set(k, v);
  }
  const qs = p.toString();
  return req(`/admintool/segment${qs ? `?${qs}` : ""}`);
}
export async function adminUsageStats() { return req("/admintool/usage-stats"); }

// News authoring (6 fixed slots): list all tiles, save one, clear one.
export async function adminListNews() { return req("/admintool/news"); }                // { news:[{slot,...}] }
export async function adminSaveNews(slot, patch) { return req(`/admintool/news/${slot}`, { method: "POST", body: patch }); }
export async function adminClearNews(slot) { return req(`/admintool/news/${slot}`, { method: "DELETE" }); }
// Upload a banner image: ask the server for a presigned URL, PUT the bytes
// straight to storage, then return the object path to save as the tile banner.
export async function adminUploadNewsBanner(file) {
  const { uploadURL, objectPath } = await req("/admintool/news/upload-url", { method: "POST", body: { contentType: file.type } });
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath;
}

// --- i18n / localization ---
// Public: available locales + default, and the merged dictionary for one lang.
export async function fetchLocales() { return req("/i18n/meta", { auth: false }); }        // { locales:[{code,label,flag,source?}], default }
export async function fetchDict(lang) { return req(`/i18n/${encodeURIComponent(lang)}`, { auth: false }); } // { lang, dict:{key:string} }
// Player: persist the account's preferred UI language.
export async function setUserLanguage(language) { return req("/player/language", { method: "POST", body: { language } }); }
// Admin: the full string table + a single-cell save (key/lang/value).
export async function adminListI18n() { return req("/admintool/i18n"); }                    // { locales, translatable, rows:[{key,en,enOverride,humanEdited,<lang>...}] }
export async function adminSaveTranslation(key, lang, value) { return req("/admintool/i18n", { method: "POST", body: { key, lang, value } }); }
export async function adminAutoTranslate(lang, onlyMissing = true) { return req("/admintool/i18n/auto-translate", { method: "POST", body: { lang, onlyMissing } }); } // { lang, requested, translated, failed }

// Global admin-action feed (superadmin): all admin actions across every account,
// newest first, optionally filtered by acting admin and/or target account.
export async function adminListAllActions({ admin, target, limit, offset } = {}) {
  const p = new URLSearchParams();
  if (admin) p.set("admin", admin);
  if (target) p.set("target", target);
  if (limit != null) p.set("limit", String(limit));
  if (offset != null) p.set("offset", String(offset));
  const qs = p.toString();
  return req(`/admintool/actions${qs ? `?${qs}` : ""}`);
}
