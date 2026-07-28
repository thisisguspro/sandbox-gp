// Game-server config. Shares secrets with the backend so it can (a) verify the
// player session tokens the backend issues, and (b) call the backend's internal
// service API. In production these come from env; dev defaults match the backend.

export const config = {
  port: process.env.PORT || 5000,

  // MUST match the backend's JWT secret so we can read its session tokens.
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",

  // Shared service secret for the backend's /internal API.
  serviceKey: process.env.SERVICE_KEY || "dev-service-key",

  // Where the backend lives.
  backendUrl: process.env.BACKEND_URL || "http://localhost:4000",

  // If true, allow joining without a valid token (dev/guest play & tests).
  allowGuests: process.env.ALLOW_GUESTS !== "false",
};
