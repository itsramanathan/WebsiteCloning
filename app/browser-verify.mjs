import { createRequire } from 'node:module';
import { once } from 'node:events';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/server.js';

const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const playwrightPath = process.env.PLAYWRIGHT_MODULE || path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { chromium } = require(playwrightPath);
const screenshots = path.join(appRoot, 'review', 'screenshots');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function fixture(sourceUrl, requestedPageCount = 5) {
  const items = Array.from({ length: requestedPageCount - 2 }, (_, index) => ({
    id: `book-${index + 1}`,
    kind: 'product',
    name: index === 0 ? 'A Complete and Untruncated Book Title' : `Archive Book ${index + 1}`,
    price: `£${20 + index}.00`,
    imageUrl: 'assets/01.png',
    sourceUrl: `${sourceUrl}catalogue/book-${index + 1}`,
  }));
  return {
    version: 1,
    name: 'Demo - Archive Books',
    originalName: 'Archive Books',
    sourceUrl,
    sourcePages: [sourceUrl],
    capturedAt: new Date().toISOString(),
    requestedPageCount,
    actualPageCount: requestedPageCount,
    kind: 'retail',
    notice: 'Demo - sample products and information. No real orders.',
    hero: null,
    style: {
      accent: '#337ab7',
      surface: '#f5f5f5',
      font: 'sans',
      density: 'compact',
      gridColumns: 3,
      layout: 'catalog-sidebar',
      categories: ['Travel', 'Mystery', 'Historical Fiction'],
    },
    items,
    assetSummary: { count: 1, bytes: png.length },
    limitations: ['Static public HTML only; source JavaScript was not executed.'],
  };
}

async function fixtureBuilder({ sourceUrl, attemptDir, requestedPageCount }) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await mkdir(path.join(attemptDir, 'assets'), { recursive: true });
  await writeFile(path.join(attemptDir, 'assets', '01.png'), png);
  const description = fixture(sourceUrl, requestedPageCount);
  const artifact = path.join(attemptDir, 'artifact.json');
  await writeFile(artifact, JSON.stringify(description));
  return { artifact, description };
}

async function waitFor(predicate, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for browser fixture state.');
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'preview-browser-'));
const app = await createApp({
  host: '127.0.0.1',
  port: 0,
  publicBaseUrl: 'http://127.0.0.1',
  dataDir,
  password: 'browser regression password',
  builder: fixtureBuilder,
  logger: { error() {}, log() {} },
});
let browser;
let entryServer;

