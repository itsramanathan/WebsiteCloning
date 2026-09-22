import { escapeHtml } from './util.js';

function shell({ title, body, page = '', csrf = '', theme = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${escapeHtml(csrf)}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/static/styles.css">
  ${theme ? `<link rel="stylesheet" href="${escapeHtml(theme)}">` : ''}
</head>
<body data-page="${escapeHtml(page)}" class="${escapeHtml(bodyClass)}">
${body}
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

export function loginPage(message = '') {
  return shell({
    title: 'Operator sign in',
    page: 'login',
    body: `<main class="login-wrap">
  <section class="login-panel" aria-labelledby="login-title">
    <p class="kicker">Internal preview workshop</p>
    <h1 id="login-title">Build a small, source-informed website preview.</h1>
    <p class="lede">Operator access is required. Shared visitors never use this account.</p>
    ${message ? `<p class="alert" role="alert">${escapeHtml(message)}</p>` : ''}
    <form method="post" action="/login" class="stack">
      <label for="password">Operator password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Enter workshop</button>
    </form>
  </section>
</main>`,
  });
}

function demoCard(demo) {
  const status = escapeHtml(demo.status);
  return `<article class="demo-card" data-demo-id="${escapeHtml(demo.id)}" data-status="${status}" data-shared="${demo.shareEnabled ? 'true' : 'false'}" data-name="${escapeHtml(demo.name)}" data-error="${escapeHtml(demo.error || '')}">
  <div>
    <div class="status-row"><p class="status status-${status}"><span></span>${status}</p>${demo.shareEnabled ? '<p class="status status-shared">Shared</p>' : ''}</div>
    <h2 tabindex="-1">${escapeHtml(demo.name)}</h2>
    <p class="source">${escapeHtml(demo.sourceUrl)}</p>
    ${demo.error ? `<p class="error-copy">${escapeHtml(demo.error)}</p>` : ''}
  </div>
  <div class="demo-actions">
    ${demo.status === 'ready' ? `<a class="button secondary" href="/preview/${escapeHtml(demo.id)}">Open preview</a>${demo.shareEnabled ? '<button class="secondary" data-action="rotate-share">Rotate link</button><button class="quiet" data-action="stop-sharing">Stop sharing</button>' : '<button data-action="share">Share privately</button>'}` : ''}
    ${demo.status !== 'building' ? `<button class="secondary" data-action="retry">Retry</button>` : '<span class="building-note">Extracting a bounded public sample…</span>'}
    <button class="quiet danger" data-action="delete">Delete</button>
  </div>
</article>`;
}

export function dashboardPage(demos, csrf) {
  return shell({
    title: 'Website preview workshop',
    page: 'dashboard',
    csrf,
    body: `<header class="operator-header">
  <div><p class="kicker">Internal tool</p><h1>Website preview workshop</h1></div>
  <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="quiet">Sign out</button></form>
</header>
<main class="dashboard">
  <section class="builder-panel" aria-labelledby="build-heading">
    <div><p class="eyebrow">URL → bounded preview</p><h2 id="build-heading">Create a recognizable sample, not a clone.</h2>
    <p>Reads static public HTML only, stores a maximum of four pages and six products, and never creates real orders.</p></div>
    <form id="create-demo" class="url-form">
      <label for="source-url">Public store or B2B website URL</label>
      <div class="url-row"><input id="source-url" name="url" type="url" inputmode="url" placeholder="https://example.com" required><button type="submit">Build preview</button></div>
      <p id="form-message" class="form-message" aria-live="polite"></p>
    </form>
  </section>
  <section class="preview-list" aria-labelledby="preview-heading">
    <div class="section-title"><h2 id="preview-heading">Previews</h2><span id="saved-count">${demos.length} saved</span></div>
    <p id="dashboard-status" class="visually-hidden" aria-live="polite"></p>
    <div id="demo-list">${demos.length ? demos.map(demoCard).join('') : '<div class="empty"><p>No previews yet.</p><p>Submit a public server-rendered catalog to begin.</p></div>'}</div>
  </section>
  <aside class="scope-note"><strong>Website preview only.</strong> The existing sales widget is not embedded until a demo-specific backend/catalog/session adapter is available.</aside>
</main>`,
  });
}

function assetUrl(demoId, value) {
  if (!value?.startsWith('assets/')) return '';
  return `/asset/${encodeURIComponent(demoId)}/${encodeURIComponent(value.slice(7))}`;
}

function price(item, kind) {
  if (!item.price) return kind === 'b2b' ? 'Request a quote' : 'Price unavailable';
  return `${item.currency ? `${escapeHtml(item.currency)} ` : ''}${escapeHtml(item.price)}`;
}

function itemCard(item, artifact, demoId, base) {
  const image = assetUrl(demoId, item.imageUrl);
  return `<article class="product-card">
  <a href="${base}/item/${encodeURIComponent(item.id)}" aria-label="Open ${escapeHtml(item.name)}">
    <div class="product-image">${image ? `<img src="${image}" alt="${escapeHtml(item.name)}">` : '<span aria-hidden="true">Image unavailable</span>'}</div>
    <div class="product-copy"><h3>${escapeHtml(item.name)}</h3><p>${price(item, artifact.kind)}</p></div>
  </a>
</article>`;
}

function gridClass(artifact) {
  const columns = [2, 3, 4].includes(artifact.style?.gridColumns) ? artifact.style.gridColumns : 3;
  return `product-grid cols-${columns}`;
}

function cartPanel(artifact, session) {
  const rows = Object.entries(session.cart || {}).map(([itemId, quantity]) => {
    const item = artifact.items.find((candidate) => candidate.id === itemId);
    return item ? `<li><span>${escapeHtml(item.name)}</span><strong>${quantity}</strong></li>` : '';
  }).join('');
  const catalog = JSON.stringify(artifact.items.map(({ id, name }) => ({ id, name })));
  return `<aside class="cart-panel" id="demo-cart" data-revision="${session.revision}" data-catalog="${escapeHtml(catalog)}">
  <div class="cart-heading"><p class="eyebrow">Local session</p><h2>${artifact.kind === 'b2b' ? 'Quote draft' : 'Demo cart'}</h2></div>
  <ul id="cart-lines" aria-live="polite">${rows || '<li class="empty-line">No sample items selected.</li>'}</ul>
  <button id="prepare-quote" class="secondary">Prepare local quote draft</button>
  <p id="quote-status" class="small-note" aria-live="polite">${session.quote ? 'A local quote draft is ready. Nothing was sent.' : 'No checkout, email, or merchant system is connected.'}</p>
</aside>`;
}

function categorySidebar(artifact) {
  const categories = artifact.style?.categories || [];
  if (!categories.length) return '';
  return `<aside class="catalog-sidebar" aria-label="Captured source categories"><h2>Source categories</h2><p class="small-note">Only the sample collection is included.</p><ul>${categories.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul></aside>`;
}

export function demoPage({ demo, artifact, session, mode, view, item }) {
  const base = mode === 'share' ? `/share/${demo.id}` : `/preview/${demo.id}`;
  const heroImage = assetUrl(demo.id, artifact.hero?.imageUrl);
  const compact = artifact.style?.layout === 'catalog-sidebar';
  const sidebar = categorySidebar(artifact);
  let content;
  if (view === 'collection') {
    content = `<main class="demo-main"><section class="collection-heading"><p class="eyebrow">Selected public sample</p><h1>${artifact.kind === 'b2b' ? 'Solutions' : 'Collection'}</h1><p>${artifact.items.length} captured ${artifact.kind === 'b2b' ? 'offerings' : 'products'}.</p></section><div class="catalog-layout">${sidebar}<section class="${gridClass(artifact)}">${artifact.items.map((entry) => itemCard(entry, artifact, demo.id, base)).join('')}</section></div></main>`;
  } else if (view === 'item' && item) {
    const image = assetUrl(demo.id, item.imageUrl);
    content = `<main class="demo-main"><section class="detail-layout">
      <div class="detail-image">${image ? `<img src="${image}" alt="${escapeHtml(item.name)}">` : '<span>Image unavailable</span>'}</div>
      <div class="detail-copy"><p class="eyebrow">Sample ${artifact.kind === 'b2b' ? 'offering' : 'product'}</p><h1>${escapeHtml(item.name)}</h1><p class="detail-price">${price(item, artifact.kind)}</p>${item.description ? `<p>${escapeHtml(item.description)}</p>` : '<p class="small-note">Additional specifications were not available in the captured public page.</p>'}
      <form class="quantity-form" data-item-id="${escapeHtml(item.id)}"><label for="quantity">Set demo quantity</label><div><input id="quantity" name="quantity" type="number" min="0" max="99" value="${session.cart[item.id] || 0}" required><button type="submit">Update local state</button></div><p class="form-message" aria-live="polite"></p></form>
      <p><a class="text-link" href="${escapeHtml(item.sourceUrl)}" rel="noreferrer" target="_blank">View captured source page</a></p></div>
    </section></main>`;
  } else if (artifact.hero) {
    content = `<main><section class="demo-hero ${artifact.hero.variant === 'split' ? 'split' : 'centered'}">
      <div class="hero-copy"><p class="eyebrow">${escapeHtml(artifact.hero.eyebrow)}</p><h1>${escapeHtml(artifact.hero.title)}</h1>${artifact.hero.description ? `<p>${escapeHtml(artifact.hero.description)}</p>` : ''}<a class="button" href="${base}/collection">Browse the sample</a></div>
      ${heroImage ? `<div class="hero-image"><img src="${heroImage}" alt=""></div>` : ''}
    </section><section class="featured"><div class="section-title"><div><p class="eyebrow">Captured selection</p><h2>${artifact.kind === 'b2b' ? 'Featured solutions' : 'Featured products'}</h2></div><a href="${base}/collection">View all</a></div><div class="${gridClass(artifact)}">${artifact.items.slice(0, 3).map((entry) => itemCard(entry, artifact, demo.id, base)).join('')}</div></section></main>`;
  } else {
    content = `<main class="demo-main catalog-home"><section class="catalog-lead"><p class="eyebrow">Selected public sample</p><h1>${escapeHtml(artifact.originalName)}</h1><p>Explore ${artifact.items.length} captured ${artifact.kind === 'b2b' ? 'offerings' : 'products'} in this bounded preview.</p></section><div class="catalog-layout">${sidebar}<section class="${gridClass(artifact)}">${artifact.items.map((entry) => itemCard(entry, artifact, demo.id, base)).join('')}</section></div></main>`;
  }
  return shell({
    title: artifact.name,
    page: 'demo',
    bodyClass: compact ? 'source-compact' : '',
    theme: `/theme/${demo.id}.css`,
    body: `<div class="demo-notice">${escapeHtml(artifact.notice)}</div>
<header class="demo-header">
  <a class="brand" href="${base}">${artifact.logoUrl ? `<img src="${assetUrl(demo.id, artifact.logoUrl)}" alt="${escapeHtml(artifact.originalName)}">` : `<span>${escapeHtml(artifact.name)}</span>`}</a>
  <nav aria-label="Demo navigation"><a href="${base}">Home</a><a href="${base}/collection">${artifact.kind === 'b2b' ? 'Solutions' : 'Collection'}</a><a href="#demo-cart">${artifact.kind === 'b2b' ? 'Quote' : 'Cart'}</a></nav>
</header>
${content}
<section class="session-area">${cartPanel(artifact, session)}<p class="preview-note"><strong>Website preview only.</strong> Cart and quote actions stay in this local demo; no order is placed.</p></section>
<footer class="demo-footer"><p>Source: <a href="${escapeHtml(artifact.sourceUrl)}" rel="noreferrer" target="_blank">${escapeHtml(new URL(artifact.sourceUrl).hostname)}</a></p><p>${escapeHtml(artifact.limitations.join(' '))}</p></footer>`,
  });
}

export function notFoundPage(message = 'This preview is unavailable.') {
  return shell({ title: 'Preview unavailable', body: `<main class="message-page"><p class="kicker">Preview unavailable</p><h1>${escapeHtml(message)}</h1><p>The share may be disabled, replaced by a retry, or deleted.</p></main>` });
}
