// Live eval of the request-fit check (lib/request-fit.js) on labelled listings: does the model, after code's
// quote check, leave out listings that contradict the request and keep those that fit or don't say?
// Graded on the outcome (left out or kept), never on the model's wording. The listings are made up from
// shapes seen in production; no personal data. Each case runs --runs times (default 3).
//   node --env-file=.env.local scripts/request-fit-eval.js [--runs 3]
import { requestFit } from '../lib/request-fit.js';

const args = process.argv.slice(2), runs = Number(args[args.indexOf('--runs') + 1] || 3) || 3;
const listing = (name, color, description) => ({ brand: 'Brand', name, url: 'https://store.example/products/' + name.toLowerCase().replace(/\W+/g, '-'), listing_check: { status: 'verified', product_name: name, color, description } });
const redZip = ['bright red', 'half-zip sweater'];
// [id, hard_constraints, listing, expected: 'drop' | 'keep']
export const CASES = [
  ['aran-off-white-crewneck', redZip, listing('Aran Cable Crewneck', 'Off-White', 'A classic Aran cable knit crewneck in undyed wool.'), 'drop'],
  ['red-chunky-half-zip', redZip, listing('Chunky Knit Half-Zip Sweater', 'Bright Red', 'A chunky rib half-zip in soft lambswool.'), 'keep'],
  ['shade-of-red', redZip, listing('Ribbed Half Zip Pullover', 'Crimson', 'Ribbed merino half-zip pullover.'), 'keep'],
  ['red-full-zip', redZip, listing('Cable Full-Zip Cardigan', 'Red', 'A cable knit cardigan with a full-length zip.'), 'drop'],
  ['colour-unstated', redZip, listing('Chunky Half Zip', null, 'A heavyweight half-zip knit.'), 'keep'],
  ['ecru-page-red-offered', redZip, listing('Fisherman Half-Zip', 'Ecru', 'Also available in red and navy.'), 'drop'],
  ['department-not-judged', redZip, listing("Women's Cashmere Half-Zip", 'Red', 'A relaxed cashmere half-zip.'), 'keep'],
  ['navy-oxford-fits', ['oxford shirt', 'navy'], listing('Button-Down Oxford Shirt', 'Navy', 'Cotton oxford cloth button-down.'), 'keep'],
  ['black-leather-for-brown-suede', ['chelsea boots', 'brown suede'], listing('Leather Chelsea Boot', 'Black', 'Polished black calf leather Chelsea boot.'), 'drop'],
  ['snuff-suede-chelsea', ['chelsea boots', 'brown suede'], listing('Chelsea Boot', 'Snuff Suede', 'Suede Chelsea boot with a crepe sole.'), 'keep'],
  ['cotton-for-linen', ['camp collar shirt', 'linen'], listing('Camp Collar Shirt', 'Sand', 'Made from 100% cotton poplin.'), 'drop'],
  ['linen-camp-collar', ['camp collar shirt', 'linen'], listing('Linen Camp Collar Shirt', 'Sand', 'Washed linen with a camp collar.'), 'keep'],
];

let pass = 0, total = 0;
const env = process.env;
if (!env.OPENAI_API_KEY) throw Error('Use node --env-file=.env.local scripts/request-fit-eval.js');
for (const [id, hard_constraints, product, expected] of CASES) {
  const outcomes = [];
  for (let r = 0; r < runs; r++) {
    const record = {};
    const dropped = await requestFit([product], { requested: { hard_constraints }, env, record });
    outcomes.push(record.request_fit?.failed ? 'failed' : dropped.size ? 'drop' : 'keep');
  }
  const ok = outcomes.filter(o => o === expected).length;
  pass += ok; total += runs;
  console.log(`${ok === runs ? 'PASS' : 'FAIL'} ${id.padEnd(32)} expected ${expected}, got ${outcomes.join(',')}`);
}
console.log(`\n${pass}/${total} runs as expected`);
