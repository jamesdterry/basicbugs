// Shared mapping from service-error `code` strings to HTTP status codes.
// Routes call `handleError(res, next, err)` so unknown errors fall through to
// the global error handler in app.js.

export const STATUS_FOR_CODE = Object.freeze({
  // Validation
  invalid_name: 400,
  invalid_role: 400,
  invalid_sort_order: 400,
  invalid_field: 400,
  invalid_filter: 400,
  invalid_description: 400,
  invalid_note: 400,
  invalid_body: 400,
  invalid_status: 400,
  invalid_category: 400,
  invalid_priority: 400,
  invalid_assignee: 400,

  // Auth
  forbidden: 403,

  // Not found / mask existence
  invalid_kind: 404,
  not_found: 404,
  project_not_found: 404,
  user_not_found: 404,
  not_a_member: 404,

  // Conflict / invariants
  project_archived: 409,
  duplicate_member: 409,
  duplicate_name: 409,
  cannot_archive_default: 409,
  cannot_archive_only_remaining: 409,
  cannot_default_archived: 409,
  no_default_statuses: 409,
  no_default_categories: 409,
  no_default_priorities: 409,
  assignee_not_member: 409,
  archived_metadata: 409,
});

export function handleError(res, next, err) {
  const status = STATUS_FOR_CODE[err?.code];
  if (status) return res.status(status).json({ error: err.code });
  return next(err);
}
