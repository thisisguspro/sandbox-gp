// Central Time helpers. The whole app displays timestamps in US Central Time
// (America/Chicago, DST-aware -> shows CST/CDT) for EVERY viewer, regardless of
// their own browser timezone. Keep this the single source of truth for the tz.
export const CENTRAL_TZ = "America/Chicago";

// Full date + time in Central, e.g. "Jul 4, 2026, 3:15 PM CDT".
export function fmtDateTime(iso, opts = {}) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
      timeZone: CENTRAL_TZ, timeZoneName: "short",
      ...opts,
    });
  } catch { return typeof iso === "string" ? iso : ""; }
}

// Date only in Central, e.g. "Jul 4, 2026".
export function fmtDate(iso, opts = {}) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      timeZone: CENTRAL_TZ,
      ...opts,
    });
  } catch { return ""; }
}

// Offset (ms) such that (utcMs + offset) read as UTC fields == Central wall-clock.
// Negative for Central (which is behind UTC). Uses Intl so DST is handled.
const wallFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CENTRAL_TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function centralOffsetMs(utcMs) {
  const map = {};
  for (const p of wallFmt.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asIfUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asIfUTC - utcMs;
}

// ISO instant -> "YYYY-MM-DDTHH:MM" Central wall-clock, for <input type="datetime-local">.
export function toCentralInput(iso) {
  if (!iso) return "";
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return "";
  const shifted = new Date(utcMs + centralOffsetMs(utcMs));
  return shifted.toISOString().slice(0, 16);
}

// "YYYY-MM-DDTHH:MM" typed as Central wall-clock -> UTC ISO instant.
export function centralInputToISO(localStr) {
  if (!localStr) return null;
  const [datePart, timePart = "00:00"] = localStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  // Look up the offset near the target instant; iterate once for DST-edge accuracy.
  let utc = asUTC - centralOffsetMs(asUTC);
  utc = asUTC - centralOffsetMs(utc);
  return new Date(utc).toISOString();
}
