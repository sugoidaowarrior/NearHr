"use client";

/* Abstract 3D glass torus, top right, matching the Nexora reference:
   emerald lit inner wall, magenta far edge, blue left rim. */
export function GlassRing({ className = "" }: { className?: string }) {
  const r = 170;
  const cx = 300;
  const cy = 300;
  return (
    <div className={`ring-3d ${className}`} aria-hidden="true">
      <div className="ring-3d-float h-full w-full">
        <svg viewBox="0 0 600 600" className="ring-3d-spin h-full w-full" fill="none">
          <defs>
            <linearGradient id="ringOuter" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#35f06a" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#16c98a" stopOpacity="0.5" />
              <stop offset="62%" stopColor="#16c98a" stopOpacity="0.12" />
              <stop offset="82%" stopColor="#e879f0" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id="ringInner" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8bf5b0" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#22c55e" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0c2d1c" stopOpacity="0.2" />
            </linearGradient>
            <radialGradient id="ringHaze" cx="50%" cy="42%" r="55%">
              <stop offset="0%" stopColor="#35f06a" stopOpacity="0.2" />
              <stop offset="60%" stopColor="#35f06a" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#35f06a" stopOpacity="0" />
            </radialGradient>
            <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="14" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* soft ambient haze behind the torus */}
          <circle cx={cx} cy={cy} r="285" fill="url(#ringHaze)" />

          {/* outer glass wall */}
          <circle cx={cx} cy={cy} r={r + 34} stroke="url(#ringOuter)" strokeWidth="58" strokeOpacity="0.55" filter="url(#softGlow)" />
          {/* inner lit rim */}
          <circle cx={cx} cy={cy} r={r + 6} stroke="url(#ringInner)" strokeWidth="20" strokeOpacity="0.9" />
          {/* thin bright highlight arc top left */}
          <circle
            cx={cx}
            cy={cy}
            r={r + 34}
            stroke="#c8ffbf"
            strokeWidth="2.5"
            strokeOpacity="0.65"
            strokeDasharray="210 1000"
            strokeLinecap="round"
            transform={`rotate(-150 ${cx} ${cy})`}
          />
          {/* inner dark glass */}
          <circle cx={cx} cy={cy} r={r - 32} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
