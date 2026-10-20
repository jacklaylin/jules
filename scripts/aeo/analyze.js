// Reads answer-engine answers for the visibility probe (scripts/aeo/probe.js): is Jules mentioned or cited,
// which domains are cited, which competitors are named, and the dated markdown report. No network here.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCE_DOMAINS, RESALE_MARKETPLACES } from '../../lib/retailers.js';

export const JULES_DOMAIN = 'textjules.com';

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}
const onDomain = (host, domain) => host === domain || host?.endsWith('.' + domain);

// "Jules" is a common first name, so a bare "Jules" only counts when it reads as the shopping service: no
// known person's surname right after it, and shopping or texting words close by. textjules.com anywhere in
// the answer or its citations is a confirmed mention. Every hit keeps an excerpt so a person can check it.
const OTHER_JULES = /^\s+(?:Verne|Kound[eé]|Winnfield|Bianchi|Massenet|Feiffer|Bledsoe|Pascin|Romains|Ferry|Dassin|Rimet|Bordet|Laforgue|Michelet|Gr[eé]vy|Bastien|Breton|Ch[eé]ret|Sitruk|et Jim|and Jim)(?!\p{L})/u;
const SHOPPING_CONTEXT = /\b(?:iMessage|texts?|texting|personal shopper|shopper|shopping|shop|price[sd]?|restocks?|sizes?|screenshots?|app|deals?|stores?|resale|dupes?|wishlist|alerts?)\b/i;
const WINDOW = 160;

const excerpt = (text, index, length) => {
  const start = Math.max(0, index - WINDOW), end = Math.min(text.length, index + length + WINDOW);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
};

export function detectMention(answer = '', citedUrls = []) {
  const text = String(answer);
  const cited = citedUrls.some(url => onDomain(hostOf(url), JULES_DOMAIN));
  const excerpts = [], ignored = [];
  for (const m of text.matchAll(/text\s?jules(?:\.com)?/gi)) excerpts.push({ kind: 'domain', text: excerpt(text, m.index, m[0].length) });
  for (const m of text.matchAll(/\bJules\b/g)) {
    if (/text\s?$/i.test(text.slice(Math.max(0, m.index - 5), m.index))) continue; // part of textjules, counted above
    const around = text.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW);
    if (OTHER_JULES.test(text.slice(m.index + m[0].length)) || !SHOPPING_CONTEXT.test(around)) ignored.push(excerpt(text, m.index, m[0].length));
    else excerpts.push({ kind: 'name', text: excerpt(text, m.index, m[0].length) });
  }
  const confidence = cited || excerpts.some(e => e.kind === 'domain') ? 'confirmed' : excerpts.length ? 'likely' : null;
  return { mentioned: Boolean(confidence), confidence, cited, excerpts: excerpts.map(e => e.text), ignored };
}

export function competitorsNamed(answer = '', competitors = []) {
  return competitors.filter(c => new RegExp(c.pattern).test(answer)).map(c => c.name);
}

// What kind of site a cited domain is, so off-site gaps leave out stores (Jules can't get listed there).
const COMMUNITY = ['reddit.com', 'quora.com', 'producthunt.com', 'news.ycombinator.com'];
const SOCIAL = ['youtube.com', 'tiktok.com', 'instagram.com', 'pinterest.com', 'x.com', 'twitter.com', 'facebook.com', 'medium.com', 'substack.com'];
const APP_STORES = ['apps.apple.com', 'play.google.com'];
export function domainKind(host) {
  const is = list => list.some(d => onDomain(host, d));
  if (onDomain(host, JULES_DOMAIN)) return 'jules';
  if (is(COMMUNITY)) return 'community';
  if (is(SOCIAL)) return 'social/video';
  if (is(APP_STORES)) return 'app store';
  if (is(RESALE_MARKETPLACES)) return 'resale store';
  if (is(SOURCE_DOMAINS)) return 'store';
  return 'editorial/other';
}

export function analyzeAnswer(parsed, competitors) {
  const cited_domains = [...new Set(parsed.cited_urls.map(hostOf).filter(Boolean))];
  const source_domains = [...new Set(parsed.source_urls.map(hostOf).filter(Boolean))];
  return { ...parsed, cited_domains, source_domains, mention: detectMention(parsed.answer, parsed.cited_urls), competitors: competitorsNamed(parsed.answer, competitors) };
}

