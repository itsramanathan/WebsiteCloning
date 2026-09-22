import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { buildAttempt } from './builder.js';
import { DEMO_PAGE_COUNT } from './extract.js';
import { Store } from './store.js';
import { validateUrl } from './safe-fetch.js';
import { clampInteger, constantEqual, cookie, cookies, id, readBody, sendHtml, sendJson } from './util.js';
import { dashboardPage, demoPage, loginPage, notFoundPage } from './ui.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(directory, '..');
const staticFiles = new Map([
  ['/static/styles.css', { file: path.join(appRoot, 'public/styles.css'), type: 'text/css; charset=utf-8' }],
  ['/static/app.js', { file: path.join(appRoot, 'public/app.js'), type: 'text/javascript; charset=utf-8' }],
]);

class RateLimit {
  constructor(limit, windowMs, maxEntries = 2_500, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  take(key) {
    const now = this.now();
    for (const [entryKey, entry] of this.entries) {
      if (entry.reset <= now) this.entries.delete(entryKey);
    }
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    const current = this.entries.get(key);
    if (!current || current.reset <= now) {
      this.entries.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

export class JobRunner {
  constructor(store, builder, logger) {
    this.store = store;
    this.builder = builder;
    this.logger = logger;
    this.active = null;
  }

  claim() {
    if (this.active) return null;
    const claim = Symbol('job');
    this.active = { claim, demoId: null, controller: null, cancel: null, task: null };
    return claim;
  }

  release(claim) {
    if (this.active?.claim === claim) this.active = null;
  }

  start(claim, demo) {
    const active = this.active;
    if (active?.claim !== claim) throw new Error('Invalid job claim.');
    const attemptDir = this.store.attemptDirectory(demo.id, demo.attempt);
    const controller = new AbortController();
    active.demoId = demo.id;
    active.controller = controller;
    const task = (async () => {
      let timer;
      let cleanupAfterSettlement = false;
      const cancelled = new Promise((_, reject) => {
        active.cancel = (reason) => {
          cleanupAfterSettlement = true;
          controller.abort(reason);
          reject(reason);
        };
      });
      try {
        const remaining = demo.deadlineAt - Date.now();
        if (remaining <= 0) throw deadlineError();
        const work = Promise.resolve().then(() => this.builder({ sourceUrl: demo.sourceUrl, attemptDir, requestedPageCount: demo.requestedPageCount, deadline: demo.deadlineAt, signal: controller.signal }));
        void work.then(
          () => cleanupAfterSettlement && this.store.removeAttempt(demo.id, demo.attempt),
          () => cleanupAfterSettlement && this.store.removeAttempt(demo.id, demo.attempt),
        ).catch((error) => this.logger.error?.(`Late cleanup failed for ${demo.id}: ${error.message}`));
        const result = await Promise.race([
          work,
          cancelled,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = deadlineError();
              cleanupAfterSettlement = true;
              controller.abort(error);
              reject(error);
            }, remaining);
          }),
        ]);
        const published = await this.store.completeAttempt(demo.id, demo.attempt, result.artifact, result.description);
        if (!published) await this.store.removeAttempt(demo.id, demo.attempt);
      } catch (error) {
        await this.store.failAttempt(demo.id, demo.attempt, userFacingBuildError(error));
        await this.store.removeAttempt(demo.id, demo.attempt);
        this.logger.error?.(`Generation failed for ${demo.id}: ${error.message}`);
      } finally {
        clearTimeout(timer);
        active.cancel = null;
        controller.abort(deadlineError());
        if (this.active === active) this.active = null;
      }
    })();
    active.task = task;
  }

  cancel(demoId) {
    const active = this.active;
    if (!active || active.demoId !== demoId || !active.cancel) return false;
    const error = new Error('Generation cancelled because the preview was deleted.');
    error.code = 'CANCELLED';
    active.cancel(error);
    if (this.active === active) this.active = null;
    return true;
  }
}

function deadlineError() {
  const error = new Error('The generation attempt exceeded its deadline.');
  error.code = 'DEADLINE';
  return error;
}

