import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import STYLE_ICONS from '../data/style-icons.json' with {type:'json'};

// Free-licence photos only (design/style-icons-draft.md): every photo records where it came from and
// under which licence, and is served from the site itself because the CSP blocks other image hosts.
test('every style icon photo has a credit, source and licence, and its file ships with the site',()=>{
 const photos=STYLE_ICONS.icons.filter(i=>i.photo);
 assert.ok(photos.length>0);
 for(const {key,photo} of photos){
  for(const field of ['url','credit','source','licence'])assert.ok(typeof photo[field]==='string'&&photo[field].trim(),`${key} photo.${field}`);
  assert.match(photo.url,/^\/brand\/icons\/[a-z0-9-]+\.jpg$/,key);
  assert.ok(existsSync(new URL(`../public${photo.url}`,import.meta.url)),`${key}: ${photo.url} is missing`);
  assert.match(photo.source,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,key);
  assert.ok(photo.credit.startsWith('PHOTO: ')&&photo.credit.endsWith(photo.licence),key);
 }
});

test('fictional characters keep the empty frame: no actor photo stands in for a character',()=>{
 for(const icon of STYLE_ICONS.icons.filter(i=>i.kind==='character'))assert.equal(icon.photo,null,icon.key);
});
