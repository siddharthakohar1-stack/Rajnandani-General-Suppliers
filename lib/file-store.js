// Local JSON-file backend for `npm start` on your own machine (no Vercel KV needed).
// Single Node process + synchronous fs calls make every operation here
// effectively atomic, same as the KV backend's guarantees on Vercel.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    return { participations: {}, coupons: {}, stock: {}, redeemedLocks: {} };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

let store = load();

async function claimParticipation(mobile) {
  if (store.participations[mobile]) return false;
  store.participations[mobile] = { pending: true, timestamp: new Date().toISOString() };
  save(store);
  return true;
}

async function saveParticipation(mobile, record) {
  store.participations[mobile] = record;
  save(store);
}

async function getParticipation(mobile) {
  return store.participations[mobile] || null;
}

async function listParticipations() {
  return Object.values(store.participations).filter(r => !r.pending);
}

async function saveCoupon(coupon) {
  store.coupons[coupon.code] = coupon;
  save(store);
}

async function getCoupon(code) {
  return store.coupons[code] || null;
}

async function reserveStock(rewardId, initialRemaining) {
  if (!(rewardId in store.stock)) store.stock[rewardId] = initialRemaining;
  if (store.stock[rewardId] <= 0) return false;
  store.stock[rewardId] -= 1;
  save(store);
  return true;
}

async function claimRedemption(code) {
  if (store.redeemedLocks[code]) return false;
  store.redeemedLocks[code] = true;
  save(store);
  return true;
}

module.exports = {
  claimParticipation,
  saveParticipation,
  getParticipation,
  listParticipations,
  saveCoupon,
  getCoupon,
  reserveStock,
  claimRedemption
};
