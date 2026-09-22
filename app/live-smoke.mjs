import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'preview-live-'));
const startedAt = Date.now();
const app = await createApp({
  host: '127.0.0.1',
  port: 0,
  publicBaseUrl: 'http://127.0.0.1',
  dataDir,
  password: 'live smoke password',
  logger: console,
});
let browser;

try {
  await mkdir(screenshots, { recursive: true });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${base}/login`);
  await page.getByLabel('Operator password').fill('live smoke password');
  await page.getByRole('button', { name: 'Enter workshop' }).click();
  await page.getByLabel('Public store or B2B website URL').fill('https://books.toscrape.com/');
  await page.getByLabel('Maximum demo pages').fill('8');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await page.getByRole('link', { name: 'Open preview' }).waitFor({ timeout: 90_000 });
  await page.getByRole('link', { name: 'Open preview' }).click();
  const previewUrl = page.url();

  await page.screenshot({ path: path.join(screenshots, 'live-books-desktop-home.png'), fullPage: true });
  await page.getByRole('link', { name: 'Collection' }).click();
  await page.screenshot({ path: path.join(screenshots, 'live-books-desktop-collection.png'), fullPage: true });
  await page.locator('.product-card a').first().click();
  await page.screenshot({ path: path.join(screenshots, 'live-books-desktop-detail.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(previewUrl);
  await page.screenshot({ path: path.join(screenshots, 'live-books-phone-home.png'), fullPage: true });
  await page.getByRole('link', { name: 'Collection' }).click();
  await page.screenshot({ path: path.join(screenshots, 'live-books-phone-collection.png'), fullPage: true });
  await page.locator('.product-card a').first().click();
  await page.screenshot({ path: path.join(screenshots, 'live-books-phone-detail.png'), fullPage: true });

  const [demo] = await app.store.listDemos();
  const artifact = JSON.parse(await readFile(app.store.artifactPath(demo), 'utf8'));
  const evidence = {
    source: 'https://books.toscrape.com/',
    observedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status: demo.status,
    name: artifact.name,
    requestedPageCount: artifact.requestedPageCount,
    actualPageCount: artifact.actualPageCount,
    sourcePages: artifact.sourcePages,
    products: artifact.items.map(({ name, price, sourceUrl, description }) => ({ name, price, sourceUrl, descriptionChars: description?.length || 0 })),
    heroPresent: Boolean(artifact.hero),
    style: artifact.style,
    assetSummary: artifact.assetSummary,
    limitations: artifact.limitations,
    browser: {
      viewports: ['1280x720', '390x844'],
      views: ['home', 'collection', 'detail'],
      pageErrors: errors,
      horizontalOverflowAtPhone: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    },
  };
  if (errors.length) throw new Error(`Browser page errors: ${errors.join('; ')}`);
  if (evidence.browser.horizontalOverflowAtPhone) throw new Error('Phone view has horizontal overflow.');
  if (artifact.hero) throw new Error('The catalog source unexpectedly produced a hero.');
  if (artifact.style.layout !== 'catalog-sidebar') throw new Error('The catalog source did not produce the compact sidebar composition.');
  await writeFile(path.join(appRoot, 'review', 'live-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close().catch(() => {});
  app.server.close();
  await once(app.server, 'close').catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
