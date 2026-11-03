"use client";

/* 12 column hairline grid, fixed to the viewport. The signature of the
   Obys grids03 composition. Positions are percentages so it is
   resolution independent. */
const POSITIONS = Array.from({ length: 11 }, (_, i) => ((i + 1) / 12) * 100);

export function GridLines() {
  return (
    <div className="grid-lines" aria-hidden>
      {POSITIONS.map((p) => (
        <i key={p} style={{ left: `calc(${p}% - 0.5px)` }} />
      ))}
    </div>
  );
}
