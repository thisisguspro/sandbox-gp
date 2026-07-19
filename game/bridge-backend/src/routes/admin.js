import { Router } from "express";
import { db } from "../store/index.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin); // every admin route is gated separately from players

// View / edit loot box configs. This is the "tune drop rates without redeploy" flow.
adminRouter.get("/boxes", async (_req, res) => {
  res.json({ boxes: await db.listBoxes() });
});

adminRouter.put("/boxes/:boxId", async (req, res) => {
  const { name, price, currency, drops } = req.body || {};
  if (!Array.isArray(drops) || drops.length === 0) {
    return res.status(400).json({ error: "A box needs at least one drop entry." });
  }
  for (const d of drops) {
    if (typeof d.item !== "string" || typeof d.weight !== "number" || d.weight < 0) {
      return res.status(400).json({ error: "Each drop needs an item and a non-negative weight." });
    }
  }
  const box = await db.upsertBox({
    id: req.params.boxId,
    name: name || req.params.boxId,
    price: Number(price) || 0,
    currency: currency || "CREDITS",
    drops,
  });
  res.json({ box });
});

// Mint a redemption code that grants an item and/or currency.
adminRouter.post("/codes", async (req, res) => {
  const { code, reward, currency, amount } = req.body || {};
  if (!code) return res.status(400).json({ error: "Provide a code string." });
  if (!reward && !amount) return res.status(400).json({ error: "Code must grant an item or currency." });
  const payload = {};
  if (reward) payload.reward = reward;
  if (amount) { payload.currency = currency || "CREDITS"; payload.amount = Number(amount); }
  const created = await db.createCode(String(code).trim().toUpperCase(), payload);
  res.json({ created });
});
