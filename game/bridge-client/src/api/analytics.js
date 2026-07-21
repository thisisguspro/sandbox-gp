// ============================================================
// SANDBOX GP — analytics.
//
// A thin, provider-agnostic event layer. The GOAL is to measure the funnel that
// actually predicts whether the game grows:
//
//   app_open → lobby_enter → race_start → race_complete → (comes back tomorrow)
//
// Design rules:
//  • ZERO hard dependency. With no provider configured it's a safe no-op that
//    still fills a local ring buffer (window.__gpAnalytics) so you can eyeball
//    events in dev console before wiring a real backend.
//  • Provider is chosen at build time by env, so no key ships unless you set one:
//      VITE_ANALYTICS=posthog  + VITE_POSTHOG_KEY=phc_xxx  [+ VITE_POSTHOG_HOST]
//      VITE_ANALYTICS=ga4      + VITE_GA4_ID=G-XXXXXXX
//      VITE_ANALYTICS=none     (default) → local-only
//  • Never blocks gameplay. Every call is fire-and-forget and try/caught.
//  • No PII. We identify by an anonymous, stable, per-device id (a random UUID
//    persisted in localStorage) — never the player's name or email.
//
// Retention (the metric bot-fill is meant to move) is computed cheaply on the
// client: we stamp first-seen + last-seen days in localStorage and emit a
// `retained` event with the day-gap on each app open. A real warehouse can also
// derive this server-side later; this gives an immediate read.
// ============================================================

const PROVIDER = (import.meta.env.VITE_ANALYTICS || "none").toLowerCase();
const RING_MAX = 200;
const LS_ID = "gp_anon_id";
const LS_FIRST = "gp_first_day";
const LS_LAST = "gp_last_day";

let provider = null;         // { capture(name, props), identify(id, props) } | null
let anonId = null;
let ready = false;
const ring = [];             // local ring buffer, always populated
let sessionStart = 0;

function today() {
  // UTC day index (days since epoch) — timezone-stable for gap math.
  return Math.floor(Date.now() / 86400000);
}

function loadAnonId() {
  try {
    let id = localStorage.getItem(LS_ID);
    if (!id) {
      id = (crypto?.randomUUID?.() || `gp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
      localStorage.setItem(LS_ID, id);
    }
    return id;
  } catch {
    return `gp_mem_${Math.random().toString(36).slice(2)}`; // storage blocked → per-session id
  }
}

// ---------- provider adapters (loaded only when configured) ----------
async function initPosthog() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return null;
  const host = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
  // Indirect specifier: the bundler shouldn't try to resolve posthog-js at build
  // time (it isn't a dependency until you opt in). @vite-ignore + a variable
  // keeps the default build clean; install posthog-js when you set the env.
  const pkg = "posthog-js";
  const mod = await import(/* @vite-ignore */ pkg);
  const posthog = mod.default || mod;
  posthog.init(key, { api_host: host, capture_pageview: false, autocapture: false, persistence: "localStorage" });
  return {
    capture: (name, props) => posthog.capture(name, props),
    identify: (id, props) => posthog.identify(id, props),
  };
}

function initGa4() {
  const id = import.meta.env.VITE_GA4_ID;
  if (!id || typeof document === "undefined") return null;
  // inject gtag.js
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", id, { send_page_view: false });
  return {
    capture: (name, props) => window.gtag("event", name, props || {}),
    identify: (uid) => window.gtag("set", { user_id: uid }),
  };
}

// ---------- public API ----------
export async function initAnalytics() {
  if (ready) return;
  ready = true;
  sessionStart = Date.now();
  anonId = loadAnonId();
  if (typeof window !== "undefined") window.__gpAnalytics = ring;

  try {
    if (PROVIDER === "posthog") provider = await initPosthog();
    else if (PROVIDER === "ga4") provider = initGa4();
  } catch (e) {
    provider = null; // never let a provider failure touch gameplay
    console.warn("[analytics] provider init failed; local-only", e?.message);
  }

  if (provider?.identify) { try { provider.identify(anonId); } catch {} }

  // retention read on open
  try {
    const t = today();
    const first = Number(localStorage.getItem(LS_FIRST)) || t;
    const last = Number(localStorage.getItem(LS_LAST)) || t;
    if (!localStorage.getItem(LS_FIRST)) localStorage.setItem(LS_FIRST, String(t));
    const daysSinceFirst = t - first;
    const daysSinceLast = t - last;
    localStorage.setItem(LS_LAST, String(t));
    track("app_open", {
      days_since_first_seen: daysSinceFirst,
      days_since_last_seen: daysSinceLast,
      is_new_user: daysSinceFirst === 0 && daysSinceLast === 0,
    });
    // an explicit "retained" ping when someone returns on a later day
    if (daysSinceLast >= 1) {
      track("retained", { day_gap: daysSinceLast, cohort_age_days: daysSinceFirst });
    }
  } catch {}
}

// Core: record an event. Always buffers locally; forwards if a provider exists.
export function track(name, props = {}) {
  const evt = { name, props, t: Date.now() };
  ring.push(evt);
  if (ring.length > RING_MAX) ring.shift();
  try { provider?.capture?.(name, props); } catch (e) { /* swallow */ }
  if (import.meta.env.DEV) console.debug("[analytics]", name, props);
}

// ---------- funnel helpers (named so call sites read clearly) ----------
export const analytics = {
  lobbyEnter: (how, roomId) => track("lobby_enter", { how, room: roomId }),      // how: host|code|random|invite
  raceStart: (info = {}) => track("race_start", info),                            // { players, bots, humans, map, laps }
  raceComplete: (info = {}) => track("race_complete", info),                      // { place, players, durationSec, won }
  raceLeave: (info = {}) => track("race_leave", info),                            // abandoned before finish
  rematch: (roomId) => track("rematch", { room: roomId }),
  itemUsed: (itemId, tier) => track("item_used", { item: itemId, tier }),         // low-freq sampling only
  shopOpen: () => track("shop_open", {}),
  sessionEnd: () => track("session_end", { duration_sec: Math.round((Date.now() - sessionStart) / 1000) }),
};

export function getAnonId() { return anonId; }
