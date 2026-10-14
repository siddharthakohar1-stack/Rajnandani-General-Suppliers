// Rajnandani Suppliers — Scratch & Win server
// Server is authoritative for: eligibility, reward selection, coupon issuance,
// duplicate-participation blocking, and redemption. The browser only animates
// the scratch reveal of a result the server already decided.
//
// Storage: Vercel KV (Redis) when KV_REST_API_URL is set — required on Vercel,
// since serverless functions have no persistent disk or long-lived memory.
// Falls back to a local JSON file for `npm start` on your own machine.

const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Campaign + reward configuration (edit these to run a new campaign)
// ---------------------------------------------------------------------------
const CAMPAIGN = {
  name: 'Rajnandani Dashain-Tihar-Chhath Dhamaka',
  businessName: 'Rajnandani Suppliers',
  message: 'Scratch the golden foil and win an instant festival reward!',
  startDate: '2026-10-01T00:00:00+05:45',
  endDate: '2026-11-30T23:59:59+05:45',
  terms: [
    'One scratch attempt per dealer (mobile number) for the full campaign.',
    'Reward is decided instantly and cannot be changed once revealed.',
    'Coupon must be redeemed in-store before its printed expiry date.',
    'Dealer details are collected only to issue this coupon and share future gifts/offers.',
    'Management decision on reward allocation is final.'
  ]
};

// weight = relative chance; remaining = null means unlimited stock
const REWARDS = [
  { id: 'off5', label: '5% OFF your next bill', type: 'percent', value: 5, weight: 25, remaining: null, validityDays: 14 },
  { id: 'off10', label: '10% OFF your next bill', type: 'percent', value: 10, weight: 15, remaining: 500, validityDays: 14 },
  { id: 'flat100', label: 'Flat ₹100 OFF (min. ₹1000 order)', type: 'flat', value: 100, weight: 7, remaining: 100, validityDays: 21 },
  { id: 'flat500', label: 'Flat ₹500 OFF (min. ₹2500 order)', type: 'flat', value: 500, weight: 3, remaining: 10, validityDays: 21 }
];

const STAFF_PASSCODE = process.env.STAFF_PASSCODE || '2026';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'owner2026';

// ---------------------------------------------------------------------------
// Data layer — two interchangeable backends behind the same small interface.
// ---------------------------------------------------------------------------
const db = process.env.KV_REST_API_URL
  ? require('./lib/kv-store')
  : require('./lib/file-store');

function normalizeMobile(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

function isCampaignActive() {
  const now = Date.now();
  return now >= Date.parse(CAMPAIGN.startDate) && now <= Date.parse(CAMPAIGN.endDate);
}

function generateCouponCode() {
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `RAJ-${random}`;
}

// Pick a reward, atomically reserving stock. Retries if a concurrent request
// wins the last unit of a limited reward between the pick and the reserve.
async function pickAndReserveReward() {
  const candidates = [...REWARDS];
  while (candidates.length > 0) {
    const totalWeight = candidates.reduce((sum, r) => sum + r.weight, 0);
    let roll = Math.random() * totalWeight;
    let picked = candidates[candidates.length - 1];
    for (const r of candidates) {
      if (roll < r.weight) { picked = r; break; }
      roll -= r.weight;
    }

    if (picked.remaining === null) return picked;

    const ok = await db.reserveStock(picked.id, picked.remaining);
    if (ok) return picked;

    // Out of stock — drop it and re-roll among what's left.
    const idx = candidates.indexOf(picked);
    candidates.splice(idx, 1);
  }
  throw new Error('No rewards configured.');
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/campaign', (req, res) => {
  res.json({
    ...CAMPAIGN,
    active: isCampaignActive(),
    rewardPreview: REWARDS.map(r => r.label)
  });
});

