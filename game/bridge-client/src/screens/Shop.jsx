import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { SpeedLines, Particles, useImpact, KanjiFlash } from "../components/effects.jsx";
import ItemIcon from "../components/ItemIcon.jsx";
import KartPreview from "../components/KartPreview.jsx";
import PremiumBadge from "../components/PremiumBadge.jsx";
import NuggetIcon from "../components/NuggetIcon.jsx";
import RewardedAd from "../components/RewardedAd.jsx";

// Shop. Three storefronts: Credits (earned), Cash (real money / $1 test items via
// Stripe stub checkout), and Loot Boxes (server-rolled). Reads the real catalogue
// + wallet from the backend; never sees admin-only worth/dropWeight. Buying a
// credits item and opening a box are immediate; cash items run the Stripe stub
// checkout (create session -> simulate webhook -> item granted).
export default function Shop({ profile, catalogue, onChange }) {
  const { t } = useI18n();
  const { pop, layer } = useImpact();
  const [tab, setTab] = useState("boxes");   // seashells buy chests, not cosmetics
  const [wallet, setWallet] = useState({ CREDITS: 0, PREMIUM: 0 });
  const [items, setItems] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [packs, setPacks] = useState([]);
  const [loyalty, setLoyalty] = useState(null);
  const [adInfo, setAdInfo] = useState(null);     // { amount, cap, used, remaining }
  const [adPlaying, setAdPlaying] = useState(false);
  const [busy, setBusy] = useState(null);
  const [boxPreview, setBoxPreview] = useState(null);   // a drop you clicked to preview
  const [reveal, setReveal] = useState(null);     // box/cash reward reveal overlay
  const [flash, setFlash] = useState(null);
  const [note, setNote] = useState(null);
  const [tryOn, setTryOn] = useState(null);       // { slot, id, name } — live try-on preview

  const cosmeticsById = Object.fromEntries((catalogue?.cosmetics || []).map((c) => [c.id, c]));
  const baseLoadout = profile?.loadout || {};
  const previewLoadout = tryOn ? { ...baseLoadout, [tryOn.slot]: tryOn.id } : baseLoadout;

  const refresh = useCallback(async () => {
    const [w, ci, pi, bx, pk, ly, ad] = await Promise.all([
      api.getWallet(),
      api.listItems("CREDITS"),
      api.listItems("PREMIUM"),
      api.listBoxes(),
      api.getPacks(),
      api.getLoyalty(),
      api.getAdReward(),
    ]);
    setWallet(w);
    setItems([...ci, ...pi]);
    setBoxes(bx);
    setPacks(pk.packs || []);
    setLoyalty(ly);
    setAdInfo(ad);
  }, []);
  useEffect(() => { refresh().catch((e) => setNote(e.message)); }, [refresh]);

  const toast = (m) => { setNote(m); setTimeout(() => setNote(null), 2600); };

  // Equip a freshly received cosmetic straight from the reveal overlay. The
  // backend enforces ownership + slot unlock; on rejection we just toast.
  const equipReward = async (cid) => {
    if (!cid) return;
    try { await api.equip(cid); await onChange?.(); toast(t("shop.equipped")); }
    catch (err) { toast(err.message || t("shop.cantEquip")); }
  };

  // Buy a cosmetic by spending its currency balance (Silver or Shells).
  const buy = async (it, e) => {
    setBusy(it.id);
    try {
      const r = await api.buyItem(it.id);
      if (e) pop(e.clientX, e.clientY);
      setWallet((w) => ({ ...w, [r.currency]: r.balance }));
      setFlash({ text: t("shop.flash.acquired").toUpperCase(), sub: t("shop.acquiredSub", { name: it.name }), color: "var(--gold)" });
      await onChange?.();
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  // Buy a Shell bundle with real money (Stripe; stubbed in dev).
  const buyGold = async (pack) => {
    setBusy(pack.id);
    try {
      const session = await api.checkoutPack(pack.id);
      if (session.devSimulate) {
        await api.devCompleteCheckout(session.devSimulate.body);
        await refresh(); await onChange?.();
        toast(t("shop.goldAddedToast", { n: pack.prisms }));
      } else if (session.checkoutUrl) {
        window.location.href = session.checkoutUrl; // live Stripe hosted checkout
      }
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  const openBox = async (box, e) => {
    if (wallet[box.currency] < box.price) return toast(box.currency === "PREMIUM" ? t("shop.notEnoughGold") : "Not enough sea glass.");
    setBusy(box.id);
    try {
      if (e) pop(e.clientX, e.clientY);
      const r = await api.openBox(box.id);
      setWallet((w) => ({ ...w, [box.currency]: r.balance }));
      setReveal({ reward: r.reward, kind: "box", boxName: box.name });
      await onChange?.();
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  // Claim a reached Frontier Loyalty milestone: grants its premium time + the
  // exclusive cosmetic. Reveals the cosmetic, then refreshes wallet/loyalty and
  // the profile so the new item shows up in the Locker.
  const claimLoyalty = async (m) => {
    setBusy(m.id);
    try {
      const r = await api.claimLoyalty(m.id);
      if (r.alreadyClaimed) { toast(t("shop.alreadyClaimed")); }
      else {
        const cid = (m.cosmetics || [])[0];
        const cosmetic = cid ? cosmeticsById[cid] : null;
        setReveal({ kind: "loyalty", boxName: m.label,
          reward: { item: cosmetic?.name || m.label, rarity: cosmetic?.rarity || "Legendary", cosmeticId: cid, newlyOwned: true } });
        setFlash({ text: t("shop.flash.reward").toUpperCase(), sub: t("shop.claimedSub", { name: m.label }), color: "var(--gold)" });
      }
      await refresh(); await onChange?.();
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  // Watch-ad flow: open the (stubbed) rewarded ad; on completion the SERVER grants
  // and caps the reward, so we just trust its returned balance/remaining. Bailing
  // out of the ad early grants nothing.
  const startAd = () => {
    if (!adInfo || adInfo.remaining <= 0) return toast(t("shop.watchAd.soldOut"));
    setAdPlaying(true);
  };
  const onAdComplete = async () => {
    setAdPlaying(false);
    setBusy("ad");
    try {
      const r = await api.claimAdReward();
      setWallet((w) => ({ ...w, [r.currency]: r.balance }));
      setAdInfo((a) => ({ ...(a || {}), amount: r.amount, cap: r.cap, used: r.used, remaining: r.remaining }));
      setFlash({ text: t("shop.watchAd.claimed", { n: r.amount }).toUpperCase(), sub: t("shop.watchAd.remaining", { n: r.remaining, cap: r.cap }), color: "var(--volt)" });
      await onChange?.();
    } catch (err) {
      toast(err.message || t("shop.watchAd.failed"));
      await refresh().catch(() => {});
    } finally { setBusy(null); }
  };

  if (!catalogue) return <div style={wrap} />;
  const creditsItems = items.filter((i) => i.currency === "CREDITS");
  const cashItems = items.filter((i) => i.currency === "PREMIUM");

  return (
    <div style={wrap}>
      <SpeedLines hot />
      <Particles density={22} color="rgba(255,200,61,0.4)" />
      {layer}
      {flash && <KanjiFlash {...flash} onDone={() => setFlash(null)} />}
      {reveal && <RevealOverlay reveal={reveal} cosmeticsById={cosmeticsById} onClose={() => setReveal(null)} onEquip={equipReward} />}
      {adPlaying && <RewardedAd amount={adInfo?.amount || 0} onComplete={onAdComplete} onCancel={() => setAdPlaying(false)} />}
      {note && <div style={toastStyle}>{note}</div>}

      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column" }}>
        {/* header: title + balances */}
        <div style={{ padding: "26px 36px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 className="display" style={{ fontSize: 64, margin: 0, lineHeight: 0.85, textTransform: "uppercase" }}>{t("shop.title")}</h1>
          </div>
          <div className="row gap-m" style={{ alignItems: "center" }}>
            <PremiumBadge premium={wallet.premium} premiumUntil={wallet.premiumUntil} />
            <Balance label="SEA GLASS" value={wallet.CREDITS} color="var(--volt)" variant="silver" />
            <Balance label="SHELLS" value={wallet.PREMIUM} color="var(--gold)" variant="gold" />
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 2, padding: "16px 36px 0", borderBottom: "2px solid var(--line)" }}>
          {/* Sea Glass buy BOXES, not cosmetics. If you want a specific in-game
              item you scrap duplicates for sea glass and craft it in the Locker —
              that's the whole point of the crafting economy. Shells buy
              the premium pieces, which can never be crafted. */}
          {[["boxes", "BEACH CHESTS"], ["cash", "SHELL STORE"], ["loyalty", "LOYALTY"]].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setTryOn(null); }} style={{ ...tabBtn, ...(tab === k ? tabOn : null) }}>
              <span className="impactf" style={{ fontSize: 12 }}>{label.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* pilot preview sidebar */}
          <div style={shopPreviewCol}>
            <div className="tag" style={{ marginBottom: 14 }}><span>{tryOn ? t("shop.tryingOn") : t("shop.yourRider")}</span></div>
            <KartPreview loadout={previewLoadout} height={300} />
            <div className="faint" style={{ fontSize: 11, textAlign: "center", marginTop: 8, minHeight: 14 }}>
              {tryOn ? tryOn.name : t("shop.hoverToTry")}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "22px 36px 40px" }} onMouseLeave={() => setTryOn(null)}>

          {tab === "cash" && (
            <>
              <div className="panel" style={{ padding: "10px 16px", marginBottom: 16, borderColor: "var(--hot-deep)", display: "block" }}>
                <span className="impactf" style={{ fontSize: 11, color: "var(--gold)", textTransform: "uppercase" }}>{t("shop.testMode")}</span>
                <span className="dim" style={{ fontSize: 13, marginLeft: 10 }}>{t("shop.testModeDesc")}</span>
              </div>
              <div className="tag" style={{ marginBottom: 10 }}><span>{t("shop.buyGoldNuggets")}</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
                {packs.map((p) => (
                  <BundleCard key={p.id} pack={p} busy={busy === p.id} onBuy={() => buyGold(p)} />
                ))}
              </div>
              <div className="tag" style={{ marginBottom: 10 }}><span>{t("shop.goldStoreSpend")}</span></div>
              <Grid>
                {cashItems.map((it) => (
                  <ItemCard key={it.id} it={it} cosmetic={cosmeticsById[it.cosmeticId]} owned={isOwned(profile, it)} busy={busy === it.id}
                    cur="cash" canAfford={wallet.PREMIUM >= it.price} onBuy={(e) => buy(it, e)} onHover={setTryOn} />
                ))}
              </Grid>
            </>
          )}
          {tab === "boxes" && (
            <>
              <WatchAdCard info={adInfo} busy={busy === "ad"} onWatch={startAd} />
              <div className="panel" style={{ padding: "12px 16px", marginBottom: 16, display: "block", borderColor: "var(--volt)" }}>
                <div className="impactf" style={{ fontSize: 11, color: "var(--volt)", letterSpacing: "0.12em" }}>HOW IN-GAME ITEMS WORK</div>
                <div className="dim" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                  Chests drop cosmetics. Got a duplicate you'll never wear? <b style={{ color: "var(--paper)" }}>Scrap it in the Locker</b> for
                  sea glass, then <b style={{ color: "var(--paper)" }}>craft</b> the one you actually want. Nothing in a chest is sold directly —
                  you either find it or you make it.
                </div>
              </div>
              <Grid>
              {boxes.map((box) => (
                <BoxCard key={box.id} box={box} busy={busy === box.id} balance={wallet[box.currency]}
                  onOpen={(e) => openBox(box, e)}
                  onPreview={(drop) => setBoxPreview(drop)} />
              ))}
              </Grid>
            </>
          )}
          {/* PREVIEW A DROP — see it on your own kart before you spend a shell. */}
          {boxPreview && (
            <div onClick={() => setBoxPreview(null)}
              style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(3,20,27,0.82)", display: "grid", placeItems: "center", padding: 20 }}>
              <div onClick={(e) => e.stopPropagation()} className="leather-panel"
                style={{ width: "min(440px, 100%)", padding: 20, borderRadius: 14, border: "2px solid var(--line)" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <div className="display" style={{ fontSize: 26, color: "var(--paper)" }}>{boxPreview.item}</div>
                  <div className="impactf" style={{ fontSize: 12, color: rarityColor(boxPreview.rarity) }}>
                    {(boxPreview.rarity || "").toUpperCase()} · {boxPreview.chance}%
                  </div>
                </div>
                <KartPreview
                  loadout={{ ...(profile?.loadout || {}), [boxPreview.slot]: boxPreview.cosmeticId }}
                  height={260}
                />
                <div className="dim" style={{ fontSize: 12, textAlign: "center", marginTop: -6 }}>
                  Shown on your kart. You don't own this yet.
                </div>
                <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={() => setBoxPreview(null)}>CLOSE</button>
              </div>
            </div>
          )}
          {tab === "loyalty" && (
            <LoyaltyPanel loyalty={loyalty} cosmeticsById={cosmeticsById} busy={busy} onClaim={claimLoyalty} />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function isOwned(profile, it) {
  return !!it.cosmeticId && (profile?.owned || []).some((o) => o.id === it.cosmeticId);
}

function Balance({ label, value, color, variant }) {
  return (
    <div className="wood-panel" style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
      <NuggetIcon variant={variant} size={24} />
      <div>
        <div className="faint" style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <div className="display" style={{ fontSize: 24, lineHeight: 0.9, color }}>{(value ?? 0).toLocaleString()}</div>
      </div>
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>{children}</div>;
}

// "Watch an ad -> Sea Glass" banner at the top of the Silver Store. Shows how
// many claims remain today; the server is the source of truth for both the cap and
// the grant. `info == null` means the status is still loading.
function WatchAdCard({ info, busy, onWatch }) {
  const { t } = useI18n();
  const amount = info?.amount ?? 0;
  const cap = info?.cap ?? 0;
  const remaining = info?.remaining ?? 0;
  const soldOut = info != null && remaining <= 0;
  return (
    <div className="wood-panel" style={{ padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ display: "grid", placeItems: "center", width: 54, height: 54, border: "1px solid var(--line)", background: "radial-gradient(circle at 50% 40%, rgba(120,220,255,0.16), transparent 70%)" }}>
        <NuggetIcon variant="silver" size={34} />
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="tag" style={{ marginBottom: 4 }}><span>{t("shop.watchAd.tag")}</span></div>
        <div className="impactf" style={{ fontSize: 18 }}>{t("shop.watchAd.title")}</div>
        <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("shop.watchAd.desc", { n: amount, cap })}</div>
      </div>
      <div style={{ textAlign: "center", minWidth: 160 }}>
        <button className="btn" style={{ width: "100%", fontSize: 14, opacity: soldOut ? 0.5 : 1 }}
          disabled={busy || soldOut || info == null} onClick={onWatch}>
          {busy ? "…" : (
            <span className="row gap-s" style={{ justifyContent: "center", alignItems: "center" }}>
              <span style={{ color: "var(--volt)" }}>{t("shop.watchAd.cta", { n: amount })}</span>
              <NuggetIcon variant="silver" size={15} />
            </span>
          )}
        </button>
        <div className="faint" style={{ fontSize: 10, marginTop: 6, letterSpacing: "0.08em" }}>
          {info == null ? "" : soldOut ? t("shop.watchAd.soldOut") : t("shop.watchAd.remaining", { n: remaining, cap })}
        </div>
      </div>
    </div>
  );
}

function ItemCard({ it, cosmetic, owned, busy, cur, canAfford, onBuy, onHover }) {
  const { t } = useI18n();
  const rc = rarityColor(it.rarity);
  const variant = cur === "cash" ? "gold" : "silver";
  const curName = cur === "cash" ? t("shop.gold") : t("shop.silver");
  const priceColor = cur === "cash" ? "var(--gold)" : "var(--volt)";
  const canTry = cosmetic && onHover;
  return (
    <div className="leather-panel" style={{ padding: 14, position: "relative", textAlign: "center" }}
      onMouseEnter={() => canTry && onHover({ slot: cosmetic.slot, id: cosmetic.id, name: it.name })}>
      <div className="brass-rivet" style={{ top: 4, left: 4 }} />
      <div className="brass-rivet" style={{ top: 4, right: 4 }} />
      <div className="brass-rivet" style={{ bottom: 4, left: 4 }} />
      <div className="brass-rivet" style={{ bottom: 4, right: 4 }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: rc }} />
      <div style={{ height: 90, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rc}22 0%, transparent 70%)`, border: "1px solid var(--line)", marginTop: 8 }}>
        <ItemIcon id={cosmetic?.id} slot={cosmetic?.slot} color={rc} glyphSize={34} />
      </div>
      <div className="impactf" style={{ fontSize: 13, marginTop: 10 }}>{it.name}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: rc, letterSpacing: "0.08em" }}>{(it.rarity || "Common").toUpperCase()}</div>
      <div style={{ marginTop: 12 }}>
        {owned ? (
          <div className="impactf" style={{ fontSize: 12, color: "var(--gold)", textAlign: "center", padding: "10px 0", textTransform: "uppercase" }}>{t("shop.owned")}</div>
        ) : (
          <button className={`btn ${cur === "cash" ? "btn-hot" : ""}`} style={{ width: "100%", fontSize: 14, opacity: canAfford ? 1 : 0.5 }}
            disabled={busy || !canAfford} onClick={onBuy}>
            {busy ? "…" : <span className="row gap-s" style={{ justifyContent: "center", alignItems: "center" }}><span style={{ color: priceColor }}>{(it.price ?? 0).toLocaleString()}</span><NuggetIcon variant={variant} size={15} /><span style={{ fontSize: 11, opacity: 0.85 }}>{curName}</span></span>}
          </button>
        )}
      </div>
    </div>
  );
}

function BundleCard({ pack, busy, onBuy }) {
  const { t } = useI18n();
  return (
    <div className="wanted-poster" style={{ padding: 18, textAlign: "center", position: "relative", margin: 4 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--gold)" }} />
      <div style={{ marginTop: 2, display: "flex", justifyContent: "center" }}><NuggetIcon variant="gold" size={30} /></div>
      <div className="display branded-text" style={{ fontSize: 26, color: "var(--gold)", lineHeight: 0.9 }}>{pack.prisms}</div>
      <div className="faint" style={{ fontSize: 10, letterSpacing: "0.1em", minHeight: 24, color: "var(--ink)" }}>{(pack.label || "").toUpperCase()}</div>
      <button className="btn btn-hot" style={{ width: "100%", fontSize: 14, marginTop: 8 }} disabled={busy} onClick={onBuy}>
        {busy ? "…" : t("shop.buyPrice", { price: pack.priceDisplay })}
      </button>
    </div>
  );
}

function BoxCard({ box, busy, balance, onOpen, onPreview }) {
  const { t } = useI18n();
  const afford = balance >= box.price;
  return (
    <div className="wood-panel panel-hot" style={{ padding: 16, position: "relative" }}>
      <div className="brass-rivet" style={{ top: 6, left: 6 }} />
      <div className="brass-rivet" style={{ top: 6, right: 6 }} />
      <div className="brass-rivet" style={{ bottom: 6, left: 6 }} />
      <div className="brass-rivet" style={{ bottom: 6, right: 6 }} />
      <div style={{ height: 110, display: "grid", placeItems: "center", background: "radial-gradient(circle at 50% 40%, rgba(255,45,77,0.18) 0%, transparent 70%)", border: "1px solid var(--line)" }}>
        <img
          src={`./items/box_${box.id}.png`}
          alt={box.name}
          draggable={false}
          style={{ height: 96, width: 96, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(120, 90, 50, 0.5))" }}
          onError={(e) => {
            const el = e.currentTarget;
            const fb = el.nextElementSibling;
            el.style.display = "none";
            if (fb) fb.style.display = "block";
          }}
        />
        <span className="display" style={{ display: "none", fontSize: 48, color: "var(--hot)" }}>▣</span>
      </div>
      <div className="impactf" style={{ fontSize: 15, marginTop: 12 }}>{box.name}</div>
      {/* EXACTLY what's inside, at what odds — and every drop is clickable so you
          can see it on your own kart BEFORE you spend anything. */}
      <div className="col gap-s" style={{ marginTop: 8, marginBottom: 12 }}>
        {(box.odds || []).map((o, i) => (
          <button key={i}
            onClick={(e) => { e.stopPropagation(); onPreview?.(o); }}
            title={`Preview ${o.item} on your kart`}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "3px 5px", borderRadius: 5, cursor: "pointer",
              background: "transparent", border: "1px solid transparent", fontSize: 11 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "var(--line)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}>
            <span className="row gap-s" style={{ alignItems: "center" }}>
              <span style={{ width: 6, height: 6, background: rarityColor(o.rarity), display: "inline-block" }} />
              <span style={{ color: "var(--paper)" }}>{o.item}</span>
              <span style={{ fontSize: 9, opacity: 0.55 }}>👁</span>
            </span>
            <span className="faint">{o.chance}%</span>
          </button>
        ))}
      </div>
      <button className="btn btn-hot" style={{ width: "100%", fontSize: 15, opacity: afford ? 1 : 0.5 }} disabled={busy || !afford} onClick={onOpen}>
        {busy ? t("shop.opening") : (
          <span className="row gap-s" style={{ justifyContent: "center", alignItems: "center" }}>
            {t("shop.open")} {box.price.toLocaleString()}
            <NuggetIcon variant={box.currency === "PREMIUM" ? "gold" : "silver"} size={15} />
            <span style={{ fontSize: 11, opacity: 0.85 }}>{box.currency === "PREMIUM" ? t("shop.gold") : t("shop.silver")}</span>
          </span>
        )}
      </button>
    </div>
  );
}

// Dramatic reveal for a box drop or a cash purchase.
function RevealOverlay({ reveal, cosmeticsById, onClose, onEquip }) {
  const { t } = useI18n();
  const reward = reveal.reward || { item: reveal.item?.name, rarity: reveal.item?.rarity, cosmeticId: reveal.item?.cosmeticId };
  const rc = rarityColor(reward.rarity);
  const cosmetic = cosmeticsById[reward.cosmeticId];
  const canEquip = !!cosmetic && reward.newlyOwned !== false;
  const header = reveal.kind === "box" ? t("shop.reveal.opened") : reveal.kind === "loyalty" ? t("shop.reveal.reward") : t("shop.reveal.purchased");
  return (
    <div style={revealWrap} onClick={onClose}>
      <SpeedLines hot />
      <div style={{ position: "relative", textAlign: "center", animation: "revealpop 0.5s cubic-bezier(.2,.9,.2,1)" }} onClick={(e) => e.stopPropagation()}>
        <div className="impactf" style={{ fontSize: 18, color: rc, letterSpacing: "0.3em", textTransform: "uppercase" }}>{header}</div>
        <div style={{ width: 220, height: 220, margin: "16px auto", display: "grid", placeItems: "center",
          background: `radial-gradient(circle, ${rc}33 0%, transparent 70%)`, border: `3px solid ${rc}`, boxShadow: `0 0 60px ${rc}66` }}>
          <ItemIcon id={cosmetic?.id} slot={cosmetic?.slot} color={rc} size="80%" glyphSize={90} />
        </div>
        <div className="display" style={{ fontSize: 52, color: "var(--paper)", lineHeight: 0.9 }}>{reward.item}</div>
        <div className="impactf" style={{ fontSize: 16, color: rc, letterSpacing: "0.15em", marginTop: 4 }}>{(reward.rarity || "").toUpperCase()}</div>
        {reward.newlyOwned === false && <div className="faint" style={{ marginTop: 8 }}>{t("shop.duplicate")}</div>}
        <div className="row gap-m" style={{ justifyContent: "center", marginTop: 24 }}>
          {canEquip && <button className="btn" onClick={() => { onEquip?.(reward.cosmeticId); onClose(); }}>{t("shop.equip")}</button>}
          <button className="btn btn-hot" onClick={onClose}>{t("shop.nice")}</button>
        </div>
      </div>
      <style>{`@keyframes revealpop{0%{transform:scale(0.5) rotate(-4deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}`}</style>
    </div>
  );
}

// Frontier Loyalty ladder: lifetime-spend "trail", a rail with milestone pegs,
// and per-milestone reward cards (premium time + an exclusive cosmetic).
function LoyaltyPanel({ loyalty, cosmeticsById, busy, onClaim }) {
  const { t } = useI18n();
  if (!loyalty) return <div className="dim" style={{ padding: 20 }}>{t("shop.loading")}</div>;
  const spent = loyalty.lifetimeSpendCents || 0;
  const ms = loyalty.milestones || [];
  const top = ms[ms.length - 1]?.spendCents || 1;
  const next = ms.find((m) => !m.reached);
  const pct = Math.min(100, (spent / top) * 100);
  return (
    <>
      <div className="panel" style={{ padding: "12px 18px", marginBottom: 18, borderColor: "var(--hot-deep)", display: "block" }}>
        <span className="impactf" style={{ fontSize: 11, color: "var(--gold)", textTransform: "uppercase" }}>{t("shop.frontierLoyalty")}</span>
        <span className="dim" style={{ fontSize: 13, marginLeft: 10 }}>
          {t("shop.loyaltyDesc")}
        </span>
      </div>

      <div className="panel" style={{ padding: "18px 22px", marginBottom: 22, display: "block" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <div className="faint" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>{t("shop.lifetimeOnTrail")}</div>
            <div className="display" style={{ fontSize: 40, color: "var(--gold)", lineHeight: 0.9 }}>{fmtUSD(spent)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {next ? (
              <>
                <div className="faint" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>{t("shop.next")} {next.label.toUpperCase()}</div>
                <div className="impactf" style={{ fontSize: 15, color: "var(--paper)" }}>{t("shop.toGo", { amount: fmtUSD(next.spendCents - spent) })}</div>
              </>
            ) : (
              <div className="impactf" style={{ fontSize: 15, color: "var(--gold)", textTransform: "uppercase" }}>{t("shop.trailBlazed")}</div>
            )}
          </div>
        </div>
        <div style={{ position: "relative", height: 14, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "linear-gradient(90deg, var(--hot), var(--gold))", transition: "width .5s" }} />
        </div>
        <div style={{ position: "relative", height: 22, marginTop: 4 }}>
          {ms.map((m) => (
            <div key={m.id} style={{ position: "absolute", left: `${Math.min(100, (m.spendCents / top) * 100)}%`, transform: "translateX(-50%)", textAlign: "center" }}>
              <div style={{ width: 2, height: 6, background: m.reached ? "var(--gold)" : "var(--dim)", margin: "0 auto" }} />
              <div className="faint" style={{ fontSize: 9, color: m.reached ? "var(--gold)" : "var(--dim)" }}>{fmtUSD(m.spendCents)}</div>
            </div>
          ))}
        </div>
        {loyalty.inactivityReset && (
          <div style={{ fontSize: 11, marginTop: 10, color: "var(--hot)" }}>
            {t("shop.inactivityReset", { days: Math.round(loyalty.inactivityMs / 86400000) })}
          </div>
        )}
      </div>

      <div className="tag" style={{ marginBottom: 10 }}><span>{t("shop.milestones")}</span></div>
      <Grid>
        {ms.map((m) => {
          const cid = (m.cosmetics || [])[0];
          const cosmetic = cid ? cosmeticsById[cid] : null;
          const rc = rarityColor(cosmetic?.rarity || "Legendary");
          const locked = !m.reached && !m.claimed;
          return (
            <div key={m.id} className="panel" style={{ padding: 14, position: "relative", opacity: locked ? 0.7 : 1 }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: m.claimed ? "var(--gold)" : rc }} />
              <div style={{ height: 84, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rc}22 0%, transparent 70%)`, border: "1px solid var(--line)" }}>
                <ItemIcon id={cosmetic?.id} slot={cosmetic?.slot} color={rc} glyphSize={32} dim={locked} />
              </div>
              <div className="impactf" style={{ fontSize: 13, marginTop: 10 }}>{m.label}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gold)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t("shop.amountSpent", { amount: fmtUSD(m.spendCents) })}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 6, minHeight: 32 }}>
                {cosmetic?.name || t("shop.exclusiveCosmetic")}
                <br /><span style={{ color: "var(--gold)" }}>{t("shop.goldTrailBonus", { duration: fmtDur(m.premiumMs, t) })}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                {m.claimed ? (
                  <div className="impactf" style={{ fontSize: 12, color: "var(--gold)", textAlign: "center", padding: "10px 0", textTransform: "uppercase" }}>{t("shop.claimedCheck")}</div>
                ) : m.claimable ? (
                  <button className="btn btn-hot" style={{ width: "100%", fontSize: 14 }} disabled={busy === m.id} onClick={() => onClaim(m)}>
                    {busy === m.id ? "…" : t("shop.claim")}
                  </button>
                ) : (
                  <div className="faint" style={{ fontSize: 11, textAlign: "center", padding: "10px 0", textTransform: "uppercase" }}>{t("shop.amountMore", { amount: fmtUSD(m.spendCents - spent) })}</div>
                )}
              </div>
            </div>
          );
        })}
      </Grid>
    </>
  );
}

// Cents -> "$5" / "$12.50" (drops the decimals for whole-dollar amounts).
function fmtUSD(cents) {
  const d = Math.max(0, cents || 0) / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}
// Milliseconds -> "30 Days" / "1 Hour".
function fmtDur(ms, t) {
  const days = Math.round((ms || 0) / 86400000);
  if (days >= 1) return t(days === 1 ? "shop.durationDay" : "shop.durationDays", { n: days });
  const hrs = Math.max(1, Math.round((ms || 0) / 3600000));
  return t(hrs === 1 ? "shop.durationHour" : "shop.durationHours", { n: hrs });
}

function glyphFor() { return "★"; }
function rarityColor(r) { return { Common: "var(--r-common)", Rare: "var(--r-rare)", Epic: "var(--r-epic)", Legendary: "var(--r-legendary)", Mythic: "var(--r-mythic)" }[r] || "var(--r-common)"; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 70% 0%, #221726 0%, var(--ink) 55%)" };
const shopPreviewCol = { width: 240, flexShrink: 0, borderRight: "2px solid var(--line)", background: "var(--ink-2)", padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto" };
const tabBtn = { padding: "10px 16px", background: "transparent", color: "var(--dim)", borderBottom: "3px solid transparent" };
const tabOn = { color: "var(--paper)", borderBottomColor: "var(--hot)" };
const toastStyle = { position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "var(--hot)", color: "var(--ink)", padding: "12px 22px", fontWeight: 700, clipPath: "polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)" };
const revealWrap = { position: "fixed", inset: 0, zIndex: 9998, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.92)", cursor: "pointer" };
