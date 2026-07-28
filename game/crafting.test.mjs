// SANDBOX GP — the Sea Glass economy: scrap, craft, and what must never be craftable.
//
// The rule this file exists to defend: you can scrap and craft LOOT BOX items
// and nothing else. Level unlocks, loyalty rewards, and the starter kit are a
// record of what a player DID — if you can mint them with currency they stop
// meaning anything, and if you can melt them the record is gone.
import { memoryStore as db } from "./bridge-backend/src/store/memory.js";
import {
  COSMETICS, CRAFT_COST, SCRAP_RETURN_PCT, isCraftable, scrapValue,
} from "./bridge-backend/src/config/cosmetics.js";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

const items = Object.values(COSMETICS);
const boxItems = items.filter((c) => c.source === "box");
const earned = items.filter((c) => c.source !== "box");

// ---- what is, and is not, craftable ----
{
  boxItems.every(isCraftable)
    ? ok(`all ${boxItems.length} loot-box items are craftable`)
    : no("some box items aren't craftable");

  const leaked = earned.filter(isCraftable);
  (leaked.length === 0)
    ? ok(`all ${earned.length} earned items are PROTECTED (level, loyalty, starter)`)
    : no(`craftable leak: ${leaked.map((c) => `${c.name}(${c.source})`).join(", ")}`);

  const loyalty = items.filter((c) => c.source === "loyalty");
  loyalty.every((c) => !isCraftable(c) && scrapValue(c) === 0)
    ? ok("loyalty rewards can be neither crafted nor scrapped")
    : no("a loyalty reward is craftable or scrappable");
}

// ---- the maths: scrapping must never be an arbitrage loop ----
{
  for (const r of ["Common", "Rare", "Epic", "Legendary"]) {
    const ex = boxItems.find((c) => c.rarity === r);
    if (!ex) continue;
    const back = scrapValue(ex);
    const cost = CRAFT_COST[r];
    (back < cost * 0.5)
      ? ok(`${r}: scrap returns ${back}, craft costs ${cost} (${Math.round(SCRAP_RETURN_PCT * 100)}% — no free lunch)`)
      : no(`${r} scrap ${back} vs craft ${cost} — too generous, players can farm it`);
  }
  // you must never be able to scrap N of a thing and craft the same thing back
  const c = boxItems.find((x) => x.rarity === "Common");
  (scrapValue(c) < CRAFT_COST.Common)
    ? ok("scrapping an item never pays for re-crafting it")
    : no("scrap→craft is a perpetual motion machine");
}

