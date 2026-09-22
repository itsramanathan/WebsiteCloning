# Release notes

## 0.2.0 - 2026-09-22

Adds configurable, content-aware demo page counts.

### Included

- Accessible **Maximum demo pages** field with a default of five and a validated range of one through eight.
- A request for five produces Home, Collection/Solutions, and three detail pages when the captured source supports them.
- Smaller sources return the useful pages actually supported instead of failing or inventing products. A no-catalog single-page source returns one Home page with captured source copy.
- Requested and generated counts are persisted, shown on the operator dashboard, and retained across Retry.
- Omitted content is excluded from navigation, direct routes, catalog data, and cart state.
- Backward compatibility for existing saved demos without the new page-count fields.
- 34 Node acceptance tests plus Chromium desktop/phone verification.
- Live Suitsupply evidence: a five-page request generated Home, Collection, and three distinct product details.
- Terra implementation, Sol review, and Astra final technical approval. Astra's first review found a Home-only content gap; Terra repaired it, Sol approved the repair, and Astra approved the final source.

### Password behavior

Password behavior is unchanged. A loopback run without `OPERATOR_PASSWORD` creates a new random password on each process start. Set the same secret through `OPERATOR_PASSWORD` or a host secret manager when different machines or restarts must use a stable password.

## 0.1.0 - 2026-09-21

First verified local prototype of the URL-to-demo website builder.

### Included

- Authenticated operator dashboard for entering public store or B2B URLs.
- Bounded capture of up to four same-origin pages, six retail products or three B2B offerings.
- Source-informed home, collection/solutions, and reusable detail views.
- Localized approved raster assets with no source hotlinking or source JavaScript execution.
- Private revocable share links and isolated per-demo visitor sessions.
- Local-only quantities and quote drafts; no checkout, payment, email, CRM, or merchant writes.
- Retry, delete, cancellation, stale-worker protection, restart recovery, and bounded storage.
- Public-address fetch controls, redirect revalidation, response limits, and request deadlines.
- 29 Node acceptance tests plus Chromium desktop/phone and cross-site-sharing checks.
- Fable round-four approval for the bounded milestone.

### Known limits

- Static, public, server-rendered pages only. CAPTCHA-protected, bot-blocked, authenticated, or JavaScript-only catalogs may fail. Flipkart currently returns a reCAPTCHA response to automated requests.
- The visual reconstruction uses trusted templates and bounded heuristics; it is not pixel-exact or universal.
- Storage is local and single-process, with cumulative session caps and no automatic retention policy.
- Remote deployment, model-driven browser capture, public self-service generation, and sales-widget integration are not included.
- Two approved low-severity runtime housekeeping follow-ups remain documented in `docs/FINAL_ASSESSMENT.md`; the reviewed cookie-name documentation erratum was corrected during release packaging.

### Password behavior

- On the default loopback address, omitting `OPERATOR_PASSWORD` creates a new random password on every process start and prints it only to the terminal.
- Set `OPERATOR_PASSWORD` through the host secret manager when operators need a stable password.
- Do not place passwords in this repository, an image, a URL, or a committed environment file.
