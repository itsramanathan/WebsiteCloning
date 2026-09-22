import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  pages: 4,
  products: 6,
  offerings: 3,
  images: 30,
  assetBytes: 25 * 1024 * 1024,
  pageText: 5_000,
  attemptMs: 5 * 60 * 1_000,
});

export const DEMO_PAGE_COUNT = Object.freeze({ min: 1, max: 8, default: 5 });

const entities = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };

export function decodeHtml(value = '') {
  return String(value).replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }
    return entities[entity.toLowerCase()] ?? '';
  });
}

function text(value = '') {
  return decodeHtml(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function absolute(value, base) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function walkJson(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => walkJson(item, visit));
    else walkJson(child, visit);
  }
}

function firstImage(value, base) {
  const candidate = Array.isArray(value) ? value[0] : typeof value === 'object' ? value?.url || value?.contentUrl : value;
  return absolute(candidate, base);
}

function jsonCatalog(html, url) {
  const items = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = safeJson(decodeHtml(match[1]).trim());
    walkJson(parsed, (entry) => {
      const types = (Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']]).map((type) => String(type).toLowerCase());
      const kind = types.includes('product') ? 'product' : types.some((type) => ['service', 'offer'].includes(type)) ? 'offering' : null;
      if (!kind || !entry.name) return;
      const offer = Array.isArray(entry.offers) ? entry.offers[0] : entry.offers || {};
      const price = offer.price ?? offer.lowPrice ?? entry.price;
      items.push({
        kind,
        name: text(entry.name).slice(0, 160),
        description: text(entry.description).slice(0, 1_200) || undefined,
        imageUrl: firstImage(entry.image, url) || undefined,
        sourceUrl: absolute(entry.url, url) || url,
        price: price === undefined || price === null || price === '' ? undefined : String(price).slice(0, 40),
        currency: offer.priceCurrency ? String(offer.priceCurrency).slice(0, 8).toUpperCase() : undefined,
      });
    });
  }
  return items;
}

function cardCatalog(html, url) {
  const items = [];
  const cardPattern = /<(article|li|div)\b[^>]*(?:class|data-testid)\s*=\s*["'][^"']*(?:product|service|card|offering)[^"']*["'][^>]*>([\s\S]{0,12000}?)<\/\1>/gi;
  for (const match of html.matchAll(cardPattern)) {
    const block = match[0];
    const heading = block.match(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i);
    const link = heading?.[0].match(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i)?.[0]
      || block.match(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i)?.[0];
    const image = block.match(/<img\b[^>]*>/i)?.[0];
    const name = text(attribute(link, 'title') || attribute(link, 'aria-label') || heading?.[1] || attribute(image, 'alt'));
    if (!name || name.length > 160) continue;
    const priceMatch = text(block).match(/(?:[$€£¥₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|CAD|AUD))/i);
    const isOffering = /service|solution|offering|request a quote|contact sales/i.test(block);
    items.push({
      kind: isOffering ? 'offering' : 'product',
      name,
      imageUrl: absolute(attribute(image, 'src') || attribute(image, 'data-src'), url) || undefined,
      sourceUrl: absolute(attribute(link, 'href'), url) || url,
      price: priceMatch?.[0],
    });
  }
  return items;
}

function detailCatalog(html, url) {
  const article = html.match(/<article\b[^>]*class\s*=\s*["'][^"']*(?:product[_-]page|product[_-]detail|service[_-]detail)[^"']*["'][^>]*>[\s\S]{0,100000}?<\/article>/i)?.[0];
  if (!article) return [];
  const name = text(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (!name || name.length > 160) return [];
  const image = article.match(/<img\b[^>]*>/i)?.[0];
  const described = article.match(/(?:id|class)\s*=\s*["'][^"']*(?:product[_-]description|description)[^"']*["'][^>]*>[\s\S]{0,3000}?<p\b[^>]*>([\s\S]{0,5000}?)<\/p>/i)?.[1]
    || article.match(/<p\b[^>]*(?:itemprop\s*=\s*["']description["']|class\s*=\s*["'][^"']*description[^"']*["'])[^>]*>([\s\S]{0,5000}?)<\/p>/i)?.[1];
  const priceMatch = text(article).match(/(?:[$€£¥₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|CAD|AUD))/i);
  return [{
    kind: /service|solution|offering|request a quote|contact sales/i.test(article) ? 'offering' : 'product',
    name,
    description: text(described).slice(0, 1_200) || undefined,
    imageUrl: absolute(attribute(image, 'src') || attribute(image, 'data-src'), url) || undefined,
    sourceUrl: url,
    price: priceMatch?.[0],
  }];
}

function metadata(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if ([attribute(tag, 'name'), attribute(tag, 'property')].some((value) => value.toLowerCase() === name.toLowerCase())) {
      return text(attribute(tag, 'content'));
    }
  }
  return '';
}

function colorChannels(value) {
  const short = value.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  if (short) return short.slice(1).map((part) => Number.parseInt(part + part, 16));
  const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part, 16));
  const rgb = value.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,[\d.]+)?\)$/i);
  if (!rgb) return null;
  const channels = rgb.slice(1).map(Number);
  return channels.every((part) => part <= 255) ? channels : null;
}

