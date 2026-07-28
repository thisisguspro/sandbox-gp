// ============================================================================
// SANDBOX GP — ACHIEVEMENTS, AVATARS, BORDERS
//
// Rewritten. What was here came from the social-deduction game this was forked
// from: avatars called Saboteur, Phantom and Engineer, and thirteen achievements
// that between them measured about three racing stats. Six new modes now exist
// and had ZERO achievements.
//
// The rules I held to:
//   • Every achievement must be REACHABLE — its metric has to be a stat the
//     engine really records. An achievement nobody can earn doesn't look like a
//     missing feature, it looks like a broken account. There's a test that fails
//     the build if one names a stat nothing ever writes.
//   • Every mode gets its own ladder, so whatever you enjoy playing pays you.
//   • Nothing rewards behaviour that makes the game worse. No "spend money",
//     no "quit 50 matches", nothing that pays you for griefing.
//   • The names are beach and racing. There are no saboteurs on a beach.
// ============================================================================

// ----- avatars (profile picture) -----
export const DEFAULT_AVATAR = "avatar_rookie";
export const AVATARS = {
  avatar_rookie:    { id: "avatar_rookie",    name: "Rookie",        glyph: "R", rarity: "Common" },
  avatar_regular:   { id: "avatar_regular",   name: "Beach Regular", glyph: "B", rarity: "Common" },
  avatar_lifeguard: { id: "avatar_lifeguard", name: "Lifeguard",     glyph: "L", rarity: "Rare" },
  avatar_surfer:    { id: "avatar_surfer",    name: "Surfer",        glyph: "S", rarity: "Rare" },
  avatar_wrecker:   { id: "avatar_wrecker",   name: "Wrecker",       glyph: "W", rarity: "Rare" },
  avatar_artist:    { id: "avatar_artist",    name: "Sand Artist",   glyph: "A", rarity: "Rare" },
  avatar_diver:     { id: "avatar_diver",     name: "Pearl Diver",   glyph: "P", rarity: "Rare" },
  avatar_courier:   { id: "avatar_courier",   name: "Flag Courier",  glyph: "F", rarity: "Epic" },
  avatar_shark:     { id: "avatar_shark",     name: "The Shark",     glyph: "S", rarity: "Epic" },
  avatar_kraken:    { id: "avatar_kraken",    name: "Kraken",        glyph: "K", rarity: "Epic" },
  avatar_ghost:     { id: "avatar_ghost",     name: "Ghost Racer",   glyph: "G", rarity: "Epic" },
  avatar_champion:  { id: "avatar_champion",  name: "Champion",      glyph: "C", rarity: "Legendary" },
  avatar_legend:    { id: "avatar_legend",    name: "Living Legend", glyph: "L", rarity: "Legendary" },
};

// ----- profile borders -----
export const DEFAULT_BORDER = "border_plain";
export const BORDERS = {
  border_plain:    { id: "border_plain",    name: "Driftwood",    glyph: "D", color: "#9a8266", rarity: "Common" },
  border_bronze:   { id: "border_bronze",   name: "Bronze Shell", glyph: "B", color: "#cd7f32", rarity: "Common" },
  border_silver:   { id: "border_silver",   name: "Silver Shell", glyph: "S", color: "#c8d0d8", rarity: "Rare" },
  border_coral:    { id: "border_coral",    name: "Coral Reef",   glyph: "C", color: "#ff5fa2", rarity: "Rare" },
  border_seaglass: { id: "border_seaglass", name: "Sea Glass",    glyph: "G", color: "#2fe6c8", rarity: "Rare" },
  border_gold:     { id: "border_gold",     name: "Gold Shell",   glyph: "G", color: "#ffc83d", rarity: "Epic" },
  border_crimson:  { id: "border_crimson",  name: "Sunset",       glyph: "S", color: "#ff5a3c", rarity: "Epic" },
  border_storm:    { id: "border_storm",    name: "Riptide",      glyph: "R", color: "#4aa8b8", rarity: "Epic" },
  border_nova:     { id: "border_nova",     name: "Hypernova",    glyph: "N", color: "#b5f2ff", rarity: "Legendary" },
  border_pearl:    { id: "border_pearl",    name: "Black Pearl",  glyph: "P", color: "#6e3d4e", rarity: "Legendary" },
};

