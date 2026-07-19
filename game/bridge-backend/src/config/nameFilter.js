// ============================================================
// Shared display-name validation + profanity filter.
//
// Used anywhere a player name is set or changed (onboarding name-pick, future
// paid name change, etc.). Returns a single shape so callers can surface a clear
// rejection reason to the user:
//   { ok: true,  name }            -> use `name` (trimmed/cleaned)
//   { ok: false, reason }          -> show `reason` to the user
//
// Keep this dependency-free so both the REST API and the game server can import
// it without pulling in the store.
// ============================================================

export const NAME_MIN = 2;
export const NAME_MAX = 20; // matches the client input maxLength

// Characters a name may contain: letters (incl. accented), numbers, spaces, and
// a small set of safe separators. Anything else (control chars, emoji, markup)
// is rejected so names render predictably everywhere.
const ALLOWED = /^[\p{L}\p{N} _.\-]+$/u;

// Modest profanity blocklist. We normalize common leetspeak/spacing first, then
// check for any of these as substrings. Not exhaustive — just blocks the obvious
// cases. Add to this list as needed; it is the single place names are screened.
const BANNED = [
  "fuck", "shit", "bitch", "cunt", "asshole", "dick", "pussy", "bastard",
  "slut", "whore", "nigger", "nigga", "faggot", "fag", "retard", "rape",
  "nazi", "hitler", "kkk", "cum", "cock", "porn", "sex",
];

// Map look-alike characters to letters so "sh1t" / "f.u.c.k" / "@ss" don't slip
// through. We collapse to lowercase alphanumerics only before scanning.
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function normalizeForScan(s) {
  return s
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] || c)
    .replace(/[^a-z]/g, ""); // drop spaces/punctuation so "s h i t" -> "shit"
}

// Validate and clean a raw display name. The single source of truth for what a
// legal name is across the whole backend.
export function validateName(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "Enter a name." };
  const name = raw.trim().replace(/\s+/g, " "); // collapse internal whitespace
  if (name.length < NAME_MIN) return { ok: false, reason: `Name must be at least ${NAME_MIN} characters.` };
  if (name.length > NAME_MAX) return { ok: false, reason: `Name must be ${NAME_MAX} characters or fewer.` };
  if (!ALLOWED.test(name)) return { ok: false, reason: "Use only letters, numbers, spaces, and . _ -" };

  const scan = normalizeForScan(name);
  if (BANNED.some((w) => scan.includes(w))) {
    return { ok: false, reason: "That name isn't allowed. Please choose another." };
  }
  return { ok: true, name };
}

// Best-effort cleaner for provisional/auto-derived names (e.g. the Google or
// quick-play name used before the player picks one). Never throws; returns a
// safe fallback when the source name is unusable.
export function safeName(raw, fallback = "Pilot") {
  const r = validateName(raw);
  return r.ok ? r.name : fallback;
}
