// Small shared cosmetic metadata. Lives apart from any renderer so the UI can
// use it without dragging in an art pipeline. (These two constants were the
// only things still needed from the retired IsoPilot sprite component.)

// Body suits that visually swallow these slots — the UI greys them out.
// Kept in sync with the backend COVERED_BY_BODY_SLOTS.
export const COVERED_BY_BODY = ["headpiece", "bandana", "belt", "oxygenTank"];

const EMOTE_GLYPH = {
  emote_wave: "👋",
  emote_dance: "💃",
  emote_bow: "🙇",
  emote_peace: "✌️",
};
export function emoteGlyph(id) { return EMOTE_GLYPH[id] || "😀"; }
