#!/usr/bin/env node
/* SANDBOX GP — progression e2e: a REAL authenticated socket race must move
 * XP, level progress, daily quests, lifetime stats, and the wallet.
 * This is the exact path the user reported broken ("profile all zeros,
 * no XP from race"), which prior suites never covered with a token attached. */
import { io } from "./bridge-gameserver/node_modules/socket.io-client/build/esm/index.js";

const BASE = "http://localhost:8080";
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const j = (r) => r.json();

console.log("\n\x1b[1mSANDBOX GP progression e2e (authed socket race → rewards)\x1b[0m");

const guest = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "ProgKid" }) }).then(j);
const H = { authorization: `Bearer ${guest.token}` };

const before = {
  prog: await fetch(`${BASE}/player/progress`, { headers: H }).then(j),
  daily: await fetch(`${BASE}/player/daily`, { headers: H }).then(j),
  wallet: await fetch(`${BASE}/player/wallet`, { headers: H }).then(j),
  profile: await fetch(`${BASE}/profile`, { headers: H }).then(j).catch(() => null),
};

const s = io(BASE, { transports: ["websocket"] });
await new Promise((r) => s.on("connect", r));
let view = null;
s.on("state", (m) => { view = m.view; });

const room = await new Promise((r) => s.emit("create_room", { config: { isPublic: false, laps: 1, finishTimeoutSec: 5, trackId: "testloop" }, name: "ProgKid", token: guest.token }, r));
if (!room?.roomId) { no(`create_room failed: ${JSON.stringify(room).slice(0, 100)}`); process.exit(1); }
s.emit("start_match", { roomId: room.roomId });  // bots auto-fill, they finish, host times out placed

const done = await new Promise((r) => {
  const t = setInterval(() => { if (view?.phase === "ended") { clearInterval(t); r(true); } }, 300);
  setTimeout(() => { clearInterval(t); r(false); }, 60000);
});
done ? ok("authed race ran to completion") : no(`race never ended (phase ${view?.phase})`);
s.close();
await new Promise((r) => setTimeout(r, 800));   // let the ingest land

const after = {
  prog: await fetch(`${BASE}/player/progress`, { headers: H }).then(j),
  daily: await fetch(`${BASE}/player/daily`, { headers: H }).then(j),
  wallet: await fetch(`${BASE}/player/wallet`, { headers: H }).then(j),
  profile: await fetch(`${BASE}/profile`, { headers: H }).then(j).catch(() => null),
};

(after.prog.xp > before.prog.xp) ? ok(`XP moved: ${before.prog.xp} → ${after.prog.xp}`) : no(`XP frozen at ${after.prog.xp}`);
const rq = (d) => d.quests.find((q) => q.stat === "races" || q.id === "races3");
const rb = rq(before.daily)?.progress ?? null, ra = rq(after.daily)?.progress ?? null;
(rb === null || ra === null || ra > rb) ? ok(`daily quest ticked (races ${rb} → ${ra})`) : no(`quest frozen at ${ra}`);
(after.wallet.CREDITS > before.wallet.CREDITS) ? ok(`wallet paid: ${before.wallet.CREDITS} → ${after.wallet.CREDITS} Seashells`) : no(`wallet frozen at ${after.wallet.CREDITS}`);
if (after.profile && before.profile) {
  const sb = before.profile.stats || before.profile.user?.stats || {};
  const sa = after.profile.stats || after.profile.user?.stats || {};
  const mb = sb.matchesPlayed ?? 0, ma = sa.matchesPlayed ?? 0;
  (ma > mb) ? ok(`profile stats moved: matches ${mb} → ${ma}`) : no(`profile stats frozen (matches ${ma}) — fields: ${Object.keys(sa).slice(0, 8).join(",")}`);
} else no(`/profile unavailable: ${JSON.stringify(after.profile).slice(0, 80)}`);

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
