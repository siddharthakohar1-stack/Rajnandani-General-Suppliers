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
  and `validityDays` (coupon expiry). The `none` entry is the "better luck next time" outcome.

## Data

Participation and coupon records are stored in `data/store.json` (auto-created). Delete that file to
reset the campaign. For real production use, swap this for a proper database before you get real
customer traffic — this file-based store is fine for a single small shop running on one machine.

## What's deliberately not built yet (MVP scope)

No proper login system (just shared passcodes), no SMS/email delivery, no multi-campaign support. The
core guarantees the business needs — one scratch per mobile number, server-decided prize, one-time
coupon redemption, and a dealer list for gifts/offers — are all enforced server-side in `server.js`.
