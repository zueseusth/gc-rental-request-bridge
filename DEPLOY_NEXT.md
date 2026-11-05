# Ground Bangkok — activate the GC Rental CMS submission service

This deployment directly writes to the existing *private* `GCRentalRequest` Wix CMS collection. It is **not** a Wix Form and does **not** use the Wix Harmony Velo editor. The old `GCRentalRequests` collection remains untouched.

## What has been completed

- `GCRentalRequest` CMS collection created, with 30 fields and admin-only permissions.
- Dedicated Wix Headless OAuth app created: `GC Rental Request Backend` (client ID `995f4985-5669-4598-8d40-0dda3f1696bb`).
- Working Node.js bridge written and local automated tests pass.
- Render Blueprint `render.yaml` included with Singapore region and secret placeholders.
- **No Render service or GitHub repo was created**: the connected GitHub account currently offers no repository for these files, and Render needs one.
- **No secret was generated or stored**. The API is not live.

## Finish activation (no passwords in chat)

1. Create a new **private GitHub repository** in the GitHub account linked to Render. Name it `gc-rental-request-bridge` and add/upload *these source files*, especially `server.js`, `server.test.js`, `package.json`, `render.yaml`, and `.gitignore`. Keep them at the repository root. `GC_WIX_HARMONY_EMBED.html` is safe to commit: it contains NO credentials. Do **not** upload .env or a client secret.
2. In your Wix Dashboard, open **Settings → Headless Settings → GC Rental Request Backend** and choose **Generate Client Secret**. Copy it to your password manager; do not share it here or place it in an HTML snippet.
3. In Render, create a Blueprint from your GitHub repository's `render.yaml` (or create a new Node Web Service from the repository). The Blueprint specifies Singapore and `npm test` / `npm start`.
4. During Render setup, enter `WIX_CLIENT_SECRET` privately. `WIX_CLIENT_ID` is already filled in. Set `ALLOWED_ORIGINS` to the **actual Origin header** of requests sent from your Wix Harmony HTML embed. The origin may be a Wix iframe hostname rather than `https://www.groundbangkok.com`. For temporary diagnosis, inspect the Network request's `Origin` header in browser developer tools; do not use `*`.
5. Complete deployment. Open `https://<render-service-name>.onrender.com/health`; verify `credentialConfigured` and `originsConfigured` are both `true`, and collection is `GCRentalRequest`. **This does not yet test the Wix write**.
6. In `GC_WIX_HARMONY_EMBED.html`, replace the `API_BASE` placeholder with the real Render HTTPS origin. Paste the **entire updated HTML** into the HTML embed on your `gc-rental` Wix Harmony page. Disable previously created global Head-JS snippets named `GC_Wix_Page_Co...` and `gcRental.web`; they are not Velo modules.
7. Preview, then submit a clearly labeled test rental (future date, one zone) from the actual Wix page. Verify that a new item appears in the **`GCRentalRequest`** CMS collection, with status `NEW` and the calculated total. Only after this verified test, publish the page and accept real client submissions.

## Safety checklist

- Never place `WIX_CLIENT_SECRET` into GitHub source, public HTML, screenshots, or chat.
- The bridge independently recomputes fees and checks dates, zones and request fields; it is not a payment service and a request does not confirm booking.
- The code uses simple per-IP in-memory rate limiting; for public traffic, implement CAPTCHA and a durable rate limiter and review operational logs and privacy notices.
- `ALLOWED_ORIGINS` is a browser/CORS guard, not full user authentication. Anonymous public submissions are expected; restrict the endpoint to the rental form behavior and monitor abuse.
- The server does not use the old plural collection and does not modify existing entries.
