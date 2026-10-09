import test from 'node:test';
import assert from 'node:assert/strict';
import {publicURL} from '../lib/public-url.js';

test('product URLs retain variant parameters while removing tracking and fragments',()=>{
 assert.equal(publicURL('https://shop.example.com/product?size=50R&utm_source=mail&color=black#photos'),'https://shop.example.com/product?size=50R&color=black');
});
test('unsupported schemes, credentials, ports and private references are rejected',()=>{
 for(const url of ['not a URL','http://shop.example.com','https://me:secret@shop.example.com','https://shop.example.com:8443','https://127.0.0.1','https://10.0.0.2','https://192.168.1.1','https://shop.internal','https://[::1]'])assert.equal(publicURL(url),null,url);
});
