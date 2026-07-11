// Profile meta: achievement catalogue + the avatar/border reward pools they grant,
// plus the helpers that evaluate progress and the ISO-week bucket key the weekly
// ranking uses. All pure data + functions — the store imports these and applies
// the grants. Art is optional: the client renders the `glyph` fallback when no
// `public/items/<id>.png` exists, exactly like cosmetics.

// ----- avatars (profile picture) -----
export const DEFAULT_AVATAR = "avatar_rookie";
export const AVATARS = {
  avatar_rookie:   { id: "avatar_rookie",   name: "Rookie",    glyph: "R", rarity: "Common" },
  avatar_veteran:  { id: "avatar_veteran",  name: "Veteran",   glyph: "V", rarity: "Rare" },
  avatar_ace:      { id: "avatar_ace",      name: "Ace Pilot", glyph: "A", rarity: "Rare" },
  avatar_engineer: { id: "avatar_engineer", name: "Engineer",  glyph: "E", rarity: "Rare" },
  avatar_survivor: { id: "avatar_survivor", name: "Survivor",  glyph: "S", rarity: "Rare" },
  avatar_phantom:  { id: "avatar_phantom",  name: "Phantom",   glyph: "P", rarity: "Epic" },
  avatar_saboteur: { id: "avatar_saboteur", name: "Saboteur",  glyph: "S", rarity: "Epic" },
  avatar_hunter:   { id: "avatar_hunter",   name: "Hunter",    glyph: "H", rarity: "Epic" },
  avatar_legend:   { id: "avatar_legend",   name: "Legend",    glyph: "L", rarity: "Legendary" },
};

// ----- profile borders (ring drawn around the avatar) -----
export const DEFAULT_BORDER = "border_plain";
export const BORDERS = {
  border_plain:   { id: "border_plain",   name: "Standard Frame", glyph: "S", color: "#7a8a9a", rarity: "Common" },
  border_bronze:  { id: "border_bronze",  name: "Bronze Frame",   glyph: "B", color: "#cd7f32", rarity: "Common" },
  border_silver:  { id: "border_silver",  name: "Silver Frame",   glyph: "S", color: "#c8d0d8", rarity: "Rare" },
  border_gold:    { id: "border_gold",    name: "Gold Frame",     glyph: "G", color: "#ffc83d", rarity: "Epic" },
  border_crimson: { id: "border_crimson", name: "Crimson Frame",  glyph: "C", color: "#ff2d4d", rarity: "Epic" },
  border_nova:    { id: "border_nova",    name: "Nova Frame",     glyph: "N", color: "#00f0ff", rarity: "Legendary" },
};

// ----- achievements -----
// `metric` is a key on user.stats; an achievement unlocks the first time that
// stat reaches `threshold`. Each grants an avatar and/or a border. Evaluation is
// idempotent: once unlockedAt is stamped it is never re-granted.
export const ACHIEVEMENTS = [
  { id: "first_blood",     name: "First Victory",    desc: "Win your first match.",          glyph: "F", metric: "wins",           threshold: 1,   reward: { border: "border_bronze" } },
  { id: "veteran_10",      name: "Seasoned",         desc: "Play 10 matches.",               glyph: "S", metric: "matchesPlayed",  threshold: 10,  reward: { avatar: "avatar_veteran" } },
  { id: "crew_savior",     name: "Crew Savior",      desc: "Win 15 matches as crew.",        glyph: "C", metric: "winsAsCrew",     threshold: 15,  reward: { avatar: "avatar_ace" } },
  { id: "master_deceiver", name: "Master Deceiver",  desc: "Win 15 matches as impostor.",    glyph: "M", metric: "winsAsImpostor", threshold: 15,  reward: { avatar: "avatar_phantom" } },
  { id: "win_25",          name: "Decorated",        desc: "Win 25 matches.",                glyph: "D", metric: "wins",           threshold: 25,  reward: { border: "border_gold" } },
  { id: "centurion",       name: "Centurion",        desc: "Play 50 matches.",               glyph: "C", metric: "matchesPlayed",  threshold: 50,  reward: { border: "border_silver" } },
  { id: "taskmaster",      name: "Taskmaster",       desc: "Complete 100 tasks.",            glyph: "T", metric: "tasksCompleted", threshold: 100, reward: { avatar: "avatar_engineer" } },
  { id: "chaos_agent",     name: "Chaos Agent",      desc: "Trigger 30 sabotages.",          glyph: "C", metric: "sabotages",      threshold: 30,  reward: { avatar: "avatar_saboteur" } },
  { id: "apex_hunter",     name: "Apex Hunter",      desc: "Take down 25 pilots.",           glyph: "A", metric: "impostorKills",  threshold: 25,  reward: { avatar: "avatar_hunter" } },
  { id: "survivor",        name: "Last One Standing",desc: "Survive 20 matches to the end.", glyph: "L", metric: "ejections",      threshold: 20,  reward: { avatar: "avatar_survivor" } },
  { id: "hot_streak",      name: "Hot Streak",       desc: "Win 5 matches in a row.",        glyph: "H", metric: "bestWinStreak",  threshold: 5,   reward: { border: "border_crimson" } },
  { id: "legend",          name: "Living Legend",    desc: "Win 100 matches.",               glyph: "L", metric: "wins",           threshold: 100, reward: { avatar: "avatar_legend", border: "border_nova" } },
];

// Current value of an achievement's metric for a user, capped at the threshold
// (so a progress bar never exceeds 100%).
export function progressFor(u, ach) {
  const v = (u.stats && u.stats[ach.metric]) || 0;
  return Math.min(ach.threshold, v);
}

// Stamp + return any achievements that just crossed their threshold. Mutates
// u.achievements only; the caller applies the avatar/border grants so the store
// stays the single owner of inventory writes.
export function evaluateAchievements(u) {
  if (!u.achievements || typeof u.achievements !== "object") u.achievements = {};
  const newly = [];
  for (const ach of ACHIEVEMENTS) {
    const done = progressFor(u, ach) >= ach.threshold;
    if (done && !u.achievements[ach.id]?.unlockedAt) {
      u.achievements[ach.id] = { unlockedAt: new Date().toISOString() };
      newly.push(ach);
    }
  }
  return newly;
}

// ISO-8601 week bucket, e.g. "2026-W26". Weekly rankings reset when this changes.
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
