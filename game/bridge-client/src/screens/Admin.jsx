import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import KartPreview from "../components/KartPreview.jsx";
import { fmtDateTime, toCentralInput, centralInputToISO } from "../lib/time.js";

// Admin Panel. Only mounted for accounts with an adminRole. Talks to the
// role-gated /admintool API. Three tabs: Users (economy + moderation), Store
// (live price/currency edits + create/delete) and Admins (superadmin-only role
// management). All actions are tied to the signed-in admin server-side.
export default function Admin({ user }) {
  const [tab, setTab] = useState("users");
  const isSuper = user?.adminRole === "superadmin";
  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 20 }}>
        <span className="kanji" style={{ fontSize: 20, color: "var(--hot)" }}>ADMIN</span>
        <h1 className="display" style={{ fontSize: 40, margin: 0, color: "var(--paper)" }}>ADMIN</h1>
        <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.15em", color: isSuper ? "var(--gold)" : "var(--dim)", border: `1px solid ${isSuper ? "var(--gold)" : "var(--line)"}`, padding: "3px 8px" }}>
          {user?.adminRole?.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, rowGap: 2, marginBottom: 22, borderBottom: "2px solid var(--line)" }}>
        {[["users", "Users"], ["segments", "Segments"], ["reports", "Reports"], ["reversals", "Reversals"], ...(isSuper ? [["activity", "Activity"]] : []), ["store", "Store"], ["news", "News"], ["i18n", "Localization"], ...(isSuper ? [["admins", "Admins"], ["dev", "Dev"]] : [])].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="impactf"
            style={{ padding: "10px 18px", fontSize: 13, letterSpacing: "0.1em", background: "transparent",
              color: tab === id ? "var(--hot)" : "var(--dim)", borderBottom: tab === id ? "3px solid var(--hot)" : "3px solid transparent", marginBottom: -2 }}>
            {label.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "segments" && <SegmentsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "reversals" && <ReversalsTab />}
      {tab === "activity" && isSuper && <ActivityTab />}
      {tab === "store" && <StoreTab />}
      {tab === "news" && <NewsTab />}
      {tab === "i18n" && <LocalizationTab />}
      {tab === "admins" && isSuper && <AdminsTab meId={user.id} />}
      {tab === "dev" && isSuper && <DevTab meId={user.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- Users tab
function UsersTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState(null);
  const [cat, setCat] = useState(null);

  useEffect(() => { api.adminCatalogue().then(setCat).catch(() => {}); }, []);

  const search = useCallback(async () => {
    setMsg(null);
    try { const { results } = await api.adminSearchUsers(q); setResults(results); }
    catch (e) { setMsg(e.message); }
  }, [q]);
  useEffect(() => { search(); }, []); // initial list

  const openUser = async (id) => {
    setMsg(null);
    try { const { user } = await api.adminGetUser(id); setSel(user); }
    catch (e) { setMsg(e.message); }
  };
  const refreshSel = () => sel && openUser(sel.id);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
      <div className="panel" style={panel}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input style={input} placeholder="Search call sign / email / id" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn btn-hot" style={{ padding: "0 14px" }} onClick={search}>Go</button>
        </div>
        <div className="col gap-s" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {results.map((u) => (
            <button key={u.id} onClick={() => openUser(u.id)} style={{ ...rowBtn, ...(sel?.id === u.id ? { borderColor: "var(--hot)" } : null) }}>
              <span style={{ fontWeight: 700 }}>{u.name}</span>
              <span className="faint" style={{ fontSize: 11 }}>#{u.id}{u.adminRole ? ` · ${u.adminRole}` : ""}{u.moderation?.banned ? " · BANNED" : ""}</span>
            </button>
          ))}
          {results.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No accounts.</div>}
        </div>
      </div>

      <div>
        {msg && <div style={banner}>{msg}</div>}
        {!sel ? <div className="panel" style={{ ...panel, color: "var(--dim)" }}>Select an account to manage.</div>
          : <UserDetail u={sel} cat={cat} onChanged={refreshSel} onMsg={setMsg} />}
      </div>
    </div>
  );
}

function UserDetail({ u, cat, onChanged, onMsg }) {
  const [cosmeticId, setCosmeticId] = useState("");
  const [source, setSource] = useState("");
  const [currency, setCurrency] = useState("CREDITS");
  const [amount, setAmount] = useState(100);
  const [setVal, setSetVal] = useState(0);
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState(0);

  // Reset the chosen source whenever the picked cosmetic changes.
  useEffect(() => { setSource(""); }, [cosmeticId]);

  const run = async (fn, ok) => { try { await fn(); onMsg(ok); onChanged(); } catch (e) { onMsg(e.message); } };

  const owns = (u.owned || []).includes(cosmeticId);
  const pickedSources = (u.cosmeticSources?.[cosmeticId]) || [];

  // Audit trail: recent admin cosmetic grants/removes/reversals for this account.
  const [audit, setAudit] = useState([]);
  useEffect(() => {
    let alive = true;
    api.adminUserAudit(u.id).then(({ actions }) => { if (alive) setAudit(actions || []); }).catch(() => {});
    return () => { alive = false; };
  }, [u.id, u.owned]);

  // Export the account's *full* admin-action history (the panel shows only the
  // latest page) by paging through the backend, which caps at 200/page.
  const [auditExporting, setAuditExporting] = useState(false);
  const exportAudit = async () => {
    setAuditExporting(true);
    try {
      const all = [];
      let offset = 0;
      for (;;) {
        const res = await api.adminUserAudit(u.id, { limit: 200, offset });
        const batch = res.actions || [];
        all.push(...batch);
        offset += batch.length;
        if (!res.hasMore || batch.length === 0) break;
      }
      downloadCsv(buildAuditCsv(all, cat), `admin-audit-${u.id}-${csvStamp()}.csv`);
    } catch (e) { onMsg(e.message); }
    finally { setAuditExporting(false); }
  };

  return (
    <div className="col gap-m">
      <div className="panel" style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 22 }}>{u.name} <span className="faint" style={{ fontSize: 13 }}>#{u.id}</span></h3>
          <div className="faint" style={{ fontSize: 12 }}>{u.email || "no email"} {u.adminRole ? `· ${u.adminRole}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
          {Object.entries(u.balances || {}).map(([k, v]) => (
            <div key={k}><span className="faint" style={{ fontSize: 11 }}>{k}</span> <b style={{ color: "var(--gold)" }}>{v}</b></div>
          ))}
          {u.moderation?.banned && <span style={{ color: "var(--hot)", fontWeight: 700 }}>BANNED</span>}
          {u.moderation?.silenced && <span style={{ color: "var(--hot)", fontWeight: 700 }}>SILENCED</span>}
        </div>
      </div>

      <div className="panel" style={panel}>
        <Label>Economy</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(cat?.currencies || ["CREDITS", "PREMIUM"]).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input style={{ ...input, width: 110 }} type="number" value={amount} onChange={(e) => setAmount(+e.target.value)} />
          <button className="btn" style={btn} onClick={() => run(() => api.adminGrant(u.id, { currency, amount }), "Added.")}>+ Add</button>
          <button className="btn" style={btn} onClick={() => run(() => api.adminRemove(u.id, { currency, amount }), "Removed.")}>– Remove</button>
          <span className="faint" style={{ marginLeft: 8 }}>Set exact:</span>
          <input style={{ ...input, width: 110 }} type="number" value={setVal} onChange={(e) => setSetVal(+e.target.value)} />
          <button className="btn" style={btn} onClick={() => run(() => api.adminSetBalance(u.id, currency, setVal), "Balance set.")}>Set</button>
        </div>
      </div>

      <div className="panel" style={panel}>
        <Label>Cosmetics</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...input, minWidth: 240 }} value={cosmeticId} onChange={(e) => setCosmeticId(e.target.value)}>
            <option value="">— pick a cosmetic —</option>
            {(cat?.cosmetics || []).map((c) => <option key={c.id} value={c.id}>{c.item || c.name || c.id} ({c.rarity || c.slot})</option>)}
          </select>
          <button className="btn" style={btn} disabled={!cosmeticId} onClick={() => run(() => api.adminGrant(u.id, { cosmeticId }), "Granted.")}>Grant</button>
          <select style={{ ...input, minWidth: 200 }} value={source} disabled={!owns || pickedSources.length === 0} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources (hard wipe)</option>
            {pickedSources.map((s, i) => <option key={`${s}:${i}`} value={s}>{s}</option>)}
          </select>
          <button className="btn" style={btn} disabled={!cosmeticId}
            onClick={() => run(() => api.adminRemove(u.id, source ? { cosmeticId, source } : { cosmeticId }), source ? `Reversed "${source}" grant.` : "Removed.")}>
            {source ? "Reverse grant" : "Remove"}
          </button>
        </div>
        {owns && (
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {pickedSources.length > 0
              ? <>Sources: {pickedSources.join(", ")}. Pick one to reverse just that grant (the item stays if another source still holds it); leave on “All sources” to hard-wipe the cosmetic and every source.</>
              : <>No recorded sources for this cosmetic — Remove will hard-wipe it.</>}
          </div>
        )}
        <OwnedCosmetics owned={u.owned} sources={u.cosmeticSources} cat={cat} />
      </div>

      <div className="panel" style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label>Admin action log</Label>
          <button className="btn" style={btn} disabled={auditExporting || audit.length === 0} onClick={exportAudit}>
            {auditExporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
        <AdminActionLog actions={audit} cat={cat} />
      </div>

      <div className="panel" style={panel}>
        <Label>Moderation</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, flex: 1, minWidth: 160 }} placeholder="Ban reason (optional)" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
          <input style={{ ...input, width: 130 }} type="number" placeholder="hours (0=perm)" value={banHours} onChange={(e) => setBanHours(+e.target.value)} />
          <button className="btn btn-hot" style={btn} onClick={() => run(() => api.adminBan(u.id, { banned: true, durationMs: banHours > 0 ? banHours * 3600e3 : null, reason: banReason || null }), "Banned.")}>Ban</button>
          <button className="btn" style={btn} onClick={() => run(() => api.adminUnban(u.id), "Unbanned.")}>Unban</button>
          <button className="btn" style={btn} onClick={() => run(() => api.adminSilence(u.id, !u.moderation?.silenced), u.moderation?.silenced ? "Unsilenced." : "Silenced.")}>{u.moderation?.silenced ? "Unsilence" : "Silence"}</button>
        </div>
      </div>
    </div>
  );
}

// Human-readable label for a recorded acquisition source tag. Tags are stored as
// "<kind>:<ref>" (e.g. "stripe:cs_123", "admin:42", "box:vanguard_cache") or bare
// kinds ("legacy", "gift", "level"); show a friendly kind plus the raw ref.
function sourceLabel(src) {
  if (typeof src !== "string" || !src) return { label: "unknown", ref: "" };
  const idx = src.indexOf(":");
  const kind = idx === -1 ? src : src.slice(0, idx);
  const ref = idx === -1 ? "" : src.slice(idx + 1);
  const KINDS = {
    stripe: "Purchase", admin: "Admin grant", box: "Loot box",
    gift: "Gift", level: "Level unlock", code: "Code", legacy: "Legacy",
  };
  return { label: KINDS[kind] || kind, ref };
}

// Read-only list of every owned cosmetic and the recorded sources that granted it.
function OwnedCosmetics({ owned, sources, cat }) {
  const list = Array.isArray(owned) ? owned : [];
  if (list.length === 0) return <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>No cosmetics owned.</div>;
  const nameOf = (id) => {
    const c = (cat?.cosmetics || []).find((x) => x.id === id);
    return c ? (c.item || c.name || c.id) : id;
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="faint impactf" style={{ fontSize: 11, marginBottom: 6 }}>OWNED · ACQUISITION SOURCES</div>
      <div className="col" style={{ gap: 6 }}>
        {list.map((id) => {
          const srcs = Array.isArray(sources?.[id]) ? sources[id] : [];
          return (
            <div key={id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
              <span style={{ fontWeight: 600, minWidth: 160 }}>{nameOf(id)} <span className="faint" style={{ fontSize: 11 }}>{id}</span></span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {srcs.length === 0 && <span className="faint" style={{ fontSize: 11 }}>no recorded source</span>}
                {srcs.map((s, i) => {
                  const { label, ref } = sourceLabel(s);
                  return (
                    <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--ink-2, rgba(255,255,255,0.06))", border: "1px solid var(--line)" }}>
                      {label}{ref ? <span className="faint"> · {ref}</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Read-only list of recent admin actions on this account: cosmetic edits (grant /
// remove / reverse), currency adjustments (grant / remove / set balance), and
// moderation (ban / unban / silence). Who did what to whom, clearly labeled.
function AdminActionLog({ actions, cat }) {
  const [filter, setFilter] = useState("all");
  const [adminFilter, setAdminFilter] = useState("all");
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) return <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>No admin actions recorded for this account.</div>;
  const nameOf = (id) => {
    if (!id) return "—";
    const c = (cat?.cosmetics || []).find((x) => x.id === id);
    return c ? (c.item || c.name || c.id) : id;
  };
  const VERB = {
    grant: "Granted", remove: "Removed", reverse: "Reversed source",
    "currency-grant": "Credited", "currency-remove": "Debited", "currency-set": "Set balance",
    ban: "Banned", unban: "Unbanned", silence: "Silenced", unsilence: "Unsilenced",
    "admin-role": "Set admin role",
    "event-flag": "Flagged", "event-unflag": "Unflagged",
  };
  const GOLD = new Set(["grant", "currency-grant", "unban", "unsilence", "event-flag"]);
  const colorOf = (action) => GOLD.has(action) ? "var(--gold)" : (["currency-set", "admin-role"].includes(action) ? "var(--dim)" : "var(--hot)");
  const roleLabel = (r) => r || "none";
  const isCurrency = (a) => a.action.startsWith("currency-");
  const isRole = (a) => a.action === "admin-role";
  const isModeration = (a) => ["ban", "unban", "silence", "unsilence"].includes(a.action);
  const isEvent = (a) => a.action.startsWith("event-");
  const fmtDuration = (ms) => {
    if (!ms) return "permanent";
    const h = ms / 3600e3;
    return h >= 24 ? `${+(h / 24).toFixed(1)}d` : `${+h.toFixed(1)}h`;
  };
  const catOf = (a) => isCurrency(a) ? "currency" : isModeration(a) ? "moderation" : isRole(a) ? "role" : isEvent(a) ? "events" : "cosmetics";
  const FILTERS = [
    { key: "all", label: "All" },
    { key: "cosmetics", label: "Cosmetics" },
    { key: "currency", label: "Currency" },
    { key: "moderation", label: "Moderation" },
    { key: "role", label: "Admin role" },
    { key: "events", label: "Events" },
  ];
  const counts = list.reduce((m, a) => { const c = catOf(a); m[c] = (m[c] || 0) + 1; return m; }, {});
  const admins = [...new Set(list.map((a) => a.adminId).filter((x) => x != null))].sort((x, y) => x - y);
  const shown = list.filter((a) =>
    (filter === "all" || catOf(a) === filter) &&
    (adminFilter === "all" || String(a.adminId) === adminFilter)
  );
  return (
    <div className="col" style={{ gap: 6, marginTop: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "all" ? list.length : (counts[f.key] || 0);
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="impactf"
              style={{
                fontSize: 11,
                padding: "3px 9px",
                borderRadius: 4,
                cursor: "pointer",
                border: "1px solid var(--line)",
                background: active ? "var(--gold)" : "transparent",
                color: active ? "#000" : "var(--dim)",
              }}
            >
              {f.label} ({n})
            </button>
          );
        })}
        {admins.length > 1 && (
          <select
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
            className="impactf"
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 4,
              cursor: "pointer",
              border: "1px solid var(--line)",
              background: adminFilter !== "all" ? "var(--gold)" : "transparent",
              color: adminFilter !== "all" ? "#000" : "var(--dim)",
              marginLeft: "auto",
            }}
          >
            <option value="all">All admins ({list.length})</option>
            {admins.map((id) => (
              <option key={id} value={String(id)}>
                admin #{id} ({list.filter((a) => a.adminId === id).length})
              </option>
            ))}
          </select>
        )}
      </div>
      {shown.length === 0 && <div className="faint" style={{ fontSize: 12 }}>No matching actions recorded for this account.</div>}
      {shown.map((a) => (
        <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
          <span className="impactf" style={{ fontSize: 11, color: colorOf(a.action), minWidth: 120 }}>
            {VERB[a.action] || a.action}
          </span>
          {isCurrency(a) ? (
            <span style={{ fontWeight: 600 }}>
              {a.action === "currency-set"
                ? <>{a.currency} <span className="faint" style={{ fontSize: 11 }}>{a.before} → {a.after}</span></>
                : <>{a.amount?.toLocaleString?.() ?? a.amount} {a.currency} <span className="faint" style={{ fontSize: 11 }}>({a.before} → {a.after})</span></>}
            </span>
          ) : isModeration(a) ? (
            <span style={{ fontWeight: 600 }}>
              Account
              {a.action === "ban" && a.detail && <span className="faint" style={{ fontSize: 11 }}> · {fmtDuration(a.detail.durationMs)}</span>}
              {a.reason && <span className="faint" style={{ fontSize: 11 }}> · “{a.reason}”</span>}
            </span>
          ) : isRole(a) ? (
            <span style={{ fontWeight: 600 }}>
              Admin role <span className="faint" style={{ fontSize: 11 }}>({roleLabel(a.before)} → {roleLabel(a.after)})</span>
            </span>
          ) : isEvent(a) ? (
            <span style={{ fontWeight: 600 }}>
              {a.detail?.flag || "flag"}
              {a.entityId && <span className="faint" style={{ fontSize: 11 }}> · event {a.entityId}</span>}
            </span>
          ) : (
            <>
              <span style={{ fontWeight: 600 }}>{nameOf(a.cosmeticId)} <span className="faint" style={{ fontSize: 11 }}>{a.cosmeticId}</span></span>
              {a.source && <span className="faint" style={{ fontSize: 11 }}>source: {a.source}</span>}
              {a.detail && a.action !== "grant" && (
                <span className="faint" style={{ fontSize: 11 }}>
                  {a.detail.removed ? "item taken back" : `kept (${a.detail.remainingSources ?? 0} source${a.detail.remainingSources === 1 ? "" : "s"} left)`}
                </span>
              )}
            </>
          )}
          <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>
            by admin #{a.adminId ?? "?"} · {a.at ? fmtDateTime(a.at) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Segments tab
// Find accounts by the settings / cosmetics / activity they use, plus rankings
// of the most- and least-used avatars, borders, cosmetics, and toggles.
const SEGMENT_PAGE = 50;
function SegmentsTab() {
  const [stats, setStats] = useState(null);     // usage analytics + filter catalogues
  const [filters, setFilters] = useState({
    colorblind: "", streamer: "", musicOp: "", musicValue: "",
    avatar: "", border: "", cosmetic: "", cosmeticMode: "owned",
    ppdOp: "", ppdValue: "",
  });
  const [results, setResults] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      try { setStats(await api.adminUsageStats()); }
      catch (e) { setMsg(e.message); }
    })();
  }, []);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  // Only forward criteria the admin actually set, plus a sane number op default.
  const queryFor = (extra = {}) => {
    const q = { ...extra };
    if (filters.colorblind) q.colorblind = filters.colorblind;
    if (filters.streamer) q.streamer = filters.streamer;
    if (filters.musicOp && filters.musicValue !== "") { q.musicOp = filters.musicOp; q.musicValue = filters.musicValue; }
    if (filters.avatar) q.avatar = filters.avatar;
    if (filters.border) q.border = filters.border;
    if (filters.cosmetic) { q.cosmetic = filters.cosmetic; q.cosmeticMode = filters.cosmeticMode; }
    if (filters.ppdOp && filters.ppdValue !== "") { q.ppdOp = filters.ppdOp; q.ppdValue = filters.ppdValue; }
    return q;
  };

  const search = async () => {
    setLoading(true); setMsg(null);
    try {
      const res = await api.adminSegmentUsers(queryFor({ limit: SEGMENT_PAGE, offset: 0 }));
      setResults(res.results); setTotal(res.total || 0); setHasMore(!!res.hasMore);
    } catch (e) { setMsg(e.message); }
    finally { setLoading(false); }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.adminSegmentUsers(queryFor({ limit: SEGMENT_PAGE, offset: results.length }));
      setResults((prev) => [...prev, ...res.results]); setTotal(res.total || 0); setHasMore(!!res.hasMore);
    } catch (e) { setMsg(e.message); }
    finally { setLoadingMore(false); }
  };

  const reset = () => {
    setFilters({ colorblind: "", streamer: "", musicOp: "", musicValue: "", avatar: "", border: "", cosmetic: "", cosmeticMode: "owned", ppdOp: "", ppdValue: "" });
    setResults(null); setTotal(0); setHasMore(false);
  };

  const numOp = (key) => (
    <select style={sel} value={filters[key]} onChange={(e) => set(key, e.target.value)}>
      <option value="">Any</option>
      <option value="gte">≥</option>
      <option value="lte">≤</option>
      <option value="eq">=</option>
    </select>
  );

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}

      {/* ---- filter builder ---- */}
      <div className="panel" style={{ ...panel, marginBottom: 18 }}>
        <Label>Find accounts using…</Label>
        <div style={segGrid}>
          <Field label="Colorblind shapes">
            <select style={sel} value={filters.colorblind} onChange={(e) => set("colorblind", e.target.value)}>
              <option value="">Any</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </Field>
          <Field label="Streamer mode">
            <select style={sel} value={filters.streamer} onChange={(e) => set("streamer", e.target.value)}>
              <option value="">Any</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </Field>
          <Field label="Music volume %">
            <div style={{ display: "flex", gap: 6 }}>
              {numOp("musicOp")}
              <input style={{ ...input, width: 70, flex: "none" }} type="number" min={0} max={100} placeholder="0-100"
                value={filters.musicValue} onChange={(e) => set("musicValue", e.target.value)} />
            </div>
          </Field>
          <Field label="Avatar">
            <select style={sel} value={filters.avatar} onChange={(e) => set("avatar", e.target.value)}>
              <option value="">Any</option>
              {(stats?.avatars || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Border">
            <select style={sel} value={filters.border} onChange={(e) => set("border", e.target.value)}>
              <option value="">Any</option>
              {(stats?.borders || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Cosmetic / item">
            <div style={{ display: "flex", gap: 6 }}>
              <select style={sel} value={filters.cosmetic} onChange={(e) => set("cosmetic", e.target.value)}>
                <option value="">Any</option>
                {(stats?.cosmetics || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select style={{ ...sel, flex: "none", width: 110 }} value={filters.cosmeticMode} onChange={(e) => set("cosmeticMode", e.target.value)}>
                <option value="owned">Owned</option><option value="equipped">Equipped</option>
              </select>
            </div>
          </Field>
          <Field label="Plays per day">
            <div style={{ display: "flex", gap: 6 }}>
              {numOp("ppdOp")}
              <input style={{ ...input, width: 70, flex: "none" }} type="number" min={0} step="0.1" placeholder="e.g. 2"
                value={filters.ppdValue} onChange={(e) => set("ppdValue", e.target.value)} />
            </div>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-hot" style={btn} disabled={loading} onClick={search}>{loading ? "Searching…" : "Search accounts"}</button>
          <button className="btn" style={btn} onClick={reset}>Reset</button>
        </div>
      </div>

      {/* ---- results ---- */}
      {results !== null && (
        <div style={{ marginBottom: 24 }}>
          <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
            {total} matching account{total === 1 ? "" : "s"}{results.length < total ? ` · showing ${results.length}` : ""}
          </div>
          <div className="col gap-m">
            {results.map((u) => (
              <div key={u.id} className="panel" style={panel}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 17 }}>{u.name} <span className="faint" style={{ fontSize: 12 }}>#{u.id}</span></h3>
                  <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--gold)" }}>{u.playsPerDay}/day</span>
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{u.email || "no email"} · {u.matchesPlayed} matches · lvl {u.level}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  <Chip>{u.avatarName} avatar</Chip>
                  <Chip>{u.borderName} border</Chip>
                  <Chip>Music {u.music}%</Chip>
                  {u.colorblind && <Chip>Colorblind</Chip>}
                  {u.streamerMode && <Chip>Streamer</Chip>}
                </div>
              </div>
            ))}
            {results.length === 0 && <div className="panel" style={{ ...panel, color: "var(--dim)" }}>No accounts match these filters.</div>}
          </div>
          {hasMore && <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <button className="btn" style={btn} disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : `Load more (${total - results.length} more)`}</button>
          </div>}
        </div>
      )}

      {/* ---- usage rankings ---- */}
      {stats && (
        <div>
          <Label>Usage across {stats.total} account{stats.total === 1 ? "" : "s"}</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <Stat label="Colorblind on" value={`${stats.settings.colorblindOn} / ${stats.total}`} />
            <Stat label="Streamer on" value={`${stats.settings.streamerOn} / ${stats.total}`} />
            <Stat label="Avg music" value={`${stats.settings.musicAvg}%`} />
            <Stat label="Muted music" value={`${stats.settings.musicBuckets.muted}`} />
          </div>
          <div style={segGrid}>
            <RankCard title="Avatars" rows={stats.avatars} valueKey="count" valueLabel="equipped" />
            <RankCard title="Borders" rows={stats.borders} valueKey="count" valueLabel="equipped" />
            <RankCard title="Cosmetics — owned" rows={stats.cosmetics} valueKey="owned" valueLabel="own" />
            <RankCard title="Cosmetics — equipped" rows={[...stats.cosmetics].sort((a, b) => b.equipped - a.equipped)} valueKey="equipped" valueLabel="equip" />
            <RankCard title="Cosmetics — purchased" rows={[...stats.cosmetics].sort((a, b) => b.purchased - a.purchased)} valueKey="purchased" valueLabel="bought" />
          </div>
        </div>
      )}
    </div>
  );
}

// A most/least-used ranking list with a toggle between the top and bottom rows.
function RankCard({ title, rows, valueKey, valueLabel }) {
  const [order, setOrder] = useState("most");
  const sorted = [...(rows || [])].sort((a, b) => order === "most" ? b[valueKey] - a[valueKey] : a[valueKey] - b[valueKey]);
  const top = sorted.slice(0, 6);
  return (
    <div className="panel" style={{ ...panel, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="impactf" style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--paper)" }}>{title}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {[["most", "Most"], ["least", "Least"]].map(([id, label]) => (
            <button key={id} className="btn" style={{ ...btn, padding: "3px 8px", fontSize: 11, opacity: order === id ? 1 : 0.5, borderColor: order === id ? "var(--hot)" : "var(--line)" }}
              onClick={() => setOrder(id)}>{label}</button>
          ))}
        </div>
      </div>
      {top.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <span style={{ color: "var(--paper)" }}>{r.name}</span>
          <span className="faint" style={{ fontSize: 12 }}>{r[valueKey]} {valueLabel}</span>
        </div>
      ))}
      {top.length === 0 && <div className="faint" style={{ fontSize: 12 }}>No data yet.</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 5 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}
function Chip({ children }) {
  return <span style={{ fontSize: 12, padding: "3px 8px", background: "var(--ink)", border: "1px solid var(--line)", color: "var(--paper)" }}>{children}</span>;
}
function Stat({ label, value }) {
  return (
    <div style={{ padding: "8px 12px", background: "var(--ink-2)", border: "1px solid var(--line)", minWidth: 110 }}>
      <div className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--dim)" }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, color: "var(--gold)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Store tab
function StoreTab() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setMsg(null);
    try { setData(await api.adminListStore()); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = Array.isArray(data) ? data : (data?.items || data?.storeItems || []);

  const save = async (id, patch) => { try { await api.adminUpdateStoreEntry(id, patch); setMsg("Saved."); load(); } catch (e) { setMsg(e.message); } };
  const del = async (id) => { if (!confirm("Delete this store entry?")) return; try { await api.adminDeleteStoreEntry(id); setMsg("Deleted."); load(); } catch (e) { setMsg(e.message); } };

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div className="panel" style={panel}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 120px 110px 90px", gap: 10, padding: "6px 4px", borderBottom: "1px solid var(--line)" }} className="faint impactf">
          <span>ITEM</span><span>PRICE</span><span>CURRENCY</span><span>WORTH</span><span></span>
        </div>
        {items.map((it) => <StoreRow key={it.id} it={it} onSave={save} onDelete={del} />)}
        {items.length === 0 && <div className="faint" style={{ padding: 12 }}>No store entries.</div>}
      </div>
    </div>
  );
}

function StoreRow({ it, onSave, onDelete }) {
  const [price, setPrice] = useState(it.priceCents ?? it.price ?? 0);
  const [currency, setCurrency] = useState(it.currency || "CREDITS");
  const [worth, setWorth] = useState(it.worth ?? 0);
  const dirty = price !== (it.priceCents ?? it.price ?? 0) || currency !== (it.currency || "CREDITS") || worth !== (it.worth ?? 0);
  const priceField = it.priceCents != null ? "priceCents" : "price";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 120px 110px 90px", gap: 10, padding: "8px 4px", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 600 }}>{it.label || it.item || it.name || it.id} <span className="faint" style={{ fontSize: 11 }}>{it.id}</span></span>
      <input style={input} type="number" value={price} onChange={(e) => setPrice(+e.target.value)} />
      <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
        <option value="CREDITS">CREDITS</option><option value="PREMIUM">PREMIUM</option>
      </select>
      <input style={input} type="number" value={worth} onChange={(e) => setWorth(+e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-hot" style={{ ...btn, padding: "6px 8px", opacity: dirty ? 1 : 0.4 }} disabled={!dirty}
          onClick={() => onSave(it.id, { [priceField]: price, currency, worth })}>Save</button>
        <button className="btn" style={{ ...btn, padding: "6px 8px" }} onClick={() => onDelete(it.id)}>✕</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Admins tab
function AdminsTab({ meId }) {
  const [admins, setAdmins] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try { const { admins } = await api.adminListAdmins(); setAdmins(admins); } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const search = async () => { try { const { results } = await api.adminSearchUsers(q); setResults(results); } catch (e) { setMsg(e.message); } };
  const setRole = async (id, role) => { try { await api.adminSetRole(id, role); setMsg("Role updated."); load(); search(); } catch (e) { setMsg(e.message); } };

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div className="panel" style={panel}>
        <Label>Current admins</Label>
        {admins.map((a) => (
          <div key={a.id} style={adminRow}>
            <span style={{ fontWeight: 700 }}>{a.name} <span className="faint" style={{ fontSize: 11 }}>#{a.id} · {a.adminRole}</span></span>
            {a.id !== meId && (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" style={btn} onClick={() => setRole(a.id, a.adminRole === "superadmin" ? "admin" : "superadmin")}>{a.adminRole === "superadmin" ? "Demote to admin" : "Make superadmin"}</button>
                <button className="btn btn-hot" style={btn} onClick={() => setRole(a.id, null)}>Revoke</button>
              </div>
            )}
            {a.id === meId && <span className="faint" style={{ fontSize: 11 }}>(you)</span>}
          </div>
        ))}
        {admins.length === 0 && <div className="faint">No admins.</div>}
      </div>

      <div className="panel" style={{ ...panel, marginTop: 16 }}>
        <Label>Grant admin to an account</Label>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input style={input} placeholder="Search call sign / email / id" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn btn-hot" style={{ padding: "0 14px" }} onClick={search}>Search</button>
        </div>
        {results.map((u) => (
          <div key={u.id} style={adminRow}>
            <span>{u.name} <span className="faint" style={{ fontSize: 11 }}>#{u.id}{u.adminRole ? ` · ${u.adminRole}` : ""}</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" style={btn} onClick={() => setRole(u.id, "admin")}>Make admin</button>
              <button className="btn" style={btn} onClick={() => setRole(u.id, "superadmin")}>Make superadmin</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reports tab
function ReportsTab() {
  const [status, setStatus] = useState("open");
  const [tickets, setTickets] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setMsg(null);
    try { const { tickets } = await api.adminListTickets(status === "all" ? null : status); setTickets(tickets); }
    catch (e) { setMsg(e.message); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const resolve = async (id) => { try { await api.adminResolveTicket(id); setMsg("Ticket marked dealt with."); load(); } catch (e) { setMsg(e.message); } };

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <Label>Filter</Label>
        {[["open", "Open"], ["dealt", "Dealt with"], ["all", "All"]].map(([id, label]) => (
          <button key={id} className="btn" style={{ ...btn, opacity: status === id ? 1 : 0.5, borderColor: status === id ? "var(--hot)" : "var(--line)" }}
            onClick={() => setStatus(id)}>{label}</button>
        ))}
        <button className="btn" style={{ ...btn, marginLeft: "auto" }} onClick={load}>Refresh</button>
      </div>
      <div className="col gap-m">
        {tickets.map((t) => (
          <div key={t.id} className="panel" style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                {t.reportedName} <span className="faint" style={{ fontSize: 12 }}>#{t.reportedId}</span>
              </h3>
              <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", padding: "3px 8px", border: `1px solid ${t.status === "open" ? "var(--hot)" : "var(--line)"}`, color: t.status === "open" ? "var(--hot)" : "var(--dim)" }}>
                {t.status === "open" ? "OPEN" : "DEALT WITH"}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              Reported by {t.reporterName} <span style={{ opacity: 0.6 }}>#{t.reporterId}</span> · {fmtDateTime(t.createdAt)}
              {t.matchId ? ` · match ${t.matchId}` : ""}
            </div>
            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--ink)", border: "1px solid var(--line)", fontSize: 14, whiteSpace: "pre-wrap" }}>{t.reason}</div>
            {t.context && <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Context: {t.context}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              {t.notifyEmail
                ? <span className="faint" style={{ fontSize: 11 }}>Reporter opted in to a single review-closed email{t.notified ? " (sent)" : ""}.</span>
                : <span className="faint" style={{ fontSize: 11 }}>No email follow-up requested.</span>}
              {t.status === "open" && <button className="btn btn-hot" style={{ ...btn, marginLeft: "auto" }} onClick={() => resolve(t.id)}>Mark dealt with</button>}
              {t.status !== "open" && t.resolvedAt && <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>Resolved {fmtDateTime(t.resolvedAt)}</span>}
            </div>
          </div>
        ))}
        {tickets.length === 0 && <div className="panel" style={{ ...panel, color: "var(--dim)" }}>No tickets{status !== "all" ? ` with status "${status}"` : ""}.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reversals tab
// Surfaces refund / chargeback clawbacks the Stripe webhook performed: which
// account, which session, the Stripe event that triggered it, what was taken
// back, and when. Admins can re-grant (restore) a session that was wrongly
// reversed — e.g. after a chargeback is won in the merchant's favor.
const REVERSALS_PAGE = 50;

function ReversalsTab() {
  const [reversals, setReversals] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState("reversed");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load the first page for the current filter/search. Replaces the list.
  const load = useCallback(async () => {
    setMsg(null);
    try {
      const res = await api.adminListReversals({ status, query, from, to, limit: REVERSALS_PAGE, offset: 0 });
      setReversals(res.reversals);
      setTotal(res.total || 0);
      setHasMore(!!res.hasMore);
    }
    catch (e) { setMsg(e.message); }
  }, [status, query, from, to]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  // Append the next page, keeping the same status filter + search query + range.
  const loadMore = async () => {
    setLoadingMore(true);
    setMsg(null);
    try {
      const res = await api.adminListReversals({ status, query, from, to, limit: REVERSALS_PAGE, offset: reversals.length });
      setReversals((prev) => [...prev, ...res.reversals]);
      setTotal(res.total || 0);
      setHasMore(!!res.hasMore);
    }
    catch (e) { setMsg(e.message); }
    finally { setLoadingMore(false); }
  };

  const restore = async (r) => {
    if (!confirm(`Re-grant the reversed purchase for ${r.userName || "#" + r.userId}? This re-adds what was clawed back.`)) return;
    setBusy(r.sessionId);
    try { await api.adminRestoreReversal(r.sessionId); setMsg("Items restored."); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(null); }
  };

  const reasonLabel = (reason) =>
    reason === "charge.dispute.created" ? "Chargeback" : reason === "charge.refunded" ? "Refund" : (reason || "Reversal");

  const whatTakenBack = (r) => {
    const parts = [];
    if (r.kind === "items") {
      if (r.itemNames?.length) parts.push(r.itemNames.join(", "));
      else if (r.grantCosmetics?.length) parts.push(r.grantCosmetics.join(", "));
      if (r.grantNameChanges > 0) parts.push(`${r.grantNameChanges} name-change credit${r.grantNameChanges > 1 ? "s" : ""}`);
    } else if (r.prisms) {
      parts.push(`${r.prisms} Shells`);
    }
    return parts.length ? parts.join(" · ") : "—";
  };

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Label>Filter</Label>
        {[["reversed", "Needs action"], ["restored", "Restored"], ["all", "All"]].map(([id, label]) => (
          <button key={id} className="btn" style={{ ...btn, opacity: status === id ? 1 : 0.5, borderColor: status === id ? "var(--hot)" : "var(--line)" }}
            onClick={() => setStatus(id)}>{label}</button>
        ))}
        <button className="btn" style={{ ...btn, marginLeft: "auto" }} onClick={load}>Refresh</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input style={input} placeholder="Search player name / email / id…" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        {query && <button className="btn" style={btn} onClick={() => setQuery("")}>Clear</button>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Label>From</Label>
        <input style={{ ...input, width: 160 }} type="date" value={from} max={to || undefined}
          onChange={(e) => setFrom(e.target.value)} />
        <Label>To</Label>
        <input style={{ ...input, width: 160 }} type="date" value={to} min={from || undefined}
          onChange={(e) => setTo(e.target.value)} />
        {(from || to) && <button className="btn" style={btn} onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>}
      </div>
      {total > 0 && <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
        Showing {reversals.length} of {total}
      </div>}
      <div className="col gap-m">
        {reversals.map((r) => {
          const restored = !!r.restoredAt;
          return (
            <div key={r.sessionId} className="panel" style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>
                  {r.userName || "Unknown"} <span className="faint" style={{ fontSize: 12 }}>#{r.userId}</span>
                </h3>
                <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", padding: "3px 8px",
                  border: `1px solid ${restored ? "var(--line)" : "var(--hot)"}`, color: restored ? "var(--dim)" : "var(--hot)" }}>
                  {restored ? "RESTORED" : reasonLabel(r.reversalReason).toUpperCase()}
                </span>
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                {r.userEmail || "no email"} · {reasonLabel(r.reversalReason)}
                {r.reversedAt ? ` · reversed ${fmtDateTime(r.reversedAt)}` : ""}
                {restored ? ` · restored ${fmtDateTime(r.restoredAt)}${r.restoredBy ? ` by #${r.restoredBy}` : ""}` : ""}
              </div>
              <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--ink)", border: "1px solid var(--line)", fontSize: 14 }}>
                <span className="faint" style={{ fontSize: 11 }}>Taken back: </span>{whatTakenBack(r)}
                <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>session {r.sessionId}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
                {restored
                  ? <span className="faint" style={{ fontSize: 11 }}>Re-granted to the player.</span>
                  : <button className="btn btn-hot" style={{ ...btn, marginLeft: "auto" }} disabled={busy === r.sessionId}
                      onClick={() => restore(r)}>{busy === r.sessionId ? "Restoring…" : "Restore this grant"}</button>}
              </div>
            </div>
          );
        })}
        {reversals.length === 0 && <div className="panel" style={{ ...panel, color: "var(--dim)" }}>
          {(query || from || to) ? `No reversals match the current filters${status !== "all" ? ` (${status})` : ""}.`
            : status === "reversed" ? "No reversals need action."
            : status === "restored" ? "No restored reversals on record."
            : "No reversals on record."}
        </div>}
      </div>
      {hasMore && <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <button className="btn" style={btn} disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : `Load more (${total - reversals.length} more)`}
        </button>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- Activity tab
// Superadmin-only global feed of EVERY admin action across all accounts, newest
// first — built to spot a rogue or mistaken admin without first knowing which
// account to open. Filterable by acting admin and/or target account.
const ACTIVITY_PAGE = 50;
const ACT_VERB = {
  grant: "Granted", remove: "Removed", reverse: "Reversed source",
  "store-create": "Created store entry", "store-update": "Edited store entry", "store-delete": "Deleted store entry",
  "admin-role": "Set admin role",
  "event-create": "Created event", "event-update": "Edited event", "event-delete": "Deleted event",
  "event-flag": "Flagged account", "event-unflag": "Unflagged account",
};
const ACT_COLOR = {
  grant: "var(--gold)", remove: "var(--hot)", reverse: "var(--hot)",
  "store-create": "var(--gold)", "store-update": "var(--dim)", "store-delete": "var(--hot)",
  "admin-role": "var(--dim)",
  "event-create": "var(--gold)", "event-update": "var(--dim)", "event-delete": "var(--hot)",
  "event-flag": "var(--gold)", "event-unflag": "var(--hot)",
};
const roleLabel = (r) => r || "none";
const isRoleAction = (action) => action === "admin-role";
const isStoreAction = (action) => typeof action === "string" && action.startsWith("store-");
// Event create/update/delete are non-user-scoped (like store edits); flag/unflag
// target a specific account and are rendered with that account instead.
const isEventEditAction = (action) => ["event-create", "event-update", "event-delete"].includes(action);
const isEventFlagAction = (action) => ["event-flag", "event-unflag"].includes(action);
// Compact one-line summary of a store/event edit's before/after field diff. Works
// for any `*-create`/`*-update`/`*-delete` action carrying { before, after }.
function StoreDiff({ action, detail }) {
  if (!detail) return null;
  const { before, after } = detail;
  if (action.endsWith("-update") && after) {
    const keys = Object.keys(after);
    if (keys.length === 0) return null;
    return (
      <span className="faint" style={{ fontSize: 11 }}>
        {keys.map((k, i) => (
          <span key={k}>{i > 0 ? " · " : ""}{k}: {String(before?.[k] ?? "—")} → {String(after[k])}</span>
        ))}
      </span>
    );
  }
  const fields = action.endsWith("-delete") ? before : after;
  if (!fields) return null;
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  return (
    <span className="faint" style={{ fontSize: 11 }}>
      {keys.map((k, i) => <span key={k}>{i > 0 ? " · " : ""}{k}: {String(fields[k])}</span>)}
    </span>
  );
}

// Shared CSV helpers so the global Activity feed and the per-account audit trail
// export an identical column set.
const csvEsc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cosmeticNameFor = (cat, id) => {
  if (!id) return null;
  const c = (cat?.cosmetics || []).find((x) => x.id === id);
  return c ? (c.item || c.name || c.id) : id;
};
const auditOutcomeText = (a) => {
  if (isRoleAction(a.action)) return `${roleLabel(a.before)} → ${roleLabel(a.after)}`;
  if (a.action === "grant" || !a.detail) return "";
  if (a.detail.removed) return "item taken back";
  const n = a.detail.remainingSources ?? 0;
  return `kept (${n} source${n === 1 ? "" : "s"} left)`;
};
// Plain-text mirror of <StoreDiff> / the flag label for CSV export: a readable
// before/after field diff for event/store edits, or the flag name for flag/unflag.
const auditDetailText = (a) => {
  if (isEventFlagAction(a.action)) return a.detail?.flag || "flag";
  if (!isStoreAction(a.action) && !isEventEditAction(a.action)) return "";
  const detail = a.detail;
  if (!detail) return "";
  const { before, after } = detail;
  if (a.action.endsWith("-update") && after) {
    const keys = Object.keys(after);
    return keys.map((k) => `${k}: ${String(before?.[k] ?? "—")} → ${String(after[k])}`).join(" · ");
  }
  const fields = a.action.endsWith("-delete") ? before : after;
  if (!fields) return "";
  return Object.keys(fields).map((k) => `${k}: ${String(fields[k])}`).join(" · ");
};
const AUDIT_CSV_HEADERS = ["timestamp", "acting_admin", "acting_admin_id", "target", "target_id", "target_email", "action", "cosmetic", "cosmetic_id", "source", "outcome", "entity_id", "detail"];
const buildAuditCsv = (actions, cat) => {
  const rows = (actions || []).map((a) => [
    a.at ? new Date(a.at).toISOString() : "",
    a.adminName || "",
    a.adminId ?? "",
    a.targetName || "",
    a.targetUserId ?? "",
    a.targetEmail || "",
    ACT_VERB[a.action] || a.action || "",
    a.cosmeticId ? cosmeticNameFor(cat, a.cosmeticId) : "",
    a.cosmeticId || "",
    a.source || "",
    auditOutcomeText(a),
    a.entityId ?? "",
    auditDetailText(a),
  ].map(csvEsc).join(","));
  return [AUDIT_CSV_HEADERS.join(","), ...rows].join("\n");
};
const downloadCsv = (csv, filename) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
const csvStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

function ActivityTab() {
  const [actions, setActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cat, setCat] = useState(null);
  const [admin, setAdmin] = useState("");
  const [target, setTarget] = useState("");
  const [msg, setMsg] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => { api.adminCatalogue().then(setCat).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const res = await api.adminListAllActions({ admin, target, limit: ACTIVITY_PAGE, offset: 0 });
      setActions(res.actions || []);
      setTotal(res.total || 0);
      setHasMore(!!res.hasMore);
    } catch (e) { setMsg(e.message); }
  }, [admin, target]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    setMsg(null);
    try {
      const res = await api.adminListAllActions({ admin, target, limit: ACTIVITY_PAGE, offset: actions.length });
      setActions((prev) => [...prev, ...(res.actions || [])]);
      setTotal(res.total || 0);
      setHasMore(!!res.hasMore);
    } catch (e) { setMsg(e.message); }
    finally { setLoadingMore(false); }
  };

  const cosmeticName = (id) => cosmeticNameFor(cat, id);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    setMsg(null);
    try {
      const all = [];
      let offset = 0;
      // Pull every page of the *currently-filtered* feed (backend caps at 200/page).
      for (;;) {
        const res = await api.adminListAllActions({ admin, target, limit: 200, offset });
        const batch = res.actions || [];
        all.push(...batch);
        offset += batch.length;
        if (!res.hasMore || batch.length === 0) break;
      }
      downloadCsv(buildAuditCsv(all, cat), `admin-activity-${csvStamp()}.csv`);
    } catch (e) { setMsg(e.message); }
    finally { setExporting(false); }
  };

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input style={input} placeholder="Filter by acting admin (id / name / email)…" value={admin}
          onChange={(e) => setAdmin(e.target.value)} />
        {admin && <button className="btn" style={btn} onClick={() => setAdmin("")}>Clear</button>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <input style={input} placeholder="Filter by target account (id / name / email)…" value={target}
          onChange={(e) => setTarget(e.target.value)} />
        {target && <button className="btn" style={btn} onClick={() => setTarget("")}>Clear</button>}
        <button className="btn" style={btn} onClick={load}>Refresh</button>
        <button className="btn" style={btn} disabled={exporting || total === 0} onClick={exportCsv}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      {total > 0 && <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
        Showing {actions.length} of {total}
      </div>}
      <div className="col" style={{ gap: 6 }}>
        {actions.map((a) => (
          <div key={a.id} className="panel" style={{ ...panel, padding: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="impactf" style={{ fontSize: 11, color: ACT_COLOR[a.action] || "var(--dim)", minWidth: 120 }}>
                {ACT_VERB[a.action] || a.action}
              </span>
              {isStoreAction(a.action) ? (
                <>
                  <span style={{ fontWeight: 600 }}>store entry <span className="faint" style={{ fontSize: 11 }}>{a.entityId}</span></span>
                  <StoreDiff action={a.action} detail={a.detail} />
                </>
              ) : isRoleAction(a.action) ? (
                <span style={{ fontWeight: 600 }}>
                  Admin role <span className="faint" style={{ fontSize: 11 }}>({roleLabel(a.before)} → {roleLabel(a.after)})</span>
                </span>
              ) : isEventEditAction(a.action) ? (
                <>
                  <span style={{ fontWeight: 600 }}>event <span className="faint" style={{ fontSize: 11 }}>{a.entityId}</span></span>
                  <StoreDiff action={a.action} detail={a.detail} />
                </>
              ) : isEventFlagAction(a.action) ? (
                <span style={{ fontWeight: 600 }}>
                  {a.detail?.flag || "flag"} <span className="faint" style={{ fontSize: 11 }}>event {a.entityId}</span>
                </span>
              ) : (
                <>
                  {a.cosmeticId && (
                    <span style={{ fontWeight: 600 }}>
                      {cosmeticName(a.cosmeticId)} <span className="faint" style={{ fontSize: 11 }}>{a.cosmeticId}</span>
                    </span>
                  )}
                  {a.source && <span className="faint" style={{ fontSize: 11 }}>source: {a.source}</span>}
                  {a.detail && a.action !== "grant" && (
                    <span className="faint" style={{ fontSize: 11 }}>
                      {a.detail.removed ? "item taken back" : `kept (${a.detail.remainingSources ?? 0} source${a.detail.remainingSources === 1 ? "" : "s"} left)`}
                    </span>
                  )}
                </>
              )}
              <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>
                {a.at ? fmtDateTime(a.at) : ""}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              by <span style={{ color: "var(--gold)" }}>{a.adminName || "Unknown"}</span> #{a.adminId ?? "?"}
              {isStoreAction(a.action) ? (
                <> {" → "}<span style={{ color: "var(--paper)" }}>store catalog</span></>
              ) : isEventEditAction(a.action) ? (
                <> {" → "}<span style={{ color: "var(--paper)" }}>event calendar</span></>
              ) : (
                <>
                  {" → "}
                  <span style={{ color: "var(--paper)" }}>{a.targetName || "Unknown"}</span> #{a.targetUserId ?? "?"}
                  {a.targetEmail ? ` · ${a.targetEmail}` : ""}
                </>
              )}
            </div>
          </div>
        ))}
        {actions.length === 0 && <div className="panel" style={{ ...panel, color: "var(--dim)" }}>
          {admin || target ? "No admin actions match these filters." : "No admin actions recorded yet."}
        </div>}
      </div>
      {hasMore && <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <button className="btn" style={btn} disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : `Load more (${total - actions.length} more)`}
        </button>
      </div>}
    </div>
  );
}

function Label({ children }) {
  return <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--dim)", marginBottom: 10 }}>{children?.toString().toUpperCase()}</div>;
}

// ---------------------------------------------------------------- Dev tab (superadmin)
// Self-serve testing tools that all POST to the normal role-gated grant endpoint
// against your OWN account: drop the full cosmetic catalogue on yourself, top up
// currency, hand yourself usable consumables + premium time, and a "Cosmetic Lab"
// that previews ANY loadout on the real in-match pilot art (no ownership needed).
const PREMIUM_OPTS = [
  { id: "1h", label: "1 Hour", ms: 60 * 60 * 1000 },
  { id: "1d", label: "1 Day", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 Days", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30 Days", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "90d", label: "90 Days", ms: 90 * 24 * 60 * 60 * 1000 },
];
function DevTab({ meId }) {
  const [catalogue, setCatalogue] = useState(null);
  const [stash, setStash] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStash = useCallback(async () => {
    try { const r = await api.getConsumables(); setStash(r.items || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    api.getCatalogue().then(setCatalogue).catch(() => {});
    loadStash();
  }, [loadStash]);

  const run = async (fn, ok) => {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(ok); await loadStash(); }
    catch (e) { setMsg(e.message || "Failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="col gap-m" style={{ maxWidth: 900 }}>
      <div className="faint" style={{ fontSize: 12 }}>Testing tools — every action here applies to your own account.</div>
      {msg && <div style={devMsg}>{msg}</div>}

      <div style={devCard}>
        <div style={devHead}><span className="kanji" style={{ color: "var(--gold)" }}>▸</span> Cosmetics</div>
        <button className="btn" style={btn} disabled={busy}
          onClick={() => run(() => api.adminGrant(meId, { grantAll: true }), "Granted the full cosmetic catalogue to you.")}>
          Grant ALL cosmetics to me
        </button>
      </div>

      <div style={devCard}>
        <div style={devHead}><span className="kanji" style={{ color: "var(--gold)" }}>▸</span> Currency</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {[["CREDITS", 1000, "+1,000 Sea Glass"], ["CREDITS", 10000, "+10,000 Sea Glass"], ["PREMIUM", 10, "+10 Gold"], ["PREMIUM", 100, "+100 Gold"]].map(([currency, amount, label]) => (
            <button key={label} className="btn" style={btn} disabled={busy}
              onClick={() => run(() => api.adminGrant(meId, { currency, amount }), `Added ${label} to you.`)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={devCard}>
        <div style={devHead}><span className="kanji" style={{ color: "var(--gold)" }}>▸</span> Consumables</div>
        <div className="col gap-s">
          {stash.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <span className="kanji" style={{ marginRight: 6, color: "var(--gold)" }}>{c.glyph}</span>
                <b>{c.name}</b> <span className="faint" style={{ fontSize: 12 }}>×{c.count}</span>
                <div className="faint" style={{ fontSize: 11 }}>{c.desc}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {[1, 5].map((qty) => (
                  <button key={qty} className="btn" style={btn} disabled={busy}
                    onClick={() => run(() => api.adminGrant(meId, { consumable: c.id, qty }), `Granted ${qty}× ${c.name}.`)}>+{qty}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={devCard}>
        <div style={devHead}><span className="kanji" style={{ color: "var(--gold)" }}>▸</span> Premium (Gold Trail)</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {PREMIUM_OPTS.map((p) => (
            <button key={p.id} className="btn" style={btn} disabled={busy}
              onClick={() => run(() => api.adminGrant(meId, { premiumMs: p.ms }), `Granted ${p.label} of premium.`)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div style={devCard}>
        <div style={devHead}><span className="kanji" style={{ color: "var(--gold)" }}>▸</span> Cosmetic Lab</div>
        <CosmeticLab catalogue={catalogue} />
      </div>
    </div>
  );
}

// Preview ANY combination of cosmetics on the real in-match pilot art, ungated by
// ownership — the fastest way to eyeball how every in-match cosmetic reads.
function CosmeticLab({ catalogue }) {
  const [loadout, setLoadout] = useState({});
  if (!catalogue) return <div className="faint">Loading catalogue…</div>;
  const bySlot = {};
  for (const c of catalogue.cosmetics || []) (bySlot[c.slot] ||= []).push(c);
  // Slots that visibly change the in-match pilot art (body costume + worn overlays).
  const order = ["body", "headpiece", "bandana", "weapon", "oxygenTank", "shoes"];
  const slots = (catalogue.slots || [])
    .filter((s) => order.includes(s.key))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <div className="row" style={{ gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 240 }}>
        <KartPreview loadout={previewLoadout || {}} height={240} />
      </div>
      <div className="col gap-s" style={{ flex: 1, minWidth: 260 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" style={btn} onClick={() => {
            const rnd = {};
            for (const s of slots) { const opts = bySlot[s.key] || []; if (opts.length) rnd[s.key] = opts[Math.floor(Math.random() * opts.length)].id; }
            setLoadout(rnd);
          }}>Randomize</button>
          <button className="btn btn-ghost" style={btn} onClick={() => setLoadout({})}>Clear</button>
        </div>
        {slots.map((s) => (
          <div key={s.key} className="row" style={{ gap: 10, alignItems: "center" }}>
            <label className="faint" style={{ fontSize: 12, width: 90 }}>{s.label}</label>
            <select value={loadout[s.key] || ""} onChange={(e) => setLoadout((lo) => ({ ...lo, [s.key]: e.target.value || undefined }))} style={{ ...input, flex: 1 }}>
              <option value="">— none —</option>
              {(bySlot[s.key] || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

const devCard = { border: "2px solid var(--line)", background: "var(--ink-2)", padding: 16 };
const devHead = { fontFamily: "var(--display)", fontSize: 16, marginBottom: 12, color: "var(--paper)", display: "flex", alignItems: "center", gap: 8 };
const devMsg = { padding: "8px 12px", border: "1px solid var(--gold)", color: "var(--gold)", background: "rgba(255,200,61,0.08)", fontSize: 13 };

// ---------------------------------------------------------------- News tab
// Authoring for the six fixed player-facing news tiles. Pick a slot on the left,
// edit it on the right: title, banner (image URL for now), short blurb, and a
// pasteable HTML body. Status controls visibility — Draft (hidden), Published
// (live now), or Scheduled (auto-goes-live at the chosen time, lazily). Saving a
// live tile bumps its revision so players get a fresh unread badge.
const NEWS_STATUS = [["draft", "Draft"], ["published", "Published"], ["scheduled", "Scheduled"]];
function NewsTab() {
  const [slots, setSlots] = useState([]);
  const [selSlot, setSelSlot] = useState(1);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    try { const { news } = await api.adminListNews(); setSlots(news); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Load the selected slot into the editor whenever the slot list or selection changes.
  useEffect(() => {
    const s = slots.find((x) => x.slot === selSlot);
    setDraft(s ? {
      title: s.title || "", bannerUrl: s.bannerUrl || "", shortDesc: s.shortDesc || "",
      bodyHtml: s.bodyHtml || "", status: s.status || "draft",
      scheduledLocal: s.scheduledAt ? toCentralInput(s.scheduledAt) : "",
    } : null);
    setPreview(false);
  }, [slots, selSlot]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft) return;
    if (draft.status === "scheduled" && !draft.scheduledLocal) { setMsg("Pick a publish time for a scheduled tile."); return; }
    setBusy(true); setMsg(null);
    try {
      const item = {
        title: draft.title.trim(), bannerUrl: draft.bannerUrl.trim(), shortDesc: draft.shortDesc.trim(),
        bodyHtml: draft.bodyHtml, status: draft.status,
        scheduledAt: draft.status === "scheduled" && draft.scheduledLocal ? centralInputToISO(draft.scheduledLocal) : null,
      };
      const { item: saved } = await api.adminSaveNews(selSlot, item);
      setMsg(`Saved slot ${selSlot} — ${saved.status}${saved.scheduledAt ? ` for ${fmtWhen(saved.scheduledAt)}` : ""}.`);
      await load();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    if (!window.confirm(`Clear news slot ${selSlot}? This removes the tile for players.`)) return;
    setBusy(true); setMsg(null);
    try { await api.adminClearNews(selSlot); setMsg(`Cleared slot ${selSlot}.`); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const pickBanner = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMsg("Pick an image file (PNG, JPG, WEBP…)."); return; }
    if (file.size > 4 * 1024 * 1024) { setMsg("Image too large — 4 MB max."); return; }
    setBusy(true); setMsg("Uploading image…");
    try {
      const objectPath = await api.adminUploadNewsBanner(file);
      set({ bannerUrl: objectPath });
      setMsg("Image uploaded — remember to Save the slot.");
    } catch (err) { setMsg(err.message || "Upload failed."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
      <div className="panel" style={panel}>
        <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--dim)", marginBottom: 10 }}>SIX FIXED SLOTS</div>
        <div className="col gap-s">
          {Array.from({ length: 6 }, (_, i) => i + 1).map((slot) => {
            const s = slots.find((x) => x.slot === slot);
            const on = slot === selSlot;
            return (
              <button key={slot} onClick={() => setSelSlot(slot)} style={{ ...rowBtn, ...(on ? { borderColor: "var(--hot)" } : null) }}>
                <span style={{ fontWeight: 700 }}>#{slot} · {s?.title?.trim() || "Empty"}</span>
                <span className="faint" style={{ fontSize: 11 }}>
                  {s ? statusLabel(s) : "empty"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {msg && <div style={banner}>{msg}</div>}
        {!draft ? (
          <div className="panel" style={{ ...panel, color: "var(--dim)" }}>Loading slot…</div>
        ) : (
          <div className="panel" style={panel}>
            <div className="display" style={{ fontSize: 22, color: "var(--paper)", marginBottom: 14 }}>NEWS SLOT #{selSlot}</div>

            <NewsField label="Title">
              <input style={input} value={draft.title} maxLength={120}
                placeholder="Dispatch headline" onChange={(e) => set({ title: e.target.value })} />
            </NewsField>

            <NewsField label="Banner image" hint="Upload an image (PNG/JPG/WEBP, 4 MB max) or paste a direct image URL.">
              <input style={input} value={draft.bannerUrl}
                placeholder="https://…/banner.png  or  /objects/uploads/…" onChange={(e) => set({ bannerUrl: e.target.value })} />
              <label className="btn" style={{ ...btn, marginLeft: 8, whiteSpace: "nowrap", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                Upload
                <input type="file" accept="image/*" disabled={busy} onChange={pickBanner} style={{ display: "none" }} />
              </label>
            </NewsField>
            {draft.bannerUrl.trim() && (
              <img src={draft.bannerUrl.trim()} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", border: "1px solid var(--line)", marginBottom: 12 }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} onLoad={(e) => { e.currentTarget.style.display = "block"; }} />
            )}

            <NewsField label="Short description" hint="One-line blurb shown on the tile.">
              <input style={input} value={draft.shortDesc} maxLength={200}
                placeholder="A short teaser line" onChange={(e) => set({ shortDesc: e.target.value })} />
            </NewsField>

            <NewsField label="Body (HTML)" hint="Paste rich HTML — rendered for players in a sandboxed frame (scripts disabled).">
              <textarea value={draft.bodyHtml} onChange={(e) => set({ bodyHtml: e.target.value })}
                spellCheck={false} placeholder="<h1>Big news</h1><p>Paste HTML here…</p>"
                style={{ ...input, flex: "unset", width: "100%", minHeight: 200, fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.5, resize: "vertical" }} />
            </NewsField>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button className="btn" style={btn} onClick={() => setPreview((p) => !p)} disabled={!draft.bodyHtml.trim()}>
                {preview ? "Hide preview" : "Preview body"}
              </button>
              <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>{new Blob([draft.bodyHtml]).size.toLocaleString()} bytes</span>
            </div>
            {preview && draft.bodyHtml.trim() && (
              <iframe title="news-preview" srcDoc={draft.bodyHtml} sandbox="allow-popups"
                style={{ width: "100%", height: "40vh", border: "1px solid var(--line)", background: "#fff", marginBottom: 14 }} />
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
              <div style={{ minWidth: 180 }}>
                <div className="faint" style={{ fontSize: 11, letterSpacing: "0.1em", marginBottom: 6 }}>STATUS</div>
                <select style={sel} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  {NEWS_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {draft.status === "scheduled" && (
                <div style={{ minWidth: 220 }}>
                  <div className="faint" style={{ fontSize: 11, letterSpacing: "0.1em", marginBottom: 6 }}>AUTO-PUBLISH AT (CENTRAL TIME)</div>
                  <input type="datetime-local" style={{ ...input, width: "100%" }} value={draft.scheduledLocal}
                    onChange={(e) => set({ scheduledLocal: e.target.value })} />
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-hot" style={btn} onClick={save} disabled={busy}>Save</button>
              <button className="btn" style={btn} onClick={clear} disabled={busy}>Clear slot</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewsField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="faint" style={{ fontSize: 11, letterSpacing: "0.1em", marginBottom: 6 }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex" }}>{children}</div>
      {hint && <div className="faint" style={{ fontSize: 11, marginTop: 4, color: "var(--dim)" }}>{hint}</div>}
    </div>
  );
}

function statusLabel(s) {
  if (s.status === "published") return "live";
  if (s.status === "scheduled") return s.scheduledAt ? `scheduled · ${fmtWhen(s.scheduledAt)}` : "scheduled";
  return "draft";
}
function fmtWhen(iso) {
  return fmtDateTime(iso, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) || iso;
}

// ---------------------------------------------------------------- Localization tab
// The master string table: every UI key with its English source (read-only, the
// source-of-truth in code) and an editable cell per translatable language. A
// saved cell is marked "human-edited" and locked from AI auto-translate; clearing
// it releases the lock and lets the machine seed refill it. Blank translations
// fall back to English in-game, so partial coverage is safe to ship.
function LocalizationTab() {
  const [data, setData] = useState(null); // { locales, translatable, rows }
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null); // lang currently auto-translating

  const load = useCallback(async () => {
    try { setData(await api.adminListI18n()); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // AI auto-translate one locale. Fills only missing, non-human-edited rows so
  // manual edits stay locked. Reloads the table to show the freshly seeded cells.
  const autoTranslate = async (lang) => {
    setBusy(lang);
    setMsg(`Auto-translating ${lang}…`);
    try {
      const r = await api.adminAutoTranslate(lang, true);
      await load();
      setMsg(r.requested === 0
        ? `${lang}: nothing to translate — all rows are filled or locked.`
        : `${lang}: translated ${r.translated}/${r.requested}${r.failed ? ` (${r.failed} failed)` : ""}.`);
    } catch (e) { setMsg(e.message); }
    finally { setBusy(null); }
  };

  const save = async (key, lang, value, prev) => {
    if (value === prev) return;
    try {
      const { saved } = await api.adminSaveTranslation(key, lang, value);
      setData((d) => ({ ...d, rows: d.rows.map((r) => r.key === key
        ? { ...r, [lang]: saved.value, humanEdited: { ...r.humanEdited, [lang]: saved.humanEdited } }
        : r) }));
      setMsg(`Saved ${key} · ${lang}`);
    } catch (e) { setMsg(e.message); }
  };

  if (!data) return <div className="panel" style={{ ...panel, color: "var(--dim)" }}>{msg || "Loading strings…"}</div>;

  const translatable = data.translatable || [];
  const ql = q.trim().toLowerCase();
  const rows = data.rows.filter((r) => {
    if (ql && !(r.key.toLowerCase().includes(ql) || (r.en || "").toLowerCase().includes(ql))) return false;
    if (onlyMissing && !translatable.some((l) => !r[l])) return false;
    return true;
  });

  // Per-language coverage (how many keys have a non-empty translation).
  const coverage = translatable.map((l) => ({
    lang: l, done: data.rows.filter((r) => r[l]).length, total: data.rows.length,
  }));

  return (
    <div>
      {msg && <div style={banner}>{msg}</div>}
      <div className="panel" style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, minWidth: 220, flex: "unset" }} placeholder="Search key or English text…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row gap-s" style={{ fontSize: 13, color: "var(--dim)", cursor: "pointer" }}>
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Only untranslated
          </label>
          <div style={{ flex: 1 }} />
          {coverage.map((c) => (
            <span key={c.lang} className="faint" style={{ fontSize: 12 }}>
              <b style={{ color: "var(--paper)" }}>{c.lang}</b> {c.done}/{c.total}
            </span>
          ))}
          <span className="faint" style={{ fontSize: 12 }}>{rows.length} shown</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <span className="faint" style={{ fontSize: 12, color: "var(--dim)" }}>AI auto-translate:</span>
          {translatable.map((l) => (
            <button key={l} className="btn" disabled={!!busy}
              onClick={() => autoTranslate(l)}
              style={{ ...btn, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
              {busy === l ? `Translating ${l}…` : `Fill ${l}`}
            </button>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 8, color: "var(--dim)" }}>
          English is the source (edited in code). Type a translation and press Enter or click away to save. A locked
          <span title="human-edited" style={{ margin: "0 3px" }}>[locked]</span> cell is protected from AI auto-translate — clear it to release.
          Auto-translate fills only blank, unlocked cells and leaves your manual edits untouched.
        </div>
      </div>

      <div className="panel" style={{ ...panel, overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={i18nTh}>KEY</th>
              <th style={i18nTh}>ENGLISH (SOURCE)</th>
              {translatable.map((l) => <th key={l} style={i18nTh}>{l.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ ...i18nTd, fontFamily: "monospace", fontSize: 12, color: "var(--dim)", whiteSpace: "nowrap" }}>{r.key}</td>
                <td style={{ ...i18nTd, color: "var(--paper)", minWidth: 200 }}>{r.en}</td>
                {translatable.map((l) => (
                  <td key={l} style={{ ...i18nTd, minWidth: 200 }}>
                    <I18nCell rowKey={r.key} lang={l} value={r[l] || ""} placeholder={r.en}
                      locked={!!r.humanEdited?.[l]} onSave={save} />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td style={{ ...i18nTd, color: "var(--dim)" }} colSpan={2 + translatable.length}>No strings match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One editable translation cell. Uncontrolled input (keyed by value so external
// reloads reset it); saves on blur or Enter, reverts on Escape.
function I18nCell({ rowKey, lang, value, placeholder, locked, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(rowKey, lang, v, value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") { setV(value); e.currentTarget.blur(); }
        }}
        style={{ ...input, flex: 1, fontWeight: 500, fontSize: 13,
          borderColor: locked ? "var(--hot)" : "var(--line)",
          color: v ? "var(--paper)" : "var(--dim)" }}
      />
      {locked && <span title="Human-edited — protected from auto-translate" style={{ color: "var(--hot)", fontSize: 12 }}>lock</span>}
    </div>
  );
}
const i18nTh = { textAlign: "left", padding: "10px 12px", fontSize: 11, letterSpacing: "0.1em", color: "var(--dim)", background: "var(--ink)", position: "sticky", top: 0, whiteSpace: "nowrap" };
const i18nTd = { padding: "8px 12px", verticalAlign: "middle", fontSize: 13 };

const page = { height: "100%", overflowY: "auto", padding: "28px 32px", background: "radial-gradient(120% 90% at 80% 0%, #1a1422 0%, var(--ink) 60%)" };
const panel = { padding: 18, background: "var(--ink-2)", border: "1px solid var(--line)" };
const input = { background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "8px 10px", fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, outline: "none", flex: 1 };
const btn = { padding: "8px 12px", fontSize: 13 };
const sel = { background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "8px 10px", fontFamily: "var(--body)", fontSize: 13, fontWeight: 600, outline: "none", flex: 1, width: "100%" };
const segGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };
const rowBtn = { display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "8px 10px", background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", textAlign: "left" };
const banner = { background: "rgba(255,45,77,0.12)", border: "1px solid var(--hot)", color: "var(--paper)", padding: "10px 12px", marginBottom: 14, fontSize: 13 };
const adminRow = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" };
