// SANDBOX GP — engine constants (Batch 1).
// The deduction-era constants (roles, oxygen, sabotage, planes, minigames)
// were removed with the BRIDGE GameEngine. Race tuning constants land here
// with the real engine in Batch 2.

export const PHASE = {
  LOBBY: "lobby",   // waiting for racers, not started
  ACTIVE: "active", // live race (includes the 3-2-1 start freeze)
  ENDED: "ended",   // all racers finished or the race timed out
};
