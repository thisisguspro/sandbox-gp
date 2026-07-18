// ============================================================================
// SANDBOX GP — THE COSMETIC WARDROBE
// ============================================================================
//
// This was the DIVING GAME's wardrobe with beach names painted over it. The slot
// keys were `oxygenTank`, `breather`, `weapon` and `bandana`; there was a
// `background` slot for a "vista behind the train" that nothing has ever
// rendered; and there was a `victoryPose` slot that no code anywhere reads.
//
// Worse: 118 items and NOT ONE SET. A bag of loose accessories — "Ronin Drifter
// Suit" beside "Kraken Snorkel" beside "Molten Sun Regalia" — with no story a
// player could tell about themselves.
//
// ---- WHAT THE RESEARCH SAYS ----
//
// Players don't buy hats. They buy an IDENTITY, and they buy it as a SET:
//
//   "Skins let players craft their in-game persona. Whether you go for sleek and
//    stylish, goofy and chaotic, or dark and intimidating, your choices tell a
//    story."
//
//   "The clever packaging of SETS of items appeals to players, making them want
//    to purchase the skin for their character AS WELL AS the accessories."
//
// The counter-example is Hypixel's Turbo Kart Racers, where parts are named
// "<adjective> <rarity> <part>". That names the STAT, not the fantasy — and
// nobody has ever wanted to be a "Superior Rare Turbocharger".
//
// So: every cosmetic here belongs to a THEMED SET with a persona you'd actually
// want to be. Wear the whole set and you ARE that character. Mix and match and
// you're expressing taste. Both are fun; both are things people pay for.
//
// ---- THE SETS ----
//
//   LIFEGUARD     the one who saves everyone. Red, white, whistle, rescue buoy.
//   SURF PUNK     salt-crusted, sun-bleached, doesn't care. Board, wetsuit, wax.
//   TIKI KING     carved masks, torches, hibiscus. Loud, warm, ceremonial.
//   NEON ARCADE   80s boardwalk. Chrome, hot pink, laser grids, cassette.
//   MECHA PILOT   the anime one. Panel lines, a visor, thruster fins, a scarf.
//   CORAL COURT   deep-sea royalty. Pearl, nacre, coral crowns, a trident.
//   SANDCASTLE    the goofy one. Buckets, spades, a moat, a paper crown.
//   STORM CHASER  a monsoon in kart form. Dark clouds, static, a lightning rod.
//   GOLDEN HOUR   the prestige set. Sunset gold, long shadows, warm light.
//
// Sets are visible in the store and the locker, so completing one is a goal you
// can SEE. That is the entire monetisation loop, and it is the loop the research
// says works.
// ============================================================================

