// Areas of chat behaviour, so a PR runs only the eval cases in the area it touches (CHAT-DEVELOPMENT.md "The
// gate"). A frozen case's areas come from what its turn did (the original turn's tools and the tools replays of
// it chose, read from stored runs) and the shopping state it started from; a routing eval case's from its
// category. Changed files map to areas; a file every turn reads (the agent loop, the composer, the core skill)
// maps to none, so the PR has to name its area with --area and the nightly full run covers the rest.
export const AREAS = ['saves', 'alerts', 'consent', 'search', 'brand', 'price', 'options', 'profile', 'history', 'onboarding', 'conversation'];
// Trust areas: a case in one of these that flips to failing blocks the merge.
export const TRUST_AREAS = ['saves', 'alerts', 'consent', 'price'];

const TOOL_AREAS = {
  save_to_wishlist: ['saves', 'consent'], manage_price_alerts: ['alerts', 'consent'], add_liked_items: ['saves'], wishlist_status: ['saves'], record_wishlist_purchase: ['saves'],
  find_products: ['search'], ask_shopping_question: ['search'], respond_to_options: ['options'],
  update_profile: ['profile'], profile_status: ['profile'], style_interview: ['profile', 'onboarding'], onboarding: ['onboarding'],
  read_screenshot_products: ['history'], add_order_screenshot: ['history'], manage_purchase_texts: ['history'], purchase_history: ['history'],
  conversation_reply: ['conversation'], record_quality_signal: ['conversation'],
};
// A search plan's own fields: brands in a role other than required (a reference or a dropped brand), or a price stance or limit.
const planAreas = plan => [...((plan?.brands ?? []).some(b => b?.role && b.role !== 'required') ? ['brand'] : []),
  ...(plan?.price && (plan.price.stance || plan.price.max != null || plan.price.min != null) ? ['price'] : [])];
const toolAreas = t => [...(TOOL_AREAS[t?.name ?? t?.tool] ?? []), ...planAreas(t?.args?.search_plan)];

// c: a frozen case; replayTools: tools replays of it ran (from stored runs). Every case is at least in conversation.
export function frozenAreas(c, replayTools = []) {
  const areas = new Set([...(c.original?.actions ?? []).flatMap(toolAreas), ...replayTools.flatMap(toolAreas)]);
  if (c.pending?.selected_set?.length) { areas.add('saves'); areas.add('consent'); }
  if (!areas.size || c.category === 'reply_quality' || c.category === 'repeated') areas.add('conversation');
  return AREAS.filter(a => areas.has(a));
}

const CATEGORY_AREAS = {
  alerts: ['alerts'], ask: ['search'], bottoms: ['search'], tops: ['search'], brand: ['brand'], checkout: ['saves'], consent: ['consent'],
  conversation: ['conversation'], department: ['search'], goes_with: ['search', 'conversation'], history: ['history'], interview: ['onboarding', 'profile'],
  level: ['search'], memory: ['profile'], 'multi-step': ['saves', 'search'], occasion: ['search'], onboarding: ['onboarding'], options: ['options'],
  other: ['conversation'], price: ['price'], profile: ['profile'], purchase_texts: ['history'], quality: ['conversation'], reports: ['conversation'],
  save: ['saves', 'consent'], search: ['search'], selection: ['options', 'saves'], threads: ['conversation', 'options'], wishlist: ['saves'], wishlist_purchase: ['saves', 'history'],
};
export const routingAreas = category => CATEGORY_AREAS[category] ?? ['conversation'];

