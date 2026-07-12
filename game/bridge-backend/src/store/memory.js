// In-memory implementation of the data interface.
// Every method here is what the routes call — swap this whole module for a
// Postgres-backed one later (same method signatures) and nothing upstream changes.

import { DEFAULT_CURRENCY, config, CONSUMABLES, PREMIUM_BONUS, LOYALTY_MILESTONES, LOYALTY_INACTIVITY_MS, AD_REWARD } from "../config/index.js";
import {
  COSMETICS, SLOTS, levelForXp, xpForLevel, unlockedAt, defaultLoadout, LEVEL_UNLOCKS, COVERED_BY_BODY_SLOTS,
} from "../config/cosmetics.js";
import { DEFAULT_SETTINGS, defaultWheels, sanitizeSettings, WHEEL_SLOTS, DEFAULT_EMOTES } from "../config/settings.js";
import { normalizeReward, EVENT_FLAGS } from "../config/events.js";
import { questsForDay, QUEST_POOL, streakReward, utcDay } from "../config/quests.js";
import {
  ACHIEVEMENTS, AVATARS, BORDERS, DEFAULT_AVATAR, DEFAULT_BORDER,
  evaluateAchievements, progressFor, weekKey,
} from "../config/achievements.js";
import {
  STRINGS, LOCALE_CODES, TRANSLATABLE_LOCALES, DEFAULT_LOCALE, isLocale,
} from "../config/strings.js";

const users = new Map();        // userId -> user
const inventories = new Map();  // userId -> [items]
const boxConfigs = new Map();   // boxId -> config
const codes = new Map();        // code -> { reward, currency, amount }
const codeRedemptions = new Map(); // `${userId}:${code}` -> true
const checkoutSessions = new Map(); // sessionId -> { userId, packId, prisms, status }
const events = new Map();        // eventId -> event record
const eventFlags = new Map();    // `${eventId}:${userId}` -> { flag, meta }
const bountyClaims = new Map();   // `${eventId}:${targetId}` -> { byUserId, at } (single claim per target/event)
const storeItems = new Map();    // id -> direct-purchase store item (with admin-only worth/dropWeight)
const tickets = new Map();        // ticketId -> moderation report ticket (Task #3)
const newsSlots = new Map();      // slot (1..NEWS_SLOTS) -> admin-authored news tile
// i18n: key -> { "pt-BR": string, "es-MX": string, en: string(override),
//   humanEdited: { <lang>: bool } }. English default lives in code (STRINGS);
// entries here hold translations + an optional human English override. Auto-
// translate only fills locales whose humanEdited flag is NOT set.
const translations = new Map();
const NEWS_SLOTS = 6;             // fixed number of player-facing news tiles
const NEWS_BODY_MAX = 200 * 1024; // cap each HTML body so the JSONB snapshot stays cheap
const txLog = [];               // transaction audit trail
const adminActions = [];        // admin audit trail: cosmetic grant/remove/reverse, currency adjustments, moderation (ban/silence)

let nextId = 1;
const uid = () => String(nextId++);

