import React from 'react';

// Measurement-metaphor preview shown under a Likert question in the Builder.
export default function Ruler({ min, max, color = 'var(--accent)', labels }) {
  const points = [];
  for (let i = min; i <= max; i++) points.push(i);
  return (
    <div className="ruler">
      <div className="rulerLine" style={{ background: color }} />
      {points.map((p, i) => (
        <div className="rulerPoint" key={p} style={{ left: `${((p - min) / (max - min)) * 100}%` }}>
          <span className="rulerTick" style={{ background: color }} />
          <span className="rulerNum">{p}</span>
          {labels && labels[i] && <span className="rulerLabel">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}
