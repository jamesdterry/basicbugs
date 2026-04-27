export const DEFAULT_STATUSES = Object.freeze([
  Object.freeze({ name: 'Open', sort_order: 1, is_default: 1, is_closed: 0 }),
  Object.freeze({ name: 'In Progress', sort_order: 2, is_default: 0, is_closed: 0 }),
  Object.freeze({ name: 'Blocked', sort_order: 3, is_default: 0, is_closed: 0 }),
  Object.freeze({ name: 'Resolved', sort_order: 4, is_default: 0, is_closed: 1 }),
  Object.freeze({ name: 'Closed', sort_order: 5, is_default: 0, is_closed: 1 }),
  Object.freeze({ name: 'Reopened', sort_order: 6, is_default: 0, is_closed: 0 }),
]);

export const DEFAULT_CATEGORIES = Object.freeze([
  Object.freeze({ name: 'Bug', sort_order: 1, is_default: 1 }),
  Object.freeze({ name: 'Feature', sort_order: 2, is_default: 0 }),
  Object.freeze({ name: 'Task', sort_order: 3, is_default: 0 }),
]);

export const DEFAULT_PRIORITIES = Object.freeze([
  Object.freeze({ name: 'Critical', sort_order: 1, is_default: 0 }),
  Object.freeze({ name: 'High', sort_order: 2, is_default: 0 }),
  Object.freeze({ name: 'Medium', sort_order: 3, is_default: 1 }),
  Object.freeze({ name: 'Low', sort_order: 4, is_default: 0 }),
  Object.freeze({ name: 'Trivial', sort_order: 5, is_default: 0 }),
]);