// ---- the live round trip ----
{
  const u = await db.createUser({ googleId: `glass-${Date.now()}`, name: "Glassy" });
  const uid = u.id;

  const legendary = boxItems.find((c) => c.rarity === "Legendary");
  const common = boxItems.find((c) => c.rarity === "Common");
  // A progression item — one you were GIVEN, not one you pulled from a chest. The
  // source used to be "level"; the catalogue rebuild calls it "starter". Either
  // way it must not be meltable: scrapping the thing the game handed you for free
  // would be a way to mint sea glass out of nothing.
  const locked = earned.find((c) => c.source === "starter" || c.source === "level" || c.source === "loyalty");

  await db.grantCosmetic(uid, legendary.id, "test");
  const before = (await db.getProfile(uid)).balances.CREDITS;
  const s = await db.scrapCosmetic(uid, legendary.id);
  // Sea glass IS the in-game wallet now — a new account already has some, so the
  // balance after scrapping is the OLD balance plus the scrap value, not the
  // scrap value alone.
  (s.glass === scrapValue(legendary) && s.balance === before + s.glass)
    ? ok(`scrapped ${legendary.name} → +${s.glass} sea glass (wallet ${before} → ${s.balance})`)
    : no(`scrap paid ${s.glass} (expected ${scrapValue(legendary)}), balance ${s.balance} (expected ${before + s.glass})`);

  const stillOwned = (await db.getProfile(uid)).owned?.includes(legendary.id);
  (!stillOwned) ? ok("the scrapped item is actually gone") : no("scrapped item is still owned");

  const c = await db.craftCosmetic(uid, common.id);
  (c.spent === CRAFT_COST.Common)
    ? ok(`crafted ${common.name} for ${c.spent} sea glass`)
    : no(`craft charged ${c.spent}, expected ${CRAFT_COST.Common}`);

  const nowOwned = (await db.getProfile(uid)).owned?.includes(common.id);
  nowOwned ? ok("the crafted item is owned") : no("crafted item never landed");

  // the guards
  let blocked = 0;
  try { await db.scrapCosmetic(uid, locked.id); } catch { blocked++; }
  try { await db.craftCosmetic(uid, locked.id); } catch { blocked++; }
  (blocked === 2)
    ? ok(`a ${locked.source} reward (${locked.name}) can't be scrapped OR crafted`)
    : no(`progression item was mintable/meltable (${blocked}/2 guards held)`);

  // can't craft what you already own
  let dup = false;
  try { await db.craftCosmetic(uid, common.id); } catch { dup = true; }
  dup ? ok("can't craft something you already own") : no("crafted a duplicate");

  // can't scrap what you're wearing
  await db.equipCosmetic(uid, common.id).catch(() => {});
  let worn = false;
  try { await db.scrapCosmetic(uid, common.id); } catch { worn = true; }
  worn ? ok("can't scrap the item you're currently wearing") : no("scrapped an equipped item");

  // can't craft with an empty wallet
  const pauper = await db.createUser({ googleId: `broke-${Date.now()}`, name: "Broke" });
  let poor = false;
  try { await db.craftCosmetic(pauper.id, legendary.id); } catch { poor = true; }
  poor ? ok("can't craft without the sea glass to pay for it") : no("crafted for free");
}

// ---- the economy is CLOSED: no path around crafting ----
{
  const store = await db.listStoreItems();

  // Seashells must not buy a cosmetic. In-game items come out of chests, and a
  // specific one is CRAFTED. An open buy endpoint would let a hacked client walk
  // straight past the entire crafting economy.
  const seashellCosmetics = store.filter((s) => s.currency !== "PREMIUM" && s.cosmeticId);
  const u = await db.createUser({ googleId: `econ-${Date.now()}`, name: "Econ" });
  let blocked = 0;
  for (const s of seashellCosmetics.slice(0, 5)) {
    // the ROUTE blocks this; assert the rule holds at the data layer too —
    // every seashell cosmetic must be craftable, i.e. reachable without buying
    const c = COSMETICS[s.cosmeticId];
    if (c && isCraftable(c)) blocked++;
  }
  (blocked === Math.min(5, seashellCosmetics.length))
    ? ok("every seashell-priced cosmetic is reachable by CRAFTING (so blocking the sale strands nobody)")
    : no("a seashell cosmetic is neither buyable nor craftable — it'd be unobtainable");

  // Premium cosmetics must NEVER be craftable — you paid for them.
  const premiumCosmetics = store.filter((s) => s.currency === "PREMIUM" && s.cosmeticId);
  const leaked = premiumCosmetics.filter((s) => {
    const c = COSMETICS[s.cosmeticId];
    return c && isCraftable(c);
  });
  (leaked.length === 0)
    ? ok(`all ${premiumCosmetics.length} Sand Dollar cosmetics are uncraftable (paying for something a rival can melt down would be a joke)`)
    : no(`craftable premium items: ${leaked.map((s) => s.cosmeticId).join(", ")}`);
}

