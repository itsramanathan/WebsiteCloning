# Existing widget integration seam

The preview intentionally does not display a fake assistant and does not claim an existing-agent integration.

The inspected candidate lives in a separate, unmodified widget project. It is configured with `storeId`, `apiKey`, and `apiUrl`; chat posts `session_id` and `message` to `/api/v1/widget/chat`; cart additions post `session_id`, `product_id`, and `quantity` to `/api/v1/widget/cart/add`. Its `onAddToCart` callback runs only after that backend mutation. It therefore cannot safely intercept a cart action and redirect it into this local preview.

## Same-origin preview API

An approved adapter can read and mutate the current preview session through these endpoints. It must run on the same origin; the browser automatically sends the HttpOnly `demo_session_<demoId>` cookie for the validated 16-character demo ID. Adapter code must not try to read that cookie. Mutations require `Content-Type: application/json` and an exact `expectedRevision`; a stale write returns HTTP 409 with current session state.

The operator preview HTML creates and returns this cookie. API calls made with only an operator cookie, before opening the preview HTML, are refused rather than creating an unreturned orphan session.

| Method | Endpoint | Contract |
| --- | --- | --- |
| `GET` | `/api/demo/:id/catalog` | Returns preview kind, source URL, and captured item IDs/names/images/prices. |
| `GET` | `/api/demo/:id/context` | Returns catalog, current page, cart, quote draft, and current revision. |
| `POST` | `/api/demo/:id/navigate` | `{ target, expectedRevision }`; target is `home`, `collection`, or `item:ITEM_ID`. |
| `POST` | `/api/demo/:id/cart` | `{ itemId, quantity, expectedRevision }`; quantity is an explicit integer from 0 through 99. |
| `POST` | `/api/demo/:id/quote` | `{ expectedRevision, note? }`; stores one replaceable, local-only draft from the current cart. |

All actions are scoped to the current ready demo and independent visitor session. Retry or Delete invalidates the session. These endpoints never call checkout, payments, email, CRM, the source merchant, or the candidate widget backend.

## Required adapter before embedding

A verified integration needs a demo-specific backend adapter that maps the widget's store/session/product identifiers onto this catalog and these optimistic-revision actions. Chat must be prevented from producing unsupported merchant operations, and cart tools must call the preview API instead of `/api/v1/widget/cart/add`. Because the current callback occurs after mutation, frontend callback wiring alone is insufficient.

Until that adapter and backend behavior are available and tested, this product remains a website preview with an explicit integration surface, not an agentic-commerce demo.
