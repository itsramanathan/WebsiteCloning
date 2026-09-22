# Hosting guide

## Local evaluation

```bash
cd app
npm start
```

Open `http://127.0.0.1:4320`. With the default loopback bind, the process generates and prints a new operator password when `OPERATOR_PASSWORD` is absent.

Enter the public source URL and choose **Maximum demo pages** from one through eight. The value is a maximum: the builder returns fewer pages when the captured source supports less content, including a one-page Home preview for a genuine no-catalog source.

## Shared internal deployment

Use one maintained Node.js LTS service behind an HTTPS reverse proxy. The service hosts both the operator dashboard and all generated preview paths; a separate deployment per prospect is unnecessary.

Required production settings:

```text
HOST=127.0.0.1
PORT=4320
DATA_DIR=/var/lib/website-preview
PUBLIC_BASE_URL=https://preview.example.com
OPERATOR_PASSWORD=<secret-manager-value>
```

Run `app/src/server.js` as an unprivileged service account. Create `DATA_DIR` with mode `0700`, make it writable only by that account, and persist it across restarts. Put Caddy, nginx, or an equivalent reverse proxy in front of the loopback service and terminate TLS there.

`PUBLIC_BASE_URL` must be the actual HTTPS origin so management and visitor cookies receive the correct secure behavior. Keep request-body limits at the proxy and preserve the application's security headers.

## Passwords

The generated development password is intentionally ephemeral: it changes on every process start and every machine. For a shared deployment, set one strong `OPERATOR_PASSWORD` using the hosting provider's secret manager or protected service environment. Rotate it through that system when needed; never commit it.

A non-loopback application bind requires an explicit `OPERATOR_PASSWORD`. Keeping the Node service on loopback behind the HTTPS proxy is the recommended layout.

## Persistence and backups

Back up only `DATA_DIR`. It contains preview records, locally captured assets, and sessions. The repository contains no runtime data. Monitor disk usage because this milestone bounds individual previews and total preview count but does not automatically expire retained data.

## Health and verification

- Verify `GET /login` returns HTTP 200 through the HTTPS origin.
- Run `bash app/verify.sh` before deployment and after runtime upgrades.
- Confirm a five-page request produces Home, Collection/Solutions, and three detail pages on a source with at least three credible items.
- Confirm a smaller source discloses its lower generated count rather than padding or failing.
- Confirm generated share links use the public HTTPS origin.
- Test one private share from a different site or messaging context.
- Confirm the service cannot fetch private, loopback, link-local, or reserved network addresses.

See [app/README.md](app/README.md) for the full configuration table and operational limitations.
