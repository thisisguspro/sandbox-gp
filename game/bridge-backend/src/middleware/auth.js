import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

// Issues a session token for a player.
export function issueToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

// Gate player routes: requires a valid session token.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Sign in again." });
  }
}

// Gate admin routes by ACCOUNT ROLE (not a shared key). The caller must be a
// signed-in player whose account has adminRole "admin" or "superadmin".
// requireSuperadmin is stricter (role management lives behind it).
import { db } from "../store/index.js";

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
export function requireAdmin(req, res, next) {
  if ((req.headers["x-admin-key"] || "") !== config.adminKey) {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}
