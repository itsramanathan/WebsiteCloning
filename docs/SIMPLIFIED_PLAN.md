# Simple website demo builder

Current proposed plan | 21 September 2026 | Revised after Claude Fable review

## What we are building

A person enters a store or B2B website URL. The tool creates a small, familiar-looking version called **Demo - Store Name**, adds our sales agent, and returns a demo link. It reuses a sample of the website, not the entire website.

Example: a fictional `northstar.example` becomes **Demo - Northstar**, hosted at `/demo/northstar-a7k2`. The short random suffix avoids name collisions; there is no custom domain, DNS setup, or merchant installation. The URL example is illustrative.

This document replaces the larger architecture and delivery scope proposed in PLAN.md and ARCHITECTURE.md. Those documents and the original literature review remain as background. No product code is authorized or built by this plan revision.

## Keep the output small

| Item | First-version scope |
| --- | --- |
| Pages | Homepage, one collection/solutions page, one reusable detail page |
| Products | Up to 6 products; for B2B, up to 3 offerings |
| Source pages | Homepage + one collection + up to two detail pages; maximum 4 |
| Appearance | Store name/logo, colors, fonts where available, hero, major section layout, product images and cards |
| Interactions | Browse, open a sample item, talk to our agent, prepare a demo cart or quote |
| Naming | Demo - original store name, with a visible demo label |
| Delivery | One link from our existing app; the merchant site is untouched |

The same detail component displays whichever sample item is selected. We do not generate a unique page design for each product. Items without captured detail text show their captured name/image and available price, with missing specifications left out. A collection with only three usable products produces a three-product demo; there is no minimum-six scraping loop.

Visible notice: **"Demo - sample products and information. No real orders."** A demo label clarifies the experience; it does not independently grant permission to reuse assets. Use permitted public or supplied material and retain the source URL.

## Architecture: one app, one generation job

Use our existing web application, one background job, and its existing storage. Do not introduce microservices, a dedicated agent framework, a new vector database, or a separate commerce platform.

**URL -> read up to four pages -> create a small demo description -> render our demo components -> attach our agent -> check -> show link.**

The demo is data and styling in a fixed application, not a newly deployed software project for every prospect. Each demo stores one compact JSON description and selected assets. No per-prospect dependency installation, code build, container, or hosting project is needed.

### 1. Read a small sample

Start with Playwright for capture and extraction. Read the homepage and one likely collection/solutions link, then at most two representative detail links. Capture desktop references for the selected page layouts. Use responsive components and check the resulting demo at phone width; a separate mobile source capture is unnecessary in the first version. Stop at the page cap even if the site has thousands of products.

If there is no collection link, use product or service cards on the homepage. If no usable offerings are found, fail with that reason instead of inventing a catalog. Select linked pages from the submitted site's origin; separately validate redirects and asset/CDN destinations.

Extract store name, logo, hero image, a few colors/type sizes, section order, product-card layout, and the sample product names/images/prices. Prefer structured page data when present, but compare it with visible content. Record source URLs. Keep unknown prices or specifications unknown. B2B offerings may say "Request a quote".

Use a permitted system/open font similar to the source family; downloading the source's font files is unnecessary for this demo.

Use one capture/extraction path initially. Firecrawl is an alternative if a short trial shows it saves enough work; do not run two crawling systems for every demo. No sitemaps, full-domain crawl, logged-in pages, or product synchronization.

### 2. Make a demo description

One model call converts the captured evidence into validated JSON: brand, ordered sections, selected asset references, sample catalog, and page layouts. Use a small set of trusted components with adjustable section order, widths, spacing, imagery, and product-grid density.

This must preserve more than colors and a logo. The homepage's hero composition, header arrangement, image choices, and spacing should feel familiar. Do not force every source site into one generic hero/grid layout. Support a few useful layout variants in the same component set, then expand only when a real prospect needs it.

