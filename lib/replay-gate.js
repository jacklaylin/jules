import { openaiCost } from './usage.js';
// Pass rates for the pre-deploy replay gate (scripts/replay-gate.js). A category passes when its pass
// rate across all runs is at or above the threshold; the gate passes when every category does.
export function gateReport(results, { threshold = 0.8 } = {}) {
  const by = key => results.reduce((map, r) => map.set(r[key], [...(map.get(r[key]) ?? []), r]), new Map());
  const rateOf = list => list.filter(r => r.passed).length / list.length;
  const categories = [...by('category')].map(([category, list]) => {
    const pass_rate = rateOf(list);
    return { category, runs: list.length, passes: list.filter(r => r.passed).length, pass_rate, passed: pass_rate >= threshold };
  }).sort((a, b) => a.pass_rate - b.pass_rate || a.category.localeCompare(b.category));
  const cases = [...by('id')].map(([id, list]) => ({ id, category: list[0].category, runs: list.length, pass_rate: rateOf(list),
    failures: [...new Set(list.flatMap(r => r.failures))] })).sort((a, b) => a.pass_rate - b.pass_rate || a.id.localeCompare(b.id));
  return { threshold, passed: categories.every(c => c.passed), pass_rate: results.length ? rateOf(results) : 0, categories, cases };
}

// Running spend for one gate run, from the usage meter's priced rows. Once the cap is reached the
// gate starts no new runs; runs already in flight finish and are counted. A model missing from
// lib/usage.js PRICES is costed at the dearest known rate, and its calls are listed separately as unpriced.
export function spendTracker(cap) {
  const t = { cap, spent: 0, openai_calls: 0, searches: 0, unpriced: new Set(),
    add(rows) {
      for (const r of rows) {
        t.spent += r.cost_usd;
        if (r.provider === 'serpapi') t.searches++; else t.openai_calls++;
        if (r.provider !== 'serpapi' && openaiCost(r) === null && (r.input_tokens || r.output_tokens)) t.unpriced.add(r.model ?? 'unknown model');
      }
    },
    get capped() { return t.spent >= cap; },
  };
  return t;
}
