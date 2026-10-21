import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../public/${path}`,import.meta.url),'utf8');

test('every bottom sheet keeps its header in place and scrolls only its body',async()=>{
 const css=await read('design-system.css');
 assert.match(css,/dialog\.sheet\[open\]\{[^}]*overflow:hidden/);
 assert.match(css,/\.sheet-body\{[^}]*overflow-y:auto/);
 const html=await read('report.html');
 const sheets=html.match(/<dialog[^>]*class="report-sheet[^"]*"[\s\S]*?<\/dialog>/g);
 assert.equal(sheets.length,3);
 for(const sheet of sheets){
  assert.match(sheet,/^<dialog[^>]*class="[^"]*\bsheet\b/);
  assert.match(sheet,/class="[^"]*\bsheet-head\b/);
  assert.match(sheet,/class="[^"]*\bsheet-body\b/);
 }
 const filter=await read('filter-bar.js');
 for(const part of ['sheet\'','sheet-head','sheet-body'])assert.ok(filter.includes(part),part);
});

test('opening the filter sheet focuses the sheet, not a row',async()=>{
 const filter=await read('filter-bar.js');
 const open=filter.match(/trigger\.onclick=\(\)=>\{[^\n]*/)[0];
 assert.match(open,/dialog\.focus\(\)/);
 assert.doesNotMatch(open,/\]'\)\?\.focus\(\)|pressed=true\]'\)\?\.focus/);
});
