// Shared SIDE-SCROLLING (beat-em-up) projection used by BOTH the renderer
// (IsoStage) and the input layer (Controls). Centralizing it here guarantees the
// click/keyboard screen<->world math can never drift from what's drawn on screen.
//
// The server world is a flat top-down (x,y) plane. We view it as a Double-Dragon
// style side-scroller: world +x runs LEFT->RIGHT across the screen, world +y is
// DEPTH into the room, foreshortened onto the vertical axis so the floor reads as
// a shallow walkable band at the bottom and a back wall fills the top:
//   screen.x = wx * SX
//   screen.y = wy * SY          (SY < SX  ->  depth foreshortening)
// The camera offset (ox,oy) is added by the caller, not here, so toScreen/toWorld
// stay pure linear maps (a screen DELTA projects with the same call, no offset).
//
// `scale` (== SX) is the horizontal zoom for the WORLD (rooms, corridors, props).
// Pilot DOM sprites are also sized off `scale` (see IsoStage's `ISO.scale * MULT`),
// but that MULT is tuned to keep the pilot a fixed on-screen size while the world
// zooms — so raising `scale` makes rooms bigger RELATIVE to the pilot.
// `depth` is the vertical foreshortening factor (SY = scale * depth): smaller =
// flatter floor / more side-on. Tune both together to change the beat-em-up feel.
export const ISO = { scale: 0.36, depth: 0.66 };

export function toScreen(wx, wy) {
  const SX = ISO.scale, SY = ISO.scale * ISO.depth;
  return { sx: wx * SX, sy: wy * SY };
}

export function toWorld(sx, sy) {
  const SX = ISO.scale, SY = ISO.scale * ISO.depth;
  return { wx: sx / SX, wy: sy / SY };
}
