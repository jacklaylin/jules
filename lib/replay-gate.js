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
