#!/usr/bin/env node
/* SANDBOX GP smoke test — confirms the three services are up and talking.
 *
 * This does NOT start the services (so it works the same in CI or by hand).
 * Start them first (see RUN.md), then run:  node smoke-test.mjs
 *
 * It checks, in order:
 *   1. backend  /health   (default :4000)
 *   2. gameserver /health (default :5000)
 *   3. client dev server  (default :5173)   — optional, warns if absent
 *   4. a real backend flow: dev sign-in -> profile -> store list -> wallet
 *
 * Uses only built-in fetch (Node 18+). No dependencies, no node_modules needed.
 * Override URLs with env: BACKEND_URL, GAME_URL, CLIENT_URL.
 */
const BACKEND = process.env.BACKEND_URL || "http://localhost:4000";
const GAME = process.env.GAME_URL || "http://localhost:5000";
const CLIENT = process.env.CLIENT_URL || "http://localhost:5173";

let pass = 0, fail = 0, warn = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const wn = (m) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); warn++; };
const J = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t }; } };
const get = (base, p, tok) => fetch(base + p, { headers: tok ? { Authorization: "Bearer " + tok } : {} });
const post = (base, p, body, tok) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body || {}) });
const tryFetch = async (fn) => { try { return await fn(); } catch (e) { return { _err: e.message }; } };

async function main() {
  console.log("\n\x1b[1mSANDBOX GP smoke test\x1b[0m");

  // 1. backend health
  console.log("\nServices");
  {
    const r = await tryFetch(() => get(BACKEND, "/health"));
    if (r._err) no(`backend unreachable at ${BACKEND} (${r._err}) — is it running?`);
    else { const j = await J(r); j.ok ? ok(`backend healthy at ${BACKEND} (store=${j.store})`) : no(`backend /health returned unexpected: ${JSON.stringify(j)}`); }
  }
  // 2. gameserver health
  {
    const r = await tryFetch(() => fetch(GAME + "/health"));
    if (r._err) no(`game server unreachable at ${GAME} (${r._err}) — is it running?`);
    else {
      const t = await r.text();
      // Standalone gameserver answers plain "ok"; in combined single-port mode
      // (GAME_URL === BACKEND_URL) the shared /health is the backend's JSON —
      // Socket.IO rides the same server, so a healthy backend means a healthy
      // game socket. The race-flow test (race-flow.test.mjs) proves it live.
      const combined = GAME === BACKEND;
      const okHealth = t.trim() === "ok" || (combined && t.includes('"ok":true'));
      okHealth ? ok(`game server healthy at ${GAME}${combined ? " (combined mode)" : ""}`) : no(`game server /health returned: ${t.slice(0, 40)}`);
    }
  }
  // 3. client (optional)
  {
    const r = await tryFetch(() => fetch(CLIENT));
    if (r._err) wn(`client dev server not detected at ${CLIENT} (ok if you haven't started it yet)`);
    else ok(`client dev server responding at ${CLIENT}`);
  }

  // 4. backend flow
  console.log("\nBackend flow");
  let token = null;
  {
    const r = await tryFetch(() => post(BACKEND, "/auth/dev-login", { name: "SmokeTest" }));
    if (r._err) { no(`sign-in failed (${r._err})`); }
    else { const j = await J(r); token = j.token; token ? ok("dev sign-in issued a token") : no(`sign-in returned no token: ${JSON.stringify(j).slice(0, 80)}`); }
  }
  if (token) {
    const prof = await J(await get(BACKEND, "/profile", token));
    typeof prof.level === "number" ? ok(`profile loads (level ${prof.level}, ${prof.owned?.length ?? 0} cosmetics owned)`) : no("profile did not load");

    const items = await J(await get(BACKEND, "/store/items"));
    Array.isArray(items) && items.length ? ok(`store lists ${items.length} items`) : no("store items did not list");
    if (Array.isArray(items) && items.length) {
      const leaks = items.find((i) => "worth" in i || "dropWeight" in i);
      leaks ? no("store item LEAKS admin-only fields (worth/dropWeight) to players!") : ok("store items hide admin-only fields");
    }

    const wallet = await J(await get(BACKEND, "/player/wallet", token));
    ("CREDITS" in wallet && "PREMIUM" in wallet) ? ok(`wallet reads balances (CREDITS ${wallet.CREDITS}, PREMIUM ${wallet.PREMIUM})`) : no("wallet did not return balances");

    const settings = await J(await get(BACKEND, "/profile/settings", token));
    settings.settings && settings.schema ? ok("settings + schema load") : no("settings did not load");
  }

  // summary
  console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed${warn ? `, ${warn} warning(s)` : ""}`);
  if (fail) { console.log("\x1b[31mSmoke test FAILED — see above. Most common cause: a service isn't running.\x1b[0m\n"); process.exit(1); }
  console.log("\x1b[32mAll good — services are up and talking. Open the client and play.\x1b[0m\n");
}
main().catch((e) => { console.error("smoke test crashed:", e); process.exit(1); });
