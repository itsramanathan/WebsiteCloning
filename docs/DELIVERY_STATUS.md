# Verified local delivery — 22 September 2026

The bounded local prototype is implemented. Genesis executable acceptance and cross-provider review gates both pass. Fable round four approved the implementation with three low-severity follow-ups. The user subsequently approved the reviewed release, Genesis recorded the independent-review approval, and task WC-001 is complete.

- Local workshop after startup: http://127.0.0.1:4320/
- Published application: `app/` in this repository; runtime data, passwords, and sessions are excluded.
- Validation: 29 Node tests plus bundled Chromium regression across desktop and phone, cross-site share entry, two independent demo carts, preview-session reuse, cancellation, keyboard focus, token removal, and no browser page errors.
- Live sample evidence: Books to Scrape, four captured pages, six products and six localized images. Generated views are home, collection, and reusable detail pages.

## Documents

- `IMPLEMENTED_FLOW.md`: URL entry, output, sharing, hosting and later integration.
- `../app/README.md`: startup and HTTPS single-server deployment recipe.
- `reviews/FABLE_REVIEW.md`: final Fable review and residual findings.
- `FINAL_ASSESSMENT.md`: coordinator decision and precise delivery boundaries.

A fresh start prints a local startup password unless `OPERATOR_PASSWORD` is supplied. If port 4320 is already occupied, stop the existing process or select another `PORT`.

No remote deployment has occurred. The sales widget and agent-commerce integration remain separate future work, as requested. The original research and simplified plans are preserved.