Start with full-width or split-image heroes, centered or left-aligned headers, and adjustable product-grid columns. These are initial options, not a promise that they fit every website.

The model cannot output executable JavaScript, arbitrary dependencies, checkout destinations, or backend operations. Validate layout options and style values. Reuse selected source assets through our storage; if an asset cannot be used, show an explicit placeholder instead of inventing an authentic product image.

Use a safe preset foreground/background pair whenever the captured text colors fall below a 4.5:1 contrast ratio. Use that same conservative threshold for all text to avoid extra size rules. Product images use the captured product name as alt text; purely decorative images have empty alt text.

### 3. Render and connect our product

The app renders the description through the fixed homepage, collection, and detail components. The existing sales-agent widget reads the sample catalog and current page. Product recommendations open the relevant demo item. Navigation remains inside the demo; links to omitted sections explain that the section is not included.

Use the same small catalog and cart/quote state for clicks, voice/text interactions, and a controlled buyer-agent demonstration. Prefer the existing product's tool/session implementation. If none exists, the minimal adapter exposes read catalog, show item, set cart quantity, and prepare quote draft. These are demo-only actions. Setting an explicit quantity is preferable to blindly repeating "add one" on retries.

Store quantities by item ID and one replaceable quote draft per session. Reuse existing session safeguards; otherwise use a session revision number so a delayed agent action cannot overwrite a newer human edit. Reject stale writes and reread state instead of blindly replaying them. There is no separate order or quote service.

For the buyer-agent demonstration, a scripted buyer request goes through the actual merchant agent/tool surface, and the human sees the prepared cart or quote. This is a controlled integration demonstration, not proof of arbitrary third-party agent compatibility. The clone builder does not create a second agent product or implement new commerce protocols. If the actual agent integration is unavailable, call the result a website preview, not a working agentic-commerce demo.

### 4. Check and deliver

Check that the three views load, images appear, sample links work, the agent can open an item, and cart/quote actions remain local to the demo. For the selected source features, check the correct logo/hero assets when present, retained section order, chosen brand colors, and product-card images. A missing required feature or broken interaction triggers the one correction; if still broken, return failed with the reason. Do not require a hero or logo that the source itself lacks. Verify all three views at a phone viewport with the agent open.

The operator compares the rendered and source homepage screenshots side by side for recognizable composition and spacing. Passing structural checks alone does not prove a visual match. After the job finishes, choose Share, Retry, or leave the preview unshared. Retry is a fresh attempt; there is no operator-triggered edit of a ready artifact or extra correction path. No weighted visual scoring engine is needed.

In the initial internal version, the operator can open the preview and decide whether it is suitable to show. There is no separate approval service, weighted scoring engine, or multi-round reviewer pipeline in the product.

Keep one `share_enabled` flag, initially false, separate from job status. Share enables access only for the current ready artifact. Retry turns sharing off; Delete revokes access. This records the operator's decision without adding more job states.

Save status as **building, ready, or failed**. Each attempt records a start time and attempt number. On a status read, an overdue building attempt becomes failed after the proposed five-minute timeout. Retry reuses the demo record/link, increments the attempt number, and writes a fresh subfolder. Publish its artifact pointer only if that attempt is still current, within deadline, and the demo has not been deleted; late workers cannot replace a newer result or restore a deleted demo. Only successful, complete artifacts are served. This uses the same job record, not a generalized workflow engine. Measure actual duration before promising a completion time.

## Small safeguards we still need