// ----- achievements -----
export const ACHIEVEMENTS = [
  // ---- GENERAL ----
  { id: "first_race",     name: "Toes in the Water",  desc: "Finish your first match.",                        glyph: "\uD83E\uDE74", metric: "matchesPlayed",       threshold: 1,    cat: "general" },
  { id: "regular_10",     name: "Beach Regular",      desc: "Finish 10 matches.",                              glyph: "\uD83C\uDFD6", metric: "matchesPlayed",       threshold: 10,   cat: "general",    reward: { avatar: "avatar_regular" } },
  { id: "regular_50",     name: "Season Pass",        desc: "Finish 50 matches.",                              glyph: "\u2600",        metric: "matchesPlayed",       threshold: 50,   cat: "general",    reward: { border: "border_bronze" } },
  { id: "regular_250",    name: "Local Legend",       desc: "Finish 250 matches.",                             glyph: "\uD83C\uDFDD", metric: "matchesPlayed",       threshold: 250,  cat: "general",    reward: { border: "border_silver" } },
  { id: "allrounder",     name: "All-Rounder",        desc: "Play every mode at least once.",                  glyph: "\uD83C\uDFB2", metric: "modesPlayed",         threshold: 7,    cat: "general",    reward: { avatar: "avatar_surfer" } },

  // ---- GRAND PRIX ----
  { id: "first_win",      name: "First Victory",      desc: "Win your first race.",                            glyph: "\uD83C\uDFC6", metric: "wins",                threshold: 1,    cat: "race",       reward: { border: "border_bronze" } },
  { id: "podium_15",      name: "Podium Fixture",     desc: "Finish top-3 in 15 races.",                       glyph: "\uD83E\uDD48", metric: "podiums",             threshold: 15,   cat: "race" },
  { id: "win_25",         name: "Decorated",          desc: "Win 25 races.",                                   glyph: "\uD83C\uDFC5", metric: "wins",                threshold: 25,   cat: "race",       reward: { border: "border_gold" } },
  { id: "win_100",        name: "Champion",           desc: "Win 100 races.",                                  glyph: "\uD83D\uDC51", metric: "wins",                threshold: 100,  cat: "race",       reward: { avatar: "avatar_champion" } },
  { id: "hot_streak",     name: "Hot Streak",         desc: "Win 5 races in a row.",                           glyph: "\uD83D\uDD25", metric: "bestWinStreak",       threshold: 5,    cat: "race",       reward: { border: "border_crimson" } },
  { id: "lap_1000",       name: "The Long Haul",      desc: "Complete 1,000 laps.",                            glyph: "\uD83D\uDD01", metric: "lapsCompleted",       threshold: 1000, cat: "race" },
  { id: "comeback",       name: "The Comeback",       desc: "Win a race you were losing on the final lap.",    glyph: "\uD83D\uDCC8", metric: "comebacks",           threshold: 1,    cat: "race",       reward: { avatar: "avatar_ghost" } },

  // ---- COMBAT (every mode) ----
  { id: "first_splash",   name: "Direct Hit",         desc: "Splash your first rival.",                        glyph: "\uD83D\uDCA6", metric: "splashesCaused",      threshold: 1,    cat: "combat" },
  { id: "soaker_50",      name: "Super Soaker",       desc: "Splash 50 rival karts.",                          glyph: "\uD83D\uDEBF", metric: "splashesCaused",      threshold: 50,   cat: "combat" },
  { id: "soaker_500",     name: "Tidal Force",        desc: "Splash 500 rival karts.",                         glyph: "\uD83C\uDF0A", metric: "splashesCaused",      threshold: 500,  cat: "combat",     reward: { border: "border_storm" } },
  { id: "wrecker_30",     name: "Wrecking Ball",      desc: "Crumble 30 rival karts.",                         glyph: "\uD83D\uDCA5", metric: "crumblesCaused",      threshold: 30,   cat: "combat",     reward: { avatar: "avatar_wrecker" } },
  { id: "wrecker_200",    name: "The Shark",          desc: "Crumble 200 rival karts.",                        glyph: "\uD83E\uDD88", metric: "crumblesCaused",      threshold: 200,  cat: "combat",     reward: { avatar: "avatar_shark" } },
  { id: "arsenal_250",    name: "Full Arsenal",       desc: "Fire 250 items.",                                 glyph: "\uD83C\uDFAF", metric: "itemsUsed",           threshold: 250,  cat: "combat" },
  { id: "ultimate_1",     name: "Unleashed",          desc: "Fire your first S-tier ultimate.",                glyph: "\u26A1",        metric: "ultimatesFired",      threshold: 1,    cat: "combat" },
  { id: "ultimate_25",    name: "Force of Nature",    desc: "Fire 25 S-tier ultimates.",                       glyph: "\u2604",        metric: "ultimatesFired",      threshold: 25,   cat: "combat",     reward: { border: "border_nova" } },
  { id: "kraken_3",       name: "Release the Kraken", desc: "Catch 3 racers with one Kraken's Grasp.",         glyph: "\uD83D\uDC19", metric: "krakenBest",          threshold: 3,    cat: "combat",     reward: { avatar: "avatar_kraken" } },

  // ---- SKILL / MINIGAMES ----
  { id: "hoops_100",      name: "Ring Runner",        desc: "Complete 100 hoop runs.",                         glyph: "\u2B55",        metric: "challengesCompleted", threshold: 100,  cat: "skill" },
  { id: "stier_20",       name: "Perfect Form",       desc: "Earn 20 S-tier runs.",                            glyph: "\u2B50",        metric: "sTiers",              threshold: 20,   cat: "skill" },
  { id: "stier_100",      name: "Flawless",           desc: "Earn 100 S-tier runs.",                           glyph: "\u2728",        metric: "sTiers",              threshold: 100,  cat: "skill",      reward: { border: "border_seaglass" } },
  { id: "keydrill_50",    name: "Quick Hands",        desc: "Nail 50 key-drill pads.",                         glyph: "\uD83D\uDD24", metric: "keyPads",             threshold: 50,   cat: "skill" },
  { id: "lane_perfect",   name: "On the Rails",       desc: "Hold the lane the whole way through a run.",      glyph: "\uD83D\uDEE4", metric: "perfectLanes",        threshold: 1,    cat: "skill" },

  // ---- TIME ATTACK ----
  { id: "tt_first",       name: "Against the Clock",  desc: "Set your first time-attack lap.",                 glyph: "\u23F1",        metric: "timeTrials",          threshold: 1,    cat: "timeattack" },
  { id: "tt_25",          name: "Clockwork",          desc: "Complete 25 time attacks.",                       glyph: "\u23F0",        metric: "timeTrials",          threshold: 25,   cat: "timeattack" },
  { id: "tt_allmaps",     name: "The Grand Tour",     desc: "Set a time on all four circuits.",                glyph: "\uD83D\uDDFA", metric: "circuitsTimed",       threshold: 4,    cat: "timeattack", reward: { avatar: "avatar_ghost" } },
  { id: "tt_top3pct",     name: "Elite",              desc: "Finish in the top 3% on any circuit.",            glyph: "\uD83D\uDC8E", metric: "top3Percent",         threshold: 1,    cat: "timeattack", reward: { border: "border_nova" } },

  // ---- DEMOLITION DERBY ----
  { id: "derby_first",    name: "Last One Rolling",   desc: "Win your first derby.",                           glyph: "\uD83D\uDC80", metric: "derbyWins",           threshold: 1,    cat: "derby" },
  { id: "derby_10",       name: "Demolition Man",     desc: "Win 10 derbies.",                                 glyph: "\uD83D\uDD28", metric: "derbyWins",           threshold: 10,   cat: "derby",      reward: { border: "border_crimson" } },
  { id: "derby_kills50",  name: "Scrapyard King",     desc: "Eliminate 50 karts in derbies.",                  glyph: "\u26B0",        metric: "derbyKills",          threshold: 50,   cat: "derby" },
  { id: "derby_flawless", name: "Not a Scratch",      desc: "Win a derby without losing a single life.",       glyph: "\uD83D\uDEE1", metric: "derbyFlawless",       threshold: 1,    cat: "derby",      reward: { avatar: "avatar_wrecker" } },

  // ---- CAPTURE THE FLAG ----
  { id: "ctf_first",      name: "Flag Runner",        desc: "Capture your first flag.",                        glyph: "\uD83D\uDEA9", metric: "flagCaptures",        threshold: 1,    cat: "ctf" },
  { id: "ctf_25",         name: "Flag Courier",       desc: "Capture 25 flags.",                               glyph: "\uD83D\uDCEE", metric: "flagCaptures",        threshold: 25,   cat: "ctf",        reward: { avatar: "avatar_courier" } },
  { id: "ctf_returns25",  name: "Home Guard",         desc: "Return your own flag 25 times.",                  glyph: "\uD83D\uDEE1", metric: "flagReturns",         threshold: 25,   cat: "ctf" },
  { id: "ctf_solo3",      name: "One-Kart Army",      desc: "Capture all 3 flags in a single match.",          glyph: "\uD83C\uDF96", metric: "ctfSoloWin",          threshold: 1,    cat: "ctf",        reward: { border: "border_gold" } },

  // ---- SAND ARTIST ----
  { id: "art_first",      name: "First Draft",        desc: "Have a drawing guessed correctly.",               glyph: "\uD83D\uDD8C", metric: "drawingsGuessed",     threshold: 1,    cat: "artist" },
  { id: "art_25",         name: "Sand Artist",        desc: "Have 25 drawings guessed.",                       glyph: "\uD83C\uDFA8", metric: "drawingsGuessed",     threshold: 25,   cat: "artist",     reward: { avatar: "avatar_artist" } },
  { id: "art_guess50",    name: "Mind Reader",        desc: "Guess 50 drawings correctly.",                    glyph: "\uD83D\uDD2E", metric: "correctGuesses",      threshold: 50,   cat: "artist" },
  { id: "art_win",        name: "Best in Show",       desc: "Win a Sand Artist match.",                        glyph: "\uD83C\uDFDB", metric: "artistWins",          threshold: 1,    cat: "artist" },

  // ---- RIPTIDE TAG ----
  { id: "tag_first",      name: "Tag, You're It",     desc: "Pass IT on for the first time.",                  glyph: "\uD83D\uDC4B", metric: "tagsMade",            threshold: 1,    cat: "tag" },
  { id: "tag_100",        name: "Slippery",           desc: "Pass IT on 100 times.",                           glyph: "\uD83C\uDF0A", metric: "tagsMade",            threshold: 100,  cat: "tag",        reward: { border: "border_storm" } },
  { id: "tag_untouched",  name: "Untouchable",        desc: "Win a Tag match without ever being IT.",          glyph: "\uD83D\uDD4A", metric: "tagUntouched",        threshold: 1,    cat: "tag",        reward: { avatar: "avatar_ghost" } },

  // ---- PEARL RUSH ----
  { id: "pearl_first",    name: "First Pearl",        desc: "Collect your first pearl.",                       glyph: "\uD83E\uDDAA", metric: "pearls",              threshold: 1,    cat: "pearl" },
  { id: "pearl_1000",     name: "Pearl Diver",        desc: "Collect 1,000 pearls.",                           glyph: "\uD83D\uDC1A", metric: "pearls",              threshold: 1000, cat: "pearl",      reward: { avatar: "avatar_diver" } },
  { id: "pearl_30",       name: "Deep Pockets",       desc: "Hold 30 pearls at once.",                         glyph: "\uD83D\uDCB0", metric: "pearlBest",           threshold: 30,   cat: "pearl" },
  { id: "pearl_win",      name: "The Black Pearl",    desc: "Win 10 Pearl Rush matches.",                      glyph: "\uD83D\uDDA4", metric: "pearlWins",           threshold: 10,   cat: "pearl",      reward: { border: "border_pearl" } },

  // ---- COLLECTION ----
  { id: "craft_first",    name: "Beachcomber",        desc: "Craft your first item with sea glass.",           glyph: "\uD83D\uDD28", metric: "itemsCrafted",        threshold: 1,    cat: "collection" },
  { id: "craft_25",       name: "Master Crafter",     desc: "Craft 25 items.",                                 glyph: "\u2692",        metric: "itemsCrafted",        threshold: 25,   cat: "collection", reward: { border: "border_seaglass" } },
  { id: "scrap_50",       name: "Recycler",           desc: "Scrap 50 items for sea glass.",                   glyph: "\u267B",        metric: "itemsScrapped",       threshold: 50,   cat: "collection" },
  { id: "collector_50",   name: "The Collection",     desc: "Own 50 cosmetics.",                               glyph: "\uD83E\uDDF3", metric: "cosmeticsOwned",      threshold: 50,   cat: "collection" },
  { id: "collector_100",  name: "Completionist",      desc: "Own 100 cosmetics.",                              glyph: "\uD83C\uDFC6", metric: "cosmeticsOwned",      threshold: 100,  cat: "collection", reward: { avatar: "avatar_legend" } },
];

