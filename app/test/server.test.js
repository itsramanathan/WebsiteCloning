import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createApp, themeCss } from '../src/server.js';

const quiet = { error() {}, log() {} };

function artifact(sourceUrl) {
  return {
    version: 1,
    name: 'Demo - Northstar Supply',
    originalName: 'Northstar Supply',
    sourceUrl,
    sourcePages: [sourceUrl],
    capturedAt: new Date().toISOString(),
    kind: 'retail',
    notice: 'Demo - sample products and information. No real orders.',
    hero: { eyebrow: 'Store preview', title: 'Carry less. Go farther.', description: 'A source-informed fixture.', imageUrl: 'assets/01.png', variant: 'split' },
    logoUrl: undefined,
    style: { accent: '#28533f', surface: '#f4efe6', categories: ['Packs', 'Bottles'] },
    items: [
      { id: 'pack-1', kind: 'product', name: 'Ridgeline Pack', price: '129.00', currency: 'USD', imageUrl: 'assets/01.png', sourceUrl: `${sourceUrl}products/pack` },
      { id: 'bottle-2', kind: 'product', name: 'Field Bottle', sourceUrl: `${sourceUrl}products/bottle` },
    ],
    assetSummary: { count: 1, bytes: 12 },
    limitations: ['Static public HTML only; source JavaScript was not executed.', 'One price remains unknown.'],
  };
}

function colorFromCss(css, variable) {
  const value = css.match(new RegExp(`--${variable}:([^;]+)`))?.[1];
  assert.ok(value, `missing --${variable}`);
  const hex = value.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part + part, 16));
  const fullHex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (fullHex) return fullHex.slice(1).map((part) => Number.parseInt(part, 16));
  return value.match(/\d+/g).map(Number);
}

function contrast(left, right) {
  const luminance = (rgb) => rgb.map((value) => value / 255)
    .map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

async function fixtureBuilder({ sourceUrl, attemptDir }) {
  await mkdir(path.join(attemptDir, 'assets'), { recursive: true });
  await writeFile(path.join(attemptDir, 'assets', '01.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
  const description = artifact(sourceUrl);
  const file = path.join(attemptDir, 'artifact.json');
  await writeFile(file, JSON.stringify(description));
  return { artifact: file, description };
}

async function start(context, builder = fixtureBuilder, overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'preview-server-'));
  const app = await createApp({ host: '127.0.0.1', port: 0, publicBaseUrl: 'http://127.0.0.1', dataDir, password: 'correct horse battery staple', builder, logger: quiet, ...overrides });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  context.after(async () => {
    app.server.close();
    await once(app.server, 'close').catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });
  return { ...app, base, dataDir };
}

async function login(base, password = 'correct horse battery staple', headers = {}) {
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ password }),
  });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function csrf(base, operatorCookie) {
  const response = await fetch(`${base}/api/operator`, { headers: { cookie: operatorCookie } });
  return (await response.json()).csrf;
}

