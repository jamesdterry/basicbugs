import { h } from '../lib/state.js';
import { formatRelative, formatAbsolute } from '../lib/relativeTime.js';

const FIELD_LABELS = Object.freeze({
  name: 'Name',
  description: 'Description',
  status: 'Status',
  category: 'Category',
  priority: 'Priority',
  assignee: 'Assignee',
});

export function HistoryTimeline({ events }) {
  if (!events || events.length === 0) {
    return h('p', { class: 'history-empty muted' }, 'No history yet.');
  }
  return h('ol', { class: 'history-timeline' }, ...events.map((e) => h('li', {}, eventCard(e))));
}

function eventCard(event) {
  return h(
    'article',
    { class: `history-event history-event-${event.kind}` },
    headerLine(event),
    bodyForKind(event),
  );
}

function headerLine(event) {
  const author = displayName(event.user);
  const verb = verbForKind(event.kind);
  return h(
    'header',
    { class: 'history-event-header' },
    h('span', { class: 'history-author' }, author),
    h('span', { class: 'history-verb muted' }, ` ${verb} `),
    h(
      'time',
      {
        class: 'history-time muted',
        datetime: event.changed_at ?? '',
        title: formatAbsolute(event.changed_at),
      },
      formatRelative(event.changed_at),
    ),
  );
}

function verbForKind(kind) {
  switch (kind) {
    case 'creation':
      return 'created this issue';
    case 'comment':
      return 'commented';
    case 'change':
      return 'made changes';
    default:
      return kind;
  }
}

function bodyForKind(event) {
  if (event.kind === 'comment') {
    return h('div', { class: 'history-body history-comment' }, multilineText(event.note));
  }
  if (event.kind === 'creation') {
    if (!event.note) return null;
    return h('div', { class: 'history-body history-note' }, multilineText(event.note));
  }
  // change
  const rows = (event.changes ?? []).map((c) => changeRow(c));
  return h(
    'div',
    { class: 'history-body history-change' },
    rows.length ? h('ul', { class: 'history-change-list' }, ...rows) : null,
    event.note ? h('div', { class: 'history-note' }, multilineText(event.note)) : null,
  );
}

function changeRow(change) {
  const label = FIELD_LABELS[change.field] ?? change.field;
  return h(
    'li',
    { class: 'history-change-row' },
    h('span', { class: 'history-change-field' }, `${label}: `),
    h('span', { class: 'history-change-old' }, displayValue(change.old_value)),
    h('span', { class: 'history-change-arrow muted' }, ' → '),
    h('span', { class: 'history-change-new' }, displayValue(change.new_value)),
  );
}

function displayValue(value) {
  if (value == null || value === '') return '—';
  return value;
}

function displayName(user) {
  if (!user) return 'Unknown';
  if (user.name && user.name.trim()) return user.name;
  return user.email ?? 'Unknown';
}

function multilineText(text) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(document.createTextNode(lines[i]));
    if (i < lines.length - 1) out.push(h('br', {}));
  }
  return out;
}
