import React from "react";
import ColorblindSymbol from "./ColorblindSymbol.jsx";

// In-match anime pilot, rendered from the hand-drawn anime sprite art
// (public/characters/pilot_red.png as the canonical hue-0 base) and tinted
// per-player to its ID color via CSS filters. This keeps the gameplay view in
// the same anime style as the rest of the game while preserving each player's
// identity color (used for voting/ejects).
//
// Turn-around: the pilot has both a FRONT and a BACK sprite set. Facing NE/NW
// (moving "up"/away from the camera) shows the back of the body and the back of
// each worn accessory (back of the head, bandana knot, prominent O2 tank);
// facing SE/SW shows the front. The existing horizontal mirror still applies to
// the left-facing (W) directions. Feet are WHEELS for everyone (drawn as vector
// so they roll while moving), independent of the equipped body costume.

const PILOT_SRC = "./characters/pilot_red.png"; // base art is "red" (hue 0)

// Body-costume sprites. Each entry has a `front` (SE-drawn), `back` (N-drawn) and
// `side` (E-drawn right profile) sprite in the same hue-0 "red" base palette and
// framing, so the per-player hue tint and the feet/ring alignment carry over. The
// left-facing directions mirror the right-side art; missing views fall back down
// the chain (side → front, back → front), and any unknown/unequipped body uses
// the base look — so a partial art set never blanks a pilot.
const BODY_SRC = {
  _base:          { front: PILOT_SRC,                          back: "./characters/pilot_red_back.png",       side: "./characters/pilot_red_side.png" },
  body_jumpsuit:  { front: "./characters/pilot_jumpsuit.png",  back: "./characters/pilot_jumpsuit_back.png",  side: "./characters/pilot_jumpsuit_side.png" },
  body_mecha:     { front: "./characters/pilot_mecha.png",     back: "./characters/pilot_mecha_back.png",     side: "./characters/pilot_mecha_side.png" },
  body_ronin:     { front: "./characters/pilot_ronin.png",     back: "./characters/pilot_ronin_back.png",     side: "./characters/pilot_ronin_side.png" },
  body_pilotsuit: { front: "./characters/pilot_pilotsuit.png", back: "./characters/pilot_pilotsuit_back.png", side: "./characters/pilot_pilotsuit_side.png" },
  body_kimono:    { front: "./characters/pilot_kimono.png",    back: "./characters/pilot_kimono_back.png",    side: "./characters/pilot_kimono_side.png" },
  body_samurai:   { front: "./characters/pilot_samurai.png",   back: "./characters/pilot_samurai_back.png",   side: "./characters/pilot_samurai_side.png" },
};

