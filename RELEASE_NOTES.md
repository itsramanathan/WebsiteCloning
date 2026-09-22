# Release notes

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
