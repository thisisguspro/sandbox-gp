import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import * as api from "./backend.js";

// ============================================================================
// Client-side i18n. English is the source-of-truth in the backend catalogue;
// this provider fetches the merged dictionary for the active language (each
// non-English string already falls back to English server-side, so a partial
// translation is always safe). t(key) returns the translated string, or the key
// itself if it isn't in the catalogue yet — a loud, obvious "missing key" tell.
//
// Language resolution:
//   • active language: localStorage choice → best browser-language match → English
//   • signed-in: changing the language in Settings (or onboarding) also writes it
//     through to the account server-side.
// ============================================================================

const LANG_KEY = "ironfrontier_lang";
const I18nCtx = createContext(null);

// Best initial guess from the browser before we know the account preference.
function pickInitial(available) {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && available.includes(saved)) return saved;
  const navLangs = navigator.languages || [navigator.language || ""];
  for (const n of navLangs) {
    if (available.includes(n)) return n;
    const base = (n || "").split("-")[0];
    const m = available.find((a) => a.split("-")[0] === base);
    if (m) return m;
  }
  return "en";
}

export function I18nProvider({ children }) {
  const [locales, setLocales] = useState([{ code: "en", label: "English", source: true }]);
  const [lang, setLangState] = useState(localStorage.getItem(LANG_KEY) || "en");
  const [dict, setDict] = useState({});
  const [ready, setReady] = useState(false);
  const cache = useRef({}); // code -> dict (avoid refetch on toggle)

  const loadDict = useCallback(async (code) => {
    if (cache.current[code]) { setDict(cache.current[code]); setLangState(code); setReady(true); return; }
    try {
      const res = await api.fetchDict(code);
      cache.current[code] = res.dict || {};
      setDict(res.dict || {});
      setLangState(code);
    } catch { /* keep whatever dict we have; never block the UI */ }
    finally { setReady(true); }
  }, []);

  // On boot: learn the available locales, then load the best guess dictionary.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await api.fetchLocales();
        if (!alive) return;
        setLocales(meta.locales || []);
        await loadDict(pickInitial((meta.locales || []).map((l) => l.code)));
      } catch {
        if (alive) setReady(true); // offline / not wired — fall back to keys
      }
    })();
    return () => { alive = false; };
  }, [loadDict]);

  // User explicitly picks a language (Settings). Persist locally + to account.
  const setLang = useCallback(async (code) => {
    localStorage.setItem(LANG_KEY, code);
    await loadDict(code);
    if (api.getToken()) { try { await api.setUserLanguage(code); } catch { /* best-effort */ } }
  }, [loadDict]);

  // App calls this on login/boot with the account's saved language (when known);
  // it wins over local detection and is mirrored into localStorage for cold boots.
  const syncAccountLang = useCallback((code) => {
    if (!code) return;
    localStorage.setItem(LANG_KEY, code);
    loadDict(code);
  }, [loadDict]);

  // t(key, vars?) — vars interpolate {name}-style placeholders.
  const t = useCallback((key, vars) => {
    let s = dict[key];
    if (s == null) s = key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  }, [dict]);

  // Hold rendering until the first dictionary attempt resolves (success OR
  // failure) so screens never flash raw keys. The context is still provided, so
  // nothing that reads it during this brief window crashes.
  return (
    <I18nCtx.Provider value={{ t, lang, setLang, locales, ready, syncAccountLang }}>
      {ready ? children : <div style={{ position: "fixed", inset: 0, background: "#0d0b14" }} />}
    </I18nCtx.Provider>
  );
}

// Hook used everywhere. Falls back to an identity t() if used outside a provider
// (keeps isolated component previews / tests from crashing).
export function useI18n() {
  return useContext(I18nCtx) || {
    t: (k) => k, lang: "en", setLang: () => {}, locales: [], ready: true, syncAccountLang: () => {},
  };
}
