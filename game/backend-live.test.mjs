#!/usr/bin/env node
/* SANDBOX GP — live backend test for the Sprint A/B surface:
 * guest auth, daily quests + streak credit, quest progress via the internal
 * match-result pipeline, claiming, the rank ladder, and the weekly lap board. */
const BASE = "http://localhost:8080";
const KEY = "dev-service-key";
// CG token verification: the server (CG_PUBLIC_KEY_FILE=/tmp/cg-test-pub.pem)
// verifies against our durable test fixture; put it in place before anything runs.
import { copyFileSync } from "node:fs";
copyFileSync("./test-keys/cg-test-public.pem", "/tmp/cg-test-pub.pem");
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const j = (r) => r.json();

console.log("\n\x1b[1mSANDBOX GP backend live test (quests/streak/progress/laps/guest)\x1b[0m");

// ---- guest auth ----
const guest = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "QuestKid" }) }).then(j);
(guest.token && guest.user?.name === "QuestKid") ? ok("guest sign-in issues a token") : no(`guest failed: ${JSON.stringify(guest).slice(0, 120)}`);
const H = { authorization: `Bearer ${guest.token}`, "content-type": "application/json" };
const uid = guest.user.id;

// ---- daily quests roll + streak credit ----
let daily = await fetch(`${BASE}/player/daily`, { headers: H }).then(j);
(daily.quests?.length === 3) ? ok(`3 daily quests rolled (${daily.quests.map((q) => q.id).join(", ")})`) : no(`quests: ${JSON.stringify(daily).slice(0, 140)}`);
(daily.streak?.count === 1 && daily.streak.todayReward >= 10) ? ok(`login streak day 1 pays ${daily.streak.todayReward} Seashells`) : no(`streak: ${JSON.stringify(daily.streak)}`);
const balAfterStreak = daily.balance;
(balAfterStreak >= 10) ? ok(`streak Seashells credited (balance ${balAfterStreak})`) : no(`balance ${balAfterStreak}`);

// ---- quest progress via the internal pipeline (server-authoritative) ----
// Synthesize one race result rich enough to progress every possible quest.
const participants = [{
  userId: uid, name: "QuestKid", role: "racer", won: true, place: 1,
  bestLapSec: 14.2, totalSec: 47.3, resets: 0,
  challenges: 4, sTiers: 1, itemsUsed: 6, crumbles: 0,
  splashesCaused: 5, crumblesCaused: 1,
}];
const ing = await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `t_${Date.now()}`, winner: uid, mode: "race", participants }),
}).then(j);
(ing.awarded?.[0]?.awarded > 0) ? ok(`match ingested, XP awarded (${ing.awarded[0].awarded})`) : no(`ingest: ${JSON.stringify(ing).slice(0, 140)}`);

daily = await fetch(`${BASE}/player/daily`, { headers: H }).then(j);
const completed = daily.quests.filter((q) => q.progress >= q.goal);
(completed.length >= 1) ? ok(`quest progress applied — ${completed.length}/3 complete after one loaded race`) : no(`progress: ${JSON.stringify(daily.quests)}`);

// ---- claim ----
if (completed.length) {
  const claim = await fetch(`${BASE}/player/daily/claim`, { method: "POST", headers: H, body: JSON.stringify({ questId: completed[0].id }) }).then(j);
  (claim.ok && claim.balance > balAfterStreak) ? ok(`claimed "${completed[0].id}" → +${claim.reward} Seashells (balance ${claim.balance})`) : no(`claim: ${JSON.stringify(claim)}`);
  const dup = await fetch(`${BASE}/player/daily/claim`, { method: "POST", headers: H, body: JSON.stringify({ questId: completed[0].id }) }).then(j);
  (dup.error) ? ok("double-claim rejected") : no("double-claim went through!");
}

// ---- rank ladder ----
const prog = await fetch(`${BASE}/player/progress`, { headers: H }).then(j);
(prog.level >= 1 && prog.next?.level > prog.level && prog.next.xpNeeded >= 0) ? ok(`ladder: LV ${prog.level}, next unlock at LV ${prog.next.level} (${prog.next.xpNeeded} XP away)`) : no(`progress: ${JSON.stringify(prog)}`);