app.post('/api/scratch', async (req, res) => {
  const shopName = String(req.body.shopName || '').trim();
  const dealerName = String(req.body.dealerName || '').trim();
  const mobile = normalizeMobile(req.body.mobile);

  if (shopName.length < 2) {
    return res.status(400).json({ error: 'Enter your shop name.' });
  }
  if (dealerName.length < 2) {
    return res.status(400).json({ error: 'Enter the dealer/owner name.' });
  }
  if (!/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  }
  if (!isCampaignActive()) {
    return res.status(403).json({ error: 'This campaign is not currently active.' });
  }

  try {
    // Atomically claim this mobile number before doing anything else —
    // this is what makes "one scratch per dealer" hold up under concurrent requests.
    const claimed = await db.claimParticipation(mobile);
    if (!claimed) {
      const previous = await db.getParticipation(mobile);
      return res.status(409).json({
        error: 'This mobile number has already participated in this campaign.',
        previousResult: previous
      });
    }

    const reward = await pickAndReserveReward();
    const now = new Date();

    const code = generateCouponCode();
    const expiresAt = new Date(now.getTime() + reward.validityDays * 86400000);
    const coupon = {
      code,
      shopName,
      dealerName,
      mobile,
      rewardId: reward.id,
      rewardLabel: reward.label,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'issued' // issued | redeemed | cancelled
    };
    await db.saveCoupon(coupon);

    const participation = {
      shopName,
      dealerName,
      mobile,
      timestamp: now.toISOString(),
      won: true,
      rewardLabel: reward.label,
      couponCode: code
    };
    await db.saveParticipation(mobile, participation);

    res.json({ won: true, rewardLabel: reward.label, coupon });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Staff: look up a coupon's status without redeeming it
app.post('/api/verify', async (req, res) => {
  const { code, passcode } = req.body;
  if (passcode !== STAFF_PASSCODE) return res.status(401).json({ error: 'Invalid staff passcode.' });

  const coupon = await db.getCoupon((code || '').trim().toUpperCase());
  if (!coupon) return res.status(404).json({ error: 'Coupon code not found.' });

  const expired = Date.now() > Date.parse(coupon.expiresAt);
  res.json({ coupon, expired });
});

// Staff: redeem a valid coupon exactly once
app.post('/api/redeem', async (req, res) => {
  const { code, passcode } = req.body;
  if (passcode !== STAFF_PASSCODE) return res.status(401).json({ error: 'Invalid staff passcode.' });

  const key = (code || '').trim().toUpperCase();
  const coupon = await db.getCoupon(key);
  if (!coupon) return res.status(404).json({ error: 'Coupon code not found.' });

  if (coupon.status === 'cancelled') {
    return res.status(409).json({ error: 'This coupon was cancelled.', coupon });
  }
  if (Date.now() > Date.parse(coupon.expiresAt)) {
    return res.status(409).json({ error: 'This coupon has expired.', coupon });
  }

  // Atomic compare-and-swap guard: only the request that wins this lock may redeem.
  const wonLock = await db.claimRedemption(key);
  if (!wonLock) {
    const latest = await db.getCoupon(key);
    return res.status(409).json({ error: `Already redeemed on ${latest.redeemedAt}.`, coupon: latest });
  }

  coupon.status = 'redeemed';
  coupon.redeemedAt = new Date().toISOString();
  await db.saveCoupon(coupon);

  res.json({ success: true, coupon });
});

// Admin: list every dealer who scratched, with their coupon status —
// use this to plan gifts/offers for repeat dealers or unredeemed winners.
async function buildDealerRows() {
  const participations = await db.listParticipations();
  const rows = await Promise.all(participations.map(async p => {
    const coupon = p.couponCode ? await db.getCoupon(p.couponCode) : null;
    return {
      shopName: p.shopName,
      dealerName: p.dealerName,
      mobile: p.mobile,
      participatedAt: p.timestamp,
      won: p.won,
      rewardLabel: p.rewardLabel,
      couponCode: p.couponCode || '',
      couponStatus: coupon ? coupon.status : '',
      expiresAt: coupon ? coupon.expiresAt : '',
      redeemedAt: coupon ? (coupon.redeemedAt || '') : ''
    };
  }));
  return rows.sort((a, b) => Date.parse(b.participatedAt) - Date.parse(a.participatedAt));
}

app.post('/api/dealers', async (req, res) => {
  if (req.body.passcode !== ADMIN_PASSCODE) return res.status(401).json({ error: 'Invalid admin passcode.' });
  res.json({ dealers: await buildDealerRows() });
});

app.get('/api/dealers/export', async (req, res) => {
  if (req.query.passcode !== ADMIN_PASSCODE) return res.status(401).send('Invalid admin passcode.');

  const rows = await buildDealerRows();
  const headers = ['Shop Name', 'Dealer Name', 'Mobile', 'Participated At', 'Won', 'Reward', 'Coupon Code', 'Coupon Status', 'Expires At', 'Redeemed At'];
  const csvEscape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([r.shopName, r.dealerName, r.mobile, r.participatedAt, r.won, r.rewardLabel, r.couponCode, r.couponStatus, r.expiresAt, r.redeemedAt].map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="dealers.csv"');
  res.send(lines.join('\n'));
});

module.exports = app;

// Only bind a port for local `npm start` / Render — Vercel imports `app` directly.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Rajnandani Scratch & Win running at http://localhost:${PORT}`);
    console.log(`Staff redemption page at http://localhost:${PORT}/staff.html (passcode: ${STAFF_PASSCODE})`);
    console.log(`Dealer data page at http://localhost:${PORT}/dealers.html (passcode: ${ADMIN_PASSCODE})`);
    console.log(`Data backend: ${process.env.KV_REST_API_URL ? 'Vercel KV' : 'local file (data/store.json)'}`);
  });
}