function userFacingBuildError(error) {
  const allowed = new Set([
    'INVALID_URL', 'INVALID_SCHEME', 'URL_CREDENTIALS', 'NONSTANDARD_PORT', 'INVALID_HOST', 'NONPUBLIC_ADDRESS',
    'RESPONSE_TOO_LARGE', 'TIMEOUT', 'DEADLINE', 'TOO_MANY_REDIRECTS', 'INVALID_REDIRECT', 'UNSUPPORTED_ENCODING',
    'INVALID_COMPRESSION', 'INCOMPLETE_RESPONSE', 'HTTP_STATUS', 'NO_CATALOG', 'INVALID_PAGE_COUNT', 'INSUFFICIENT_CATALOG',
  ]);
  if (allowed.has(error.code) || /catalog|HTML|deadline|redirect|source/i.test(error.message)) return error.message;
  return 'The source could not be turned into a complete preview. It may block static requests or require JavaScript.';
}

function securityHeaders() {
  return {
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cache-control': 'no-store',
  };
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, ...headers });
  response.end();
}

function operatorSession(request, sessions) {
  const token = cookies(request).operator_session;
  return token ? sessions.get(token) : null;
}

function requireOperator(request, response, sessions) {
  const session = operatorSession(request, sessions);
  if (!session) sendJson(response, 401, { error: 'Operator sign in is required.' });
  return session;
}

function requireCsrf(request, response, session, body = {}) {
  const supplied = request.headers['x-csrf-token'] || body.csrf;
  if (!supplied || !constantEqual(supplied, session.csrf)) {
    sendJson(response, 403, { error: 'The form expired. Refresh and try again.' });
    return false;
  }
  return true;
}

async function loadArtifact(store, demo) {
  const artifactPath = store.artifactPath(demo);
  if (!artifactPath) return null;
  try {
    const raw = await readFile(artifactPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseColor(input) {
  const value = String(input || '').toLowerCase();
  const short = value.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  if (short) return short.slice(1).map((part) => Number.parseInt(part + part, 16));
  const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part, 16));
  const rgb = value.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,[\d.]+)?\)$/);
  if (rgb) return rgb.slice(1).map(Number).every((part) => part <= 255) ? rgb.slice(1).map(Number) : null;
  return null;
}

function luminance(rgb) {
  return rgb.map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}

function accessibleTextColor(rgb, surfaces) {
  let candidate = [...rgb];
  while (surfaces.some((surface) => contrast(candidate, surface) < 4.5)) {
    candidate = candidate.map((value) => Math.floor(value * .85));
  }
  return `rgb(${candidate.join(' ')})`;
}

export function themeCss(artifact) {
  const rgb = parseColor(artifact.style?.accent) || [172, 77, 45];
  const color = `rgb(${rgb.join(' ')})`;
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  const ink = contrast(rgb, black) >= contrast(rgb, white) ? '#000' : '#fff';
  const paper = [247, 242, 233];
  const panel = [255, 253, 248];
  const textBrand = accessibleTextColor(rgb, [paper, panel]);
  const spacing = artifact.style?.density === 'compact' ? '3rem' : artifact.style?.density === 'airy' ? '7rem' : '5rem';
  const font = artifact.style?.font === 'sans' ? "'Trebuchet MS', Verdana, sans-serif" : "Georgia, 'Times New Roman', serif";
  return `:root{--brand:${color};--brand-text:${textBrand};--brand-ink:${ink};--section-space:${spacing};--source-font:${font}}\n`;
}

function viewRoute(pathname) {
  const match = pathname.match(/^\/(preview|share)\/([^/]+)(?:\/(collection)|\/item\/([^/]+))?$/);
  if (!match) return null;
  return { mode: match[1], id: match[2], view: match[3] ? 'collection' : match[4] ? 'item' : 'home', itemId: match[4] };
}

function useSecureCookies(request, config) {
  return Boolean(request.socket.encrypted) || config.secureCookies;
}

function loopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientAddress(request, config) {
  const remote = request.socket.remoteAddress || 'unknown';
  if (!config.trustLoopbackProxy || !loopbackAddress(remote)) return remote;
  const forwarded = String(request.headers['x-real-ip'] || '').trim();
  return net.isIP(forwarded) ? forwarded : remote;
}

function viewerCookieName(demoId) {
  return /^[A-Za-z0-9_-]{16}$/.test(demoId) ? `demo_session_${demoId}` : null;
}