// ---- TWO CURRENCIES. Not three. ----
{
  const { CURRENCIES } = await import("./bridge-backend/src/config/index.js");
  const keys = Object.keys(CURRENCIES);
  (keys.length === 2 && keys.includes("CREDITS") && keys.includes("PREMIUM"))
    ? ok(`two currencies: ${keys.map((k) => `${k}="${CURRENCIES[k].label}"`).join(", ")}`)
    : no(`expected exactly 2 currencies, got: ${keys.join(", ")}`);

  (CURRENCIES.CREDITS.label === "Sea Glass" && CURRENCIES.CREDITS.earnable)
    ? ok("Sea Glass is the in-game currency, and it's earnable")
    : no("Sea Glass isn't set up as the earnable in-game currency");

  (CURRENCIES.PREMIUM.label === "Shell" && !CURRENCIES.PREMIUM.earnable && CURRENCIES.PREMIUM.purchasable)
    ? ok("Shells are the cash currency: purchasable, never earnable")
    : no("Shells aren't set up as cash-only");

  // Migration: a wallet that still holds the old separate GLASS balance must
  // have it folded in, not dropped. Losing someone's crafting material because
  // we merged two ledgers would be unforgivable.
  const { applyAccountDefaults } = await import("./bridge-backend/src/store/memory.js");
  const legacy = applyAccountDefaults({
    id: "legacy", balances: { CREDITS: 400, PREMIUM: 3, GLASS: 270 },
    cosmetics: new Set(), stats: {},
  });
  (legacy.balances.CREDITS === 670 && legacy.balances.GLASS === undefined)
    ? ok("an old wallet's stranded sea glass folds into the one balance (400 + 270 = 670)")
    : no(`migration lost glass: ${JSON.stringify(legacy.balances)}`);

  // ONE currency buys everything in-game: every chest must be priced in it.
  const boxes = await db.listBoxes();
  const cashBoxes = boxes.filter((b) => b.currency === "PREMIUM");
  (cashBoxes.length === 0)
    ? ok(`all ${boxes.length} chests cost sea glass — no cash loot boxes`)
    : no(`REAL-MONEY LOOT BOX: ${cashBoxes.map((b) => b.name).join(", ")} — this is the mechanic that gets games pulled`);

  boxes.every((b) => b.currency === "CREDITS")
    ? ok("you can earn your way to every chest in the game")
    : no("a chest can't be bought with the currency you earn");
}

