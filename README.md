# Website Cloning Demo Builder

An internal marketing tool that turns a public store or B2B URL into a small, source-informed demo named **Demo - Store Name**. The operator can request up to one to eight pages, with a default of five. The builder creates only the Home, Collection/Solutions, and product or offering pages supported by captured public content.

This release supports public, server-rendered HTML. It does not bypass CAPTCHAs, bot protection, authentication, or merchant controls. Sites such as Flipkart may reject automated access and return an actionable failure instead of a preview.

## Run locally

Requires a maintained Node.js LTS release, version 20 or newer.

```bash
cd app
npm start
```

The application listens on `http://127.0.0.1:4320` by default. When `OPERATOR_PASSWORD` is omitted on loopback, it prints a new random startup password in the terminal.

For a stable password, provide it at startup:

```bash
cd app
OPERATOR_PASSWORD='use-a-long-random-secret' npm start
```

Never commit that password. Different machines and restarts do **not** share the generated password. A deliberately configured `OPERATOR_PASSWORD` remains the same only where the operator supplies the same secret.

## Verify

```bash
bash app/verify.sh
```

The retained acceptance evidence covers 34 Node tests and Chromium checks for desktop and phone views, exact five-page output, smaller-source capping, Home-only fallback, cross-site private sharing, separate demo carts, cancellation, focus, and browser errors. Browser verification uses Playwright supplied through `PLAYWRIGHT_MODULE`; see [application documentation](app/README.md).

## Documentation

- [Application operation](app/README.md)
- [Hosting guide](HOSTING.md)
- [Release notes](RELEASE_NOTES.md)
- [Implemented user flow](docs/IMPLEMENTED_FLOW.md)
- [Simplified plan](docs/SIMPLIFIED_PLAN.md)
- [Widget integration boundary](app/INTEGRATION.md)
- [Final assessment](docs/FINAL_ASSESSMENT.md)
- [Fable review](docs/reviews/FABLE_REVIEW.md)
- [WC-002 Terra, Sol, and Astra review record](docs/reviews/WC-002_MODEL_REVIEWS.md)
- [Test evidence](app/review/EVIDENCE.md)
- [Known limitations](app/review/LIMITATIONS.md)

## Current boundary

The repository contains a verified local prototype. A live Suitsupply smoke requested five pages and generated Home, Collection, and three distinct product details. The project has not been remotely deployed, and the existing sales widget is not embedded. Runtime data, sessions, generated demos, and passwords are excluded from version control.
