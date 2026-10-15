// Postgres (Neon) backend — used on Vercel via DATABASE_URL.
// Records are stored as JSONB so the interface matches the other backends.
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

let ready;
function init() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS participations (
        mobile TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS coupons (code TEXT PRIMARY KEY, data JSONB NOT NULL)`;
      await sql`CREATE TABLE IF NOT EXISTS stock (reward_id TEXT PRIMARY KEY, remaining INT NOT NULL)`;
      await sql`CREATE TABLE IF NOT EXISTS redeemed_locks (code TEXT PRIMARY KEY)`;
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

async function claimParticipation(mobile) {
  await init();
  const data = JSON.stringify({ shopName: '', pending: true, timestamp: new Date().toISOString() });
  const rows = await sql`INSERT INTO participations (mobile, data) VALUES (${mobile}, ${data}::jsonb)
    ON CONFLICT (mobile) DO NOTHING RETURNING mobile`;
  return rows.length === 1;
}

async function saveParticipation(mobile, record) {
  await init();
  await sql`INSERT INTO participations (mobile, data) VALUES (${mobile}, ${JSON.stringify(record)}::jsonb)
    ON CONFLICT (mobile) DO UPDATE SET data = EXCLUDED.data`;
}

async function getParticipation(mobile) {
  await init();
  const rows = await sql`SELECT data FROM participations WHERE mobile = ${mobile}`;
  return rows[0] ? rows[0].data : null;
}

async function listParticipations() {
  await init();
  const rows = await sql`SELECT data FROM participations ORDER BY created_at`;
  return rows.map(r => r.data).filter(r => !r.pending);
}

async function saveCoupon(coupon) {
  await init();
  await sql`INSERT INTO coupons (code, data) VALUES (${coupon.code}, ${JSON.stringify(coupon)}::jsonb)
    ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data`;
}

async function getCoupon(code) {
  await init();
  const rows = await sql`SELECT data FROM coupons WHERE code = ${code}`;
  return rows[0] ? rows[0].data : null;
}

// Reserve one unit of stock; false if sold out. Atomic single UPDATE.
async function reserveStock(rewardId, initialRemaining) {
  await init();
  await sql`INSERT INTO stock (reward_id, remaining) VALUES (${rewardId}, ${initialRemaining})
    ON CONFLICT (reward_id) DO NOTHING`;
  const rows = await sql`UPDATE stock SET remaining = remaining - 1
    WHERE reward_id = ${rewardId} AND remaining > 0 RETURNING remaining`;
  return rows.length === 1;
}

// Only the first caller per code inserts the lock row.
async function claimRedemption(code) {
  await init();
  const rows = await sql`INSERT INTO redeemed_locks (code) VALUES (${code})
    ON CONFLICT (code) DO NOTHING RETURNING code`;
  return rows.length === 1;
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