// Worn-accessory overlays. Each is a transparent sprite of the item alone, drawn
// in worn orientation, layered over (or behind) the body and anchored to a body
// region. They keep their TRUE colors (no per-player hue tint) so cosmetics stay
// recognizable, while the body underneath carries the player's identity color.
//
// `front` is required; `back` is optional — when a slot has no dedicated back
// art the front sprite is reused (fine for belts, tools, shoes seen from behind).
// The O2 tank uses a single backpack sprite for both facings: it is drawn BEHIND
// the body when facing the camera (a subtle peek) and prominently ON TOP when
// the pilot turns around. The breather sits on the face and is only drawn from
// the front (it is hidden behind the head when turned away).
const ACC_SRC = {
  // headpiece slot
  head_cap:     { front: "./overlays/head_cap.png",     back: "./overlays/head_cap_back.png" },
  head_visor:   { front: "./overlays/head_visor.png",   back: "./overlays/head_visor_back.png" },
  head_halo:    { front: "./overlays/head_halo.png",    back: "./overlays/head_halo_back.png" },
  head_goggles: { front: "./overlays/head_goggles.png", back: "./overlays/head_goggles_back.png" },
  head_foxears: { front: "./overlays/head_foxears.png", back: "./overlays/head_foxears_back.png" },
  head_kabuto:  { front: "./overlays/head_kabuto.png",  back: "./overlays/head_kabuto_back.png" },
  head_crown:   { front: "./overlays/head_crown.png",   back: "./overlays/head_crown_back.png" },
  // bandana slot (back = the knot at the back of the head)
  bandana_standard:  { front: "./overlays/bandana_standard.png",  back: "./overlays/bandana_standard_back.png" },
  bandana_knot:      { front: "./overlays/bandana_knot.png",      back: "./overlays/bandana_knot_back.png" },
  bandana_tactical:  { front: "./overlays/bandana_tactical.png",  back: "./overlays/bandana_tactical_back.png" },
  bandana_hachimaki: { front: "./overlays/bandana_hachimaki.png", back: "./overlays/bandana_hachimaki_back.png" },
  bandana_flame:     { front: "./overlays/bandana_flame.png",     back: "./overlays/bandana_flame_back.png" },
  bandana_storm:     { front: "./overlays/bandana_storm.png",     back: "./overlays/bandana_storm_back.png" },
  // weapon slot (reuse front art from behind)
  tool_multitool: { front: "./overlays/tool_multitool.png" },
  tool_wrench:    { front: "./overlays/tool_wrench.png" },
  tool_drill:     { front: "./overlays/tool_drill.png" },
  tool_chicken:   { front: "./overlays/tool_chicken.png" },
  tool_bokken:    { front: "./overlays/tool_bokken.png" },
  tool_fan:       { front: "./overlays/tool_fan.png" },
  tool_katana:    { front: "./overlays/tool_katana.png" },
  tool_naginata:  { front: "./overlays/tool_naginata.png" },
  // shoes slot (reuse front art from behind)
  shoes_boots: { front: "./overlays/shoes_boots.png" },
  shoes_glow:  { front: "./overlays/shoes_glow.png" },
  shoes_geta:  { front: "./overlays/shoes_geta.png" },
  shoes_hover: { front: "./overlays/shoes_hover.png" },
  // belt slot (reuse front art from behind)
  belt_utility: { front: "./overlays/belt_utility.png" },
  belt_holster: { front: "./overlays/belt_holster.png" },
  belt_obi:     { front: "./overlays/belt_obi.png" },
  // breather slot — face piece, FRONT ONLY (hidden behind the head from the back)
  breather_standard: { front: "./overlays/breather_standard.png" },
  breather_snout:    { front: "./overlays/breather_snout.png" },
  breather_fanged:   { front: "./overlays/breather_fanged.png" },
  breather_koi:      { front: "./overlays/breather_koi.png" },
  breather_kitsune:  { front: "./overlays/breather_kitsune.png" },
  breather_oni:      { front: "./overlays/breather_oni.png" },
  // oxygenTank slot — single backpack sprite used behind (front view) / on top (back view)
  tank_standard:  { front: "./overlays/tank_standard.png" },
  tank_finned:    { front: "./overlays/tank_finned.png" },
  tank_canister:  { front: "./overlays/tank_canister.png" },
  tank_jet:       { front: "./overlays/tank_jet.png" },
  tank_sakura:    { front: "./overlays/tank_sakura.png" },
  tank_dragon:    { front: "./overlays/tank_dragon.png" },
};

// Where each slot sits on the 92px pilot box (head top ~2%, face ~24%, torso
// ~40-64%, feet/wheels ~78%). Separate front/back anchors where the item lands
// in a different place when the pilot turns around.
// `side` anchors position the (front-art) overlays onto the true E/W profile
// body sprite (pilot_*_side.png). Defined for the east/right-facing profile;
// the flip wrapper mirrors them for west. Held/worn pieces shift forward (higher
// left %) and the O2 tank shifts back (lower left %) so it reads as a backpack.
const ACC_ANCHOR = {
  shoes:     { front: { left: "50%", top: "68%", width: "58%", height: "20%" }, back: { left: "50%", top: "68%", width: "58%", height: "20%" }, side: { left: "50%", top: "68%", width: "50%", height: "20%" } },
  belt:      { front: { left: "50%", top: "54%", width: "54%", height: "18%" }, back: { left: "50%", top: "54%", width: "54%", height: "18%" }, side: { left: "50%", top: "54%", width: "46%", height: "18%" } },
  weapon:    { front: { left: "31%", top: "40%", width: "30%", height: "48%" }, back: { left: "34%", top: "46%", width: "34%", height: "38%" }, side: { left: "66%", top: "46%", width: "34%", height: "40%" } },
  bandana:   { front: { left: "50%", top: "40%", width: "46%", height: "34%" }, back: { left: "50%", top: "13%", width: "46%", height: "28%" }, side: { left: "54%", top: "40%", width: "44%", height: "32%" } },
  headpiece: { front: { left: "50%", top: "-1%", width: "56%", height: "42%" }, back: { left: "50%", top: "-1%", width: "56%", height: "42%" }, side: { left: "53%", top: "-1%", width: "52%", height: "42%" } },
  breather:  { front: { left: "50%", top: "22%", width: "46%", height: "46%" }, back: null, side: { left: "56%", top: "28%", width: "38%", height: "26%" } },
  // O2 tank: subtle peek from the front, prominent slab on the back, backpack on the profile
  oxygenTank: { front: { left: "50%", top: "20%", width: "72%", height: "48%" }, back: { left: "50%", top: "20%", width: "60%", height: "50%" }, side: { left: "36%", top: "22%", width: "58%", height: "50%" } },
};

