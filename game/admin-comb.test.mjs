#!/usr/bin/env node
/* SANDBOX GP — ADMIN COMB. Walks every admin function against the live server
 * as a real superadmin and asserts actual effects (not just 200s): grants land
 * in wallets, bans block, news round-trips, store edits stick, events toggle,
 * i18n saves, audit trails record. This is the "fine calm comb" for #14. */
const BASE = "http://localhost:8080";
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const j = (r) => r.json();

console.log("\n\x1b[1mSANDBOX GP admin comb (every function, real effects)\x1b[0m");
const RUN = Date.now().toString(36);

// superadmin via the production claim path (also re-verifies it)
const adminAcct = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "CombAdmin" }) }).then(j);
await fetch(`${BASE}/admintool/claim`, { method: "POST", headers: { authorization: `Bearer ${adminAcct.token}`, "content-type": "application/json" }, body: JSON.stringify({ key: "test-admin-key" }) });
const A = { authorization: `Bearer ${adminAcct.token}`, "content-type": "application/json" };
const me = await fetch(`${BASE}/admintool/me`, { headers: A }).then(j);
(me.role === "superadmin") ? ok("claim → superadmin (prod bootstrap path)") : no(`role: ${JSON.stringify(me)}`);

// a citizen to act on
const cit = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Citizen" }) }).then(j);
const C = { authorization: `Bearer ${cit.token}` };
const cid = cit.user.id;

const get = (p, H = A) => fetch(`${BASE}${p}`, { headers: H }).then(j);
const post = (p, body, H = A) => fetch(`${BASE}${p}`, { method: "POST", headers: H, body: JSON.stringify(body) });

// ---- users: list, detail, segment, audit ----
const users = await get(`/admintool/users?q=Citizen`);
(Array.isArray(users.results) && users.results.some((u) => u.id === cid)) ? ok("users: search finds accounts") : no(`users: ${JSON.stringify(users).slice(0, 90)}`);
const detail = await get(`/admintool/users/${cid}`);
(detail.user?.id === cid && detail.user.balances) ? ok("users: detail view (balances, profile)") : no(`detail: ${JSON.stringify(detail).slice(0, 90)}`);

// ---- grant / remove / set-balance (wallet must actually move) ----
const bal0 = (await get(`/player/wallet`, C)).CREDITS;
let r = await post(`/admintool/users/${cid}/grant`, { kind: "currency", currency: "CREDITS", amount: 111, reason: "comb" });
const bal1 = (await get(`/player/wallet`, C)).CREDITS;
(r.ok && bal1 === bal0 + 111) ? ok(`grant currency lands (+111 → ${bal1})`) : no(`grant: http ${r.status}, ${bal0}→${bal1}`);
r = await post(`/admintool/users/${cid}/set-balance`, { currency: "CREDITS", value: 500, reason: "comb" });
const bal2 = (await get(`/player/wallet`, C)).CREDITS;
(r.ok && bal2 === 500) ? ok("set-balance overrides exactly (500)") : no(`set-balance: ${bal2}`);
const cat = await get(`/admintool/catalogue`);
const _cos = cat.cosmetics || cat.COSMETICS || [];
const allIds = Array.isArray(_cos) ? _cos.map((c) => c.id) : Object.keys(_cos);
const ownedNow = new Set(((await get(`/profile`, C)).owned || []).map((o) => o.id || o));
const cosId = allIds.find((id) => !ownedNow.has(id));
r = await post(`/admintool/users/${cid}/grant`, { cosmeticId: cosId, reason: "comb" });
const prof1 = await get(`/profile`, C);
(r.ok && (prof1.owned || []).some((o) => (o.id || o) === cosId)) ? ok(`grant cosmetic lands in locker (${cosId})`) : no(`cosmetic grant: http ${r.status} id ${cosId}`);
r = await post(`/admintool/users/${cid}/remove`, { cosmeticId: cosId, reason: "comb" });
const prof2 = await get(`/profile`, C);
(r.ok && !(prof2.owned || []).some((o) => (o.id || o) === cosId)) ? ok("remove cosmetic takes it back") : no("remove failed");

// ---- ban / unban / silence (effects must bite) ----
r = await post(`/admintool/users/${cid}/ban`, { durationMs: 5 * 60000, reason: "comb" });
const bannedTry = await fetch(`${BASE}/auth/me`, { headers: C });
(r.ok && bannedTry.status === 403) ? ok("ban blocks the account (403 on /auth/me)") : no(`ban: http ${r.status}, me ${bannedTry.status}`);
r = await post(`/admintool/users/${cid}/unban`, {});
const unbanned = await fetch(`${BASE}/auth/me`, { headers: C });
(r.ok && unbanned.status === 200) ? ok("unban restores access") : no(`unban: ${unbanned.status}`);
r = await post(`/admintool/users/${cid}/silence`, { minutes: 10, reason: "comb" });
(r.ok) ? ok("silence sets (chat mute)") : no(`silence: ${r.status}`);

// ---- audit + global actions log record the above ----
const audit = await get(`/admintool/users/${cid}/audit`);
(audit.actions?.length >= 4) ? ok(`audit trail recorded (${audit.actions.length} entries)`) : no(`audit: ${JSON.stringify(audit).slice(0, 80)}`);
const actions = await get(`/admintool/actions`);
const actRows = actions.actions || actions.rows || actions.items || [];
(actRows.length >= 5) ? ok(`global admin actions log populated (${actRows.length})`) : no(`actions log: ${JSON.stringify(actions).slice(0, 70)}`);