// ---- Equip slots ----
// alwaysFilled: slot can never be empty (has a default item).
// unlockLevel: the account level at which the slot becomes equippable.
export const SLOTS = {
  // ---- ALWAYS-VISIBLE IDENTITY ----
  // These carry the forced per-match ID colour, so you can always tell racers
  // apart at a glance no matter what they're wearing.
  //
  // `breather` and `oxygenTank` are the DIVING GAME's slot keys. They're kept as
  // the internal keys because they're baked into every saved loadout, every
  // cosmetic row and ~70 call sites — renaming them would mean migrating live
  // player wardrobes for zero visible benefit. The LABEL is what anyone sees.
  breather: {
    key: "breather", label: "Shades", alwaysFilled: true, unlockLevel: 1,
    default: "breather_standard", carriesIdColor: true,
  },
  oxygenTank: {
    key: "oxygenTank", label: "Float", alwaysFilled: true, unlockLevel: 1,
    default: "tank_standard", carriesIdColor: true,
  },

  // ---- THE KART ----
  body: { key: "body", label: "Kart Shell", alwaysFilled: false, unlockLevel: 1 },
  shoes: { key: "shoes", label: "Wheels", alwaysFilled: false, unlockLevel: 4 },

  // ---- THE DRIVER ----
  headpiece: { key: "headpiece", label: "Headgear", alwaysFilled: false, unlockLevel: 2 },
  bandana: { key: "bandana", label: "Scarf", alwaysFilled: false, unlockLevel: 2 },

  // ---- WHAT YOU'RE CARRYING ----
  // NEVER carries idColor — kept neutral so a prestige item stays purely
  // cosmetic and not an identity tell.
  weapon: { key: "weapon", label: "Gear", alwaysFilled: true, unlockLevel: 1, default: "tool_multitool" },
  belt: { key: "belt", label: "Trailer", alwaysFilled: false, unlockLevel: 6 },

  // ---- THE PENNANT ----
  // The flag streaming off the back of your kart. It is the most-SEEN cosmetic in
  // the game by a mile: it's what every rival stares at for the entire race, and
  // it's what shows up in every screenshot. An obvious thing to sell, and it was
  // never a slot.
  flag: { key: "flag", label: "Flag", alwaysFilled: false, unlockLevel: 3 },

  // ---- EXPRESSION ----
  emote: { key: "emote", label: "Emote", alwaysFilled: false, unlockLevel: 9 },

  // REMOVED:
  //
  //   background   — a "vista behind the train". Nothing has ever rendered it.
  //                  It was a slot in a menu that did nothing at all.
  //   victoryPose  — no code anywhere reads it. Not the engine, not the podium,
  //                  not the client. A dead slot with four dead items in it.
  //   border       — profile frames are an ACHIEVEMENT reward now (see
  //                  achievements.js), not a purchasable cosmetic. Having them in
  //                  two systems meant neither felt like it mattered.
};

// ---- THE SETS ----
// Every wearable belongs to one. A set is a PERSONA, and completing it is a goal
// the player can see.
export const SETS = {
  lifeguard: {
    id: "lifeguard", name: "Lifeguard",
    blurb: "First on the sand, last off it. The one who saves everybody.",
    color: "#e2574c",
  },
  surfpunk: {
    id: "surfpunk", name: "Surf Punk",
    blurb: "Salt-crusted, sun-bleached, and gloriously unbothered.",
    color: "#2fa8d8",
  },
  tiki: {
    id: "tiki", name: "Tiki King",
    blurb: "Carved masks, burning torches, and a very loud shirt.",
    color: "#ff8c42",
  },
  neon: {
    id: "neon", name: "Neon Arcade",
    blurb: "Boardwalk at midnight. Chrome, hot pink, and a cassette deck.",
    color: "#ff5fa2",
  },
  mecha: {
    id: "mecha", name: "Mecha Pilot",
    blurb: "Panel lines, a mirrored visor, and thrusters you don't strictly need.",
    color: "#9aa3ad",
  },
  coral: {
    id: "coral", name: "Coral Court",
    blurb: "Deep-sea royalty. Pearl, nacre, and a crown of living coral.",
    color: "#ff5fa2",
  },
  sandcastle: {
    id: "sandcastle", name: "Sandcastle",
    blurb: "A bucket, a spade, and a paper crown. Utterly unserious.",
    color: "#e8c98c",
  },
  storm: {
    id: "storm", name: "Storm Chaser",
    blurb: "A monsoon in kart form. Static in the air, and a lightning rod.",
    color: "#4a5763",
  },
  golden: {
    id: "golden", name: "Golden Hour",
    blurb: "The last hour of light, and the longest shadows on the beach.",
    color: "#f5a623",
  },
};