// ---- seed some loot boxes + codes so the API is usable immediately ----
function seed() {
  // Direct-purchase store items. Each carries PUBLIC fields (price, currency,
  // priceCents for cash) and ADMIN-ONLY fields never sent to players:
  //   dropWeight — relative likelihood when this item appears in a loot box
  //   worth      — an internal "value" number (e.g. coin-out / accounting worth)
  // Admins edit all of these in the console; players only ever see price/name.
  const item = (o) => ({ kind: "item", enabled: true, dropWeight: 10, worth: 0, ...o });
  storeItems.set("si_band_knot", item({ id:"si_band_knot", cosmeticId:"bandana_knot", name:"Knotted Bandana", rarity:"Common", currency:"CREDITS", price:500, dropWeight:70, worth:25 }));
  storeItems.set("si_visor",     item({ id:"si_visor",     cosmeticId:"head_visor",   name:"Neon Visor",      rarity:"Rare",   currency:"CREDITS", price:700, dropWeight:24, worth:120 }));
  storeItems.set("si_drill",     item({ id:"si_drill",     cosmeticId:"tool_drill",   name:"Steam Drill",    rarity:"Rare",   currency:"CREDITS", price:700, dropWeight:30, worth:110 }));
  storeItems.set("si_glow",      item({ id:"si_glow",      cosmeticId:"shoes_glow",   name:"Glowstep Wheel",  rarity:"Epic",   currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  // PREMIUM (cash-adjacent) direct items — priceCents drives Stripe. $1 test items.
  storeItems.set("si_halo",      item({ id:"si_halo",      cosmeticId:"head_halo",    name:"Spirit Halo",     rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2,  worth:900 }));
  storeItems.set("si_ronin",     item({ id:"si_ronin",     cosmeticId:"body_ronin",   name:"Lone Drifter", rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:3,  worth:850 }));
  storeItems.set("si_aurora",    item({ id:"si_aurora",    cosmeticId:"border_aurora",name:"Sunset Frame",    rarity:"Epic",      currency:"PREMIUM", price:1, priceCents:100, dropWeight:10, worth:400 }));
  // Utility product (NOT a cosmetic): one paid display-name change. priceCents
  // drives Stripe like any cash item; fulfillment grants a name-change credit
  // instead of a cosmetic. dropWeight:0 so it never appears in any loot box.
  storeItems.set("si_name_change", item({ id:"si_name_change", name:"Name Change", rarity:"Rare", currency:"PREMIUM", price:1, priceCents:100, grantsNameChange:1, dropWeight:0, worth:100 }));

  // ---- Store expansion: 30 anime-themed items. CREDITS items are earnable;
  // PREMIUM items are $1 cash (priceCents:100) for Stripe testing. ----
  // Breathers
  storeItems.set("si_breather_koi",     item({ id:"si_breather_koi",     cosmeticId:"breather_koi",     name:"Catfish Filter",       rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_breather_kitsune", item({ id:"si_breather_kitsune", cosmeticId:"breather_kitsune", name:"Coyote Mask",     rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  storeItems.set("si_breather_oni",     item({ id:"si_breather_oni",     cosmeticId:"breather_oni",     name:"Devil's Visage",       rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // O2 tanks
  storeItems.set("si_tank_jet",         item({ id:"si_tank_jet",         cosmeticId:"tank_jet",         name:"Piston Cell",   rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_tank_sakura",      item({ id:"si_tank_sakura",      cosmeticId:"tank_sakura",      name:"Desert Bloom Cell",      rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  storeItems.set("si_tank_dragon",      item({ id:"si_tank_dragon",      cosmeticId:"tank_dragon",      name:"Thunder Core",      rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // Weapons
  storeItems.set("si_tool_bokken",      item({ id:"si_tool_bokken",      cosmeticId:"tool_bokken",      name:"Training Cudgel",  rarity:"Common",    currency:"CREDITS", price:500,  dropWeight:70, worth:25 }));
  storeItems.set("si_tool_fan",         item({ id:"si_tool_fan",         cosmeticId:"tool_fan",         name:"War Fan",          rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_tool_katana",      item({ id:"si_tool_katana",      cosmeticId:"tool_katana",      name:"Cavalry Saber",    rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  storeItems.set("si_tool_naginata",    item({ id:"si_tool_naginata",    cosmeticId:"tool_naginata",    name:"Marshal's Pike",    rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // Bandanas
  storeItems.set("si_band_hachimaki",   item({ id:"si_band_hachimaki",   cosmeticId:"bandana_hachimaki",name:"Dust Wrap",        rarity:"Common",    currency:"CREDITS", price:500,  dropWeight:70, worth:25 }));
  storeItems.set("si_band_flame",       item({ id:"si_band_flame",       cosmeticId:"bandana_flame",    name:"Flame Wrap",       rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_band_storm",       item({ id:"si_band_storm",       cosmeticId:"bandana_storm",    name:"Storm Scarf",      rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  // Headpieces
  storeItems.set("si_head_goggles",     item({ id:"si_head_goggles",     cosmeticId:"head_goggles",     name:"Dust Goggles",    rarity:"Common",    currency:"CREDITS", price:500,  dropWeight:70, worth:25 }));
  storeItems.set("si_head_foxears",     item({ id:"si_head_foxears",     cosmeticId:"head_foxears",     name:"Coyote Ears",         rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_head_kabuto",      item({ id:"si_head_kabuto",      cosmeticId:"head_kabuto",      name:"Bandit Helm",      rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  storeItems.set("si_head_crown",       item({ id:"si_head_crown",       cosmeticId:"head_crown",       name:"Outlaw Crown",     rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // Bodies
  storeItems.set("si_body_pilotsuit",   item({ id:"si_body_pilotsuit",   cosmeticId:"body_pilotsuit",   name:"Gunslinger Rig",   rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_body_kimono",      item({ id:"si_body_kimono",      cosmeticId:"body_kimono",      name:"Star Poncho",      rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  storeItems.set("si_body_samurai",     item({ id:"si_body_samurai",     cosmeticId:"body_samurai",     name:"Dread Marshal",     rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // Shoes
  storeItems.set("si_shoes_geta",       item({ id:"si_shoes_geta",       cosmeticId:"shoes_geta",       name:"Rocket Wheel",      rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_shoes_hover",      item({ id:"si_shoes_hover",      cosmeticId:"shoes_hover",      name:"Chrome Treads",     rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  // Belts
  storeItems.set("si_belt_holster",     item({ id:"si_belt_holster",     cosmeticId:"belt_holster",     name:"Twin Holster",     rarity:"Common",    currency:"CREDITS", price:500,  dropWeight:70, worth:25 }));
  storeItems.set("si_belt_obi",         item({ id:"si_belt_obi",         cosmeticId:"belt_obi",         name:"Battle Sash",       rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  // Borders
  storeItems.set("si_border_neon",      item({ id:"si_border_neon",      cosmeticId:"border_neon",      name:"Neon Circuit",     rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_border_celestial", item({ id:"si_border_celestial", cosmeticId:"border_celestial", name:"Frontier Ring",   rarity:"Legendary", currency:"PREMIUM", price:1, priceCents:100, dropWeight:2, worth:900 }));
  // Victory poses
  storeItems.set("si_pose_meditate",    item({ id:"si_pose_meditate",    cosmeticId:"pose_meditate",    name:"Quiet Vigil",        rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));
  storeItems.set("si_pose_victory",     item({ id:"si_pose_victory",     cosmeticId:"pose_victory",     name:"Hero Landing",     rarity:"Epic",      currency:"CREDITS", price:900, dropWeight:12, worth:300 }));
  // Emotes
  storeItems.set("si_emote_bow",        item({ id:"si_emote_bow",        cosmeticId:"emote_bow",        name:"Tip the Hat",      rarity:"Common",    currency:"CREDITS", price:500,  dropWeight:70, worth:25 }));
  storeItems.set("si_emote_peace",      item({ id:"si_emote_peace",      cosmeticId:"emote_peace",      name:"Peace Sign",       rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:28, worth:120 }));

  // Backgrounds (world vistas). The default bg_badlands is granted to everyone and NOT sold.
  storeItems.set("si_bg_snowpass",      item({ id:"si_bg_snowpass",      cosmeticId:"bg_snowpass",      name:"Frostbite Pass",   rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:0, worth:160 }));
  storeItems.set("si_bg_pineforest",    item({ id:"si_bg_pineforest",    cosmeticId:"bg_pineforest",    name:"Timberline Run",   rarity:"Rare",      currency:"CREDITS", price:700,  dropWeight:0, worth:160 }));

  boxConfigs.set("cadet_crate", {
    id: "cadet_crate", name: "Greenhorn Crate", price: 300, currency: "CREDITS", kind: "box", enabled: true, worth: 250,
    drops: [
      { cosmeticId: "bandana_knot",  item: "Knotted Bandana", rarity: "Common", weight: 70 },
      { cosmeticId: "head_visor",    item: "Neon Visor",      rarity: "Rare",   weight: 24 },
      { cosmeticId: "body_mecha",    item: "Iron Frame",     rarity: "Epic",   weight: 5 },
      { cosmeticId: "head_halo",     item: "Spirit Halo",     rarity: "Legendary", weight: 1 },
    ],
  });
  boxConfigs.set("vanguard_cache", {
    id: "vanguard_cache", name: "Ranger Cache", price: 700, currency: "CREDITS", kind: "box", enabled: true, worth: 600,
    drops: [
      { cosmeticId: "tool_drill",    item: "Steam Drill",     rarity: "Rare",   weight: 38 },
      { cosmeticId: "shoes_glow",    item: "Glowstep Wheel",   rarity: "Epic",   weight: 14 },
      { cosmeticId: "tank_finned",   item: "Finned Battery",      rarity: "Rare",  weight: 45 },
      { cosmeticId: "body_ronin",    item: "Lone Drifter",  rarity: "Legendary", weight: 3 },
    ],
  });
  boxConfigs.set("prism_vault", {
    id: "prism_vault", name: "Gold Vault", price: 5, currency: "PREMIUM", kind: "box", enabled: true, worth: 5, priceCents: 300,
    drops: [
      { cosmeticId: "border_aurora", item: "Sunset Frame",   rarity: "Epic",      weight: 50 },
      { cosmeticId: "head_halo",     item: "Spirit Halo",     rarity: "Legendary", weight: 20 },
      { cosmeticId: "body_ronin",    item: "Lone Drifter", rarity: "Legendary", weight: 15 },
      { cosmeticId: "pose_backflip", item: "High-Noon Backflip", rarity: "Rare",      weight: 15 },
    ],
  });
  codes.set("BRIDGE-LAUNCH", { reward: { cosmeticId: "tool_chicken", item: "Rubber Chicken", rarity: "Epic" } });
  codes.set("WELCOME-500", { currency: "CREDITS", amount: 500 });
  codes.set("NEON-PILOT", { reward: { cosmeticId: "head_visor", item: "Neon Visor", rarity: "Rare" } });
}
seed();
seedTranslations();

// Bumped whenever the code-owned store catalog defaults change in a way that must
// override a persisted snapshot (e.g. the Gold/Silver Nugget re-pricing). When an
// older snapshot loads, seed-default items are RESET to these new code prices while
// admin-created items still restore. The seed ids are captured now so the import
// migration can tell "code default" apart from "admin-created".
const CATALOG_VERSION = 2;
const SEED_ITEM_IDS = new Set(storeItems.keys());
const SEED_BOX_IDS = new Set(boxConfigs.keys());

// ---- snapshot helpers (used by the optional Postgres persistence layer) ----
// We keep the whole game state in the Maps above and serialize/restore them as a
// single JSON blob. `user.cosmetics` is a Set, so it is converted to/from an array.
export function __exportSnapshot() {
  return {
    v: 1,
    catalogVersion: CATALOG_VERSION,
    nextId,
    users: [...users.values()].map((u) => ({ ...u, cosmetics: [...u.cosmetics] })),
    inventories: [...inventories.entries()],
    boxConfigs: [...boxConfigs.entries()],
    codes: [...codes.entries()],
    codeRedemptions: [...codeRedemptions.keys()],
    checkoutSessions: [...checkoutSessions.entries()],
    events: [...events.entries()],
    eventFlags: [...eventFlags.entries()],
    bountyClaims: [...bountyClaims.entries()],
    storeItems: [...storeItems.entries()],
    tickets: [...tickets.entries()],
    newsSlots: [...newsSlots.entries()],
    translations: [...translations.entries()],
    adminActions: [...adminActions],
  };
}

// Back-fill the profile/social fields that later features rely on. Applied to
// every account on creation AND to already-stored accounts when a snapshot loads,
// so old accounts gain the new fields safely with sane defaults. Only fills
// fields that are missing — never clobbers existing values.
//
// `grandfather` is true for accounts loaded from a snapshot: they already exist,
// so we treat them as having accepted ToS and chosen their name (they keep their
// current name and skip onboarding). Brand-new accounts pass it false so the
// onboarding flow (ToS + name pick) runs the first time.
export function applyAccountDefaults(u, { grandfather = false } = {}) {
  if (u.tosAcceptedAt === undefined) u.tosAcceptedAt = grandfather ? new Date().toISOString() : null;
  if (u.nameChosen === undefined) u.nameChosen = grandfather ? true : false;
  if (!u.stats || typeof u.stats !== "object") {
    u.stats = {
      matchesPlayed: 0, wins: 0, losses: 0,
      matchesAsCrew: 0, matchesAsImpostor: 0,
      winsAsCrew: 0, winsAsImpostor: 0,
      tasksCompleted: 0, sabotages: 0, impostorKills: 0, ejections: 0,
      winStreak: 0, bestWinStreak: 0,
    };
  }
  if (!Array.isArray(u.matchHistory)) u.matchHistory = []; // recent matches (detailed entries added by a later feature)
  if (typeof u.karma !== "number") u.karma = 0;
  if (!Array.isArray(u.karmaHistory)) u.karmaHistory = [];       // [{ from, matchId, at }]
  if (typeof u.matchesSinceKarma !== "number") u.matchesSinceKarma = 0;
  if (!u.karmaGiven || typeof u.karmaGiven !== "object") u.karmaGiven = {}; // matchId -> [targetUserIds] (cap 2/match)
  if (!Array.isArray(u.friends)) u.friends = [];                 // userIds this account has added (one-directional)
  if (!Array.isArray(u.friendRequests)) u.friendRequests = [];   // pending requests { from/to, at }
  if (!u.achievements || typeof u.achievements !== "object") u.achievements = {}; // achId -> { unlockedAt, progress }
  if (!Array.isArray(u.ownedAvatars)) u.ownedAvatars = [];
  if (!Array.isArray(u.ownedBorders)) u.ownedBorders = [];
  if (u.selectedAvatar === undefined) u.selectedAvatar = null;
  if (u.selectedBorder === undefined) u.selectedBorder = null;
  // Seed the starter avatar/border so every account (including ones created before
  // this feature) owns at least the defaults and has them selected. Idempotent.
  if (!u.ownedAvatars.includes(DEFAULT_AVATAR)) u.ownedAvatars.unshift(DEFAULT_AVATAR);
  if (!u.ownedBorders.includes(DEFAULT_BORDER)) u.ownedBorders.unshift(DEFAULT_BORDER);
  if (!u.selectedAvatar) u.selectedAvatar = DEFAULT_AVATAR;
  if (!u.selectedBorder) u.selectedBorder = DEFAULT_BORDER;
  // Weekly win-rate bucket (resets when the ISO week changes) + the queue of
  // freshly-unlocked achievement ids the client shows as a match-end toast.
  if (!u.weekly || typeof u.weekly !== "object") u.weekly = { weekKey: null, matches: 0, wins: 0 };
  if (!u.daily || typeof u.daily !== "object") u.daily = { day: null, quests: [], streak: { count: 0, lastDay: null } };
  if (!u.weeklyLap || typeof u.weeklyLap !== "object") u.weeklyLap = { weekKey: null, bestLapSec: null, totalSec: null };
  if (!Array.isArray(u.pendingAchievements)) u.pendingAchievements = [];
  // Recently-ingested match ids (capped), used to make ingestMatchResult idempotent
  // so a duplicate/replayed match-result POST can't double-count XP/stats/history.
  if (!Array.isArray(u.processedMatches)) u.processedMatches = [];
  if (typeof u.nameChangeCredits !== "number") u.nameChangeCredits = 0;
  if (typeof u.streamerMode !== "boolean") u.streamerMode = false;
  // ----- premium time + consumables + lifetime spend (P2–P4) -----
  // premiumUntil: ISO timestamp the "Gold Trail" pass runs until (null = none).
  if (u.premiumUntil === undefined) u.premiumUntil = null;
  // consumables: usable stash items owned as COUNTS (itemId -> qty), popped for
  // a currency/XP reward. Plain object so it survives the JSON snapshot.
  if (!u.consumables || typeof u.consumables !== "object" || Array.isArray(u.consumables)) u.consumables = {};
  // lifetimeSpendCents: total real money ever spent (drives the loyalty ladder).
  if (typeof u.lifetimeSpendCents !== "number") u.lifetimeSpendCents = 0;
  // Loyalty: when the last real-money spend happened (drives the inactivity reset)
  // and which milestones have been claimed (idempotent claim guard). JSON-safe.
  if (u.lastSpendAt === undefined) u.lastSpendAt = null;
  if (!Array.isArray(u.loyaltyClaimed)) u.loyaltyClaimed = [];
  // Rewarded-ad daily allowance: the Central-time day the counter belongs to and how many
  // ads have already been rewarded that day. Reset lazily on the first read/claim
  // of a new day. Plain object (day: "YYYY-MM-DD" | null, count: number) so it
  // survives the JSON snapshot round-trip.
  if (!u.adReward || typeof u.adReward !== "object" || Array.isArray(u.adReward)) {
    u.adReward = { day: null, count: 0 };
  }
  // Per-cosmetic acquisition sources: cosmeticId -> [sourceTag, ...]. Lets a
  // refund clawback know whether an owned cosmetic is STILL attributable to some
  // other valid source (loot box, gift, level unlock, code) so it isn't stripped
  // out from under a player who legitimately re-acquired it. Plain object + arrays
  // so it survives the JSON snapshot round-trip (never a Set/Map).
  if (!u.cosmeticSources || typeof u.cosmeticSources !== "object" || Array.isArray(u.cosmeticSources)) {
    u.cosmeticSources = {};
  }
  // Backfill: any cosmetic the account already owns with no recorded source is
  // grandfathered as a "legacy" source so a later refund can't strip a cosmetic
  // whose true origin predates source tracking.
  for (const cid of (u.cosmetics || [])) {
    if (!Array.isArray(u.cosmeticSources[cid]) || u.cosmeticSources[cid].length === 0) {
      u.cosmeticSources[cid] = ["legacy"];
    }
  }
  // Seed the starter Vista (background) for accounts created before the slot
  // existed. Backgrounds are an alwaysFilled slot: equip requires ownership and
  // unequip is blocked, so an account that lacks the default could buy another
  // vista, equip it, and get permanently stuck with no way back. Grant the
  // default + equip it if unset. Idempotent — only grants when not already owned.
  const DEFAULT_BG = defaultLoadout().background;
  if (DEFAULT_BG && u.cosmetics && typeof u.cosmetics.has === "function") {
    if (!u.cosmetics.has(DEFAULT_BG)) {
      u.cosmetics.add(DEFAULT_BG);
      addCosmeticSource(u, DEFAULT_BG, "level:1");
    }
    if (!u.loadout || typeof u.loadout !== "object") u.loadout = defaultLoadout();
    if (!u.loadout.background) u.loadout.background = DEFAULT_BG;
  }
  // Emotes: one-time seed of the starter animated emotes + a pre-bound emote
  // wheel so emotes work out of the box (existing accounts included). Emotes are
  // purely cosmetic (a ~3s glyph/animation), so granting them is harmless. Flag-
  // guarded so a player who later clears their emote wheel isn't re-populated on
  // the next load.
  if (!u.emotesSeeded) {
    if (u.cosmetics && typeof u.cosmetics.has === "function") {
      for (const eid of DEFAULT_EMOTES) {
        if (!u.cosmetics.has(eid)) { u.cosmetics.add(eid); addCosmeticSource(u, eid, "level:1"); }
      }
    }
    if (!u.wheels || typeof u.wheels !== "object") u.wheels = defaultWheels();
    if (!Array.isArray(u.wheels.emote) || !u.wheels.emote.some(Boolean)) {
      u.wheels.emote = defaultWheels().emote;
    }
    u.emotesSeeded = true;
  }
  // Player-facing notices (e.g. an admin restored a wrongly-reversed purchase).
  // Drained by the client once shown, mirroring the pendingAchievements toast queue.
  if (!Array.isArray(u.notices)) u.notices = [];
  // Per-slot last-seen news revision: slot -> rev. Drives the "new" badge that
  // clears once the player opens an updated news tile. Plain object (JSON-safe).
  if (!u.newsSeen || typeof u.newsSeen !== "object" || Array.isArray(u.newsSeen)) u.newsSeen = {};
  // Preferred UI language (i18n). Falls back to the default locale; the client
  // also caches its own choice in localStorage for pre-login screens.
  if (!isLocale(u.language)) u.language = DEFAULT_LOCALE;
  return u;
}

// Record one acquisition source for a cosmetic on a user. Stored as a plain
// object of arrays so duplicate/identical sources (e.g. opening the same box
// twice) each count as a distinct hold; a refund removes only its own source.
function addCosmeticSource(u, cosmeticId, source) {
  if (!source) return;
  if (!u.cosmeticSources || typeof u.cosmeticSources !== "object" || Array.isArray(u.cosmeticSources)) {
    u.cosmeticSources = {};
  }
  if (!Array.isArray(u.cosmeticSources[cosmeticId])) u.cosmeticSources[cosmeticId] = [];
  u.cosmeticSources[cosmeticId].push(source);
}

export function __importSnapshot(data) {
  if (!data || typeof data !== "object") return;
  if (typeof data.nextId === "number") nextId = Math.max(nextId, data.nextId);
  // Authoritative player state — replace wholesale.
  if (Array.isArray(data.users)) {
    users.clear();
    for (const u of data.users) {
      const user = applyAccountDefaults({ ...u, cosmetics: new Set(u.cosmetics || []) }, { grandfather: true });
      users.set(user.id, user);
    }
  }
  if (Array.isArray(data.inventories)) { inventories.clear(); for (const [k, v] of data.inventories) inventories.set(k, v); }
  if (Array.isArray(data.codeRedemptions)) { codeRedemptions.clear(); for (const k of data.codeRedemptions) codeRedemptions.set(k, true); }
  if (Array.isArray(data.checkoutSessions)) { checkoutSessions.clear(); for (const [k, v] of data.checkoutSessions) checkoutSessions.set(k, v); }
  if (Array.isArray(data.events)) { events.clear(); for (const [k, v] of data.events) events.set(k, v); }
  if (Array.isArray(data.eventFlags)) { eventFlags.clear(); for (const [k, v] of data.eventFlags) eventFlags.set(k, v); }
  if (Array.isArray(data.bountyClaims)) { bountyClaims.clear(); for (const [k, v] of data.bountyClaims) bountyClaims.set(k, v); }
  // Store config — OVERLAY on top of seeded defaults so newly code-added default
  // items survive an old snapshot, while admin edits / admin-created items restore.
  // MIGRATION: when the snapshot predates the current CATALOG_VERSION, seed-default
  // items are NOT overlaid (the new code prices win); only admin-created items (ids
  // not in the seed) restore. Once a fresh snapshot is written the overlay resumes.
  const freshCatalog = data.catalogVersion !== CATALOG_VERSION;
  if (Array.isArray(data.storeItems)) for (const [k, v] of data.storeItems) {
    if (freshCatalog && SEED_ITEM_IDS.has(k)) continue;
    storeItems.set(k, v);
  }
  if (Array.isArray(data.boxConfigs)) for (const [k, v] of data.boxConfigs) {
    if (freshCatalog && SEED_BOX_IDS.has(k)) continue;
    boxConfigs.set(k, v);
  }
  if (Array.isArray(data.codes)) for (const [k, v] of data.codes) codes.set(k, v);
  if (Array.isArray(data.tickets)) { tickets.clear(); for (const [k, v] of data.tickets) tickets.set(k, v); }
  if (Array.isArray(data.newsSlots)) { newsSlots.clear(); for (const [k, v] of data.newsSlots) newsSlots.set(Number(k), v); }
  if (Array.isArray(data.translations)) { translations.clear(); for (const [k, v] of data.translations) translations.set(String(k), v); }
  if (Array.isArray(data.adminActions)) { adminActions.length = 0; for (const a of data.adminActions) adminActions.push(a); }
  // Add any NEW code keys the loaded snapshot predates (never clobbers stored
  // translations for keys that already exist).
  seedTranslations();
}

// Ensure every English catalogue key has a translations row. Seed-new-only:
// existing rows (with their human/AI translations) are never touched, so growing
// STRINGS over time only adds blank rows for the new keys. Also drops rows whose
// key no longer exists in the catalogue so orphans don't linger in the snapshot.
function seedTranslations() {
  for (const key of Object.keys(STRINGS)) {
    if (!translations.has(key)) {
      const row = { en: "", humanEdited: {} };
      for (const lang of TRANSLATABLE_LOCALES) row[lang] = "";
      translations.set(key, row);
    }
  }
  for (const key of [...translations.keys()]) {
    if (!(key in STRINGS)) translations.delete(key);
  }
}

export const memoryStore = {
  // ----- users -----
  // Re-key an account's external identity — used to LINK a guest account to a
  // CrazyGames user the first time that player logs into CG (their guest
  // progress rides along instead of being orphaned).
  async relinkGoogleId(userId, newGoogleId) {
    const u = users.get(userId);
    if (!u) return null;
    u.googleId = newGoogleId;
    return u;
  },

  async findUserByGoogleId(googleId) {
    for (const u of users.values()) if (u.googleId === googleId) return u;
    return null;
  },
  async createUser({ googleId, name, email, avatar, password, emailVerified = false }) {
    const id = uid();
    // Bootstrap: the configured super-admin email gets full power — but ONLY when
    // the email comes from a verified Google sign-in. Quick-play lets anyone type
    // any email/password, so trusting an unverified email here would let a stranger
    // self-grant superadmin just by entering the bootstrap address.
    const isSuper = !!email && emailVerified && email.toLowerCase() === config.superadminEmail.toLowerCase();
    const user = {
      id, googleId, name, email, avatar, password,
      balances: { CREDITS: 1000, PREMIUM: 0 }, // starter Credits
      xp: 0,
      level: 1,
      adminRole: isSuper ? "superadmin" : null, // null | "admin" | "superadmin"
      moderation: { banned: false, banUntil: null, banReason: null, silenced: false },
      cosmetics: new Set(),     // owned cosmetic ids
      loadout: defaultLoadout(),// equipped per slot
      settings: structuredClone(DEFAULT_SETTINGS),
      wheels: defaultWheels(),  // emote + comms radial bindings
      createdAt: new Date().toISOString(),
    };
    // Add the profile/social fields with defaults. A brand-new account has NOT
    // accepted ToS or chosen its name yet, so the onboarding flow runs first.
    applyAccountDefaults(user, { grandfather: false });
    users.set(id, user);
    inventories.set(id, []);
    // Grant the level-1 starter cosmetics so the kit is owned, not just defaulted.
    for (const cid of (LEVEL_UNLOCKS[1]?.grants || [])) {
      user.cosmetics.add(cid);
      addCosmeticSource(user, cid, "level:1");
    }
    return user;
  },
  async getUser(id) { return users.get(id) || null; },

  // ----- onboarding (ToS + initial name) -----
  // Record one-time Terms of Service acceptance. Idempotent: keeps the first
  // acceptance timestamp if already set.
  async acceptTos(userId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!u.tosAcceptedAt) u.tosAcceptedAt = new Date().toISOString();
    return { tosAcceptedAt: u.tosAcceptedAt };
  },
  // Set the player's initial display name during onboarding. Caller is expected
  // to have validated/cleaned the name via the shared name filter. Only valid for
  // the first-time pick — once a name is chosen, changing it is a separate
  // (later, paid) flow, so this refuses to overwrite an already-chosen name.
  async setInitialName(userId, cleanName) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (u.nameChosen) throw new Error("name already set");
    u.name = cleanName;
    u.avatar = (cleanName[0] || "A").toUpperCase();
    u.nameChosen = true;
    return { name: u.name, avatar: u.avatar, nameChosen: true };
  },
  // Grant one (or more) paid name-change credits. Called by the Stripe webhook
  // after payment is confirmed — never on the client's say-so.
  async grantNameChangeCredit(userId, n = 1) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.nameChangeCredits = (u.nameChangeCredits || 0) + Math.max(1, Math.round(n));
    return { nameChangeCredits: u.nameChangeCredits };
  },
  // Reversal counterpart of grantNameChangeCredit: claw back paid name-change
  // credits when a purchase is refunded/charged back. Only removes UNSPENT
  // credits — clamped at 0 so a player who already used the credit doesn't go
  // negative (degrades gracefully on a partially-spent grant).
  async revokeNameChangeCredit(userId, n = 1) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const have = u.nameChangeCredits || 0;
    const revoked = Math.min(have, Math.max(0, Math.round(n)));
    u.nameChangeCredits = have - revoked;
    return { nameChangeCredits: u.nameChangeCredits, revoked };
  },
  // Spend one name-change credit to set a new (already filter-validated) display
  // name. Refuses when the account has no credits. Distinct from setInitialName,
  // which is the one-time free onboarding pick.
  async changeName(userId, cleanName) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if ((u.nameChangeCredits || 0) <= 0) throw new Error("no name-change credits");
    u.nameChangeCredits -= 1;
    u.name = cleanName;
    u.avatar = (cleanName[0] || "A").toUpperCase();
    u.nameChosen = true;
    return { name: u.name, avatar: u.avatar, nameChangeCredits: u.nameChangeCredits };
  },
  // Persist the streamer-mode flag on the account. While on, the player's real
  // name is redacted in-match and the lobby shows a fixed decoy join code.
  async setStreamerMode(userId, enabled) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.streamerMode = !!enabled;
    return { streamerMode: u.streamerMode };
  },

  // ----- balances (currency-agnostic) -----
  async getBalance(userId, currency = DEFAULT_CURRENCY) {
    const u = users.get(userId);
    return u ? (u.balances[currency] ?? 0) : 0;
  },
  async adjustBalance(userId, currency, delta, reason) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const next = (u.balances[currency] ?? 0) + delta;
    if (next < 0) throw new Error("insufficient funds");
    u.balances[currency] = next;
    txLog.push({ userId, currency, delta, reason, at: new Date().toISOString() });
    return u.balances[currency];
  },
  // Debit up to `amount` of a currency, never going below 0. Used to claw back a
  // refunded/charged-back grant: if the player already spent some of what they
  // bought, we take back only what's left (degrades gracefully) instead of
  // throwing "insufficient funds" like adjustBalance would.
  async debitBalanceClamped(userId, currency, amount, reason) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const have = u.balances[currency] ?? 0;
    const debited = Math.min(have, Math.max(0, Math.round(amount)));
    u.balances[currency] = have - debited;
    txLog.push({ userId, currency, delta: -debited, reason, at: new Date().toISOString() });
    return { balance: u.balances[currency], debited };
  },

  // ----- rewarded ads (watch an ad -> Silver Nuggets, capped per Central day) -----
  // Lazy day reset: the stored { day, count } is treated as 0 once the Central-time
  // (America/Chicago) day rolls over. Status is safe to read anytime; claiming is the
  // ONLY path that grants currency and is fully server-authoritative — a client that
  // replays the endpoint still can't exceed AD_REWARD.dailyCap in a day.
  _adRewardState(u) {
    // Day key in US Central (DST-aware) so the daily cap resets at Central midnight,
    // not UTC midnight. en-CA formats as YYYY-MM-DD.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const count = u.adReward && u.adReward.day === today ? (u.adReward.count || 0) : 0;
    const cap = AD_REWARD.dailyCap;
    return { today, count, cap, remaining: Math.max(0, cap - count) };
  },
  async getAdReward(userId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const { count, cap, remaining } = this._adRewardState(u);
    return { amount: AD_REWARD.amount, currency: AD_REWARD.currency, cap, used: count, remaining };
  },
  async claimAdReward(userId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const { today, count, cap } = this._adRewardState(u);
    if (count >= cap) {
      const e = new Error("Daily ad limit reached — come back tomorrow.");
      e.status = 429;
      throw e;
    }
    u.adReward = { day: today, count: count + 1 };
    // Grant through the same audited funnel as every other currency change. When a
    // real ad network is added, call this from its SSV callback instead of the route.
    const balance = await this.adjustBalance(userId, AD_REWARD.currency, AD_REWARD.amount, "ad:rewarded");
    return { balance, amount: AD_REWARD.amount, currency: AD_REWARD.currency, cap, used: u.adReward.count, remaining: Math.max(0, cap - u.adReward.count) };
  },

  // ----- inventory -----
  async getInventory(userId) { return inventories.get(userId) || []; },
  async addItem(userId, item, rarity, source) {
    const inv = inventories.get(userId) || [];
    const entry = { id: uid(), item, rarity, source, acquiredAt: new Date().toISOString() };
    inv.unshift(entry);
    inventories.set(userId, inv);
    return entry;
  },

  // ----- progression -----
  // Award XP, recompute level, and grant any cosmetics tied to newly-reached
  // levels. Returns what changed so the API can show level-up rewards.
  async addXp(userId, amount, reason) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const prevLevel = u.level;
    u.xp += Math.max(0, Math.round(amount));
    u.level = levelForXp(u.xp);
    const newlyGranted = [];
    if (u.level > prevLevel) {
      for (let lvl = prevLevel + 1; lvl <= u.level; lvl++) {
        for (const cid of (LEVEL_UNLOCKS[lvl]?.grants || [])) {
          const isNew = !u.cosmetics.has(cid);
          u.cosmetics.add(cid);
          // Always record the level as a valid source — even if the cosmetic is
          // already owned (e.g. previously purchased). Otherwise a later refund of
          // that purchase would find no level source and wrongly strip a cosmetic
          // the player now also holds via this level unlock.
          addCosmeticSource(u, cid, `level:${lvl}`);
          if (isNew) newlyGranted.push(cid);
        }
      }
    }
    txLog.push({ userId, type: "xp", amount, reason, at: new Date().toISOString() });
    return { xp: u.xp, level: u.level, leveledUp: u.level > prevLevel, fromLevel: prevLevel, granted: newlyGranted };
  },

  // ----- cosmetics: ownership + equipping -----
  async grantCosmetic(userId, cosmeticId, source = null) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!COSMETICS[cosmeticId]) throw new Error("unknown cosmetic");
    const already = u.cosmetics.has(cosmeticId);
    u.cosmetics.add(cosmeticId);
    // Track WHERE this grant came from so a later refund only strips a cosmetic
    // still solely attributable to the refunded purchase.
    addCosmeticSource(u, cosmeticId, source);
    return { cosmeticId, newlyOwned: !already };
  },
  // Grant EVERY cosmetic in the catalogue at once (dev/test convenience). Tags
  // each with the given source so the refund/clawback bookkeeping stays sane.
  async grantAllCosmetics(userId, source = "admin:dev") {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    let granted = 0;
    for (const cid of Object.keys(COSMETICS)) {
      if (!u.cosmetics.has(cid)) granted++;
      u.cosmetics.add(cid);
      addCosmeticSource(u, cid, source);
    }
    return { granted, total: Object.keys(COSMETICS).length };
  },

  // ----- premium time ("Gold Trail" pass) -----
  // Live premium state for a user: whether the pass is currently active and when
  // it expires (raw ISO, even if already past, so the UI can say "expired").
  premiumState(u) {
    const until = u?.premiumUntil || null;
    const active = !!(until && new Date(until).getTime() > Date.now());
    return { premiumUntil: until, premium: active };
  },
  async getPremium(userId) { return this.premiumState(users.get(userId)); },
  // Sync helper: is this user's premium pass currently active?
  isPremium(u) { return this.premiumState(u).premium; },

  // ===================== FRONTIER LOYALTY (P4) =====================
  // Highest spend threshold among the milestones a user has already claimed. This
  // is the floor an inactivity reset can never drop lifetime spend below, so a
  // claimed milestone can never flip back to un-reached.
  _loyaltyClaimedFloor(u) {
    let floor = 0;
    for (const m of LOYALTY_MILESTONES) {
      if ((u.loyaltyClaimed || []).includes(m.id)) floor = Math.max(floor, m.spendCents);
    }
    return floor;
  },
  // Count a confirmed real-money payment toward lifetime spend (monotonic) and
  // stamp the spend time (drives the inactivity reset). Called exactly once per
  // delivered checkout session from the payments webhook.
  async recordSpend(userId, cents) {
    const u = users.get(userId);
    if (!u || !cents || cents <= 0) return null;
    u.lifetimeSpendCents = (u.lifetimeSpendCents || 0) + Math.round(cents);
    u.lastSpendAt = new Date().toISOString();
    return u.lifetimeSpendCents;
  },
  // Compute the loyalty ladder, applying the lazy inactivity reset: after
  // LOYALTY_INACTIVITY_MS with no spend, progress toward the NEXT milestone is
  // forfeited by clamping lifetime spend down to the highest CLAIMED floor
  // (claimed rewards are kept). Clamping to the floor is stable, so repeated
  // reads are idempotent.
  async getLoyalty(userId) {
    const u = users.get(userId);
    if (!u) return null;
    if (!Array.isArray(u.loyaltyClaimed)) u.loyaltyClaimed = [];
    let inactivityReset = false;
    if (u.lastSpendAt && Date.now() - new Date(u.lastSpendAt).getTime() > LOYALTY_INACTIVITY_MS) {
      const floor = this._loyaltyClaimedFloor(u);
      if ((u.lifetimeSpendCents || 0) > floor) { u.lifetimeSpendCents = floor; inactivityReset = true; }
    }
    const spend = u.lifetimeSpendCents || 0;
    const milestones = LOYALTY_MILESTONES.map((m) => {
      const claimed = u.loyaltyClaimed.includes(m.id);
      const reached = spend >= m.spendCents;
      return {
        id: m.id, label: m.label, spendCents: m.spendCents,
        premiumMs: m.premiumMs || 0, cosmetics: m.cosmetics || [],
        reached, claimed, claimable: reached && !claimed,
      };
    });
    return {
      lifetimeSpendCents: spend, lastSpendAt: u.lastSpendAt || null,
      inactivityMs: LOYALTY_INACTIVITY_MS, inactivityReset, milestones,
    };
  },
  // Claim a reached milestone exactly once: grant its exclusive cosmetics (tagged
  // source `loyalty:<id>` so refund clawback bookkeeping stays correct) and its
  // premium time. Re-validates the threshold server-side AFTER applying any
  // inactivity reset so a stale-progress claim can't slip through.
  async claimLoyalty(userId, milestoneId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const m = LOYALTY_MILESTONES.find((x) => x.id === milestoneId);
    if (!m) throw new Error("unknown milestone");
    await this.getLoyalty(userId); // apply inactivity reset before validating
    if (!Array.isArray(u.loyaltyClaimed)) u.loyaltyClaimed = [];
    if (u.loyaltyClaimed.includes(m.id)) return { alreadyClaimed: true, milestoneId: m.id };
    if ((u.lifetimeSpendCents || 0) < m.spendCents) throw new Error("milestone not reached");
    u.loyaltyClaimed.push(m.id);
    const granted = { cosmetics: [], premiumMs: 0 };
    for (const cid of (m.cosmetics || [])) {
      try {
        const g = await this.grantCosmetic(userId, cid, `loyalty:${m.id}`);
        await this.addItem(userId, cid, "Loyalty Reward", `loyalty:${m.id}`);
        granted.cosmetics.push({ cosmeticId: cid, newlyOwned: g.newlyOwned });
      } catch { /* skip an unknown cosmetic id; still grant the rest */ }
    }
    if (m.premiumMs) {
      try { await this.grantPremium(userId, m.premiumMs, `loyalty:${m.id}`); granted.premiumMs = m.premiumMs; } catch { /* non-fatal */ }
    }
    return { claimed: m.id, granted };
  },
  // Extend premium by `ms`, stacking from the later of now / current expiry so a
  // second grant adds time rather than resetting it.
  async grantPremium(userId, ms, source = null) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const add = Math.max(0, Math.round(ms));
    const now = Date.now();
    const cur = u.premiumUntil ? new Date(u.premiumUntil).getTime() : 0;
    const base = cur > now ? cur : now;
    u.premiumUntil = new Date(base + add).toISOString();
    txLog.push({ userId, type: "premium", ms: add, reason: source, at: new Date().toISOString() });
    return this.premiumState(u);
  },

  // ----- consumables (usable stash items -> currency or XP) -----
  // Definitions + this account's owned counts (for the Locker stash UI).
  async listConsumables(userId) {
    const u = users.get(userId);
    const owned = (u && u.consumables) || {};
    return { items: Object.values(CONSUMABLES).map((c) => ({ ...c, count: owned[c.id] || 0 })) };
  },
  async grantConsumable(userId, itemId, qty = 1) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!CONSUMABLES[itemId]) throw new Error("unknown consumable");
    const n = Math.max(1, Math.round(qty));
    if (!u.consumables || typeof u.consumables !== "object") u.consumables = {};
    u.consumables[itemId] = (u.consumables[itemId] || 0) + n;
    return { itemId, count: u.consumables[itemId] };
  },
  // Pop one: apply its reward (currency or XP) and decrement the owned count.
  async useConsumable(userId, itemId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const def = CONSUMABLES[itemId];
    if (!def) throw new Error("unknown consumable");
    if (!u.consumables || (u.consumables[itemId] || 0) < 1) throw new Error("none to use");
    u.consumables[itemId] -= 1;
    if (u.consumables[itemId] <= 0) delete u.consumables[itemId];
    const out = { itemId, remaining: u.consumables[itemId] || 0, type: def.type, name: def.name };
    if (def.type === "currency") {
      out.currency = def.currency;
      out.amount = def.amount;
      out.balance = await this.adjustBalance(userId, def.currency, def.amount, `consumable:${itemId}`);
    } else if (def.type === "xp") {
      out.amount = def.amount;
      out.xp = await this.addXp(userId, def.amount, `consumable:${itemId}`);
    }
    return out;
  },

  async getProfile(userId) {
    const u = users.get(userId);
    if (!u) return null;
    const unlocked = unlockedAt(u.level);
    return {
      id: u.id, name: u.name, avatar: u.avatar,
      xp: u.xp, level: u.level,
      balances: u.balances,
      owned: [...u.cosmetics],
      loadout: { ...u.loadout },
      unlockedSlots: unlocked.slots,
      unlockedPerks: unlocked.perks,
      // Onboarding signals so the client knows which steps remain.
      tosAcceptedAt: u.tosAcceptedAt || null,
      tosAccepted: !!u.tosAcceptedAt,
      nameChosen: !!u.nameChosen,
      // ----- paid name change & streamer mode (Task #4) -----
      nameChangeCredits: u.nameChangeCredits || 0,
      streamerMode: !!u.streamerMode,
      // ----- premium time + consumables (P2/P3) -----
      premiumUntil: u.premiumUntil || null,
      premium: !!(u.premiumUntil && new Date(u.premiumUntil).getTime() > Date.now()),
      consumables: { ...(u.consumables || {}) },
      // ----- profile/stats (Task #2) -----
      stats: { ...u.stats },
      matchHistory: u.matchHistory.slice(0, 10),
      achievements: ACHIEVEMENTS.map((a) => ({
        id: a.id, name: a.name, desc: a.desc, glyph: a.glyph,
        threshold: a.threshold, reward: a.reward,
        unlockedAt: u.achievements[a.id]?.unlockedAt || null,
        progress: progressFor(u, a),
      })),
      ownedAvatars: [...u.ownedAvatars],
      ownedBorders: [...u.ownedBorders],
      selectedAvatar: u.selectedAvatar,
      selectedBorder: u.selectedBorder,
      pendingAchievements: [...u.pendingAchievements],
      notices: [...(u.notices || [])],
      weekly: { ...u.weekly },
      // ----- social / karma (Task #3) -----
      karma: u.karma || 0,
      matchesSinceKarma: u.matchesSinceKarma || 0,
      friendCount: (u.friends || []).length,
      // karma already given, keyed by matchId, restricted to the last-10 history
      // window so the client can disable already-used targets in the recap UI.
      karmaGiven: Object.fromEntries(
        u.matchHistory.slice(0, 10)
          .map((h) => h.matchId)
          .filter((id) => id && Array.isArray(u.karmaGiven?.[id]))
          .map((id) => [id, [...u.karmaGiven[id]]])
      ),
    };
  },

  // ===================== PROFILE / STATS (Task #2) =====================
  // Ingest one finished match: award XP+Credits, roll lifetime stats, append a
  // detailed history row (capped at 10), update the weekly win-rate bucket, then
  // evaluate achievements and grant their avatar/border rewards. Idempotent per
  // achievement (unlockedAt guards re-grants). Guests (no userId) are skipped.
  // ---- Daily quests + login streak (SANDBOX GP) ----
  // Lazily rolls today's 3 quests and advances the login streak the first time
  // an account is touched each UTC day. Streak Seashells auto-credit once.
  async _ensureDaily(u) {
    if (!u.daily || typeof u.daily !== "object") u.daily = { day: null, quests: [], streak: { count: 0, lastDay: null } };
    const day = utcDay();
    if (u.daily.day !== day) {
      const prevDay = u.daily.streak?.lastDay;
      const count = prevDay === day - 1 ? (u.daily.streak.count || 0) + 1 : 1;
      u.daily = {
        day,
        quests: questsForDay(day).map((q) => ({ id: q.id, progress: 0, claimed: false })),
        streak: { count, lastDay: day, rewardedDay: null },
      };
      const pay = streakReward(count);
      u.daily.streak.rewardedDay = day;
      u.daily.streak.lastReward = pay;
      await this._credit(u, pay, `streak:day${count}`);
    }
    return u.daily;
  },

  async _credit(u, amount, reason) {
    if (!amount) return;
    try { await this.adjustBalance(u.id, "CREDITS", amount, reason); } catch {}
  },

  async _applyQuestProgress(u, p) {
    const daily = await this._ensureDaily(u);
    const derived = {
      races: 1,
      wins: p.won ? 1 : 0,
      podiums: (p.place != null && p.place <= 2) ? 1 : 0,
      splashesCaused: p.splashesCaused || 0,
      crumblesCaused: p.crumblesCaused || 0,
      itemsUsed: p.itemsUsed || 0,
      challenges: p.challenges || 0,
      sTiers: p.sTiers || 0,
    };
    for (const q of daily.quests) {
      const def = QUEST_POOL.find((d) => d.id === q.id);
      if (!def || q.claimed) continue;
      q.progress = Math.min(def.goal, q.progress + (derived[def.stat] || 0));
    }
  },

  async getDaily(userId) {
    const u = users.get(userId);
    if (!u) return null;
    const daily = await this._ensureDaily(u);
    return {
      day: daily.day,
      streak: { count: daily.streak.count, todayReward: daily.streak.lastReward ?? streakReward(daily.streak.count) },
      quests: daily.quests.map((q) => {
        const def = QUEST_POOL.find((d) => d.id === q.id) || {};
        return { id: q.id, label: def.label, goal: def.goal, reward: def.reward, progress: q.progress, claimed: q.claimed };
      }),
      balance: u.balances?.CREDITS ?? 0,
    };
  },

  // Rank ladder snapshot: current level + the next unlock, for the results tease.
  async getProgress(userId) {
    const u = users.get(userId);
    if (!u) return null;
    const xp = u.xp || 0;
    const level = levelForXp(xp);
    // find the next level that actually grants/unlocks something worth teasing
    let next = null;
    for (let lvl = level + 1; lvl <= level + 20; lvl++) {
      const row = LEVEL_UNLOCKS[lvl];
      if (row && (row.grants?.length || row.slots?.length || row.perks?.length)) {
        next = { level: lvl, note: row.note || "", grants: row.grants?.length || 0, xpNeeded: Math.max(0, xpForLevel(lvl) - xp) };
        break;
      }
    }
    if (!next) next = { level: level + 1, note: "Level up!", grants: 0, xpNeeded: Math.max(0, xpForLevel(level + 1) - xp) };
    return { xp, level, next };
  },

  async claimDailyQuest(userId, questId) {
    const u = users.get(userId);
    if (!u) return { error: "No such account." };
    const daily = await this._ensureDaily(u);
    const q = daily.quests.find((x) => x.id === questId);
    const def = QUEST_POOL.find((d) => d.id === questId);
    if (!q || !def) return { error: "No such quest today." };
    if (q.claimed) return { error: "Already claimed." };
    if (q.progress < def.goal) return { error: "Not complete yet." };
    q.claimed = true;
    await this._credit(u, def.reward, `quest:${questId}`);
    return { ok: true, reward: def.reward, balance: u.balances?.CREDITS ?? 0 };
  },

  // ---- Weekly best-lap leaderboard (time-trial mode) ----
  _recordTimeTrial(u, p) {
    if (!u.weeklyLap || typeof u.weeklyLap !== "object") u.weeklyLap = { weekKey: null, bestLapSec: null, totalSec: null };
    const wk = weekKey();
    if (u.weeklyLap.weekKey !== wk) u.weeklyLap = { weekKey: wk, bestLapSec: null, totalSec: null };
    if (p.bestLapSec > 0 && (u.weeklyLap.bestLapSec == null || p.bestLapSec < u.weeklyLap.bestLapSec)) {
      u.weeklyLap.bestLapSec = p.bestLapSec;
      u.weeklyLap.totalSec = p.totalSec ?? u.weeklyLap.totalSec;
    }
  },

  async weeklyBestLaps(limit = 10) {
    const wk = weekKey();
    const rows = [];
    for (const u of users.values()) {
      if (u.weeklyLap?.weekKey === wk && u.weeklyLap.bestLapSec > 0) {
        rows.push({ userId: u.id, name: u.name, bestLapSec: u.weeklyLap.bestLapSec, totalSec: u.weeklyLap.totalSec });
      }
    }
    rows.sort((a, b) => a.bestLapSec - b.bestLapSec);
    return { weekKey: wk, rows: rows.slice(0, limit) };
  },

  async ingestMatchResult({ matchId = null, winner = null, map = null, mode = null, laps = 3, participants = [] } = {}) {
    const out = [];
    const wk = weekKey();
    for (const p of participants) {
      if (!p?.userId) continue;
      const u = users.get(p.userId);
      if (!u) continue;

      // Idempotency: if this exact match was already ingested for this account,
      // skip it so a duplicate/replayed POST can't double-count. Guests (no
      // matchId) are never deduped. Keep the processed list capped.
      if (matchId) {
        if (!Array.isArray(u.processedMatches)) u.processedMatches = [];
        if (u.processedMatches.includes(matchId)) continue;
        u.processedMatches.push(matchId);
        if (u.processedMatches.length > 100) u.processedMatches = u.processedMatches.slice(-100);
      }

      // ---- Rewards (the match-end UI mirrors these exact rules) ----
      // RACE: place-based Seashells (1st 12 / 2nd 8 / 3rd 5 / 4th+ 3) + 50 XP
      // base +75 on a win. Both scale with lap count (laps/3, capped at 1) so a
      // 1-lap room pays a third — short-race farming earns no more per minute
      // than honest racing. TIME TRIAL: flat 2 Seashells + 30 XP; the weekly
      // lap board is the real prize, and a solo mode must never out-earn the
      // arena. Premium ("Gold Trail") multiplies both, mirrored in the UI.
      const lapsFactor = Math.min(1, Math.max(1, Number(laps) || 3) / 3);
      const PLACE_PAY = [12, 8, 5, 3];
      let baseXp, baseCredits;
      if (mode === "timetrial") {
        baseXp = 30;
        baseCredits = 2;
      } else {
        baseXp = Math.round((50 + (p.won ? 75 : 0)) * lapsFactor);
        baseCredits = Math.round((PLACE_PAY[Math.min((p.place || 4) - 1, 3)] || 3) * lapsFactor);
      }
      const premium = this.isPremium(u);
      const xp = premium ? Math.round(baseXp * PREMIUM_BONUS.xpMult) : baseXp;
      const credits = premium ? Math.round(baseCredits * PREMIUM_BONUS.creditMult) : baseCredits;
      let prog = null, balance;
      try { prog = await this.addXp(p.userId, xp, `match:${matchId || "?"}`); } catch {}
      try { balance = await this.adjustBalance(p.userId, "CREDITS", credits, `match:${matchId || "?"}`); } catch {}

      // SANDBOX GP: daily-quest progress (arena races only — a solo practice
      // mode must not tick "win/podium/race" quests) + weekly best-lap board
      if (mode !== "timetrial") { try { await this._applyQuestProgress(u, p); } catch {} }
      if (mode === "timetrial") { try { this._recordTimeTrial(u, p); } catch {} }

      // Lifetime stats
      const s = u.stats;
      const isImp = p.role === "impostor";
      s.matchesPlayed++;
      if (isImp) s.matchesAsImpostor++; else s.matchesAsCrew++;
      if (p.won) {
        s.wins++; if (isImp) s.winsAsImpostor++; else s.winsAsCrew++;
        s.winStreak++; s.bestWinStreak = Math.max(s.bestWinStreak, s.winStreak);
      } else {
        s.losses++; s.winStreak = 0;
      }
      s.tasksCompleted += p.tasksDone || 0;
      s.sabotages += p.sabotages || 0;
      s.impostorKills += p.kills || 0;
      if (p.survived) s.ejections++; // "ejections" tracks matches survived to the end

      // Detailed recent history (most-recent-first, last 10)
      u.matchHistory.unshift({
        matchId: matchId || null,
        at: new Date().toISOString(),
        map: map?.name || map?.id || "Unknown",
        mode: mode?.label || mode?.id || "Classic",
        role: p.role, won: !!p.won,
        tasksDone: p.tasksDone || 0, sabotages: p.sabotages || 0, kills: p.kills || 0,
        survived: !!p.survived,
        others: participants
          .filter((x) => x.userId !== p.userId)
          .map((x) => ({ userId: x.userId || null, name: x.name, role: x.role, won: !!x.won })),
      });
      if (u.matchHistory.length > 10) u.matchHistory.length = 10;

      // Karma decay: a match played without receiving karma increments the
      // "drought" counter. Once it exceeds 10 consecutive matches, the karma
      // score bleeds off by 1 per further match (floored at 0). Receiving karma
      // resets matchesSinceKarma to 0 (see giveKarma).
      u.matchesSinceKarma = (u.matchesSinceKarma || 0) + 1;
      if (u.matchesSinceKarma > 10 && u.karma > 0) u.karma = Math.max(0, u.karma - 1);

      // Weekly bucket (reset on week rollover)
      if (u.weekly.weekKey !== wk) u.weekly = { weekKey: wk, matches: 0, wins: 0 };
      u.weekly.matches++; if (p.won) u.weekly.wins++;

      // Achievements + reward grants
      const newly = evaluateAchievements(u);
      for (const ach of newly) {
        if (ach.reward?.avatar && !u.ownedAvatars.includes(ach.reward.avatar)) u.ownedAvatars.push(ach.reward.avatar);
        if (ach.reward?.border && !u.ownedBorders.includes(ach.reward.border)) u.ownedBorders.push(ach.reward.border);
        u.pendingAchievements.push(ach.id);
      }

      out.push({
        userId: p.userId, awarded: xp, credits, balance,
        ...(prog || {}),
        newAchievements: newly.map((a) => a.id),
      });
    }
    return out;
  },

  // Pick an owned avatar / border for the profile.
  async selectAvatar(userId, avatarId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!AVATARS[avatarId]) throw new Error("unknown avatar");
    if (!u.ownedAvatars.includes(avatarId)) throw new Error("you don't own that avatar");
    u.selectedAvatar = avatarId;
    return { selectedAvatar: avatarId };
  },
  async selectBorder(userId, borderId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!BORDERS[borderId]) throw new Error("unknown border");
    if (!u.ownedBorders.includes(borderId)) throw new Error("you don't own that border");
    u.selectedBorder = borderId;
    return { selectedBorder: borderId };
  },

  // Drain the freshly-unlocked toast queue (client calls this once it has shown them).
  async ackAchievements(userId) {
    const u = users.get(userId);
    if (!u) return { cleared: [] };
    const cleared = u.pendingAchievements || [];
    u.pendingAchievements = [];
    return { cleared };
  },

  // Drain the player-facing notice queue (e.g. restored-purchase banners) once the
  // client has shown them. Mirrors ackAchievements.
  async ackNotices(userId) {
    const u = users.get(userId);
    if (!u || !Array.isArray(u.notices)) return { cleared: [] };
    const cleared = u.notices.map((n) => n.id);
    u.notices = [];
    return { cleared };
  },

  // Weekly win-rate leaderboard. Only accounts with >= minMatches lifetime games
  // are ranked; the rate is computed from THIS week's bucket (0 if they haven't
  // played this week yet). Returns the board plus the caller's eligibility/standing.
  async getRankings(userId, { minMatches = 50, limit = 50 } = {}) {
    const wk = weekKey();
    const eligible = [];
    for (const u of users.values()) {
      if ((u.stats?.matchesPlayed || 0) < minMatches) continue;
      const w = (u.weekly && u.weekly.weekKey === wk) ? u.weekly : { matches: 0, wins: 0 };
      const winRate = w.matches > 0 ? w.wins / w.matches : 0;
      eligible.push({
        userId: u.id, name: u.name,
        avatar: u.selectedAvatar, border: u.selectedBorder,
        matches: w.matches, wins: w.wins,
        winRate: Math.round(winRate * 1000) / 10, // one-decimal percent
      });
    }
    eligible.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.matches - a.matches);
    const board = eligible.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
    const me = users.get(userId);
    const myMatches = me?.stats?.matchesPlayed || 0;
    return {
      weekKey: wk,
      minMatches,
      eligible: myMatches >= minMatches,
      needed: Math.max(0, minMatches - myMatches),
      board,
      you: board.find((e) => e.userId === userId) || null,
    };
  },

  // ===================== FRIENDS / KARMA / REPORTS (Task #3) =====================

  // A small public card for a user (used in friends lists and lookups).
  _userCard(u) {
    return u ? { id: u.id, name: u.name, avatar: u.selectedAvatar, border: u.selectedBorder } : null;
  },

  // Add a friend (one-directional). Mutual is derived when both sides have added
  // each other. Idempotent; can't friend yourself or a non-existent account.
  async addFriend(userId, targetId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!targetId || targetId === userId) throw new Error("invalid friend");
    const t = users.get(targetId);
    if (!t) throw new Error("that pilot doesn't exist");
    if (!u.friends.includes(targetId)) u.friends.push(targetId);
    return { ok: true, friend: { ...this._userCard(t), mutual: t.friends.includes(userId) } };
  },
  async removeFriend(userId, targetId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.friends = u.friends.filter((id) => id !== targetId);
    return { ok: true };
  },
  // List a user's friends with mutual flag and their public card.
  async listFriends(userId) {
    const u = users.get(userId);
    if (!u) return [];
    return u.friends
      .map((id) => {
        const f = users.get(id);
        if (!f) return null;
        return { ...this._userCard(f), mutual: f.friends.includes(userId) };
      })
      .filter(Boolean);
  },
  // Directional + mutual friendship between two users (for the game server to
  // gate invites and direct-joins). aFollowsB = a has added b.
  friendship(a, b) {
    const ua = users.get(a), ub = users.get(b);
    const aFollowsB = !!ua && ua.friends.includes(b);
    const bFollowsA = !!ub && ub.friends.includes(a);
    return { aFollowsB, bFollowsA, mutual: aFollowsB && bFollowsA };
  },

  // Give karma to one match participant. Cap: 2 distinct targets per match, once
  // each, never yourself. Bumps target karma, resets their drought counter, and
  // appends a karma-history entry. matchId is the round key (also a history key).
  async giveKarma(giverId, { matchId, targetId } = {}) {
    const giver = users.get(giverId);
    if (!giver) throw new Error("user not found");
    if (!matchId) throw new Error("matchId required");
    if (!targetId || targetId === giverId) throw new Error("invalid karma target");
    const target = users.get(targetId);
    if (!target) throw new Error("that pilot doesn't exist");
    // The match must be one the giver actually played, and still inside the last-10
    // history window (which is also what the client is allowed to act on). The target
    // must have been a fellow participant in that exact match.
    const entry = (giver.matchHistory || []).slice(0, 10).find((h) => h.matchId && h.matchId === matchId);
    if (!entry) throw new Error("you can only give karma for your recent matches");
    if (!(entry.others || []).some((o) => o.userId === targetId)) throw new Error("that pilot wasn't in that match");
    if (!giver.karmaGiven || typeof giver.karmaGiven !== "object") giver.karmaGiven = {};
    const given = giver.karmaGiven[matchId] || (giver.karmaGiven[matchId] = []);
    if (given.includes(targetId)) throw new Error("you already gave karma to that pilot");
    if (given.length >= 2) throw new Error("karma cap reached for this match (2)");
    given.push(targetId);
    target.karma = (target.karma || 0) + 1;
    target.matchesSinceKarma = 0; // receiving karma resets the decay drought
    target.karmaHistory.unshift({ from: giverId, matchId, at: new Date().toISOString() });
    if (target.karmaHistory.length > 50) target.karmaHistory.length = 50;
    return { ok: true, matchId, targetId, given: [...given] };
  },

  // File a moderation report. Stores reporter/reported/reason/match context as an
  // admin ticket. If the reporter opts in, we keep their email so a SINGLE
  // "reviewed/closed" confirmation can be sent on resolve (no email infra yet —
  // stubbed). The OUTCOME is never shared (privacy message returned to client).
  async createReport(reporterId, { reportedId, reason, matchId = null, context = null, optInEmail = false } = {}) {
    const reporter = users.get(reporterId);
    if (!reporter) throw new Error("user not found");
    if (!reportedId || reportedId === reporterId) throw new Error("invalid report target");
    const reported = users.get(reportedId);
    if (!reported) throw new Error("that pilot doesn't exist");
    if (!reason || !String(reason).trim()) throw new Error("a reason is required");
    const id = `tk_${uid()}`;
    const ticket = {
      id,
      reporterId, reporterName: reporter.name,
      reportedId, reportedName: reported.name,
      reason: String(reason).trim().slice(0, 1000),
      matchId: matchId || null,
      context: context ? String(context).slice(0, 500) : null,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null, resolvedBy: null,
      notifyEmail: optInEmail ? (reporter.email || null) : null,
      notified: false,
    };
    tickets.set(id, ticket);
    return {
      ok: true,
      ticketId: id,
      message: "We'll verify this. For privacy, we won't share the outcome.",
    };
  },
  // Admin: list tickets (newest first), optionally filtered by status.
  async listTickets({ status = null } = {}) {
    let list = [...tickets.values()];
    if (status) list = list.filter((t) => t.status === status);
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  },
  // Admin: mark a ticket "dealt with". If the reporter opted in and hasn't been
  // notified, "send" the single reviewed/closed confirmation (stubbed: logged,
  // never includes the outcome) and flag it sent.
  async resolveTicket(ticketId, adminId) {
    const t = tickets.get(ticketId);
    if (!t) throw new Error("ticket not found");
    if (t.status !== "dealt") {
      t.status = "dealt";
      t.resolvedAt = new Date().toISOString();
      t.resolvedBy = adminId || null;
    }
    if (t.notifyEmail && !t.notified) {
      // No email infrastructure yet — stub the single confirmation. NEVER includes
      // the moderation outcome, only that the report was reviewed and closed.
      console.log(`[reports] would email ${t.notifyEmail}: "Your report was reviewed and is now closed. Thanks for helping keep BRIDGE safe."`);
      t.notified = true;
    }
    return t;
  },

  // ----- news (admin-authored announcements; NEWS_SLOTS fixed slots) -----
  _newsBlank(slot) {
    return { slot, title: "", bannerUrl: "", shortDesc: "", bodyHtml: "",
      status: "draft", scheduledAt: null, publishedAt: null, updatedAt: null, rev: 0 };
  },
  // Lazily flip a due "scheduled" tile to "published" (no cron/timers). Called on
  // every read path so a scheduled tile goes live within one request of its time.
  _promoteIfDue(n) {
    if (n && n.status === "scheduled" && n.scheduledAt && Date.parse(n.scheduledAt) <= Date.now()) {
      n.status = "published";
      if (!n.publishedAt) n.publishedAt = n.scheduledAt;
    }
    return n;
  },
  _newsIsLive(n) {
    if (!n) return false;
    if (n.status === "published") return true;
    return n.status === "scheduled" && !!n.scheduledAt && Date.parse(n.scheduledAt) <= Date.now();
  },
  // Admin: all NEWS_SLOTS tiles (blanks filled in) for the authoring grid.
  async adminListNews() {
    const out = [];
    for (let slot = 1; slot <= NEWS_SLOTS; slot++) {
      out.push(this._promoteIfDue(newsSlots.get(slot)) || this._newsBlank(slot));
    }
    return out;
  },
  // Admin: create/update one tile. Bumps rev (drives the player "new" badge)
  // whenever the tile is or will be shown; draft edits don't bump.
  async saveNewsSlot(slot, patch = {}) {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > NEWS_SLOTS) throw new Error("Invalid news slot.");
    const cur = newsSlots.get(slot) || this._newsBlank(slot);
    const next = { ...cur };
    if (patch.title !== undefined) next.title = String(patch.title).slice(0, 200);
    if (patch.bannerUrl !== undefined) next.bannerUrl = String(patch.bannerUrl).slice(0, 2000);
    if (patch.shortDesc !== undefined) next.shortDesc = String(patch.shortDesc).slice(0, 500);
    if (patch.bodyHtml !== undefined) next.bodyHtml = String(patch.bodyHtml).slice(0, NEWS_BODY_MAX);
    if (patch.scheduledAt !== undefined) next.scheduledAt = patch.scheduledAt ? new Date(patch.scheduledAt).toISOString() : null;
    if (patch.status !== undefined) {
      const s = String(patch.status);
      if (!["draft", "published", "scheduled"].includes(s)) throw new Error("Invalid news status.");
      next.status = s;
    }
    // A "scheduled" tile with no future time is just published now.
    if (next.status === "scheduled" && (!next.scheduledAt || Date.parse(next.scheduledAt) <= Date.now())) {
      next.status = "published";
      next.scheduledAt = null;
    }
    next.updatedAt = new Date().toISOString();
    if (next.status === "published" || next.status === "scheduled") next.rev = (cur.rev || 0) + 1;
    if (next.status === "published" && !next.publishedAt) next.publishedAt = next.updatedAt;
    newsSlots.set(slot, next);
    return next;
  },
  async clearNewsSlot(slot) {
    return newsSlots.delete(Number(slot));
  },
  // Player: live tiles only (published, or scheduled past its time), with a
  // per-user "unread" flag from the account's last-seen rev.
  async listLiveNews(userId) {
    const u = users.get(userId);
    const seen = (u && u.newsSeen) || {};
    const out = [];
    for (let slot = 1; slot <= NEWS_SLOTS; slot++) {
      const n = this._promoteIfDue(newsSlots.get(slot));
      if (!this._newsIsLive(n)) continue;
      out.push({
        slot: n.slot, title: n.title, bannerUrl: n.bannerUrl, shortDesc: n.shortDesc,
        rev: n.rev, publishedAt: n.publishedAt || n.updatedAt,
        unread: (n.rev || 0) > (seen[slot] || 0),
      });
    }
    out.sort((a, b) => ((a.publishedAt || "") < (b.publishedAt || "") ? 1 : -1));
    return out;
  },
  // Player: the full HTML body for one live tile (fetched on expand).
  async getLiveNewsBody(slot) {
    const n = this._promoteIfDue(newsSlots.get(Number(slot)));
    if (!this._newsIsLive(n)) return null;
    return { slot: n.slot, title: n.title, bannerUrl: n.bannerUrl, shortDesc: n.shortDesc,
      bodyHtml: n.bodyHtml, rev: n.rev, publishedAt: n.publishedAt || n.updatedAt };
  },
  async markNewsSeen(userId, slot) {
    slot = Number(slot);
    const u = users.get(userId);
    if (!u) return false;
    if (!u.newsSeen || typeof u.newsSeen !== "object" || Array.isArray(u.newsSeen)) u.newsSeen = {};
    const n = newsSlots.get(slot);
    u.newsSeen[slot] = (n && n.rev) || 0;
    return true;
  },
  async newsUnreadCount(userId) {
    return (await this.listLiveNews(userId)).filter((n) => n.unread).length;
  },

  // ----- i18n / localization -----
  // Resolve one string for a locale, falling back to English (code default),
  // then finally the key itself so the UI never renders blank.
  _resolveString(key, lang) {
    const row = translations.get(key) || {};
    if (lang === DEFAULT_LOCALE) {
      // English: an admin override wins, else the code source-of-truth.
      if (row.humanEdited?.en && row.en) return row.en;
      return STRINGS[key] ?? key;
    }
    const t = row[lang];
    if (t) return t;
    return STRINGS[key] ?? key; // fall back to English default
  },
  // Public: the merged dictionary { key: string } for one locale. The client
  // caches this and looks up t(key).
  async getLocaleDict(lang) {
    if (!isLocale(lang)) lang = DEFAULT_LOCALE;
    const dict = {};
    for (const key of Object.keys(STRINGS)) dict[key] = this._resolveString(key, lang);
    return dict;
  },
  // Admin: every key with its English source, optional English override, each
  // translatable locale's value, and the per-locale human-edited flags.
  async adminListTranslations() {
    const rows = [];
    for (const key of Object.keys(STRINGS)) {
      const row = translations.get(key) || { humanEdited: {} };
      const out = { key, en: STRINGS[key], enOverride: row.en || "", humanEdited: { ...(row.humanEdited || {}) } };
      for (const lang of TRANSLATABLE_LOCALES) out[lang] = row[lang] || "";
      rows.push(out);
    }
    return { locales: LOCALE_CODES, translatable: TRANSLATABLE_LOCALES, rows };
  },
  // Admin: set one key/locale value. A non-empty save marks the locale
  // human-edited (protected from AI auto-translate); clearing it (empty string)
  // unsets the flag so auto-translate may refill it. `human` lets the AI seed
  // write without claiming a human edit.
  async saveTranslation(key, lang, value, { human = true } = {}) {
    if (!(key in STRINGS)) throw new Error("Unknown string key.");
    if (!isLocale(lang)) throw new Error("Unknown locale.");
    let row = translations.get(key);
    if (!row) { row = { en: "", humanEdited: {} }; for (const l of TRANSLATABLE_LOCALES) row[l] = ""; translations.set(key, row); }
    if (!row.humanEdited || typeof row.humanEdited !== "object") row.humanEdited = {};
    const val = value == null ? "" : String(value);
    if (lang === DEFAULT_LOCALE) row.en = val;
    else row[lang] = val;
    if (human) row.humanEdited[lang] = val.length > 0;
    else if (!row.humanEdited[lang]) row.humanEdited[lang] = false;
    return { key, lang, value: val, humanEdited: !!row.humanEdited[lang] };
  },
  // AI seed helper: keys still needing a machine translation for `lang` — i.e.
  // not human-edited and (when onlyMissing) currently blank. Returns
  // [{ key, en }] the caller feeds to the translator.
  async listTranslatable(lang, { onlyMissing = true } = {}) {
    if (!TRANSLATABLE_LOCALES.includes(lang)) return [];
    const out = [];
    for (const key of Object.keys(STRINGS)) {
      const row = translations.get(key) || { humanEdited: {} };
      if (row.humanEdited?.[lang]) continue;         // never overwrite a human edit
      if (onlyMissing && row[lang]) continue;        // skip already-filled machine values
      out.push({ key, en: STRINGS[key] });
    }
    return out;
  },
  // AI seed helper: bulk write machine translations (human:false) for a locale.
  // Skips any key that became human-edited in the meantime.
  async applyMachineTranslations(lang, pairs = []) {
    if (!TRANSLATABLE_LOCALES.includes(lang)) return 0;
    let n = 0;
    for (const { key, value } of pairs) {
      if (!(key in STRINGS)) continue;
      const row = translations.get(key);
      if (row?.humanEdited?.[lang]) continue;
      await this.saveTranslation(key, lang, value, { human: false });
      n++;
    }
    return n;
  },
  // Set an account's preferred UI language.
  async setUserLanguage(userId, lang) {
    const u = users.get(userId);
    if (!u) return null;
    if (!isLocale(lang)) throw new Error("Unknown locale.");
    u.language = lang;
    return u.language;
  },

  // Compact profile the GAME SERVER pulls on join: the equipped loadout (what
  // others see) and the perks this account has unlocked (to pool into the draft).
  async getMatchProfile(userId) {
    const u = users.get(userId);
    if (!u) return null;
    return {
      id: u.id, name: u.name, level: u.level,
      loadout: { ...u.loadout },          // includes bandana STYLE; color forced per match
      unlockedPerks: unlockedAt(u.level).perks,
      banned: u.moderation.banned,         // game server blocks banned players at join
      silenced: u.moderation.silenced,     // game server disables their voice/comms
      streamerMode: !!u.streamerMode,      // hide real name in-match + decoy join code

      eventFlags: await this.getEventFlags(userId), // active-event roles (bounty target, event host)
    };
  },
  async equipCosmetic(userId, cosmeticId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const cos = COSMETICS[cosmeticId];
    if (!cos) throw new Error("unknown cosmetic");
    if (!u.cosmetics.has(cosmeticId)) throw new Error("you don't own that cosmetic");
    const slot = SLOTS[cos.slot];
    const unlocked = unlockedAt(u.level).slots;
    if (!unlocked.includes(cos.slot)) throw new Error(`${slot.label} slot unlocks at level ${slot.unlockLevel}`);
    // A full-body costume (the `body` slot) is drawn over these overlay slots, so
    // reject equipping INTO a covered slot while a costume is worn (equipping the
    // body itself is always allowed). Stored values are kept so they reappear once
    // the costume is removed.
    if (COVERED_BY_BODY_SLOTS.includes(cos.slot) && u.loadout.body) {
      throw new Error("That slot is covered by your body costume — remove the costume to change it.");
    }
    u.loadout[cos.slot] = cosmeticId;
    return { slot: cos.slot, equipped: cosmeticId, loadout: { ...u.loadout } };
  },

  // Clear a non-essential slot (always-filled slots can't be emptied).
  async unequipSlot(userId, slotKey) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const slot = SLOTS[slotKey];
    if (!slot) throw new Error("unknown slot");
    if (slot.alwaysFilled) throw new Error(`${slot.label} can't be emptied — only reskinned`);
    delete u.loadout[slotKey];
    return { slot: slotKey, loadout: { ...u.loadout } };
  },

  // ----- settings (audio / graphics / accessibility / controls) -----
  async getSettings(userId) {
    const u = users.get(userId);
    if (!u) return null;
    return { settings: structuredClone(u.settings), wheels: structuredClone(u.wheels) };
  },
  // Merge + sanitize incoming settings over current (then over defaults).
  async updateSettings(userId, incoming) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    // Layer: defaults <- current <- incoming, all run through the sanitizer.
    const merged = { ...u.settings };
    for (const cat of Object.keys(incoming || {})) merged[cat] = { ...u.settings[cat], ...incoming[cat] };
    u.settings = sanitizeSettings(merged);
    return { settings: structuredClone(u.settings) };
  },

  // ----- radial wheels (emote + comms) -----
  // Bind an item to a wheel slot. Validates the item is legal for that wheel and
  // (for emotes) owned by the player. Pass null to clear a slot.
  async setWheelSlot(userId, wheel, slotIndex, itemKey) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (wheel !== "emote" && wheel !== "comms") throw new Error("unknown wheel");
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= WHEEL_SLOTS) throw new Error("bad slot index");
    if (itemKey !== null) {
      if (wheel === "emote") {
        const cos = COSMETICS[itemKey];
        if (!cos || cos.slot !== "emote") throw new Error("not an emote");
        if (!u.cosmetics.has(itemKey)) throw new Error("you don't own that emote");
      }
      // comms items are voice-command keys; the route validates against the catalogue.
    }
    u.wheels[wheel][slotIndex] = itemKey;
    return { wheel, slotIndex, itemKey, wheels: structuredClone(u.wheels) };
  },

  // ----- loot boxes -----
  async listBoxes() { return [...boxConfigs.values()]; },
  async getBox(boxId) { return boxConfigs.get(boxId) || null; },

  // ----- direct-purchase store items -----
  async listStoreItems() { return [...storeItems.values()]; },
  async getStoreItem(id) { return storeItems.get(id) || null; },

  // ----- admin: edit any store entry (item OR box) -----
  // Lets admins change the public price/currency AND the hidden worth/dropWeight.
  async adminListStore() {
    return { items: [...storeItems.values()], boxes: [...boxConfigs.values()] };
  },
  async adminUpdateStoreEntry(id, patch) {
    const target = storeItems.get(id) || boxConfigs.get(id);
    if (!target) throw new Error("No such store entry.");
    // Only allow known mutable fields.
    const allowed = ["name", "price", "priceCents", "currency", "enabled", "dropWeight", "worth"];
    for (const k of allowed) if (k in patch) target[k] = patch[k];
    return target;
  },
  async adminCreateStoreItem(data) {
    const id = data.id || ("si_" + uid());
    const it = { kind: "item", enabled: true, dropWeight: 10, worth: 0, ...data, id };
    storeItems.set(id, it);
    return it;
  },
  async adminDeleteStoreEntry(id) {
    return storeItems.delete(id) || boxConfigs.delete(id);
  },
  // Live store entry (item OR box) by id — used to snapshot before/after for the
  // admin audit trail on store edits. Returns the underlying object reference.
  async adminGetStoreEntry(id) {
    return storeItems.get(id) || boxConfigs.get(id) || null;
  },

  async upsertBox(box) { boxConfigs.set(box.id, box); return box; },

  // ----- codes -----
  async getCode(code) { return codes.get(code) || null; },
  async hasRedeemed(userId, code) { return codeRedemptions.has(`${userId}:${code}`); },
  async markRedeemed(userId, code) { codeRedemptions.set(`${userId}:${code}`, true); },
  async createCode(code, payload) { codes.set(code, payload); return { code, ...payload }; },

  // ----- paid-store checkout sessions (Stripe) -----
  // We record a pending session at checkout creation, then the webhook looks it
  // up to credit Prisms exactly once. Status guards against double-fulfillment.
  async createCheckoutSession(sessionId, payload) {
    // Persist the whole payload so both prism packs ({packId, prisms}) and item
    // carts ({kind:'items', grantCosmetics, totalCents}) round-trip intact.
    checkoutSessions.set(sessionId, { sessionId, status: "pending", createdAt: new Date().toISOString(), ...payload });
    return checkoutSessions.get(sessionId);
  },
  async getCheckoutSession(sessionId) { return checkoutSessions.get(sessionId) || null; },
  async fulfillCheckoutSession(sessionId) {
    const s = checkoutSessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    if (s.status === "fulfilled") return { ...s, alreadyFulfilled: true };
    s.status = "fulfilled";
    s.fulfilledAt = new Date().toISOString();
    return { ...s, alreadyFulfilled: false };
  },
  // Roll a freshly-claimed session back to pending when crediting/granting fails
  // AFTER the claim. Without this, a transient fulfillment error would leave the
  // session permanently "fulfilled" and every retry would short-circuit as
  // alreadyFulfilled — the player pays but never receives the purchase.
  async unclaimCheckoutSession(sessionId) {
    const s = checkoutSessions.get(sessionId);
    if (!s) return null;
    if (s.status === "fulfilled") { s.status = "pending"; delete s.fulfilledAt; }
    return s;
  },
  // Record the Stripe PaymentIntent on a session so a later refund/dispute event
  // (which references the charge's payment_intent, not the checkout session id)
  // can be traced back to the original fulfillment. Set-once.
  async linkPaymentIntent(sessionId, paymentIntent) {
    const s = checkoutSessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    if (paymentIntent && !s.paymentIntent) s.paymentIntent = paymentIntent;
    return s;
  },
  // Find the checkout session for a given PaymentIntent (the link Stripe refund /
  // dispute events carry). Returns null when no fulfilled session matches.
  async findCheckoutSessionByPaymentIntent(paymentIntent) {
    if (!paymentIntent) return null;
    for (const s of checkoutSessions.values()) if (s.paymentIntent === paymentIntent) return s;
    return null;
  },
  // Claim a session for reversal (refund/chargeback) exactly once. Mirrors
  // fulfillCheckoutSession: marks status=reversed so a replayed refund event is a
  // no-op. Only a previously-fulfilled session has anything to reverse.
  async reverseCheckoutSession(sessionId, reason = null) {
    const s = checkoutSessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    if (s.status === "reversed") return { ...s, alreadyReversed: true };
    if (s.status !== "fulfilled") return { ...s, notFulfilled: true };
    s.status = "reversed";
    s.reversedAt = new Date().toISOString();
    if (reason) s.reversalReason = reason;
    return { ...s, alreadyReversed: false };
  },
  // Roll a freshly-claimed reversal back to fulfilled when the clawback work
  // fails AFTER the claim, so a Stripe retry of the refund event can complete.
  async unreverseCheckoutSession(sessionId) {
    const s = checkoutSessions.get(sessionId);
    if (!s) return null;
    if (s.status === "reversed") { s.status = "fulfilled"; delete s.reversedAt; delete s.reversalReason; }
    return s;
  },

  // ----- admin reversal log + restore (Task #13) -----
  // Human-facing record of every clawed-back purchase: which account, which
  // session, the Stripe event type that caused it, what was taken back, and when.
  // Includes sessions an admin later RESTORED so the console reads as a log, not
  // just a to-do list. Newest activity first.
  //
  // As the log grows, admins can narrow it:
  //   status: "reversed" (still clawed back / needs action) | "restored" (already
  //           re-granted) | "all". Defaults to "all".
  //   query:  free-text match against player name / email / id (case-insensitive).
  // Still-reversed (restorable) sessions always lead so actionable items aren't
  // buried under restored history.
  //
  // The log can grow to thousands of entries on a busy store, so results are
  // paginated: limit (default 50, capped at 200) + offset slice the sorted list.
  // Returns { reversals, total, hasMore } so the console can page without
  // shipping the whole history in one response. total/hasMore reflect the full
  // filtered set (after status + query), not just the returned page.
  async adminListReversals({ status = "all", query = null, from = null, to = null, limit = 50, offset = 0 } = {}) {
    const q = query ? String(query).trim().toLowerCase() : "";
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    // Date-range narrowing (Task #25): from/to are date-only (yyyy-mm-dd) strings.
    // Treat them as an inclusive UTC window; an entry matches if its reversal OR
    // restore timestamp lands inside it, so admins can jump to an incident window.
    const fromTs = from && !Number.isNaN(Date.parse(from)) ? Date.parse(from) : null;
    const toTs = to && !Number.isNaN(Date.parse(to)) ? Date.parse(to) + 86400000 - 1 : null;
    const inRange = (ts) => {
      if (!ts) return false;
      const t = Date.parse(ts);
      if (Number.isNaN(t)) return false;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      return true;
    };
    const out = [];
    for (const s of checkoutSessions.values()) {
      if (s.status !== "reversed" && !s.restoredAt) continue;
      const isRestored = !!s.restoredAt;
      if (status === "reversed" && isRestored) continue;
      if (status === "restored" && !isRestored) continue;
      if (fromTs != null || toTs != null) {
        if (!inRange(s.reversedAt) && !inRange(s.restoredAt)) continue;
      }
      const u = users.get(s.userId);
      if (q) {
        const hay = `${u?.name || ""} ${u?.email || ""} ${s.userId || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({
        sessionId: s.sessionId,
        userId: s.userId,
        userName: u?.name || null,
        userEmail: u?.email || null,
        status: s.status,                       // "reversed" (restorable) | "fulfilled" (already restored)
        kind: s.kind === "items" ? "items" : "pack",
        packId: s.packId || null,
        prisms: s.prisms || 0,
        grantCosmetics: s.grantCosmetics || [],
        grantNameChanges: s.grantNameChanges || 0,
        itemNames: s.itemNames || [],
        reversalReason: s.reversalReason || null, // Stripe event type (charge.refunded | charge.dispute.created)
        reversedAt: s.reversedAt || null,
        restoredAt: s.restoredAt || null,
        restoredBy: s.restoredBy || null,
        createdAt: s.createdAt || null,
      });
    }
    // Lead with still-actionable (un-restored) sessions, then sort each group by
    // most recent activity (restore time if restored, else reversal time).
    out.sort((a, b) => {
      const aRestored = !!a.restoredAt, bRestored = !!b.restoredAt;
      if (aRestored !== bRestored) return aRestored ? 1 : -1;
      return String(b.restoredAt || b.reversedAt || "").localeCompare(String(a.restoredAt || a.reversedAt || ""));
    });
    const total = out.length;
    const page = out.slice(off, off + lim);
    return { reversals: page, total, hasMore: off + page.length < total };
  },
  // Re-grant the exact items a reversed session originally handed out, then flip
  // the session back to fulfilled. The inverse of applyReversal — used when a
  // chargeback is later won/reversed in the merchant's favor so the player was
  // wrongly stripped. Only acts on a session currently in the "reversed" state;
  // a second call is a guarded no-op (notReversed). Records who restored it.
  async restoreCheckoutSession(sessionId, adminUserId = null) {
    const s = checkoutSessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    if (s.status !== "reversed") return { ...s, notReversed: true };

    const restored = {};
    if (s.kind === "items") {
      const granted = [];
      for (const cosmeticId of (s.grantCosmetics || [])) {
        const g = await this.grantCosmetic(s.userId, cosmeticId);
        await this.addItem(s.userId, cosmeticId, "Restored", `stripe:restore:${sessionId}`);
        granted.push({ cosmeticId, newlyOwned: g.newlyOwned });
      }
      restored.grantedItems = granted;
      if (s.grantNameChanges > 0) {
        ({ nameChangeCredits: restored.nameChangeCredits } =
          await this.grantNameChangeCredit(s.userId, s.grantNameChanges));
      }
    } else {
      restored.credited = s.prisms || 0;
      restored.balance = await this.adjustBalance(s.userId, "PREMIUM", s.prisms || 0, `stripe:restore:${sessionId}`);
    }

    s.status = "fulfilled";
    delete s.reversedAt;
    delete s.reversalReason;
    s.restoredAt = new Date().toISOString();
    s.restoredBy = adminUserId;

    // Close the loop with the player: a wrongly-reversed purchase silently
    // reappearing is confusing, so queue an in-app notice (drained by the client
    // like the achievement toasts) naming exactly what was put back, and stub the
    // same email path used for moderation tickets.
    this._notifyRestore(s);
    return { ...s, restored };
  },

  // Build a human-readable list of what a restored session put back, push a notice
  // onto the player's queue, and "send" the stubbed confirmation email. Only called
  // from restoreCheckoutSession after a real (non-no-op) restore, so it never fires
  // for the guarded already-restored case.
  _notifyRestore(s) {
    const u = users.get(s.userId);
    if (!u) return null;
    const parts = [];
    if (s.kind === "items") {
      const names = (s.itemNames && s.itemNames.length)
        ? [...s.itemNames]
        : (s.grantCosmetics || []).map((id) => COSMETICS[id]?.name || id);
      parts.push(...names);
      if (s.grantNameChanges > 0) {
        parts.push(`${s.grantNameChanges} name-change credit${s.grantNameChanges === 1 ? "" : "s"}`);
      }
    } else if (s.prisms > 0) {
      parts.push(`${s.prisms} Gold Nuggets`);
    }
    const summary = parts.length ? parts.join(", ") : "your purchase";
    const notice = {
      id: `nt_${uid()}`,
      kind: "restore",
      items: parts,
      text: `An admin restored ${summary} to your account.`,
      at: new Date().toISOString(),
    };
    if (!Array.isArray(u.notices)) u.notices = [];
    u.notices.unshift(notice);
    if (u.notices.length > 50) u.notices.length = 50;
    if (u.email) {
      // No email infrastructure yet — stub the confirmation (matches resolveTicket).
      console.log(`[reversals] would email ${u.email}: "Good news — an admin restored ${summary} to your BRIDGE account."`);
    }
    return notice;
  },

  // ===================== ADMIN =====================
  // Find by id, exact email, or name substring (for the lookup screen).
  async adminSearchUsers(query, limit = 25) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const u of users.values()) {
      if (u.id === q || (u.email || "").toLowerCase() === q || (u.name || "").toLowerCase().includes(q)) {
        out.push(this._adminUserSummary(u));
        if (out.length >= limit) break;
      }
    }
    return out;
  },
  _adminUserSummary(u) {
    return {
      id: u.id, name: u.name, email: u.email, avatar: u.avatar,
      level: u.level, xp: u.xp, balances: { ...u.balances },
      adminRole: u.adminRole, moderation: { ...u.moderation },
      ownedCount: u.cosmetics.size,
    };
  },
  // Full detail for one account (admin view): everything they have. Includes
  // per-cosmetic acquisition sources so an admin can reverse a single grant
  // (e.g. a loot-box drop) instead of hard-wiping every source attribution.
  async adminGetUser(userId) {
    const u = users.get(userId);
    if (!u) return null;
    // Per-cosmetic acquisition sources (read-only): cosmeticId -> [source tags].
    // Plain-object-of-arrays in the store; return a defensive copy (only for
    // currently-owned cosmetics) so callers can't mutate the live account.
    const cosmeticSources = {};
    for (const [cid, srcs] of Object.entries(u.cosmeticSources || {})) {
      if (u.cosmetics.has(cid) && Array.isArray(srcs)) cosmeticSources[cid] = [...srcs];
    }
    return { ...this._adminUserSummary(u), owned: [...u.cosmetics], loadout: { ...u.loadout }, cosmeticSources };
  },

  // ----- player segmentation + usage analytics (admin) -----
  // Average matches played per day since the account was created. Age is floored
  // at one day so a brand-new, very active account doesn't report a wild number.
  _playsPerDay(u) {
    const created = u.createdAt ? new Date(u.createdAt).getTime() : Date.now();
    const ageDays = Math.max(1, (Date.now() - created) / 86400000);
    return Math.round(((u.stats?.matchesPlayed || 0) / ageDays) * 100) / 100;
  },
  // Summary + the extra fields the segment search surfaces per account. Keeps the
  // cosmetic ids distinct from the summary's google-avatar URL.
  _segmentRow(u) {
    const avatar = u.selectedAvatar || DEFAULT_AVATAR;
    const border = u.selectedBorder || DEFAULT_BORDER;
    return {
      ...this._adminUserSummary(u),
      music: u.settings?.audio?.music ?? null,
      colorblind: !!u.settings?.accessibility?.colorblindShapes,
      streamerMode: !!u.streamerMode,
      selectedAvatar: avatar,
      avatarName: AVATARS[avatar]?.name || avatar,
      selectedBorder: border,
      borderName: BORDERS[border]?.name || border,
      matchesPlayed: u.stats?.matchesPlayed || 0,
      playsPerDay: this._playsPerDay(u),
    };
  },
  // Find accounts matching a combination of settings / cosmetic / activity
  // criteria (all optional, AND-combined). Paginated like the other admin lists.
  async adminSegmentUsers(opts = {}) {
    const {
      colorblind = "", streamer = "", musicOp = "", musicValue = null,
      avatar = "", border = "", cosmetic = "", cosmeticMode = "owned",
      ppdOp = "", ppdValue = null, limit = 50, offset = 0,
    } = opts;
    const cmp = (val, op, target) => {
      if (target == null || !Number.isFinite(Number(target))) return true;
      const t = Number(target);
      if (op === "gte") return val >= t;
      if (op === "lte") return val <= t;
      if (op === "eq") return val === t;
      return true;
    };
    const matches = [];
    for (const u of users.values()) {
      if (colorblind === "on" && !u.settings?.accessibility?.colorblindShapes) continue;
      if (colorblind === "off" && u.settings?.accessibility?.colorblindShapes) continue;
      if (streamer === "on" && !u.streamerMode) continue;
      if (streamer === "off" && u.streamerMode) continue;
      if (musicOp && !cmp(u.settings?.audio?.music ?? 0, musicOp, musicValue)) continue;
      if (avatar && (u.selectedAvatar || DEFAULT_AVATAR) !== avatar) continue;
      if (border && (u.selectedBorder || DEFAULT_BORDER) !== border) continue;
      if (cosmetic) {
        const owns = u.cosmetics.has(cosmetic);
        const equipped = Object.values(u.loadout || {}).includes(cosmetic);
        if (cosmeticMode === "equipped" ? !equipped : !owns) continue;
      }
      if (ppdOp && !cmp(this._playsPerDay(u), ppdOp, ppdValue)) continue;
      matches.push(u);
    }
    matches.sort((a, b) => this._playsPerDay(b) - this._playsPerDay(a));
    const total = matches.length;
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const page = matches.slice(off, off + lim).map((u) => this._segmentRow(u));
    return { results: page, total, hasMore: off + page.length < total };
  },
  // Aggregate adoption/usage analytics across all accounts: which avatars,
  // borders, and cosmetics are most/least equipped/owned/purchased, plus the
  // adoption of accessibility/streamer toggles and music-volume levels. The
  // catalogue arrays double as the option lists for the segment-search filters.
  async adminUsageStats() {
    const all = [...users.values()];
    const total = all.length;
    const avatarCounts = {}; const borderCounts = {};
    const owned = {}; const equipped = {}; const purchased = {};
    let colorblindOn = 0; let streamerOn = 0;
    let musicSum = 0; const musicBuckets = { muted: 0, low: 0, mid: 0, high: 0 };
    for (const u of all) {
      const av = u.selectedAvatar || DEFAULT_AVATAR;
      const bd = u.selectedBorder || DEFAULT_BORDER;
      avatarCounts[av] = (avatarCounts[av] || 0) + 1;
      borderCounts[bd] = (borderCounts[bd] || 0) + 1;
      for (const cid of u.cosmetics) owned[cid] = (owned[cid] || 0) + 1;
      for (const eq of Object.values(u.loadout || {})) if (eq) equipped[eq] = (equipped[eq] || 0) + 1;
      for (const [cid, srcs] of Object.entries(u.cosmeticSources || {})) {
        if (u.cosmetics.has(cid) && Array.isArray(srcs) && srcs.some((s) => String(s).startsWith("stripe"))) {
          purchased[cid] = (purchased[cid] || 0) + 1;
        }
      }
      if (u.settings?.accessibility?.colorblindShapes) colorblindOn++;
      if (u.streamerMode) streamerOn++;
      const m = u.settings?.audio?.music ?? 0;
      musicSum += m;
      if (m === 0) musicBuckets.muted++;
      else if (m <= 33) musicBuckets.low++;
      else if (m <= 66) musicBuckets.mid++;
      else musicBuckets.high++;
    }
    const avatars = Object.values(AVATARS).map((a) => ({ id: a.id, name: a.name, count: avatarCounts[a.id] || 0 }))
      .sort((a, b) => b.count - a.count);
    const borders = Object.values(BORDERS).map((b) => ({ id: b.id, name: b.name, count: borderCounts[b.id] || 0 }))
      .sort((a, b) => b.count - a.count);
    const cosmetics = Object.values(COSMETICS).map((c) => ({
      id: c.id, name: c.name, slot: c.slot, rarity: c.rarity,
      owned: owned[c.id] || 0, equipped: equipped[c.id] || 0, purchased: purchased[c.id] || 0,
    })).sort((a, b) => b.owned - a.owned);
    return {
      total,
      settings: {
        colorblindOn, colorblindOff: total - colorblindOn,
        streamerOn, streamerOff: total - streamerOn,
        musicAvg: total ? Math.round(musicSum / total) : 0,
        musicBuckets,
      },
      avatars, borders, cosmetics,
    };
  },

  // ----- admin role management (superadmin only — enforced in the route) -----
  async setAdminRole(userId, role /* null | "admin" | "superadmin" */) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const before = u.adminRole ?? null;
    u.adminRole = role;
    return { userId, adminRole: role, before, after: role ?? null };
  },
  async listAdmins() {
    return [...users.values()].filter((u) => u.adminRole).map((u) => this._adminUserSummary(u));
  },

  // ----- moderation: ban + silence -----
  async setBan(userId, { banned, durationMs = null, reason = null }) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.moderation.banned = !!banned;
    u.moderation.banReason = banned ? reason : null;
    u.moderation.banUntil = banned && durationMs ? new Date(Date.now() + durationMs).toISOString() : null; // null = permanent (if banned) or N/A
    return { userId, moderation: { ...u.moderation } };
  },
  async setSilence(userId, silenced) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.moderation.silenced = !!silenced;
    return { userId, moderation: { ...u.moderation } };
  },
  // Effective ban check (auto-expires temp bans).
  async isBanned(userId) {
    const u = users.get(userId);
    if (!u || !u.moderation.banned) return { banned: false };
    if (u.moderation.banUntil && new Date(u.moderation.banUntil) <= new Date()) {
      u.moderation.banned = false; u.moderation.banUntil = null; u.moderation.banReason = null;
      return { banned: false };
    }
    return { banned: true, until: u.moderation.banUntil, reason: u.moderation.banReason };
  },

  // ----- grant / remove (single) -----
  async removeCosmetic(userId, cosmeticId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const had = u.cosmetics.delete(cosmeticId);
    delete u.cosmeticSources?.[cosmeticId];
    // If it was equipped, drop it from the loadout (unless an always-filled slot).
    for (const [slot, eq] of Object.entries(u.loadout)) {
      if (eq === cosmeticId && !SLOTS[slot]?.alwaysFilled) delete u.loadout[slot];
    }
    return { userId, cosmeticId, removed: had };
  },
  // Refund-safe clawback: drop ONE acquisition source for a cosmetic (the
  // refunded purchase). The cosmetic is only actually removed when no other valid
  // source (loot box, gift, level unlock, code, another purchase) still holds it,
  // so a player who legitimately re-acquired the same item keeps it. Returns
  // whether the cosmetic was removed and how many sources remain.
  async removeCosmeticSource(userId, cosmeticId, source) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!u.cosmeticSources || typeof u.cosmeticSources !== "object" || Array.isArray(u.cosmeticSources)) {
      u.cosmeticSources = {};
    }
    const sources = Array.isArray(u.cosmeticSources[cosmeticId]) ? u.cosmeticSources[cosmeticId] : [];
    // Remove exactly ONE matching source occurrence (this refunded purchase).
    const idx = sources.indexOf(source);
    if (idx !== -1) sources.splice(idx, 1);
    const remaining = sources.length;
    let removed = false;
    if (remaining === 0) {
      // No other source still holds the cosmetic — take it back.
      removed = u.cosmetics.delete(cosmeticId);
      delete u.cosmeticSources[cosmeticId];
      for (const [slot, eq] of Object.entries(u.loadout)) {
        if (eq === cosmeticId && !SLOTS[slot]?.alwaysFilled) delete u.loadout[slot];
      }
    } else {
      u.cosmeticSources[cosmeticId] = sources;
    }
    return { userId, cosmeticId, removed, remainingSources: remaining };
  },
  // ----- admin action audit trail -----
  // Record one admin action so who-did-what-to-whom is traceable for disputes and
  // mistakes. Covers cosmetics (grant / remove / single-source reversal), currency
  // adjustments (currency-grant / currency-remove / currency-set), and moderation
  // (ban / unban / silence / unsilence). Stored as a plain object so it survives
  // the JSON snapshot round-trip; capped so it can't grow without bound. Read back
  // newest-first via listAdminActions.
  async recordAdminAction({
    adminId, targetUserId, action,
    cosmeticId = null, source = null,
    currency = null, amount = null, before = null, after = null,
    reason = null, detail = null, entityId = null,
  }) {
    const entry = {
      id: `aa_${uid()}`,
      at: new Date().toISOString(),
      adminId: adminId ?? null,
      targetUserId: targetUserId ?? null,
      action,                 // cosmetic: "grant"|"remove"|"reverse"; currency: "currency-grant"|"currency-remove"|"currency-set"; moderation: "ban"|"unban"|"silence"|"unsilence"; store: "store-create"|"store-update"|"store-delete"; event: "event-create"|"event-update"|"event-delete"|"event-flag"|"event-unflag"
      cosmeticId,
      entityId,               // store entry id (item/box) for store-* actions, or event id for event-* actions; null for purely user-scoped actions
      source,                 // the single source reversed, when action === "reverse"
      currency,               // "CREDITS" | "PREMIUM" for currency actions
      amount,                 // delta applied for grant/remove (positive number)
      before,                 // balance before a currency change
      after,                  // balance after a currency change
      reason,                 // free-text reason (ban reason, etc.)
      detail,                 // optional extra (cosmetic { removed, remainingSources }, ban { durationMs, banUntil }, store { before, after } field diff)
    };
    adminActions.push(entry);
    if (adminActions.length > 5000) adminActions.splice(0, adminActions.length - 5000);
    return entry;
  },
  // Recent admin actions targeting one account, newest first. Each entry is
  // enriched with the acting admin's + target's current display name/email
  // (like listAllAdminActions) so per-account exports mirror the global feed.
  async listAdminActions(targetUserId, { limit = 50, offset = 0 } = {}) {
    const matched = [];
    for (let i = adminActions.length - 1; i >= 0; i--) {
      if (adminActions[i].targetUserId === targetUserId) matched.push(adminActions[i]);
    }
    const total = matched.length;
    const lim = Math.max(1, Math.min(200, Math.round(limit) || 50));
    const off = Math.max(0, Math.round(offset) || 0);
    const actions = matched.slice(off, off + lim).map((a) => {
      const admin = a.adminId ? users.get(a.adminId) : null;
      const target = a.targetUserId ? users.get(a.targetUserId) : null;
      return {
        ...a,
        adminName: admin?.name || null,
        targetName: target?.name || null,
        targetEmail: target?.email || null,
      };
    });
    return { actions, total, hasMore: off + actions.length < total };
  },
  // Global admin-action feed across EVERY account, newest first, for supervisors
  // hunting a rogue or mistaken admin. Optionally filter by acting admin and/or
  // target account (each matches id exactly, name substring, or email exactly).
  // Each returned entry is enriched with the admin's + target's current display
  // name/email so the UI need not look them up. Paginated like the reversal log.
  async listAllAdminActions({ adminQuery = "", targetQuery = "", limit = 50, offset = 0 } = {}) {
    const aq = String(adminQuery || "").trim().toLowerCase();
    const tq = String(targetQuery || "").trim().toLowerCase();
    const matchUser = (id, q) => {
      if (!q) return true;
      if (!id) return false;
      if (String(id).toLowerCase() === q) return true;
      const u = users.get(id);
      if (!u) return false;
      return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase() === q;
    };
    const matched = [];
    for (let i = adminActions.length - 1; i >= 0; i--) {
      const a = adminActions[i];
      if (!matchUser(a.adminId, aq)) continue;
      if (!matchUser(a.targetUserId, tq)) continue;
      matched.push(a);
    }
    const total = matched.length;
    const lim = Math.max(1, Math.min(200, Math.round(limit) || 50));
    const off = Math.max(0, Math.round(offset) || 0);
    const actions = matched.slice(off, off + lim).map((a) => {
      const admin = a.adminId ? users.get(a.adminId) : null;
      const target = a.targetUserId ? users.get(a.targetUserId) : null;
      return {
        ...a,
        adminName: admin?.name || null,
        targetName: target?.name || null,
        targetEmail: target?.email || null,
      };
    });
    return { actions, total, hasMore: off + actions.length < total };
  },

  // setBalance lets admins set an exact value; adjust uses the existing method.
  async setBalance(userId, currency, value) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const before = u.balances[currency] ?? 0;
    u.balances[currency] = Math.max(0, Math.round(value));
    return { userId, currency, before, balance: u.balances[currency] };
  },

  // ----- bulk operations -----
  // Apply a gift (item and/or currency) to many accounts; returns per-user result.
  async bulkGrant(userIds, { cosmeticId = null, currency = null, amount = 0 }) {
    const results = [];
    for (const id of userIds) {
      const u = users.get(id);
      if (!u) { results.push({ userId: id, ok: false, error: "not found" }); continue; }
      if (cosmeticId && COSMETICS[cosmeticId]) {
        u.cosmetics.add(cosmeticId);
        addCosmeticSource(u, cosmeticId, "gift");
      }
      if (currency && amount) u.balances[currency] = (u.balances[currency] ?? 0) + Math.round(amount);
      results.push({ userId: id, ok: true });
    }
    return results;
  },
  async bulkRemove(userIds, { cosmeticId = null, currency = null, amount = 0 }) {
    const results = [];
    for (const id of userIds) {
      const u = users.get(id);
      if (!u) { results.push({ userId: id, ok: false, error: "not found" }); continue; }
      if (cosmeticId) u.cosmetics.delete(cosmeticId);
      if (currency && amount) u.balances[currency] = Math.max(0, (u.balances[currency] ?? 0) - Math.round(amount));
      results.push({ userId: id, ok: true });
    }
    return results;
  },
  // For "gift everyone" style ops.
  async allUserIds() { return [...users.keys()]; },

  // ===================== EVENTS =====================
  async createEvent({ name, type = "generic", mode = null, startsAt, endsAt, config: cfg = {}, reward = {} }) {
    const id = "ev_" + (nextId++);
    const ev = {
      id, name: name || id, type, mode,
      startsAt: startsAt || new Date().toISOString(),
      endsAt: endsAt || null,            // null = open-ended until disabled
      config: cfg || {},
      reward: normalizeReward(reward),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    events.set(id, ev);
    return ev;
  },
  async updateEvent(id, patch) {
    const ev = events.get(id);
    if (!ev) throw new Error("event not found");
    if (patch.reward) patch.reward = normalizeReward(patch.reward);
    Object.assign(ev, patch);
    return ev;
  },
  async getEvent(id) { return events.get(id) || null; },
  async listEvents() { return [...events.values()]; },
  async deleteEvent(id) { return events.delete(id); },

  // Events active right now (enabled + within window).
  async activeEvents() {
    const now = Date.now();
    return [...events.values()].filter((ev) => {
      if (!ev.enabled) return false;
      if (ev.startsAt && new Date(ev.startsAt).getTime() > now) return false;
      if (ev.endsAt && new Date(ev.endsAt).getTime() < now) return false;
      return true;
    });
  },

  // ----- per-account event flags -----
  async setEventFlag(eventId, userId, flag, meta = {}) {
    if (!events.has(eventId)) throw new Error("event not found");
    if (!EVENT_FLAGS[flag]) throw new Error("unknown event flag");
    if (!users.has(userId)) throw new Error("user not found");
    eventFlags.set(`${eventId}:${userId}`, { eventId, userId, flag, meta });
    return { eventId, userId, flag };
  },
  async clearEventFlag(eventId, userId) {
    return eventFlags.delete(`${eventId}:${userId}`);
  },
  async getEventFlags(userId) {
    // Only flags for currently-active events matter at match time.
    const active = new Set((await this.activeEvents()).map((e) => e.id));
    const out = [];
    for (const f of eventFlags.values()) if (f.userId === userId && active.has(f.eventId)) out.push(f);
    return out;
  },
  async listEventFlags(eventId) {
    return [...eventFlags.values()].filter((f) => f.eventId === eventId);
  },

  // ----- bounty claims -----
  // Claim a bounty: single claim per (event, target). Grants the event reward to
  // the claimer. Returns the granted reward or null if already claimed/ineligible.
  async claimBounty(eventId, targetId, byUserId) {
    const ev = events.get(eventId);
    if (!ev) return { ok: false, reason: "no_event" };
    const flag = eventFlags.get(`${eventId}:${targetId}`);
    if (!flag || flag.flag !== "BOUNTY_TARGET") return { ok: false, reason: "not_a_target" };
    const key = `${eventId}:${targetId}`;
    if (bountyClaims.has(key)) return { ok: false, reason: "already_claimed" };
    bountyClaims.set(key, { byUserId, at: new Date().toISOString() });

    const r = ev.reward;
    const granted = {};
    if (r.currency && r.amount) granted.balance = await this.adjustBalance(byUserId, r.currency, r.amount, `bounty:${eventId}`);
    if (r.cosmeticId && COSMETICS[r.cosmeticId]) { await this.grantCosmetic(byUserId, r.cosmeticId, `bounty:${eventId}`); granted.cosmeticId = r.cosmeticId; }
    return { ok: true, reward: r, granted };
  },
};