// ---- store: list, edit item, toggle ----
const store = await get(`/admintool/store`);
const item = store.items?.[0];
item ? ok(`store: lists ${store.items.length} items`) : no("store list empty");
if (item) {
  r = await post(`/admintool/store/${item.id}`, { price: item.price, enabled: false });
  const store2 = await get(`/admintool/store`);
  const now = store2.items.find((x) => x.id === item.id);
  (r.ok && now.enabled === false) ? ok("store: item toggle sticks") : no(`toggle: ${JSON.stringify(now).slice(0, 60)}`);
  await post(`/admintool/store/${item.id}`, { price: item.price, enabled: true });
}

// ---- boxes (chest odds) ----
const boxes = await get(`/admin/boxes`);
const box = boxes.boxes?.[0];
box ? ok(`boxes: lists ${boxes.boxes.length} chests`) : no("boxes empty");

// ---- codes: create + a citizen redeems ----
const codeStr = `COMB${Date.now() % 100000}`;
r = await post(`/admin/codes`, { code: codeStr, currency: "CREDITS", amount: 25 });
if (r.ok) {
  const balA = (await get(`/player/wallet`, C)).CREDITS;
  const redeem = await post(`/player/redeem`, { code: codeStr }, { ...C, "content-type": "application/json" });
  const balB = (await get(`/player/wallet`, C)).CREDITS;
  (redeem.ok && balB === balA + 25) ? ok(`codes: create + redeem pays (+25 → ${balB})`) : no(`redeem http ${redeem.status}, ${balA}→${balB}`);
} else no(`code create: http ${r.status}`);

// ---- news round-trip ----
r = await post(`/admintool/news/1`, { title: "Comb News", body: "Testing the wire.", status: "published" });
const news = await get(`/admintool/news`);
(r.ok && JSON.stringify(news).includes("Comb News")) ? ok("news: set + read back") : no(`news: http ${r.status}`);

// ---- i18n editor round-trip ----
r = await post(`/admintool/i18n`, { lang: "en", key: "signin.tagline", value: "hello comb" });
const i18n = await get(`/admintool/i18n?lang=en`);
(r.ok && JSON.stringify(i18n).includes("hello comb")) ? ok("i18n: save + read back") : no(`i18n: http ${r.status}`);

// ---- events: create, toggle, flag ----
r = await post(`/admintool/events`, { name: `Comb ${RUN}`, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() });
const evs = await get(`/admintool/events`);
const ev = (evs.events || []).find((e) => e.name === `Comb ${RUN}`);
ev ? ok("events: create + list") : no(`events: http ${r.status} :: ${JSON.stringify(evs).slice(0, 80)}`);
if (ev) {
  const fr = await post(`/admintool/events/${ev.id}/flag`, { userId: cid, flag: "EVENT_HOST" });
  const flags = await get(`/admintool/events/${ev.id}/flags`);
  (fr.ok && JSON.stringify(flags).includes("EVENT_HOST")) ? ok("events: per-player flag sets (EVENT_HOST)") : no(`flag: ${fr.status} :: ${JSON.stringify(flags).slice(0, 70)}`);
}

// ---- admins management + tickets + usage ----
const admins = await get(`/admintool/admins`);
(admins.admins?.some((a) => a.id === adminAcct.user.id)) ? ok("admins: roster lists the claimer") : no("admins roster");
const tickets = await get(`/admintool/tickets`);
(Array.isArray(tickets.tickets)) ? ok(`tickets: endpoint alive (${tickets.tickets.length})`) : no("tickets");
const usage = await get(`/admintool/usage-stats`);
(usage && typeof usage === "object" && !usage.error) ? ok("usage-stats responds") : no(`usage: ${JSON.stringify(usage).slice(0, 80)}`);
const seg = await get(`/admintool/segment?minMatches=0`);
(!seg.error) ? ok("segment query responds") : no(`segment: ${JSON.stringify(seg).slice(0, 80)}`);
const rev = await get(`/admintool/reversals`);
(!rev.error) ? ok("reversals list responds") : no("reversals");

// ---- teardown: the comb must leave NO live state behind ----
// (with persistence on, anything we forget here haunts every future boot:
// an active test event warps the shop, a test tagline ships to players)
if (ev) await post(`/admintool/events/${ev.id}`, { endsAt: new Date(Date.now() - 1000).toISOString(), enabled: false });
await post(`/admintool/i18n`, { lang: "en", key: "signin.tagline", value: "3-Minute Beach Kart Mayhem" });
await post(`/admintool/news/1`, { title: "", body: "", status: "draft" });
const evsAfter = await get(`/admintool/events`);
const stillLive = (evsAfter.events || []).some((e) => e.name === `Comb ${RUN}` && e.enabled !== false && new Date(e.endsAt) > new Date());
(!stillLive) ? ok("teardown: comb event ended + disabled") : no("teardown: comb event still live");
const tag = await get(`/admintool/i18n?lang=en`);
(JSON.stringify(tag).includes("3-Minute Beach Kart Mayhem")) ? ok("teardown: tagline restored") : no("teardown: tagline still edited");

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
