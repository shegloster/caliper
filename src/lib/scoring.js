// Construct scoring, descriptive stats, and Cronbach's alpha.
// Pure functions, no Supabase dependency, so they're easy to unit test.

export function scoreConstruct(constructId, questions, raw) {
  const items = questions.filter((q) => q.construct_id === constructId && q.type === 'likert');
  if (!items.length) return null;
  let weightedSum = 0, weightTotal = 0;
  items.forEach((q) => {
    const val = raw[q.id];
    if (val == null) return;
    const scored = q.reverse_coded ? q.scale_min + q.scale_max - val : val;
    const pct = ((scored - q.scale_min) / (q.scale_max - q.scale_min)) * 100;
    weightedSum += pct * q.weight;
    weightTotal += q.weight;
  });
  return weightTotal ? weightedSum / weightTotal : null;
}

export function meanSD(values) {
  if (!values.length) return { mean: null, sd: null };
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1) : 0;
  return { mean: m, sd: Math.sqrt(variance) };
}

export function cronbachAlpha(items, responsesByQuestion) {
  const k = items.length;
  if (k < 2) return null;
  const itemSeries = items.map((q) => responsesByQuestion[q.id]?.filter((v) => v != null) ?? []);
  if (itemSeries.some((s) => s.length < 2)) return null;
  const variance = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1); };
  const itemVariances = itemSeries.map(variance);
  const n = itemSeries[0].length;
  const totals = Array.from({ length: n }).map((_, i) => itemSeries.reduce((sum, series) => sum + series[i], 0));
  const totalVar = variance(totals);
  if (!totalVar) return null;
  return (k / (k - 1)) * (1 - itemVariances.reduce((a, b) => a + b, 0) / totalVar);
}

export function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom ? num / denom : null;
}

export function skewness(values) {
  const n = values.length;
  if (n < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (!sd) return null;
  const m3 = values.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  return m3 / sd ** 3;
}

// Corrected item-total correlation: each item's raw (reverse-coding-adjusted) score
// against the sum of the other items in its construct, for complete cases only.
export function itemTotalCorrelations(constructId, questions, rawResponses) {
  const items = questions.filter((q) => q.construct_id === constructId && q.type === 'likert');
  const scoredValue = (q, raw) => {
    const v = raw[q.id];
    if (v == null) return null;
    return q.reverse_coded ? q.scale_min + q.scale_max - v : v;
  };
  return items.map((q) => {
    const itemVals = [], totalVals = [];
    rawResponses.forEach((raw) => {
      if (items.some((iq) => raw[iq.id] == null)) return;
      itemVals.push(scoredValue(q, raw));
      totalVals.push(items.filter((iq) => iq.id !== q.id).reduce((s, iq) => s + scoredValue(iq, raw), 0));
    });
    return { question: q, r: pearsonR(itemVals, totalVals), n: itemVals.length };
  });
}

export function constructCorrelationMatrix(constructs, questions, rawResponses, scoreConstructFn) {
  const scores = constructs.map((c) => rawResponses.map((raw) => scoreConstructFn(c.id, questions, raw)));
  return constructs.map((c1, i) =>
    constructs.map((c2, j) => {
      const xs = [], ys = [];
      scores[i].forEach((v, k) => {
        const w = scores[j][k];
        if (v != null && w != null) { xs.push(v); ys.push(w); }
      });
      return pearsonR(xs, ys);
    })
  );
}

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'instrument';
}
