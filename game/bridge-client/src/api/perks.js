// SANDBOX GP — racing perk catalog (client mirror of the server's RACING_PERKS).
// The creed: identical karts, always. Perks touch item luck, hoop windows,
// economy, and information — never speed. Equip up to two.
export const MAX_EQUIPPED = 2;
export const PERK_CATALOG = [
  { key: "LUCKY_SCOOP",     name: "Lucky Scoop",     glyph: "🍀", unlockLevel: 2,  desc: "Hoop runs count one extra ring toward your tier." },
  { key: "LONG_SUMMER",     name: "Long Summer",     glyph: "⏳", unlockLevel: 4,  desc: "Hoop-run window lasts 18 seconds instead of 15." },
  { key: "MAGNET_MITTS",    name: "Magnet Mitts",    glyph: "🧲", unlockLevel: 6,  desc: "Hoops are 45% easier to snag." },
  { key: "BUCKET_BOY",      name: "Bucket Boy",      glyph: "🪣", unlockLevel: 8,  desc: "Start every race holding a Bucket Shield charge." },
  { key: "SECOND_SCOOP",    name: "Second Scoop",    glyph: "🥄", unlockLevel: 10, desc: "Reform from a wipeout holding a bronze item." },
  { key: "TIDE_READER",     name: "Tide Reader",     glyph: "🌊", unlockLevel: 12, desc: "Incoming-danger warnings reach 50% farther." },
  { key: "BEACH_ECONOMIST", name: "Beach Economist", glyph: "🐚", unlockLevel: 14, desc: "Race payouts drop 25% more Sea Glass." },
  { key: "ENCORE",          name: "Encore",          glyph: "🎭", unlockLevel: 16, desc: "Your first dud kite each race re-rolls itself." },
];
