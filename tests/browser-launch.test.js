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

test('page checks stay in the default browser context, which --single-process Chromium requires',async()=>{
 // Sparticuz Chromium needs --single-process; a page in a second browser context crashes it
 // ("Target.createTarget: Target closed"), which failed every hosted page check after Oct 18.
 assert.ok(chromium.args.includes('--single-process'));
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../lib/rendered-listing.js',import.meta.url),'utf8'));
 assert.ok(!/createBrowserContext\s*\(/.test(source));
});