export const COSMETICS = {
  // ==========================================================================
  // Every wearable belongs to a SET — a persona you'd actually want to be.
  //
  // The old catalogue had 118 items and ZERO sets: a bag of loose accessories
  // with FIFTEEN DUPLICATE NAMES ("Kraken Snorkel" twice, "Surfboard" twice,
  // "Cat-Ear Helmet" twice) — because it was the samurai game's item list with
  // beach names painted over it. The IDs still say `breather_oni`,
  // `breather_kitsune`, `tool_katana`, `belt_obi`.
  //
  // The IDs are kept (they're in every saved wardrobe) but every item is now
  // named, themed and SET so it means something.
  // ==========================================================================

  // ---- SHADES (the always-visible face piece; carries your ID colour) -------
  breather_standard: { id: "breather_standard", slot: "breather", set: "lifeguard",  name: "Guard Shades",        rarity: "Common",    source: "starter" },
  breather_puffer:   { id: "breather_puffer",   slot: "breather", set: "sandcastle", name: "Jelly Goggles",       rarity: "Common",    source: "box" },
  breather_turtle:   { id: "breather_turtle",   slot: "breather", set: "surfpunk",   name: "Salt-Crust Goggles",  rarity: "Common",    source: "box" },
  breather_snout:    { id: "breather_snout",    slot: "breather", set: "surfpunk",   name: "Reef Snorkel",        rarity: "Rare",      source: "box" },
  breather_koi:      { id: "breather_koi",      slot: "breather", set: "tiki",       name: "Hibiscus Visor",      rarity: "Rare",      source: "box" },
  breather_scuba:    { id: "breather_scuba",    slot: "breather", set: "mecha",      name: "Pilot's Visor",       rarity: "Rare",      source: "box" },
  breather_fanged:   { id: "breather_fanged",   slot: "breather", set: "storm",      name: "Stormbreaker Mask",   rarity: "Epic",      source: "box" },
  breather_kitsune:  { id: "breather_kitsune",  slot: "breather", set: "neon",       name: "Laser Shades",        rarity: "Epic",      source: "box" },
  breather_bubble:   { id: "breather_bubble",   slot: "breather", set: "coral",      name: "Nacre Bubble",        rarity: "Epic",      source: "box" },
  breather_kraken:   { id: "breather_kraken",   slot: "breather", set: "coral",      name: "Deepwater Rebreather", rarity: "Epic",     source: "box" },
  breather_oni:      { id: "breather_oni",      slot: "breather", set: "storm",      name: "Thunderhead Mask",    rarity: "Legendary", source: "box" },
  breather_abyss:    { id: "breather_abyss",    slot: "breather", set: "golden",      name: "Sunset Aviators",     rarity: "Legendary", source: "box" },

  // ---- FLOATS (the always-visible back piece; carries your ID colour) -------
  tank_standard:  { id: "tank_standard",  slot: "oxygenTank", set: "sandcastle", name: "Rubber Duck Ring",   rarity: "Common",    source: "starter" },
  tank_beachball: { id: "tank_beachball", slot: "oxygenTank", set: "sandcastle", name: "Beach Ball Float",   rarity: "Common",    source: "box" },
  tank_hibiscus:  { id: "tank_hibiscus",  slot: "oxygenTank", set: "tiki",       name: "Hibiscus Wreath",    rarity: "Common",    source: "box" },
  tank_twin:      { id: "tank_twin",      slot: "oxygenTank", set: "lifeguard",  name: "Twin Rescue Rings",  rarity: "Rare",      source: "box" },
  tank_donut:     { id: "tank_donut",     slot: "oxygenTank", set: "neon",       name: "Sprinkle Donut",     rarity: "Rare",      source: "box" },
  tank_swan:      { id: "tank_swan",      slot: "oxygenTank", set: "coral",      name: "Swan Float",         rarity: "Rare",      source: "box" },
  tank_jet:       { id: "tank_jet",       slot: "oxygenTank", set: "mecha",      name: "Thruster Pack",      rarity: "Rare",      source: "box" },
  tank_finned:    { id: "tank_finned",    slot: "oxygenTank", set: "surfpunk",   name: "Shark-Fin Float",    rarity: "Rare",      source: "box" },
  tank_shark:     { id: "tank_shark",     slot: "oxygenTank", set: "surfpunk",   name: "Great White Float",  rarity: "Epic",      source: "premium" },
  tank_sakura:    { id: "tank_sakura",    slot: "oxygenTank", set: "tiki",       name: "Tiki Torch Pack",    rarity: "Epic",      source: "box" },
  tank_canister:  { id: "tank_canister",  slot: "oxygenTank", set: "mecha",      name: "Coolant Canisters",  rarity: "Epic",      source: "box" },
  tank_thunder:   { id: "tank_thunder",   slot: "oxygenTank", set: "storm",      name: "Storm Cell",         rarity: "Epic",      source: "box" },
  tank_dragon:    { id: "tank_dragon",    slot: "oxygenTank", set: "storm",      name: "Lightning Rod",      rarity: "Legendary", source: "box" },
  tank_flamingo:  { id: "tank_flamingo",  slot: "oxygenTank", set: "golden",     name: "Golden Flamingo",    rarity: "Legendary", source: "box" },

  // ---- HEADGEAR ------------------------------------------------------------
  head_lifeguard:   { id: "head_lifeguard",   slot: "headpiece", set: "lifeguard",  name: "Lifeguard Cap",       rarity: "Common",    source: "starter" },
  head_cap:         { id: "head_cap",         slot: "headpiece", set: "lifeguard",  name: "Whistle & Cap",       rarity: "Common",    source: "box" },
  head_sunhat:      { id: "head_sunhat",      slot: "headpiece", set: "tiki",       name: "Straw Sunhat",        rarity: "Common",    source: "box" },
  head_bucket:      { id: "head_bucket",      slot: "headpiece", set: "sandcastle", name: "Bucket Hat",          rarity: "Common",    source: "box" },
  head_headband:    { id: "head_headband",    slot: "headpiece", set: "surfpunk",   name: "Sweatband",           rarity: "Common",    source: "box" },
  head_shades:      { id: "head_shades",      slot: "headpiece", set: "neon",       name: "Boardwalk Shades",    rarity: "Common",    source: "box" },
  head_goggles:     { id: "head_goggles",     slot: "headpiece", set: "mecha",      name: "Flight Goggles",      rarity: "Common",    source: "box" },
  head_antenna:     { id: "head_antenna",     slot: "headpiece", set: "sandcastle", name: "Bobble Antenna",      rarity: "Common",    source: "box" },
  head_visor:       { id: "head_visor",       slot: "headpiece", set: "neon",       name: "Neon Visor",          rarity: "Rare",      source: "premium" },
  head_mohawk:      { id: "head_mohawk",      slot: "headpiece", set: "surfpunk",   name: "Surf Mohawk",         rarity: "Rare",      source: "box" },
  head_catears:     { id: "head_catears",     slot: "headpiece", set: "neon",       name: "Arcade Cat Ears",     rarity: "Rare",      source: "box" },
  head_bunnyears:   { id: "head_bunnyears",   slot: "headpiece", set: "sandcastle", name: "Bunny Ears",          rarity: "Rare",      source: "box" },
  head_captain:     { id: "head_captain",     slot: "headpiece", set: "coral",      name: "Captain's Cap",       rarity: "Rare",      source: "box" },
  head_foxears:     { id: "head_foxears",     slot: "headpiece", set: "tiki",       name: "Tiki Mask",           rarity: "Rare",      source: "box" },
  head_kabuto:      { id: "head_kabuto",      slot: "headpiece", set: "mecha",      name: "Pilot's Helm",        rarity: "Epic",      source: "box" },
  head_sharkfin:    { id: "head_sharkfin",    slot: "headpiece", set: "surfpunk",   name: "Shark Fin Helm",      rarity: "Epic",      source: "box" },
  head_flowercrown: { id: "head_flowercrown", slot: "headpiece", set: "tiki",       name: "Flower Crown",        rarity: "Epic",      source: "premium" },
  head_pineapple:   { id: "head_pineapple",   slot: "headpiece", set: "sandcastle", name: "Pineapple Head",      rarity: "Epic",      source: "premium" },
  head_crown:       { id: "head_crown",       slot: "headpiece", set: "sandcastle", name: "Paper Crown",         rarity: "Legendary", source: "box" },
  head_shellcrown:  { id: "head_shellcrown",  slot: "headpiece", set: "coral",      name: "Coral Crown",         rarity: "Legendary", source: "premium" },
  head_helmetwing:  { id: "head_helmetwing",  slot: "headpiece", set: "mecha",      name: "Winged Helm",         rarity: "Legendary", source: "premium" },
  head_horns:       { id: "head_horns",       slot: "headpiece", set: "storm",      name: "Thunder Horns",       rarity: "Legendary", source: "premium" },
  head_halo:        { id: "head_halo",        slot: "headpiece", set: "golden",     name: "Sun Halo",            rarity: "Legendary", source: "premium" },
  head_marshal:     { id: "head_marshal",     slot: "headpiece", set: "coral",      name: "Crown of the Tides",  rarity: "Mythic",    source: "loyalty" },

  // ---- SCARF ---------------------------------------------------------------
  bandana_standard:    { id: "bandana_standard",    slot: "bandana", set: "surfpunk",   name: "Surf Scarf",       rarity: "Common",    source: "starter" },
  bandana_hachimaki:   { id: "bandana_hachimaki",   slot: "bandana", set: "lifeguard",  name: "Rescue Wrap",      rarity: "Common",    source: "box" },
  bandana_knot:        { id: "bandana_knot",        slot: "bandana", set: "sandcastle", name: "Knotted Scarf",    rarity: "Rare",      source: "box" },
  bandana_flame:       { id: "bandana_flame",       slot: "bandana", set: "golden",     name: "Sunset Wrap",      rarity: "Rare",      source: "box" },
  bandana_wave:        { id: "bandana_wave",        slot: "bandana", set: "coral",      name: "Tidewrap",         rarity: "Rare",      source: "box" },
  bandana_palm:        { id: "bandana_palm",        slot: "bandana", set: "tiki",       name: "Palm Print",       rarity: "Rare",      source: "box" },
  bandana_tactical:    { id: "bandana_tactical",    slot: "bandana", set: "mecha",      name: "Pilot's Scarf",    rarity: "Epic",      source: "box" },
  bandana_neon:        { id: "bandana_neon",        slot: "bandana", set: "neon",       name: "Neon Streamer",    rarity: "Epic",      source: "box" },
  bandana_storm:       { id: "bandana_storm",       slot: "bandana", set: "storm",      name: "Storm Scarf",      rarity: "Epic",      source: "box" },
  bandana_champion:    { id: "bandana_champion",    slot: "bandana", set: "golden",     name: "Champion's Sash",  rarity: "Legendary", source: "box" },
  bandana_kraken:      { id: "bandana_kraken",      slot: "bandana", set: "coral",      name: "Kraken Wrap",      rarity: "Legendary", source: "box" },
  bandana_trailblazer: { id: "bandana_trailblazer", slot: "bandana", set: "golden",     name: "Aurora Sash",      rarity: "Mythic",    source: "loyalty" },

  // ---- GEAR (what you're carrying — never carries the ID colour) ------------
  tool_multitool: { id: "tool_multitool", slot: "weapon", set: "sandcastle", name: "Beach Spade",        rarity: "Common",    source: "starter" },
  tool_wrench:    { id: "tool_wrench",    slot: "weapon", set: "sandcastle", name: "Sand Rake",          rarity: "Common",    source: "box" },
  tool_noodle:    { id: "tool_noodle",    slot: "weapon", set: "sandcastle", name: "Foam Noodle",        rarity: "Common",    source: "box" },
  tool_parasol:   { id: "tool_parasol",   slot: "weapon", set: "tiki",       name: "Paper Parasol",      rarity: "Common",    source: "box" },
  tool_drill:     { id: "tool_drill",     slot: "weapon", set: "neon",       name: "Super Soaker",       rarity: "Rare",      source: "box" },
  tool_pistols:   { id: "tool_pistols",   slot: "weapon", set: "neon",       name: "Twin Water Pistols", rarity: "Rare",      source: "box" },
  tool_surfboard: { id: "tool_surfboard", slot: "weapon", set: "surfpunk",   name: "Surfboard",          rarity: "Rare",      source: "box" },
  tool_buoy:      { id: "tool_buoy",      slot: "weapon", set: "lifeguard",  name: "Rescue Buoy",        rarity: "Rare",      source: "premium" },
  tool_chicken:   { id: "tool_chicken",   slot: "weapon", set: "sandcastle", name: "Rubber Flamingo",    rarity: "Epic",      source: "box" },
  tool_torch:     { id: "tool_torch",     slot: "weapon", set: "tiki",       name: "Tiki Torch",         rarity: "Epic",      source: "box" },
  tool_bokken:    { id: "tool_bokken",    slot: "weapon", set: "surfpunk",   name: "Bodyboard",          rarity: "Epic",      source: "box" },
  tool_fan:       { id: "tool_fan",       slot: "weapon", set: "coral",      name: "Coral Fan",          rarity: "Epic",      source: "box" },
  tool_katana:    { id: "tool_katana",    slot: "weapon", set: "mecha",      name: "Beam Paddle",        rarity: "Legendary", source: "box" },
  tool_naginata:  { id: "tool_naginata",  slot: "weapon", set: "coral",      name: "Trident",            rarity: "Legendary", source: "box" },
  tool_scythe:    { id: "tool_scythe",    slot: "weapon", set: "storm",      name: "Storm Harpoon",      rarity: "Legendary", source: "box" },
  tool_glaive:    { id: "tool_glaive",    slot: "weapon", set: "golden",     name: "Golden Oar",         rarity: "Legendary", source: "box" },
  tool_sunbrella: { id: "tool_sunbrella", slot: "weapon", set: "golden",     name: "Sunbrella",          rarity: "Epic",      source: "box" },
  tool_kite:      { id: "tool_kite",      slot: "weapon", set: "storm",      name: "Storm Kite",         rarity: "Rare",      source: "box" },

  // ---- TRAILER (what you're towing) -----------------------------------------
  belt_rope:      { id: "belt_rope",      slot: "belt", set: "lifeguard",  name: "Tow Rope",         rarity: "Common",    source: "box" },
  belt_coil:      { id: "belt_coil",      slot: "belt", set: "surfpunk",   name: "Coiled Rope",      rarity: "Common",    source: "box" },
  belt_holster:   { id: "belt_holster",   slot: "belt", set: "neon",       name: "Pistol Holster",   rarity: "Rare",      source: "box" },
  belt_hook:      { id: "belt_hook",      slot: "belt", set: "coral",      name: "Gold Hook",        rarity: "Rare",      source: "box" },
  belt_chain:     { id: "belt_chain",     slot: "belt", set: "mecha",      name: "Chrome Chain",     rarity: "Epic",      source: "box" },
  belt_obi:       { id: "belt_obi",       slot: "belt", set: "tiki",       name: "Woven Sash",       rarity: "Epic",      source: "box" },
  belt_cooler:    { id: "belt_cooler",    slot: "belt", set: "golden",     name: "Golden Cooler",    rarity: "Legendary", source: "box" },

  // ---- KART SHELL ----------------------------------------------------------
  body_standard:  { id: "body_standard",  slot: "body", set: "lifeguard",  name: "Lifeguard Racer",  rarity: "Common",    source: "starter" },
  body_speedster: { id: "body_speedster", slot: "body", set: "neon",       name: "Neon Speedster",   rarity: "Rare",      source: "box" },
  body_lifeguard: { id: "body_lifeguard", slot: "body", set: "lifeguard",  name: "Rescue Runner",    rarity: "Rare",      source: "box" },
  body_mecha:     { id: "body_mecha",     slot: "body", set: "mecha",      name: "Mecha Frame",      rarity: "Epic",      source: "box" },
  body_ronin:     { id: "body_ronin",     slot: "body", set: "storm",      name: "Storm Drifter",    rarity: "Epic",      source: "box" },
  body_tiki:      { id: "body_tiki",      slot: "body", set: "tiki",       name: "Tiki Cruiser",     rarity: "Epic",      source: "box" },
  body_regalia:   { id: "body_regalia",   slot: "body", set: "golden",     name: "Golden Hour",      rarity: "Mythic",    source: "loyalty" },

  // ---- WHEELS --------------------------------------------------------------
  shoes_standard: { id: "shoes_standard", slot: "shoes", set: "sandcastle", name: "Sandal Treads",   rarity: "Common",    source: "starter" },
  shoes_sandal:   { id: "shoes_sandal",   slot: "shoes", set: "surfpunk",   name: "Beach Slicks",    rarity: "Common",    source: "box" },
  shoes_neon:     { id: "shoes_neon",     slot: "shoes", set: "neon",       name: "Neon Rims",       rarity: "Rare",      source: "box" },
  shoes_turbo:    { id: "shoes_turbo",    slot: "shoes", set: "mecha",      name: "Turbo Rims",      rarity: "Rare",      source: "box" },
  shoes_chrome:   { id: "shoes_chrome",   slot: "shoes", set: "mecha",      name: "Chrome Rims",     rarity: "Epic",      source: "box" },
  shoes_coral:    { id: "shoes_coral",    slot: "shoes", set: "coral",      name: "Nacre Rims",      rarity: "Epic",      source: "box" },
  shoes_storm:    { id: "shoes_storm",    slot: "shoes", set: "storm",      name: "Stormtreads",     rarity: "Legendary", source: "box" },
  shoes_comet:    { id: "shoes_comet",    slot: "shoes", set: "golden",     name: "Comet Treads",    rarity: "Mythic",    source: "loyalty" },

  // ---- FLAGS ---------------------------------------------------------------
  // One per set, plus two that everybody wants: the chequered flag and the Jolly
  // Roger. The pennant is the thing behind you all race, so these are prime.
  flag_lifeguard:  { id: "flag_lifeguard",  slot: "flag", set: "lifeguard",  name: "Rescue Pennant",    rarity: "Common",    source: "box" },
  flag_surfpunk:   { id: "flag_surfpunk",   slot: "flag", set: "surfpunk",   name: "Surf Flag",         rarity: "Common",    source: "box" },
  flag_sandcastle: { id: "flag_sandcastle", slot: "flag", set: "sandcastle", name: "Sandcastle Banner", rarity: "Common",    source: "box" },
  flag_tiki:       { id: "flag_tiki",       slot: "flag", set: "tiki",       name: "Tiki Banner",       rarity: "Rare",      source: "box" },
  flag_neon:       { id: "flag_neon",       slot: "flag", set: "neon",       name: "Neon Streamer Flag",rarity: "Rare",      source: "box" },
  flag_mecha:      { id: "flag_mecha",      slot: "flag", set: "mecha",      name: "Squadron Colours",  rarity: "Rare",      source: "box" },
  flag_coral:      { id: "flag_coral",      slot: "flag", set: "coral",      name: "Court Standard",    rarity: "Epic",      source: "box" },
  flag_storm:      { id: "flag_storm",      slot: "flag", set: "storm",      name: "Storm Warning",     rarity: "Epic",      source: "box" },
  flag_checker:    { id: "flag_checker",    slot: "flag", set: "golden",     name: "Chequered Flag",    rarity: "Legendary", source: "box" },
  // The Jolly Roger sits in SURF PUNK thematically, but Surf Punk already has its
  // crown jewel (the Great White Float) — and the rule is AT MOST ONE cash-only
  // piece per set, or the collection becomes a hostage. So the pirate flag is a
  // chest item, and the shop keeps its one-per-set discipline.
  flag_pirate:     { id: "flag_pirate",     slot: "flag", set: "surfpunk",   name: "Jolly Roger",       rarity: "Legendary", source: "box" },
  flag_golden:     { id: "flag_golden",     slot: "flag", set: "golden",     name: "Golden Standard",   rarity: "Legendary", source: "box" },

  // ---- EMOTES --------------------------------------------------------------
  emote_wave:    { id: "emote_wave",    slot: "emote", set: "lifeguard",  name: "Wave",            rarity: "Common",    source: "box" },
  emote_dance:   { id: "emote_dance",   slot: "emote", set: "neon",       name: "Victory Jig",     rarity: "Rare",      source: "box" },
  emote_tip:     { id: "emote_tip",     slot: "emote", set: "tiki",       name: "Tip the Sunhat",  rarity: "Rare",      source: "box" },
  emote_peace:   { id: "emote_peace",   slot: "emote", set: "surfpunk",   name: "Peace Sign",      rarity: "Common",    source: "box" },
  emote_shaka:   { id: "emote_shaka",   slot: "emote", set: "surfpunk",   name: "Shaka",           rarity: "Rare",      source: "box" },
  emote_flex:    { id: "emote_flex",    slot: "emote", set: "lifeguard",  name: "Lifeguard Flex",  rarity: "Epic",      source: "box" },
  emote_facepalm:{ id: "emote_facepalm",slot: "emote", set: "sandcastle", name: "Facepalm",        rarity: "Common",    source: "box" },
  emote_bow:     { id: "emote_bow",     slot: "emote", set: "golden",     name: "Champion's Bow",  rarity: "Legendary", source: "box" },
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

// ---- THE LEVEL LADDER ----
//
// What was here granted items that NO LONGER EXIST (`body_jumpsuit`,
// `shoes_boots`, `belt_utility`, `pose_salute`, `bg_badlands`) and unlocked slots
// that were dead (`background`, `victoryPose`, `border`). It also still described
// perks as "Impostor-side" — from the social-deduction game.
//
// It's built around the SETS now. Every few levels you're handed a piece of a
// persona, so the ladder is telling a story instead of dispensing loose hats: the
// Lifeguard kit comes together first (it's the starter identity), then the slots
// open up so you can mix your own.
export const LEVEL_UNLOCKS = {
  1: {
    slots: ["breather", "oxygenTank", "weapon", "body"],
    grants: ["breather_standard", "tank_standard", "tool_multitool", "body_standard", "head_lifeguard"],
    note: "Starter kit — the Lifeguard look, and your first kart.",
  },
  2: {
    slots: ["bandana", "headpiece"],
    grants: ["bandana_standard", "head_cap"],
    note: "Headgear + scarf slots. Start making it yours.",
  },
  3: {
    slots: ["flag"],
    grants: ["bandana_hachimaki", "flag_lifeguard"],
    note: "FLAGS unlocked — fly your colours. Plus the Rescue Wrap.",
  },
  4: {
    slots: ["shoes"],
    grants: ["shoes_standard", "tank_twin"],
    note: "WHEELS unlocked. Plus Twin Rescue Rings.",
  },
  5: { grants: ["tool_buoy"], perks: ["LUCKY_SCOOP"], note: "Rescue Buoy — the LIFEGUARD SET is complete. And your first perk." },
  6: {
    slots: ["belt"],
    grants: ["belt_rope"],
    note: "Trailer slot — tow something behind you.",
  },
  7: { grants: ["head_sunhat", "tool_parasol"], note: "The Tiki King set begins." },
  8: { grants: ["head_shades"], perks: ["BUCKET_BOY"], note: "Boardwalk Shades + another perk." },
  9: {
    slots: ["emote"],
    grants: ["emote_wave", "emote_shaka"],
    note: "EMOTES unlocked. Say something.",
  },
  10: { grants: ["tool_wrench", "head_headband"], perks: ["SECOND_SCOOP", "LONG_SUMMER"], note: "Sand Rake, Sweatband, and two more perks." },
  12: { grants: ["shoes_sandal"], perks: ["TIDE_READER"], note: "Beach Slicks." },
  15: { grants: ["head_goggles"], perks: ["MAGNET_MITTS"], note: "Flight Goggles — the Mecha Pilot set begins." },
  18: { grants: ["bandana_palm"], perks: ["BEACH_ECONOMIST"], note: "Palm Print." },
  20: { grants: ["head_bucket"], perks: ["ENCORE"], note: "Bucket Hat, and the last perk." },
  22: { grants: ["tool_noodle"], note: "Foam Noodle. Legend territory." },
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
  // The starter loadout. It used to hand out `body_jumpsuit` and `bg_badlands` —
  // neither of which exists. Everyone starts as a LIFEGUARD: it's the friendliest
  // persona, it's instantly readable, and it gives a new player a complete look
  // rather than a random assortment.
  return {
    breather: "breather_standard",
    oxygenTank: "tank_standard",
    weapon: "tool_multitool",
    body: "body_standard",
    headpiece: "head_lifeguard",
  };
}
