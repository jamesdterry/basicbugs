import * as adminAuditDb from '../db/adminAudit.js';

// Call this inside the same db.transaction(...) as the admin mutation so the
// audit row commits atomically with the change. `req` carries the actor.
export function log(db, req, { action, targetType, targetId, payload }) {
  const actorId = req?.user?.id;
  if (!actorId) {
    throw new Error('admin audit log requires authenticated req.user');
  }
  return adminAuditDb.record(db, {
    actorId,
    action,
    targetType,
    targetId,
    payload,
  });
}
