# Explicit limitations

- Static public HTML only: source JavaScript is never executed. JavaScript-only and bot-blocked catalogs can fail.
- Extraction is heuristic and bounded, not a browser/model fidelity system. Output is limited to one through eight navigable pages and available captured products or offerings; a no-catalog source is a one-page Home preview. Exact visual resemblance is unverified.
- Images are restricted to validated JPEG, PNG, and WebP files. SVG, fonts, video, and remote hotlinks are omitted.
- Up to two linked stylesheets are safely fetched and parsed for bounded allowlisted presentation tokens only. Imports, font files, images referenced by CSS, selectors, declarations, and source CSS are never injected or executed.
- No existing assistant is embedded. The candidate widget mutates its backend before `onAddToCart`, so safe reuse requires the adapter described in `INTEGRATION.md`.
- No real checkout, order, payment, email, CRM update, quote delivery, source-site form, or merchant write exists.
- Storage is local JSON plus immutable attempt folders. It is suitable for one-process internal use, not horizontal multi-process writes.
- Operator login sessions are in memory and end on restart. Demo records and per-demo viewer state are durable, but there is no automatic expiration or LRU eviction. Session limits include operator preview sessions and remain cumulative at 100 per preview and 2,000 total until an operator rotates/stops sharing, retries, or deletes the applicable preview.
- The default server is plain loopback HTTP. Remote use requires the documented HTTPS reverse proxy, persistent volume, and configured secret.
- No remote deployment or purchase was performed. Bundled Playwright/Chromium verified the three views at 1280x720 and 390x844, cross-site share entry, per-demo session retention, and delete focus restoration for the deterministic fixture, plus the live Books example; screen-reader, zoom, and broad cross-browser QA remain unverified.
