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

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'instrument';
}