async function api(base, pathname, { cookie, token, method = 'GET', body } = {}) {
  return fetch(`${base}${pathname}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { 'x-csrf-token': token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function waitFor(predicate, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for test state.');
}

async function createReady(app, operatorCookie, csrfToken) {
  const created = await api(app.base, '/api/demos', { cookie: operatorCookie, token: csrfToken, method: 'POST', body: { url: 'https://northstar.example/' } });
  assert.equal(created.status, 202);
  const demo = (await created.json()).demo;
  await waitFor(async () => (await app.store.getDemo(demo.id))?.status === 'ready');
  await waitFor(() => app.runner.active === null);
  return demo;
}

test('management requires login and CSRF, then builds a ready preview', async (context) => {
  const app = await start(context, fixtureBuilder, { publicBaseUrl: 'https://preview.example' });
  assert.equal((await api(app.base, '/api/demos')).status, 401);
  const failed = await login(app.base, 'wrong');
  assert.equal(failed.response.status, 401);
  assert.equal(failed.cookie, undefined);

  const signedIn = await login(app.base);
  assert.equal(signedIn.response.status, 303);
  assert.match(signedIn.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/);
  const token = await csrf(app.base, signedIn.cookie);
  assert.ok(token);
  assert.equal((await api(app.base, '/api/demos', { cookie: signedIn.cookie, token: 'wrong', method: 'POST', body: { url: 'https://northstar.example/' } })).status, 403);

  const demo = await createReady(app, signedIn.cookie, token);
  const preview = await fetch(`${app.base}/preview/${demo.id}`, { headers: { cookie: signedIn.cookie } });
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Demo - sample products and information\. No real orders\./);
});

test('address-scoped login lockout rejects correct credentials until its window expires', async (context) => {
  let now = 1_000;
  const app = await start(context, fixtureBuilder, { now: () => now, loginLimitWindowMs: 100 });
  for (let index = 0; index < 5; index += 1) assert.equal((await login(app.base, 'wrong')).response.status, 401);
  assert.equal((await login(app.base, 'wrong')).response.status, 429);
  assert.equal((await login(app.base)).response.status, 429, 'a correct guess cannot bypass an exhausted limit');
  now += 101;
  assert.equal((await login(app.base)).response.status, 303, 'the address recovers after the configured window');
  const malformed = await fetch(`${app.base}/login`, { headers: { cookie: 'demo_session=%E0' } });
  assert.equal(malformed.status, 200);
});

test('trusted proxy client addresses are opt-in and must arrive from loopback', async (context) => {
  const app = await start(context, fixtureBuilder, { trustLoopbackProxy: true });
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await login(app.base, 'wrong', { 'x-real-ip': '203.0.113.10' })).response.status, 401);
  }
  assert.equal((await login(app.base, 'wrong', { 'x-real-ip': '203.0.113.10' })).response.status, 429);
  assert.equal((await login(app.base, 'wrong', { 'x-real-ip': '198.51.100.20' })).response.status, 401);
});

test('theme colors retain readable text and button contrast', () => {
  const css = themeCss({ style: { accent: '#e91e63', font: 'sans' } });
  const brand = colorFromCss(css, 'brand');
  const brandInk = colorFromCss(css, 'brand-ink');
  const brandText = colorFromCss(css, 'brand-text');
  assert.deepEqual(brand, [233, 30, 99]);
  assert.match(css, /--brand-text:rgb\(/);
  assert.match(css, /--brand-ink:#(?:000|fff);/);
  assert.ok(contrast(brand, brandInk) >= 4.5, 'button ink must meet AA against the captured accent');
  assert.ok(contrast(brandText, [247, 242, 233]) >= 4.5, 'brand text must meet AA against paper');
  assert.ok(contrast(brandText, [255, 253, 248]) >= 4.5, 'brand text must meet AA against panels');
  assert.match(css, /--source-font:'Trebuchet MS'/);
});

test('private sharing isolates visitor sessions, protects assets, and rejects stale writes', async (context) => {
  const app = await start(context);
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const demo = await createReady(app, signedIn.cookie, token);

  assert.equal((await fetch(`${app.base}/asset/${demo.id}/01.png`)).status, 404, 'slug alone grants no asset access');
  const sharedResponse = await api(app.base, `/api/demos/${demo.id}/share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} });
  assert.equal(sharedResponse.status, 200);
  const shared = await sharedResponse.json();
  assert.match(shared.path, new RegExp(`^/share/${demo.id}\\?token=`));
  assert.equal((await api(app.base, `/api/demos/${demo.id}/share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} })).status, 409, 'sharing again cannot silently rotate a live link');
  assert.match(await (await fetch(`${app.base}/`, { headers: { cookie: signedIn.cookie } })).text(), /Shared[\s\S]*Rotate link/);

  const firstEntry = await fetch(`${app.base}${shared.path}`, { redirect: 'manual' });
  const secondEntry = await fetch(`${app.base}${shared.path}`, { redirect: 'manual' });
  const firstCookie = firstEntry.headers.get('set-cookie').split(';')[0];
  const secondCookie = secondEntry.headers.get('set-cookie').split(';')[0];
  assert.match(firstEntry.headers.get('set-cookie'), new RegExp(`^demo_session_${demo.id}=.*HttpOnly; SameSite=Lax`));
  assert.notEqual(firstCookie, secondCookie);
  assert.equal(firstEntry.headers.get('location'), `/share/${demo.id}`, 'token is removed from the browsing URL');
  const repeatedEntry = await fetch(`${app.base}${shared.path}`, { redirect: 'manual', headers: { cookie: firstCookie } });
  assert.equal(repeatedEntry.status, 303);
  assert.equal(repeatedEntry.headers.get('set-cookie'), null, 'a valid same-demo viewer session is reused');
  assert.equal((await fetch(`${app.base}/asset/${demo.id}/01.png`, { headers: { cookie: firstCookie } })).status, 200);

  const firstContext = await api(app.base, `/api/demo/${demo.id}/context`, { cookie: firstCookie });
  const firstState = (await firstContext.json()).session;
  const collection = await fetch(`${app.base}/share/${demo.id}/collection`, { headers: { cookie: firstCookie } });
  assert.equal(collection.status, 200);
  const collectionHtml = await collection.text();
  assert.match(collectionHtml, /Only the sample collection is included\./);
  assert.doesNotMatch(collectionHtml, /<a[^>]*>Packs<\/a>/, 'captured categories are not fake navigation');
  const afterNavigation = (await (await api(app.base, `/api/demo/${demo.id}/context`, { cookie: firstCookie })).json()).session;
  assert.equal(afterNavigation.currentPage, 'collection');
  assert.equal(afterNavigation.revision, firstState.revision, 'HTML page bookkeeping does not invalidate an API revision');
  const updated = await api(app.base, `/api/demo/${demo.id}/cart`, { cookie: firstCookie, method: 'POST', body: { itemId: 'pack-1', quantity: 2, expectedRevision: firstState.revision } });
  assert.equal(updated.status, 200);
  const updatedState = (await updated.json()).session;
  assert.equal(updatedState.cart['pack-1'], 2);
  const stale = await api(app.base, `/api/demo/${demo.id}/cart`, { cookie: firstCookie, method: 'POST', body: { itemId: 'pack-1', quantity: 3, expectedRevision: firstState.revision } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).session.cart['pack-1'], 2);
  const quote = await api(app.base, `/api/demo/${demo.id}/quote`, { cookie: firstCookie, method: 'POST', body: { expectedRevision: updatedState.revision, note: 'Local fixture quote' } });
  assert.equal((await quote.json()).session.quote.localOnly, true);
  const secondContext = await api(app.base, `/api/demo/${demo.id}/context`, { cookie: secondCookie });
  const secondState = (await secondContext.json()).session;
  assert.deepEqual(secondState.cart, {});
  const navigated = await api(app.base, `/api/demo/${demo.id}/navigate`, { cookie: secondCookie, method: 'POST', body: { target: 'item:pack-1', expectedRevision: secondState.revision } });
  assert.equal((await navigated.json()).session.currentPage, 'item:pack-1');

  const rotatedResponse = await api(app.base, `/api/demos/${demo.id}/rotate-share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} });
  assert.equal(rotatedResponse.status, 200);
  const rotated = await rotatedResponse.json();
  assert.equal((await fetch(`${app.base}${shared.path}`)).status, 404, 'rotation revokes the old link');
  assert.equal((await api(app.base, `/api/demo/${demo.id}/context`, { cookie: firstCookie })).status, 404, 'rotation revokes existing visitor sessions');
  assert.equal((await fetch(`${app.base}${rotated.path}`, { redirect: 'manual' })).status, 303);
  assert.equal((await api(app.base, `/api/demos/${demo.id}/stop-sharing`, { cookie: signedIn.cookie, token, method: 'POST', body: {} })).status, 200);
  assert.equal((await fetch(`${app.base}${rotated.path}`)).status, 404, 'stopping sharing revokes the rotated link');
  assert.match(await (await fetch(`${app.base}/`, { headers: { cookie: signedIn.cookie } })).text(), /Share privately/);

  const retried = await api(app.base, `/api/demos/${demo.id}/retry`, { cookie: signedIn.cookie, token, method: 'POST', body: {} });
  assert.equal(retried.status, 202);
  assert.equal((await api(app.base, `/api/demo/${demo.id}/context`, { cookie: firstCookie })).status, 404, 'retry revokes old visitor sessions');
  await waitFor(() => app.runner.active === null);
});

