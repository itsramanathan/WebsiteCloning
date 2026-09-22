import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import http from 'node:http';
import { once } from 'node:events';
import { fetchPublic, isPublicAddress, performRequest, resolvePublic, validateUrl } from '../src/safe-fetch.js';

test('rejects unsafe URL forms and non-public IPv4/IPv6 ranges', () => {
  assert.throws(() => validateUrl('file:///etc/passwd'), /Only public/);
  assert.throws(() => validateUrl('https://user:pass@example.com'), /credentials/);
  assert.throws(() => validateUrl('https://example.com:8443'), /standard web ports/);
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '::1', '::127.0.0.1', 'fc00::1', 'fe80::1', 'fec0::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('rejects a hostname when any DNS answer is non-public', async () => {
  await assert.rejects(
    resolvePublic('rebinding.example', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    (error) => error.code === 'NONPUBLIC_ADDRESS',
  );
  await assert.rejects(fetchPublic('http://2130706433/metadata', {
    request: async () => assert.fail('a numeric loopback form must not reach the transport'),
  }), (error) => error.code === 'NONPUBLIC_ADDRESS');
});

test('pins the validated address while retaining the source hostname', async () => {
  let options;
  const result = await fetchPublic('https://shop.example/catalog', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (requestOptions) => {
      options = requestOptions;
      return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<h1>Public</h1>') };
    },
  });
  const pinned = await new Promise((resolve, reject) => options.lookup('shop.example', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
  assert.equal(options.hostname, 'shop.example');
  assert.equal(options.servername, 'shop.example');
  assert.equal(result.address, '93.184.216.34');
});

test('validates every redirect before another request', async () => {
  let calls = 0;
  await assert.rejects(fetchPublic('https://public.example/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      calls += 1;
      return { statusCode: 302, headers: { location: 'http://127.0.0.1/admin' }, body: Buffer.alloc(0) };
    },
  }), (error) => error.code === 'NONPUBLIC_ADDRESS');
  assert.equal(calls, 1);
});

test('bounds the decompressed response', async () => {
  const compressed = zlib.gzipSync(Buffer.alloc(5_000, 65));
  await assert.rejects(fetchPublic('https://public.example/', {
    maxBytes: 100,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: compressed }),
  }), (error) => error.code === 'RESPONSE_TOO_LARGE');
});

test('rejects truncated and slow-trickle responses by absolute deadline', async (context) => {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === '/truncated') {
      response.writeHead(200, { 'content-length': '20' });
      response.write('short');
      response.socket.destroy();
      return;
    }
    response.writeHead(200);
    const interval = setInterval(() => response.write('.'), 10);
    response.on('close', () => clearInterval(interval));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, 'close').catch(() => {});
  });
  const port = server.address().port;
  const options = (path, deadline) => ({ protocol: 'http:', hostname: '127.0.0.1', port, path, method: 'GET', timeout: 1_000, absoluteDeadline: deadline, headers: { connection: 'close' } });
  await assert.rejects(performRequest(options('/truncated', Date.now() + 500), 1_000), (error) => error.code === 'INCOMPLETE_RESPONSE' || error.code === 'ECONNRESET');
  await assert.rejects(performRequest(options('/slow', Date.now() + 50), 1_000), (error) => error.code === 'TIMEOUT');
});