// Emote movements. Each emote cosmetic plays a short ~3s body movement on the
// pilot (shown in the wheel preview; reusable in-match). `anim` drives the rig's
// CSS animation; `glyph` is the emoji shown in the bubble while it plays.
const EMOTE_MOVE = {
  emote_wave:  { anim: "emoteWave 0.7s ease-in-out infinite",  glyph: "👋" },
  emote_dance: { anim: "emoteDance 0.6s ease-in-out infinite", glyph: "💃" },
  emote_bow:   { anim: "emoteBow 1.1s ease-in-out infinite",   glyph: "🙇" },
  emote_peace: { anim: "emotePeace 0.8s ease-in-out infinite", glyph: "✌️" },
};
const EMOTE_FALLBACK = { anim: "emoteHop 0.6s ease-in-out infinite", glyph: "😀" };
export function emoteGlyph(id) { return (EMOTE_MOVE[id] || EMOTE_FALLBACK).glyph; }

// 8-way facing resolved from movement (see IsoStage). We hold only THREE base
// sprite sets — front (SE-drawn), back (N-drawn), and an optional side (E-drawn
// profile) — and derive all 8 compass directions from them with a horizontal
// mirror + a small lean into the diagonals. `view` picks the art, `flip` mirrors
// it, `lean` tilts the rig a few degrees so diagonals read distinct from the
// cardinals. Left-facing dirs reuse the right-side art mirrored; `side` art falls
// back to the front sprite until the profile art exists, so this never blanks.
const FACING_META = {
  S:  { view: "front", flip: false, lean: 0 },
  SE: { view: "front", flip: false, lean: 0 },
  E:  { view: "side",  flip: false, lean: 0 },
  NE: { view: "back",  flip: false, lean: 0 },
  N:  { view: "back",  flip: false, lean: 0 },
  NW: { view: "back",  flip: true,  lean: 0 },
  W:  { view: "side",  flip: true,  lean: 0 },
  SW: { view: "front", flip: true,  lean: 0 },
};

// The single wheel foreshortens by travel direction: a full circle rolling across
// screen (E/W), a thin edge-on sliver toward/away (N/S), and in-between on the
// diagonals. Purely a horizontal squash on the vector wheel — needs no art.
const WHEEL_SQUASH = { E: 1, W: 1, SE: 0.72, SW: 0.72, NE: 0.72, NW: 0.72, S: 0.42, N: 0.42 };

// Srcs that failed to load once, so we stop re-attempting them every frame and
// fall back cleanly (e.g. a body's optional side sprite that isn't shipped yet).
const FAILED_ART = new Set();

// A full-body `body` costume is one sprite that visually covers these overlay
// slots, so we hide them while a costume is worn (the held weapon, the
// wheel/shoes, and the face MASK/breather stay visible). Every costume bakes in
// its own hat + coat but leaves the robot face exposed at the same spot, so the
// mask still fits over the top — hats/bandana/belt/tank would double up, masks
// don't. Kept in sync with the backend COVERED_BY_BODY_SLOTS.
export const COVERED_BY_BODY = ["headpiece", "bandana", "belt", "oxygenTank"];

