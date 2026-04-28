import { h } from '../../lib/state.js';
import { getJson, deleteJson, qs } from '../../lib/api.js';
import { showToast } from '../../components/Toast.js';
import { adminShell } from './shell.js';

export function adminSessionsView(params) {
  let sessions = [];
  const userId = params.query?.userId ? Number.parseInt(params.query.userId, 10) : null;

  const body = h('div');
  const view = adminShell({
    active: 'adminSessions',
    title: userId ? `Sessions — user #${userId}` : 'Sessions',
    body,
  });

  const tableHost = h('div');
  body.appendChild(tableHost);

  async function reload() {
    try {
      const url = `/api/admin/sessions${qs({ userId })}`;
      const res = await getJson(url);
      sessions = res.sessions ?? [];
      render();
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, `Load failed: ${err?.message ?? 'unknown'}`));
    }
  }

  function render() {
    if (!sessions.length) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, 'No active sessions.'));
      return;
    }
    const rows = sessions.map((s) =>
      h(
        'tr',
        {},
        h(
          'td',
          {},
          (s.name || s.email) +
            (s.is_current ? '' : ''),
          s.is_current ? h('span', { class: 'role-badge role-badge-admin' }, 'this session') : null,
        ),
        h('td', {}, s.email),
        h('td', {}, formatDate(s.created_at)),
        h('td', {}, formatDate(s.last_seen_at)),
        h('td', {}, truncate(s.user_agent ?? '', 50)),
        h(
          'td',
          { class: 'admin-table-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn icon-btn-danger',
              disabled: s.is_current,
              title: s.is_current ? 'Sign out from the menu instead' : 'Revoke',
              onClick: async () => {
                try {
                  await deleteJson(`/api/admin/sessions/${encodeURIComponent(s.id)}`);
                  showToast('Session revoked', 'info');
                  reload();
                } catch (err) {
                  showToast(err?.message ?? 'Revoke failed', 'error');
                }
              },
            },
            'Revoke',
          ),
        ),
      ),
    );
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
            h('th', {}, 'User'),
            h('th', {}, 'Email'),
            h('th', {}, 'Created'),
            h('th', {}, 'Last seen'),
            h('th', {}, 'Device'),
            h('th', {}, ''),
          ),
        ),
        h('tbody', {}, rows),
      ),
    );
  }

  reload();
  return view;
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}

function truncate(s, len) {
  if (!s) return '—';
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}
