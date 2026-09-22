const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'The request could not be completed.');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function dashboard() {
  const form = document.querySelector('#create-demo');
  const message = document.querySelector('#form-message');
  const list = document.querySelector('#demo-list');
  const live = document.querySelector('#dashboard-status');
  let timer;

  function add(parent, tag, properties = {}, text = '') {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(properties)) {
      if (name === 'className') node.className = value;
      else if (name === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(name, value);
    }
    if (text) node.textContent = text;
    parent.append(node);
    return node;
  }

  function cardFor(demo) {
    const card = document.createElement('article');
    card.className = 'demo-card';
    card.dataset.demoId = demo.id;
    card.dataset.status = demo.status;
    card.dataset.shared = String(Boolean(demo.shareEnabled));
    card.dataset.name = demo.name;
    card.dataset.error = demo.error || '';
    const copy = add(card, 'div');
    const statuses = add(copy, 'div', { className: 'status-row' });
    const status = add(statuses, 'p', { className: `status status-${demo.status}` });
    add(status, 'span');
    status.append(demo.status);
    if (demo.shareEnabled) add(statuses, 'p', { className: 'status status-shared' }, 'Shared');
    add(copy, 'h2', { tabindex: '-1' }, demo.name);
    add(copy, 'p', { className: 'source' }, demo.sourceUrl);
    if (Number.isInteger(demo.requestedPageCount)) {
      const count = demo.status === 'ready' && Number.isInteger(demo.actualPageCount)
        ? `Requested maximum: ${demo.requestedPageCount} pages; generated: ${demo.actualPageCount}.`
        : `Requested maximum: ${demo.requestedPageCount} pages`;
      add(copy, 'p', { className: 'page-count' }, count);
    }
    if (demo.error) add(copy, 'p', { className: 'error-copy' }, demo.error);
    const actions = add(card, 'div', { className: 'demo-actions' });
    if (demo.status === 'ready') {
      add(actions, 'a', { className: 'button secondary', href: `/preview/${demo.id}` }, 'Open preview');
      if (demo.shareEnabled) {
        add(actions, 'button', { className: 'secondary', dataset: { action: 'rotate-share' } }, 'Rotate link');
        add(actions, 'button', { className: 'quiet', dataset: { action: 'stop-sharing' } }, 'Stop sharing');
      } else {
        add(actions, 'button', { dataset: { action: 'share' } }, 'Share privately');
      }
    }
    if (demo.status === 'building') add(actions, 'span', { className: 'building-note' }, 'Extracting a bounded public sample...');
    else add(actions, 'button', { className: 'secondary', dataset: { action: 'retry' } }, 'Retry');
    add(actions, 'button', { className: 'quiet danger', dataset: { action: 'delete' } }, 'Delete');
    return card;
  }

  function cardMatches(card, demo) {
    return card.dataset.status === demo.status && card.dataset.shared === String(Boolean(demo.shareEnabled)) &&
      card.dataset.name === demo.name && card.dataset.error === (demo.error || '');
  }

  async function refreshDemos(announce = false, focusRequest = null) {
    const { demos } = await request('/api/demos');
    const existing = [...list.querySelectorAll('[data-demo-id]')];
    const ids = new Set(demos.map((demo) => demo.id));
    for (const card of existing) {
      if (ids.has(card.dataset.demoId)) continue;
      const heldFocus = card.contains(document.activeElement);
      const requestedRemoval = focusRequest?.id === card.dataset.demoId && focusRequest.action === 'delete';
      const nearby = card.nextElementSibling?.matches('[data-demo-id]') ? card.nextElementSibling : card.previousElementSibling?.matches('[data-demo-id]') ? card.previousElementSibling : null;
      const name = card.dataset.name;
      card.remove();
      if (heldFocus || requestedRemoval) (nearby?.querySelector('h2') || form.querySelector('#source-url')).focus();
      if (announce) live.textContent = `${name} was deleted.`;
    }
    list.querySelector('.empty')?.remove();
    for (const demo of demos) {
      const current = [...list.querySelectorAll('[data-demo-id]')].find((card) => card.dataset.demoId === demo.id);
      if (!current) list.append(cardFor(demo));
      else if (!cardMatches(current, demo)) {
        const focused = current.contains(document.activeElement) ? document.activeElement : null;
        const requestedAction = focusRequest?.id === demo.id && (focused || document.activeElement === document.body) ? focusRequest.action : null;
        const action = focused?.dataset.action || requestedAction;
        const href = focused?.getAttribute('href');
        const replacement = cardFor(demo);
        current.replaceWith(replacement);
        if (focused || requestedAction) {
          const mappedAction = action === 'share' ? 'rotate-share' : action === 'stop-sharing' ? 'share' : action;
          const equivalent = mappedAction ? replacement.querySelector(`[data-action="${mappedAction}"]`) : href ? replacement.querySelector(`[href="${href}"]`) : null;
          (equivalent || replacement.querySelector('h2')).focus();
        }
        if (announce) live.textContent = `${demo.name} is now ${demo.status}${demo.shareEnabled ? ' and shared' : ''}.`;
      }
    }
    if (!demos.length) {
      const empty = add(list, 'div', { className: 'empty' });
      add(empty, 'p', {}, 'No previews yet.');
      add(empty, 'p', {}, 'Submit a public server-rendered catalog to begin.');
    }
    document.querySelector('#saved-count').textContent = `${demos.length} saved`;
    clearTimeout(timer);
    if (demos.some((demo) => demo.status === 'building')) timer = setTimeout(() => refreshDemos(true).catch(() => {}), 1000);
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = 'Starting a bounded extraction...';
    try {
      const data = new FormData(form);
      await request('/api/demos', { method: 'POST', body: JSON.stringify({ url: data.get('url'), pageCount: data.get('pageCount') }) });
      form.reset();
      message.textContent = 'Preview build started.';
      await refreshDemos(true);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  list?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-demo-id]');
    const id = card.dataset.demoId;
    const focusRequest = card.contains(document.activeElement) ? { id, action: button.dataset.action } : null;
    button.disabled = true;
    try {
      if (button.dataset.action === 'share') {
        const result = await request(`/api/demos/${id}/share`, { method: 'POST', body: '{}' });
        if (navigator.clipboard) await navigator.clipboard.writeText(result.url).catch(() => {});
        window.prompt('Private share link (copied when clipboard access is available):', result.url);
        await refreshDemos(true, focusRequest);
      } else if (button.dataset.action === 'rotate-share') {
        if (!window.confirm('Rotate this private link? The old link and all visitor sessions will stop working.')) return;
        const result = await request(`/api/demos/${id}/rotate-share`, { method: 'POST', body: '{}' });
        if (navigator.clipboard) await navigator.clipboard.writeText(result.url).catch(() => {});
        window.prompt('New private share link. The old link is revoked:', result.url);
        await refreshDemos(true, focusRequest);
      } else if (button.dataset.action === 'stop-sharing') {
        if (!window.confirm('Stop sharing? The private link and all visitor sessions will be revoked.')) return;
        await request(`/api/demos/${id}/stop-sharing`, { method: 'POST', body: '{}' });
        await refreshDemos(true, focusRequest);
      } else if (button.dataset.action === 'retry') {
        await request(`/api/demos/${id}/retry`, { method: 'POST', body: '{}' });
        await refreshDemos(true, focusRequest);
      } else if (button.dataset.action === 'delete' && window.confirm('Delete this preview and revoke all shared sessions?')) {
        await request(`/api/demos/${id}`, { method: 'DELETE' });
        await refreshDemos(true, focusRequest);
      }
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  if (document.querySelector('.status-building')) timer = setTimeout(() => refreshDemos(true).catch(() => {}), 1000);
}

function demo() {
  const path = location.pathname.split('/').filter(Boolean);
  const id = path[1];
  const cart = document.querySelector('#demo-cart');
  let revision = Number(cart?.dataset.revision || 0);
  let catalog = [];
  try { catalog = JSON.parse(cart?.dataset.catalog || '[]'); } catch {}
  const names = new Map(catalog.map((item) => [item.id, item.name]));

  function summary(items) {
    const lines = Object.entries(items || {}).filter(([, quantity]) => quantity > 0);
    return lines.length ? lines.map(([itemId, quantity]) => `${quantity} x ${names.get(itemId) || 'Sample item'}`).join(', ') : 'no selected items';
  }

  function renderSession(session) {
    revision = session.revision;
    cart.dataset.revision = String(revision);
    const list = document.querySelector('#cart-lines');
    list.replaceChildren();
    const lines = Object.entries(session.cart || {}).filter(([, quantity]) => quantity > 0);
    if (!lines.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-line';
      empty.textContent = 'No sample items selected.';
      list.append(empty);
    } else {
      for (const [itemId, quantity] of lines) {
        const row = document.createElement('li');
        const name = document.createElement('span');
        const count = document.createElement('strong');
        name.textContent = names.get(itemId) || 'Sample item';
        count.textContent = String(quantity);
        row.append(name, count);
        list.append(row);
      }
    }
    if (session.quote) document.querySelector('#quote-status').textContent = `Local quote draft: ${summary(session.quote.items)}. Nothing was sent.`;
    else document.querySelector('#quote-status').textContent = 'No checkout, email, or merchant system is connected.';
  }

  document.querySelector('.quantity-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.form-message');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await request(`/api/demo/${id}/cart`, { method: 'POST', body: JSON.stringify({ itemId: form.dataset.itemId, quantity: Number(new FormData(form).get('quantity')), expectedRevision: revision }) });
      renderSession(result.session);
      status.textContent = 'Local demo state updated.';
    } catch (error) {
      if (error.status === 409 && error.body.session) renderSession(error.body.session);
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#prepare-quote')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await request(`/api/demo/${id}/quote`, { method: 'POST', body: JSON.stringify({ expectedRevision: revision }) });
      renderSession(result.session);
    } catch (error) {
      if (error.status === 409 && error.body.session) renderSession(error.body.session);
      document.querySelector('#quote-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

if (document.body.dataset.page === 'dashboard') dashboard();
if (document.body.dataset.page === 'demo') demo();
