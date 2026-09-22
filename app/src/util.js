import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function id(bytes = 16) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'website';
}

export function cookies(request) {
  const result = {};
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [key, ...raw] = part.trim().split('=');
    if (!key || !raw.length) continue;
    try {
      result[key] = decodeURIComponent(raw.join('='));
    } catch {
      // Ignore malformed client cookies so one bad value cannot break every route.
    }
  }
  return result;
}

export function cookie(name, value, options = {}) {
  const values = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, 'HttpOnly', `SameSite=${options.sameSite || 'Strict'}`];
  if (options.maxAge !== undefined) values.push(`Max-Age=${options.maxAge}`);
  if (options.secure) values.push('Secure');
  return values.join('; ');
}

export async function readBody(request, limit = 32_768) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const type = String(request.headers['content-type'] || '').split(';')[0];
  if (type === 'application/json') {
    try {
      return JSON.parse(text);
    } catch {
      const error = new Error('Request body must be valid JSON.');
      error.status = 400;
      throw error;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  response.end(body);
}

export function sendHtml(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  response.end(body);
}

export function clampInteger(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}
