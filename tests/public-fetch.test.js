import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {publicFetch,publicAddress} from '../lib/public-fetch.js';

test('arbitrary product hosts cannot resolve to private services or rebind the connection',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::']){
  assert.equal(publicAddress(address),false);
  await assert.rejects(publicFetch('https://shop.example.org/products/item',{}, {resolve:async()=>[{address,family:address.includes(':')?6:4}],connect:()=>assert.fail('Unsafe network request')}));
 }
 let resolutions=0;
 const response=await publicFetch('https://shop.example.org/products/item',{}, {resolve:async()=>{resolutions++;return [{address:'93.184.215.14',family:4}];},connect:(url,options,receive)=>{
  assert.equal(url,'https://shop.example.org/products/item');
  options.lookup('shop.example.org',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.215.14');assert.equal(family,4);});
  options.lookup('shop.example.org',{all:true},(error,addresses)=>assert.deepEqual(addresses,[{address:'93.184.215.14',family:4}]));
  const req=new EventEmitter();req.end=()=>{const res=Readable.from([Buffer.from('public product')]);res.statusCode=200;res.headers={'content-type':'text/html'};receive(res);};return req;
 }});
 assert.equal(await response.text(),'public product');assert.equal(resolutions,1);
 await assert.rejects(publicFetch('https://shop.example.org/item',{}, {resolve:async()=>[{address:'93.184.215.14',family:4},{address:'127.0.0.1',family:4}],connect:()=>assert.fail()}));
});
