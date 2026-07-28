// SANDBOX GP — ACHIEVEMENTS
//
// The rule this file exists to enforce: EVERY ACHIEVEMENT MUST BE REACHABLE.
//
// The old set had thirteen achievements all measuring three racing stats. Six
// new modes shipped with nothing recording them, so every mode achievement would
// have been permanently stuck at 0% — and to a player, an achievement that never
// moves doesn't look like a missing feature. It looks like a broken account.
//
// So: the metric must exist, the engine must emit it, and the store must ingest
// it. If any link in that chain is missing, the build fails here.
import { memoryStore as db } from "./bridge-backend/src/store/memory.js";
import {
  ACHIEVEMENTS, ACHIEVEMENT_CATS, TRACKED_STATS, AVATARS, BORDERS,
  evaluateAchievements, progressFor,
} from "./bridge-backend/src/config/achievements.js";
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { MODE_LIST } from "./bridge-gameserver/src/engine/modes.js";
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

// ---- the catalogue is coherent ----
{
  (ACHIEVEMENTS.length >= 50)
    ? ok(`${ACHIEVEMENTS.length} achievements (was 13)`)
    : no(`only ${ACHIEVEMENTS.length} achievements`);

  const ids = ACHIEVEMENTS.map((a) => a.id);
  const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  (dupes.length === 0) ? ok("no duplicate achievement ids") : no(`duplicates: ${dupes.join(", ")}`);

  // every category has achievements, and every achievement has a real category
  const cats = new Set(ACHIEVEMENT_CATS.map((c) => c.id));
  const orphans = ACHIEVEMENTS.filter((a) => !cats.has(a.cat));
  (orphans.length === 0)
    ? ok("every achievement has a real category")
    : no(`orphaned: ${orphans.map((a) => `${a.id}(${a.cat})`).join(", ")}`);

  const empty = ACHIEVEMENT_CATS.filter((c) => !ACHIEVEMENTS.some((a) => a.cat === c.id));
  (empty.length === 0)
    ? ok(`all ${ACHIEVEMENT_CATS.length} categories have achievements`)
    : no(`empty categories: ${empty.map((c) => c.id).join(", ")}`);
}

// ---- EVERY MODE HAS ITS OWN LADDER ----
{
  // Six modes shipped with zero achievements between them. Whatever you like
  // playing has to pay you, or the progression system is telling you your
  // favourite mode doesn't count.
  const modesWithout = [];
  for (const m of MODE_LIST) {
    const cat = m.id === "race" ? "race" : m.id;
    const n = ACHIEVEMENTS.filter((a) => a.cat === cat).length;
    if (n === 0) modesWithout.push(m.id);
  }
  (modesWithout.length === 0)
    ? ok(`all ${MODE_LIST.length} modes have their own achievements`)
    : no(`modes with NO achievements: ${modesWithout.join(", ")}`);
}

// ---- REACHABILITY: the metric must exist ----
{
  const unlisted = ACHIEVEMENTS.filter((a) => !TRACKED_STATS.includes(a.metric));
  (unlisted.length === 0)
    ? ok(`all ${ACHIEVEMENTS.length} achievements name a tracked stat`)
    : no(`UNREACHABLE — no such stat: ${unlisted.map((a) => `${a.id}(${a.metric})`).join(", ")}`);
}

// ---- REACHABILITY: the STORE must actually write the stat ----
{
  // Reading the store's source and checking each metric is written somewhere is
  // crude, but it catches the exact failure that motivated this file: an
  // achievement whose stat nothing ever increments.
  const store = fs.readFileSync("./bridge-backend/src/store/memory.js", "utf8");
  const never = [];
  for (const k of TRACKED_STATS) {
    // is there any assignment/increment to s.<k> or u.stats.<k>?
    const re = new RegExp(`(s|u\\.stats)\\.${k}\\s*(=|\\+=|\\+\\+)`);
    if (!re.test(store)) never.push(k);
  }
  (never.length === 0)
    ? ok(`the store writes all ${TRACKED_STATS.length} tracked stats`)
    : no(`stats nothing ever writes (so their achievements can NEVER unlock): ${never.join(", ")}`);
}

