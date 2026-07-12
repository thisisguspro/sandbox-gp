import { PERK_CATALOG, SIDE_META } from "../api/perks.js";
import { useI18n } from "../api/i18n.jsx";

// Perk arsenal: every draftable perk, which side it buffs, and whether YOU have
// unlocked it yet (by account level). Unlocked perks enter the shared draft pool
// for your lobbies; locked ones show the level they open at. Perks are never
// owned outright — the team drafts from the pooled unlocks before each match.
export default function Perks({ profile }) {
  const { t } = useI18n();
  const level = profile?.level ?? 1;
  const unlocked = new Set(profile?.unlockedPerks || []);
  const items = [...PERK_CATALOG].sort((a, b) => a.unlockLevel - b.unlockLevel);
  const openCount = items.filter((p) => unlocked.has(p.key) || level >= p.unlockLevel).length;

  return (
    <div style={{ padding: "32px 40px", height: "100%", overflowY: "auto" }}>
      <div className="kanji" style={{ fontSize: 22, color: "var(--gold)", letterSpacing: "0.2em", textTransform: "uppercase" }}>{t("perks.kicker")}</div>
      <div className="display" style={{ fontSize: 40, color: "#fff", lineHeight: 0.95, marginTop: 2, textTransform: "uppercase" }}>{t("perks.title")}</div>
      <div className="faint" style={{ fontSize: 13, maxWidth: 620, marginTop: 8, lineHeight: 1.5 }}>
        {(() => {
          const [a, bold, c] = t("perks.intro").split(/\{b\}|\{\/b\}/);
          return <>{a}<b style={{ color: "var(--paper)" }}>{bold}</b>{c}</>;
        })()}
      </div>
      <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--volt)", marginTop: 12, textTransform: "uppercase" }}>
        {t("perks.unlockedCount", { open: openCount, total: items.length, level })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 22 }}>
        {items.map((p) => {
          const side = SIDE_META[p.side] || SIDE_META.both;
          const isOpen = unlocked.has(p.key) || level >= p.unlockLevel;
          return (
            <div key={p.key} style={{
              position: "relative",
              background: isOpen ? "rgba(13,11,20,0.7)" : "rgba(10,9,14,0.55)",
              border: `1px solid ${isOpen ? side.color : "rgba(255,255,255,0.08)"}`,
              borderLeft: `4px solid ${isOpen ? side.color : "rgba(255,255,255,0.12)"}`,
              padding: "16px 18px",
              opacity: isOpen ? 1 : 0.62,
            }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", padding: "3px 8px",
                  border: `1px solid ${side.color}`, color: side.color, fontFamily: "Rajdhani, sans-serif",
                }}>
                  <span className="kanji" style={{ fontSize: 11, marginRight: 5 }}>{side.kanji}</span>{side.label}
                </span>
                {isOpen ? (
                  <span className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--volt)", textTransform: "uppercase" }}>{t("perks.unlocked")}</span>
                ) : (
                  <span className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--dim)", textTransform: "uppercase" }}>{t("perks.lockedLv", { level: p.unlockLevel })}</span>
                )}
              </div>
              <div className="display" style={{ fontSize: 22, color: isOpen ? "#fff" : "var(--dim)", lineHeight: 1 }}>{p.label}</div>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>{p.desc}</div>
              {!isOpen && (
                <div style={{ fontSize: 10.5, color: "var(--dim)", marginTop: 10, fontFamily: "Rajdhani" }}>
                  {t("perks.reachLevel", { level: p.unlockLevel })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
