# Rajnandani Suppliers — Scratch & Win

Festival (Dashain/Tihar/Chhath) scratch-coupon campaign. Server picks the reward and blocks repeat
entries by mobile number — the browser only animates the scratch reveal. Each entry captures Shop
Name, Dealer/Owner Name, and Mobile Number so you can follow up with gifts/offers later.

## Run it

```
cd webapp
npm install
npm start
```

- Customer page: http://localhost:3000
- Staff redemption page: http://localhost:3000/staff.html (default passcode: `2026`)
- Dealer data page: http://localhost:3000/dealers.html (default passcode: `owner2026`) — view every
  dealer who scratched, their coupon status, and download it all as CSV for gift/offer planning.

Set custom passcodes with `STAFF_PASSCODE=yourcode ADMIN_PASSCODE=yourcode npm start`.

## Configure the campaign

Edit the `CAMPAIGN` and `REWARDS` objects at the top of `server.js`:

- `CAMPAIGN.startDate` / `endDate` — scratching is blocked outside this window.
- `REWARDS` — each entry has a `weight` (odds), optional `remaining` (stock limit, `null` = unlimited),
  and `validityDays` (coupon expiry). Every entry here is a real prize — there's no "better luck next
  time" outcome, every scratch wins something.

## Data

Two interchangeable storage backends live in `lib/`:

- `lib/file-store.js` — a local JSON file (`data/store.json`). Used automatically when no
  `KV_REST_API_URL` env var is set, i.e. for `npm start` on your own machine.
- `lib/kv-store.js` — Vercel KV (Redis). Used automatically when `KV_REST_API_URL` is present, i.e.
  when deployed on Vercel, since serverless functions have no persistent disk or memory between requests.

## Deploying on Vercel

1. Push this repo to GitHub, import it into a Vercel project.
2. In the project's **Storage** tab, create/connect a **KV** database — this injects
   `KV_REST_API_URL`/`KV_REST_API_TOKEN` automatically, which is what switches the app onto the KV
   backend above. Without this step, every request fails because nothing initialized `@vercel/kv`.
3. In **Settings → Environment Variables**, set `STAFF_PASSCODE` and `ADMIN_PASSCODE` to your own
   values — don't leave the defaults (`2026` / `owner2026`) live in production.
4. Redeploy. Customer page at your Vercel URL, staff page at `/staff.html`, dealer data at
   `/dealers.html`.

## Deploying on Render (alternative)

`render.yaml` is also included if you'd rather run this as a normal long-lived Node process with a
persistent disk instead of Vercel KV — see the comments in that file for the Starter-plan disk config.

## What's deliberately not built yet (MVP scope)

No proper login system (just shared passcodes), no SMS/email delivery, no multi-campaign support. The
core guarantees the business needs — one scratch per mobile number, server-decided prize, one-time
coupon redemption, and a dealer list for gifts/offers — are all enforced server-side in `server.js`.
