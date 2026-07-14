import { useState } from "react";

// Renders a cosmetic item's drawn art (public/items/<id>.png), falling back to
// a neutral western star glyph if the art is missing or fails to load. Keyed by
// the cosmetic id so every item in the catalogue can have its own unique icon.

export default function ItemIcon({ id, slot, color = "var(--r-common)", size = "82%", glyphSize = 30, dim = false }) {
  const [failed, setFailed] = useState(false);

  if (id && !failed) {
    return (
      <img
        src={`./items/${id}.png`}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        style={{
          width: size, height: size, objectFit: "contain",
          opacity: dim ? 0.3 : 1,
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.55))",
        }}
      />
    );
  }
  return (
    <span className="display" style={{ fontSize: glyphSize, color, opacity: dim ? 0.25 : 0.9 }}>
      ★
    </span>
  );
}
