// Client-side perk catalog for the Perks tab (menu-time, where no live game view
// exists to carry perk metadata). Mirrors the gameserver's constants.js PERKS
// (label/desc/side) and the backend's cosmetics.js LEVEL_UNLOCKS (unlockLevel).
// KEEP IN SYNC when perks or their unlock levels change on the server.
export const PERK_CATALOG = [
  { key: "LONGER_OXYGEN",     side: "crew",     unlockLevel: 5,  label: "Spare Battery",
    desc: "Battery drains 15% slower — you still must refill, just later." },
  { key: "BIGGER_REACTOR",    side: "crew",     unlockLevel: 8,  label: "Stoked Furnace",
    desc: "+15% power pool capacity." },
  { key: "EFFICIENT_TASKS",   side: "crew",     unlockLevel: 10, label: "Seasoned Hands",
    desc: "Chores generate 10% more power." },
  { key: "FLEET_FEET",        side: "both",     unlockLevel: 10, label: "Greased Wheels",
    desc: "Everyone rolls a touch faster — crew and impostor alike." },
  { key: "STURDY_HULL",       side: "crew",     unlockLevel: 12, label: "Iron Plating",
    desc: "+10 starting armor." },
  { key: "QUICK_FUSES",       side: "impostor", unlockLevel: 15, label: "Quick Hands",
    desc: "Sabotage global cooldown 12% shorter." },
  { key: "SILENT_STEPS",      side: "impostor", unlockLevel: 15, label: "Silent Spurs",
    desc: "Cable-pull cooldown 12% shorter." },
  { key: "LINGERING_DARK",    side: "impostor", unlockLevel: 18, label: "Lingering Dark",
    desc: "Lanterns Out and Trail Exposed last 20% longer." },
  { key: "LONG_PALAVER",      side: "both",     unlockLevel: 20, label: "Long Palaver",
    desc: "Comms & emote wheels linger for a beat after you release — time to aim your pick." },
  { key: "REINFORCED_PLATING",side: "crew",     unlockLevel: 22, label: "Reinforced Plating",
    desc: "Incoming attack waves batter the armor 15% less." },
];

// Side → display metadata (western/anime frame; keeps CREW/IMPOSTOR role terms).
export const SIDE_META = {
  crew:     { label: "CREW",     kanji: "◆",   color: "var(--volt)" },
  impostor: { label: "IMPOSTOR", kanji: "▲", color: "var(--violet)" },
  both:     { label: "ALL",      kanji: "●",     color: "var(--gold)" },
};