// For the profile UI to group by.
export const ACHIEVEMENT_CATS = [
  { id: "general",    label: "General",           glyph: "\uD83C\uDFD6" },
  { id: "race",       label: "Grand Prix",        glyph: "\uD83C\uDFC1" },
  { id: "combat",     label: "Combat",            glyph: "\uD83D\uDCA5" },
  { id: "skill",      label: "Skill",             glyph: "\u2B55" },
  { id: "timeattack", label: "Time Attack",       glyph: "\u23F1" },
  { id: "derby",      label: "Demolition Derby",  glyph: "\uD83D\uDC80" },
  { id: "ctf",        label: "Capture the Flag",  glyph: "\uD83D\uDEA9" },
  { id: "artist",     label: "Sand Artist",       glyph: "\uD83C\uDFA8" },
  { id: "tag",        label: "Riptide Tag",       glyph: "\uD83C\uDF0A" },
  { id: "pearl",      label: "Pearl Rush",        glyph: "\uD83E\uDDAA" },
  { id: "collection", label: "Collection",        glyph: "\uD83E\uDDF3" },
];

// Every stat an achievement reads. The store seeds all of these to 0, so a
// progress bar never reads `undefined` — and there's a test that fails the build
// if an achievement names a metric that isn't here. An achievement nobody can
// ever earn doesn't look like a missing feature, it looks like a broken account.
export const TRACKED_STATS = [
  "matchesPlayed", "modesPlayed",
  "wins", "podiums", "bestWinStreak", "lapsCompleted", "comebacks",
  "splashesCaused", "crumblesCaused", "itemsUsed", "ultimatesFired", "krakenBest",
  "challengesCompleted", "sTiers", "keyPads", "perfectLanes",
  "timeTrials", "circuitsTimed", "top3Percent",
  "derbyWins", "derbyKills", "derbyFlawless",
  "flagCaptures", "flagGrabs", "flagReturns", "ctfSoloWin",
  "drawingsGuessed", "correctGuesses", "artistWins",
  "tagsMade", "tagUntouched", "itTimeTotal",
  "pearls", "pearlBest", "pearlWins",
  "itemsCrafted", "itemsScrapped", "cosmeticsOwned",
  // still shown on the profile screen
  "bestPlace", "bestLapSec",
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
