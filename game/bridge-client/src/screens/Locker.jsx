import { useMemo, useState, useEffect, useCallback } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, useImpact } from "../components/effects.jsx";
import KartPreview from "../components/KartPreview.jsx";
import PremiumBadge from "../components/PremiumBadge.jsx";
import ItemIcon from "../components/ItemIcon.jsx";
import { COVERED_BY_BODY } from "../components/cosmeticMeta.js";
import { useI18n } from "../api/i18n.jsx";

// Locker / cosmetics. Pick a slot, see what you own vs. what's still locked,
// and equip. Equipping requires owning the item AND the slot being unlocked by
// level (the backend enforces both; we mirror it in the UI). Real equip/unequip
// calls hit the backend and we refresh the profile via onChange.
export default function Locker({ profile, catalogue, onChange }) {
  const { t } = useI18n();
  const { pop, layer } = useImpact();
  const [slot, setSlot] = useState("body");
  const [busy, setBusy] = useState(null);
  const [tryOn, setTryOn] = useState(null);   // { slot, id, name } — live try-on preview
  const [stash, setStash] = useState([]);     // usable consumables (defs + owned counts)
  const [craftMsg, setCraftMsg] = useState(null);   // { text, bad }
  const [confirmScrap, setConfirmScrap] = useState(null);  // item pending confirmation
  const [useBusy, setUseBusy] = useState(null);
  const [emoteNonce, setEmoteNonce] = useState(0); // bump to (re)play the emote preview
  const loadStash = useCallback(async () => {
    try { const r = await api.getConsumables(); setStash(r.items || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadStash(); }, [loadStash]);

  if (!profile || !catalogue) return <div style={wrap} />;

  const slots = catalogue.slots || [];
  // Sea Glass is the ONE in-game currency: earned racing, earned recycling, and
  // spent on chests and crafting alike. It used to be a separate balance from
  // the "seashells" you earned in a race — two earnable currencies doing the
  // same job, which just meant you could be rich in one and broke in the other.
  const glass = profile?.balances?.CREDITS ?? 0;

  // SCRAP: break a loot-box item down into sea glass. Confirmed first — this is
  // destructive and there is no undo.
  const doScrap = async (item) => {
    setConfirmScrap(null);
    try {
      const r = await api.scrapItem(item.id);
      setCraftMsg({ text: `Scrapped ${item.name} → +${r.glass} sea glass` });
      onChange?.();
    } catch (e) { setCraftMsg({ text: e.message, bad: true }); }
    setTimeout(() => setCraftMsg(null), 2600);
  };
  // CRAFT: spend sea glass on the item you actually want.
  const doCraft = async (item) => {
    try {
      const r = await api.craftItem(item.id);
      setCraftMsg({ text: `Crafted ${item.name} for ${r.spent} sea glass` });
      onChange?.();
    } catch (e) { setCraftMsg({ text: e.message, bad: true }); }
    setTimeout(() => setCraftMsg(null), 2600);
  };
  const owned = new Set((profile.owned || []).map((c) => c.id));
  const loadout = profile.loadout || {};
  const bySlot = useMemo(() => {
    const m = {};
    for (const c of catalogue.cosmetics || []) (m[c.slot] ||= []).push(c);
    return m;
  }, [catalogue]);

  const activeSlotDef = slots.find((s) => s.key === slot) || slots[0];
  const slotUnlocked = profile.level >= (activeSlotDef?.unlockLevel || 1);
  const items = bySlot[slot] || [];
  // A full-body costume hides (and locks) the overlay slots it covers. Mirror the
  // backend rule so the UI never offers an equip that would be rejected/invisible.
  const bodyEquipped = !!loadout.body;
  const slotCovered = bodyEquipped && COVERED_BY_BODY.includes(slot);
  // On the Emote slot, play the hovered (or equipped) emote's movement in the
  // left preview so the ~3s animation actually shows — an icon alone can't convey
  // it. Emotes aren't worn art, so they'd otherwise be invisible in the preview.
  const previewEmote = slot === "emote"
    ? ((tryOn && tryOn.slot === "emote") ? tryOn.id : (loadout.emote || null))
    : null;

  const onEquip = async (item, e) => {
    if (!owned.has(item.id) || !slotUnlocked) return;
    setBusy(item.id);
    try {
      await api.equip(item.id);
      if (e) pop(e.clientX, e.clientY);
      await onChange();
    } catch (err) { console.error(err); }
    finally { setBusy(null); }
  };
  const onUnequip = async () => {
    if (activeSlotDef?.alwaysFilled) return;
    setBusy("unequip");
    try { await api.unequip(slot); await onChange(); } catch (e) { console.error(e); } finally { setBusy(null); }
  };
  // Pop a consumable: the backend applies its reward (currency/XP) then we refresh
  // the stash counts and the profile (level/XP/wallet may have moved).
  const onUseConsumable = async (id) => {
    setUseBusy(id);
    try { await api.useConsumable(id); await loadStash(); await onChange(); }
    catch (e) { console.error(e); }
    finally { setUseBusy(null); }
  };

  return (
    <div style={wrap}>
      <SpeedLines />
      {layer}
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr" }}>
        {/* LEFT: pilot preview */}
        <div style={previewCol}>
          <div className="tag" style={{ marginBottom: 14 }}><span>{tryOn ? t("locker.tryingOn") : t("locker.loadout")}</span></div>
          {profile.premium && <div style={{ marginBottom: 12 }}><PremiumBadge premium={profile.premium} premiumUntil={profile.premiumUntil} size="sm" /></div>}
          <KartPreview loadout={tryOn ? { ...loadout, [tryOn.slot]: tryOn.id } : loadout} height={280} />
          <div className="faint" style={{ fontSize: 11, textAlign: "center", marginTop: 6, minHeight: 14 }}>
            {tryOn ? tryOn.name : t("locker.hoverHint")}
          </div>
          <div className="col gap-s" style={{ marginTop: 18, width: "100%" }}>
            {slots.filter((s) => loadout[s.key]).map((s) => {
              const c = (catalogue.cosmetics || []).find((x) => x.id === loadout[s.key]);
              return (
                <div key={s.key} className="row" style={equipRow} onClick={() => setSlot(s.key)}>
                  <span className="faint" style={{ fontSize: 10, width: 70, letterSpacing: "0.08em" }}>{s.label.toUpperCase()}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c?.name || loadout[s.key]}</span>
                  {s.carriesIdColor && <span className="impactf" style={{ marginLeft: "auto", fontSize: 10, color: "var(--volt)", letterSpacing: "0.08em" }} title={t("locker.idTitle")}>{t("locker.id")}</span>}
                </div>
              );
            })}
          </div>

          {stash.some((c) => c.count > 0) && (
            <div style={{ marginTop: 20, width: "100%" }}>
              <div className="tag" style={{ marginBottom: 10 }}><span>{t("locker.stash")}</span></div>
              <div className="col gap-s">
                {stash.filter((c) => c.count > 0).map((c) => (
                  <div key={c.id} className="row" style={{ ...equipRow, cursor: "default", gap: 10, alignItems: "center" }}>
                    <span className="kanji" style={{ fontSize: 14, color: "var(--gold)" }}>{c.glyph}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name} <span className="faint">×{c.count}</span></div>
                      <div className="faint" style={{ fontSize: 10 }}>{c.desc}</div>
                    </div>
                    <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }} disabled={useBusy === c.id}
                      onClick={() => onUseConsumable(c.id)}>{useBusy === c.id ? "…" : t("locker.use")}</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: slot tabs + grid */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={tabsRow}>
            {slots.map((s) => {
              const locked = profile.level < (s.unlockLevel || 1);
              const covered = bodyEquipped && COVERED_BY_BODY.includes(s.key);
              const on = s.key === slot;
              return (
                <button key={s.key} onClick={() => setSlot(s.key)} style={{ ...slotTab, ...(on ? slotTabOn : null), ...(covered ? { opacity: 0.5 } : null) }} title={locked ? t("locker.unlocksAtLevel", { n: s.unlockLevel }) : covered ? t("locker.hiddenByCostume") : s.label}>
                  <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.06em" }}>{s.label.toUpperCase()}</span>
                  {locked && <span style={{ fontSize: 10, marginLeft: 6, color: "var(--faint)" }}>🔒{s.unlockLevel}</span>}
                  {!locked && covered && <span style={{ fontSize: 10, marginLeft: 6 }} title={t("locker.hiddenByCostume")}>🥋</span>}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <div className="display" style={{ fontSize: 38, lineHeight: 0.9 }}>{activeSlotDef?.label}</div>
                <div className="impactf" style={{ fontSize: 13, color: "var(--volt)", letterSpacing: "0.1em" }}>
                  ᜃ {glass.toLocaleString()} SEA GLASS
                </div>
              </div>
              {craftMsg && (
                <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800,
                  color: craftMsg.bad ? "var(--hot)" : "var(--volt)" }}>{craftMsg.text}</div>
              )}
              {!slotUnlocked && <div style={{ color: "var(--hot)", fontWeight: 700, fontSize: 13 }}>{t("locker.reachLevelSlot", { n: activeSlotDef.unlockLevel })}</div>}
              {slotUnlocked && slotCovered && <div style={{ color: "var(--gold)", fontWeight: 700, fontSize: 13 }}>{t("locker.hiddenUnequip")}</div>}
              {slotUnlocked && !slotCovered && activeSlotDef?.carriesIdColor && <div className="dim" style={{ fontSize: 13 }}>{t("locker.alwaysWorn")}</div>}
            </div>
            {slotUnlocked && !slotCovered && !activeSlotDef?.alwaysFilled && loadout[slot] && (
              <button className="btn btn-ghost" onClick={onUnequip} disabled={busy === "unequip"}>{t("locker.unequip")}</button>
            )}
          </div>

          <div style={grid} onMouseLeave={() => setTryOn(null)}>
            {/* "(None)" tile — unequip this slot, for slots that support being
                empty (alwaysFilled slots like Tool/Breather/Battery/Vista can't). */}
            {slotUnlocked && !slotCovered && !activeSlotDef?.alwaysFilled && (
              <button key="__none" onClick={onUnequip} disabled={busy === "unequip"}
                onMouseEnter={() => setTryOn(null)}
                style={{ ...card, ...(!loadout[slot] ? cardEquipped : null), cursor: loadout[slot] ? "pointer" : "default" }}>
                <div style={{ ...rarityBar, background: "var(--line)" }} />
                <div style={cardArt("Common")}>
                  <span className="display" style={{ fontSize: 30, color: "var(--dim)" }}>∅</span>
                </div>
                <div className="impactf" style={{ fontSize: 12, marginTop: 8, color: "var(--paper)" }}>{t("locker.none")}</div>
                <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--dim)", textTransform: "uppercase" }}>{t("locker.unequip")}</span>
                </div>
                {!loadout[slot] && <div style={equippedFlag} className="impactf">{t("locker.equipped")}</div>}
              </button>
            )}
            {items.map((item) => {
              const isOwned = owned.has(item.id);
              const isEquipped = loadout[slot] === item.id;
              const canEquip = isOwned && slotUnlocked && !isEquipped && !slotCovered;
              return (
                <button key={item.id} onClick={(e) => { if (canEquip) onEquip(item, e); if (item.slot === "emote") setEmoteNonce((n) => n + 1); }} disabled={busy === item.id}
                  onMouseEnter={() => { setTryOn({ slot: item.slot, id: item.id, name: item.name }); if (item.slot === "emote") setEmoteNonce((n) => n + 1); }}
                  className={item.rarity === "Mythic" ? "mythic" : undefined}
                  style={{ ...card, ...(isEquipped ? cardEquipped : null), ...(!isOwned ? cardLocked : null), cursor: canEquip ? "pointer" : "default" }}>
                  <div style={{ ...rarityBar, background: rarityColor(item.rarity) }} />
                  <div style={cardArt(item.rarity)}>
                    <ItemIcon id={item.id} slot={item.slot} color={rarityColor(item.rarity)} dim={!isOwned} />
                  </div>
                  <div className="impactf" style={{ fontSize: 12, marginTop: 8, color: isOwned ? "var(--paper)" : "var(--faint)" }}>{item.name}</div>
                  <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                    {item.rarity === "Mythic"
                      ? <span className="mythic-tag">MYTHIC</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: rarityColor(item.rarity) }}>{(item.rarity || "Common").toUpperCase()}</span>}
                    {!isOwned && <span className="faint" style={{ fontSize: 10, textTransform: "uppercase" }}>{sourceLabel(item.source, t)}</span>}
                  </div>
                  {isEquipped && <div style={equippedFlag} className="impactf">{t("locker.equipped")}</div>}

                  {/* SEA GLASS: scrap what you don't want, craft what you do.
                      Only loot-box items — anything earned through progression is
                      untouchable, and the server enforces that too. */}
                  {item.craftable && isOwned && !isEquipped && (
                    <div
                      role="button" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setConfirmScrap(item); }}
                      style={{ marginTop: 6, padding: "4px 0", borderRadius: 6, cursor: "pointer",
                        border: "1px solid var(--line)", fontSize: 10, fontWeight: 800,
                        letterSpacing: "0.08em", color: "var(--dim)", textAlign: "center" }}>
                      SCRAP → {item.scrapValue} ᜃ
                    </div>
                  )}
                  {item.craftable && !isOwned && (
                    <div
                      role="button" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); if (glass >= item.craftCost) doCraft(item); }}
                      style={{ marginTop: 6, padding: "4px 0", borderRadius: 6,
                        cursor: glass >= item.craftCost ? "pointer" : "not-allowed",
                        border: `1px solid ${glass >= item.craftCost ? "var(--volt)" : "var(--line)"}`,
                        background: glass >= item.craftCost ? "rgba(47,230,200,0.14)" : "transparent",
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                        color: glass >= item.craftCost ? "var(--volt)" : "var(--faint)", textAlign: "center" }}>
                      CRAFT · {item.craftCost} ᜃ
                    </div>
                  )}
                  {!item.craftable && !isOwned && (
                    <div className="faint" style={{ marginTop: 6, fontSize: 9.5, textAlign: "center", letterSpacing: "0.06em" }}>
                      EARNED, NOT CRAFTED
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SCRAP CONFIRMATION — destructive, and there's no undo. */}
      {confirmScrap && (
        <div onClick={() => setConfirmScrap(null)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(3,20,27,0.8)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="leather-panel"
            style={{ width: "min(380px, 100%)", padding: 22, borderRadius: 14, border: "2px solid var(--line)" }}>
            <div className="display" style={{ fontSize: 24, color: "#fff" }}>SCRAP {confirmScrap.name.toUpperCase()}?</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
              It's gone for good. You get <b style={{ color: "var(--volt)" }}>{confirmScrap.scrapValue} sea glass</b> back —
              about a third of what it costs to craft. Scrapping is for duplicates you'll never wear,
              not a way to trade up.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmScrap(null)}>KEEP IT</button>
              <button className="btn" style={{ flex: 1, background: "var(--hot)" }} onClick={() => doScrap(confirmScrap)}>SCRAP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function glyphFor() { return "★"; }
function rarityColor(r) { return { Common: "var(--r-common)", Rare: "var(--r-rare)", Epic: "var(--r-epic)", Legendary: "var(--r-legendary)", Mythic: "var(--r-mythic)" }[r] || "var(--r-common)"; }
function sourceLabel(s, t) { return { level: t("locker.source.level"), box: t("locker.source.box"), starter: t("locker.source.starter"), code: t("locker.source.code") }[s] || t("locker.source.locked"); }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 20% 0%, #211726 0%, var(--ink) 55%)" };
const previewCol = { borderRight: "2px solid var(--line)", padding: "28px 24px", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--ink-2)", overflowY: "auto" };
const equipRow = { gap: 10, padding: "8px 10px", border: "1px solid var(--line)", background: "var(--ink)", cursor: "pointer", borderRadius: "4px" };
const tabsRow = { display: "flex", flexWrap: "wrap", gap: 2, padding: "16px 28px 0", borderBottom: "2px solid var(--line)" };
const slotTab = { padding: "9px 14px", background: "transparent", color: "var(--dim)", borderBottom: "3px solid transparent" };
const slotTabOn = { color: "var(--paper)", borderBottomColor: "var(--hot)" };
const grid = { flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, padding: "0 28px 28px" };
const card = { position: "relative", textAlign: "left", background: "var(--ink-3)", border: "2px solid var(--line)", padding: 12, borderRadius: "6px", transition: "transform .08s, border-color .12s" };
const cardEquipped = { borderColor: "var(--gold)", boxShadow: "0 0 0 1px rgba(255,200,61,0.3)" };
const cardLocked = { opacity: 0.6 };
const cardArt = (r) => ({ height: 78, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rarityColor(r)}22 0%, transparent 70%)`, border: "1px solid var(--line)" });
const rarityBar = { position: "absolute", top: 0, left: 0, right: 0, height: 3 };
const equippedFlag = { position: "absolute", bottom: -2, right: -2, background: "var(--gold)", color: "var(--ink)", fontSize: 9, letterSpacing: "0.08em", padding: "2px 7px", textTransform: "uppercase" };
