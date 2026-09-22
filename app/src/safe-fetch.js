import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export class FetchError extends Error {
  constructor(message, code = 'FETCH_REJECTED') {
    super(message);
    this.name = 'FetchError';
    this.code = code;
  }
}

export function validateUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('Enter a complete public http or https URL.', 'INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FetchError('Only public http and https URLs are supported.', 'INVALID_SCHEME');
  }
  if (url.username || url.password) {
    throw new FetchError('URLs containing credentials are not supported.', 'URL_CREDENTIALS');
  }
  if ((url.protocol === 'http:' && url.port && url.port !== '80') || (url.protocol === 'https:' && url.port && url.port !== '443')) {
    throw new FetchError('Only standard web ports 80 and 443 are supported.', 'NONSTANDARD_PORT');
  }
  if (!url.hostname || url.hostname.length > 253) {
    throw new FetchError('The URL hostname is invalid.', 'INVALID_HOST');
  }
  return url;
}

function parseV4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return null;
  const parts = address.split('.').map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts;
}

function publicV4(address) {
  const p = parseV4(address);
  if (!p) return false;
  const [a, b, c] = p;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function v6Parts(address) {
  let normalized = address.toLowerCase().split('%')[0];
  if (normalized.includes('.')) return null;
  if ((normalized.match(/::/g) || []).length > 1) return null;
  const [leftText, rightText] = normalized.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((normalized.includes('::') && missing < 1) || (!normalized.includes('::') && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[\da-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function publicV6(address) {
  const parts = v6Parts(address);
  if (!parts) return false;
  const [first, second] = parts;
  // Public global-unicast IPv6 is within 2000::/3. Conservatively reject
  // transition, documentation, benchmarking and ORCHID ranges inside it.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2002 || (first === 0x3fff && (second & 0xf000) === 0)) return false;
  if (first === 0x2001) {
    if (second === 0x0000 || second === 0x0002 || second === 0x0003 || second === 0x0db8) return false;
    if ((second & 0xfff0) === 0x0010 || (second & 0xfff0) === 0x0020) return false;
  }
  return true;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? publicV4(address) : family === 6 ? publicV6(address) : false;
}

export async function resolvePublic(hostname, lookup = dns.lookup) {
  const literal = hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(literal);
  const answers = family ? [{ address: literal, family }] : await lookup(literal, { all: true, verbatim: true });
  if (!answers.length || answers.some(({ address }) => !isPublicAddress(address))) {
    throw new FetchError('The hostname resolves to a non-public or unsupported address.', 'NONPUBLIC_ADDRESS');
  }
  return answers[0];
}

async function beforeDeadline(promise, deadline, onTimeout, timeoutMessage = 'The source lookup timed out.') {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new FetchError('The generation attempt exceeded its deadline.', 'DEADLINE');
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new FetchError(timeoutMessage, 'TIMEOUT');
          onTimeout?.(error);
          reject(error);
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function pinnedLookup(answer) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') callback = options;
    if (options?.all) callback(null, [answer]);
    else callback(null, answer.address, answer.family);
  };
}

export async function performRequest(options, maxCompressedBytes) {
  const transport = options.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let ended = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      const reason = options.signal?.reason instanceof Error
        ? options.signal.reason
        : new FetchError('The source request was cancelled.', 'TIMEOUT');
      request.destroy(reason);
      finish(reason);
    };
    const request = transport.request(options, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxCompressedBytes) {
          const error = new FetchError('The response exceeded the download limit.', 'RESPONSE_TOO_LARGE');
          response.destroy(error);
          request.destroy(error);
          finish(error);
          return;
        }
        chunks.push(chunk);
      });
      response.once('aborted', () => finish(new FetchError('The source closed the response before it was complete.', 'INCOMPLETE_RESPONSE')));
      response.once('error', (error) => finish(error instanceof FetchError ? error : new FetchError('The source response could not be read.', 'INCOMPLETE_RESPONSE')));
      response.once('end', () => {
        ended = true;
        finish(null, { statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
      });
      response.once('close', () => {
        if (!ended) finish(new FetchError('The source closed the response before it was complete.', 'INCOMPLETE_RESPONSE'));
      });
    });
    request.once('error', (error) => finish(error));
    request.setTimeout(options.timeout, () => request.destroy(new FetchError('The source timed out.', 'TIMEOUT')));
    const remaining = options.absoluteDeadline - Date.now();
    timer = setTimeout(() => {
      const error = new FetchError('The source request exceeded its absolute deadline.', 'TIMEOUT');
      request.destroy(error);
      finish(error);
    }, Math.max(1, remaining));
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    request.end();
  });
}

