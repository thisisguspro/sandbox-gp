import { Router } from "express";
import { db } from "../store/index.js";
import { LOCALES, DEFAULT_LOCALE } from "../config/strings.js";

// Public localization API (no auth): the client fetches the locale list and the
// merged string dictionary for the language it wants BEFORE sign-in, so the
// sign-in / onboarding screens can be localized too.
export const i18nRouter = Router();

// Available languages + the default. Drives the language picker.
i18nRouter.get("/meta", (_req, res) => {
  res.json({ locales: LOCALES, default: DEFAULT_LOCALE });
});

// The merged { key: string } dictionary for one language. Unknown languages
// fall back to the default locale inside the store.
i18nRouter.get("/:lang", async (req, res) => {
  const lang = String(req.params.lang || "");
  const dict = await db.getLocaleDict(lang);
  res.json({ lang, dict });
});
