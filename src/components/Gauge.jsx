import React from 'react';

// Analog instrument dial — needle + tick marks, no filled progress ring.
export default function Gauge({ value, label, color = '#C1440E', size = 84 }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const sweep = 240, start = -210;
  const angle = start + (pct / 100) * sweep;
  const cx = size / 2, cy = size / 2, rOuter = size / 2 - 3, needleLen = size / 2 - 14;
  const toXY = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [nx, ny] = toXY(angle, needleLen);

  return (
    <div className="gaugeWrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="var(--grid)" strokeWidth="1" />
        {Array.from({ length: 13 }).map((_, i) => {
          const a = start + (i / 12) * sweep, major = i % 3 === 0;
          const [x1, y1] = toXY(a, rOuter - (major ? 8 : 4));
          const [x2, y2] = toXY(a, rOuter - 1);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth={major ? 1.4 : 0.7} opacity={major ? 0.55 : 0.28} />;
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2" strokeLinecap="round" style={{ transition: 'all 0.5s ease' }} />
        <circle cx={cx} cy={cy} r="3" fill={color} />
      </svg>
      <div className="gaugeReadout">
        {value == null ? '—' : Math.round(value)}
        {value != null && <span className="gaugeUnit">%</span>}
      </div>
      {label && <div className="gaugeLabel">{label}</div>}
    </div>
  );
}
