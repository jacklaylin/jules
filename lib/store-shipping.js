// Per-store shipping to the US, researched October 13, 2026 for stores based outside the US.
// Only `confirmed` entries (from the store's own pages) are used to label listings; `likely`
// (third-party sources) and `unknown` entries are for founder review and are never shown as fact.
// US-based stores ship domestically; global brands usually expose a US storefront, which the
// listing check finds through the page's own country alternates.
export const STORE_SHIPPING = {
  'ssense.com': { status: 'confirmed', ships_to_us: true, duties: 'included', source: 'https://www.ssense.com/en-gb/customer-service/faq', note: 'Delivered duty paid to the US; SSENSE is importer of record.' },
  'farfetch.com': { status: 'confirmed', ships_to_us: true, duties: 'included', source: 'https://www.farfetch.com/orders-and-shipping/', note: 'Duties and taxes included for US orders; sales tax shown separately; DAP option excludes them.' },
  'luisaviaroma.com': { status: 'confirmed', ships_to_us: true, duties: 'on_delivery', source: 'https://luisaviaroma.com/en-tr/contactus/shopping-online', note: 'Prices exclude import duties, paid by the recipient on delivery; US Customs may ask for an SSN or tax ID.' },
  'selfridges.com': { status: 'confirmed', ships_to_us: true, duties: 'included', source: 'https://www.selfridges.com/US/en/product/aspinal-of-london-skinny-silk-scarf_R04512963/', note: 'US Express delivery; taxes and duties calculated in the bag before payment; minimum order may apply.' },
  'lemaire.fr': { status: 'confirmed', ships_to_us: true, duties: 'unknown', source: 'https://www.lemaire.fr/policies/shipping-policy', note: 'United States is a selectable shipping country; duty handling not stated.' },
  'mrporter.com': { status: 'likely', ships_to_us: true, duties: 'included', source: 'https://www.ynap.com/wp-content/uploads/2018/08/MR-PORTER-Launches-Versace.pdf', note: 'Ships to 170+ countries incl. US (2018 release); duty-inclusive per third-party guide. Confirm at checkout.' },
  'net-a-porter.com': { status: 'likely', ships_to_us: true, duties: 'not_applicable', source: 'https://www.purseblog.com/international/international-shopping-101-your-guide-to-buying-bags-from-sites-outside-the-united-states', note: 'US orders reportedly ship from a New Jersey warehouse. Confirm on the US site.' },
  'mytheresa.com': { status: 'likely', ships_to_us: true, duties: 'included', source: 'https://www.purseblog.com/international/international-shopping-101-your-guide-to-buying-bags-from-sites-outside-the-united-states', note: 'Third-party guide and forum posts report duty-inclusive US pricing. Confirm on the duties FAQ.' },
  'endclothing.com': { status: 'likely', ships_to_us: true, duties: 'unknown', source: 'https://directory.fmtc.co/cp/program_directory/details/m/40648', note: 'Has a US storefront (endclothing.com/us); duty handling unconfirmed.' },
  'doverstreetmarket.com': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: 'https://solefeed.com/store/dover-street-market', note: 'A US store (shop-us.doverstreetmarket.com) exists; London e-shop US shipping unconfirmed.' },
  'harrods.com': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: null, note: 'Delivery pages blocked automated reading (403); forwarding services advertise Harrods.' },
  'slamjam.com': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: null, note: 'No policy found in searches.' },
  'margarethowell.co.uk': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: 'https://www.margarethowell.co.uk/policies/shipping-policy', note: 'Shipping policy page describes UK delivery only; US shown as a currency option.' },
  'yohjiyamamoto.co.jp': { status: 'likely', ships_to_us: true, duties: 'unknown', source: 'https://theshopyohjiyamamoto.com/', note: 'Sells abroad through its Global store (theshopyohjiyamamoto.com), which offers United States (USD); delivery terms not stated on the page.' },
  'sacai.jp': { status: 'likely', ships_to_us: true, duties: 'unknown', source: 'https://www.sacai.jp/pages/faqs', note: 'United States (USD) is selectable and deliveries go to the selected region; only Macau and Romania are listed as suspended. Duties not stated.' },
  'kapital.jp': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: 'https://www.kapital-webshop.jp/', note: 'Sells through kapital-webshop.jp, which blocked automated reading (403).' },
  'needles.jp': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: 'https://www.needles.jp/', note: 'Brand site has no online shop or shipping information.' },
  'auralee.jp': { status: 'confirmed', ships_to_us: true, duties: 'included', source: 'https://auralee.jp/guide', note: 'Ships worldwide incl. US (USD 23 shipping); "Prices on this website include tax and customs duties for international shipping."' },
  'orslow.jp': { status: 'unknown', ships_to_us: null, duties: 'unknown', source: 'https://orslow.jp/store', note: 'Home page shows no shipping information.' },
};
// Confirmed store policy for US shoppers only (the research covers US shipping).
export function storeShipping(url, shopperCountry) {
  if (shopperCountry !== 'US') return null;
  const host = new URL(url).hostname.replace(/^www\./, '');
  const entry = Object.entries(STORE_SHIPPING).find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1];
  return entry?.status === 'confirmed' ? entry : null;
}
