// Search and answer-engine foundations: robots.txt, sitemap.xml, llms.txt, noindex on personal pages,
// the landing page's canonical and structured data, and internal links that resolve.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const PUBLIC_PAGES={'/':'index.html','/signup':'signup.html','/faq':'faq.html','/privacy':'privacy.html','/terms':'terms.html'};
const rewrites=JSON.parse(read('vercel.json')).rewrites;
const html=readdirSync(new URL('../public/',import.meta.url)).filter(f=>f.endsWith('.html'));

test('robots.txt opens public pages to search and assistant crawlers, keeps personal pages out, and names the sitemap',()=>{
 const robots=read('public/robots.txt'),agents=robots.split(/\n\s*\n/).find(b=>/^User-agent: \*$/m.test(b)).match(/^User-agent: .+$/gm).map(l=>l.slice(12));
 for(const agent of ['Googlebot','Bingbot','OAI-SearchBot','ChatGPT-User','PerplexityBot','Perplexity-User','Claude-SearchBot','Claude-User','meta-webindexer','meta-externalfetcher','*'])assert.ok(agents.includes(agent),agent);
 // Two groups: search, answer and assistant crawlers share the * rules, so nobody is accidentally
 // unrestricted; training-only crawlers are blocked entirely.
 const groups=robots.split(/\n\s*\n/).filter(block=>/^User-agent:/m.test(block));
 assert.equal(groups.length,2);
 assert.match(groups[0],/^User-agent: \*$/m);
 const training=groups[1].match(/^User-agent: .+$/gm).map(l=>l.slice(12));
 assert.deepEqual(training,['GPTBot','ClaudeBot','Google-Extended','meta-externalagent']);
 assert.match(groups[1],/^Disallow: \/$/m);assert.doesNotMatch(groups[1],/^Allow:/m);
 for(const agent of training)assert.ok(!groups[0].includes(`User-agent: ${agent}\n`),agent);
 for(const path of ['/api/','/r/','/go/','/admin','/account$','/wishlist$','/wardrobe$','/style$','/report$','/onboarding','/login$'])assert.match(robots,new RegExp(`^Disallow: ${path.replace(/[$/]/g,'\\$&')}$`,'m'),path);
 assert.match(robots,/^Sitemap: https:\/\/textjules\.com\/sitemap\.xml$/m);
 // Rules are anchored, so the public pages' own styles and scripts stay crawlable.
 const rules=groups[0].match(/^Disallow: .+$/gm).map(l=>l.slice(10));
 const blocked=path=>rules.some(rule=>rule.endsWith('$')?path===rule.slice(0,-1):path.startsWith(rule));
 for(const path of [...Object.keys(PUBLIC_PAGES),'/design-system.css','/landing.css','/landing.js','/signup.js','/signup-ref.js','/brand-ui.js','/llms.txt','/sitemap.xml'])assert.equal(blocked(path),false,path);
 for(const path of ['/admin/people/x','/account','/wishlist','/r/abc','/report','/style','/login','/onboarding/connect'])assert.equal(blocked(path),true,path);
});

