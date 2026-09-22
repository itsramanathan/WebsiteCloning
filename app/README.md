# Website preview workshop

A small internal Node application that turns a public, server-rendered store or B2B URL into a bounded three-view website preview. It uses fixed trusted components, local durable files, private operator-controlled sharing, and local-only cart/quote state.

## Start

Node 20 or newer is required. There are no third-party runtime dependencies.

```bash
cd app
OPERATOR_PASSWORD='replace-with-a-long-random-secret' npm start
```

Open `http://127.0.0.1:4320`. If `OPERATOR_PASSWORD` is omitted while using the default loopback bind, the process prints a random one-time startup password. The password is never returned by the app or placed in a URL.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address. A non-loopback bind requires `OPERATOR_PASSWORD`. |
| `PORT` | `4320` | Local HTTP port. |
| `OPERATOR_PASSWORD` | random on loopback | Operator login secret. |
| `PUBLIC_BASE_URL` | `http://HOST:PORT` | HTTPS public origin used when displaying private share links. |
| `DATA_DIR` | `app/data` | Persistent local records, sessions, artifacts, and saved assets. |
| `TRUST_LOOPBACK_PROXY` | unset | Set to `1` only behind a local reverse proxy that overwrites `X-Real-IP`. |

Runtime files are written to `app/data` unless `DATA_DIR` points to another persistent directory.

## Verify

```bash
bash app/verify.sh
```

The acceptance suite exercises three source compositions, retail and B2B extraction, missing facts, caps, safe URL/DNS handling, connection pinning, truncated/slow response deadlines, operator auth/CSRF, cross-site sharing entry, per-demo visitor state, stale revisions, immediate delete cancellation, restart cleanup, and desktop/phone browser interactions. Browser checks run when the bundled Playwright path exists or `PLAYWRIGHT_MODULE` points to an installed package.

## Behavior

- Reads static public HTML over connection-pinned HTTP(S), validating every resolved address and redirect; source JavaScript, frames, forms, XHR, and source CSS/HTML are never executed in the preview. Up to two static stylesheets (256 KB each) may be parsed only for allowlisted color, font-family, spacing, and density hints; imports, fonts, and CSS URLs are not followed.
- Samples at most four same-origin pages, six retail products or three B2B offerings, 30 safe raster images, and 25 MB of assets within a five-minute attempt. A selected secondary page that redirects off-origin is skipped and recorded as a limitation rather than discarding a credible home-page catalog.
- Saves images locally after MIME and file-signature checks. It does not hotlink source media or accept SVG.
- Renders home, collection/solutions, and reusable item views with source name, imagery, conservative color hints, and captured catalog facts. A hero is rendered only from a visible hero section; metadata-only share or logo images do not invent one.
- Keeps unknown prices/specifications unknown and fails when no credible catalog exists.
- Supports `building`, `ready`, and `failed` attempts. Retry revokes sharing and sessions; delete cancels active work, releases the one-job slot promptly, removes artifacts, and prevents a late worker from publishing or clearing the next job.
- Uses a Strict operator cookie plus CSRF token for management. Login allows five attempts per address in ten minutes, including correct guesses while the address is locked. A separate random 192-bit share token creates an isolated per-demo visitor session and is removed from the address bar immediately. Visitor cookies are HttpOnly, Secure on HTTPS, and SameSite=Lax so a top-level link from another site survives the token-removing redirect; cross-site mutation POSTs remain excluded. Reopening a link reuses a valid same-demo visitor cookie, while separate demos retain independent carts. Otherwise new sessions are limited to 20 per address in ten minutes. Rotate and Stop sharing explicitly revoke the old link and sessions.
- Sets quantities explicitly with optimistic session revisions. Quote drafts remain local; there is no checkout, payment, email, CRM, or merchant write.
- Limits login attempts, generation attempts, active work, previews (20), attempts (five per preview), sessions (100 per preview / 2,000 total for the lifetime of the local state file, including operator preview sessions), pages, response sizes, images, and stored asset size.

## HTTPS deployment recipe

This is a recipe only; nothing has been deployed by this project.

1. Provision a host with a maintained Node.js LTS release (Node 20 compatibility is tested) and copy this `app` directory to `/srv/website-preview/app`.
2. Create `/var/lib/website-preview`, owned by the unprivileged service account, with mode `0700`.
3. Store a long random `OPERATOR_PASSWORD` in the host secret manager or a root-readable service environment file. Do not place it in source control.
4. Run `npm start` as the unprivileged account with `HOST=127.0.0.1`, `PORT=4320`, `DATA_DIR=/var/lib/website-preview`, and `PUBLIC_BASE_URL=https://preview.example.com`. An HTTPS `PUBLIC_BASE_URL` makes both management and visitor cookies `Secure` behind the proxy.
5. Put an HTTPS reverse proxy such as Caddy or nginx in front of `127.0.0.1:4320`; forward only the application origin, set request-body limits, and retain the app's security headers. Leave `TRUST_LOOPBACK_PROXY` unset unless the proxy is local and configured to overwrite (not append) `X-Real-IP`; then set it to `1` for per-client login limits.
6. Persist and back up only `/var/lib/website-preview`. Monitor its size; the app bounds individual previews and count but intentionally has no automatic retention policy.

Example service command:

```bash
env HOST=127.0.0.1 PORT=4320 \
  DATA_DIR=/var/lib/website-preview \
  PUBLIC_BASE_URL=https://preview.example.com \
  OPERATOR_PASSWORD="$OPERATOR_PASSWORD" \
  /usr/bin/node /srv/website-preview/app/src/server.js
```

## Known limits

- Server-rendered public HTML is supported first. JavaScript-only catalogs, bot-protected pages, authentication, nonstandard ports, and sources without credible offerings fail with an actionable message.
- Static heuristics preserve a bounded subset of name, hero, imagery, colors, card data, and section character; they do not promise pixel-exact copying or model-driven visual analysis.
- There is no browser capture, visual model, remote hosting automation, automatic session expiration, operator editor, or per-demo deployment. The 100-per-preview / 2,000-total session caps include operator preview sessions and remain cumulative until Rotate, Stop sharing, Retry, or Delete revokes applicable sessions.
- The existing sales widget is not embedded. The explicit adapter boundary and incompatibility are documented in `INTEGRATION.md`.
- Bundled Playwright/Chromium ran desktop and phone checks for home, collection, detail, a real `localhost` to `127.0.0.1` share-link entry, per-demo A/B cart retention, operator preview reuse, delete focus restoration, immediate quantity rendering, reusable quote actions, and zero page errors. Screenshots and the exact live Books to Scrape result are under `review/`; this is evidence for those bounded examples, not universal visual fidelity.
