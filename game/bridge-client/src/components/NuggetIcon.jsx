import { useId } from "react";

// The two currencies, drawn inline.
//
//   SEA GLASS — the in-game currency. A tumbled shard of bottle glass: frosted,
//               sea-worn, faceted. Earned racing, earned recycling, spent on
//               chests and crafting alike.
//   SHELL     — the cash currency. A scallop shell: warm, ridged, obviously
//               precious. Bought with real money, spent on premium cosmetics.
//
// Pure SVG, so they scale crisply and need no art asset. The component is still
// called NuggetIcon because it's imported in a dozen places and the name is
// load-bearing; the "silver"/"gold" variants map to glass/shell.
export default function NuggetIcon({ variant = "gold", size = 18, style }) {
  const rid = useId().replace(/[:]/g, "");
  const id = `cur-${variant}-${rid}`;
  const isGlass = variant === "silver";

  if (isGlass) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, ...style }} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d8fbff" />
            <stop offset="45%" stopColor="#6fe3d2" />
            <stop offset="100%" stopColor="#2a9d8f" />
          </linearGradient>
        </defs>
        {/* a tumbled shard — irregular, sea-worn, no sharp corners */}
        <path
          d="M7.2 3.6 L16.4 4.8 L20.6 11.2 L17.2 19.4 L8.6 20.8 L3.6 14.6 L4.4 7.4 Z"
          fill={`url(#${id})`}
          stroke="#1c7d72"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        {/* the frosted highlight that says "glass, not gem" */}
        <path d="M8.4 6.4 L13.4 7.0 L10.6 12.2 L6.6 10.4 Z" fill="#ffffff" opacity="0.42" />
        <path d="M15.4 12.4 L17.8 13.6 L15.4 17.2 Z" fill="#ffffff" opacity="0.22" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#fff2d8" />
          <stop offset="50%" stopColor="#ffc98a" />
          <stop offset="100%" stopColor="#e08a4a" />
        </linearGradient>
      </defs>
      {/* a scallop shell: fan body, hinge at the bottom */}
      <path
        d="M12 21.4 C5.4 21.4 2.2 15.2 2.6 9.8 C2.9 5.6 7.2 2.6 12 2.6 C16.8 2.6 21.1 5.6 21.4 9.8 C21.8 15.2 18.6 21.4 12 21.4 Z"
        fill={`url(#${id})`}
        stroke="#b5652c"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* the ribs — what makes it read as a shell at 14px */}
      {[-3.4, -1.7, 0, 1.7, 3.4].map((dx, i) => (
        <path
          key={i}
          d={`M12 20.6 L${12 + dx * 1.7} ${5.4 + Math.abs(dx) * 0.5}`}
          stroke="#c9762f"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.65"
        />
      ))}
      {/* the hinge */}
      <path d="M10.4 20.8 Q12 22.6 13.6 20.8 Z" fill="#b5652c" />
    </svg>
  );
}
