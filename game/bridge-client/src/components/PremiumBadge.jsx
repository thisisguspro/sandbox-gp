// Premium ("Gold Trail" pass) badge + shared helpers. Premium is time-based:
// the account carries a premiumUntil timestamp and, while it's in the future,
// match rewards are multiplied by PREMIUM_MULT. This mirrors the server's
// PREMIUM_BONUS so the reward the UI shows matches what the server grants.
export const PREMIUM_MULT = 1.5;

// Human-readable time remaining ("2d 4h", "3h 12m", "44m"), or null if expired.
export function premiumLeft(premiumUntil) {
  if (!premiumUntil) return null;
  const ms = new Date(premiumUntil).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isPremiumActive(premium, premiumUntil) {
  if (premium != null) return !!premium;
  return !!(premiumUntil && new Date(premiumUntil).getTime() > Date.now());
}

// Gold pill shown wherever premium status is relevant. Renders nothing when the
// pass isn't active (so callers can drop it in unconditionally). `size="sm"`
// gives a compact variant for tight headers.
export default function PremiumBadge({ premium, premiumUntil, size = "md" }) {
  if (!isPremiumActive(premium, premiumUntil)) return null;
  const left = premiumLeft(premiumUntil);
  const sm = size === "sm";
  return (
    <span
      className="impactf"
      title={left ? `Gold Trail active — ${left} left` : "Gold Trail active"}
      style={{
        display: "inline-flex", alignItems: "center", gap: sm ? 5 : 7,
        padding: sm ? "3px 8px" : "5px 11px", borderRadius: 999,
        fontSize: sm ? 10 : 12, letterSpacing: "0.12em", lineHeight: 1,
        color: "#1a1206", fontWeight: 800,
        background: "linear-gradient(100deg, #ffd23d 0%, #f5a623 55%, #ffcf4a 100%)",
        border: "1px solid rgba(255,220,120,0.9)",
        boxShadow: "0 0 14px rgba(255,190,60,0.35)",
      }}
    >
      <span className="kanji" style={{ fontSize: sm ? 11 : 13, fontWeight: 700 }}>★</span>
      GOLD TRAIL
      {left && <span style={{ opacity: 0.75, fontWeight: 700 }}>· {left}</span>}
    </span>
  );
}
