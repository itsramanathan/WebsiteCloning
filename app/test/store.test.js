import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { Store } from '../src/store.js';
import { LIMITS } from '../src/extract.js';

test('restart recovery immediately fails interrupted work, cleans it, and rejects late publication', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  let now = 1_000_000;
  const first = await new Store(root, { now: () => now }).init();
  const demo = await first.createDemo('https://example.com/');
  const attemptDir = first.attemptDirectory(demo.id, demo.attempt);
  await mkdir(attemptDir, { recursive: true });
  const artifact = path.join(attemptDir, 'artifact.json');
  await writeFile(artifact, '{}');

  const restarted = await new Store(root, { now: () => now }).init();
  assert.equal((await restarted.getDemo(demo.id)).status, 'failed');
  assert.equal(await restarted.completeAttempt(demo.id, demo.attempt, artifact, { name: 'Late' }), false);
  await assert.rejects(access(attemptDir));
});

test('ordinary reads do not rewrite state and successful retry reclaims superseded attempts', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = await new Store(root).init();
  const demo = await store.createDemo('https://example.com/');
  const firstDir = store.attemptDirectory(demo.id, 1);
  await mkdir(firstDir, { recursive: true });
  const firstArtifact = path.join(firstDir, 'artifact.json');
  await writeFile(firstArtifact, '{}');
  await store.completeAttempt(demo.id, 1, firstArtifact, { name: 'Demo - Example' });

  let saves = 0;
  const save = store.save.bind(store);
  store.save = async () => { saves += 1; return save(); };
  await store.getDemo(demo.id);
  await store.listDemos();
  assert.equal(saves, 0);

  const retried = await store.retry(demo.id);
  const secondDir = store.attemptDirectory(demo.id, retried.attempt);
  await mkdir(secondDir, { recursive: true });
  const secondArtifact = path.join(secondDir, 'artifact.json');
  await writeFile(secondArtifact, '{}');
  await store.completeAttempt(demo.id, retried.attempt, secondArtifact, { name: 'Demo - Example' });
  await assert.rejects(access(firstDir));
  await access(secondDir);
});

test('retry revokes sharing and visitor sessions', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = await new Store(root).init();
  const demo = await store.createDemo('https://example.com/');
  const attemptDir = store.attemptDirectory(demo.id, 1);
  await mkdir(attemptDir, { recursive: true });
  const artifact = path.join(attemptDir, 'artifact.json');
  await writeFile(artifact, '{}');
  assert.equal(await store.completeAttempt(demo.id, 1, artifact, { name: 'Demo - Example' }), true);
  const shared = await store.enableSharing(demo.id);
  const visitor = await store.createViewerSession(demo.id);
  assert.equal(store.verifyShareToken(demo.id, shared.token), true);
  assert.ok(store.getViewerSession(demo.id, visitor.token));

  const retried = await store.retry(demo.id);
  assert.equal(retried.status, 'building');
  assert.equal(retried.shareEnabled, false);
  assert.equal(store.verifyShareToken(demo.id, shared.token), false);
  assert.equal(store.getViewerSession(demo.id, visitor.token), null);
});
