import test from 'node:test';
import assert from 'node:assert/strict';
import {dataChanges,finishChanges,resetPatchAvailability} from '../lib/history-patch.js';

// Smaller purchase-history saves: only the top-level keys that changed are sent (db/051_history_patch.sql).
const before={style_report:{big:'x'.repeat(1000)},sources:[{id:'a'}],history_summary:{items:3},closet_summary:{tops:1},questions:[]};
const after={style_report:{big:'x'.repeat(1000)},sources:[{id:'a'}],history_summary:{items:4},questions:[{id:'q'}]};

test('only changed and removed keys are sent',()=>{
 assert.deepEqual(dataChanges(before,after),{set:{history_summary:{items:4},questions:[{id:'q'}]},remove:['closet_summary']});
 assert.deepEqual(dataChanges(before,structuredClone(before)),{set:{},remove:[]});
});

function store({patch=true,missing=false}={}){
 const calls=[];
 return {calls,
  ...(patch?{patchGmailImport:async(...args)=>{calls.push(['patch',...args]);if(missing)throw Object.assign(Error('Database request failed'),{database_status:404});return true;}}:{}),
  finishGmailImport:async(...args)=>{calls.push(['finish',...args]);return true;}};
}
const row={revision:7,data:before,token_ciphertext:'sealed'};

test('a save sends the changes, with the same revision and evidence',async()=>{
 resetPatchAvailability();
 const s=store();
 assert.equal(await finishChanges(s,'o',row,after,[{id:'e1'}]),true);
 assert.deepEqual(s.calls,[['patch','o',7,{history_summary:{items:4},questions:[{id:'q'}]},['closet_summary'],[{id:'e1'}]]]);
});

test('before the migration runs, the full save is used, and the missing function is not asked for again',async()=>{
 resetPatchAvailability();
 const s=store({missing:true});
 assert.equal(await finishChanges(s,'o',row,after,[]),true);
 assert.deepEqual(s.calls.map(c=>c[0]),['patch','finish']);
 assert.deepEqual(s.calls[1],['finish','o',7,after,'sealed',[]]);
 await finishChanges(s,'o',row,after,[]);
 assert.deepEqual(s.calls.map(c=>c[0]),['patch','finish','finish']);
 resetPatchAvailability();
});

test('a store without the small save, or any other failure, behaves as before',async()=>{
 resetPatchAvailability();
 const plain=store({patch:false});
 await finishChanges(plain,'o',row,after,[]);
 assert.deepEqual(plain.calls.map(c=>c[0]),['finish']);
 const broken={patchGmailImport:async()=>{throw Object.assign(Error('Database request failed'),{database_status:500});},finishGmailImport:async()=>true};
 await assert.rejects(finishChanges(broken,'o',row,after,[]),/Database request failed/);
});