// ---- time-trial → weekly lap board ----
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `tt_${Date.now()}`, winner: uid, mode: "timetrial", participants: [{ ...participants[0], bestLapSec: 13.37, totalSec: 44.4 }] }),
}).then(j);
const board = await fetch(`${BASE}/player/leaderboard/laps`, { headers: H }).then(j);
(board.you?.bestLapSec === 13.37) ? ok(`weekly lap board records the run (you: ${board.you.bestLapSec}s)`) : no(`board: ${JSON.stringify(board).slice(0, 160)}`);
(board.rows?.some((r) => r.userId === uid)) ? ok("run appears in the weekly top rows") : no("run missing from rows");

// faster lap replaces, slower lap doesn't
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `tt2_${Date.now()}`, winner: uid, mode: "timetrial", participants: [{ ...participants[0], bestLapSec: 15.0 }] }),
}).then(j);
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `tt3_${Date.now()}`, winner: uid, mode: "timetrial", participants: [{ ...participants[0], bestLapSec: 12.9 }] }),
}).then(j);
const board2 = await fetch(`${BASE}/player/leaderboard/laps`, { headers: H }).then(j);
(board2.you?.bestLapSec === 12.9) ? ok("board keeps only the fastest lap (12.9 beats 13.37, 15.0 ignored)") : no(`best: ${board2.you?.bestLapSec}`);

// ---- economy rules: place payouts, lap scaling, TT isolation ----
// fresh guest → place-3 finish on 3 laps pays exactly 5 Seashells
const g2 = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "EconKid" }) }).then(j);
const H2 = { authorization: `Bearer ${g2.token}`, "content-type": "application/json" };
const bal0 = (await fetch(`${BASE}/player/daily`, { headers: H2 }).then(j)).balance; // rolls streak too
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `e1_${Date.now()}`, mode: "race", laps: 3, participants: [{ userId: g2.user.id, name: "EconKid", won: false, place: 3, challenges: 0, sTiers: 0, itemsUsed: 0, splashesCaused: 0, crumblesCaused: 0 }] }),
}).then(j);
let w = await fetch(`${BASE}/player/daily`, { headers: H2 }).then(j);
(w.balance - bal0 === 5) ? ok(`place-3 race pays 5 Seashells (${bal0}→${w.balance})`) : no(`place pay: ${bal0}→${w.balance}`);

// 1-lap race pays a third (place 1: 12 → 4)
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `e2_${Date.now()}`, mode: "race", laps: 1, participants: [{ userId: g2.user.id, name: "EconKid", won: true, place: 1, challenges: 0, sTiers: 0, itemsUsed: 0, splashesCaused: 0, crumblesCaused: 0 }] }),
}).then(j);
const w2 = await fetch(`${BASE}/player/daily`, { headers: H2 }).then(j);
(w2.balance - w.balance === 4) ? ok("1-lap win pays a third (4 not 12) — short-race farming neutralized") : no(`lap scaling: +${w2.balance - w.balance}`);

// TT: flat 2 Seashells AND zero quest progress (arena-only quests)
const racesQ = w2.quests.find((q) => q.id === "races3");
const before = racesQ?.progress ?? null;
await fetch(`${BASE}/internal/match-result`, {
  method: "POST", headers: { "content-type": "application/json", "x-service-key": KEY },
  body: JSON.stringify({ matchId: `e3_${Date.now()}`, mode: "timetrial", laps: 3, participants: [{ userId: g2.user.id, name: "EconKid", won: true, place: 1, bestLapSec: 20, totalSec: 66 }] }),
}).then(j);
const w3 = await fetch(`${BASE}/player/daily`, { headers: H2 }).then(j);
(w3.balance - w2.balance === 2) ? ok("time trial pays flat 2 Seashells (no win bonus to farm)") : no(`tt pay: +${w3.balance - w2.balance}`);
const after = w3.quests.find((q) => q.id === "races3")?.progress ?? null;
(before === after) ? ok("time trial does NOT tick daily quests (arena-only)") : no(`tt leaked quest progress: ${before}→${after}`);

