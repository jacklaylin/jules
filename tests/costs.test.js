import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,validateEntry,validDate} from '../lib/costs.js';
import {createCostsHandler} from '../api/costs.js';
test('missing services remain unknown; leap month allocation and explicit zero',()=>{
 const report=summarize('2024-02-05',[{service:'openai',kind:'usage',date:'2024-02-05',amount:2},{service:'openai',kind:'subscription',date:'2024-02-01',amount:29},{service:'github',kind:'usage',date:'2024-02-05',amount:0}]);
 assert.equal(report.total,3);assert.equal(report.rows[0].daily,1);assert.equal(report.missing,6);assert.equal(report.rows[5].usage,0);assert.equal(report.rows[1].usage,null);
});
test('reject invalid dates, amounts, services and subscription dates',()=>{
 const entry={service:'openai',kind:'usage',date:'2026-10-06',amount:0,note:''};assert.deepEqual(validateEntry(entry),entry);
 for(const change of [{date:'2026-02-30'},{amount:-1},{amount:NaN},{amount:'2'},{service:'unknown'},{kind:'subscription'}])assert.throws(()=>validateEntry({...entry,...change}));
 assert.equal(validDate(null),false);
});
test('unauthenticated cost access never touches database',async()=>{
 const handler=createCostsHandler({auth:async()=>403,storeFactory:()=>{throw new Error('must not run');}});
 const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
 await handler({headers:{},method:'GET',url:'/api/costs?date=2026-10-06'},res);assert.equal(res.statusCode,403);
});
