// Server endpoints.
//  - In the combined single-port deploy, the client is served from the same
//    origin as the backend + game server, so we default to "" (same origin) and
//    Socket.IO connects to window.location.origin.
//  - In local dev (Vite on :5173, servers on :4000/:5000), set VITE_BACKEND_URL
//    and VITE_GAME_URL in a .env file (see .env.example) to point at them.
//  - import.meta.env.DEV is true under `vite dev`, false in a production build.
const isDev = import.meta.env.DEV;
const sameOrigin = typeof window !== "undefined" ? window.location.origin : "";

// CRITICAL for portal builds (CrazyGames, Poki, itch): the game's FILES are
// served from the PORTAL's CDN (e.g. sandbox-gp.game-files.crazygames.com), so
// "same origin" is the portal — not us. Every API/socket call must therefore
// point at our own server by ABSOLUTE URL, baked in at build time via
// VITE_BACKEND_URL / VITE_GAME_URL. Without this the client 403s on its own
// endpoints (/auth/*, /i18n/*) because it's asking the CDN for them.
// The default below keeps same-origin behaviour for the direct-web deploy.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || (isDev ? "http://localhost:4000" : sameOrigin);
export const GAME_URL = import.meta.env.VITE_GAME_URL || (isDev ? "http://localhost:5000" : sameOrigin);

// Where we stash the player's session token (issued by the backend at sign-in).
export const TOKEN_KEY = "bridge_token";

// Use sessionStorage (per-tab) rather than localStorage (shared across all tabs
// of the origin). This is what lets you open several browser tabs and sign in as
// DIFFERENT players in each — essential for solo multi-tab playtesting. Falls
// back to an in-memory store if sessionStorage is unavailable.
const memStore = {};
export const tokenStore = (() => {
  try {
    const t = "__bridge_probe__";
    window.sessionStorage.setItem(t, "1"); window.sessionStorage.removeItem(t);
    return window.sessionStorage;
  } catch {
    return { getItem: (k) => (k in memStore ? memStore[k] : null), setItem: (k, v) => { memStore[k] = v; }, removeItem: (k) => { delete memStore[k]; } };
  }
})();
