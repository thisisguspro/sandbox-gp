import { useMemo } from "react";
import { SpeedLines, Particles } from "../components/effects.jsx";
import ItemIcon from "../components/ItemIcon.jsx";
import PremiumBadge from "../components/PremiumBadge.jsx";
import { useI18n } from "../api/i18n.jsx";

// Home / progression. The hero is the pilot's RANK and the XP RIVER — a flowing
// energy bar toward the next level — plus the unlock ladder showing what each
// level grants. Reads the real profile + catalogue shapes from the backend.
export default function Hangar({ user, profile, catalogue }) {
  const { t } = useI18n();
  if (!profile || !catalogue) return <Loading />;

  const { level, xp, xpToNext, nextLevelAt } = profile;
  const ladder = catalogue.ladder || {};
  const cosmeticsById = useMemo(() => Object.fromEntries((catalogue.cosmetics || []).map((c) => [c.id, c])), [catalogue]);

  // XP river fill: progress within the current level band.
  const prevAt = nextLevelAt - (xpToNext + (xp - (nextLevelAt - xpToNext))); // robust fallback
  const bandStart = levelFloor(level, nextLevelAt, xp, xpToNext);
  const pct = Math.max(0, Math.min(100, ((xp - bandStart) / (nextLevelAt - bandStart)) * 100)) || 0;

  const ladderRows = Object.entries(ladder)
    .map(([lvl, def]) => ({ lvl: Number(lvl), ...def }))
    .sort((a, b) => a.lvl - b.lvl);

  return (
    <div style={wrap}>
      <SpeedLines />
      <Particles density={28} color="rgba(70,230,255,0.4)" />

      <div style={{ position: "relative", zIndex: 2, padding: "32px 40px", height: "100%", overflowY: "auto" }}>
        {/* HERO: rank + XP river */}
        <div className="row" style={{ alignItems: "flex-end", gap: 28, marginBottom: 8, flexWrap: "wrap" }}>
          <div>
            <div className="tag"><span>{t("hangar.riderDossier")}</span></div>
            <div className="row" style={{ alignItems: "flex-end", gap: 18, marginTop: 10 }}>
              <div className="kanji" style={{ fontSize: 26, color: "var(--volt)", lineHeight: 1, paddingBottom: 18, textTransform: "uppercase" }}>{t("hangar.ranks")}</div>
              <div>
                <div className="impactf dim" style={{ letterSpacing: "0.2em", fontSize: 13, textTransform: "uppercase" }}>{t("hangar.rank")}</div>
                <div className="display" style={{ fontSize: "clamp(90px,12vw,150px)", lineHeight: 0.78, color: "var(--gold)", textShadow: "0 0 50px rgba(255,200,61,0.35)" }}>
                  {level}
                </div>
              </div>
              <div style={{ paddingBottom: 22 }}>
                <div className="display" style={{ fontSize: 40, color: "var(--paper)", lineHeight: 0.9 }}>{user.name}</div>
                <div className="row" style={{ alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span className="dim" style={{ fontWeight: 600 }}>{t("hangar.xpBanked", { xp: xp.toLocaleString() })}</span>
                  <PremiumBadge premium={profile?.premium} premiumUntil={profile?.premiumUntil} size="sm" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* XP RIVER */}
        <div style={{ maxWidth: 720, marginBottom: 40 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span className="impactf" style={{ fontSize: 12, letterSpacing: "0.15em", color: "var(--volt)", textTransform: "uppercase" }}>{t("hangar.lvLevel", { level })}</span>
            <span className="impactf dim" style={{ fontSize: 12, textTransform: "uppercase" }}>{t("hangar.xpToLv", { xp: xpToNext.toLocaleString(), next: level + 1 })}</span>
          </div>
          <div style={river}>
            <div style={{ ...riverFill, width: `${pct}%` }}>
              <div style={riverShine} />
            </div>
            <div style={riverEdge(pct)} />
          </div>
        </div>

        {/* UNLOCK LADDER */}
        <div className="tag" style={{ marginBottom: 16 }}><span>{t("hangar.unlockPath")}</span></div>
        <div style={ladderGrid}>
          {ladderRows.map((row) => {
            const reached = level >= row.lvl;
            const isNext = !reached && row.lvl === level + 1;
            return (
              <div key={row.lvl} className="panel" style={{ ...ladderCard, ...(reached ? cardReached : isNext ? cardNext : null) }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div className="display" style={{ fontSize: 40, lineHeight: 0.8, color: reached ? "var(--gold)" : isNext ? "var(--hot)" : "var(--faint)" }}>
                    {String(row.lvl).padStart(2, "0")}
                  </div>
                  <div style={statusDot(reached, isNext)} />
                </div>
                <div className="impactf" style={{ fontSize: 12, marginTop: 6, color: reached ? "var(--paper)" : "var(--dim)", minHeight: 30 }}>
                  {row.note || t("hangar.newGear")}
                </div>
                <div className="col gap-s" style={{ marginTop: 8 }}>
                  {(row.grants || []).map((id) => {
                    const c = cosmeticsById[id];
                    return (
                      <div key={id} className="row gap-s" style={{ fontSize: 12, fontWeight: 600, opacity: reached ? 1 : 0.55, alignItems: "center" }}>
                        <span style={{ width: 28, height: 28, flexShrink: 0, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rarityColor(c?.rarity)}22 0%, transparent 70%)`, border: "1px solid var(--line)" }}>
                          <ItemIcon id={c?.id} slot={c?.slot} color={rarityColor(c?.rarity)} glyphSize={14} size="78%" dim={!reached} />
                        </span>
                        <span>{c?.name || id}</span>
                      </div>
                    );
                  })}
                  {(row.slots || []).map((s) => (
                    <div key={s} className="faint" style={{ fontSize: 11, letterSpacing: "0.08em" }}>{t("hangar.slotGrant", { s })}</div>
                  ))}
                  {(row.perks || []).map((p) => (
                    <div key={p} style={{ fontSize: 11, color: "var(--violet)", fontWeight: 700 }}>◆ {p.replace(/_/g, " ")}</div>
                  ))}
                </div>
                {isNext && <div style={nextFlag} className="impactf">{t("hangar.next")}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function levelFloor(level, nextLevelAt, xp, xpToNext) {
  // current band start = xp at this level. We can recompute from the curve:
  // xpForLevel(n) = 50*n*(n-1). band start = that for `level`.
  return 50 * level * (level - 1);
}
function rarityColor(r) {
  return { Common: "var(--r-common)", Rare: "var(--r-rare)", Epic: "var(--r-epic)", Legendary: "var(--r-legendary)" }[r] || "var(--r-common)";
}
function Loading() {
  const { t } = useI18n();
  return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><div className="display dim" style={{ fontSize: 40, textTransform: "uppercase" }}>{t("hangar.loading")}</div></div>;
}

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(130% 100% at 80% 0%, #1c1726 0%, var(--ink) 55%)" };
const river = { position: "relative", height: 26, background: "var(--ink)", border: "2px solid var(--line)", overflow: "hidden", clipPath: "polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%)" };
const riverFill = { position: "relative", height: "100%", background: "linear-gradient(90deg, var(--volt) 0%, #6af 60%, var(--violet) 100%)", boxShadow: "0 0 20px rgba(70,230,255,0.4)", transition: "width 0.4s ease", overflow: "hidden" };
const riverShine = { display: "none" };
const riverEdge = (pct) => ({ position: "absolute", top: -4, bottom: -4, left: `calc(${pct}% - 2px)`, width: 4, background: "#fff", boxShadow: "0 0 12px #fff", opacity: pct > 1 && pct < 99 ? 0.9 : 0 });
const ladderGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14, paddingBottom: 40 };
const ladderCard = { padding: 14, background: "var(--ink-2)", opacity: 0.85 };
const cardReached = { opacity: 1, borderColor: "rgba(255,200,61,0.35)" };
const cardNext = { opacity: 1, borderColor: "var(--hot-deep)", boxShadow: "0 0 0 1px rgba(255,45,77,0.25), 0 8px 30px rgba(0,0,0,0.4)" };
const statusDot = (reached, isNext) => ({ width: 12, height: 12, borderRadius: "50%", background: reached ? "var(--gold)" : isNext ? "var(--hot)" : "var(--faint)", boxShadow: reached ? "0 0 10px var(--gold)" : isNext ? "0 0 10px var(--hot)" : "none", marginTop: 6 });
const nextFlag = { position: "absolute", top: -2, right: -2, background: "var(--hot)", color: "var(--ink)", fontSize: 10, letterSpacing: "0.1em", padding: "2px 8px" };