function sessionCookie(request, demoId, token, config) {
  const name = viewerCookieName(demoId);
  if (!name) throw new Error('Invalid preview identifier.');
  return cookie(name, token, { secure: useSecureCookies(request, config), sameSite: 'Lax' });
}

async function demoAccess(request, store, demoId, sessions, config, createOperatorSession = true) {
  const operator = operatorSession(request, sessions);
  const name = viewerCookieName(demoId);
  if (!name) return null;
  const token = cookies(request)[name];
  const existing = store.getViewerSession(demoId, token, Boolean(operator));
  if (existing) return { operator: Boolean(operator), session: existing, token, setCookie: null };
  if (!operator || !createOperatorSession) return null;
  const created = await store.createPreviewSession(demoId);
  return created ? { operator: true, session: created.session, token: created.token, setCookie: sessionCookie(request, demoId, created.token, config) } : null;
}

function assertJson(request) {
  if (String(request.headers['content-type'] || '').split(';')[0] !== 'application/json') {
    const error = new Error('Demo actions require application/json.');
    error.status = 415;
    throw error;
  }
}

function publicBase(options) {
  if (options.publicBaseUrl) return options.publicBaseUrl.replace(/\/$/, '');
  const host = options.host === '::1' ? '[::1]' : options.host;
  return `http://${host}:${options.port}`;
}

function requestedPageCount(value) {
  const validNumber = typeof value === 'number' && Number.isInteger(value);
  const validString = typeof value === 'string' && /^[1-8]$/.test(value);
  const count = validNumber ? value : validString ? Number(value) : null;
  if (count !== null && count >= DEMO_PAGE_COUNT.min && count <= DEMO_PAGE_COUNT.max) return count;
  const error = new Error(`Maximum demo pages must be an integer from ${DEMO_PAGE_COUNT.min} to ${DEMO_PAGE_COUNT.max}.`);
  error.status = 400;
  throw error;
}

function artifactPageCount(artifact) {
  if (Number.isInteger(artifact.actualPageCount) && artifact.actualPageCount >= 1) return artifact.actualPageCount;
  return Math.max(1, (Array.isArray(artifact.items) ? artifact.items.length : 0) + 2);
}

function generatedItems(artifact) {
  return (artifact.items || []).slice(0, Math.max(0, artifactPageCount(artifact) - 2));
}

