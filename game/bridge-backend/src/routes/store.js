import { Router } from "express";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";
import { CURRENCIES } from "../config/index.js";

export const storeRouter = Router();

// THE roll. Lives on the server so it cannot be tampered with and so published
// odds are the real odds. Weights need not sum to 100 — we normalize here.
function rollDrop(drops) {
  const total = drops.reduce((a, d) => a + d.weight, 0);
  let r = Math.random() * total;
  for (const d of drops) if ((r -= d.weight) <= 0) return d;
  return drops[0];
}

// Public: list boxes with their (openly disclosed) odds as percentages.
// Optional ?currency=CREDITS|PREMIUM to power the two separate storefronts.
storeRouter.get("/boxes", async (req, res) => {
  const filter = req.query.currency;
  let boxes = await db.listBoxes();
  if (filter) boxes = boxes.filter((b) => b.currency === filter);
  res.json(boxes.map((b) => {
    const total = b.drops.reduce((a, d) => a + d.weight, 0);
    return {
      id: b.id, name: b.name, price: b.price, currency: b.currency,
      odds: b.drops.map((d) => ({ item: d.item, rarity: d.rarity,
        chance: +((d.weight / total) * 100).toFixed(2) })),
    };
  }));
});

// Strip admin-only fields (worth, dropWeight) from anything player-facing.
function publicItem(it) {
  return { id: it.id, name: it.name, rarity: it.rarity, currency: it.currency,
    price: it.price, priceCents: it.priceCents ?? null, cosmeticId: it.cosmeticId,
    grantsNameChange: it.grantsNameChange || 0 };
}

// Public: list direct-purchase store items. ?currency=CREDITS|PREMIUM to split
// the two storefronts. NEVER includes worth/dropWeight.
storeRouter.get("/items", async (req, res) => {
  const filter = req.query.currency;
  let items = (await db.listStoreItems()).filter((i) => i.enabled !== false);
  if (filter) items = items.filter((i) => i.currency === filter);
  res.json(items.map(publicItem));
});

// Buy an item by spending its currency balance. CREDITS items cost Silver Nuggets;
// PREMIUM items cost Gold Nuggets (bought as bundles via Stripe). Utility products
// (e.g. name change) grant their credit instead of a cosmetic.
storeRouter.post("/items/:id/buy", requireAuth, async (req, res) => {
  const it = await db.getStoreItem(req.params.id);
  if (!it || it.enabled === false) return res.status(404).json({ error: "Item not available." });
  const cur = it.currency === "PREMIUM" ? "PREMIUM" : "CREDITS";
  const label = CURRENCIES[cur].label + "s";
  const balance = await db.getBalance(req.userId, cur);
  if (balance < it.price) return res.status(402).json({ error: `Not enough ${label}.` });
  await db.adjustBalance(req.userId, cur, -it.price, `buy:${it.id}`);
  const grant = it.cosmeticId ? await db.grantCosmetic(req.userId, it.cosmeticId, `buy:${it.id}`) : null;
  let nameChangeCredits;
  if (it.grantsNameChange > 0) ({ nameChangeCredits } = await db.grantNameChangeCredit(req.userId, it.grantsNameChange));
  await db.addItem(req.userId, it.name, it.rarity, `buy:${it.id}`);
  res.json({ bought: publicItem(it), newlyOwned: grant ? grant.newlyOwned : null,
    currency: cur, nameChangeCredits, balance: await db.getBalance(req.userId, cur) });
});


// charge first, then grant, so a failure can't hand out a free item.
storeRouter.post("/boxes/:boxId/open", requireAuth, async (req, res) => {
  const box = await db.getBox(req.params.boxId);
  if (!box) return res.status(404).json({ error: "That box doesn't exist." });

  const balance = await db.getBalance(req.userId, box.currency);
  if (balance < box.price) {
    const label = (CURRENCIES[box.currency]?.label || box.currency) + "s";
    return res.status(402).json({ error: `Not enough ${label}.` });
  }

  await db.adjustBalance(req.userId, box.currency, -box.price, `open:${box.id}`);
  const drop = rollDrop(box.drops);
  const entry = await db.addItem(req.userId, drop.item, drop.rarity, `box:${box.id}`);
  // Add the cosmetic to the player's owned set so it can be equipped.
  let grant = null;
  if (drop.cosmeticId) grant = await db.grantCosmetic(req.userId, drop.cosmeticId, `box:${box.id}`);

  res.json({
    reward: { item: drop.item, rarity: drop.rarity, cosmeticId: drop.cosmeticId || null,
      newlyOwned: grant ? grant.newlyOwned : null, inventoryId: entry.id },
    balance: await db.getBalance(req.userId, box.currency),
  });
});
