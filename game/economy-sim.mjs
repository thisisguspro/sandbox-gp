#!/usr/bin/env node
/* SANDBOX GP — economy pacing simulation.
 *
 * Models new players from match 1 and reports how many matches it takes to
 * AFFORD each CREDITS tier, verifying the design targets:
 *   Common 500  ≈ 30 matches   ·   Rare 700 ≈ 40   ·   Epic 900 ≈ 50
 *
 * Income model (mirrors ingestMatchResult exactly):
 *  - place payout [12,8,5,3] per 3-lap race (lapsFactor 1)
 *  - daily quests: 3/day from the real pool, completed realistically over the
 *    day's matches (races3/win1/podium2 driven by simulated results; stat
 *    quests approximated by per-match event rates), rewards 25–45
 *  - login streak: 10 + 5/day, capped 40
 *  - matches/day varies by player (5–15)
 * Skill spread: each player has a placement bias (better players podium more).
 * Seeded RNG → deterministic run.
 */
import { QUEST_POOL, questsForDay, streakReward } from "./bridge-backend/src/config/quests.js";

const PRICES = { Common: 500, Rare: 700, Epic: 900 };
const PLACE_PAY = [12, 8, 5, 3];
let seed = 1337;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// place distribution by skill s ∈ [0,1]: EV place from ~3.0 (weak) to ~1.8 (strong)
function rollPlace(s) {
  const w = [1 + 2.4 * s, 1 + 0.8 * s, 1.3 - 0.5 * s, 1.5 - 1.1 * s].map((x) => Math.max(0.08, x));
  const t = w.reduce((a, b) => a + b, 0);
  let r = rand() * t;
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 4;
}

// per-match event rates for stat quests (splashes an average racer causes, etc.)
const RATES = { splashesCaused: 1.6, crumblesCaused: 0.35, itemsUsed: 3.2, challenges: 1.5, sTiers: 0.18 };

function simPlayer(pIdx) {
  const skill = rand();                       // fixed talent
  const perDay = 5 + Math.floor(rand() * 11); // 5–15 matches/day
  let credits = 0, matches = 0, day = 0;
  const afford = {};
  const spentAt = (tier) => { if (!(tier in afford) && credits >= PRICES[tier]) afford[tier] = matches; };

  while (matches < 200 && !("Epic" in afford)) {
    day++;
    credits += streakReward(Math.min(day, 7));
    const quests = questsForDay(20645 + day).map((q) => ({ ...q, prog: 0, done: false }));
    for (let m = 0; m < perDay; m++) {
      matches++;
      const place = rollPlace(skill);
      credits += PLACE_PAY[place - 1];
      // quest progress
      for (const q of quests) {
        if (q.done) continue;
        let inc = 0;
        if (q.stat === "races") inc = 1;
        else if (q.stat === "wins") inc = place === 1 ? 1 : 0;
        else if (q.stat === "podiums") inc = place <= 2 ? 1 : 0;
        else inc = Math.floor(RATES[q.stat] || 0) + (rand() < ((RATES[q.stat] || 0) % 1) ? 1 : 0);
        q.prog += inc;
        if (q.prog >= q.goal) { q.done = true; credits += q.reward; }
      }
      spentAt("Common"); spentAt("Rare"); spentAt("Epic");
      if ("Epic" in afford) break;
    }
  }
  return afford;
}

const N = 400;
const rows = Array.from({ length: N }, (_, i) => simPlayer(i));
function pct(tier, p) {
  const v = rows.map((r) => r[tier] ?? 999).sort((a, b) => a - b);
  return v[Math.floor((p / 100) * (v.length - 1))];
}
console.log("\n\x1b[1mSANDBOX GP economy pacing (400 simulated players)\x1b[0m");
console.log("  tier     price   P25   P50   P75   target");
for (const [tier, target] of [["Common", 30], ["Rare", 40], ["Epic", 50]]) {
  console.log(`  ${tier.padEnd(8)} ${String(PRICES[tier]).padEnd(6)} ${String(pct(tier, 25)).padEnd(5)} ${String(pct(tier, 50)).padEnd(5)} ${String(pct(tier, 75)).padEnd(5)} ~${target}`);
}
const p50 = { c: pct("Common", 50), r: pct("Rare", 50), e: pct("Epic", 50) };
const okC = p50.c >= 20 && p50.c <= 38, okR = p50.r >= 30 && p50.r <= 50, okE = p50.e >= 40 && p50.e <= 62;
const gaps = p50.r - p50.c >= 6 && p50.e - p50.r >= 6;
console.log(`\n  ${okC && okR && okE && gaps ? "\x1b[32m✓ PACING WITHIN TARGETS\x1b[0m" : "\x1b[31m✗ PACING OFF TARGET\x1b[0m"} (P50 ${p50.c}/${p50.r}/${p50.e}, tier gaps ${p50.r - p50.c}/${p50.e - p50.r} matches)`);
process.exit(okC && okR && okE && gaps ? 0 : 1);
