// Loaded before every test file (see the "test" script). Tests must be repeatable anywhere, so they
// never reach real stores, APIs or a real browser: a test that needs a page or response injects it.
// Without this, results depended on whichever live sites happened to answer, and a slow store could
// hang the suite on CI.
import puppeteer from 'puppeteer-core';

const local = url => { try { const { hostname } = new URL(url); return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) || hostname.endsWith('.invalid'); } catch { return true; } };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => local(String(input?.url ?? input))
  ? realFetch(input, init)
  : Promise.reject(new TypeError(`Network is disabled in tests: ${String(input?.url ?? input).slice(0, 120)}`));
puppeteer.launch = async () => { throw new Error('The hosted browser is disabled in tests'); };
