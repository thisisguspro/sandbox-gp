// ============================================================
// Cosmetics + progression catalogue (v0.1).
// All cosmetics, the equip-slot definitions, the XP curve, and the level-unlock
// ladder live here as DATA so they're easy to tweak without touching logic.
//
// Design rules baked in:
//  - Every player ALWAYS has a weapon (default multitool) and a bandana — these
//    slots can't be emptied, only reskinned.
//  - The bandana's *style* is a cosmetic, but its *color* is force-assigned per
//    match for identification (handled at match time, not here).
//  - Equipping a cosmetic requires (a) owning it and (b) its SLOT being unlocked
//    by level. Owning and equipping are separate.
// ============================================================

// ---- Equip slots ----
// alwaysFilled: slot can never be empty (has a default item).
// unlockLevel: the account level at which the slot becomes equippable.
export const SLOTS = {
  // Always-visible identity pieces — these carry the forced per-match ID color.
  breather:   { key: "breather",   label: "Snorkel",     alwaysFilled: true,  unlockLevel: 1,  default: "breather_standard", carriesIdColor: true },
  oxygenTank: { key: "oxygenTank", label: "Floaty",      alwaysFilled: true,  unlockLevel: 1,  default: "tank_standard",     carriesIdColor: true },
  weapon:     { key: "weapon",     label: "Beach Gear",         alwaysFilled: true,  unlockLevel: 1,  default: "tool_multitool" }, // NEVER carries idColor — kept neutral so prestige skins (e.g. golden event weapons) stay purely cosmetic, not an identity tell
  bandana:    { key: "bandana",    label: "Scarf",      alwaysFilled: false, unlockLevel: 2 }, // now a pure cosmetic, not an identifier
  headpiece:  { key: "headpiece",  label: "Headwear",    alwaysFilled: false, unlockLevel: 2 },
  body:       { key: "body",       label: "Racing Suit",      alwaysFilled: false, unlockLevel: 1 },
  shoes:      { key: "shoes",      label: "Wheels",        alwaysFilled: false, unlockLevel: 5 },
  belt:       { key: "belt",       label: "Tow Rope",         alwaysFilled: false, unlockLevel: 6 },
  border:     { key: "border",     label: "Frame", alwaysFilled: false, unlockLevel: 7 },
  victoryPose:{ key: "victoryPose",label: "Victory Pose", alwaysFilled: false, unlockLevel: 8 },
  emote:      { key: "emote",      label: "Emote",        alwaysFilled: false, unlockLevel: 9 },
  // World backdrop shown behind the train during a match (the LOCAL player's pick).
  // alwaysFilled so there's always a scene to render; never carries the ID color.
  background: { key: "background", label: "Vista",        alwaysFilled: true,  unlockLevel: 1,  default: "bg_badlands" },
};

// A full-body `body` costume is drawn as one sprite that visually covers these
// overlay slots, so while a costume is equipped the client hides them and the
// backend refuses to equip into them (the held weapon, the wheel/shoes, and the
// face MASK/breather remain visible — every costume leaves the robot face
// exposed, so a mask still fits over the top). Shared by the client render
// (IsoPilot) and Locker UI as well.
export const COVERED_BY_BODY_SLOTS = ["headpiece", "bandana", "belt", "oxygenTank"];

