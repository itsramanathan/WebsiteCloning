# Round 3 repair dispositions

All changes remain under `app/`. No deployment, external widget integration, model call, global installation, other-project change, or Genesis record change was performed.

## Findings

- **SEC-5 - resolved with browser reproduction.** Before the repair, bundled Chromium timed out after clicking a real link from the `localhost` site to the `127.0.0.1` share site because the Strict visitor cookie was withheld on the token-removing redirect. Visitor cookies are now per-demo and SameSite=Lax while remaining HttpOnly and Secure on HTTPS; the operator cookie remains Strict. The retained browser regression reaches the shared preview and confirms the token is absent from the final URL.
- **CODE-10 - resolved.** Each validated server-generated demo id names its own small viewer cookie. Visitor A/B tabs retain quantities 2 and 3 independently, and alternating operator previews reuse exactly one preview session per demo. The documented 100-per-preview and 2,000-total caps explicitly include operator preview sessions.
- **CODE-11 - resolved.** `JobRunner.cancel(demoId)` aborts active work and releases its slot immediately. An uncooperative deleted worker remains covered by late-settlement cleanup and tombstone publication guards; its finalizer cannot clear the next job's ownership. The regression deletes blocked A, starts blocked B before A settles, rejects C while B owns the slot, then proves late A files are removed.
- **CODE-12 - resolved.** A selected secondary page that safely redirects off the canonical source origin is skipped with a stored limitation. Initial source and every redirect still pass the public-only safe-fetch controls, and a credible home catalog remains publishable.
- **A11Y-7 - resolved.** Delete announces completion through the dashboard live region and restores focus to a surviving nearby card heading, or the URL input when no card remains, only when the deleted card held focus before its button was disabled. Background polling retains unrelated input focus.
- **SPEC-5 - resolved.** Captured source categories render as non-link labels with the explanation that only the sample collection is included. The real Collection/Solutions navigation remains available; no category filtering is simulated.

## Checks

- Pre-repair browser signal: `browser-verify.mjs` timed out waiting for the shared preview after the `localhost` to `127.0.0.1` link click.
- Focused regression run: `node --test test/server.test.js test/builder.test.js` - 14 passed, 0 failed.
- Browser regression: cross-site share entry, A/B carts `[2, 3]`, two reused operator preview sessions, non-link categories, delete focus/announcement, desktop/phone views, and zero page errors passed.
- Full acceptance: `bash app/verify.sh` - 29 Node tests passed, then the bundled Chromium regression passed with zero page errors.

## Remaining limits

Static server-rendered extraction, heuristic resemblance, local single-process storage, cumulative session lifetime caps, unavailable widget adapter, absent visual-model/browser capture, and no remote deployment remain as documented.
