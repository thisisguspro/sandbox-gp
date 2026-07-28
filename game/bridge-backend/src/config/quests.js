// ============================================================
// SANDBOX GP — daily quests.
//
// Three quests roll each UTC day from this pool, picked deterministically from
// the day index so every server agrees without coordination. Progress comes
// exclusively from server-reported match results (never client claims), and
// rewards pay out in Seashells (the CREDITS wallet).
//
// `stat` names map 1:1 to per-participant fields in /internal/match-result:
//   races (always +1) · wins · podiums (place ≤ 2) · splashesCaused ·
//   crumblesCaused · itemsUsed · challenges · sTiers
// ============================================================

export const QUEST_POOL = [
  { id: "races3",    label: "Beach day: finish 3 races",             stat: "races",          goal: 3, reward: 25 },
  { id: "win1",      label: "Top of the sandcastle: win a race",     stat: "wins",           goal: 1, reward: 40 },
  { id: "podium2",   label: "Podium regular: finish top-2 twice",    stat: "podiums",        goal: 2, reward: 35 },
  { id: "splash5",   label: "Make a splash: soak 5 racers",          stat: "splashesCaused", goal: 5, reward: 30 },
  { id: "crumble1",  label: "Demolition derby: crumble a rival",     stat: "crumblesCaused", goal: 1, reward: 35 },
  { id: "items6",    label: "Item spree: fire 6 items",              stat: "itemsUsed",      goal: 6, reward: 25 },
  { id: "chal4",     label: "Challenge runner: complete 4 challenges", stat: "challenges",   goal: 4, reward: 30 },
  { id: "stier1",    label: "Perfect form: earn an S-tier",          stat: "sTiers",         goal: 1, reward: 45 },
];

// Deterministic 3-of-pool pick for a given UTC day index.
export function questsForDay(dayIndex) {
  const picked = [];
  const pool = [...QUEST_POOL];
  let x = (dayIndex * 2654435761) >>> 0; // Knuth hash walk
  for (let i = 0; i < 3 && pool.length; i++) {
    x = (x ^ (x >>> 13)) * 1274126177 >>> 0;
    picked.push(pool.splice(x % pool.length, 1)[0]);
  }
  return picked;
}

// Login-streak Seashell payout: day 1 = 10, +5 per consecutive day, capped.
export function streakReward(count) {
  return Math.min(10 + 5 * (Math.max(1, count) - 1), 40);
}

export function utcDay(ts = Date.now()) {
  return Math.floor(ts / 86400000);
}
