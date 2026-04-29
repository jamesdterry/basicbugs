import { h } from '../../lib/state.js';
import { getJson, qs } from '../../lib/api.js';
import { adminShell } from './shell.js';

export function adminAuditView() {
  let entries = [];
  let total = 0;
  let before = null;

  const body = h('div');
  const view = adminShell({
    active: 'adminAudit',
    title: 'Audit log',
    body,
  });

  const summary = h('p', { class: 'muted' }, '');
  const tableHost = h('div');
  const pager = h('div', { class: 'admin-toolbar' });
  body.append(summary, tableHost, pager);

  async function reload(opts = {}) {
    try {
      const url = `/api/admin/audit${qs({ before: opts.before ?? undefined })}`;
      const res = await getJson(url);
      entries = res.entries ?? [];
      total = res.total ?? 0;
      before = opts.before ?? null;
      render();
    } catch (err) {
      tableHost.replaceChildren(
        h('p', { class: 'muted' }, `Load failed: ${err?.message ?? 'unknown'}`),
      );
    }
  }

  function render() {
    summary.textContent = total
      ? `${total} super-admin action${total === 1 ? '' : 's'} recorded.`
      : 'No admin actions recorded yet.';

    if (!entries.length) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, 'Nothing to show.'));
      pager.replaceChildren();
      return;
    }

    const rows = entries.map((e) => {
      const target = e.target_type
        ? `${e.target_type}${e.target_id ? ` #${e.target_id}` : ''}`
        : '—';
      const actor = e.actor_name || e.actor_email || `#${e.super_admin_user_id}`;
      return h(
        'tr',
        {},
        h('td', {}, formatDate(e.created_at)),
        h('td', {}, actor),
        h('td', { class: 'admin-table-mono' }, e.action),
        h('td', {}, target),
        h(
          'td',
          {},
          e.payload_json
            ? h(
                'details',
                {},
                h('summary', {}, 'payload'),
                h('pre', { class: 'admin-error-stack' }, prettyJson(e.payload_json)),
              )
            : '—',
        ),
      );
    });

    tableHost.replaceChildren(
      h(
        'table',
        { class: 'admin-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'When'),
            h('th', {}, 'Actor'),
            h('th', {}, 'Action'),
            h('th', {}, 'Target'),
            h('th', {}, 'Payload'),
          ),
        ),
        h('tbody', {}, rows),
      ),
    );

    const oldestId = entries[entries.length - 1].id;
    const hasMore = entries.length >= 50 && oldestId > 1;
    const buttons = [];
    if (before !== null) {
      buttons.push(
        h(
          'button',
          { type: 'button', class: 'modal-btn', onClick: () => reload() },
          'Newest',
        ),
      );
    }
    if (hasMore) {
      buttons.push(
        h(
          'button',
          {
            type: 'button',
            class: 'modal-btn',
            onClick: () => reload({ before: oldestId }),
          },
          'Older →',
        ),
      );
    }
    pager.replaceChildren(...buttons);
  }

  reload();
  return view;
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}

function prettyJson(s) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
