// ============================================================
// Event framework (v0.1) — config + types.
// Events are time-windowed live-ops the backend owns. Two ways they attach:
//   1) GLOBAL: an active event with a window + config everyone plays under.
//   2) PER-ACCOUNT FLAGS: specific accounts tagged with an event role (e.g. a
//      bounty target, or an event host with extended powers).
// Game modes stay pluggable — an event names a `mode` the game server may load
// later; unknown modes just mean "standard rules + this event's effects".
// ============================================================

// Known pluggable game modes an event can run. Mirrors the game server's mode
// registry (src/engine/modes/index.js) — kept here so the backend/admin tool can
// offer them without importing the engine. Add new modes to both places.
export const GAME_MODE_IDS = [
  { id: "infection", label: "Infection" },
  { id: "koth", label: "King of the Hill" },
  { id: "hotpotato", label: "Hot Potato" },
  { id: "musicalchairs", label: "Musical Chairs" },
  { id: "whodidit", label: "Who Did It?" },
];

// Event roles an admin can flag onto an account, scoped to an event.
export const EVENT_FLAGS = {
  BOUNTY_TARGET: { key: "BOUNTY_TARGET", label: "Bounty Target",
    desc: "Saboteurs who take this player down during the event earn the bounty reward." },
  EVENT_HOST:    { key: "EVENT_HOST", label: "Event Host",
    desc: "May edit game options beyond normal host config and run event game modes." },
};

// Powers an EVENT_HOST gains (beyond a normal lobby host). Read by the game
// server to relax restrictions for that account during the event.
export const EVENT_HOST_POWERS = {
  unrestrictedConfig: true,   // may set any config knob (incl. ones normally hidden)
  chooseGameMode: true,       // may pick a pluggable mode (tag, infection, …)
  forceStart: true,           // may start below the map minimum (custom/event games)
  overrideImpostorCount: true,
};

// A reward blob is { currency?: "CREDITS"|"PREMIUM", amount?: number, cosmeticId?: string }.
// Used by bounty claims (configurable: currency, cosmetic, or both).
export function emptyReward() { return { currency: null, amount: 0, cosmeticId: null }; }

// Validate/normalize an event reward blob.
export function normalizeReward(r = {}) {
  return {
    currency: (r.currency === "CREDITS" || r.currency === "PREMIUM") ? r.currency : null,
    amount: Number.isFinite(r.amount) ? Math.max(0, Math.round(r.amount)) : 0,
    cosmeticId: typeof r.cosmeticId === "string" ? r.cosmeticId : null,
  };
}
