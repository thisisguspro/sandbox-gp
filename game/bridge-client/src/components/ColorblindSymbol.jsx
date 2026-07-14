import React from "react";

export default function ColorblindSymbol({ colorName, colorHex, size = 24 }) {
  // Mapping the color names to SVG paths mimicking ColorADD symbols
  const SYMBOLS = {
    blue: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 12 4 L 20 20 L 4 20 Z" />
      </svg>
    ),
    green: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M 4 4 L 20 20" stroke={colorHex} strokeWidth="4" />
      </svg>
    ),
    yellow: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 4 20 L 20 4" stroke={colorHex} strokeWidth="4" />
      </svg>
    ),
    orange: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 4 20 L 20 4" stroke={colorHex} strokeWidth="4" />
        <path d="M 6 6 L 12 6 L 6 12 Z" />
      </svg>
    ),
    red: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 12 20 L 4 4 L 20 4 Z" />
      </svg>
    ),
    violet: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 4 12 L 10 4 L 16 12 Z M 8 20 L 14 12 L 20 20 Z" />
      </svg>
    ),
    brown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={colorHex}>
        <path d="M 4 20 L 20 4" stroke={colorHex} strokeWidth="4" />
        <path d="M 4 4 L 10 4 L 4 10 Z M 14 20 L 20 20 L 20 14 Z" />
      </svg>
    )
  };

  const svg = SYMBOLS[colorName] || SYMBOLS.blue;

  return (
    <div style={{
      width: size, height: size,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(224, 192, 138, 0.7)", borderRadius: "4px", padding: 2
    }}>
      {svg}
    </div>
  );
}
