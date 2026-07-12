import { useI18n } from "../api/i18n.jsx";
import { useEffect, useRef, useState } from "react";

// Vertical nav rail: the profile circle sits up top (it doubles as the Profile
// link, so there's no separate Profile tab), the destinations run down the
// middle, and the level chip + sign-out anchor the bottom. Tabs are label-only
// (no kanji) to stay compact so every destination fits on short viewports.
export default function NavRail({ screen, setScreen, user, profile, catalogue, onSignOut, newsUnread = 0 }) {
  const { t } = useI18n();
  const items = [
    { id: "play", label: t("nav.play") },
    { id: "hangar", label: t("nav.hangar") },
    { id: "news", label: t("nav.news") },
    { id: "perks", label: t("nav.perks") },
    { id: "locker", label: t("nav.locker") },
    { id: "shop", label: t("nav.shop") },
    { id: "wheels", label: t("nav.wheels") },
    { id: "settings", label: t("nav.settings") },
  ];
  if (user?.adminRole) items.push({ id: "admin", label: t("nav.admin") });
  // Resolve the selected avatar/border glyphs+color for the identity circle.
  const avatar = (catalogue?.avatars || []).find((a) => a.id === profile?.selectedAvatar);
  const border = (catalogue?.borders || []).find((b) => b.id === profile?.selectedBorder);
  const onProfile = screen === "profile";

  // The nav list scrolls on short viewports but the scrollbar is hidden, so show
  // fade + chevron hints when there's more above/below to reveal it's scrollable.
  const scrollRef = useRef(null);
  const [more, setMore] = useState({ up: false, down: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const up = el.scrollTop > 2;
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [items.length]);

  return (
    <div style={rail} className="wood-panel">
      {/* Profile circle up top — replaces the old "BR" mark and opens Profile. */}
      <div style={{ textAlign: "center", position: "relative" }}>
        <div className="brass-rivet" style={{ top: 0, left: 4 }} />
        <div className="brass-rivet" style={{ top: 0, right: 4 }} />
        <button
          onClick={() => setScreen("profile")}
          title={t("nav.profile")}
          style={{ display: "inline-grid", placeItems: "center", width: 48, height: 48, borderRadius: "50%",
            border: `2px solid ${onProfile ? "var(--hot)" : (border?.color || "var(--line)")}`, background: "var(--ink-3)",
            boxShadow: onProfile ? "0 0 12px var(--hot)" : `0 0 10px ${border?.color || "transparent"}`, padding: 0, cursor: "pointer" }}
        >
          <span className="kanji" style={{ fontSize: 22, color: "var(--paper)" }}>{avatar?.glyph || (user?.name?.[0]?.toUpperCase() || "?")}</span>
        </button>
        <div style={{ height: 2, background: "var(--hot)", margin: "14px 6px 0" }} />
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, marginTop: 14, display: "flex" }}>
        <div ref={scrollRef} className="col gap-s nav-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", width: "100%" }}>
          {items.map((it) => {
            const on = screen === it.id;
            return (
              <button key={it.id} onClick={() => setScreen(it.id)} style={{ ...tab, ...(on ? tabOn : null) }}>
                <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.08em", color: on ? "var(--paper)" : "var(--dim)" }}>{it.label.toUpperCase()}</span>
                {it.id === "news" && newsUnread > 0 && <span style={navDot} title={`${newsUnread} new`} />}
                {on && <span style={tabBar} />}
              </button>
            );
          })}
        </div>
        {more.up && <div style={fadeTop} />}
        {more.down && <div style={fadeBottom} />}
        {more.down && <div className="nav-scroll-chev" style={scrollChev}>⌄</div>}
      </div>

      <div style={{ textAlign: "center", marginTop: 8 }}>
        {profile && (
          <div style={lvlChip} title={`${profile.xp} XP`}>
            <div className="faint" style={{ fontSize: 8, letterSpacing: "0.15em" }}>LV</div>
            <div className="display" style={{ fontSize: 26, color: "var(--gold)", lineHeight: 0.9 }}>{profile.level}</div>
          </div>
        )}
        <div className="impactf" style={{ fontSize: 10, color: "var(--paper)", marginTop: 8, maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
        <button className="faint" style={signout} onClick={onSignOut} title={t("nav.signOut")}>⏻</button>
      </div>
    </div>
  );
}

const rail = { width: 76, height: "100%", background: "var(--ink-2)", borderRight: "2px solid var(--line)", display: "flex", flexDirection: "column", padding: "16px 8px", zIndex: 5, overflow: "hidden", flexShrink: 0 };
const tab = { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", padding: "11px 0", color: "var(--paper)", background: "transparent", flexShrink: 0 };
const tabOn = { background: "var(--ink-3)" };
const tabBar = { position: "absolute", left: -8, top: 6, bottom: 6, width: 3, background: "var(--hot)" };
const navDot = { position: "absolute", top: 7, right: 12, width: 9, height: 9, borderRadius: "50%", background: "var(--hot)", boxShadow: "0 0 7px var(--hot)", border: "1px solid var(--ink)" };
const lvlChip = { display: "inline-flex", flexDirection: "column", alignItems: "center", padding: "6px 10px", border: "2px solid var(--gold)", background: "rgba(255,200,61,0.08)", clipPath: "polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)" };
const signout = { marginTop: 10, fontSize: 18, background: "transparent", padding: 4 };
// Scroll hints for the (scrollbar-hidden) nav list: soft fades top/bottom plus a
// bouncing chevron at the bottom so it reads as scrollable on short viewports.
const fadeTop = { position: "absolute", top: 0, left: 0, right: 0, height: 16, pointerEvents: "none", background: "linear-gradient(to bottom, var(--ink-2), transparent)", zIndex: 6 };
const fadeBottom = { position: "absolute", bottom: 0, left: 0, right: 0, height: 22, pointerEvents: "none", background: "linear-gradient(to top, var(--ink-2), transparent)", zIndex: 6 };
const scrollChev = { position: "absolute", bottom: 1, left: "50%", zIndex: 7, pointerEvents: "none", color: "var(--hot)", fontSize: 16, lineHeight: 1, fontWeight: 700 };
