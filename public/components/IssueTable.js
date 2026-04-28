import { h } from '../lib/state.js';

const COLUMNS = [
  { key: 'number', label: '#', sortable: true, sortAsc: 'number_asc', sortDesc: 'number_desc' },
  { key: 'name', label: 'Name', sortable: false },
  { key: 'status', label: 'Status', sortable: false },
  { key: 'priority', label: 'Priority', sortable: false },
  { key: 'assignee', label: 'Assignee', sortable: false },
  { key: 'updated', label: 'Updated', sortable: true, sortDesc: 'updated_desc' },
  { key: 'created', label: 'Created', sortable: true, sortDesc: 'created_desc' },
];

export function IssueTable({ items, projectId, sort, onSortChange }) {
  return h(
    'table',
    { class: 'issue-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...COLUMNS.map((col) => columnHeader(col, sort, onSortChange)),
      ),
    ),
    h(
      'tbody',
      {},
      ...items.map((issue) => issueRow(issue, projectId)),
    ),
  );
}

function columnHeader(col, sort, onSortChange) {
  if (!col.sortable) return h('th', { class: 'issue-th' }, col.label);

  const isAsc = col.sortAsc === sort;
  const isDesc = col.sortDesc === sort;
  const isActive = isAsc || isDesc;

  const onclick = () => {
    if (col.sortAsc && col.sortDesc) {
      onSortChange(isAsc ? col.sortDesc : col.sortAsc);
    } else if (col.sortDesc) {
      onSortChange(col.sortDesc);
    }
  };

  const indicator = isActive ? (isAsc ? ' ↑' : ' ↓') : '';

  return h(
    'th',
    {
      class: `issue-th sortable${isActive ? ' sortable-active' : ''}`,
      onclick,
      'aria-sort': isAsc ? 'ascending' : isDesc ? 'descending' : 'none',
    },
    col.label + indicator,
  );
}

function issueRow(issue, projectId) {
  const href = `#/projects/${projectId}/issues/${issue.number}`;
  const cls = `issue-row${issue.archived_at ? ' archived-row' : ''}`;
  const closed = issue.status?.is_closed;
  return h(
    'tr',
    { class: cls },
    h('td', { class: 'issue-num' }, h('a', { href }, `#${issue.number}`)),
    h('td', { class: 'issue-name' }, h('a', { href }, issue.name)),
    h(
      'td',
      { class: `issue-status${closed ? ' issue-status-closed' : ''}` },
      issue.status?.name ?? '—',
    ),
    h('td', {}, issue.priority?.name ?? '—'),
    h('td', {}, assigneeLabel(issue.assignee)),
    h('td', { class: 'issue-time' }, formatDate(issue.updated_at)),
    h('td', { class: 'issue-time' }, formatDate(issue.created_at)),
  );
}

function assigneeLabel(user) {
  if (!user) return '—';
  if (user.name && user.name.trim()) return user.name;
  return user.email;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