const countBy = items => items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

// Totals the report and the next run's comparison are built from.
export function summarize(run) {
  const answered = run.results.filter(r => r.ok);
  const engines = run.engines.map(e => {
    const rows = answered.filter(r => r.engine === e.id);
    return { id: e.id, label: e.label, model: e.model, status: e.status, note: e.note ?? null, answers: rows.length,
      mentioned: rows.filter(r => r.mention.mentioned).length, confirmed: rows.filter(r => r.mention.confidence === 'confirmed').length,
      cited: rows.filter(r => r.mention.cited).length, errors: run.results.filter(r => r.engine === e.id && !r.ok).length,
      cost_usd: rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0) };
  });
  const questions = run.questions.map(q => {
    const rows = answered.filter(r => r.question_id === q.id);
    return { id: q.id, text: q.text, job: q.job, answers: rows.length, mentioned_by: rows.filter(r => r.mention.mentioned).map(r => r.engine),
      top_domains: top(countBy(rows.flatMap(r => r.cited_domains)), 5), competitors: [...new Set(rows.flatMap(r => r.competitors))] };
  });
  const competitors = top(countBy(answered.flatMap(r => r.competitors)), 50);
  // Off-site gaps: non-store domains cited for two or more different questions in answers that left Jules
  // out. Those are the pages answer engines trust for these questions, so a mention there could carry over.
  const gapRows = answered.filter(r => !r.mention.mentioned);
  const byDomain = new Map();
  for (const r of gapRows) for (const d of r.cited_domains) {
    if (!['community', 'social/video', 'app store', 'editorial/other'].includes(domainKind(d))) continue;
    const entry = byDomain.get(d) ?? { domain: d, kind: domainKind(d), questions: new Set(), answers: 0 };
    entry.questions.add(r.question_id); entry.answers++; byDomain.set(d, entry);
  }
  const gaps = [...byDomain.values()].filter(g => g.questions.size >= 2).map(g => ({ ...g, questions: [...g.questions].sort() }))
    .sort((a, b) => b.questions.length - a.questions.length || b.answers - a.answers || a.domain.localeCompare(b.domain));
  return { engines, questions, competitors, gaps, cost_usd: engines.reduce((s, e) => s + e.cost_usd, 0) };
}

// The most recent earlier run in the reports folder, if any.
export function findPrevious(dir, date) {
  if (!existsSync(dir)) return null;
  const earlier = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < date).sort();
  return earlier.length ? JSON.parse(readFileSync(join(dir, earlier.at(-1)), 'utf8')) : null;
}

const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '–';
const usd = n => `$${n.toFixed(2)}`;
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function comparison(current, previous) {
  const lines = [`## Compared with ${previous.date}`, ''];
  const prev = new Map(previous.summary.engines.map(e => [e.id, e]));
  lines.push('| Engine | Then | Now |', '|---|---|---|');
  for (const e of current.summary.engines) {
    const p = prev.get(e.id);
    lines.push(`| ${e.label} | ${p && p.answers ? `${p.mentioned}/${p.answers}` : 'not run'} | ${e.answers ? `${e.mentioned}/${e.answers}` : 'not run'} |`);
  }
  const before = new Map(previous.summary.questions.map(q => [q.id, new Set(q.mentioned_by)]));
  const changes = [];
  for (const q of current.summary.questions) {
    const was = before.get(q.id) ?? new Set(), now = new Set(q.mentioned_by);
    const gained = [...now].filter(e => !was.has(e)), lost = [...was].filter(e => !now.has(e));
    if (!before.has(q.id)) changes.push(`- New question \`${q.id}\`.`);
    if (gained.length) changes.push(`- \`${q.id}\`: now mentioned by ${gained.join(', ')}.`);
    if (lost.length) changes.push(`- \`${q.id}\`: no longer mentioned by ${lost.join(', ')}.`);
  }
  const oldGaps = new Set(previous.summary.gaps.map(g => g.domain));
  const newGaps = current.summary.gaps.filter(g => !oldGaps.has(g.domain)).map(g => g.domain);
  if (newGaps.length) changes.push(`- New off-site gaps: ${newGaps.join(', ')}.`);
  lines.push('', ...(changes.length ? changes : ['No change in which answers mention Jules.']));
  if (previous.questions_version !== current.questions_version) lines.push('', `Question list changed (version ${previous.questions_version} → ${current.questions_version}), so per-question changes may reflect the list, not the engines.`);
  return lines;
}

