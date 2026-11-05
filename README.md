# GC Rental Request — Wix Harmony secure bridge

## Current state

- The **existing Ground Bangkok site** uses Wix Harmony, which displays HTML embed code but does not run the Velo page-code + web-module bridge.
- Wix CMS collection ID **`GCRentalRequest`** already exists with 30 fields, private admin-only permissions. The prior plural `GCRentalRequests` remains unchanged.
- A dedicated Wix OAuth headless client **GC Rental Request Backend** has been created. Its **client ID** is `995f4985-5669-4598-8d40-0dda3f1696bb`. Its **client secret has not been generated or configured** here.
- The code in this package has been syntax-checked, and the validation/price calculation tests pass. **It is not currently deployed or live.**

## Deploy server to Render

1. Put `server.js`, `package.json` and `server.test.js` in a GitHub repository that your Render account can access. Keep credentials OUT of GitHub.
2. In Render, create a **Web Service**, connect the repository; use Node runtime, `npm start`, Singapore region. The server requires Node 20+.
3. In Wix Dashboard > Settings > Headless settings > **GC Rental Request Backend**, choose **Generate Client Secret**. Copy it once and store it securely **only in Render environment variables**. Never paste it into an HTML Embed, GitHub, this chat, or a Head JS snippet.
4. Configure these Render environment variables:

   - `WIX_CLIENT_ID=995f4985-5669-4598-8d40-0dda3f1696bb`
   - `WIX_CLIENT_SECRET=<private generated secret>`
   - `ALLOWED_ORIGINS=<actual origin of the Wix HTML iframe>` (comma separated if needed; discover in browser Network tab / Origin request header)
   - `PORT` is supplied automatically by Render; do not hardcode it.

5. After deploy, open `https://<your-render-hostname>.onrender.com/health`. The JSON should have `collection: GCRentalRequest`, `credentialConfigured: true`, `originsConfigured: true`.
6. Open `GC_WIX_HARMONY_EMBED.html`; change **one line** `API_BASE` from `https://REPLACE-WITH-YOUR-GC-SERVICE.onrender.com` to your actual Render HTTPS origin (without trailing slash).
7. In the existing `gc-rental` Wix Harmony page, select the HTML Embed element. Replace its entire embedded code with the updated HTML file, then save. In Wix dashboard, disable the two incorrect **Head JS** snippets from earlier; they are not Velo files.
8. Preview the page. Look for **GC SUBMISSION CONNECTED**. Test a sample request and verify the new item appears in CMS **`GCRentalRequest`** with status `NEW`. Then publish.

## Security

- `GCRentalRequest` stays administrator-only. Browser code does not contain secrets and does not directly call Wix as an admin.
- The Node server validates client information, zone IDs and time, recomputes prices independently, and imposes a basic 12/hour/IP rate cap. Wix OAuth access tokens are obtained on the server and cached only in memory.
- Requests use an ID per submission to avoid accidental duplicate creation when clients retry a request with the same ID. A network timeout is explicitly **not proof that a submission failed**.
- Verify the **actual** iframe `Origin` header: Wix HTML embeds may run on a different origin from `www.groundbangkok.com`; setting an incorrect origin will cause the API to reject submissions.
- Before high traffic, add CAPTCHA, trusted reverse-proxy IP checks, durable distributed rate limiting and operational alerts. In-memory rate limiting resets on restart.
- The submitted amount is an estimate, not a payment, quotation acceptance or reservation. 

## Data flow

**Wix Harmony HTML Embed → GC HTTPS Bridge → Wix OAuth token (server only) → Wix CMS Insert Data Item → `GCRentalRequest` → receipt**.

This is not a Wix Form. The target collection ID is singular `GCRentalRequest`.
