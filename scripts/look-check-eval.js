// Live eval of the look check (lib/look-check.js) on labelled listings: does it leave out a candidate clearly
// unlike the look (the user's own brands when the request names none, named brands, or a level asked for)
// and keep unfamiliar brands close to it? Graded on the outcome (left out or kept), never on wording.
// "Hidden" counts good finds left out, the risk this check carries. Listings are made up from shapes seen
// in production (October 20–22, incl. dev-108fce7f); no personal data. Each case runs --runs times (default 3).
// Use the local evals key (CHAT-DEVELOPMENT.md rule 10).
//   node --env-file=.env.local scripts/look-check-eval.js [--runs 3]
import { lookCheck, lookFor } from '../lib/look-check.js';

const args = process.argv.slice(2), runs = Number(args[args.indexOf('--runs') + 1] || 3) || 3;
const taste = brands => [{ field: 'brand_taste', key: 'summary', value: JSON.stringify({ brands: brands.map(([brand, how]) => ({ brand, ...how })) }) }];
const listing = (brand, name, amount, description) => ({ brand, name, url: 'https://' + brand.toLowerCase().replace(/\W+/g, '') + '.example/products/' + name.toLowerCase().replace(/\W+/g, '-'),
  match: 'similar', sourcing_status: 'store_found', price_snapshot: { amount, currency: 'USD' }, listing_check: { status: 'verified', product_brand: brand, product_name: name, description } });
const designer = taste([['Saint Laurent', { said: { value: 'favorite brand' } }], ['Prada', { said: { value: 'favorite brand' } }], ['Dries Van Noten', { said: { value: 'favorite brand' }, bought: 2 }], ['MFPEN', { bought: 3, wishlisted: 2 }], ['Wales Bonner', { bought: 1 }], ['JW Anderson', { wishlisted: 1 }]]);
const street = taste([['Stüssy', { bought: 4 }], ['Carhartt WIP', { bought: 3 }], ['Nike', { bought: 5, liked: 2 }]]);
const everyday = taste([['Uniqlo', { bought: 6 }], ['J.Crew', { bought: 3 }], ['Everlane', { wishlisted: 2 }]]);
// [id, look input (lookFor), [[listing, expected: 'keep' | 'out'], ...]]
export const CASES = [
  ['own-designer: red half-zip (dev-108fce7f)', { facts: designer }, [
    [listing('Filling Pieces', 'Zip Knit Chunky Fisherman Scarlet Red', 310, 'Chunky fisherman knit half-zip with a clean shape, made in Portugal.'), 'keep'],
    [listing('ReefKnots', 'Burford Chunky Knit Half Zip - Deep Red', 151, 'Elevate your cold-weather wardrobe with our chunky knit half zip in a soft cotton blend, perfect for the pub or the coast.'), 'out'],
    [listing('Our Legacy', 'Half Zip Chunky Knit Red', 420, 'Heavy-gauge wool half-zip with a dropped shoulder.'), 'keep'],
    [listing('Norse Projects', 'Chunky Lambswool Half Zip Red', 260, 'Chunky lambswool half-zip.'), 'keep'],
    [listing("Howlin'", 'Shetland Half Zip Red', 240, 'Shetland wool half-zip knitted in Scotland.'), 'keep']]],
  ['own-designer: unfamiliar but close', { facts: designer }, [
    [listing('Kaptain Sunshine', 'Half Zip Wool Knit Red', 480, 'Hand-framed Japanese wool knit with a stand collar.'), 'keep'],
    [listing('Lemaire', 'Half Zip Sweater Red', 690, 'Relaxed half-zip in a dense wool and alpaca blend.'), 'keep'],
    [listing('Boohooman', 'Chunky Knit Half Zip Jumper Red', 38, 'Our chunky knit jumper with half zip, a weekend wardrobe staple.'), 'out'],
    [listing('Peter Christian', "Gentlemen's Half Zip Jumper Red", 89, "Gentlemen's classic half zip jumper, ideal for golf."), 'out']]],
  ['own-streetwear: grey hoodie', { facts: street }, [
    [listing('Aimé Leon Dore', 'Heavyweight Hoodie Heather Grey', 225, 'Brushed fleece hoodie with a boxy fit.'), 'keep'],
    [listing('Noah', 'Classic Hoodie Grey', 168, 'Heavyweight cotton fleece hoodie made in Canada.'), 'keep'],
    [listing('Brioni', 'Cashmere Hooded Sweater Grey', 2450, 'Tailored hooded cashmere knit from the Roman atelier, for refined leisure.'), 'out']]],
  ['own-everyday: blue oxford', { facts: everyday }, [
    [listing('Gap', 'Oxford Shirt Light Blue', 60, 'Classic cotton oxford with a button-down collar.'), 'keep'],
    [listing('Muji', 'Washed Oxford Shirt Blue', 39, 'Washed organic cotton oxford, relaxed fit.'), 'keep'],
    [listing('Todd Snyder', 'Japanese Oxford Shirt Blue', 148, 'Button-down oxford in Japanese cotton.'), 'keep']]],
  ['named: like Auralee or Dries (Oct 20)', { referenceBrands: ['Auralee', 'Dries Van Noten'] }, [
    [listing('Studio Nicholson', 'Cropped Flannel Shirt', 290, 'Boxy cropped flannel in brushed cotton.'), 'keep'],
    [listing('Old Navy', 'Flannel Shirt', 35, 'Soft-washed flannel shirt for everyday.'), 'out']]],
  ['level: luxury (Oct 21)', { level: 'luxury' }, [
    [listing('Loro Piana', 'Sherpa Fleece Jacket', 3200, 'Cashmere fleece jacket.'), 'keep'],
    [listing('Tigerlily Novelty Co', 'Tiger Stripe Sherpa Fleece', 49, 'Fun tiger stripe sherpa for cosy nights in.'), 'out']]],
  ['level: affordable (Oct 22)', { level: 'affordable' }, [
    [listing('Uniqlo', 'Oxford Shirt', 40, 'Cotton oxford.'), 'keep'],
    [listing('Bottega Veneta', 'Cotton Shirt', 1216, 'Cotton poplin shirt.'), 'out']]],
];

let pass = 0, total = 0, hidden = 0, kept = 0, keepTotal = 0, outTotal = 0;
const env = process.env;
if (!env.OPENAI_API_KEY) throw Error('Use node --env-file=.env.local scripts/look-check-eval.js');
for (const [id, input, pool] of CASES) {
  const look = lookFor(input), outcomes = pool.map(() => []);
  for (let r = 0; r < runs; r++) {
    const record = {}, unlike = await lookCheck(pool.map(([l]) => l), { look, env, record });
    const failed = new Set(record.look_check?.failed === pool.length ? pool.map(([l]) => l.url) : []);
    pool.forEach(([l], i) => outcomes[i].push(failed.has(l.url) ? 'failed' : unlike.has(l.url) ? 'out' : 'keep'));
  }
  pool.forEach(([l, expected], i) => {
    const ok = outcomes[i].filter(o => o === expected).length;
    pass += ok; total += runs;
    if (expected === 'keep') { keepTotal += runs; hidden += outcomes[i].filter(o => o === 'out').length; }
    else { outTotal += runs; kept += outcomes[i].filter(o => o === 'keep').length; }
    console.log(`${ok === runs ? 'PASS' : 'FAIL'} ${(id + ' / ' + l.brand).padEnd(58)} expected ${expected}, got ${outcomes[i].join(',')}`);
  });
}
console.log(`\n${pass}/${total} runs as expected; good finds hidden ${hidden}/${keepTotal}; off-look fillers kept ${kept}/${outTotal}`);