export async function createApp(options = {}) {
  const config = {
    host: options.host || '127.0.0.1',
    port: options.port ?? 4320,
    dataDir: options.dataDir || process.env.DATA_DIR || path.join(appRoot, 'data'),
    password: options.password || id(18),
    publicBaseUrl: options.publicBaseUrl,
    secureCookies: options.secureCookies ?? String(options.publicBaseUrl || '').startsWith('https://'),
    trustLoopbackProxy: options.trustLoopbackProxy ?? process.env.TRUST_LOOPBACK_PROXY === '1',
    logger: options.logger || console,
  };
  const store = options.store || await new Store(config.dataDir, options.storeOptions).init();
  const operatorSessions = new Map();
  const now = options.now || Date.now;
  const loginLimit = new RateLimit(options.loginLimit ?? 5, options.loginLimitWindowMs ?? 10 * 60_000, 2_500, now);
  const generationLimit = new RateLimit(10, 60 * 60_000);
  const viewerSessionLimit = new RateLimit(options.viewerSessionLimit ?? 20, options.viewerSessionWindowMs ?? 10 * 60_000, 2_500, now);
  const runner = new JobRunner(store, options.builder || buildAttempt, config.logger);

  const server = http.createServer(async (request, response) => {
    Object.entries(securityHeaders()).forEach(([name, value]) => response.setHeader(name, value));
    const url = new URL(request.url, 'http://localhost');
    try {
      const staticFile = staticFiles.get(url.pathname);
      if (request.method === 'GET' && staticFile) {
        const body = await readFile(staticFile.file);
        response.setHeader('cache-control', 'public, max-age=3600');
        response.writeHead(200, { 'content-type': staticFile.type, 'content-length': body.length });
        response.end(body);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/login') {
        if (operatorSession(request, operatorSessions)) return redirect(response, '/');
        return sendHtml(response, 200, loginPage());
      }
      if (request.method === 'POST' && url.pathname === '/login') {
        const body = await readBody(request);
        if (!loginLimit.take(clientAddress(request, config))) return sendHtml(response, 429, loginPage('Too many sign-in attempts from this address. Wait ten minutes and try again.'));
        if (!constantEqual(body.password || '', config.password)) {
          return sendHtml(response, 401, loginPage('The operator password is incorrect.'));
        }
        const token = id(24);
        operatorSessions.set(token, { csrf: id(24), createdAt: Date.now() });
        return redirect(response, '/', { 'set-cookie': cookie('operator_session', token, { secure: useSecureCookies(request, config) }) });
      }
      if (request.method === 'POST' && url.pathname === '/logout') {
        const body = await readBody(request);
        const session = operatorSession(request, operatorSessions);
        if (!session || !requireCsrf(request, response, session, body)) return;
        operatorSessions.delete(cookies(request).operator_session);
        return redirect(response, '/login', { 'set-cookie': cookie('operator_session', '', { maxAge: 0, secure: useSecureCookies(request, config) }) });
      }

      if (request.method === 'GET' && url.pathname === '/') {
        const session = operatorSession(request, operatorSessions);
        if (!session) return redirect(response, '/login');
        return sendHtml(response, 200, dashboardPage(await store.listDemos(), session.csrf));
      }
      if (request.method === 'GET' && url.pathname === '/api/operator') {
        const session = requireOperator(request, response, operatorSessions);
        if (!session) return;
        return sendJson(response, 200, { csrf: session.csrf });
      }
      if (request.method === 'GET' && url.pathname === '/api/demos') {
        if (!requireOperator(request, response, operatorSessions)) return;
        return sendJson(response, 200, { demos: await store.listDemos() });
      }
      if (request.method === 'POST' && url.pathname === '/api/demos') {
        const session = requireOperator(request, response, operatorSessions);
        if (!session) return;
        const body = await readBody(request);
        if (!requireCsrf(request, response, session, body)) return;
        const pageCount = requestedPageCount(body.pageCount);
        if (!generationLimit.take(cookies(request).operator_session)) return sendJson(response, 429, { error: 'Generation limit reached. Try again later.' });
        const claim = runner.claim();
        if (!claim) return sendJson(response, 429, { error: 'One preview is already building. Wait for it to finish.' });
        let demo;
        try {
          const source = validateUrl(body.url).href;
          demo = await store.createDemo(source, pageCount);
        } catch (error) {
          runner.release(claim);
          throw error;
        }
        runner.start(claim, demo);
        return sendJson(response, 202, { demo });
      }

      const management = url.pathname.match(/^\/api\/demos\/([^/]+)(?:\/(share|rotate-share|stop-sharing|retry))?$/);
      if (management && ['POST', 'DELETE'].includes(request.method)) {
        const session = requireOperator(request, response, operatorSessions);
        if (!session) return;
        const body = request.method === 'POST' ? await readBody(request) : {};
        if (!requireCsrf(request, response, session, body)) return;
        const [, demoId, action] = management;
        if (request.method === 'DELETE' && !action) {
          runner.cancel(demoId);
          const deleted = await store.deleteDemo(demoId);
          return deleted ? sendJson(response, 200, { deleted: true }) : sendJson(response, 404, { error: 'Preview not found.' });
        }
        if (request.method === 'POST' && action === 'share') {
          const shared = await store.enableSharing(demoId);
          if (!shared) return sendJson(response, 404, { error: 'Preview not found.' });
          const sharePath = `/share/${demoId}?token=${encodeURIComponent(shared.token)}`;
          return sendJson(response, 200, { demo: shared.demo, path: sharePath, url: `${publicBase(config)}${sharePath}` });
        }
        if (request.method === 'POST' && action === 'rotate-share') {
          const shared = await store.rotateSharing(demoId);
          if (!shared) return sendJson(response, 404, { error: 'Preview not found.' });
          const sharePath = `/share/${demoId}?token=${encodeURIComponent(shared.token)}`;
          return sendJson(response, 200, { demo: shared.demo, path: sharePath, url: `${publicBase(config)}${sharePath}` });
        }
        if (request.method === 'POST' && action === 'stop-sharing') {
          const demo = await store.disableSharing(demoId);
          return demo ? sendJson(response, 200, { demo }) : sendJson(response, 404, { error: 'Preview not found.' });
        }
        if (request.method === 'POST' && action === 'retry') {
          const claim = runner.claim();
          if (!claim) return sendJson(response, 429, { error: 'One preview is already building. Wait for it to finish.' });
          try {
            const demo = await store.retry(demoId);
            if (!demo) {
              runner.release(claim);
              return sendJson(response, 404, { error: 'Preview not found.' });
            }
            runner.start(claim, demo);
            return sendJson(response, 202, { demo });
          } catch (error) {
            runner.release(claim);
            throw error;
          }
        }
      }

      if (request.method === 'GET' && url.pathname.startsWith('/share/') && url.searchParams.has('token')) {
        const route = viewRoute(url.pathname);
        if (!route || !store.verifyShareToken(route.id, url.searchParams.get('token'))) return sendHtml(response, 404, notFoundPage());
        const existingToken = cookies(request)[viewerCookieName(route.id)];
        const existing = store.getViewerSession(route.id, existingToken);
        if (existing && !existing.preview) return redirect(response, url.pathname);
        if (!viewerSessionLimit.take(clientAddress(request, config))) {
          return sendHtml(response, 429, notFoundPage('Too many new visitor sessions were requested from this address. Wait and try again.'));
        }
        const created = await store.createViewerSession(route.id);
        if (!created) return sendHtml(response, 404, notFoundPage());
        return redirect(response, url.pathname, { 'set-cookie': sessionCookie(request, route.id, created.token, config) });
      }

      const route = viewRoute(url.pathname);
      if (request.method === 'GET' && route) {
        const demo = await store.getDemo(route.id);
        if (!demo || demo.status !== 'ready') return sendHtml(response, 404, notFoundPage());
        const access = await demoAccess(request, store, route.id, operatorSessions, config);
        if (route.mode === 'preview' && !access?.operator) return redirect(response, '/login');
        if (route.mode === 'share' && (!access || access.operator && !demo.shareEnabled)) {
          if (!access?.operator) return sendHtml(response, 404, notFoundPage());
        }
        if (!access) return sendHtml(response, 404, notFoundPage());
        const artifact = await loadArtifact(store, demo);
        if (!artifact) return sendHtml(response, 404, notFoundPage('The current artifact is incomplete.'));
        if (route.view === 'collection' && artifactPageCount(artifact) < 2) return sendHtml(response, 404, notFoundPage());
        const item = route.itemId ? generatedItems(artifact).find((candidate) => candidate.id === route.itemId) : null;
        if (route.view === 'item' && !item) return sendHtml(response, 404, notFoundPage('That sample item is not included.'));
        let current = access.session;
        const page = route.view === 'item' ? `item:${item.id}` : route.view;
        if (current.currentPage !== page) current = await store.setCurrentPage(route.id, access.token, page, access.operator);
        const headers = access.setCookie ? { 'set-cookie': access.setCookie } : {};
        return sendHtml(response, 200, demoPage({ demo, artifact, session: current, mode: route.mode, view: route.view, item }), headers);
      }

      const asset = url.pathname.match(/^\/asset\/([^/]+)\/([^/]+)$/);
      if (request.method === 'GET' && asset) {
        const demo = await store.getDemo(asset[1]);
        const access = demo && await demoAccess(request, store, asset[1], operatorSessions, config);
        if (!demo || demo.status !== 'ready' || !access) return sendJson(response, 404, { error: 'Asset not found.' });
        const artifactPath = store.artifactPath(demo);
        const name = decodeURIComponent(asset[2]);
        if (!artifactPath || path.basename(name) !== name || !/^\d{2}\.(?:jpg|png|webp)$/.test(name)) return sendJson(response, 404, { error: 'Asset not found.' });
        try {
          const body = await readFile(path.join(path.dirname(artifactPath), 'assets', name));
          const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          response.setHeader('cache-control', 'private, max-age=300');
          response.writeHead(200, { 'content-type': type, 'content-length': body.length, ...(access.setCookie ? { 'set-cookie': access.setCookie } : {}) });
          response.end(body);
          return;
        } catch {
          return sendJson(response, 404, { error: 'Asset not found.' });
        }
      }

      const theme = url.pathname.match(/^\/theme\/([^/]+)\.css$/);
      if (request.method === 'GET' && theme) {
        const demo = await store.getDemo(theme[1]);
        const access = demo && await demoAccess(request, store, theme[1], operatorSessions, config);
        const artifact = demo && access ? await loadArtifact(store, demo) : null;
        if (!artifact) return sendJson(response, 404, { error: 'Theme not found.' });
        const body = themeCss(artifact);
        response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'content-length': Buffer.byteLength(body), ...(access.setCookie ? { 'set-cookie': access.setCookie } : {}) });
        response.end(body);
        return;
      }

      const api = url.pathname.match(/^\/api\/demo\/([^/]+)\/(catalog|context|navigate|cart|quote)$/);
      if (api) {
        const [, demoId, action] = api;
        const demo = await store.getDemo(demoId);
        const access = demo && await demoAccess(request, store, demoId, operatorSessions, config, false);
        const artifact = demo && access ? await loadArtifact(store, demo) : null;
        if (!artifact || !access) return sendJson(response, 404, { error: 'Demo session not found.' });
        const items = generatedItems(artifact);
        if (request.method === 'GET' && action === 'catalog') return sendJson(response, 200, { demoId, kind: artifact.kind, items, sourceUrl: artifact.sourceUrl });
        if (request.method === 'GET' && action === 'context') return sendJson(response, 200, { demoId, currentPage: access.session.currentPage, catalog: items, session: access.session });
        if (request.method !== 'POST' || !['navigate', 'cart', 'quote'].includes(action)) return sendJson(response, 405, { error: 'Method not allowed.' });
        assertJson(request);
        const body = await readBody(request);
        const expected = clampInteger(body.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
        if (expected === null) return sendJson(response, 400, { error: 'expectedRevision must be a non-negative integer.' });
        let updated;
        if (action === 'cart') {
          const item = items.find((candidate) => candidate.id === body.itemId);
          const quantity = clampInteger(body.quantity, 0, 99);
          if (!item || quantity === null) return sendJson(response, 400, { error: 'Choose a captured item and a quantity from 0 to 99.' });
          updated = await store.updateSession(demoId, access.token, expected, (session) => {
            if (quantity === 0) delete session.cart[item.id];
            else session.cart[item.id] = quantity;
          }, access.operator);
        } else if (action === 'quote') {
          updated = await store.updateSession(demoId, access.token, expected, (session) => {
            session.quote = { items: { ...session.cart }, note: String(body.note || '').slice(0, 500), preparedAt: new Date().toISOString(), localOnly: true };
          }, access.operator);
        } else {
          const target = String(body.target || '');
          const allowed = target === 'home' || target === 'collection' && artifactPageCount(artifact) >= 2 || target.startsWith('item:') && items.some((item) => target === `item:${item.id}`);
          if (!allowed) return sendJson(response, 400, { error: 'Navigation target is outside this demo.' });
          updated = await store.updateSession(demoId, access.token, expected, (session) => { session.currentPage = target; }, access.operator);
        }
        if (!updated) return sendJson(response, 404, { error: 'Demo session not found.' });
        return sendJson(response, 200, { session: updated });
      }

      return sendHtml(response, 404, notFoundPage('Page not found.'));
    } catch (error) {
      const status = error.status || (error.name === 'FetchError' ? 400 : 500);
      const message = status >= 500 ? 'The request could not be completed.' : error.message || 'Request failed.';
      if (status >= 500) config.logger.error?.(error);
      if (url.pathname.startsWith('/api/')) {
        return sendJson(response, status, { error: message, ...(error.current ? { session: error.current } : {}) });
      }
      return sendHtml(response, status, notFoundPage(message));
    }
  });

  return { server, store, password: config.password, runner, config };
}

async function main() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4320);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.OPERATOR_PASSWORD) {
    throw new Error('Set OPERATOR_PASSWORD before binding to a non-loopback address.');
  }
  const generated = !process.env.OPERATOR_PASSWORD;
  const app = await createApp({
    host,
    port,
    password: process.env.OPERATOR_PASSWORD,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    trustLoopbackProxy: process.env.TRUST_LOOPBACK_PROXY === '1',
  });
  app.server.listen(port, host, () => {
    console.log(`Website preview workshop: http://${host === '::1' ? '[::1]' : host}:${port}`);
    if (generated) console.log(`One-time startup operator password: ${app.password}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
