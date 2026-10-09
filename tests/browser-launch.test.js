import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import {browserLaunchOptions} from '../lib/rendered-listing.js';

test('hosted browser startup resolves actual Puppeteer arguments before launch',async()=>{
 const options=await browserLaunchOptions(puppeteer,{args:chromium.args,executablePath:async()=>'/tmp/chromium'});
 assert.ok(Array.isArray(options.args));
 assert.ok(options.args.every(arg=>typeof arg==='string'));
 assert.ok(options.args.includes('--no-sandbox'));
 assert.equal(options.executablePath,'/tmp/chromium');
});
