// Rajnandani Suppliers — Scratch & Win server
// Server is authoritative for: eligibility, reward selection, coupon issuance,
// duplicate-participation blocking, and redemption. The browser only animates
// the scratch reveal of a result the server already decided.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
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
// Tiny synchronous JSON data store (fine for single-process MVP traffic;
// swap for a real DB + auth before scaling this up).
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    return { participations: {}, coupons: {} };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

let store = loadStore();

function normalizeMobile(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

function isCampaignActive() {
  const now = Date.now();
  return now >= Date.parse(CAMPAIGN.startDate) && now <= Date.parse(CAMPAIGN.endDate);
}

function pickReward() {
  const eligible = REWARDS.filter(r => r.remaining === null || r.remaining > 0);
  const totalWeight = eligible.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const r of eligible) {
    if (roll < r.weight) return r;
    roll -= r.weight;
  }
  return eligible[eligible.length - 1];
}

function generateCouponCode() {
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `RAJ-${random}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/campaign', (req, res) => {
  res.json({
    ...CAMPAIGN,
    active: isCampaignActive(),
    rewardPreview: REWARDS.filter(r => r.id !== 'none').map(r => r.label)
  });
});

app.post('/api/scratch', (req, res) => {
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
  if (store.participations[mobile]) {
    return res.status(409).json({
      error: 'This mobile number has already participated in this campaign.',
      previousResult: store.participations[mobile]
    });
  }

  const reward = pickReward();
  const now = new Date();

  let coupon = null;
  if (reward.type !== 'none') {
    if (reward.remaining !== null) reward.remaining -= 1;

    const code = generateCouponCode();
    const expiresAt = new Date(now.getTime() + reward.validityDays * 86400000);
    coupon = {
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
    store.coupons[code] = coupon;
  }

  const participation = {
    shopName,
    dealerName,
    mobile,
    timestamp: now.toISOString(),
    won: reward.type !== 'none',
    rewardLabel: reward.label,
    couponCode: coupon ? coupon.code : null
  };
  store.participations[mobile] = participation;
  saveStore(store);

  res.json({
    won: participation.won,
    rewardLabel: reward.label,
    coupon
  });
});

// Staff: look up a coupon's status without redeeming it
app.post('/api/verify', (req, res) => {
  const { code, passcode } = req.body;
  if (passcode !== STAFF_PASSCODE) return res.status(401).json({ error: 'Invalid staff passcode.' });

  const coupon = store.coupons[(code || '').trim().toUpperCase()];
  if (!coupon) return res.status(404).json({ error: 'Coupon code not found.' });

  const expired = Date.now() > Date.parse(coupon.expiresAt);
  res.json({ coupon, expired });
});

// Staff: redeem a valid coupon exactly once
app.post('/api/redeem', (req, res) => {
  const { code, passcode } = req.body;
  if (passcode !== STAFF_PASSCODE) return res.status(401).json({ error: 'Invalid staff passcode.' });

  const key = (code || '').trim().toUpperCase();
  const coupon = store.coupons[key];
  if (!coupon) return res.status(404).json({ error: 'Coupon code not found.' });

  if (coupon.status === 'redeemed') {
    return res.status(409).json({ error: `Already redeemed on ${coupon.redeemedAt}.`, coupon });
  }
  if (coupon.status === 'cancelled') {
    return res.status(409).json({ error: 'This coupon was cancelled.', coupon });
  }
  if (Date.now() > Date.parse(coupon.expiresAt)) {
    return res.status(409).json({ error: 'This coupon has expired.', coupon });
  }

  coupon.status = 'redeemed';
  coupon.redeemedAt = new Date().toISOString();
  saveStore(store);

  res.json({ success: true, coupon });
});

// Admin: list every dealer who scratched, with their coupon status —
// use this to plan gifts/offers for repeat dealers or unredeemed winners.
function buildDealerRows() {
  return Object.values(store.participations)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .map(p => {
      const coupon = p.couponCode ? store.coupons[p.couponCode] : null;
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
    });
}

app.post('/api/dealers', (req, res) => {
  if (req.body.passcode !== ADMIN_PASSCODE) return res.status(401).json({ error: 'Invalid admin passcode.' });
  res.json({ dealers: buildDealerRows() });
});

app.get('/api/dealers/export', (req, res) => {
  if (req.query.passcode !== ADMIN_PASSCODE) return res.status(401).send('Invalid admin passcode.');

  const rows = buildDealerRows();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rajnandani Scratch & Win running at http://localhost:${PORT}`);
  console.log(`Staff redemption page at http://localhost:${PORT}/staff.html (passcode: ${STAFF_PASSCODE})`);
  console.log(`Dealer data page at http://localhost:${PORT}/dealers.html (passcode: ${ADMIN_PASSCODE})`);
});