test('share exchange bounds new sessions by address while allowing cookie reuse', async (context) => {
  const app = await start(context, fixtureBuilder, { viewerSessionLimit: 1, viewerSessionWindowMs: 1_000 });
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const demo = await createReady(app, signedIn.cookie, token);
  const response = await api(app.base, `/api/demos/${demo.id}/share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} });
  const shared = await response.json();
  const first = await fetch(`${app.base}${shared.path}`, { redirect: 'manual' });
  const visitorCookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${app.base}${shared.path}`, { redirect: 'manual', headers: { cookie: visitorCookie } })).status, 303);
  assert.equal((await fetch(`${app.base}${shared.path}`, { redirect: 'manual' })).status, 429);
});

test('per-demo cookies preserve independent visitor state and reuse operator previews', async (context) => {
  const app = await start(context);
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const first = await createReady(app, signedIn.cookie, token);
  const second = await createReady(app, signedIn.cookie, token);

  const firstShare = await (await api(app.base, `/api/demos/${first.id}/share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} })).json();
  const secondShare = await (await api(app.base, `/api/demos/${second.id}/share`, { cookie: signedIn.cookie, token, method: 'POST', body: {} })).json();
  const firstEntry = await fetch(`${app.base}${firstShare.path}`, { redirect: 'manual' });
  const secondEntry = await fetch(`${app.base}${secondShare.path}`, { redirect: 'manual' });
  const firstCookie = firstEntry.headers.get('set-cookie').split(';')[0];
  const secondCookie = secondEntry.headers.get('set-cookie').split(';')[0];
  assert.match(firstCookie, new RegExp(`^demo_session_${first.id}=`));
  assert.match(secondCookie, new RegExp(`^demo_session_${second.id}=`));
  const visitorCookies = `${firstCookie}; ${secondCookie}`;

  const firstState = (await (await api(app.base, `/api/demo/${first.id}/context`, { cookie: visitorCookies })).json()).session;
  const secondState = (await (await api(app.base, `/api/demo/${second.id}/context`, { cookie: visitorCookies })).json()).session;
  await api(app.base, `/api/demo/${first.id}/cart`, { cookie: visitorCookies, method: 'POST', body: { itemId: 'pack-1', quantity: 2, expectedRevision: firstState.revision } });
  await api(app.base, `/api/demo/${second.id}/cart`, { cookie: visitorCookies, method: 'POST', body: { itemId: 'pack-1', quantity: 3, expectedRevision: secondState.revision } });
  assert.equal((await (await api(app.base, `/api/demo/${first.id}/context`, { cookie: visitorCookies })).json()).session.cart['pack-1'], 2);
  assert.equal((await (await api(app.base, `/api/demo/${second.id}/context`, { cookie: visitorCookies })).json()).session.cart['pack-1'], 3);

  const firstPreview = await fetch(`${app.base}/preview/${first.id}`, { redirect: 'manual', headers: { cookie: signedIn.cookie } });
  const firstPreviewCookie = firstPreview.headers.get('set-cookie').split(';')[0];
  const secondPreview = await fetch(`${app.base}/preview/${second.id}`, { redirect: 'manual', headers: { cookie: `${signedIn.cookie}; ${firstPreviewCookie}` } });
  const secondPreviewCookie = secondPreview.headers.get('set-cookie').split(';')[0];
  const operatorCookies = `${signedIn.cookie}; ${firstPreviewCookie}; ${secondPreviewCookie}`;
  const reopened = await fetch(`${app.base}/preview/${first.id}`, { redirect: 'manual', headers: { cookie: operatorCookies } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.headers.get('set-cookie'), null, 'alternating previews reuses each demo session');
  assert.equal(Object.values(app.store.state.sessions).filter((session) => session.preview).length, 2);
});

test('operator APIs refuse to create orphan preview sessions before the HTML view sets a cookie', async (context) => {
  const app = await start(context);
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const demo = await createReady(app, signedIn.cookie, token);
  const response = await api(app.base, `/api/demo/${demo.id}/context`, { cookie: signedIn.cookie });
  assert.equal(response.status, 404);
  assert.equal(Object.keys(app.store.state.sessions).length, 0);
});

test('job watchdog releases a timed-out claim and removes an uncooperative late write', async (context) => {
  let calls = 0;
  let releaseLate;
  let confirmLateWrite;
  const blocked = new Promise((resolve) => { releaseLate = resolve; });
  const lateWrite = new Promise((resolve) => { confirmLateWrite = resolve; });
  const builder = async (input) => {
    calls += 1;
    if (calls > 1) return fixtureBuilder(input);
    await blocked;
    const result = await fixtureBuilder(input);
    confirmLateWrite();
    return result;
  };
  const app = await start(context, builder, { storeOptions: { attemptMs: 50 } });
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const firstResponse = await api(app.base, '/api/demos', { cookie: signedIn.cookie, token, method: 'POST', body: { url: 'https://slow.example/' } });
  const first = (await firstResponse.json()).demo;
  await waitFor(() => app.runner.active === null);
  assert.equal((await app.store.getDemo(first.id)).status, 'failed');
  const second = await createReady(app, signedIn.cookie, token);
  assert.equal((await app.store.getDemo(second.id)).status, 'ready');
  releaseLate();
  await lateWrite;
  await waitFor(async () => {
    try {
      await access(app.store.attemptDirectory(first.id, first.attempt));
      return false;
    } catch {
      return true;
    }
  });
});

test('delete cancels its job slot without letting a late worker clear the next job', async (context) => {
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  let confirmLateWrite;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const secondBlocked = new Promise((resolve) => { releaseSecond = resolve; });
  const lateWrite = new Promise((resolve) => { confirmLateWrite = resolve; });
  const builder = async (input) => {
    calls += 1;
    if (calls === 1) {
      await firstBlocked;
      const result = await fixtureBuilder(input);
      confirmLateWrite();
      return result;
    }
    await secondBlocked;
    return fixtureBuilder(input);
  };
  const app = await start(context, builder);
  const signedIn = await login(app.base);
  const token = await csrf(app.base, signedIn.cookie);
  const created = await api(app.base, '/api/demos', { cookie: signedIn.cookie, token, method: 'POST', body: { url: 'https://northstar.example/' } });
  const demo = (await created.json()).demo;
  await waitFor(() => calls === 1);
  assert.equal((await api(app.base, `/api/demos/${demo.id}`, { cookie: signedIn.cookie, token, method: 'DELETE' })).status, 200);
  const nextResponse = await api(app.base, '/api/demos', { cookie: signedIn.cookie, token, method: 'POST', body: { url: 'https://next.example/' } });
  assert.equal(nextResponse.status, 202, 'delete promptly releases the single-job slot');
  const next = (await nextResponse.json()).demo;
  await waitFor(() => calls === 2);
  releaseFirst();
  await lateWrite;
  await waitFor(async () => {
    try {
      await access(app.store.attemptDirectory(demo.id, demo.attempt));
      return false;
    } catch {
      return true;
    }
  });
  assert.notEqual(app.runner.active, null, 'the deleted job finalizer does not clear the next job');
  assert.equal((await api(app.base, '/api/demos', { cookie: signedIn.cookie, token, method: 'POST', body: { url: 'https://third.example/' } })).status, 429);
  releaseSecond();
  await waitFor(() => app.runner.active === null);
  assert.equal((await app.store.getDemo(next.id)).status, 'ready');
  const tombstone = await app.store.getDemo(demo.id, true);
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.artifact, null);
  await assert.rejects(access(app.store.attemptDirectory(demo.id, 1)));
});
