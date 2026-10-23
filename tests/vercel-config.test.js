import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';

// October 22: a 270-character includeFiles (Vercel allows 256) failed every deploy after #413 while CI passed.
test('vercel.json function settings stay inside Vercel’s limits',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const [pattern,settings] of Object.entries(config.functions??{})){
  assert.ok(pattern.length>=1&&pattern.length<=256,pattern);
  if(settings.includeFiles!==undefined)assert.ok(typeof settings.includeFiles==='string'&&settings.includeFiles.length<=256,`${pattern} includeFiles is ${settings.includeFiles.length} characters`);
 }
});

test('every preview asset the server reads exists and is bundled with the image function',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(config.functions['api/image.js'].includeFiles,'public/{brand/previews/*.png,fonts/instrument-serif.ttf}');
 for(const name of await readdir(new URL('../lib/',import.meta.url))){
  if(!name.endsWith('.js'))continue;
  const source=await readFile(new URL(`../lib/${name}`,import.meta.url),'utf8');
  for(const [,file] of source.matchAll(/brand\/previews\/([\w-]+\.png)/g))await access(new URL(`../public/brand/previews/${file}`,import.meta.url));
 }
});
