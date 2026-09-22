import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyStylesheetHints, buildDescription, extractPage, LIMITS, selectNextPages } from '../src/extract.js';

const fixtures = new URL('./fixtures/', import.meta.url);

test('extracts a bounded retail catalog and source-informed presentation', async () => {
  const html = await readFile(new URL('retail.html', fixtures), 'utf8');
  const page = extractPage(html, 'https://northstar.example/');
  const description = buildDescription([page], page.url);

  assert.equal(description.name, 'Demo - Northstar Supply');
  assert.equal(description.kind, 'retail');
  assert.equal(description.hero.title, 'Carry less. Go farther.');
  assert.equal(description.hero.imageUrl, 'https://northstar.example/images/hero.jpg');
  assert.equal(description.style.accent, '#24352c');
  assert.equal(description.items.length, 3);
  assert.equal(description.items[0].price, '129.00');
  assert.equal(description.items[2].price, undefined, 'missing prices stay unknown');
  assert.match(description.limitations.join(' '), /remain unknown/);
  assert.deepEqual(selectNextPages(page, page.url), [
    'https://northstar.example/collections/trail',
    'https://northstar.example/products/ridgeline-pack',
    'https://northstar.example/products/field-bottle',
  ]);
});

test('extracts B2B offerings and enforces the lower offering cap', async () => {
  const html = await readFile(new URL('b2b.html', fixtures), 'utf8');
  const description = buildDescription([extractPage(html, 'https://harbor.example/')], 'https://harbor.example/');
  assert.equal(description.kind, 'b2b');
  assert.equal(description.items.length, LIMITS.offerings);
  assert.equal(description.items[0].price, undefined);
  assert.equal(description.hero, null, 'a heading alone does not invent a hero');
});

test('caps requested pages to the captured catalog without padding it', async () => {
  const retail = extractPage(await readFile(new URL('retail.html', fixtures), 'utf8'), 'https://northstar.example/');
  const fivePages = buildDescription([retail], retail.url, 5);
  const threePages = buildDescription([retail], retail.url, 3);
  const onePage = buildDescription([retail], retail.url, 1);
  const twoPages = buildDescription([retail], retail.url, 2);
  assert.equal(fivePages.items.length, 3);
  assert.equal(fivePages.requestedPageCount, 5);
  assert.equal(fivePages.actualPageCount, 5);
  assert.equal(threePages.items.length, 1);
  assert.equal(threePages.actualPageCount, 3);
  assert.equal(onePage.items.length, 0);
  assert.equal(onePage.actualPageCount, 1);
  assert.equal(twoPages.items.length, 0);
  assert.equal(twoPages.actualPageCount, 2);

  const b2b = extractPage(await readFile(new URL('b2b.html', fixtures), 'utf8'), 'https://harbor.example/');
  const capped = buildDescription([b2b], b2b.url, 6);
  assert.equal(capped.items.length, LIMITS.offerings);
  assert.equal(capped.actualPageCount, 5);
});

test('open graph and logo images do not invent or replace visible hero evidence', () => {
  const catalog = '<article class="product"><h2>Known item</h2></article>';
  const metadataOnly = extractPage(`<title>Store</title><meta property="og:image" content="/share.jpg"><img class="logo" src="/logo.jpg">${catalog}`, 'https://store.example/');
  assert.equal(buildDescription([metadataOnly], metadataOnly.url).hero, null);

  const visibleHero = extractPage(`<title>Store</title><meta property="og:image" content="/share.jpg"><section class="hero"><h1>Visible hero</h1><img src="/visible.jpg"></section>${catalog}`, 'https://store.example/');
  assert.equal(buildDescription([visibleHero], visibleHero.url).hero.imageUrl, 'https://store.example/visible.jpg');
});

test('extracts a compact catalog composition without prose dumps or unsafe links', async () => {
  const html = await readFile(new URL('catalog.html', fixtures), 'utf8');
  const page = extractPage(html, 'https://books.example/');
  applyStylesheetHints(page, ['body { font-family: Arial, sans-serif; background: #f5f5f5 } a { color: #337ab7 } .grid { padding: 8px }']);
  const description = buildDescription([page], page.url);

  assert.equal(description.hero, null);
  assert.equal(page.description, '', 'navigation and body text are not used as a description');
  assert.equal(description.style.layout, 'catalog-sidebar');
  assert.equal(description.style.font, 'sans');
  assert.equal(description.style.accent, '#337ab7');
  assert.deepEqual(description.style.categories, ['Travel', 'Mystery']);
  assert.equal(description.items[0].name, 'A Complete and Untruncated Book Title');
  assert.equal(description.items[1].sourceUrl, page.url, 'encoded control characters cannot smuggle a script URL');
  assert.deepEqual(selectNextPages(page, page.url), [
    'https://books.example/catalogue/category/books/travel_2/index.html',
    'https://books.example/catalogue/a-long-book_1/index.html',
  ]);
});

test('detail-page evidence fills missing catalog facts without replacing known facts', () => {
  const home = extractPage('<title>Store</title><article class="product"><h3><a href="/item">Item</a></h3></article>', 'https://store.example/');
  const detail = extractPage('<title>Item</title><article class="product_page"><h1>Item</h1><img src="/item.jpg"><div id="product_description"><h2>Description</h2></div><p>Verified detail copy.</p></article>', 'https://store.example/item');
  const description = buildDescription([home, detail], home.url);
  assert.equal(description.items[0].description, 'Verified detail copy.');
});

test('renders a one-page home preview when no credible catalog exists', async () => {
  const html = await readFile(new URL('no-catalog.html', fixtures), 'utf8');
  const description = buildDescription([extractPage(html, 'https://notes.example/')], 'https://notes.example/', 5);
  assert.deepEqual([description.requestedPageCount, description.actualPageCount, description.items.length], [5, 1, 0]);
});