try {
  await mkdir(screenshots, { recursive: true });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  app.config.publicBaseUrl = base;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  let shareUrl;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'prompt') shareUrl = dialog.defaultValue();
    dialog.accept();
  });

  await page.goto(`${base}/login`);
  await page.getByLabel('Operator password').fill('browser regression password');
  await page.getByRole('button', { name: 'Enter workshop' }).click();
  await page.getByLabel('Public store or B2B website URL').fill('https://archive.example/');
  await page.getByLabel('Maximum demo pages').fill('5');
  await page.getByText('We’ll create up to this many pages, based on what the source website actually provides.').waitFor();
  await page.getByRole('button', { name: 'Build preview' }).click();
  await page.getByRole('link', { name: 'Open preview' }).waitFor();
  await page.getByText('Requested maximum: 5 pages; generated: 5.').waitFor();
  const firstPreviewPath = await page.getByRole('link', { name: 'Open preview' }).getAttribute('href');
  const firstDemoId = firstPreviewPath.split('/').at(-1);
  const demoCard = page.locator(`[data-demo-id="${firstDemoId}"]`);
  await demoCard.getByRole('button', { name: 'Share privately' }).click();
  await demoCard.getByText('Shared').waitFor();
  if (!shareUrl) throw new Error('Share prompt did not provide a private URL.');
  const firstShareUrl = shareUrl;
  entryServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<a href="${shareUrl}">Open shared preview</a>`);
  });
  entryServer.listen(0, '127.0.0.1');
  await once(entryServer, 'listening');
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`http://localhost:${entryServer.address().port}`);
  await visitor.getByRole('link', { name: 'Open shared preview' }).click();
  await visitor.getByText('Demo - sample products and information. No real orders.').waitFor();
  if (visitor.url().includes('token=')) throw new Error('Share token remained in the visitor address bar.');
  await visitor.screenshot({ path: path.join(screenshots, 'cross-site-share.png'), fullPage: true });

  const secondCreated = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="csrf-token"]').content;
    const response = await fetch('/api/demos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ url: 'https://second.example/', pageCount: 5 }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (secondCreated.status !== 202) throw new Error(`Second browser demo creation failed: ${secondCreated.status}`);
  const secondDemoId = secondCreated.body.demo.id;
  await waitFor(async () => (await app.store.getDemo(secondDemoId))?.status === 'ready');
  await waitFor(() => app.runner.active === null);
  const secondShare = await page.evaluate(async (demoId) => {
    const token = document.querySelector('meta[name="csrf-token"]').content;
    const response = await fetch(`/api/demos/${demoId}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  }, secondDemoId);
  if (secondShare.status !== 200) throw new Error(`Second browser demo sharing failed: ${secondShare.status}`);
  shareUrl = secondShare.body.url;
  const secondVisitor = await visitorContext.newPage();
  await secondVisitor.goto(`http://localhost:${entryServer.address().port}`);
  await secondVisitor.getByRole('link', { name: 'Open shared preview' }).click();
  await secondVisitor.getByText('Demo - sample products and information. No real orders.').waitFor();

  await visitor.goto(`${base}/share/${firstDemoId}/collection`);
  await visitor.getByText('Only the sample collection is included.').waitFor();
  if (await visitor.getByRole('link', { name: 'Mystery', exact: true }).count()) throw new Error('Captured category rendered as fake navigation.');
  await visitor.goto(`${base}/share/${firstDemoId}/item/book-1`);
  await visitor.getByLabel('Set demo quantity').fill('2');
  await visitor.getByRole('button', { name: 'Update local state' }).click();
  await secondVisitor.goto(`${base}/share/${secondDemoId}/item/book-1`);
  await secondVisitor.getByLabel('Set demo quantity').fill('3');
  await secondVisitor.getByRole('button', { name: 'Update local state' }).click();
  await visitor.goto(`${base}/share/${firstDemoId}/item/book-1`);
  if (await visitor.getByLabel('Set demo quantity').inputValue() !== '2') throw new Error('Demo A lost its cart state after opening demo B.');
  await secondVisitor.goto(`${base}/share/${secondDemoId}/item/book-1`);
  if (await secondVisitor.getByLabel('Set demo quantity').inputValue() !== '3') throw new Error('Demo B lost its independent cart state.');

  const operatorPreview = await context.newPage();
  await operatorPreview.goto(`${base}/preview/${firstDemoId}`);
  await operatorPreview.goto(`${base}/preview/${secondDemoId}`);
  await operatorPreview.goto(`${base}/preview/${firstDemoId}`);
  if (Object.values(app.store.state.sessions).filter((session) => session.preview).length !== 2) throw new Error('Alternating operator previews created duplicate sessions.');
  await operatorPreview.close();
  await visitorContext.close();
  shareUrl = firstShareUrl;
  if (await page.evaluate(() => document.activeElement?.textContent?.trim()) !== 'Rotate link') throw new Error('Share replacement did not restore action focus.');
  await demoCard.getByRole('button', { name: 'Rotate link' }).click();
  await demoCard.getByRole('button', { name: 'Rotate link' }).waitFor();
  await demoCard.getByRole('button', { name: 'Stop sharing' }).click();
  await demoCard.getByRole('button', { name: 'Share privately' }).waitFor();
  if (await page.evaluate(() => document.activeElement?.textContent?.trim()) !== 'Share privately') throw new Error('Stop-sharing replacement did not restore action focus.');
  await demoCard.getByRole('button', { name: 'Retry' }).click();
  await demoCard.getByText('Extracting a bounded public sample...').waitFor();
  if (await page.evaluate(() => document.activeElement?.tagName) !== 'H2') throw new Error('Retry replacement did not focus the card heading fallback.');
  const sourceInput = page.getByLabel('Public store or B2B website URL');
  await sourceInput.focus();
  await demoCard.getByRole('link', { name: 'Open preview' }).waitFor();
  if (!(await sourceInput.evaluate((input) => input === document.activeElement))) throw new Error('Background polling stole focus from the URL input.');
  await demoCard.getByRole('link', { name: 'Open preview' }).click();
  const previewUrl = page.url();
  if (await page.locator('a[href*="/item/"]').count() !== 3) throw new Error('A five-page demo did not render exactly three detail links on desktop.');

  await page.screenshot({ path: path.join(screenshots, 'desktop-home.png'), fullPage: true });
  await page.getByRole('link', { name: 'Collection' }).click();
  if (await page.locator('a[href*="/item/"]').count() !== 3) throw new Error('Collection did not render exactly three detail links on desktop.');
  await page.screenshot({ path: path.join(screenshots, 'desktop-collection.png'), fullPage: true });
  await page.getByRole('link', { name: /Open A Complete/ }).click();
  await page.screenshot({ path: path.join(screenshots, 'desktop-detail.png'), fullPage: true });

  const quantity = page.getByLabel('Set demo quantity');
  await quantity.fill('2');
  await page.getByRole('button', { name: 'Update local state' }).click();
  await page.locator('#cart-lines').getByText('A Complete and Untruncated Book Title').waitFor();
  if (await page.locator('#cart-lines strong').textContent() !== '2') throw new Error('Quantity 2 did not render immediately.');
  const quoteButton = page.getByRole('button', { name: 'Prepare local quote draft' });
  await quoteButton.click();
  await page.getByText(/Local quote draft: 2 x A Complete/).waitFor();
  await page.waitForFunction((button) => !button.disabled, await quoteButton.elementHandle());
  await quoteButton.click();
  await page.waitForFunction((button) => !button.disabled, await quoteButton.elementHandle());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(previewUrl);
  await page.screenshot({ path: path.join(screenshots, 'phone-home.png'), fullPage: true });
  if (await page.locator('a[href*="/item/"]').count() !== 3) throw new Error('A five-page demo did not render exactly three detail links on phone.');
  const collectionLink = page.getByRole('link', { name: 'Collection' });
  if (!(await collectionLink.isVisible())) throw new Error('Collection navigation is hidden at phone width.');
  const navTargets = await page.locator('.demo-header nav a').evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
  if (navTargets.some((height) => height < 24)) throw new Error(`Phone navigation target below 24px: ${navTargets.join(', ')}`);
  await collectionLink.click();
  await page.screenshot({ path: path.join(screenshots, 'phone-collection.png'), fullPage: true });
  if (await page.locator('a[href*="/item/"]').count() !== 3) throw new Error('Collection did not render exactly three detail links on phone.');
  await page.getByRole('link', { name: /Open A Complete/ }).click();
  await page.screenshot({ path: path.join(screenshots, 'phone-detail.png'), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('Phone view has horizontal overflow.');

  await page.goto(base);
  const deletedName = await demoCard.locator('h2').textContent();
  await demoCard.getByRole('button', { name: 'Delete' }).click();
  await demoCard.waitFor({ state: 'detached' });
  if (await page.evaluate(() => document.activeElement?.tagName) !== 'H2') throw new Error('Delete did not move focus to the surviving preview heading.');
  await page.getByText(`${deletedName} was deleted.`, { exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'dashboard-after-delete.png'), fullPage: true });
  if (errors.length || consoleErrors.length) throw new Error(`Browser errors: ${[...errors, ...consoleErrors].join('; ')}`);

  console.log(JSON.stringify({
    views: ['home', 'collection', 'detail'],
    viewports: ['1280x720', '390x844'],
    quantityRendered: 2,
    quoteReusable: true,
    crossSiteShareEntry: 'localhost-to-127.0.0.1',
    perDemoSessions: { visitorCarts: [2, 3], operatorPreviewSessions: 2 },
    capturedCategoriesAreLinks: false,
    shareLifecycleVisible: true,
    dashboardFocusRestored: true,
    deleteFocusRestored: true,
    phoneNavigationTargets: '>=24px',
    requestedPageCount: 5,
    actualPageCount: 5,
    detailLinksPerView: 3,
    pageErrors: 0,
    consoleErrors: 0,
    screenshots,
  }));
} finally {
  entryServer?.close();
  if (entryServer) await once(entryServer, 'close').catch(() => {});
  await browser?.close().catch(() => {});
  app.server.close();
  await once(app.server, 'close').catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
