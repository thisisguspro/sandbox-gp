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
  breather:   { key: "breather",   label: "Breather",     alwaysFilled: true,  unlockLevel: 1,  default: "breather_standard", carriesIdColor: true },
  oxygenTank: { key: "oxygenTank", label: "Battery",      alwaysFilled: true,  unlockLevel: 1,  default: "tank_standard",     carriesIdColor: true },
  weapon:     { key: "weapon",     label: "Tool",         alwaysFilled: true,  unlockLevel: 1,  default: "tool_multitool" }, // NEVER carries idColor — kept neutral so prestige skins (e.g. golden event weapons) stay purely cosmetic, not an identity tell
  bandana:    { key: "bandana",    label: "Bandana",      alwaysFilled: false, unlockLevel: 2 }, // now a pure cosmetic, not an identifier
  headpiece:  { key: "headpiece",  label: "Headpiece",    alwaysFilled: false, unlockLevel: 2 },
  body:       { key: "body",       label: "Costume",      alwaysFilled: false, unlockLevel: 1 },
  shoes:      { key: "shoes",      label: "Wheel",        alwaysFilled: false, unlockLevel: 5 },
  belt:       { key: "belt",       label: "Belt",         alwaysFilled: false, unlockLevel: 6 },
  border:     { key: "border",     label: "Profile Border", alwaysFilled: false, unlockLevel: 7 },
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
  breather_standard: { id: "breather_standard", slot: "breather", name: "Standard Respirator", rarity: "Common", source: "starter" },
  breather_snout:    { id: "breather_snout",    slot: "breather", name: "Snout Filter",  rarity: "Rare",   source: "box" },
  breather_fanged:   { id: "breather_fanged",   slot: "breather", name: "Fanged Mask",       rarity: "Epic",   source: "box" },

  // O2 tanks — ALWAYS visible; the backpack tank that also carries the ID color.
  tank_standard:  { id: "tank_standard",  slot: "oxygenTank", name: "Standard Battery", rarity: "Common", source: "starter" },
  tank_finned:    { id: "tank_finned",    slot: "oxygenTank", name: "Finned Battery",      rarity: "Rare",   source: "box" },
  tank_canister:  { id: "tank_canister",  slot: "oxygenTank", name: "Twin Canister",    rarity: "Epic",   source: "box" },

  // Bandanas — now an OPTIONAL cosmetic (no longer the identifier).
  bandana_standard: { id: "bandana_standard", slot: "bandana", name: "Standard Bandana", rarity: "Common", source: "level" },
  bandana_knot:     { id: "bandana_knot",     slot: "bandana", name: "Knotted Bandana",  rarity: "Rare",   source: "box" },
  bandana_tactical: { id: "bandana_tactical", slot: "bandana", name: "Tactical Wrap",     rarity: "Epic",   source: "box" },

  // Loyalty-exclusive cosmetics — ONLY obtainable by claiming Frontier Loyalty
  // milestones (source: "loyalty"). Never sold in any store or dropped by boxes.
  bandana_trailblazer: { id: "bandana_trailblazer", slot: "bandana",   name: "Trailblazer Sash",  rarity: "Legendary", source: "loyalty" },
  head_marshal:        { id: "head_marshal",        slot: "headpiece", name: "Marshal's Star",    rarity: "Legendary", source: "loyalty" },
  body_goldplate:      { id: "body_goldplate",      slot: "body",      name: "Goldplate Regalia", rarity: "Legendary", source: "loyalty" },
  shoes_goldspur:      { id: "shoes_goldspur",      slot: "shoes",     name: "Golden Spurs",      rarity: "Legendary", source: "loyalty" },

  // Weapons (the always-present tool, reskinned)
  tool_multitool: { id: "tool_multitool", slot: "weapon", name: "Standard Tool", rarity: "Common", source: "starter" },
  tool_wrench:    { id: "tool_wrench",    slot: "weapon", name: "Heavy Wrench",       rarity: "Common", source: "level" },
  tool_drill:     { id: "tool_drill",     slot: "weapon", name: "Steam Drill",       rarity: "Rare",   source: "box" },
  tool_chicken:   { id: "tool_chicken",   slot: "weapon", name: "Rubber Chicken",     rarity: "Epic",   source: "box" },

  // Headpieces
  head_cap:     { id: "head_cap",     slot: "headpiece", name: "Ranger Hat",    rarity: "Common", source: "level" },
  head_visor:   { id: "head_visor",   slot: "headpiece", name: "Neon Visor",    rarity: "Rare",   source: "box" },
  head_halo:    { id: "head_halo",    slot: "headpiece", name: "Spirit Halo",   rarity: "Legendary", source: "box" },

  // Bodies / costumes
  body_jumpsuit: { id: "body_jumpsuit", slot: "body", name: "Ranch Overalls",   rarity: "Common", source: "starter" },
  body_mecha:    { id: "body_mecha",    slot: "body", name: "Iron Frame",     rarity: "Epic",   source: "starter" },
  body_ronin:    { id: "body_ronin",    slot: "body", name: "Lone Drifter", rarity: "Legendary", source: "starter" },

  // Shoes
  shoes_boots:  { id: "shoes_boots",  slot: "shoes", name: "Spur Wheel",    rarity: "Common", source: "level" },
  shoes_glow:   { id: "shoes_glow",   slot: "shoes", name: "Glowstep Wheel", rarity: "Epic",  source: "box" },

  // Belts
  belt_utility: { id: "belt_utility", slot: "belt", name: "Tool Belt", rarity: "Common", source: "level" },

  // Borders
  border_bronze: { id: "border_bronze", slot: "border", name: "Bronze Frame", rarity: "Common", source: "level" },
  border_aurora: { id: "border_aurora", slot: "border", name: "Sunset Frame", rarity: "Epic",   source: "box" },

  // Victory poses
  pose_salute:  { id: "pose_salute",  slot: "victoryPose", name: "Crisp Salute",  rarity: "Common", source: "level" },
  pose_backflip:{ id: "pose_backflip",slot: "victoryPose", name: "High-Noon Backflip", rarity: "Rare", source: "box" },

  // Emotes
  emote_wave:   { id: "emote_wave",   slot: "emote", name: "Wave",       rarity: "Common", source: "level" },
  emote_dance:  { id: "emote_dance",  slot: "emote", name: "Victory Jig", rarity: "Rare",   source: "box" },

  // ---- Store expansion (anime-themed shop items, sold directly in the Shop) ----
  // Breathers
  breather_koi:     { id: "breather_koi",     slot: "breather",   name: "Catfish Filter",      rarity: "Rare",      source: "box" },
  breather_kitsune: { id: "breather_kitsune", slot: "breather",   name: "Coyote Mask",    rarity: "Epic",      source: "box" },
  breather_oni:     { id: "breather_oni",     slot: "breather",   name: "Devil's Visage",      rarity: "Legendary", source: "box" },
  // O2 tanks
  tank_jet:         { id: "tank_jet",         slot: "oxygenTank", name: "Piston Cell",  rarity: "Rare",      source: "box" },
  tank_sakura:      { id: "tank_sakura",      slot: "oxygenTank", name: "Desert Bloom Cell",     rarity: "Epic",      source: "box" },
  tank_dragon:      { id: "tank_dragon",      slot: "oxygenTank", name: "Thunder Core",     rarity: "Legendary", source: "box" },
  // Weapons
  tool_bokken:      { id: "tool_bokken",      slot: "weapon",     name: "Training Cudgel", rarity: "Common",    source: "box" },
  tool_fan:         { id: "tool_fan",         slot: "weapon",     name: "War Fan",         rarity: "Rare",      source: "box" },
  tool_katana:      { id: "tool_katana",      slot: "weapon",     name: "Cavalry Saber",   rarity: "Epic",      source: "box" },
  tool_naginata:    { id: "tool_naginata",    slot: "weapon",     name: "Marshal's Pike",   rarity: "Legendary", source: "box" },
  // Bandanas
  bandana_hachimaki:{ id: "bandana_hachimaki",slot: "bandana",    name: "Dust Wrap",       rarity: "Common",    source: "box" },
  bandana_flame:    { id: "bandana_flame",    slot: "bandana",    name: "Flame Wrap",      rarity: "Rare",      source: "box" },
  bandana_storm:    { id: "bandana_storm",    slot: "bandana",    name: "Storm Scarf",     rarity: "Epic",      source: "box" },
  // Headpieces
  head_goggles:     { id: "head_goggles",     slot: "headpiece",  name: "Dust Goggles",   rarity: "Common",    source: "box" },
  head_foxears:     { id: "head_foxears",     slot: "headpiece",  name: "Coyote Ears",        rarity: "Rare",      source: "box" },
  head_kabuto:      { id: "head_kabuto",      slot: "headpiece",  name: "Bandit Helm",     rarity: "Epic",      source: "box" },
  head_crown:       { id: "head_crown",       slot: "headpiece",  name: "Outlaw Crown",    rarity: "Legendary", source: "box" },
  // Bodies
  body_pilotsuit:   { id: "body_pilotsuit",   slot: "body",       name: "Gunslinger Rig",  rarity: "Rare",      source: "box" },
  body_kimono:      { id: "body_kimono",      slot: "body",       name: "Star Poncho",     rarity: "Epic",      source: "box" },
  body_samurai:     { id: "body_samurai",     slot: "body",       name: "Dread Marshal",    rarity: "Legendary", source: "box" },
  // Shoes
  shoes_geta:       { id: "shoes_geta",       slot: "shoes",      name: "Rocket Wheel",     rarity: "Rare",      source: "box" },
  shoes_hover:      { id: "shoes_hover",      slot: "shoes",      name: "Chrome Treads",    rarity: "Epic",      source: "box" },
  // Belts
  belt_holster:     { id: "belt_holster",     slot: "belt",       name: "Twin Holster",    rarity: "Common",    source: "box" },
  belt_obi:         { id: "belt_obi",         slot: "belt",       name: "Battle Sash",      rarity: "Rare",      source: "box" },
  // Borders
  border_neon:      { id: "border_neon",      slot: "border",     name: "Neon Circuit",    rarity: "Rare",      source: "box" },
  border_celestial: { id: "border_celestial", slot: "border",     name: "Frontier Ring",  rarity: "Legendary", source: "box" },
  // Victory poses
  pose_meditate:    { id: "pose_meditate",    slot: "victoryPose",name: "Quiet Vigil",       rarity: "Rare",      source: "box" },
  pose_victory:     { id: "pose_victory",     slot: "victoryPose",name: "Hero Landing",    rarity: "Epic",      source: "box" },
  // Emotes
  emote_bow:        { id: "emote_bow",        slot: "emote",      name: "Tip the Hat",     rarity: "Common",    source: "box" },
  emote_peace:      { id: "emote_peace",      slot: "emote",      name: "Peace Sign",      rarity: "Rare",      source: "box" },

  // Backgrounds — the world vista behind the train in a match. Default is owned by
  // everyone; the rest are sold in the Shop (credits / cash).
  bg_badlands:      { id: "bg_badlands",      slot: "background", name: "Dust Badlands",   rarity: "Common",    source: "starter" },
  bg_snowpass:      { id: "bg_snowpass",      slot: "background", name: "Frostbite Pass",  rarity: "Rare",      source: "box" },
  bg_pineforest:    { id: "bg_pineforest",    slot: "background", name: "Timberline Run",  rarity: "Rare",      source: "box" },
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
export const LEVEL_UNLOCKS = {
  1:  { slots: ["breather", "oxygenTank", "weapon", "body", "background"], grants: ["breather_standard", "tank_standard", "tool_multitool", "body_jumpsuit", "body_mecha", "body_ronin", "bg_badlands"], note: "Starter kit — your snorkel, floaty, beach gear, and first kart looks." },
  2:  { slots: ["bandana", "headpiece"], grants: ["bandana_standard", "head_cap"], note: "Bandana + headwear slots unlocked." },
  3:  { note: "Level 3 — keep racing!" },
  4:  { grants: ["tank_finned"], note: "A new floaty style." },
  5:  { slots: ["shoes"], grants: ["shoes_boots"], perks: ["LONGER_OXYGEN"], note: "Wheel style slot + your first perk." },
  6:  { slots: ["belt"], grants: ["belt_utility"], note: "Tow-rope slot unlocked." },
  7:  { slots: ["border"], grants: ["border_bronze"], note: "Profile frame slot unlocked." },
  8:  { slots: ["victoryPose"], grants: ["pose_salute"], perks: ["BIGGER_REACTOR"], note: "Victory pose slot + another perk." },
  9:  { slots: ["emote"], grants: ["emote_wave"], note: "Emote slot unlocked." },
  10: { grants: ["tool_wrench"], perks: ["EFFICIENT_TASKS", "FLEET_FEET"], note: "A new tool skin + more perks." },
  12: { perks: ["STURDY_HULL"], note: "Perk unlocked." },
  15: { perks: ["QUICK_FUSES", "SILENT_STEPS"], note: "Impostor-side perks unlocked." },
  18: { perks: ["LINGERING_DARK"], note: "Impostor perk unlocked." },
  20: { perks: ["LONG_PALAVER"], note: "Comms-mastery perk unlocked." },
  22: { perks: ["REINFORCED_PLATING"], note: "Hull-defense perk unlocked." },
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
