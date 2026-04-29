import { config } from '../config.js';
import { logger } from '../logger.js';
import { getDb } from '../db/connection.js';
import * as notificationsDb from '../db/notifications.js';
import * as prefsDb from '../db/notificationPrefs.js';
import * as watchersDb from '../db/watchers.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as emailService from './email.js';
import { resolveMentions } from './mentions.js';

// Highest-priority reason per recipient per event (one notification per user
// per history row).
const KIND_PRIORITY = ['assigned_to_me', 'mentioned', 'watched_status_change', 'watched_any_change'];

function statusChanged(diff) {
  return Array.isArray(diff) && diff.some((d) => d.field === 'status');
}

function assigneeChange(diff) {
  if (!Array.isArray(diff)) return null;
  const d = diff.find((x) => x.field === 'assignee');
  return d ?? null;
}

function combineCandidates(candidates) {
  // candidates is an array of {userId, kind}; pick the highest-priority kind
  // per user.
  const best = new Map();
  for (const c of candidates) {
    const cur = best.get(c.userId);
    if (!cur || KIND_PRIORITY.indexOf(c.kind) < KIND_PRIORITY.indexOf(cur.kind)) {
      best.set(c.userId, c);
    }
  }
  return [...best.values()];
}

function persistNotifications(db, { issue, historyId, authorId, candidates }) {
  const merged = combineCandidates(candidates).filter(
    (c) => c.userId !== authorId && isProjectMember(db, issue.project_id, c.userId),
  );
  for (const c of merged) {
    if (!prefsDb.isEnabled(db, c.userId, c.kind)) continue;
    notificationsDb.insert(db, {
      userId: c.userId,
      issueId: issue.id,
      historyId,
      kind: c.kind,
    });
  }
}

function watcherIds(db, issue, excludeUserId) {
  const rows = watchersDb.listForIssue(db, issue.id);
  const out = [];
  for (const r of rows) {
    if (r.is_disabled) continue;
    if (r.user_id === excludeUserId) continue;
    if (!isProjectMember(db, issue.project_id, r.user_id)) continue;
    out.push(r.user_id);
  }
  return out;
}

function isProjectMember(db, projectId, userId) {
  return projectMembersDb.getRole(db, projectId, userId) != null;
}

// ---------- recordFor* — called inside the caller's transaction ----------

export function recordForCreation(db, { issue, authorId, historyId, mentionsText }) {
  // Auto-watch: author + assignee.
  watchersDb.add(db, issue.id, authorId);
  if (issue.assigned_to) watchersDb.add(db, issue.id, issue.assigned_to);

  const candidates = [];
  if (issue.assigned_to && issue.assigned_to !== authorId) {
    candidates.push({ userId: issue.assigned_to, kind: 'assigned_to_me' });
  }
  if (mentionsText) {
    const mentions = resolveMentions(db, issue.project_id, mentionsText);
    for (const m of mentions) candidates.push({ userId: m.userId, kind: 'mentioned' });
  }
  persistNotifications(db, { issue, historyId, authorId, candidates });
}

export function recordForChange(db, { issue, authorId, historyId, diff, mentionsText }) {
  // Auto-watch: author. Newly-set assignee also auto-watches.
  watchersDb.add(db, issue.id, authorId);
  const ac = assigneeChange(diff);
  if (ac && issue.assigned_to) watchersDb.add(db, issue.id, issue.assigned_to);

  const candidates = [];

  // Newly-assigned user is the priority recipient.
  if (ac && issue.assigned_to && issue.assigned_to !== authorId) {
    candidates.push({ userId: issue.assigned_to, kind: 'assigned_to_me' });
  }

  // Watchers receive a watched_* notification scaled by what changed.
  const watchKind = statusChanged(diff) ? 'watched_status_change' : 'watched_any_change';
  for (const id of watcherIds(db, issue, authorId)) {
    candidates.push({ userId: id, kind: watchKind });
  }

  if (mentionsText) {
    const mentions = resolveMentions(db, issue.project_id, mentionsText);
    for (const m of mentions) candidates.push({ userId: m.userId, kind: 'mentioned' });
  }

  persistNotifications(db, { issue, historyId, authorId, candidates });
}

