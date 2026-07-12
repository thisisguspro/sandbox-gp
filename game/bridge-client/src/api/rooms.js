// Display-only room labels for the neon space-western "robot cowboy" reskin
// (a futuristic hover-train crossing a red-rock desert at dusk).
// The authoritative engine keeps its original spaceship room KEYS (used in
// adjacency, sabotage targeting, and logic like `p.room === 'Space'`), so we
// relabel them for display ONLY at render time. Unknown rooms pass through.
export const ROOM_LABELS = {
  Helm: "Drive Cab",        // the locomotive's forward driving cab
  Reactor: "Furnace",       // fusion furnace / boiler
  Engineering: "Workshop",
  Sensors: "Lookout",
  Medbay: "Infirmary",
  Airlock: "Gangway",       // the boarding gangway / vent point
  Space: "Badlands",        // outside the train, out in the desert
  Cargo: "Freight Car",
  Hangar: "Rig Bay",
  "Comms Array": "Telegraph",
};

// Turret rooms are generated per-impostor ("Turret Alpha".."Turret Zeta"...),
// so map the Greek suffix to a letter and relabel them all as "Cannon <letter>".
const GREEK_ORDER = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta",
  "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu"];

export function roomLabel(name) {
  if (!name) return name;
  if (ROOM_LABELS[name]) return ROOM_LABELS[name];
  if (name.startsWith("Turret ")) {
    const idx = GREEK_ORDER.indexOf(name.slice(7).trim());
    if (idx >= 0) return `Cannon ${String.fromCharCode(65 + idx)}`;
    return name.replace(/^Turret\b/, "Cannon"); // fallback: keep suffix
  }
  return name;
}