test('sitemap.xml lists exactly the public pages, each with a lastmod',()=>{
 const sitemap=read('public/sitemap.xml');
 const urls=[...sitemap.matchAll(/<url><loc>https:\/\/textjules\.com(\/[^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)];
 assert.deepEqual(urls.map(u=>u[1]).sort(),Object.keys(PUBLIC_PAGES).sort());
 assert.equal((sitemap.match(/<url>/g)||[]).length,urls.length);
});

test('every page except the public ones tells search engines not to index it',()=>{
 const publicFiles=new Set(Object.values(PUBLIC_PAGES));
 for(const file of html){
  const noindex=/<meta name="robots" content="noindex">/.test(read(`public/${file}`));
  assert.equal(noindex,!publicFiles.has(file),file);
 }
 const header=JSON.parse(read('vercel.json')).headers.find(h=>h.headers.some(x=>x.key==='X-Robots-Tag'));
 assert.equal(header.source,'/(api|r|go)/(.*)');
});

test('the landing page has a canonical URL, truthful Organization and WebSite data, and a full headline for machines',()=>{
 const page=read('public/index.html');
 assert.match(page,/<link rel="canonical" href="https:\/\/textjules\.com\/">/);
 const data=JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 const org=data['@graph'].find(n=>n['@type']==='Organization'),site=data['@graph'].find(n=>n['@type']==='WebSite');
 assert.equal(org.name,'Jules');assert.equal(org.url,'https://textjules.com/');assert.equal(site.url,'https://textjules.com/');
 assert.deepEqual(org.sameAs,['https://www.instagram.com/text.jules/','https://www.tiktok.com/@textjules','https://x.com/textjules']);
 assert.ok(existsSync(new URL(`../public${new URL(org.logo).pathname}`,import.meta.url)),'logo file exists');
 assert.ok(!('aggregateRating' in org)&&!('review' in org));
 const h1=page.match(/<h1>(.*?)<\/h1>/s)[1];
 assert.match(h1,/<span class="headline-line" aria-hidden="true">/);
 assert.match(h1,/<span class="sr-only">Text Jules to [^<]+<\/span>/);
});

test('machine-facing copy never brands Jules as AI',()=>{
 const page=read('public/index.html'),faq=read('public/faq.html'),machine=[read('public/llms.txt'),page.match(/ld\+json">(.*?)<\/script>/s)[1],page.match(/<h1>(.*?)<\/h1>/s)[1],page.match(/<p class="landing-intro">(.*?)<\/p>/s)[1],faq.match(/<main.*<\/main>/s)[0],faq.match(/ld\+json">(.*?)<\/script>/s)[1]].join('\n');
 assert.doesNotMatch(machine,/\bAI\b|\bagent\b|artificial intelligence|AI stylist/i);
 assert.match(read('public/llms.txt'),/^# Jules\n\n> /);
});

test('internal links and assets on public pages resolve to a file or a rewrite',()=>{
 const exists=path=>{
  if(rewrites.some(r=>new RegExp(`^${r.source.replace(/:[a-z]+/g,'[^/]+')}$`).test(path)))return true;
  return path==='/'||existsSync(new URL(`../public${decodeURIComponent(path)}`,import.meta.url));
 };
 for(const file of Object.values(PUBLIC_PAGES)){
  const page=read(`public/${file}`);
  for(const [,url] of page.matchAll(/(?:href|src)="([^"#]+)"/g)){
   if(/^(https?:|mailto:|sms:|tel:)/.test(url))continue;
   assert.ok(exists(url.split('?')[0]),`${file} → ${url}`);
  }
 }
});

// Answer engines quote the FAQ's structured data, so it must say exactly what the page says.
const plain=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').replace(/ ([.,;:])/g,'$1').trim();
const words=text=>text.split(' ').length;

test('the FAQ page opens with what Jules is, dated, and its FAQPage data matches the visible questions and answers',()=>{
 const page=read('public/faq.html');
 assert.match(page,/<link rel="canonical" href="https:\/\/textjules\.com\/faq">/);
 assert.ok(rewrites.some(r=>r.source==='/faq'&&r.destination==='/faq.html'));
 const items=[...page.matchAll(/<section class="faq-item" id="([^"]+)"><h2>(.*?)<\/h2>(.*?)<\/section>/gs)].map(([,id,q,a])=>({id,q:plain(q),a:plain(a)}));
 assert.ok(items.length>=8);
 assert.equal(page.match(/<h2[ >].*?<\/h2>/s)[0],'<h2>What is Jules?</h2>');
 assert.ok(words(items[0].a)<=100,`${words(items[0].a)} words`);
 assert.match(items[0].a,/personal shopper you text by iMessage/);
 assert.ok(page.indexOf('Updated October 2026.')<page.indexOf('<h2>'));
 const compare=items.find(i=>i.id==='compare');assert.ok(compare&&words(compare.a)<=100);assert.match(compare.a,/As of October 2026/);
 const data=JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 assert.equal(data['@type'],'FAQPage');assert.equal(data.url,'https://textjules.com/faq');
 assert.deepEqual(data.mainEntity.map(e=>({q:e.name,a:e.acceptedAnswer.text})),items.map(({q,a})=>({q,a})));
 for(const e of data.mainEntity){assert.equal(e['@type'],'Question');assert.equal(e.acceptedAnswer['@type'],'Answer');}
 // Every question is reachable from the section list.
 const toc=[...page.match(/<nav class="legal-toc"[^>]*>(.*?)<\/nav>/s)[1].matchAll(/href="#([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(toc,items.map(i=>i.id));
});

test('the landing page defines Jules, dates its example prices for machines and links FAQ, Privacy, Terms and the affiliate disclosure',()=>{
 const page=read('public/index.html');
 assert.match(page.match(/<p class="landing-intro">(.*?)<\/p>/s)[1],/personal shopper you text/);
 // The price date lives in the transcript only; the visible page carries no small print under the phone.
 assert.doesNotMatch(page,/demo-note/);
 assert.match(page.match(/<section class="sr-only"[^>]*>(.*?)<\/section>/s)[1],/^<h2>What can you text Jules\?<\/h2><p>[^<]*Prices as of October 2026\.<\/p>/);
 assert.equal(page.match(/<footer class="landing-legal">(.*?)<\/footer>/s)[1],'<a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/faq#affiliate-links">Affiliate links</a>');
 for(const file of ['faq.html','privacy.html','terms.html']){
  const other=read(`public/${file}`);
  assert.deepEqual([...other.match(/<footer class="site-legal">(.*?)<\/footer>/s)[1].matchAll(/href="([^"]+)"/g)].map(m=>m[1]),['/faq','/privacy','/terms','/faq#affiliate-links'],file);
  assert.deepEqual([...other.match(/<nav class="header-actions legal-nav"[^>]*>(.*?)<\/nav>/s)[1].matchAll(/href="([^"]+)"/g)].map(m=>m[1]),['/faq','/privacy','/terms'],file);
 }
 assert.match(read('public/llms.txt'),/\(https:\/\/textjules\.com\/faq\)/);
});
