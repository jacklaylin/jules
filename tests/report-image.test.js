import test from 'node:test';
import assert from 'node:assert/strict';
import {handleReportImage} from '../lib/report-image.js';

const token='AbCdEfGhIjKlMnOpQrStUv';
const report={built_at:'2026-10-16T00:00:00Z',share:{token},feedback:[{card:'gatekeeper',vote:'down',reason:'wont_share'}],hidden:{},
 cards:[{type:'receipt',total:'t',range:'r',lines:[]},{type:'gatekeeper',score:40,verdict:'v',brands:[],line:'l'},{type:'locked',card:'inout',title:'x',why:'y'}]};
const store={reportByShareToken:async t=>t===token?{conversation_id:'c',report}:null};
const response=()=>({statusCode:0,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},end(b){this.body=b;}});
const get=async(query,render)=>{const res=response();await handleReportImage({method:'GET',url:`/api/image?${query}`,headers:{host:'jules.test'}},res,{store,env:{SITE_ORIGIN:'https://jules.test/'},render});return res;};

test('a shared card renders as a Story image of its share link page',async()=>{
 const calls=[];
 const res=await get(`report=${token}&card=receipt`,async(...args)=>{calls.push(args);return Buffer.from('png');});
 assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/png');assert.equal(String(res.body),'png');
 assert.deepEqual(calls,[['https://jules.test',token,'receipt']]);
});

test('only cards the share view shows can be rendered, and bad links look the same as missing ones',async()=>{
 const render=async()=>{throw Error('should not render');};
 // Locked, marked "wouldn't share", not on the report, malformed, or a link that doesn't exist.
 for(const query of [`report=${token}&card=locked`,`report=${token}&card=gatekeeper`,`report=${token}&card=match`,`report=${token}&card=../x`,'report=short&card=receipt','report=ZZCdEfGhIjKlMnOpQrStUv&card=receipt'])
  assert.equal((await get(query,render)).statusCode,404,query);
});

test('a failed render is a retryable error, never a broken image',async()=>{
 const res=await get(`report=${token}&card=receipt`,async()=>{throw Error('browser crashed');});
 assert.equal(res.statusCode,503);
 const gone=await get(`report=${token}&card=receipt`,async()=>{throw Object.assign(Error('No such card.'),{status:404});});
 assert.equal(gone.statusCode,404);
});
