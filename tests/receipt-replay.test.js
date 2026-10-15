import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReceiptEvidence,merchantKey} from '../lib/receipt-extraction.js';

// Rebuilding purchase history runs on every account, wardrobe and import step. A history with many
// emails and many events not yet linked (shipments, returns) once took over 5 seconds because every
// pass re-normalized every merchant name (October 15, 2026).
const values=(n,merchant)=>({merchant,brand:'Brand',product:`Product ${n}`,order_reference:`#${n}`,sku:null,size_label:'M',color:'Navy',quantity:1});
const row=(source,data)=>({kind:'purchase_event',data:{source_id:source,at:Date.parse('2026-01-01'),evidence:'quote',...data}});

test('rebuilding a large history stays fast and links later events to the right item', () => {
 const rows=[];
 for(let n=0;n<200;n++)rows.push(row(`gmail:p${n}`,{event_id:`p${n}`,kind:'purchased',item_id:`i${n}`,values:values(n,n%2?'MFPEN Retail ApS':'COS Store')}));
 // Shipping emails for other orders that never link, re-checked after every email.
 for(let n=0;n<300;n++)rows.push(row(`gmail:s${n}`,{event_id:`s${n}`,kind:'shipped',values:values(1000+n,`Shop ${n} Ltd`)}));
 // A return that names the store differently still links to its purchase.
 rows.push(row('gmail:r1',{event_id:'r1',kind:'returned',values:values(7,'mfpen.com')}));
 const started=performance.now();
 const {state,pending}=projectReceiptEvidence('owner',rows);
 const elapsed=performance.now()-started;
 assert.ok(elapsed<1500,`rebuild took ${Math.round(elapsed)}ms`);
 assert.equal(state.items.length,200);
 assert.ok(state.items.find(i=>i.id==='i7').source_events.some(e=>e.kind==='returned'));
 assert.equal(pending.length,300);
});

test('merchant names normalize the same way when repeated', () => {
 assert.equal(merchantKey('MFPEN Retail ApS'),'mfpen');
 assert.equal(merchantKey('MFPEN Retail ApS'),merchantKey('mfpen.com'));
 assert.equal(merchantKey(null),null);
});
