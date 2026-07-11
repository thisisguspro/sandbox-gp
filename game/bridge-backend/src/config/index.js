// Central config. Everything tweakable lives here.
// Real secrets come from environment variables; sane dev defaults provided.

// The app's public origin (used for Stripe redirect URLs). In a Replit deploy
// REPLIT_DOMAINS holds the live host; fall back to the local dev client otherwise.
const publicOrigin = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
  : "http://localhost:5173";

export const config = {
  port: process.env.PORT || 4000,

  // JWT session signing. OVERRIDE in production via env.
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  jwtExpiry: "7d",

  // Dev-only sign-in bypass. Google is the ONLY real sign-in, but when its OAuth
  // origin isn't whitelisted (e.g. the ephemeral Replit preview URL) there's no
  // way in for local playtesting. This lets any call sign log in. HARD-GATED so it
  // can never be reached on a live deploy: the deploy sets NODE_ENV=production (see
  // artifact.toml) AND Replit sets REPLIT_DEPLOYMENT=1 in production. Fail-CLOSED —
  // both must indicate non-production for the bypass to turn on.
  devLoginEnabled:
    process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1",

  // Google OAuth — PLACEHOLDERS. Substitute real keys before testing.
  // The flow is stubbed in dev (see routes/auth.js) so nothing breaks without them.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "PLACEHOLDER_GOOGLE_CLIENT_ID",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "PLACEHOLDER_GOOGLE_CLIENT_SECRET",
  },

  // Admin gate — a separate secret, NOT the player auth path.
  adminKey: process.env.ADMIN_KEY || "dev-admin-key",

  // Service-to-service secret: the game server uses this to fetch player
  // loadouts and report match results. NOT a player or admin credential.
  serviceKey: process.env.SERVICE_KEY || "dev-service-key",

  // Bootstrap super-admin: this Google email always has full admin power and can
  // grant/revoke admin to others. Override via env in production.
  superadminEmail: process.env.SUPERADMIN_EMAIL || "gmromeu13@gmail.com",

  // Which data store to use. "memory" now; "postgres" later — see store/index.js.
  dataStore: process.env.DATA_STORE || "memory",

  // Stripe (paid store) — PLACEHOLDERS. Substitute real keys before going live.
  // The flow is stubbed in dev (see routes/payments.js): we simulate Checkout
  // Sessions and webhooks so the whole purchase path works without a real account.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "PLACEHOLDER_STRIPE_SECRET_KEY",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "PLACEHOLDER_STRIPE_WEBHOOK_SECRET",
    // Where Stripe sends the user back after the hosted checkout. Defaults to the
    // app's own public origin so the single-port deploy "just works"; override via env.
    successUrl: process.env.STRIPE_SUCCESS_URL || `${publicOrigin}/?paid=1`,
    cancelUrl: process.env.STRIPE_CANCEL_URL || `${publicOrigin}/?canceled=1`,
  },
};

// True when we should run the dev stub instead of real Stripe. We require BOTH
// the secret key AND the webhook secret before going live: with only the secret
// key, checkout would succeed but the webhook (which actually grants items/prisms)
// would reject every event for a missing signing secret — i.e. players would pay
// and get nothing. Gating on both keeps the flow all-stub or all-live, never half.
export const stripePlaceholders = () =>
  config.stripe.secretKey.startsWith("PLACEHOLDER") ||
  config.stripe.webhookSecret.startsWith("PLACEHOLDER");

// ---- Gold Nugget bundles (what the paid store sells) ----
// Prices in the smallest currency unit (cents) for Stripe. Buying a bundle credits
// PREMIUM ("Gold Nuggets") to the account — only after Stripe confirms payment.
// One Gold Nugget = $1. Cosmetics in the Gold Store cost 1 Gold Nugget for now.
// The `prisms` field is the internal PREMIUM amount granted (name kept for churn).
export const PRISM_PACKS = {
  pack_1:   { id: "pack_1",   label: "Pinch of Gold",     prisms: 1,   priceCents: 100 },
  pack_5:   { id: "pack_5",   label: "Pouch of Gold",     prisms: 5,   priceCents: 500 },
  pack_10:  { id: "pack_10",  label: "Sack of Gold",      prisms: 10,  priceCents: 1000 },
  pack_20:  { id: "pack_20",  label: "Strongbox of Gold", prisms: 20,  priceCents: 2000 },
  pack_100: { id: "pack_100", label: "Motherlode",        prisms: 100, priceCents: 10000 },
};

// ---- Two-currency economy, abstracted from day one ----
// CREDITS = Silver Nugget (earned in-game). PREMIUM = Gold Nugget (bought with cash).
// Internal keys stay CREDITS/PREMIUM everywhere; only the user-facing label westernizes.
export const CURRENCIES = {
  CREDITS: { key: "CREDITS", label: "Silver Nugget", earnable: true, purchasable: false },
  PREMIUM: { key: "PREMIUM", label: "Gold Nugget", earnable: false, purchasable: true }, // bought via Stripe gold bundles
};
export const DEFAULT_CURRENCY = "CREDITS";