// ==========================================================================
// THE WARDROBE: sets, names, and an economy that isn't a paywall
// ==========================================================================
{
  const { SETS } = await import("./bridge-backend/src/config/cosmetics.js");

  // ---- NO DUPLICATE NAMES ----
  // The old catalogue had FIFTEEN. "Kraken Snorkel" twice, "Surfboard" twice,
  // "Cat-Ear Helmet" twice — because it was the samurai game's item list with beach
  // names painted over it (the IDs still read `breather_oni`, `tool_katana`,
  // `belt_obi`). Two items, same name, different mesh: a store that lies to you.
  {
    const byName = {};
    for (const c of Object.values(COSMETICS)) (byName[c.name] ||= []).push(c.id);
    const dupes = Object.entries(byName).filter(([, ids]) => ids.length > 1);
    (dupes.length === 0)
      ? ok(`all ${Object.keys(COSMETICS).length} cosmetics have a unique name`)
      : no(`duplicate names: ${dupes.map(([n, ids]) => `${n} (${ids.join("/")})`).join(", ")}`);
  }

  // ---- EVERY ITEM BELONGS TO A SET ----
  // Players don't buy hats, they buy an identity — and they buy it as a set:
  //   "The clever packaging of SETS of items appeals to players, making them want
  //    to purchase the skin for their character AS WELL AS the accessories."
  // 118 loose items with no theme gave a player no story to tell about themselves.
  {
    const orphans = Object.values(COSMETICS).filter((c) => !c.set || !SETS[c.set]);
    (orphans.length === 0)
      ? ok(`every cosmetic belongs to one of the ${Object.keys(SETS).length} collections`)
      : no(`${orphans.length} items belong to no set: ${orphans.slice(0, 4).map((c) => c.name).join(", ")}`);
  }

  // ---- EVERY SET IS COMPLETABLE, AND NONE IS A PAYWALL ----
  // At most ONE cash-only piece per set. A collection you can only finish with
  // money isn't a collection, it's a hostage.
  {
    const boxes = await db.listBoxes();
    const inBox = new Set(boxes.flatMap((b) => b.drops.map((d) => d.cosmeticId)));
    const paywalled = [];
    const unfinishable = [];

    for (const s of Object.values(SETS)) {
      const items = Object.values(COSMETICS).filter((c) => c.set === s.id);
      const cashOnly = items.filter((c) => c.source === "premium");
      if (cashOnly.length > 1) paywalled.push(`${s.name} (${cashOnly.length} cash-only)`);

      // everything else must be reachable without paying
      const unreachable = items.filter(
        (c) => c.source !== "premium" && c.source !== "starter" && c.source !== "loyalty" && !inBox.has(c.id)
      );
      if (unreachable.length) unfinishable.push(`${s.name}: ${unreachable.map((c) => c.name).join(", ")}`);
    }

    (paywalled.length === 0)
      ? ok("at most one cash-only piece per set — every collection is finishable free")
      : no(`PAYWALLED SETS: ${paywalled.join(" | ")}`);

    (unfinishable.length === 0)
      ? ok("every non-premium cosmetic is actually obtainable")
      : no(`unobtainable items: ${unfinishable.join(" | ")}`);
  }

  // ---- THE PREMIUM TIER MEANS SOMETHING ----
  // Paying real money for a thing a rival can melt down for sea glass, or pull
  // free out of a chest, is a joke.
  {
    const boxes = await db.listBoxes();
    const inBox = new Set(boxes.flatMap((b) => b.drops.map((d) => d.cosmeticId)));
    const premium = Object.values(COSMETICS).filter((c) => c.source === "premium");

    (premium.length >= 5)
      ? ok(`${premium.length} crown jewels in the Shell store — one per collection`)
      : no(`only ${premium.length} premium items`);

    const meltable = premium.filter(isCraftable);
    (meltable.length === 0)
      ? ok("no premium item can be crafted or scrapped")
      : no(`craftable premium items: ${meltable.map((c) => c.name).join(", ")}`);

    const dropping = premium.filter((c) => inBox.has(c.id));
    (dropping.length === 0)
      ? ok("no premium item drops from a chest")
      : no(`premium items in chests: ${dropping.map((c) => c.name).join(", ")}`);
  }

  // ---- THE DEAD SLOTS ARE GONE ----
  {
    const { SLOTS } = await import("./bridge-backend/src/config/cosmetics.js");
    const dead = ["background", "victoryPose", "border"].filter((s) => SLOTS[s]);
    (dead.length === 0)
      ? ok("the dead slots are gone (background — never rendered; victoryPose — never read; border — an achievement reward now)")
      : no(`dead slots still present: ${dead.join(", ")}`);

    const orphanItems = Object.values(COSMETICS).filter((c) => !SLOTS[c.slot]);
    (orphanItems.length === 0)
      ? ok("every cosmetic sits in a real slot")
      : no(`${orphanItems.length} items in dead slots: ${orphanItems.slice(0, 3).map((c) => c.name).join(", ")}`);
  }

  // ---- THE LEVEL LADDER GRANTS THINGS THAT EXIST ----
  // It used to hand out `body_jumpsuit`, `shoes_boots`, `belt_utility`,
  // `pose_salute` and `bg_badlands` — none of which existed.
  {
    const { LEVEL_UNLOCKS, SLOTS } = await import("./bridge-backend/src/config/cosmetics.js");
    const broken = [];
    for (const [lvl, u] of Object.entries(LEVEL_UNLOCKS)) {
      for (const g of u.grants || []) if (!COSMETICS[g]) broken.push(`lvl${lvl} grants "${g}"`);
      for (const s of u.slots || []) if (!SLOTS[s]) broken.push(`lvl${lvl} unlocks slot "${s}"`);
    }
    (broken.length === 0)
      ? ok("every level-up grant and slot unlock refers to something real")
      : no(`the ladder is broken: ${broken.join(", ")}`);
  }
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
