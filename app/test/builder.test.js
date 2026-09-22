import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { buildAttempt } from '../src/builder.js';
import { LIMITS } from '../src/extract.js';
import { demoPage } from '../src/ui.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test('builder caps pages and products, then localizes validated raster assets', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-builder-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const products = Array.from({ length: 8 }, (_, index) => ({
    '@type': 'Product',
    name: `Product ${index + 1}`,
    image: `/images/${index + 1}.png`,
    url: `/products/${index + 1}`,
    offers: { price: `${index + 10}.00`, priceCurrency: 'USD' },
  }));
  const home = `<!doctype html><title>Bounded Store</title><h1>Bounded Store</h1><script type="application/ld+json">${JSON.stringify(products)}</script>${Array.from({ length: 8 }, (_, index) => `<a href="/products/${index + 1}">Product ${index + 1}</a>`).join('')}`;
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('/images/')) return { body: png, contentType: 'image/png', finalUrl: url };
    return { body: Buffer.from(home), contentType: 'text/html', finalUrl: url };
  };

  const result = await buildAttempt({ sourceUrl: 'https://bounded.example/', attemptDir: root, requestedPageCount: 8, fetch });
  const saved = JSON.parse(await readFile(result.artifact, 'utf8'));
  assert.equal(saved.items.length, LIMITS.products);
  assert.equal(saved.actualPageCount, 8);
  assert.ok(saved.sourcePages.length <= LIMITS.pages);
  assert.equal(saved.assetSummary.count, LIMITS.products);
  assert.ok(saved.assetSummary.bytes <= LIMITS.assetBytes);
  assert.ok(saved.items.every((item) => item.imageUrl.startsWith('assets/')), 'remote images are never hotlinked');
  assert.ok(calls.filter((url) => !url.includes('/images/')).length <= LIMITS.pages);
});

test('builder retains stylesheet capture failures in the artifact limitations', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-builder-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const html = '<title>Catalog</title><link rel="stylesheet" href="/blocked.css"><article class="product"><h2>Known item</h2></article>';
  const fetch = async (url) => {
    if (url.endsWith('/blocked.css')) throw new Error('blocked');
    return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url };
  };
  const result = await buildAttempt({ sourceUrl: 'https://bounded.example/', attemptDir: root, fetch });
  assert.match(result.description.limitations.join(' '), /stylesheet could not be safely read/);
});

test('builder skips an off-origin secondary redirect and retains the home catalog', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-builder-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const product = { '@type': 'Product', name: 'Home product', url: '/products/home-product' };
  const home = `<title>Redirecting Store</title><script type="application/ld+json">${JSON.stringify(product)}</script><a href="/collection">Collection</a>`;
  const fetch = async (url) => url.endsWith('/collection')
    ? { body: Buffer.from('<title>Other shop</title>'), contentType: 'text/html', finalUrl: 'https://shop.example.net/' }
    : { body: Buffer.from(home), contentType: 'text/html', finalUrl: url };

  const result = await buildAttempt({ sourceUrl: 'https://bounded.example/', attemptDir: root, fetch });
  assert.equal(result.description.items[0].name, 'Home product');
  assert.ok(result.description.sourcePages.every((url) => new URL(url).origin === 'https://bounded.example'));
  assert.match(result.description.limitations.join(' '), /linked page redirected to another origin/);
});

test('builder performs no filesystem writes when already aborted', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-builder-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attemptDir = path.join(root, 'attempt-1');
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(buildAttempt({
    sourceUrl: 'https://bounded.example/',
    attemptDir,
    signal: controller.signal,
    fetch: async () => { throw new Error('fetch should not run'); },
  }), /cancelled/);
  await assert.rejects(access(attemptDir));
});

test('builder preserves and safely renders captured copy for a home-only preview', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-builder-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const html = await readFile(new URL('./fixtures/no-catalog.html', import.meta.url));
  const result = await buildAttempt({
    sourceUrl: 'https://notes.example/',
    attemptDir: root,
    requestedPageCount: 5,
    fetch: async (url) => ({ body: html, contentType: 'text/html', finalUrl: url }),
  });
  const artifact = JSON.parse(await readFile(result.artifact, 'utf8'));
  const rendered = demoPage({
    demo: { id: 'notes-preview' },
    artifact,
    session: { cart: {}, revision: 0 },
    mode: 'preview',
    view: 'home',
  });

  assert.deepEqual(artifact.home, {
    heading: 'Notes from the field <unsafe>',
    description: 'An essay & "notes" with no catalog.',
  });
  assert.match(rendered, /<h1>Notes from the field &lt;unsafe&gt;<\/h1>/);
  assert.match(rendered, /<p>An essay &amp; &quot;notes&quot; with no catalog\.<\/p>/);
  assert.doesNotMatch(rendered, /<h1>Notes from the field <unsafe><\/h1>/);

  const legacyRendered = demoPage({
    demo: { id: 'legacy-notes-preview' },
    artifact: { ...artifact, home: undefined },
    session: { cart: {}, revision: 0 },
    mode: 'preview',
    view: 'home',
  });
  assert.match(legacyRendered, /<h1>Editorial Notes<\/h1>/);
});