function isChromatic(value) {
  const channels = colorChannels(value);
  return channels && Math.max(...channels) - Math.min(...channels) >= 12;
}

function isLight(value) {
  const channels = colorChannels(value);
  return channels && channels.reduce((sum, part) => sum + part, 0) / 3 >= 225;
}

function styleHints(html, fallback = {}) {
  const styles = [
    ...(html.match(/<style\b[^>]*>[\s\S]{0,50000}?<\/style>/gi) || []),
    ...(html.match(/\sstyle\s*=\s*["'][^"']{0,1000}["']/gi) || []),
  ].join(' ');
  const colors = [];
  for (const match of styles.matchAll(/(?:color|background(?:-color)?)\s*:\s*(#[\da-f]{3,8}|rgba?\([^)]{1,48}\))/gi)) {
    const value = match[1].replace(/\s+/g, '');
    if (!/^#[\da-f]{3,8}$/i.test(value) && !/^rgba?\([\d.,%]+\)$/i.test(value)) continue;
    colors.push(value);
  }
  const preferredColors = [];
  for (const rule of styles.matchAll(/([^{}]{1,300})\{([^{}]{1,3000})\}/g)) {
    if (!/(?:^|[,\s])a(?=[:\s,.#\[])|\.btn-primary\b|\.button\b/i.test(rule[1])) continue;
    for (const match of rule[2].matchAll(/(?:color|background(?:-color)?)\s*:\s*(#[\da-f]{3,8}|rgba?\([^)]{1,48}\))/gi)) {
      preferredColors.push(match[1].replace(/\s+/g, ''));
    }
  }
  const unique = [...new Set(colors)];
  const grid = styles.match(/grid-template-columns\s*:\s*repeat\(\s*([2-4])\s*,/i);
  const spacing = [...styles.matchAll(/(?:padding|margin)(?:-[a-z]+)?\s*:\s*(\d{1,3})px/gi)].map((match) => Number(match[1])).filter((value) => value <= 160);
  const averageSpacing = spacing.length ? spacing.reduce((sum, value) => sum + value, 0) / spacing.length : null;
  return {
    ...fallback,
    accent: preferredColors.find(isChromatic) || unique.find(isChromatic) || fallback.accent || '#b95432',
    surface: unique.find(isLight) || fallback.surface || '#f4efe6',
    gridColumns: Number(grid?.[1] || fallback.gridColumns || 3),
    density: averageSpacing === null ? fallback.density || 'balanced' : averageSpacing < 20 ? 'compact' : averageSpacing > 48 ? 'airy' : 'balanced',
    font: /font-family\s*:[^;}]{0,160}(?:sans-serif|arial|helvetica|verdana|system-ui)/i.test(styles) ? 'sans' : fallback.font || 'serif',
  };
}

export function applyStylesheetHints(page, cssTexts) {
  const bounded = cssTexts.map((value) => `<style>${String(value).slice(0, 50_000)}</style>`).join('\n');
  page.style = styleHints(bounded, page.style);
  return page;
}

function stylesheetUrls(html, base) {
  const result = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["'][^"']*stylesheet/i.test(match[0])) continue;
    const url = absolute(attribute(match[0], 'href'), base);
    if (url && !result.includes(url)) result.push(url);
    if (result.length === 2) break;
  }
  return result;
}

function categoryLabels(html) {
  const marker = html.match(/<(aside|nav|div|ul)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:side(?:bar|_categories)|categories|category-menu)[^"']*["'][^>]*>/i);
  if (!marker || marker.index === undefined) return [];
  let block = html.slice(marker.index, marker.index + 30_000);
  const closing = block.toLowerCase().indexOf(`</${marker[1].toLowerCase()}>`);
  if (closing >= 0) block = block.slice(0, closing);
  const labels = [];
  for (const match of block.matchAll(/<a\b[^>]*>([\s\S]{0,500}?)<\/a>/gi)) {
    const label = text(match[1]).slice(0, 60);
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length === 8) break;
  }
  return labels;
}

function links(html, url) {
  const sourceOrigin = new URL(url).origin;
  const result = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>([\s\S]{0,1000}?)<\/a>/gi)) {
    const href = absolute(attribute(match[0], 'href'), url);
    if (!href) continue;
    const parsed = new URL(href);
    parsed.hash = '';
    if (parsed.origin !== sourceOrigin) continue;
    result.push({ url: parsed.href, label: text(match[1]).slice(0, 120) });
  }
  return result;
}

export function extractPage(html, url) {
  const bounded = String(html).slice(0, 3_000_000);
  const title = text(bounded.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const h1 = text(bounded.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const logoTag = (bounded.match(/<img\b[^>]*(?:class|alt)\s*=\s*["'][^"']*logo[^"']*["'][^>]*>/i) || [])[0];
  const heroTag = (bounded.match(/<(section|div)\b[^>]*class\s*=\s*["'][^"']*hero[^"']*["'][^>]*>[\s\S]{0,20000}?<\/\1>/i) || [])[0];
  const heroImage = heroTag?.match(/<img\b[^>]*>/i)?.[0];
  const heroDescription = text(heroTag?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
  const catalog = [...jsonCatalog(bounded, url), ...detailCatalog(bounded, url), ...cardCatalog(bounded, url)];
  const categories = categoryLabels(bounded);
  const style = styleHints(bounded);
  if (categories.length && /\bcol-(?:md|lg)-3\b/i.test(bounded)) style.gridColumns = 4;
  return {
    url,
    title: title.slice(0, 200),
    heading: h1.slice(0, 240),
    description: (heroDescription || metadata(bounded, 'description')).slice(0, LIMITS.pageText),
    siteName: metadata(bounded, 'og:site_name'),
    logoUrl: absolute(attribute(logoTag, 'src'), url) || undefined,
    heroUrl: absolute(attribute(heroImage, 'src'), url) || undefined,
    hasHero: Boolean(heroTag),
    catalog,
    links: links(bounded, url),
    stylesheetUrls: stylesheetUrls(bounded, url),
    categories,
    style: { ...style, layout: categories.length ? 'catalog-sidebar' : 'grid' },
  };
}

function itemId(item) {
  return createHash('sha256').update(`${item.kind}:${item.name}:${item.sourceUrl}`).digest('hex').slice(0, 12);
}

function sameItem(a, b) {
  return a.name.toLowerCase() === b.name.toLowerCase() || (a.sourceUrl && b.sourceUrl && a.sourceUrl === b.sourceUrl);
}

export function buildDescription(pages, submittedUrl, requestedPageCount) {
  const home = pages[0];
  if (!home) throw new Error('No source page was captured.');
  const pageCount = requestedPageCount ?? DEMO_PAGE_COUNT.default;
  if (!Number.isInteger(pageCount) || pageCount < DEMO_PAGE_COUNT.min || pageCount > DEMO_PAGE_COUNT.max) {
    const error = new Error(`Maximum demo pages must be an integer from ${DEMO_PAGE_COUNT.min} to ${DEMO_PAGE_COUNT.max}.`);
    error.code = 'INVALID_PAGE_COUNT';
    throw error;
  }
  const merged = [];
  for (const page of pages) {
    for (const item of page.catalog) {
      if (!item.name) continue;
      const existing = merged.find((candidate) => sameItem(candidate, item));
      if (!existing) merged.push(item);
      else for (const field of ['description', 'imageUrl', 'sourceUrl', 'price', 'currency']) existing[field] ||= item[field];
    }
  }
  const hasProducts = merged.some((item) => item.kind === 'product');
  const kind = hasProducts ? 'retail' : 'b2b';
  const available = merged.filter((item) => item.kind === (hasProducts ? 'product' : 'offering')).slice(0, hasProducts ? LIMITS.products : LIMITS.offerings);
  const selected = available.slice(0, Math.max(0, pageCount - 2));
  const actualPageCount = available.length ? Math.min(pageCount, available.length + 2) : 1;
  const titleParts = home.title.split(/\s*(?:[|–—]|\s-\s)\s*/).map((part) => part.trim()).filter(Boolean);
  const titleName = /^(?:all )?(?:products?|catalog|collection|shop|home|services?|solutions?)$/i.test(titleParts[0] || '') ? titleParts[1] : titleParts[0];
  const rawName = home.siteName || titleName || new URL(submittedUrl).hostname.replace(/^www\./, '');
  return {
    version: 1,
    name: `Demo - ${rawName.trim().slice(0, 100)}`,
    originalName: rawName.trim().slice(0, 100),
    sourceUrl: submittedUrl,
    sourcePages: pages.map((page) => page.url).slice(0, LIMITS.pages),
    capturedAt: new Date().toISOString(),
    requestedPageCount: pageCount,
    actualPageCount,
    kind,
    notice: 'Demo - sample products and information. No real orders.',
    home: {
      heading: home.heading || undefined,
      description: home.description.slice(0, 360) || undefined,
    },
    hero: home.hasHero ? {
      eyebrow: kind === 'b2b' ? 'Solutions preview' : 'Store preview',
      title: home.heading || rawName,
      description: home.description.slice(0, 360) || undefined,
      imageUrl: home.heroUrl,
      variant: home.heroUrl ? 'split' : 'centered',
    } : null,
    logoUrl: home.logoUrl,
    style: { ...home.style, categories: home.categories },
    items: selected.map((item) => ({ ...item, id: itemId(item) })),
    limitations: [
      'Static public HTML only; source JavaScript was not executed.',
      ...new Set(pages.flatMap((page) => page.captureLimitations || [])),
      ...(!home.logoUrl ? ['No source logo was available in the captured HTML.'] : []),
      ...selected.some((item) => !item.price) ? ['One or more prices were not published and remain unknown.'] : [],
    ],
  };
}

export function selectNextPages(page, submittedUrl) {
  const home = new URL(submittedUrl);
  const unique = new Map();
  for (const link of page.links) {
    const target = new URL(link.url);
    if (target.origin !== home.origin || target.href === home.href) continue;
    unique.set(target.href, link);
  }
  const values = [...unique.values()];
  const collection = values.find(({ url, label }) => /shop|products?|collections?|catalog|solutions?|services?|offerings?/i.test(`${url} ${label}`));
  const capturedDetails = page.catalog.map((item) => item.sourceUrl).filter(Boolean).map((url) => ({ url, label: '' }));
  const linkedDetails = values.filter(({ url, label }) => /product|item|service|solution|detail/i.test(`${url} ${label}`));
  const details = [...capturedDetails, ...linkedDetails].filter(({ url }, index, all) => {
    try {
      const target = new URL(url);
      return target.origin === home.origin && target.href !== home.href && target.href !== collection?.url && all.findIndex((entry) => entry.url === url) === index;
    } catch {
      return false;
    }
  });
  return [collection, ...details.slice(0, 2)].filter(Boolean).slice(0, LIMITS.pages - 1).map((entry) => entry.url);
}
