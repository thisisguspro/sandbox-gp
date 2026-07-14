// ============================================================
// SANDBOX GP — CrazyGames SDK v3 integration.
//
// Everything the CrazyGames platform needs from us, behind one safe wrapper:
//
//   • loading start/stop      — they measure our load times + fail rates
//   • gameplay start/stop     — required for full integration; also defines
//                               the "initial download" measurement endpoint
//   • room reporting          — updateRoom({roomId, isJoinable, inviteParams})
//                               lets the PLATFORM render an invite button,
//                               friend-join, presence, notifications
//   • invite param intake     — a friend clicking an invite lands with our
//                               join code in the URL; we hand it to the app
//   • midgame ads             — the natural break between races; audio is
//                               hard-muted during ads (platform requirement)
//   • happytime()             — confetti on a race WIN (sparingly, per docs)
//
// Safety rules (mirrors analytics.js):
//   • OFF unless built with VITE_CRAZYGAMES=1 — the Render build never loads
//     the SDK script and every call here is a no-op.
//   • Even when on, every call is try/caught: the SDK throws on non-CG
//     domains ("disabled" environment) and when adblocked. The game must be
//     fully playable in both cases — a CrazyGames hard requirement.
//   • Ads: the SDK enforces its own ~3-minute midgame cooldown (adCooldown
//     error). We keep a local cooldown too so we don't even ask too often.
// ============================================================
import { setAudioDucked } from "./audio.js";
import { setMusicDucked } from "./music.js";
import { track } from "./analytics.js";

const ENABLED = String(import.meta.env.VITE_CRAZYGAMES || "") === "1";
const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const AD_COOLDOWN_MS = 180_000; // matches the SDK's usual midgame interval

let sdk = null;            // window.CrazyGames.SDK once initialized
let environment = "off";   // off | local | crazygames | disabled
let initPromise = null;
let lastAdAt = 0;
let adInFlight = false;

const dbg = [];                       // call log for local QA / e2e assertions
function log(name, extra) {
  if (environment !== "crazygames") {   // silent in prod; visible in local/QA/disabled
    dbg.push({ name, extra, t: Date.now() });
    if (dbg.length > 100) dbg.shift();
    if (typeof window !== "undefined") window.__gpCg = dbg;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    const to = setTimeout(() => reject(new Error("sdk script timeout")), 10_000);
    s.onload = () => { clearTimeout(to); resolve(); };
    s.onerror = () => { clearTimeout(to); reject(new Error("sdk script failed")); };
    document.head.appendChild(s);
  });
}

// ---------- lifecycle ----------
export function cgEnabled() { return ENABLED && !!sdk && environment !== "disabled"; }
// True in builds produced for the CrazyGames portal (VITE_CRAZYGAMES=1).
// Auth behavior keys off the BUILD, not the runtime SDK: even when the SDK is
// blocked (adblock) or absent (local QA), a CG build must never show external
// logins and must land visitors in the game with a silent guest session.
export const CG_BUILD = !!import.meta.env.VITE_CRAZYGAMES;

export function cgEnvironment() { return environment; }

export async function cgInit() {
  if (!ENABLED) return;                 // async fn → resolved promise, .then() is safe
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      console.info("[crazygames] init: loading SDK…");
      await loadScript(SDK_URL);
      console.info("[crazygames] init: script loaded");
      await window.CrazyGames.SDK.init();
      sdk = window.CrazyGames.SDK;
      environment = sdk.environment || "crazygames";
      if (environment === "disabled") {
        // Running on a non-CrazyGames domain with the flag on (e.g. someone
        // deployed the CG build to Render by mistake). Stay silent + no-op.
        sdk = null;
        return;
      }
      track("cg_sdk_ready", { environment });
    } catch (e) {
      sdk = null;
      environment = "disabled";
      console.warn("[crazygames] SDK unavailable — continuing without it:", e?.message);
    }
  })();
  return initPromise;
}

// ---------- loading + gameplay reporting ----------
export function cgLoadingStart() { log("cgLoadingStart"); try { sdk?.game?.loadingStart(); } catch {} }
export function cgLoadingStop() { log("cgLoadingStop"); try { sdk?.game?.loadingStop(); } catch {} }
export function cgGameplayStart() { log("cgGameplayStart"); try { sdk?.game?.gameplayStart(); } catch {} }
export function cgGameplayStop() { log("cgGameplayStop"); try { sdk?.game?.gameplayStop(); } catch {} }

// Confetti on the platform. Docs: use sparingly — we fire it only on WINNING a race.
export function cgHappytime() { log("cgHappytime"); try { sdk?.game?.happytime(); } catch {} }

// ---------- multiplayer room reporting + invites ----------
// roomId = our 5-letter join code. inviteParams carry it to invited friends.
export function cgUpdateRoom(code, { joinable = true } = {}) {
  log("cgUpdateRoom", { code, joinable });
  try {
    sdk?.game?.updateRoom({
      roomId: String(code),
      isJoinable: !!joinable,
      inviteParams: { code: String(code) },
    });
  } catch {}
}
export function cgClearRoom() {
  try { sdk?.game?.updateRoom({ roomId: null, isJoinable: false }); } catch {}
}

// A friend arriving via a CrazyGames invite link lands with our join code.
export function cgInviteCode() {
  try { return sdk?.game?.getInviteParam("code") || null; } catch { return null; }
}

// ---------- user module (account integration) ----------
// The portal requires logged-in CrazyGames users to be signed into the game
// automatically. getUserToken() returns a 1h JWT the backend verifies; getUser
// returns null for CG guests (who play via our silent guest account instead).
export async function cgGetUser() {
  try { return (await sdk?.user?.getUser()) ?? null; } catch { return null; }
}
export async function cgGetUserToken() {
  try { return (await sdk?.user?.getUserToken()) ?? null; } catch { return null; }
}
// Fires when the player logs into CrazyGames mid-session; the docs' simplest
// correct response is a reload so the boot flow picks the new identity up.
export function cgOnAuthChange(fn) {
  try { sdk?.user?.addAuthListener(fn); } catch {}
}

// ---------- cloud persistence (CrazyGames data module) ----------
// The SDK's data module is a key-value store synced to the player's CrazyGames
// account — the platform's "save player progress" requirement. We persist our
// backend session token so a guest (or any account) survives new sessions and
// devices on the portal without re-auth friction.
export function cgDataGet(key) {
  try { return sdk?.data?.getItem(key) ?? null; } catch { return null; }
}
export function cgDataSet(key, value) {
  try { sdk?.data?.setItem(key, value); } catch {}
}

// ---------- midgame ads (between races) ----------
// Hard requirements honored: audio muted for the ad's duration; the game keeps
// working if the ad errors/unfilled/adblocked; SDK + local cooldowns respected.
export function cgMidgameAd(onDone) {
  log("cgMidgameAd");
  const finish = () => { setAudioDucked(false); setMusicDucked(false); adInFlight = false; onDone?.(); };
  if (!cgEnabled() || adInFlight || Date.now() - lastAdAt < AD_COOLDOWN_MS) return onDone?.(), false;
  adInFlight = true;
  lastAdAt = Date.now();
  try {
    sdk.ad.requestAd("midgame", {
      adStarted: () => { setAudioDucked(true); setMusicDucked(true); track("ad_started", { type: "midgame" }); },
      adFinished: () => { track("ad_finished", { type: "midgame" }); finish(); },
      adError: (e) => { track("ad_error", { type: "midgame", code: e?.code }); finish(); },
    });
    return true;
  } catch {
    finish();
    return false;
  }
}