async function decompress(body, encoding, maxBytes) {
  if (!encoding || encoding === 'identity') return body;
  const decoder = encoding === 'gzip' ? zlib.createGunzip()
    : encoding === 'deflate' ? zlib.createInflate()
      : encoding === 'br' ? zlib.createBrotliDecompress()
        : null;
  if (!decoder) throw new FetchError('The source used an unsupported content encoding.', 'UNSUPPORTED_ENCODING');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    decoder.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        decoder.destroy(new FetchError('The response exceeded the expanded size limit.', 'RESPONSE_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    decoder.once('error', reject);
    decoder.once('end', () => resolve(Buffer.concat(chunks)));
    decoder.end(body);
  });
}

export async function fetchPublic(input, options = {}) {
  const {
    deadline = Date.now() + 15_000,
    maxRedirects = 3,
    maxCompressedBytes = 2_000_000,
    maxBytes = 3_000_000,
    lookup = dns.lookup,
    request = performRequest,
    redirects = 0,
    signal,
  } = options;
  const url = validateUrl(input);
  if (Date.now() >= deadline) throw new FetchError('The generation attempt exceeded its deadline.', 'DEADLINE');
  const requestHostname = url.hostname.replace(/^\[|\]$/g, '');
  const answer = await beforeDeadline(resolvePublic(requestHostname, lookup), Math.min(deadline, Date.now() + 10_000));
  const remaining = Math.max(1, Math.min(10_000, deadline - Date.now()));
  const requestDeadline = Date.now() + remaining;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason || new FetchError('The generation attempt was cancelled.', 'DEADLINE'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  let response;
  try {
    const pending = request({
    protocol: url.protocol,
    hostname: requestHostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    servername: net.isIP(requestHostname) ? undefined : requestHostname,
    lookup: pinnedLookup(answer),
    timeout: remaining,
    absoluteDeadline: requestDeadline,
    signal: controller.signal,
    headers: {
      accept: options.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'accept-encoding': 'gzip, deflate, br',
      'user-agent': 'WebsitePreviewBuilder/0.1 (+local internal preview)',
      connection: 'close',
    },
    }, maxCompressedBytes);
    response = await beforeDeadline(pending, requestDeadline, (error) => controller.abort(error), 'The source request timed out.');
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  const status = response.statusCode || 0;
  if ([301, 302, 303, 307, 308].includes(status)) {
    if (redirects >= maxRedirects) throw new FetchError('The source redirected too many times.', 'TOO_MANY_REDIRECTS');
    if (!response.headers.location) throw new FetchError('The source returned an invalid redirect.', 'INVALID_REDIRECT');
    const next = new URL(response.headers.location, url).href;
    validateUrl(next);
    return fetchPublic(next, { ...options, deadline, redirects: redirects + 1 });
  }
  if (status < 200 || status >= 300) throw new FetchError(`The source returned HTTP ${status}.`, 'HTTP_STATUS');
  let body;
  try {
    body = await decompress(response.body, String(response.headers['content-encoding'] || '').toLowerCase(), maxBytes);
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError('The compressed response could not be read.', 'INVALID_COMPRESSION');
  }
  if (body.length > maxBytes) throw new FetchError('The response exceeded the expanded size limit.', 'RESPONSE_TOO_LARGE');
  return {
    body,
    contentType: String(response.headers['content-type'] || '').split(';')[0].toLowerCase(),
    finalUrl: url.href,
    address: answer.address,
  };
}
