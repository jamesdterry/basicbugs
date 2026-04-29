import { h } from '../../lib/state.js';
import { getJson, qs } from '../../lib/api.js';
import { adminShell } from './shell.js';

export function adminErrorsView() {
  let items = [];
  let total = 0;
  let before = null;

  const body = h('div');
  const view = adminShell({
    active: 'adminErrors',
    title: 'Errors',
    body,
  });

  const summary = h('p', { class: 'muted' }, '');
  const tableHost = h('div');
  const pager = h('div', { class: 'admin-toolbar' });
  body.append(summary, tableHost, pager);

  async function reload(opts = {}) {
    try {
      const url = `/api/admin/errors${qs({ before: opts.before ?? undefined })}`;
      const res = await getJson(url);
      items = res.errors ?? [];
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
      ? `${total} error${total === 1 ? '' : 's'} captured (5xx + unhandled, 30-day retention).`
      : 'No errors captured. Anything 5xx or unhandled appears here.';

    if (!items.length) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, 'Nothing to show.'));
      pager.replaceChildren();
      return;
    }

    const rows = items.map((e) =>
      h(
        'tr',
        {},
        h('td', {}, formatDate(e.created_at)),
        h('td', {}, e.method ?? '—'),
        h('td', { class: 'admin-table-mono' }, truncate(e.route ?? '—', 60)),
        h('td', {}, String(e.status ?? '—')),
        h('td', {}, e.user_id ? `#${e.user_id}` : '—'),
        h(
          'td',
          {},
          h(
            'details',
            {},
            h('summary', {}, truncate(e.message ?? '(no message)', 80)),
            e.stack
              ? h('pre', { class: 'admin-error-stack' }, e.stack)
              : null,
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
            h('th', {}, 'When'),
            h('th', {}, 'Method'),
            h('th', {}, 'Route'),
            h('th', {}, 'Status'),
            h('th', {}, 'User'),
            h('th', {}, 'Message / stack'),
          ),
        ),
        h('tbody', {}, rows),
      ),
    );

    const oldestId = items[items.length - 1].id;
    const hasMore = items.length >= 50 && oldestId > 1;
    const buttons = [];
    if (before !== null) {
      buttons.push(
        h(
          'button',
          {
            type: 'button',
            class: 'modal-btn',
            onClick: () => reload(),
          },
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

function truncate(s, len) {
  if (!s) return '—';
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}
