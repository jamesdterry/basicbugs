import { h, state } from '../../lib/state.js';
import { showToast } from '../../components/Toast.js';
import { navigate } from '../../lib/router.js';

const NAV_ITEMS = [
  { key: 'adminUsers', href: '#/admin/users', label: 'Users' },
  { key: 'adminProjects', href: '#/admin/projects', label: 'Projects' },
  { key: 'adminSessions', href: '#/admin/sessions', label: 'Sessions' },
  { key: 'adminAudit', href: '#/admin/audit', label: 'Audit' },
  { key: 'adminSystem', href: '#/admin/system', label: 'System' },
  { key: 'adminErrors', href: '#/admin/errors', label: 'Errors' },
];

export function adminShell({ active, eyebrow, title, body }) {
  if (!state.currentUser?.isSuperAdmin) {
    queueMicrotask(() => {
      showToast('Forbidden', 'error');
      navigate('#/');
    });
    return h('section', { class: 'view' }, h('p', { class: 'muted' }, 'Redirecting…'));
  }

  const nav = h(
    'nav',
    { class: 'admin-nav', 'aria-label': 'Admin navigation' },
    ...NAV_ITEMS.map((item) =>
      h(
        'a',
        {
          class: `admin-nav-item${item.key === active ? ' is-active' : ''}`,
          href: item.href,
        },
        item.label,
      ),
    ),
  );

  const content = h(
    'div',
    { class: 'admin-content' },
    h(
      'header',
      { class: 'view-header' },
      eyebrow ? h('p', { class: 'view-eyebrow' }, eyebrow) : null,
      h('h1', {}, title),
    ),
    body,
  );

  return h(
    'section',
    { class: 'view view-admin' },
    h('div', { class: 'admin-shell' }, nav, content),
  );
}