// A SINGLE spinning WHEEL — the wheel base for every pilot, replacing legs/feet.
// Drawn as vector so it stays crisp and can actually spin. Shoe cosmetics restyle
// the wheel (rim/hub/spoke/glow palette). It spins only while moving; still when idle.
function Wheel({ moving, variant = "brass", rolling = true }) {
  const PALETTES = {
    steel: { tire: "#23232a", rim: "#7d8592", hub: "#d6dae4", spoke: "#aeb6c4", glow: "rgba(180,190,210,0.45)" },
    neon:  { tire: "#0e0e1c", rim: "#26e0c6", hub: "#eafcff", spoke: "#26e0c6", glow: "rgba(38,224,198,0.80)" },
    wood:  { tire: "#3a2412", rim: "#8a5a2e", hub: "#d9a866", spoke: "#b07a3a", glow: "rgba(200,150,80,0.40)" },
    turq:  { tire: "#0c2230", rim: "#3fd8e8", hub: "#eafeff", spoke: "#3fd8e8", glow: "rgba(63,216,232,0.80)" },
    brass: { tire: "#241a10", rim: "#b8860b", hub: "#ffd77a", spoke: "#c8912a", glow: "rgba(255,194,61,0.60)" },
  };
  const c = PALETTES[variant] || PALETTES.brass;
  const spin = { animation: (rolling && moving) ? "wheelspin 0.35s linear infinite" : "none", transformOrigin: "20px 20px" };
  return (
    <svg viewBox="0 0 40 40" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      {/* ground-contact / motion glow */}
      <ellipse cx="20" cy="36" rx="15" ry="4.5" fill={c.glow} />
      {rolling ? (
        <g style={spin}>
          <circle cx="20" cy="20" r="17" fill={c.tire} stroke={c.rim} strokeWidth="4" />
          {/* three diameters = six symmetric spokes */}
          {[0, 60, 120].map((a) => {
            const rad = (a * Math.PI) / 180, dx = 14 * Math.cos(rad), dy = 14 * Math.sin(rad);
            return <line key={a} x1={20 - dx} y1={20 - dy} x2={20 + dx} y2={20 + dy} stroke={c.spoke} strokeWidth="2.4" strokeLinecap="round" />;
          })}
          <circle cx="20" cy="20" r="5.5" fill={c.hub} stroke={c.rim} strokeWidth="1.5" />
        </g>
      ) : (
        /* Foreshortened toward/away from the camera (front/back facing): the gold
           rim + spokes + hub squash into an ugly sliver edge-on, so show ONLY the
           round black rubber tire — that's the one part that reads correctly. */
        <circle cx="20" cy="20" r="17" fill={c.tire} stroke={c.tire} strokeWidth="2" />
      )}
    </svg>
  );
}

