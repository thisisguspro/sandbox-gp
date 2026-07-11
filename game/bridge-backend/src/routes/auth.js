import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { db } from "../store/index.js";
import { issueToken, requireAuth } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { validateName, safeName } from "../config/nameFilter.js";

export const authRouter = Router();

const googleEnabled = () => !config.google.clientId.startsWith("PLACEHOLDER");
const googleClient = new OAuth2Client(config.google.clientId);

// Public config so the client knows whether to render the real "Sign in with
// Google" button (and with which client id). No secrets are exposed — the client
// id is public by design.
authRouter.get("/config", (_req, res) => {
  res.json({
    googleEnabled: googleEnabled(),
    googleClientId: googleEnabled() ? config.google.clientId : null,
    devLoginEnabled: config.devLoginEnabled,
  });
});

// ---- Dev-only sign-in (bypass) ----
// Google is the only REAL path, but when its OAuth origin isn't whitelisted for
// this host, nobody can get in to playtest. This lets any call sign log in and
// returns the same { token, user } shape as the Google path. HARD-GATED to
// non-production via config.devLoginEnabled — returns 404 on a live deploy.
authRouter.post("/dev-login", async (req, res) => {
  if (!config.devLoginEnabled) return res.status(404).json({ error: "Not found." });
  const skipOnboard = (req.body || {}).skipOnboard === true; // dev-only: leave the account un-onboarded to preview the first-time flow
  const check = validateName(req.body?.name || "");
  const name = check.ok ? check.name : safeName(`Cadet ${Math.floor(Math.random() * 9000 + 1000)}`);
  const googleId = `dev:${name.toLowerCase()}`;

  let user = await db.findUserByGoogleId(googleId);
  if (!user) {
    user = await db.createUser({ googleId, name, avatar: (name[0] || "C").toUpperCase() });
    // Fully onboard so playtesting skips the ToS / name-pick gates — unless the
    // caller asks for a raw account to exercise the real first-time flow in dev.
    if (!skipOnboard) {
      await db.acceptTos(user.id);
      await db.setInitialName(user.id, name);
    }
    user = await db.getUser(user.id);
  }

  // Dev-only convenience: give every test (dev-login) account full admin power so
  // the Admin panel is reachable during playtesting. This path is HARD-GATED to
  // non-production (returns 404 above when devLoginEnabled is false), so real
  // Google-auth deploys stay admins-only — nothing here grants admin in prod.
  if (!user.adminRole && !skipOnboard) {
    await db.setAdminRole(user.id, "superadmin");
    user = await db.getUser(user.id);
  }

  const ban = await db.isBanned(user.id);
  if (ban.banned) {
    return res.status(403).json({ error: "This account is banned.", banUntil: ban.until || null, reason: ban.reason || null });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

// ---- Sign-in ----
// Google sign-in is the ONLY path. The client posts { idToken } from Google
// Identity Services; we verify it against config.google.clientId and build the
// profile from the verified payload. Google accounts never carry a password.
authRouter.post("/google", async (req, res) => {
  const { idToken } = req.body || {};

  if (!idToken) return res.status(400).json({ error: "Sign in with Google to continue." });
  if (!googleEnabled()) return res.status(400).json({ error: "Google sign-in is not configured on this server." });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.google.clientId });
    payload = ticket.getPayload();
  } catch (e) {
    console.error("[auth] Google idToken verification failed:", e.message);
    return res.status(401).json({ error: "Could not verify your Google sign-in. Please try again." });
  }
  if (!payload?.sub) return res.status(401).json({ error: "Invalid Google token." });

  const profile = {
    googleId: payload.sub,
    // Provisional display name only — the player picks (and we filter) their real
    // name during onboarding. Sanitize the Google-derived suggestion so a bad
    // value never persists if onboarding is somehow skipped.
    name: safeName(payload.name || payload.given_name || (payload.email ? payload.email.split("@")[0] : "Pilot")),
    email: payload.email || undefined,
    // Google asserts whether it has verified ownership of the email. Only a
    // verified Google email may bootstrap the super-admin role (see createUser).
    emailVerified: payload.email_verified === true,
    avatar: ((payload.given_name || payload.name || payload.email || "A")[0] || "A").toUpperCase(),
    // No password for Google accounts.
  };

  let user = await db.findUserByGoogleId(profile.googleId);
  if (!user) {
    user = await db.createUser(profile);
  }

  // Enforce bans at login (temp bans auto-expire inside isBanned).
  const ban = await db.isBanned(user.id);
  if (ban.banned) {
    return res.status(403).json({ error: "This account is banned.", banUntil: ban.until || null, reason: ban.reason || null });
  }

  res.json({ token: issueToken(user), user: publicUser(user) });
});

// Current signed-in player.
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await db.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicUser(user) });
});

// ---- Onboarding (first-time only) ----
// Record one-time Terms of Service acceptance. Returns the refreshed user so the
// client can advance its onboarding gate.
authRouter.post("/accept-tos", requireAuth, async (req, res) => {
  const user = await db.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  await db.acceptTos(req.userId);
  res.json({ user: publicUser(await db.getUser(req.userId)) });
});

// Set the initial display name. Runs through the shared name filter and rejects
// disallowed names with a clear reason. Only valid the first time — later name
// changes are a separate (paid) flow.
authRouter.post("/set-name", requireAuth, async (req, res) => {
  const user = await db.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  // Enforce onboarding step order: ToS must be accepted before a name is chosen.
  if (!user.tosAcceptedAt) return res.status(409).json({ error: "Accept the Terms of Service first." });
  if (user.nameChosen) return res.status(409).json({ error: "Your name is already set." });
  const check = validateName(req.body?.name);
  if (!check.ok) return res.status(400).json({ error: check.reason });
  await db.setInitialName(req.userId, check.name);
  res.json({ user: publicUser(await db.getUser(req.userId)) });
});

// Change the display name using a paid name-change credit. Runs through the same
// shared name filter as onboarding and consumes one credit on success. Separate
// from /set-name (the one-time free onboarding pick).
authRouter.post("/change-name", requireAuth, async (req, res) => {
  const user = await db.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  if ((user.nameChangeCredits || 0) <= 0) {
    return res.status(402).json({ error: "You have no name-change credits. Buy a Name Change in the shop." });
  }
  const check = validateName(req.body?.name);
  if (!check.ok) return res.status(400).json({ error: check.reason });
  try {
    const result = await db.changeName(req.userId, check.name);
    res.json({ user: publicUser(await db.getUser(req.userId)), nameChangeCredits: result.nameChangeCredits });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

function publicUser(u) {
  return {
    id: u.id, name: u.name, avatar: u.avatar, balances: u.balances, adminRole: u.adminRole || null,
    // Onboarding gate signals for the client.
    tosAccepted: !!u.tosAcceptedAt,
    nameChosen: !!u.nameChosen,
    // Paid name change & streamer mode (Task #4).
    nameChangeCredits: u.nameChangeCredits || 0,
    streamerMode: !!u.streamerMode,
  };
}
