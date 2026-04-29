const buckets = new Map();
const MAX_BUCKETS = 10_000;
const PRUNE_INTERVAL_MS = 1_000;
let lastPruneAt = 0;

function prune(now) {
  for (const [key, bucket] of buckets) {
    const elapsed = now - bucket.updatedAt;
    const refilled = Math.min(
      bucket.capacity,
      bucket.tokens + (elapsed / bucket.refillMs) * bucket.capacity,
    );
    if (elapsed >= bucket.refillMs && refilled >= bucket.capacity) {
      buckets.delete(key);
    }
  }

  // Map iteration order is insertion order; entries get re-inserted on every
  // hit (see `take`), so the front of the map is the least-recently-used.
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
}

function maybePrune(now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  prune(now);
}

function take(key, capacity, refillMs, now) {
  maybePrune(now);
  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { tokens: capacity - 1, updatedAt: now, capacity, refillMs });
    return true;
  }
  const elapsed = now - existing.updatedAt;
  const refill = (elapsed / refillMs) * capacity;
  const tokens = Math.min(capacity, existing.tokens + refill);
  existing.capacity = capacity;
  existing.refillMs = refillMs;
  // Re-insert so the bucket moves to the back of the iteration order — the
  // overflow eviction in `prune` then drops the genuinely least-recently-used.
  buckets.delete(key);
  buckets.set(key, existing);
  if (tokens < 1) {
    existing.tokens = tokens;
    existing.updatedAt = now;
    return false;
  }
  existing.tokens = tokens - 1;
  existing.updatedAt = now;
  return true;
}

function makeMiddleware({ name, capacity, refillMs, keyFn }) {
  return function rateLimitMiddleware(req, res, next) {
    const subject = keyFn(req);
    if (!subject) return next();
    const key = `${name}:${subject}`;
    if (take(key, capacity, refillMs, Date.now())) return next();
    res.status(429).json({ error: 'rate_limited' });
  };
}

export function byIp({ name, capacity, refillMs }) {
  return makeMiddleware({
    name: `${name}:ip`,
    capacity,
    refillMs,
    keyFn: (req) => req.ip,
  });
}

export function byEmail({ name, capacity, refillMs }) {
  return makeMiddleware({
    name: `${name}:email`,
    capacity,
    refillMs,
    keyFn: (req) => {
      const email = req.body?.email;
      return typeof email === 'string' ? email.toLowerCase() : null;
    },
  });
}

export function _resetForTests() {
  buckets.clear();
  lastPruneAt = 0;
}

export function _bucketCountForTests() {
  return buckets.size;
}

export function _bucketKeysForTests() {
  return [...buckets.keys()];
}

export function _pruneForTests(now = Date.now()) {
  prune(now);
}
