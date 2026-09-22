import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { applyStylesheetHints, buildDescription, extractPage, LIMITS, selectNextPages } from './extract.js';
import { fetchPublic } from './safe-fetch.js';

const imageTypes = new Map([
  ['image/jpeg', { extension: '.jpg', valid: (body) => body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff }],
  ['image/png', { extension: '.png', valid: (body) => body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/webp', { extension: '.webp', valid: (body) => body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP' }],
]);

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Generation cancelled.');
}

async function downloadAssets(description, attemptDir, options) {
  const references = [
    ['logoUrl', description.logoUrl],
    ['hero.imageUrl', description.hero?.imageUrl],
    ...description.items.map((item, index) => [`items.${index}.imageUrl`, item.imageUrl]),
  ].filter(([, url]) => url);
  const saved = new Map();
  const limitations = [];
  let bytes = 0;
  let count = 0;
  throwIfAborted(options.signal);
  await mkdir(path.join(attemptDir, 'assets'), { recursive: true });

  for (const [field, url] of references) {
    if (saved.has(url)) {
      setField(description, field, saved.get(url));
      continue;
    }
    if (count >= LIMITS.images || bytes >= LIMITS.assetBytes) {
      setField(description, field, undefined);
      limitations.push('Some source images were omitted because the saved asset limit was reached.');
      continue;
    }
    try {
      const result = await options.fetch(url, {
        deadline: options.deadline,
        signal: options.signal,
        maxCompressedBytes: Math.min(4_000_000, LIMITS.assetBytes - bytes),
        maxBytes: Math.min(4_000_000, LIMITS.assetBytes - bytes),
        accept: 'image/jpeg,image/png,image/webp',
      });
      const type = imageTypes.get(result.contentType);
      if (!type || !type.valid(result.body)) throw new Error('Unsupported or mismatched raster image.');
      const filename = `${String(count + 1).padStart(2, '0')}${type.extension}`;
      throwIfAborted(options.signal);
      await writeFile(path.join(attemptDir, 'assets', filename), result.body, { flag: 'wx' });
      const local = `assets/${filename}`;
      saved.set(url, local);
      setField(description, field, local);
      count += 1;
      bytes += result.body.length;
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : error;
      setField(description, field, undefined);
      limitations.push(`A source image could not be safely saved: ${new URL(url).hostname}.`);
    }
  }
  description.assetSummary = { count, bytes };
  description.limitations.push(...new Set(limitations));
}

function setField(target, field, value) {
  const parts = field.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part];
  if (value === undefined) delete current[parts.at(-1)];
  else current[parts.at(-1)] = value;
}

export async function buildAttempt({ sourceUrl, attemptDir, deadline = Date.now() + LIMITS.attemptMs, fetch = fetchPublic, signal }) {
  throwIfAborted(signal);
  const submitted = new URL(sourceUrl);
  const pages = [];
  const queued = [submitted.href];
  const seen = new Set();
  const captureLimitations = [];
  let captureOrigin;

  while (queued.length && pages.length < LIMITS.pages) {
    throwIfAborted(signal);
    if (Date.now() >= deadline) throw new Error('The five-minute generation deadline was reached.');
    const requested = queued.shift();
    if (seen.has(requested)) continue;
    seen.add(requested);
    const result = await fetch(requested, { deadline, signal, maxCompressedBytes: 2_000_000, maxBytes: 3_000_000 });
    if (!['text/html', 'application/xhtml+xml'].includes(result.contentType)) {
      throw new Error('The source did not return an HTML page.');
    }
    const finalOrigin = new URL(result.finalUrl).origin;
    if (captureOrigin && finalOrigin !== captureOrigin) {
      captureLimitations.push('A linked page redirected to another origin and was not captured.');
      continue;
    }
    captureOrigin ||= finalOrigin;
    const page = extractPage(result.body.toString('utf8'), result.finalUrl);
    if (!pages.length && page.stylesheetUrls.length) {
      const css = [];
      for (const stylesheetUrl of page.stylesheetUrls.slice(0, 2)) {
        try {
          const stylesheet = await fetch(stylesheetUrl, {
            deadline,
            signal,
            maxCompressedBytes: 256_000,
            maxBytes: 256_000,
            accept: 'text/css,*/*;q=0.1',
          });
          if (stylesheet.contentType === 'text/css') css.push(stylesheet.body.toString('utf8'));
        } catch {
          descriptionLimitation(page, 'A source stylesheet could not be safely read.');
        }
      }
      applyStylesheetHints(page, css);
    }
    pages.push(page);
    for (const candidate of selectNextPages(page, pages[0].url)) {
      if (!seen.has(candidate) && !queued.includes(candidate)) queued.push(candidate);
    }
  }

  const description = buildDescription(pages, submitted.href);
  description.limitations.push(...new Set(captureLimitations));
  throwIfAborted(signal);
  await mkdir(attemptDir, { recursive: true });
  await downloadAssets(description, attemptDir, { fetch, deadline, signal });
  const artifact = path.join(attemptDir, 'artifact.json');
  throwIfAborted(signal);
  await writeFile(artifact, `${JSON.stringify(description, null, 2)}\n`, { flag: 'wx' });
  return { artifact, description };
}

function descriptionLimitation(page, message) {
  page.captureLimitations ||= [];
  if (!page.captureLimitations.includes(message)) page.captureLimitations.push(message);
}
