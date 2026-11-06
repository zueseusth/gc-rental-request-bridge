# GC ONNESIS Package Selector — GitHub + Render + Wix CMS

This extends the **existing** `gc-rental-request-bridge` service. Existing rental routes (`/`, `/rental`, `/api/rental`, `/health`) remain unchanged.

## Routes
- `GET /packages`: client-facing G[A] / G[B] selection HTML hosted entirely on Render.
- `POST /api/packages`: server-side validation and Wix CMS storage. Same-origin requests from the Render-hosted page only.

## Wix setup (no Velo code needed)
On `www.groundbangkok.com`, add an **Embed Site / iframe** using this URL:

`https://ground-bangkok-gc-rental.onrender.com/packages`

Set the iframe height to at least 1700px, adjusted for your page; on mobile it may require more height. Do not paste OAuth credentials anywhere in Wix HTML, and do not paste the old Velo web module or Wix page code. The page and backend both live in GitHub and run on Render.

## Storage
- Primary records: `GCPackageRequests` (admin-only; already created)
- Optional mirrored records: `GCPackageMirrors` (admin-only; already created)
- Both collections use the same request ID and a stable `payloadJson` to detect mismatched duplicates.
- Mirror is a second Wix CMS collection, **not** an independent backup or server failover.
- The API returns `SAVED` only after primary storage and, when requested, mirror storage are confirmed. If primary succeeded and mirror failed, it returns `PRIMARY_ONLY`.

## Environment
- Reuses existing `WIX_CLIENT_ID`, `WIX_CLIENT_SECRET`, and cached server-side OAuth access token. No new secrets added.
- Optional `PACKAGE_PUBLIC_ORIGIN` defaults to `https://ground-bangkok-gc-rental.onrender.com`.
- Existing `ALLOWED_ORIGINS` controls rental API CORS and does not need changes.

## Validate
- `npm test` (includes rental regression tests and package tests).
- Check `GET /health` confirms `credentialConfigured: true`.
- Check `GET /packages` returns the HTML interface and that `/api/packages` rejects invalid origins and malformed payloads.
- Only run a real submission test when ready to create a real CMS request record.

## Security and product boundaries
- Browser sends data to same-origin Render API. It never receives Wix client secrets or OAuth tokens.
- API accepts a single-use 32-character request reference; duplicate requests with identical payload are idempotent.
- Input validation, honeypot and in-memory per-IP rate limiting reduce abuse but are not a substitute for CAPTCHA or distributed limits.
- No real agent recruitment, encryption service, billing, or project deployment occurs here. Packages are requests pending GC review.