// ---- REACHABILITY: the ENGINE must emit the per-mode stats ----
{
  const engine = fs.readFileSync("./bridge-gameserver/src/engine/RaceEngine.js", "utf8");
  const modeFields = [
    "derbyKills", "flagCaptures", "flagGrabs", "flagReturns",
    "correctGuesses", "drawingsGuessed", "tagsMade", "pearls",
    "laps", "ultimatesFired", "krakenBest", "keyPads", "perfectLanes",
  ];
  const missing = modeFields.filter((f) => !engine.includes(`${f}:`));
  (missing.length === 0)
    ? ok("matchResult carries every per-mode stat the achievements need")
    : no(`the engine never reports: ${missing.join(", ")}`);
}

// ---- every reward is a real avatar/border ----
{
  const badRewards = [];
  for (const a of ACHIEVEMENTS) {
    if (a.reward?.avatar && !AVATARS[a.reward.avatar]) badRewards.push(`${a.id} → ${a.reward.avatar}`);
    if (a.reward?.border && !BORDERS[a.reward.border]) badRewards.push(`${a.id} → ${a.reward.border}`);
  }
  (badRewards.length === 0)
    ? ok("every achievement reward is a real avatar or border")
    : no(`rewards that don't exist: ${badRewards.join(", ")}`);
}

// ---- nothing from the old game survived ----
{
  const OLD = /saboteur|impostor|phantom|engineer|crew|hull|reactor|oxygen|task/i;
  const tainted = [
    ...ACHIEVEMENTS.filter((a) => OLD.test(a.name) || OLD.test(a.desc)).map((a) => `achievement:${a.id}`),
    ...Object.values(AVATARS).filter((a) => OLD.test(a.name)).map((a) => `avatar:${a.id}`),
    ...Object.values(BORDERS).filter((b) => OLD.test(b.name)).map((b) => `border:${b.id}`),
  ];
  (tainted.length === 0)
    ? ok("no saboteurs, impostors or reactors — this is a beach")
    : no(`leftovers from the social-deduction game: ${tainted.join(", ")}`);
}

// ---- a fresh account reads sane ----
{
  const u = await db.createUser({ googleId: `ach-${Date.now()}`, name: "Fresh" });
  const p = await db.getProfile(u.id);

  const nan = TRACKED_STATS.filter(
    (k) => !["bestPlace", "bestLapSec"].includes(k) && typeof p.stats[k] !== "number"
  );
  (nan.length === 0)
    ? ok("a new account has every stat seeded to a real number (no NaN progress bars)")
    : no(`unseeded stats: ${nan.join(", ")}`);

  (p.achievements.length === ACHIEVEMENTS.length)
    ? ok(`all ${ACHIEVEMENTS.length} achievements appear on the profile`)
    : no(`profile shows ${p.achievements.length} of ${ACHIEVEMENTS.length}`);

  const unlocked = p.achievements.filter((a) => a.unlockedAt).length;
  (unlocked === 0)
    ? ok("a new account has unlocked nothing (progress starts at zero)")
    : no(`a brand-new account already has ${unlocked} achievements`);
}

// ---- the ladder actually unlocks ----
{
  const u = await db.createUser({ googleId: `ach2-${Date.now()}`, name: "Winner" });
  const raw = await db.getUser(u.id);

  raw.stats.matchesPlayed = 1;
  let newly = evaluateAchievements(raw);
  (newly.some((a) => a.id === "first_race"))
    ? ok("finishing one match unlocks 'Toes in the Water'")
    : no("the first-match achievement never fired");

  // idempotent — an unlock is stamped once and never re-granted
  newly = evaluateAchievements(raw);
  (newly.length === 0)
    ? ok("achievements are idempotent (no double grants)")
    : no(`re-granted: ${newly.map((a) => a.id).join(", ")}`);

  // a mode achievement
  raw.stats.pearls = 1;
  newly = evaluateAchievements(raw);
  (newly.some((a) => a.id === "pearl_first"))
    ? ok("collecting a pearl unlocks 'First Pearl' — the mode ladders work")
    : no("the Pearl Rush achievement never fired");
}

// ---- and the whole chain, end to end: play a mode, earn the achievement ----
{
  const DT = 1 / 30;
  const e = new RaceEngine({ config: { seed: 5, mode: "pearl" } });
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push(e.addPlayer(`P${i}`, { userId: `pearl-u${i}`, isBot: true, botTier: "pilot" }));
  }
  e.start({ force: true });
  for (let s = 0; s < 30 && (e.startFreezeUntil - e.now) > 0; s += DT) e.tick(DT);
  for (let s = 0; s < 60; s += DT) e.tick(DT);

  const result = e.matchResult();
  const withPearls = result.participants.filter((p) => (p.pearls || 0) > 0);
  (withPearls.length > 0)
    ? ok(`end to end: a Pearl Rush match reports pearls in matchResult (${withPearls[0].pearls})`)
    : no("a Pearl Rush match reported NO pearls — the achievement can never unlock");

  (result.mode === "pearl" && typeof result.mode === "string")
    ? ok("matchResult reports exactly one `mode` field (there used to be two, and the second silently won)")
    : no(`matchResult.mode is ${JSON.stringify(result.mode)}`);
}