// ---- CrazyGames account integration (portal hard requirement) ----
{
  const { default: jwtLib } = await import("./bridge-backend/node_modules/jsonwebtoken/index.js");
  const { readFileSync } = await import("node:fs");
  const priv = readFileSync("./test-keys/cg-test-private.pem", "utf8");
  const cgTok = (payload, opts = {}) => jwtLib.sign(payload, priv, { algorithm: "RS256", expiresIn: "1h", ...opts });

  // new logged-in CG user → auto-registered + signed in
  const t1 = cgTok({ userId: "cg_user_777", gameId: "1", username: "RustyCake.ZU9H", profilePictureUrl: "x" });
  const r1 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t1 }) }).then(j);
  (r1.token && r1.user?.id) ? ok(`CG user auto-registered + signed in (${r1.user.name})`) : no(`cg login: ${JSON.stringify(r1).slice(0, 120)}`);

  // returning CG user (new device, fresh token) → SAME account
  const t2 = cgTok({ userId: "cg_user_777", gameId: "1", username: "RustyCake.ZU9H", profilePictureUrl: "x" });
  const r2 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t2 }) }).then(j);
  (r2.user?.id === r1.user?.id) ? ok("returning CG user lands in the SAME account (cross-device link)") : no(`link broke: ${r1.user?.id} vs ${r2.user?.id}`);

  // tampered signature → rejected
  const bad = t1.slice(0, -6) + "AAAAAA";
  const r3 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: bad }) });
  (r3.status === 401) ? ok("tampered CG token rejected (401)") : no(`tampered token got ${r3.status}`);

  // expired token → rejected
  const tExp = cgTok({ userId: "cg_user_777", gameId: "1", username: "X" }, { expiresIn: "-10s" });
  const r4 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tExp }) });
  (r4.status === 401) ? ok("expired CG token rejected (401)") : no(`expired token got ${r4.status}`);
}

// ---- CG auth: guest linking + forged-key rejection (fixture keypair, run-unique ids) ----
import { generateKeyPairSync, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
const _cgPriv = readFileSync("./test-keys/cg-test-private.pem", "utf8");
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const { default: _jwtLib } = await import("./bridge-backend/node_modules/jsonwebtoken/index.js");
const signCg = (payload) => _jwtLib.sign(payload, _cgPriv, { algorithm: "RS256", expiresIn: "1h" });
const RUN = Date.now().toString(36);

const cgTok = signCg({ userId: `cgUser_777_${RUN}`, gameId: "20267", username: "RustyCake.ZU9H", profilePictureUrl: "x" });
const cg1 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: cgTok }) }).then(j);
(cg1.token && cg1.user?.id) ? ok(`CG login auto-registers (user ${cg1.user.id}, name "${cg1.user.name}")`) : no(`cg login: ${JSON.stringify(cg1).slice(0, 120)}`);

const cg2 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: signCg({ userId: `cgUser_777_${RUN}`, gameId: "20267", username: "RustyCake.ZU9H" }) }) }).then(j);
(cg2.user?.id === cg1.user?.id) ? ok("returning CG user lands in the SAME account") : no(`returning: ${cg2.user?.id} vs ${cg1.user?.id}`);

// guest → CG link: the guest's bearer rides along, account gets relinked
const gl = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "LinkMe" }) }).then(j);
const cg3 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${gl.token}` }, body: JSON.stringify({ token: signCg({ userId: `cgUser_888_${RUN}`, gameId: "20267", username: "Linker.AB12" }) }) }).then(j);
(cg3.user?.id === gl.user?.id) ? ok("guest account LINKS to first CG login (progress rides along)") : no(`link: ${cg3.user?.id} vs guest ${gl.user?.id}`);

// CG identity priority: same CG user again WITHOUT bearer still hits the linked account
const cg4 = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: signCg({ userId: `cgUser_888_${RUN}`, gameId: "20267", username: "Linker.AB12" }) }) }).then(j);
(cg4.user?.id === gl.user?.id) ? ok("linked account persists for the CG identity") : no(`persist: ${cg4.user?.id}`);

// forged token (wrong key) rejected
const { privateKey: evil } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const forge = (() => { const h = b64u({ alg: "RS256", typ: "JWT" }); const b = b64u({ userId: `cgUser_777_${RUN}`, exp: Math.floor(Date.now() / 1000) + 3600 }); const s = createSign("RSA-SHA256"); s.update(`${h}.${b}`); return `${h}.${b}.${s.sign(evil).toString("base64url")}`; })();
const bad = await fetch(`${BASE}/auth/crazygames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: forge }) });
(bad.status === 401) ? ok("forged CG token rejected (401)") : no(`forged token got ${bad.status}`);

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
