# Implementation evidence

## Automated acceptance

Run from the repository root:

```bash
bash app/verify.sh
```

The final Node 25.6.1 run passed 34 Node tests plus the real Chromium browser regression.

The suite is intentionally local and deterministic. It covers:

- split-hero retail, hero-less B2B, metadata-only hero rejection, visible hero-image preference, and compact catalog/sidebar fixtures; full evidenced titles; unknown facts; retained stylesheet failures; no-catalog one-page fallback; detail enrichment; and page/product/asset bounds;
- one-to-eight-page maximum validation, five-page artifacts with exactly three detail routes, capped catalog artifacts, one-page no-catalog Home previews, persisted retry counts, server rejection of missing, non-numeric, fractional, and out-of-range creation values, and legacy artifacts without page-count fields;
- URL scheme/credential/port rejection, encoded script-link rejection, IPv4/IPv6 private/reserved/mapped ranges, all-answer DNS validation, connection pinning with TLS hostname retention, per-redirect validation, compressed/decompressed bounds, premature close, slow trickle, and absolute deadline cancellation;
- operator password login, real address lockout before password comparison (including correct-password rejection and expiry recovery), trusted-proxy opt-in, no secret in responses/URLs, secure cookie attributes, CSRF rejection, and bounded generation;
- ready preview rendering, disabled-by-default sharing, Lax token exchange/removal, per-demo cookie reuse, address-bounded session creation, protected assets, isolated A/B visitor carts, reusable operator previews, non-racing HTML current-page bookkeeping, explicit quantities, and stale API revision rejection;
- explicit sharing/rotation/stop lifecycle, Retry sharing/session revocation, immediate Delete cancellation and slot release, watchdog claim release with subsequent job success, abort-before-write behavior, late-settlement cleanup after an uncooperative folder recreation, late publication rejection, next-job ownership protection, immediate restart failure/cleanup, superseded-attempt cleanup, and read paths without state rewrites;
- off-origin secondary redirect omission with a retained limitation and credible home catalog, plus non-interactive captured categories that explain only the sample collection is included.

## Manual/runtime evidence

- The server is exercised through real loopback HTTP requests in `test/server.test.js`; the tests do not mock route handling, cookies, CSRF, persistence, or response authorization.
- A final production-entrypoint smoke started `src/server.js` on loopback with an isolated `DATA_DIR`; `GET /login` returned HTTP 200. The owned PID was terminated and waited, its temporary data was removed, and a listener check confirmed the port was released.
- Static production fetching is isolated behind `src/safe-fetch.js`; fixture tests inject transport only at that module's explicit test boundary and do not weaken production validation.
- Bundled Playwright and Chromium ran `browser-verify.mjs` at 1280x720 and 390x844 across home, collection, and detail. The accessible Maximum demo pages field submitted five pages, disclosed the requested and generated counts, and produced Home, Collection, and exactly three detail links at both sizes with no overflow, page errors, or console errors. A visitor clicked an actual link from `http://localhost` to the `http://127.0.0.1` share site, reached the preview after token exchange, and retained no token in the address bar. Separate A/B tabs retained quantities 2 and 3, and alternating operator previews retained exactly two preview sessions. Captured categories were non-links. Share and Stop replacements restored equivalent action focus, Retry used the card-heading fallback, background polling preserved URL-input focus, Delete announced completion and focused the surviving heading, and all phone header links measured at least 24px high. Screenshots are in `review/screenshots/`, including `cross-site-share.png` and `dashboard-after-delete.png`.
- A live production-fetch/browser smoke ran on 22 September 2026 against `https://books.toscrape.com/`. `review/live-smoke.json` records an eight-page request with four source pages (home, collection, two details), six full product titles/prices, six localized assets totaling 47,259 bytes, no invented hero, a compact sidebar/sans-serif composition, desktop/phone three-view checks, no page errors, and no phone overflow. This proves one recognizable bounded example, not universal fidelity.
- A live Suitsupply smoke on 22 September 2026 requested five pages and generated five: Home, Collection, and detail pages for Tuxedo Vest, Tailored Fit Widespread Collar Tuxedo Shirt, and Tuxedo Loafer. The dashboard disclosed requested and actual counts, both Home and Collection exposed exactly three detail links, and the first detail rendered successfully. The bounded record is in `review/suitsupply-page-count-smoke.json`.

## Scope confirmation

All implementation and evidence are under `app/`. No other project, root manifest, Genesis record, external widget, deployment target, or global package installation is modified.