export function renderReport(run, previous = null) {
  const s = run.summary;
  const lines = [
    `# Answer-engine visibility — ${run.date}`,
    '',
    `Asked ${run.questions.length} shopper questions (scripts/aeo/questions.json, version ${run.questions_version}) to each answer engine with web search on, once each. Questions never name Jules. Raw answers: [${run.date}.json](${run.date}.json).`,
    '',
    '"Mentioned" = textjules.com appears in the answer or its citations (confirmed), or "Jules" appears next to shopping words (likely; check the excerpt below). "Cited" = an answer links to textjules.com.',
    '',
    '## Summary',
    '',
    '| Engine | Model | Mentioned | Confirmed | Cited textjules.com | Errors | Est. cost |',
    '|---|---|---|---|---|---|---|',
    ...s.engines.map(e => e.status === 'ran'
      ? `| ${e.label} | \`${e.model}\` | ${e.mentioned}/${e.answers} (${pct(e.mentioned, e.answers)}) | ${e.confirmed} | ${e.cited} | ${e.errors} | ${usd(e.cost_usd)} |`
      : `| ${e.label} | \`${e.model}\` | skipped: ${cell(e.note)} | | | | |`),
    '',
    `Estimated total: ${usd(s.cost_usd)} (list prices; provider invoices are the source of truth).`,
    '',
  ];
  if (previous) lines.push(...comparison(run, previous), '');
  const mentions = run.results.filter(r => r.ok && r.mention.mentioned);
  lines.push('## Mentions', '');
  if (!mentions.length) lines.push('No answer mentioned Jules.');
  for (const r of mentions) lines.push(`- **${r.engine}**, \`${r.question_id}\` (${r.mention.confidence}${r.mention.cited ? ', cited' : ''}): ${r.mention.excerpts.map(e => `"${cell(e)}"`).join(' / ') || 'cited only'}`);
  const ignored = run.results.filter(r => r.ok && r.mention.ignored.length);
  if (ignored.length) lines.push('', 'Not counted ("Jules" without shopping context or as another person\'s name):', ...ignored.map(r => `- ${r.engine}, \`${r.question_id}\`: "${cell(r.mention.ignored[0])}"`));
  lines.push('', '## Questions', '', '| Question | Job | Mentioned by | Top cited domains | Competitors named |', '|---|---|---|---|---|');
  for (const q of s.questions) lines.push(`| ${cell(q.text)} | ${q.job} | ${q.mentioned_by.join(', ') || '—'} | ${q.top_domains.map(([d, n]) => `${d} (${n})`).join(', ') || '—'} | ${q.competitors.join(', ') || '—'} |`);
  lines.push('', '## Competitors named', '', s.competitors.length ? s.competitors.map(([name, n]) => `${name} (${n})`).join(', ') : 'None.', '');
  lines.push('## Off-site gaps', '', 'Non-store sites cited for two or more questions in answers that left Jules out. A genuine, disclosed mention there (a Reddit answer, a roundup, an app listing) is the likeliest way into these answers. Founder work, not code; never post without disclosure.', '');
  if (!s.gaps.length) lines.push('None this run.');
  else lines.push('| Domain | Kind | Questions | Answers |', '|---|---|---|---|', ...s.gaps.map(g => `| ${g.domain} | ${g.kind} | ${g.questions.length} (${g.questions.join(', ')}) | ${g.answers} |`));
  const failed = run.results.filter(r => !r.ok);
  if (failed.length) lines.push('', '## Errors', '', ...failed.map(r => `- ${r.engine}, \`${r.question_id}\`: ${cell(r.error)}`));
  return lines.join('\n') + '\n';
}
