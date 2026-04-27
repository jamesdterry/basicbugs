const buckets = new Map();

function take(key, capacity, refillMs, now) {
  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { tokens: capacity - 1, updatedAt: now });
    return true;
  }
  const elapsed = now - existing.updatedAt;
  const refill = (elapsed / refillMs) * capacity;
  const tokens = Math.min(capacity, existing.tokens + refill);
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
}