// ---- Rewarded ads (watch a short ad -> earn Silver Nuggets) ----
// Server-authoritative daily allowance. The client plays a rewarded ad (currently
// a stub) then hits the claim endpoint; the server enforces the per-day cap and
// grants via the normal balance funnel. When a real ad network is wired up (e.g.
// Google AdSense "H5 Games Ads"), KEEP this config and move the actual grant
// behind the network's Server-Side Verification (SSV) callback so the reward
// can't be farmed by replaying the endpoint.
export const AD_REWARD = {
  currency: "CREDITS",  // Silver Nugget (earnable) — never PREMIUM/Gold (that's paid)
  amount: 100,          // Silver Nuggets granted per completed ad
  dailyCap: 5,          // rewarded ads allowed per Central day, per account
};

// ---- Consumables (usable stash items that pop for a currency or XP reward) ----
// Owned as COUNTS on the account (user.consumables: itemId -> qty). A player pops
// one from the Locker stash to apply its reward. Dev/admins can self-grant these
// for testing. `type` picks the reward path: "currency" credits a balance,
// "xp" awards progression XP (and any level-up unlocks that follows).
export const CONSUMABLES = {
  credit_pack:   { id: "credit_pack",   name: "Silver Cache",  glyph: "S", type: "currency", currency: "CREDITS", amount: 500,   desc: "Crack it open for 500 Silver Nuggets." },
  credit_pack_l: { id: "credit_pack_l", name: "Silver Strongbox", glyph: "S", type: "currency", currency: "CREDITS", amount: 2500, desc: "Crack it open for 2,500 Silver Nuggets." },
  xp_pack:       { id: "xp_pack",       name: "Grit Ration",   glyph: "G", type: "xp",       amount: 300,  desc: "Chew through 300 XP of trail grit." },
  xp_pack_l:     { id: "xp_pack_l",     name: "Grit Feast",    glyph: "G", type: "xp",       amount: 1500, desc: "Chew through 1,500 XP of trail grit." },
};

// ---- Premium time ("Gold Trail" pass): durations + the bonus it grants ----
// Premium is TIME-BASED: user.premiumUntil is an ISO timestamp the pass runs
// until. Grants stack (extend from the later of now / current expiry). While
// active, match rewards are multiplied by PREMIUM_BONUS.
export const PREMIUM_DURATIONS = [
  { id: "1h",  label: "1 Hour",  ms: 60 * 60 * 1000 },
  { id: "1d",  label: "1 Day",   ms: 24 * 60 * 60 * 1000 },
  { id: "7d",  label: "7 Days",  ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30 Days", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "90d", label: "90 Days", ms: 90 * 24 * 60 * 60 * 1000 },
];
// While premium is active, matches pay this multiple of base XP + Silver Nuggets.
export const PREMIUM_BONUS = { xpMult: 1.5, creditMult: 1.5 };

// ---- Frontier Loyalty ladder ----
// Rewards cumulative REAL-money spend (user.lifetimeSpendCents, in cents —
// monotonic; refunds don't reduce it). Each milestone can be CLAIMED once for
// premium time + an exclusive cosmetic (source: "loyalty", sold nowhere else).
// After LOYALTY_INACTIVITY_MS with no spend, progress toward the NEXT milestone
// is forfeited (spend clamps down to the highest already-claimed threshold);
// already-claimed rewards are always kept. Keep milestones sorted ascending.
export const LOYALTY_INACTIVITY_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
export const LOYALTY_MILESTONES = [
  { id: "saddle_tramp",   label: "Saddle Tramp",   spendCents: 500,   premiumMs: 1  * 24 * 60 * 60 * 1000, cosmetics: ["bandana_trailblazer"] },
  { id: "trail_boss",     label: "Trail Boss",     spendCents: 2500,  premiumMs: 7  * 24 * 60 * 60 * 1000, cosmetics: ["head_marshal"] },
  { id: "frontier_baron", label: "Frontier Baron", spendCents: 6000,  premiumMs: 30 * 24 * 60 * 60 * 1000, cosmetics: ["body_goldplate"] },
  { id: "iron_legend",    label: "Iron Legend",    spendCents: 12000, premiumMs: 90 * 24 * 60 * 60 * 1000, cosmetics: ["shoes_goldspur"] },
];

// ---- Map-driven crew/impostor scaling (matches the design doc) ----
// The matchmaker reads these off the map, never hardcodes counts.
export const MAPS = {
  nebula_drift: { id: "nebula_drift", name: "Badlands Run", tier: "small",
    minPlayers: 5, maxPlayers: 10, impostors: 1,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay"],
    tasksPerRoom: 2 },
  ironhold_station: { id: "ironhold_station", name: "Ironhold Depot", tier: "large",
    minPlayers: 10, maxPlayers: 20, impostors: 2,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay", "Cargo", "Hangar", "Comms Array"],
    tasksPerRoom: 3 },
};