// ---- THE WEEKLY TIME-ATTACK COMPETITION ----
{
  // The competition runs ALL WEEK: unlimited attempts, only your best time on
  // each map is kept, and the top 3% are paid when the week turns over. Paying
  // the instant you cross the line would mean the first person to post a decent
  // lap on a quiet board gets paid and nobody can take it off them.
  const { weekKey } = await import("./bridge-backend/src/config/achievements.js");
  const WK = weekKey();
  const stamp = Date.now();

  for (let i = 0; i < 40; i++) {
    const u = await db.createUser({ googleId: `wk-${stamp}-${i}`, name: `R${i}` });
    await db.ingestMatchResult({
      map: { id: "sandcastle", name: "S" }, mode: "timeattack", laps: 1,
      participants: [{ userId: u.id, name: `R${i}`, won: true, place: 1, bestLapSec: 50 + i }],
    });
  }

  const ace = await db.createUser({ googleId: `wk-ace-${stamp}`, name: "Ace" });
  await db.ingestMatchResult({
    map: { id: "sandcastle", name: "S" }, mode: "timeattack", laps: 1,
    participants: [{ userId: ace.id, name: "Ace", won: true, place: 1, bestLapSec: 70 }],
  });
  const midweek = (await db.getProfile(ace.id)).balances.CREDITS;

  // UNLIMITED ATTEMPTS — run it again and improve
  await db.ingestMatchResult({
    map: { id: "sandcastle", name: "S" }, mode: "timeattack", laps: 1,
    participants: [{ userId: ace.id, name: "Ace", won: true, place: 1, bestLapSec: 44.5 }],
  });
  const board = await db.getLapBoard("sandcastle", WK);
  const mine = board.boards.sandcastle.find((e) => e.userId === String(ace.id));

  (mine && mine.lapSec === 44.5)
    ? ok("weekly board: unlimited attempts, and it keeps your BEST time (70s → 44.5s)")
    : no(`the board kept ${mine?.lapSec}s, not the best lap`);

  // Finishing ANY match pays a small ordinary reward — that's not the prize. What
  // must NOT happen is an elite payout landing before the week is over.
  const midRun = await db.ingestMatchResult({
    map: { id: "sandcastle", name: "S" }, mode: "timeattack", laps: 1,
    participants: [{ userId: ace.id, name: "Ace", won: true, place: 1, bestLapSec: 44.0 }],
  });
  ((midRun || []).every((x) => x.kind !== "elite_prize"))
    ? ok("weekly board: no elite prize mid-week — the competition has to finish first")
    : no("an elite prize paid out before the week ended");

  (mine.rank === 1 && mine.elite === true)
    ? ok(`weekly board: you can see where you stand (rank ${mine.rank}, in the top 3%)`)
    : no(`rank/elite flags wrong: ${JSON.stringify(mine)}`);

  const cut = board.boards.sandcastle.filter((e) => e.elite).length;
  (cut === Math.max(1, Math.ceil(board.boards.sandcastle.length * 0.03)))
    ? ok(`weekly board: the cut line is visible (top ${cut} of ${board.boards.sandcastle.length})`)
    : no("the top-3% cut isn't marked on the board");

  // SETTLE THE WEEK
  const before = (await db.getProfile(ace.id)).balances.CREDITS;
  const paid = await db.settleTimeAttackWeek(WK);
  const after = (await db.getProfile(ace.id)).balances.CREDITS;

  (paid.length > 0 && after > before)
    ? ok(`week settled: the top 3% are paid (${paid.length} payouts, 1st = ${paid.find((p) => p.rank === 1)?.glass} sea glass)`)
    : no("settling the week paid nobody");

  const again = await db.settleTimeAttackWeek(WK);
  (again.length === 0)
    ? ok("a week is settled ONCE — no double payouts")
    : no(`settling twice paid ${again.length} more times`);

  (paid.find((p) => p.rank === 1)?.glass > paid.find((p) => p.rank === 2)?.glass)
    ? ok("1st on a map is worth more than 2nd — the top of the board still matters")
    : no("a flat prize makes the top of the leaderboard pointless");
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
