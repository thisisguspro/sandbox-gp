import { useEffect, useRef, useState } from "react";
import { useI18n } from "../api/i18n.jsx";

// Rewarded-ad player.
//
// STUB: this currently just runs a short countdown to simulate watching a video
// ad, then resolves. To wire up a REAL ad network (e.g. Google AdSense "H5 Games
// Ads" via the Ad Placement API), replace the countdown effect below with the
// network's rewarded-ad call and:
//   - invoke onComplete() from the network's "ad finished / reward earned" callback
//   - invoke onCancel() if the ad fails to load or the user dismisses it early
// The backend independently caps and grants the reward (per-day), so this UI can
// never over-grant on its own.
const WATCH_SECONDS = 5;

export default function RewardedAd({ amount = 0, onComplete, onCancel }) {
  const { t } = useI18n();
  const [left, setLeft] = useState(WATCH_SECONDS);
  const fired = useRef(false);

  useEffect(() => {
    if (left <= 0) {
      if (!fired.current) { fired.current = true; onComplete?.(); }
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, onComplete]);

  const done = left <= 0;

  return (
    <div style={backdrop}>
      <div style={frame}>
        <div style={topbar}>
          <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.18em", opacity: 0.7 }}>
            {t("shop.ad.label")}
          </span>
          {!done && (
            <button onClick={() => onCancel?.()} style={closeBtn} aria-label={t("shop.ad.close")}>×</button>
          )}
        </div>
        <div style={adBody}>
          <div className="display" style={{ fontSize: 42, opacity: 0.35, textTransform: "uppercase" }}>
            {t("shop.ad.sample")}
          </div>
        </div>
        <div style={footer}>
          <span className="faint" style={{ fontSize: 12, letterSpacing: "0.08em" }}>
            {done ? t("shop.ad.claim") : t("shop.ad.skipIn", { n: left })}
          </span>
          <div style={barTrack}>
            <div style={{ ...barFill, width: `${((WATCH_SECONDS - left) / WATCH_SECONDS) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const backdrop = {
  position: "fixed", inset: 0, zIndex: 60, background: "rgba(6,5,10,0.86)",
  display: "grid", placeItems: "center", backdropFilter: "blur(3px)",
};
const frame = {
  width: "min(560px, 92vw)", background: "rgba(13,11,20,0.98)", border: "2px solid var(--line)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden",
};
const topbar = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "8px 12px", borderBottom: "1px solid var(--line)", background: "rgba(0,0,0,0.35)",
};
const closeBtn = {
  background: "none", border: "none", color: "var(--dim)", fontSize: 22, lineHeight: 1,
  cursor: "pointer", padding: "0 4px",
};
const adBody = {
  height: 260, display: "grid", placeItems: "center",
  background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 18px, rgba(255,255,255,0.045) 18px 36px)",
};
const footer = { padding: "12px 16px 16px", textAlign: "center" };
const barTrack = { marginTop: 8, height: 4, background: "var(--line)", overflow: "hidden" };
const barFill = { height: "100%", background: "var(--volt)", transition: "width 0.9s linear" };
