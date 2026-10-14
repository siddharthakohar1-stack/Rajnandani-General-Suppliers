// Vercel KV (Redis) backend — required on Vercel since serverless functions
// have no persistent disk and no long-lived in-memory state between requests.
const { kv } = require('@vercel/kv');

const pKey = mobile => `participation:${mobile}`;
const cKey = code => `coupon:${code}`;

async function claimParticipation(mobile) {
  // SET ... NX is atomic: only the first caller for a given mobile number wins.
  const result = await kv.set(pKey(mobile), { shopName: '', pending: true, timestamp: new Date().toISOString() }, { nx: true });
  if (result === null) return false;
  await kv.sadd('participant_index', mobile);
  return true;
}

async function saveParticipation(mobile, record) {
  await kv.set(pKey(mobile), record);
}

async function getParticipation(mobile) {
  return kv.get(pKey(mobile));
}

async function listParticipations() {
  const mobiles = await kv.smembers('participant_index');
  if (!mobiles || mobiles.length === 0) return [];
  const records = await Promise.all(mobiles.map(m => kv.get(pKey(m))));
  return records.filter(Boolean).filter(r => !r.pending);
}

async function saveCoupon(coupon) {
  await kv.set(cKey(coupon.code), coupon);
  await kv.sadd('coupon_index', coupon.code);
}

async function getCoupon(code) {
  return kv.get(cKey(code));
}

// Reserve one unit of stock for a reward; false if sold out.
async function reserveStock(rewardId, initialRemaining) {
  await kv.set(`stock:${rewardId}`, initialRemaining, { nx: true });
  const remaining = await kv.decr(`stock:${rewardId}`);
  if (remaining < 0) {
    await kv.incr(`stock:${rewardId}`); // put it back
    return false;
  }
  return true;
}

// Atomic lock so exactly one concurrent redeem request can mark a coupon redeemed.
async function claimRedemption(code) {
  const result = await kv.set(`redeemed-lock:${code}`, '1', { nx: true });
  return result !== null;
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