- Restrict all capture-network requests, including scripts, XHR, frames, redirects, and asset downloads, to allowed public HTTP(S) destinations. Use connection-level network isolation/egress enforcement covering IPv4/IPv6 and private, loopback, link-local, and metadata addresses. URL validation or a browser interception hook alone is insufficient against DNS rebinding. Never attach a personal browser session.
- Treat captured content as data, not instructions. Render text safely, validate asset types and layout/style fields, and keep external scripts/forms out of the demo.
- Route all actions to demo state. No real checkout, login capture, payments, CRM writes, or outbound quote emails.
- Management actions (create, Retry, Share, Delete) require the creator's authenticated app session. Prospects need no app account: a shared link contains a separate revocable, cryptographically random token with at least 128 bits of entropy, scoped only to viewing that demo and its assets. The server checks the token and `share_enabled`, then creates an independent demo session for each visitor. The short store-name suffix is only a locator, never authentication. Keep API credentials server-side.
- Cap pages, assets, model input, calls, and runtime. Initial bounds: 4 source pages, 30 saved images, 25 MB of saved assets, 1 generation plus 1 correction, and 5 minutes per attempt. Send at most 5,000 selected text characters per page and five screenshots reduced to at most 1,600 pixels on the longest side; include only the retained sections and product sample. Record actual cost on the three trial sites.
- Provide a Delete demo button. Automatic expiration, elaborate retention policies, and notification systems can wait until they are needed.

## Simple implementation sequence

1. **Check the integration, then build one example:** confirm the widget can receive the sample catalog/current page and call session-scoped demo actions. Confirm the capture environment can enforce public-only egress. Missing network isolation is separate infrastructure work and blocks arbitrary-URL capture, even for operators; use supplied captures meanwhile. If the agent is unavailable, the first milestone is explicitly a website preview: three views, working navigation, source-like styling, sample catalog, and demo label. It does not satisfy the agent-demo milestone.
2. **Attach our existing agent:** prove one shopper journey and one controlled buyer-agent journey, sharing the same demo cart or quote.
3. **Try three different sites:** one ordinary retail store, one visually different retail store, and one B2B site. Fix material resemblance or interaction problems. No 20-site research program before the first useful demo.
4. **Expose the URL form to visitors later:** use authenticated, rate-limited creator sessions and the same job; viewers still use share tokens without an account. Keep operator-controlled Share in the first version. Automatic sharing for a proven, narrowly supported layout set is a later option, not an initial requirement or a claim of universal fidelity.

Planning allowance: approximately 5-8 engineer-days for the internal tool if the agent embed/session tools, app authentication/storage, and capture network isolation already exist. This is an estimate, not measured delivery evidence. Missing agent or infrastructure functionality is separate work.

## What counts as enough

The store is recognizable at a glance, the selected images and names are correct, and the limited demo works. On each of the three trial sites:

- A reviewer can identify the source from the demo's header, hero, imagery, and layout, not just its name.
- All three views work on desktop and phone; text and the agent do not obscure primary controls. Keyboard navigation and text fallback work.
- The user can ask about a sample product, open it, and prepare a demo cart or B2B quote.
- A controlled buyer-agent request produces state the human can inspect, and another visitor gets an independent session.
- Missing facts stay unknown, no real transaction happens, and capture stops at the configured limits.

Do not promise exact copying of every website. If a blocked source or unusual animation prevents a useful match, return a clear limitation. A screenshot-based reference can be a later optional fallback, not another system in the first version.

## Compact architecture reference

Process: submit URL -> bounded capture -> validated description -> render -> check -> demo link, or failed with a reason.

Runtime: existing app -> one background job -> public source pages + model; existing storage holds JSON/assets; trusted page components + existing sales agent share demo session state.

Recovery: building -> ready or failed; overdue status reads detect stalled jobs; Retry starts a fresh attempt on the same demo. Delete immediately removes access and prevents an old worker from republishing it. Partial artifacts are never shown as ready.

Interaction: visitor/buyer agent -> existing sales-agent tools -> sample catalog/cart -> updated view. No merchant endpoint receives the action.

Checks mapped to scope: source/network limits protect capture; JSON validation protects rendering; a short browser walkthrough checks resemblance and navigation; shared-state checks validate the two agent journeys. These are proposed checks, not executed proof.