// Changed files → areas. null: a file every turn reads, which can't be narrowed to an area.
const FILE_AREAS = [
  [/^lib\/skills\/(core|router|index)\.js$/, null], [/^lib\/(ai|compose|inbox|models|model-call|user-context|message-context|context-guide)\.js$/, null],
  [/^lib\/skills\/(find_exact|explore)\.js$/, ['search', 'brand']], [/^lib\/skills\/better_price\.js$/, ['price', 'search']],
  [/^lib\/skills\/options\.js$/, ['options']], [/^lib\/skills\/save_or_watch\.js$/, ['saves', 'alerts', 'consent']], [/^lib\/skills\/saved_items\.js$/, ['saves', 'alerts']],
  [/^lib\/skills\/profile\.js$/, ['profile']], [/^lib\/skills\/history\.js$/, ['history']], [/^lib\/skills\/conversation\.js$/, ['conversation']],
  [/^lib\/(text-wishlist|wishlist-selection|wishlist)\.js$/, ['saves', 'options', 'consent']], [/^lib\/(alerts?|price-alerts?|monitor[\w-]*)\.js$/, ['alerts']],
  [/^lib\/(memory|profile[\w-]*|sizes?[\w-]*|brand-taste)\.js$/, ['profile']], [/^lib\/(purchase[\w-]*|receipts?[\w-]*|wardrobe[\w-]*|gmail[\w-]*)\.js$/, ['history']],
  [/^lib\/(onboarding|interview)[\w-]*\.js$/, ['onboarding']], [/^lib\/(shopping-context|search[\w-]*|discovery[\w-]*|retailers|sourcing[\w-]*)\.js$/, ['search']],
  [/^lib\/(price-stance|goes-with)\.js$/, ['price', 'search']],
];
// Areas the changed files touch: { areas, shared: files every turn reads, unmapped: chat-irrelevant files ignored }.
export function areasForFiles(files) {
  const areas = new Set(), shared = [], unmapped = [];
  for (const f of files) {
    const hit = FILE_AREAS.find(([re]) => re.test(f));
    if (!hit) unmapped.push(f); else if (!hit[1]) shared.push(f); else hit[1].forEach(a => areas.add(a));
  }
  return { areas: AREAS.filter(a => areas.has(a)), shared, unmapped };
}
export function parseAreas(text) {
  const list = String(text ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const unknown = list.filter(a => !AREAS.includes(a));
  if (unknown.length) throw Error(`Unknown area ${unknown.join(', ')}: use ${AREAS.join(', ')}`);
  return list;
}

// ---- Comparing two sets of runs case by case ----
// Each case's runs: passes, runs, areas and failure reasons. A case "passes" when it passed in most of its runs.
export function caseVotes(results) {
  const map = new Map();
  for (const r of results ?? []) {
    if (r.skipped) continue;
    const e = map.get(r.id) ?? { passes: 0, runs: 0, areas: r.areas ?? [], failures: new Set() };
    e.runs++; if (r.passed && !r.error) e.passes++; else (r.failures ?? []).forEach(f => e.failures.add(f));
    map.set(r.id, e);
  }
  return map;
}
export const majorityPasses = e => e.passes / e.runs > 0.5;
// Cases in both that flipped: fell (passed before, fails now; trust: in a trust area) and rose; added: only in after.
export function caseFlips(before, after) {
  const a = caseVotes(before), b = caseVotes(after);
  const flips = [...b].filter(([id]) => a.has(id) && majorityPasses(a.get(id)) !== majorityPasses(b.get(id)))
    .map(([id, e]) => ({ id, was: a.get(id), now: e, trust: e.areas.some(x => TRUST_AREAS.includes(x)) }));
  return { fell: flips.filter(f => !majorityPasses(f.now)), rose: flips.filter(f => majorityPasses(f.now)), added: [...b.keys()].filter(id => !a.has(id)), before: a, after: b };
}
// A case's recent nights, oldest first (✓ passed, ✗ failed, · not run): ✓✓✓✗ points at that day's merges, ✓✗✓✗ is noise.
export const nightHistory = (nights, id) => nights.map(n => { const e = caseVotes(n.results).get(id); return e ? (majorityPasses(e) ? '✓' : '✗') : '·'; }).join('');
