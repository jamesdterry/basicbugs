import * as projectMembersDb from '../db/projectMembers.js';

// @<token> at start of string or after any non-word boundary.
// Negative lookbehind via the [^A-Za-z0-9_] guard ensures `email@example.com`
// is not parsed as a mention of `example`.
const MENTION_RE = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_.+-]+)/g;

export function extractTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  const seen = new Set();
  const out = [];
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function emailLocal(email) {
  if (!email) return null;
  const idx = email.indexOf('@');
  return (idx === -1 ? email : email.slice(0, idx)).toLowerCase();
}

/**
 * Resolve mention tokens to project member user ids.
 * Match priority:
 *   1. Email local-part (case-insensitive).
 *   2. users.name (case-insensitive) only when name has no spaces.
 * Unknown tokens are silently dropped.
 *
 * Returns: array of distinct {userId, token} for tokens that resolve.
 */
export function resolveMentions(db, projectId, text) {
  const tokens = extractTokens(text);
  if (tokens.length === 0) return [];
  const members = projectMembersDb.listForProject(db, projectId);
  const byLocal = new Map();
  const byName = new Map();
  for (const m of members) {
    const local = emailLocal(m.email);
    if (local) byLocal.set(local, m.user_id);
    if (m.name) {
      const trimmed = m.name.trim();
      if (trimmed && !/\s/.test(trimmed)) {
        byName.set(trimmed.toLowerCase(), m.user_id);
      }
    }
  }
  const matched = [];
  const seenIds = new Set();
  for (const t of tokens) {
    const id = byLocal.get(t) ?? byName.get(t);
    if (id != null && !seenIds.has(id)) {
      seenIds.add(id);
      matched.push({ userId: id, token: t });
    }
  }
  return matched;
}

// Lightweight directory used by the autocomplete UI.
export function listMembersForMentions(db, projectId) {
  const members = projectMembersDb.listForProject(db, projectId);
  return members
    .map((m) => ({
      userId: m.user_id,
      name: m.name,
      email: m.email,
      emailLocal: emailLocal(m.email),
    }))
    .filter((m) => m.emailLocal);
}