export function recordForComment(db, { issue, authorId, historyId, body }) {
  watchersDb.add(db, issue.id, authorId);

  const candidates = [];

  // Assignee gets pulled in even if not watching.
  if (issue.assigned_to && issue.assigned_to !== authorId) {
    candidates.push({ userId: issue.assigned_to, kind: 'watched_any_change' });
  }

  for (const id of watcherIds(db, issue, authorId)) {
    candidates.push({ userId: id, kind: 'watched_any_change' });
  }

  if (body) {
    const mentions = resolveMentions(db, issue.project_id, body);
    for (const m of mentions) candidates.push({ userId: m.userId, kind: 'mentioned' });
  }

  persistNotifications(db, { issue, historyId, authorId, candidates });
}

// ---------- Drain ----------

let isDraining = false;

function actorDisplay(row) {
  return row.actor_name?.trim() || row.actor_email || 'Someone';
}

function issueRef(row) {
  return `[${row.project_name}] #${row.issue_number} ${row.issue_name}`;
}

function buildEmail(row) {
  const actor = actorDisplay(row);
  const url = `${config.baseUrl}/#/projects/${row.project_id}/issues/${row.issue_number}`;
  let subject;
  let body;
  switch (row.kind) {
    case 'assigned_to_me':
      subject = `${actor} assigned ${issueRef(row)} to you`;
      body = `${actor} assigned this issue to you.`;
      break;
    case 'mentioned':
      subject = `${actor} mentioned you on ${issueRef(row)}`;
      body =
        row.history_kind === 'comment'
          ? `${actor} mentioned you in a comment.`
          : `${actor} mentioned you on this issue.`;
      break;
    case 'watched_status_change':
      subject = `${actor} updated ${issueRef(row)}`;
      body = `${actor} changed the status of an issue you watch.`;
      break;
    case 'watched_any_change':
    default:
      subject = `${actor} updated ${issueRef(row)}`;
      body =
        row.history_kind === 'comment'
          ? `${actor} commented on an issue you watch.`
          : `${actor} updated an issue you watch.`;
      break;
  }
  if (row.history_note) {
    body += `\n\n${row.history_note.slice(0, 500)}`;
  }
  return emailService.notificationEmail({ subject, body, url });
}

export async function drainNotifications(dbArg, { batchLimit = 50, maxBatches = 5 } = {}) {
  const db = dbArg ?? getDb();
  if (isDraining) return { skipped: true };
  isDraining = true;
  let sent = 0;
  let failed = 0;
  try {
    for (let batch = 0; batch < maxBatches; batch++) {
      const rows = notificationsDb.listUnsent(db, batchLimit);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.is_disabled) {
          // Skip disabled accounts but mark so we don't retry forever.
          notificationsDb.markEmailed(db, row.id);
          continue;
        }
        if (!row.recipient_email) {
          notificationsDb.markEmailed(db, row.id);
          continue;
        }
        const tmpl = buildEmail(row);
        try {
          await emailService.send({ to: row.recipient_email, ...tmpl });
          notificationsDb.markEmailed(db, row.id);
          sent++;
        } catch (err) {
          logger.error('[notifications] email send failed', err.message ?? err);
          failed++;
          // Stop on first failure: leave row unsent for the next drain.
          return { sent, failed, aborted: true };
        }
      }
    }
  } finally {
    isDraining = false;
  }
  return { sent, failed };
}

export function kickDrain(db) {
  if (isDraining) return;
  setImmediate(() => {
    drainNotifications(db).catch((err) => {
      const msg = err?.message ?? String(err);
      // Seed scripts close their db handle right after writing — the deferred
      // drain then runs against a closed handle. Treat that as a no-op.
      if (msg.includes('database connection is not open')) return;
      logger.error('[notifications] drain failure', msg);
    });
  });
}

// Test hook.
export function _resetDrainLockForTests() {
  isDraining = false;
}
