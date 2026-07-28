import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

// Issues a session token for a player.
export function issueToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

// Gate player routes: requires a valid session token.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "Session expired. Sign in again." });
  }
  req.userId = payload.sub;
  // Moderation must bite LIVE sessions, not just the next login: a banned
  // account is cut off on its very next API call, token or no token.
  try {
    const ban = await dbRef().isBanned(payload.sub);
    if (ban?.banned) {
      return res.status(403).json({ error: "This account is banned.", banUntil: ban.until || null, reason: ban.reason || null });
    }
  } catch {}
  next();
}

// Late-bound store handle (this module loads before the store in some paths).
let _db = null;
function dbRef() {
  if (!_db) _db = _dbImport.db;
  return _db;
}

// Gate admin routes by ACCOUNT ROLE (not a shared key). The caller must be a
// signed-in player whose account has adminRole "admin" or "superadmin".
// requireSuperadmin is stricter (role management lives behind it).
import { db } from "../store/index.js";
import * as _dbImport from "../store/index.js";

export function requireAdminRole(req, res, next) {
  // Reuse requireAuth's token check first.
  requireAuth(req, res, async () => {
    const user = await db.getUser(req.userId);
    if (!user || !user.adminRole) return res.status(403).json({ error: "Admin access required." });
    req.adminRole = user.adminRole;
    next();
  });
}
export function requireSuperadmin(req, res, next) {
  requireAuth(req, res, async () => {
    const user = await db.getUser(req.userId);
    if (!user || user.adminRole !== "superadmin") return res.status(403).json({ error: "Superadmin only." });
    req.adminRole = user.adminRole;
    next();
  });
}

// Gate admin routes: a SEPARATE key, deliberately not the player path.
// (Legacy shared-key gate — kept for the service/loot-box routes during
// transition; new admin tool uses requireAdminRole above.)
// Legacy /admin surface (box odds, promo codes). Originally gated ONLY by a
// shared header key, which meant the in-game admin panel — which authenticates
// by ACCOUNT ROLE — could never use these functions. Accept either: a valid
// x-admin-key, or a signed-in account with an admin role.
export async function requireAdmin(req, res, next) {
  if ((req.headers["x-admin-key"] || "") === config.adminKey && config.adminKey) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const u = await dbRef().getUser(payload.sub);
      if (u?.adminRole === "admin" || u?.adminRole === "superadmin") { req.userId = payload.sub; return next(); }
    } catch {}
  }
  return res.status(403).json({ error: "Admin access required." });
}
