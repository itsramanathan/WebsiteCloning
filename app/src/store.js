import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { id, sha256, slugify } from './util.js';
import { LIMITS } from './extract.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class Store {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'state.json');
    this.now = options.now || Date.now;
    this.attemptMs = options.attemptMs || LIMITS.attemptMs;
    this.state = { demos: {}, sessions: {} };
    this.tail = Promise.resolve();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
    const interrupted = Object.values(this.state.demos).filter((demo) => !demo.deleted && demo.status === 'building');
    if (interrupted.length) {
      for (const demo of interrupted) {
        demo.status = 'failed';
        demo.error = 'Generation stopped before publishing a complete preview. Retry to start a fresh attempt.';
        demo.updatedAt = this.now();
      }
      await this.save();
      await Promise.all(interrupted.map((demo) => this.removeAttempt(demo.id, demo.attempt)));
    }
    return this;
  }

  async save() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }

  async mutate(action) {
    const run = this.tail.then(async () => {
      const result = await action(this.state);
      await this.save();
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }

  async recoverOverdue() {
    const run = this.tail.then(async () => {
      let changed = false;
      for (const demo of Object.values(this.state.demos)) {
        if (!demo.deleted && demo.status === 'building' && demo.deadlineAt <= this.now()) {
          demo.status = 'failed';
          demo.error = 'Generation stopped before publishing a complete preview. Retry to start a fresh attempt.';
          demo.updatedAt = this.now();
          changed = true;
        }
      }
      if (changed) await this.save();
      return changed;
    });
    this.tail = run.catch(() => {});
    return run;
  }

  async createDemo(sourceUrl) {
    return this.mutate((state) => {
      if (Object.values(state.demos).filter((demo) => !demo.deleted).length >= 20) {
        const error = new Error('The local preview limit is 20. Delete an older preview before creating another.');
        error.status = 409;
        throw error;
      }
      const demoId = id(12);
      const hostname = new URL(sourceUrl).hostname.replace(/^www\./, '');
      const now = this.now();
      const demo = {
        id: demoId,
        slug: `${slugify(hostname)}-${id(3).toLowerCase()}`,
        sourceUrl,
        name: `Demo - ${hostname}`,
        status: 'building',
        attempt: 1,
        deadlineAt: now + this.attemptMs,
        artifact: null,
        shareEnabled: false,
        shareTokenHash: null,
        deleted: false,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      state.demos[demoId] = demo;
      return clone(demo);
    });
  }

  attemptDirectory(demoId, attempt) {
    return path.join(this.root, 'demos', demoId, `attempt-${attempt}`);
  }

  async listDemos() {
    await this.recoverOverdue();
    return Object.values(this.state.demos).filter((demo) => !demo.deleted).sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }

  async getDemo(demoId, includeDeleted = false) {
    await this.recoverOverdue();
    const demo = this.state.demos[demoId];
    return !demo || (demo.deleted && !includeDeleted) ? null : clone(demo);
  }

  async completeAttempt(demoId, attempt, artifactPath, description) {
    const published = await this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted || demo.status !== 'building' || demo.attempt !== attempt || demo.deadlineAt < this.now()) return false;
      const resolved = path.resolve(artifactPath);
      if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new Error('Artifact escaped the data directory.');
      demo.artifact = path.relative(this.root, resolved);
      demo.name = description.name;
      demo.status = 'ready';
      demo.error = null;
      demo.updatedAt = this.now();
      return true;
    });
    if (published) {
      await Promise.all(Array.from({ length: 5 }, (_, index) => index + 1)
        .filter((candidate) => candidate !== attempt)
        .map((candidate) => this.removeAttempt(demoId, candidate)));
    }
    return published;
  }

  async failAttempt(demoId, attempt, message) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted || demo.attempt !== attempt || demo.status !== 'building') return false;
      demo.status = 'failed';
      demo.error = String(message).slice(0, 500);
      demo.updatedAt = this.now();
      return true;
    });
  }

  async retry(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted) return null;
      if (demo.status === 'building') {
        const error = new Error('This preview is already building.');
        error.status = 409;
        throw error;
      }
      if (demo.attempt >= 5) {
        const error = new Error('This preview reached its five-attempt limit. Delete it and create a new preview if another run is needed.');
        error.status = 409;
        throw error;
      }
      demo.attempt += 1;
      demo.status = 'building';
      demo.deadlineAt = this.now() + this.attemptMs;
      demo.artifact = null;
      demo.shareEnabled = false;
      demo.shareTokenHash = null;
      demo.error = null;
      demo.updatedAt = this.now();
      this.revokeSessions(state, demoId);
      return clone(demo);
    });
  }

  async enableSharing(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted) return null;
      if (demo.status !== 'ready' || !demo.artifact) {
        const error = new Error('Only the current complete preview can be shared.');
        error.status = 409;
        throw error;
      }
      if (demo.shareEnabled) {
        const error = new Error('This preview is already shared. Rotate the link explicitly to replace it.');
        error.status = 409;
        throw error;
      }
      return this.issueShareToken(state, demo);
    });
  }

  async rotateSharing(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted) return null;
      if (demo.status !== 'ready' || !demo.artifact || !demo.shareEnabled) {
        const error = new Error('Only a currently shared, complete preview can rotate its link.');
        error.status = 409;
        throw error;
      }
      return this.issueShareToken(state, demo);
    });
  }

  issueShareToken(state, demo) {
    const token = id(24);
    demo.shareEnabled = true;
    demo.shareTokenHash = sha256(token);
    demo.updatedAt = this.now();
    this.revokeSessions(state, demo.id);
    return { demo: clone(demo), token };
  }

  async disableSharing(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted) return null;
      demo.shareEnabled = false;
      demo.shareTokenHash = null;
      demo.updatedAt = this.now();
      this.revokeSessions(state, demoId);
      return clone(demo);
    });
  }

  verifyShareToken(demoId, token) {
    const demo = this.state.demos[demoId];
    return Boolean(demo && !demo.deleted && demo.status === 'ready' && demo.shareEnabled && demo.shareTokenHash === sha256(token || ''));
  }

  async createViewerSession(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted || demo.status !== 'ready' || !demo.shareEnabled) return null;
      this.assertSessionCapacity(state, demoId);
      const token = id(24);
      state.sessions[sha256(token)] = {
        id: id(12),
        demoId,
        cart: {},
        quote: null,
        currentPage: 'home',
        revision: 0,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      return { token, session: clone(state.sessions[sha256(token)]) };
    });
  }

  getViewerSession(demoId, token, allowUnshared = false) {
    const session = this.state.sessions[sha256(token || '')];
    const demo = this.state.demos[demoId];
    if (!session || session.demoId !== demoId || !demo || demo.deleted || demo.status !== 'ready') return null;
    if (!allowUnshared && !demo.shareEnabled) return null;
    return clone(session);
  }

  async createPreviewSession(demoId) {
    return this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted || demo.status !== 'ready') return null;
      this.assertSessionCapacity(state, demoId);
      const token = id(24);
      state.sessions[sha256(token)] = {
        id: id(12), demoId, preview: true, cart: {}, quote: null, currentPage: 'home', revision: 0,
        createdAt: this.now(), updatedAt: this.now(),
      };
      return { token, session: clone(state.sessions[sha256(token)]) };
    });
  }

  async updateSession(demoId, token, expectedRevision, change, allowUnshared = false) {
    return this.mutate((state) => {
      const key = sha256(token || '');
      const session = state.sessions[key];
      const demo = state.demos[demoId];
      if (!session || session.demoId !== demoId || !demo || demo.deleted || demo.status !== 'ready' || (!allowUnshared && !demo.shareEnabled)) return null;
      if (session.revision !== expectedRevision) {
        const error = new Error('Session changed. Refresh state before trying again.');
        error.status = 409;
        error.current = clone(session);
        throw error;
      }
      change(session);
      session.revision += 1;
      session.updatedAt = this.now();
      return clone(session);
    });
  }

  async setCurrentPage(demoId, token, page, allowUnshared = false) {
    return this.mutate((state) => {
      const session = state.sessions[sha256(token || '')];
      const demo = state.demos[demoId];
      if (!session || session.demoId !== demoId || !demo || demo.deleted || demo.status !== 'ready' || (!allowUnshared && !demo.shareEnabled)) return null;
      session.currentPage = page;
      session.updatedAt = this.now();
      return clone(session);
    });
  }

  async deleteDemo(demoId) {
    const result = await this.mutate((state) => {
      const demo = state.demos[demoId];
      if (!demo || demo.deleted) return false;
      demo.deleted = true;
      demo.status = 'failed';
      demo.artifact = null;
      demo.shareEnabled = false;
      demo.shareTokenHash = null;
      demo.error = 'Deleted by operator.';
      demo.updatedAt = this.now();
      this.revokeSessions(state, demoId);
      return true;
    });
    if (result) await rm(path.join(this.root, 'demos', demoId), { recursive: true, force: true });
    return result;
  }

  revokeSessions(state, demoId) {
    for (const [key, session] of Object.entries(state.sessions)) {
      if (session.demoId === demoId) delete state.sessions[key];
    }
  }

  assertSessionCapacity(state, demoId) {
    const sessions = Object.values(state.sessions);
    if (sessions.length >= 2_000 || sessions.filter((session) => session.demoId === demoId).length >= 100) {
      const error = new Error('This preview reached its local session limit. Retry or delete it to revoke old sessions.');
      error.status = 429;
      throw error;
    }
  }

  artifactPath(demo) {
    if (!demo?.artifact) return null;
    const resolved = path.resolve(this.root, demo.artifact);
    return resolved.startsWith(`${this.root}${path.sep}`) ? resolved : null;
  }

  async removeAttempt(demoId, attempt) {
    await rm(this.attemptDirectory(demoId, attempt), { recursive: true, force: true });
  }
}
