// Offline rehearsal of price-alert decisions: no network, database or phone sends.
// Run: node scripts/simulate-price-alert.js
import { decidePriceCheck } from '../lib/alert-decision.js';

const home = 'https://www.barbour.com/us/example-jacket', other = 'https://www.nordstrom.com/s/example-jacket/1';
const offer = (amount, { url = home, available = true, shipping } = {}) => ({ size: 'M', key: 'M', url, name: 'Example waxed jacket', amount, currency: 'USD', available,
  ...(shipping !== undefined ? { shipping: [{ countries: ['US'], amount: shipping, currency: 'USD' }] } : {}) });
const checks = (...offers) => [{ url: home, status: 'checked', offers }];
let alert = { id: 'simulation', name: 'Example waxed jacket', size: 'M', links: [{ url: home }, { url: other }], baselines: [] };

const steps = [
  ['Watch starts; size M sold out at $300', checks(offer(300, { available: false }))],
  ['Size M back in stock at $300', checks(offer(300))],
  ['Nordstrom lists $260, shipping unknown', checks(offer(300), offer(260, { url: other }))],
  ['Nordstrom lists $260 + $60 shipping', checks(offer(300), offer(260, { url: other, shipping: 60 }))],
  ['Nordstrom lists $260 with free shipping', checks(offer(300), offer(260, { url: other, shipping: 0 }))],
  ['Every store fails to load', [{ url: home, status: 'unavailable', offers: [] }]],
  ['Barbour drops to $240', checks(offer(240))],
];
for (const [label, observed] of steps) {
  const decision = decidePriceCheck(alert, observed);
  console.log(`\n▸ ${label}\n  status: ${decision.status}${decision.record.failures ? ` (failures: ${decision.record.failures})` : ''}`);
  if (decision.event) console.log('  message:\n    ' + decision.event.body.replaceAll('\n', '\n    '));
  if (decision.record.unconfirmed_savings) console.log('  recorded but not sent: cheaper item price with unconfirmed shipping');
  // Assume each message is delivered, as the scheduler would record it.
  alert = { ...alert, last_result: decision.record, last_checked_at: new Date().toISOString(), baselines: decision.after_send ?? decision.establish ?? alert.baselines };
}
