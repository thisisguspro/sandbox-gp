import { useId } from "react";

// Inline currency icons for the two nugget currencies. Silver = raw mined ore
// (cool gray), Gold = gold nugget (warm amber). Pure SVG so it scales crisply at
// any size and needs no art asset. Used everywhere a currency amount is shown.
export default function NuggetIcon({ variant = "gold", size = 18, style }) {
  const rid = useId().replace(/[:]/g, "");
  const id = `nug-${variant}-${rid}`;
  const g = variant === "silver"
    ? { hi: "#eef3f9", mid: "#bcc7d4", lo: "#7f8a99", edge: "#586271" }
    : { hi: "#ffe9a8", mid: "#ffc23d", lo: "#d98a1f", edge: "#a5641a" };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="85%">
          <stop offset="0%" stopColor={g.hi} />
          <stop offset="48%" stopColor={g.mid} />
          <stop offset="100%" stopColor={g.lo} />
        </radialGradient>
      </defs>
      <path
        d="M6.5 9 L10 3.8 L16 5 L20 10.2 L17.8 17.2 L11 20 L3.8 15.8 Z"
        fill={`url(#${id})`}
        stroke={g.edge}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9 7.6 L12.2 9.6 M14.4 8.8 L13.2 12.8 M7.8 12.8 L11 14"
        stroke={g.hi}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.65"
        fill="none"
      />
    </svg>
  );
}