export default function IsoPilot({ player, facing = "S", moving = false, isYou = false, scale = 1, showColorblind = false, preview = false, playingEmote = null }) {
  const idc = player.idColor || {};
  // Tint the red base toward this player's ID color. The palette carries hue and
  // optional sat/bright so a single sprite can become any of the 20 colors. Dark
  // armor stays dark (low saturation barely shifts under hue-rotate); the glowing
  // accents and breather carry the color.
  const hue = idc.hue ?? 0;
  const sat = idc.sat ?? 1;
  const bright = idc.bright ?? 1;
  const tint = `hue-rotate(${hue}deg) saturate(${sat}) brightness(${bright})`;

  const meta = FACING_META[facing] || FACING_META.S;
  const back = meta.view === "back";  // facing away from the camera (top-down "up")
  const side = meta.view === "side";  // profile (E/W) — uses side art when present
  const flip = meta.flip;             // mirror to face left
  const lean = meta.lean || 0;        // slight tilt into the diagonals
  const wheelSX = WHEEL_SQUASH[facing] ?? 1; // foreshorten the wheel by direction
  const onEnergy = player.plane === "energy";
  const eliminated = player.plane === "eliminated";

  // A playing emote shows its glyph + drives the rig movement; otherwise fall
  // back to any server-set emote, or the skull for the eliminated.
  const playMove = playingEmote ? (EMOTE_MOVE[playingEmote] || EMOTE_FALLBACK) : null;
  const emote = playMove ? playMove.glyph : player.emote ? player.emote : eliminated ? "💀" : null;

  // Swap the body sprite based on the player's equipped costume + facing so
  // cosmetics are visible in-match. Server includes loadout on each player.
  const lo = player.loadout || {};
  const bodyEntry = BODY_SRC[lo.body] || BODY_SRC._base;
  // Pick the sprite for this view with a graceful fallback chain
  // (side → front, back → front) that also skips any src known to have failed.
  const ok = (s) => s && !FAILED_ART.has(s);
  const pilotSrc =
    (side && ok(bodyEntry.side)) ? bodyEntry.side :
    (back && ok(bodyEntry.back)) ? bodyEntry.back :
    bodyEntry.front;
  // Shoe cosmetics restyle the single wheel (see Wheel) instead of drawing a
  // shoe overlay — the pilot rolls on one wheel now.
  const wheelVariant = { shoes_boots: "steel", shoes_glow: "neon", shoes_geta: "wood", shoes_hover: "turq" }[lo.shoes] || "brass";

  // Resolve a slot's sprite for the current facing (back art if present, else
  // reuse the front) and its anchor for this facing.
  const srcFor = (id, wantBack) => {
    const e = ACC_SRC[id];
    if (!e) return null;
    return wantBack ? (e.back || e.front) : e.front;
  };
  const anchorFor = (slot) => {
    const a = ACC_ANCHOR[slot];
    if (!a) return null;
    if (side) return a.side || a.front;   // profile reuses the front overlay art
    return back ? (a.back || a.front) : a.front;
  };

  // Build the accessory layers. Some sit BEHIND the body, some ON TOP, depending
  // on the facing. Back-to-front where on top: belt/shoes low, then weapon,
  // bandana, headpiece; the tank sits on top only when turned around.
  const behind = []; // drawn before the body
  const front = [];  // drawn after the body

  const pushAcc = (arr, slot, id, wantBack) => {
    const src = srcFor(id, wantBack);
    const an = anchorFor(slot);
    if (src && an) arr.push({ key: slot, slot, src, an });
  };

  // A full-body costume hides the overlay slots it visually covers (see
  // COVERED_BY_BODY): skip those layers while a costume is worn. The held weapon
  // and the wheel/shoes are NOT covered and always stay visible.
  const bodyCovers = !!lo.body;
  const showAcc = (slot) => !(bodyCovers && COVERED_BY_BODY.includes(slot));

  if (back) {
    // Facing away: weapon peeks from behind the body; body; then back accessories.
    if (lo.weapon) pushAcc(behind, "weapon", lo.weapon, true);
    // shoes are now the wheel base (drawn separately), not an overlay
    if (lo.belt && showAcc("belt")) pushAcc(front, "belt", lo.belt, true);
    if (lo.bandana && showAcc("bandana")) pushAcc(front, "bandana", lo.bandana, true);
    if (lo.headpiece && showAcc("headpiece")) pushAcc(front, "headpiece", lo.headpiece, true);
    if (lo.oxygenTank && showAcc("oxygenTank")) pushAcc(front, "oxygenTank", lo.oxygenTank, true); // prominent
  } else {
    // Facing camera: tank peeks from behind; body; then front accessories.
    if (lo.oxygenTank && showAcc("oxygenTank")) pushAcc(behind, "oxygenTank", lo.oxygenTank, false); // subtle
    // shoes are now the wheel base (drawn separately), not an overlay
    if (lo.belt && showAcc("belt")) pushAcc(front, "belt", lo.belt, false);
    if (lo.weapon) pushAcc(front, "weapon", lo.weapon, false);
    if (lo.bandana && showAcc("bandana")) pushAcc(front, "bandana", lo.bandana, false);
    if (lo.headpiece && showAcc("headpiece")) pushAcc(front, "headpiece", lo.headpiece, false);
    // Breather is a front-of-face piece with no profile art; hide it on the
    // E/W profile body so it doesn't float over the side of the head. It is NOT
    // in COVERED_BY_BODY — the face stays exposed under every costume, so the
    // mask still fits over the top of a full-body costume.
    if (lo.breather && !side && showAcc("breather")) pushAcc(front, "breather", lo.breather, false);
  }

  const rigAnim = playMove ? playMove.anim : moving ? "pilotWalking 0.45s infinite alternate ease-in-out" : "pilotHover 2.8s infinite ease-in-out";

  // Shared style for the body sprite. Clipped at the KNEE (bottom ~19%, matching
  // the wheel's vertical center) so the lower legs/boots are hidden and the single
  // spinning wheel reads as being mounted at the knee — the hub sits right at the
  // knee joint, like the wheel's axle is attached there.
  const bodyImgStyle = {
    position: "absolute", inset: 0,
    width: "100%", height: "100%", objectFit: "contain",
    filter: `${tint} ${onEnergy ? "hue-rotate(180deg) brightness(1.3)" : ""}`,
    imageRendering: "auto",
  };
  const onImgErr = (e) => {
    // Remember the miss so we don't retry it, then fall back down the chain:
    // this body's front sprite, else the canonical red base.
    FAILED_ART.add(pilotSrc);
    const fb = pilotSrc !== bodyEntry.front ? bodyEntry.front : PILOT_SRC;
    if (!e.currentTarget.src.endsWith(fb.slice(1))) e.currentTarget.src = fb;
  };

  const accFilter = onEnergy
    ? "brightness(1.3) hue-rotate(180deg) drop-shadow(0 1px 2px rgba(0,0,0,0.5))"
    : "drop-shadow(0 2px 3px rgba(0,0,0,0.5))";

  const renderAcc = (a) => (
    <img
      key={a.key}
      src={a.src}
      alt=""
      draggable={false}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
      style={{
        position: "absolute",
        left: a.an.left, top: a.an.top, width: a.an.width, height: a.an.height,
        transform: "translateX(-50%)",
        objectFit: "contain",
        filter: accFilter,
        pointerEvents: "none",
      }}
    />
  );

  // Outer glow / state filter (kept separate from the per-player tint so they
  // don't stack into a muddy result).
  const stateFilter = isYou
    ? (onEnergy
        ? "brightness(1.4) drop-shadow(0 0 16px rgba(70,230,255,0.9))"
        : "drop-shadow(0 0 10px rgba(255,200,61,0.85))")
    : onEnergy
        ? "brightness(1.4) drop-shadow(0 0 10px rgba(70,230,255,0.6))"
        : "drop-shadow(0 5px 5px rgba(0,0,0,0.55))";

  const W = 92 * scale;
  const H = 92 * scale;

  return (
    <div style={{
      width: W, height: H,
      transform: preview ? "none" : "translate(-50%,-80%)",
      position: preview ? "relative" : "absolute",
      margin: preview ? "0 auto" : undefined,
      pointerEvents: "none",
      opacity: eliminated ? 0.25 : onEnergy ? 0.55 : 1,
      filter: stateFilter,
      animation: onEnergy ? "ghostFloat 2s ease-in-out infinite" : undefined,
    }}>
      {/* ground shadow (iso ellipse) */}
      <div style={{ position: "absolute", left: "50%", bottom: 6, width: 46 * scale, height: 16 * scale, transform: "translateX(-50%)", background: onEnergy ? "radial-gradient(ellipse, rgba(70,230,255,0.4) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)" }} />
      {/* identity color ring — keeps each player's ID color readable even when the
          per-player hue tint is subtle (low-saturation colors like white/black/navy) */}
      {idc.hex && !eliminated && (
        <div style={{ position: "absolute", left: "50%", bottom: 4, width: 32 * scale, height: 12 * scale, transform: "translateX(-50%)", borderRadius: "50%", border: `${2.5 * scale}px solid ${idc.hex}`, boxShadow: `0 0 ${6 * scale}px ${idc.hex}`, opacity: onEnergy ? 0.6 : 0.92 }} />
      )}

      {showColorblind && (
        <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <ColorblindSymbol colorName={idc.name} colorHex={idc.hex} size={20 * scale} />
        </div>
      )}
      {/* Anime emote bubble */}
      {emote && (
        <div style={{ position: "absolute", top: -24 * scale, left: "50%", transform: "translateX(-50%)", fontSize: 20 * scale, zIndex: 15, animation: "emotePopIn 0.3s ease-out", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>
          {emote}
        </div>
      )}

      {/* flip wrapper (so emote/symbol above are never mirrored) */}
      <div style={{ width: "100%", height: "100%", transform: `${flip ? "scaleX(-1) " : ""}${lean ? `rotate(${lean}deg)` : ""}`.trim() || "none", transformOrigin: "50% 85%" }}>
        {/* accessories drawn BEHIND the body (tank peeking from the front, weapon peeking when turned around) */}
        {behind.map(renderAcc)}

        {/* WHEEL — the single spinning base for everyone, independent of body
            costume. Drawn behind the torso so the body rides above the wheel; it
            spins only while moving and bobs gently. Shoe cosmetics restyle it. */}
        {!playMove && (
          <div style={{
            position: "absolute", left: "50%", bottom: "2%",
            transform: "translateX(-50%)", width: "44%", height: "34%",
            filter: onEnergy ? "hue-rotate(180deg) brightness(1.3)" : undefined,
            animation: "padBob 2.8s ease-in-out infinite",
          }}>
            {/* Foreshorten by travel direction: a full circle rolling across the
                screen (E/W), an edge-on sliver toward/away (N/S). Spin only while
                it's round enough to read as spinning. */}
            <div style={{ width: "100%", height: "100%", transform: `scaleX(${wheelSX})`, transition: "transform 0.18s ease-out" }}>
              <Wheel moving={moving} variant={wheelVariant} rolling={wheelSX > 0.55} />
            </div>
          </div>
        )}

        {/* rig: body + on-top accessories move/bob as one unit */}
        <div style={{
          position: "absolute", inset: 0,
          transformOrigin: "50% 85%",
          animation: rigAnim,
        }}>
          <img
            src={pilotSrc}
            alt=""
            draggable={false}
            onError={onImgErr}
            style={{ ...bodyImgStyle, clipPath: playMove ? "none" : "inset(0% 0% 19% 0%)" }}
          />
          {/* worn accessories — TRUE color (no per-player tint) */}
          {front.map(renderAcc)}
        </div>
      </div>

      <style>{`
        @keyframes pilotWalking {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-1.5px) scaleY(0.992); }
        }
        /* Hover pads: thruster wash pulses; the base bobs so the pilot floats. */
        @keyframes padThrust {
          0%   { opacity: 0.55; transform: scaleX(0.9); }
          100% { opacity: 1;    transform: scaleX(1.08); }
        }
        @keyframes padBob {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50%      { transform: translateX(-50%) translateY(-1.5px); }
        }
        @keyframes wheelspin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        /* Idle hover: a very slight, almost unnoticeable float. */
        @keyframes pilotHover {
          0%, 100% { transform: translateY(0) scaleY(1); }
          50%      { transform: translateY(-2px) scaleY(1.006); }
        }
        @keyframes ghostFloat {
          0%, 100% { transform: translate(-50%,-80%) translateY(0); }
          50% { transform: translate(-50%,-80%) translateY(-6px); }
        }
        @keyframes emotePopIn {
          0% { transform: translateX(-50%) scale(0) translateY(8px); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
        }
        @keyframes emoteWave {
          0%, 100% { transform: rotate(-9deg); }
          50% { transform: rotate(9deg); }
        }
        @keyframes emoteDance {
          0%   { transform: translateY(0) rotate(-6deg) scaleY(1); }
          25%  { transform: translateY(-9px) rotate(0deg) scaleY(1.05); }
          50%  { transform: translateY(0) rotate(6deg) scaleY(0.97); }
          75%  { transform: translateY(-9px) rotate(0deg) scaleY(1.05); }
          100% { transform: translateY(0) rotate(-6deg) scaleY(1); }
        }
        @keyframes emoteHop {
          0%, 100% { transform: translateY(0) scaleY(1); }
          30% { transform: translateY(-11px) scaleY(1.06); }
          60% { transform: translateY(0) scaleY(0.95); }
        }
        @keyframes emoteBow {
          0%, 100% { transform: translateY(0) scaleY(1) skewX(0deg); }
          45%, 65% { transform: translateY(7px) scaleY(0.7) skewX(-6deg); }
        }
        @keyframes emotePeace {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-6px) rotate(4deg); }
        }
      `}</style>
    </div>
  );
}