// ---- Cosmetic catalogue ----
// Each item: id, slot, name, rarity, and a source hint (starter/level/box).
// Rarity mirrors the loot-box tiers in store.js.
export const COSMETICS = {
  // Breathers — ALWAYS visible; the mouth/nose piece that carries the ID color.
  breather_standard: { id: "breather_standard", slot: "breather", name: "Beach Snorkel", rarity: "Common", source: "starter" },
  breather_snout:    { id: "breather_snout",    slot: "breather", name: "Dolphin Snorkel",  rarity: "Rare",   source: "box" },
  breather_fanged:   { id: "breather_fanged",   slot: "breather", name: "Shark Snorkel",       rarity: "Epic",   source: "box" },

  // O2 tanks — ALWAYS visible; the backpack tank that also carries the ID color.
  tank_standard:  { id: "tank_standard",  slot: "oxygenTank", name: "Duck Floaty", rarity: "Common", source: "starter" },
  tank_finned:    { id: "tank_finned",    slot: "oxygenTank", name: "Shark-Fin Floaty",      rarity: "Rare",   source: "box" },
  tank_canister:  { id: "tank_canister",  slot: "oxygenTank", name: "Twin Ring Floaty",    rarity: "Epic",   source: "box" },

  // Bandanas — now an OPTIONAL cosmetic (no longer the identifier).
  bandana_standard: { id: "bandana_standard", slot: "bandana", name: "Surf Scarf", rarity: "Common", source: "level" },
  bandana_knot:     { id: "bandana_knot",     slot: "bandana", name: "Knotted Scarf",  rarity: "Rare",   source: "box" },
  bandana_tactical: { id: "bandana_tactical", slot: "bandana", name: "Racer's Wrap",     rarity: "Epic",   source: "box" },

  // Loyalty-exclusive cosmetics — ONLY obtainable by claiming Frontier Loyalty
  // milestones (source: "loyalty"). Never sold in any store or dropped by boxes.
  // LOYALTY = MYTHIC. These are the only Mythic items in the game and the only
  // ones that can never be bought, crafted, or dropped — you can only be given
  // them for showing up. So they don't just LOOK rare, they behave differently:
  // they glow, they pulse, they trail. `fx` drives the renderer.
  bandana_trailblazer: { id: "bandana_trailblazer", slot: "bandana",   name: "Aurora Sash",         rarity: "Mythic", source: "loyalty",
    fx: { glow: 0xff5fa2, pulse: 1.4, trail: "ribbon", intensity: 1.0 } },
  head_marshal:        { id: "head_marshal",        slot: "headpiece", name: "Crown of the Tides",  rarity: "Mythic", source: "loyalty",
    fx: { glow: 0x2fe6c8, pulse: 0.9, halo: true, sparkle: true, intensity: 1.2 } },
  body_goldplate:      { id: "body_goldplate",      slot: "body",      name: "Molten Sun Regalia",  rarity: "Mythic", source: "loyalty",
    fx: { glow: 0xffb020, pulse: 1.1, flames: true, intensity: 1.4 } },
  shoes_goldspur:      { id: "shoes_goldspur",      slot: "shoes",     name: "Comet Treads",        rarity: "Mythic", source: "loyalty",
    fx: { glow: 0x7fd8ff, pulse: 2.2, trail: "comet", sparks: true, intensity: 1.3 } },

  // Weapons (the always-present tool, reskinned)
  tool_multitool: { id: "tool_multitool", slot: "weapon", name: "Beach Shovel", rarity: "Common", source: "starter" },
  tool_wrench:    { id: "tool_wrench",    slot: "weapon", name: "Sand Rake",       rarity: "Common", source: "level" },
  tool_drill:     { id: "tool_drill",     slot: "weapon", name: "Super Soaker",       rarity: "Rare",   source: "box" },
  tool_chicken:   { id: "tool_chicken",   slot: "weapon", name: "Rubber Flamingo",     rarity: "Epic",   source: "box" },

  // Headpieces
  head_cap:     { id: "head_cap",     slot: "headpiece", name: "Straw Sunhat",    rarity: "Common", source: "level" },
  head_visor:   { id: "head_visor",   slot: "headpiece", name: "Neon Shades",    rarity: "Rare",   source: "box" },
  head_halo:    { id: "head_halo",    slot: "headpiece", name: "Sun Halo",   rarity: "Legendary", source: "box" },

  // Bodies / costumes
  body_jumpsuit: { id: "body_jumpsuit", slot: "body", name: "Lifeguard Suit",   rarity: "Common", source: "starter" },
  body_mecha:    { id: "body_mecha",    slot: "body", name: "Mecha Racer Suit",     rarity: "Epic",   source: "starter" },
  body_ronin:    { id: "body_ronin",    slot: "body", name: "Ronin Drifter Suit", rarity: "Legendary", source: "starter" },

  // Shoes
  shoes_boots:  { id: "shoes_boots",  slot: "shoes", name: "Sandal Wheels",    rarity: "Common", source: "level" },
  shoes_glow:   { id: "shoes_glow",   slot: "shoes", name: "Neon Rims", rarity: "Epic",  source: "box" },

  // Belts
  belt_utility: { id: "belt_utility", slot: "belt", name: "Tow Rope", rarity: "Common", source: "level" },

  // Borders
  border_bronze: { id: "border_bronze", slot: "border", name: "Bronze Frame", rarity: "Common", source: "level" },
  border_aurora: { id: "border_aurora", slot: "border", name: "Sunset Frame", rarity: "Epic",   source: "box" },

  // Victory poses
  pose_salute:  { id: "pose_salute",  slot: "victoryPose", name: "Crisp Salute",  rarity: "Common", source: "level" },
  pose_backflip:{ id: "pose_backflip",slot: "victoryPose", name: "Sunset Backflip", rarity: "Rare", source: "box" },

  // Emotes
  emote_wave:   { id: "emote_wave",   slot: "emote", name: "Wave",       rarity: "Common", source: "level" },
  emote_dance:  { id: "emote_dance",  slot: "emote", name: "Victory Jig", rarity: "Rare",   source: "box" },

  // ---- Store expansion (anime-themed shop items, sold directly in the Shop) ----
  // Breathers
  breather_koi:     { id: "breather_koi",     slot: "breather",   name: "Pufferfish Snorkel",      rarity: "Rare",      source: "box" },
  breather_kitsune: { id: "breather_kitsune", slot: "breather",   name: "Turtle Snorkel",    rarity: "Epic",      source: "box" },
  breather_oni:     { id: "breather_oni",     slot: "breather",   name: "Kraken Snorkel",      rarity: "Legendary", source: "box" },
  // O2 tanks
  tank_jet:         { id: "tank_jet",         slot: "oxygenTank", name: "Beachball Floaty",  rarity: "Rare",      source: "box" },
  tank_sakura:      { id: "tank_sakura",      slot: "oxygenTank", name: "Hibiscus Floaty",     rarity: "Epic",      source: "box" },
  tank_dragon:      { id: "tank_dragon",      slot: "oxygenTank", name: "Thunder Wave Floaty",     rarity: "Legendary", source: "box" },
  // Weapons
  tool_bokken:      { id: "tool_bokken",      slot: "weapon",     name: "Foam Noodle", rarity: "Common",    source: "box" },
  tool_fan:         { id: "tool_fan",         slot: "weapon",     name: "Paper Parasol",         rarity: "Rare",      source: "box" },
  tool_katana:      { id: "tool_katana",      slot: "weapon",     name: "Surfboard",   rarity: "Epic",      source: "box" },
  tool_naginata:    { id: "tool_naginata",    slot: "weapon",     name: "Lifeguard Buoy",   rarity: "Legendary", source: "box" },
  // Bandanas
  bandana_hachimaki:{ id: "bandana_hachimaki",slot: "bandana",    name: "Sea Breeze Wrap",       rarity: "Common",    source: "box" },
  bandana_flame:    { id: "bandana_flame",    slot: "bandana",    name: "Sunset Wrap",      rarity: "Rare",      source: "box" },
  bandana_storm:    { id: "bandana_storm",    slot: "bandana",    name: "Riptide Scarf",     rarity: "Epic",      source: "box" },
  // Headpieces
  head_goggles:     { id: "head_goggles",     slot: "headpiece",  name: "Swim Goggles",   rarity: "Common",    source: "box" },
  head_foxears:     { id: "head_foxears",     slot: "headpiece",  name: "Cat-Ear Helmet",        rarity: "Rare",      source: "box" },
  head_kabuto:      { id: "head_kabuto",      slot: "headpiece",  name: "Racing Helmet",     rarity: "Epic",      source: "box" },
  head_crown:       { id: "head_crown",       slot: "headpiece",  name: "Sandcastle Crown",    rarity: "Legendary", source: "box" },
  // Bodies
  body_pilotsuit:   { id: "body_pilotsuit",   slot: "body",       name: "Speedster Suit",  rarity: "Rare",      source: "box" },
  body_kimono:      { id: "body_kimono",      slot: "body",       name: "Star Visor",     rarity: "Epic",      source: "box" },
  body_samurai:     { id: "body_samurai",     slot: "body",       name: "Champion's Kit",    rarity: "Legendary", source: "box" },
  // Shoes
  shoes_geta:       { id: "shoes_geta",       slot: "shoes",      name: "Turbo Rims",     rarity: "Rare",      source: "box" },
  shoes_hover:      { id: "shoes_hover",      slot: "shoes",      name: "Chrome Rims",    rarity: "Epic",      source: "box" },
  // Belts
  belt_holster:     { id: "belt_holster",     slot: "belt",       name: "Twin Water Pistols",    rarity: "Common",    source: "box" },
  belt_obi:         { id: "belt_obi",         slot: "belt",       name: "Champion's Sash",      rarity: "Rare",      source: "box" },
  // Borders
  border_neon:      { id: "border_neon",      slot: "border",     name: "Circuit Rims",    rarity: "Rare",      source: "box" },
  border_celestial: { id: "border_celestial", slot: "border",     name: "Seashell Frame",  rarity: "Legendary", source: "box" },
  // Victory poses
  pose_meditate:    { id: "pose_meditate",    slot: "victoryPose",name: "Beach Bow",       rarity: "Rare",      source: "box" },
  pose_victory:     { id: "pose_victory",     slot: "victoryPose",name: "Champion Landing",    rarity: "Epic",      source: "box" },
  // Emotes
  emote_bow:        { id: "emote_bow",        slot: "emote",      name: "Tip the Sunhat",     rarity: "Common",    source: "box" },
  emote_peace:      { id: "emote_peace",      slot: "emote",      name: "Peace Sign",      rarity: "Rare",      source: "box" },

  // Backgrounds — the world vista behind the train in a match. Default is owned by
  // everyone; the rest are sold in the Shop (credits / cash).
  bg_badlands:      { id: "bg_badlands",      slot: "background", name: "Sunny Shores",   rarity: "Common",    source: "starter" },
  bg_snowpass:      { id: "bg_snowpass",      slot: "background", name: "Coral Reef",  rarity: "Rare",      source: "box" },
  bg_pineforest:    { id: "bg_pineforest",    slot: "background", name: "Palm Cove",  rarity: "Rare",      source: "box" },

  // ==========================================================================
  // THE BIG DROP — 30 loot-box items (craftable / scrappable with Sea Glass)
  // and 20 Sand Dollar items (premium; never craftable, never scrappable).
  //
  // Every id below has a matching mesh in carMesh.js's shape registry, with an
  // anchor checked against the driver's actual anatomy. Nothing here renders as
  // a generic cone.
  // ==========================================================================

  // ---- LOOT BOX · headwear (7) ----
  head_bucket:      { id: "head_bucket",      slot: "headpiece", name: "Bucket Hat",        rarity: "Common",    source: "box" },
  head_headband:    { id: "head_headband",    slot: "headpiece", name: "Sweatband",         rarity: "Common",    source: "box" },
  head_shades:      { id: "head_shades",      slot: "headpiece", name: "Beach Shades",      rarity: "Common",    source: "box" },
  head_catears:     { id: "head_catears",     slot: "headpiece", name: "Cat-Ear Helmet",    rarity: "Rare",      source: "box" },
  head_bunnyears:   { id: "head_bunnyears",   slot: "headpiece", name: "Bunny Ears",        rarity: "Rare",      source: "box" },
  head_mohawk:      { id: "head_mohawk",      slot: "headpiece", name: "Surf Mohawk",       rarity: "Rare",      source: "box" },
  head_pineapple:   { id: "head_pineapple",   slot: "headpiece", name: "Pineapple Head",    rarity: "Epic",      source: "box" },

  // ---- LOOT BOX · snorkels (4) ----
  breather_puffer:  { id: "breather_puffer",  slot: "breather",  name: "Pufferfish Snorkel", rarity: "Common",   source: "box" },
  breather_turtle:  { id: "breather_turtle",  slot: "breather",  name: "Turtle Snorkel",     rarity: "Common",   source: "box" },
  breather_scuba:   { id: "breather_scuba",   slot: "breather",  name: "Scuba Mask",         rarity: "Rare",     source: "box" },
  breather_kraken:  { id: "breather_kraken",  slot: "breather",  name: "Kraken Snorkel",     rarity: "Epic",     source: "box" },

  // ---- LOOT BOX · scarves (4) ----
  bandana_towel:    { id: "bandana_towel",    slot: "bandana",   name: "Beach Towel",       rarity: "Common",    source: "box" },
  bandana_lei:      { id: "bandana_lei",      slot: "bandana",   name: "Flower Lei",        rarity: "Common",    source: "box" },
  bandana_boa:      { id: "bandana_boa",      slot: "bandana",   name: "Feather Boa",       rarity: "Rare",      source: "box" },
  bandana_medal:    { id: "bandana_medal",    slot: "bandana",   name: "Podium Medal",      rarity: "Epic",      source: "box" },

  // ---- LOOT BOX · floaties (5) — the oxygenTank slot finally has items ----
  tank_beachball:   { id: "tank_beachball",   slot: "oxygenTank", name: "Beachball Floaty",  rarity: "Common",   source: "box" },
  tank_hibiscus:    { id: "tank_hibiscus",    slot: "oxygenTank", name: "Hibiscus Floaty",   rarity: "Common",   source: "box" },
  tank_donut:       { id: "tank_donut",       slot: "oxygenTank", name: "Sprinkle Donut",    rarity: "Rare",     source: "box" },
  tank_swan:        { id: "tank_swan",        slot: "oxygenTank", name: "Swan Floaty",       rarity: "Rare",     source: "box" },
  tank_shark:       { id: "tank_shark",       slot: "oxygenTank", name: "Shark Floaty",      rarity: "Epic",     source: "box" },

  // ---- LOOT BOX · beach gear (6) ----
  tool_noodle:      { id: "tool_noodle",      slot: "weapon",    name: "Foam Noodle",       rarity: "Common",    source: "box" },
  tool_parasol:     { id: "tool_parasol",     slot: "weapon",    name: "Paper Parasol",     rarity: "Common",    source: "box" },
  tool_cooler:      { id: "tool_cooler",      slot: "weapon",    name: "Cooler Box",        rarity: "Rare",      source: "box" },
  tool_surfboard:   { id: "tool_surfboard",   slot: "weapon",    name: "Surfboard",         rarity: "Rare",      source: "box" },
  tool_boombox:     { id: "tool_boombox",     slot: "weapon",    name: "Boardwalk Boombox", rarity: "Epic",      source: "box" },
  tool_guitar:      { id: "tool_guitar",      slot: "weapon",    name: "Beach Ukulele",     rarity: "Epic",      source: "box" },

  // ---- LOOT BOX · tow ropes (2) ----
  belt_rope:        { id: "belt_rope",        slot: "belt",      name: "Coiled Rope",       rarity: "Common",    source: "box" },
  belt_hook:        { id: "belt_hook",        slot: "belt",      name: "Gold Hook",         rarity: "Rare",      source: "box" },

  // ---- LOOT BOX · wheels (2) ----
  shoes_sandals:    { id: "shoes_sandals",    slot: "shoes",     name: "Sandal Rims",       rarity: "Common",    source: "box" },
  shoes_flippers:   { id: "shoes_flippers",   slot: "shoes",     name: "Flipper Rims",      rarity: "Rare",      source: "box" },

  // ---- LOOT BOX · extras (3) ----
  // (head_visor and bandana_dust already exist above — a duplicate key here
  //  would have silently OVERWRITTEN them rather than adding anything.)
  head_antenna:     { id: "head_antenna",     slot: "headpiece", name: "Bobble Antenna",    rarity: "Common",    source: "box" },
  head_lifeguard:   { id: "head_lifeguard",   slot: "headpiece", name: "Lifeguard Cap",     rarity: "Common",    source: "box" },
  head_sunhat:      { id: "head_sunhat",      slot: "headpiece", name: "Straw Sunhat",      rarity: "Common",    source: "box" },

  // ============================ SAND DOLLARS (premium) ======================
  // 20 items you can only buy. Never craftable, never scrappable — paying money
  // for something a rival can melt down would be a bad joke.

  // ---- PREMIUM · headwear (6) ----
  head_captain:     { id: "head_captain",     slot: "headpiece", name: "Captain's Cap",       rarity: "Rare",      source: "premium" },
  head_sharkfin:    { id: "head_sharkfin",    slot: "headpiece", name: "Shark Fin Helm",      rarity: "Epic",      source: "premium" },
  head_flowercrown: { id: "head_flowercrown", slot: "headpiece", name: "Flower Crown",        rarity: "Epic",      source: "premium" },
  head_shellcrown:  { id: "head_shellcrown",  slot: "headpiece", name: "Coral Crown",         rarity: "Legendary", source: "premium" },
  head_helmetwing:  { id: "head_helmetwing",  slot: "headpiece", name: "Winged Helm",         rarity: "Legendary", source: "premium" },
  head_horns:       { id: "head_horns",       slot: "headpiece", name: "Reef Horns",          rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · snorkels (2) ----
  breather_bubble:  { id: "breather_bubble",  slot: "breather",  name: "Bubble Helm",         rarity: "Epic",      source: "premium" },
  breather_abyss:   { id: "breather_abyss",   slot: "breather",  name: "Abyss Rebreather",    rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · scarves (2) ----
  bandana_aurora:   { id: "bandana_aurora",   slot: "bandana",   name: "Aurora Silk",         rarity: "Epic",      source: "premium" },
  bandana_champion: { id: "bandana_champion", slot: "bandana",   name: "Champion's Sash",     rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · floaties (3) ----
  tank_twin:        { id: "tank_twin",        slot: "oxygenTank", name: "Twin Ring Floaty",   rarity: "Rare",      source: "premium" },
  tank_thunder:     { id: "tank_thunder",     slot: "oxygenTank", name: "Thunder Wave Floaty", rarity: "Epic",     source: "premium" },
  tank_flamingo:    { id: "tank_flamingo",    slot: "oxygenTank", name: "Flamingo Floaty",    rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · beach gear (4) ----
  tool_pistols:     { id: "tool_pistols",     slot: "weapon",    name: "Twin Water Pistols",  rarity: "Rare",      source: "premium" },
  tool_kite:        { id: "tool_kite",        slot: "weapon",    name: "Stunt Kite",          rarity: "Epic",      source: "premium" },
  tool_buoy:        { id: "tool_buoy",        slot: "weapon",    name: "Lifeguard Buoy",      rarity: "Epic",      source: "premium" },
  tool_trident:     { id: "tool_trident",     slot: "weapon",    name: "Golden Trident",      rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · tow ropes (2) ----
  belt_chain:       { id: "belt_chain",       slot: "belt",      name: "Chrome Chain",        rarity: "Rare",      source: "premium" },
  belt_anchor:      { id: "belt_anchor",      slot: "belt",      name: "Anchor Rig",          rarity: "Legendary", source: "premium" },

  // ---- PREMIUM · wheels (1) ----
  shoes_cleats:     { id: "shoes_cleats",     slot: "shoes",     name: "Racing Slicks",       rarity: "Legendary", source: "premium" },
};

// ---- XP / level curve ----
// Total XP needed to REACH a level n is xpForLevel(n). Gentle early curve so the
// tutorial unlocks come quickly, then a steady climb.
export function xpForLevel(level) {
  if (level <= 1) return 0;
  // 100, 250, 450, 700, 1000, ... (quadratic-ish, rounded to 50s)
  return Math.round((50 * (level - 1) * level) / 1) ; // 50*n*(n-1): 1->0,2->100,3->300,4->600...
}
export function levelForXp(xp) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

// ---- Unlock ladder ----
// What each level grants. Early levels are a guided tutorial: a sample cosmetic,
// then slots open one at a time, with a perk unlock woven in. "approve/tweak"
// territory — change freely.
// ---- SEA GLASS: the crafting economy -----------------------------------------
// Scrap a cosmetic you don't want → SEA GLASS shards. Spend shards to CRAFT the
// one you do want. Sea glass is literally broken things worn smooth and made
// valuable, which is exactly what scrapping is.
//
// THE RULE, and it is not negotiable: you can only scrap and craft LOOT BOX
// items. Anything earned through progression (level unlocks, loyalty rewards,
// starter kit) is off-limits — those are a record of what you did, and letting
// people mint them with currency would make them worthless. Nothing bought with
// real money is craftable either.
export const CRAFTABLE_SOURCES = ["box"];              // and ONLY box
export function isCraftable(item) {
  return !!item && CRAFTABLE_SOURCES.includes(item.source);
}

// Craft cost by rarity, and the scrap return. The return is deliberately a
// FRACTION of the cost (~30%): scrapping is a way to redirect duplicates you'll
// never use, not an arbitrage loop. Four junk commons should not buy a legendary.
export const CRAFT_COST = {
  Common: 40,
  Rare: 120,
  Epic: 320,
  Legendary: 900,
};
export const SCRAP_RETURN_PCT = 0.30;
export function scrapValue(item) {
  if (!isCraftable(item)) return 0;
  return Math.max(1, Math.round((CRAFT_COST[item.rarity] || 40) * SCRAP_RETURN_PCT));
}

// ---- RACING PERKS (goal #15) ----
// The creed holds: every kart is IDENTICAL. Perks touch item luck, hoop
// windows, economy, and information — never speed, accel, or grip. Equip 2.
export const RACING_PERKS = {
  LUCKY_SCOOP:     { name: "Lucky Scoop",     glyph: "🍀", unlockLevel: 2,  desc: "Hoop runs count one extra ring toward your tier." },
  LONG_SUMMER:     { name: "Long Summer",     glyph: "⏳", unlockLevel: 4,  desc: "Hoop-run window lasts 18 seconds instead of 15." },
  MAGNET_MITTS:    { name: "Magnet Mitts",    glyph: "🧲", unlockLevel: 6,  desc: "Hoops are 45% easier to snag." },
  BUCKET_BOY:      { name: "Bucket Boy",      glyph: "🪣", unlockLevel: 8,  desc: "Start every race holding a Bucket Shield charge." },
  SECOND_SCOOP:    { name: "Second Scoop",    glyph: "🥄", unlockLevel: 10, desc: "Reform from a wipeout holding a bronze item." },
  TIDE_READER:     { name: "Tide Reader",     glyph: "🌊", unlockLevel: 12, desc: "Incoming-danger warnings reach 50% farther." },
  BEACH_ECONOMIST: { name: "Beach Economist", glyph: "🐚", unlockLevel: 14, desc: "Race payouts drop 25% more sea glass." },
  ENCORE:          { name: "Encore",          glyph: "🎭", unlockLevel: 16, desc: "Your first dud kite each race re-rolls itself." },
};
export const MAX_EQUIPPED_PERKS = 2;

export const LEVEL_UNLOCKS = {
  1:  { slots: ["breather", "oxygenTank", "weapon", "body", "background"], grants: ["breather_standard", "tank_standard", "tool_multitool", "body_jumpsuit", "body_mecha", "body_ronin", "bg_badlands"], note: "Starter kit — your snorkel, floaty, beach gear, and first kart looks." },
  2:  { slots: ["bandana", "headpiece"], grants: ["bandana_standard", "head_cap"], note: "Bandana + headwear slots unlocked." },
  3:  { note: "Level 3 — keep racing!" },
  4:  { grants: ["tank_finned"], note: "A new floaty style." },
  5:  { slots: ["shoes"], grants: ["shoes_boots"], perks: ["LUCKY_SCOOP"], note: "Wheel style slot + your first perk." },
  6:  { slots: ["belt"], grants: ["belt_utility"], note: "Tow-rope slot unlocked." },
  7:  { slots: ["border"], grants: ["border_bronze"], note: "Profile frame slot unlocked." },
  8:  { slots: ["victoryPose"], grants: ["pose_salute"], perks: ["BUCKET_BOY"], note: "Victory pose slot + another perk." },
  9:  { slots: ["emote"], grants: ["emote_wave"], note: "Emote slot unlocked." },
  10: { grants: ["tool_wrench"], perks: ["SECOND_SCOOP", "LONG_SUMMER"], note: "A new tool skin + more perks." },
  12: { perks: ["TIDE_READER"], note: "Perk unlocked." },
  15: { perks: ["MAGNET_MITTS"], note: "Impostor-side perks unlocked." },
  18: { perks: ["BEACH_ECONOMIST"], note: "Impostor perk unlocked." },
  20: { perks: ["ENCORE"], note: "Comms-mastery perk unlocked." },
  22: { note: "Level 22 — legend territory." },
};

// Convenience: everything unlocked at or below a level.
export function unlockedAt(level) {
  const slots = new Set();
  const perks = new Set();
  const grants = new Set();
  for (const [lvlStr, u] of Object.entries(LEVEL_UNLOCKS)) {
    if (Number(lvlStr) > level) continue;
    (u.slots || []).forEach((s) => slots.add(s));
    (u.perks || []).forEach((p) => perks.add(p));
    (u.grants || []).forEach((g) => grants.add(g));
  }
  return { slots: [...slots], perks: [...perks], grants: [...grants] };
}

// Default loadout for a brand-new account.
export function defaultLoadout() {
  return { breather: "breather_standard", oxygenTank: "tank_standard", weapon: "tool_multitool", body: "body_jumpsuit", background: "bg_badlands" };
}
