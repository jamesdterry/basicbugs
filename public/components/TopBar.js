import { h } from '../lib/state.js';
import { postJson } from '../lib/api.js';
import { showToast } from './Toast.js';
import { NotificationBell } from './NotificationBell.js';

export function TopBar({ user }) {
  const brand = h(
    'a',
    { class: 'topbar-brand', href: '#/', 'aria-label': 'Basic Bugs home' },
    'Basic Bugs',
  );

  const adminBadge = user?.isSuperAdmin
    ? h('span', { class: 'role-badge role-badge-admin', title: 'Super admin' }, 'admin')
    : null;

  const bell = NotificationBell();
  const menu = userMenu(user);

  const right = h('div', { class: 'topbar-right' }, adminBadge, bell, menu);

  return h('div', { class: 'topbar-inner' }, brand, right);
}

function userMenu(user) {
  const wrapper = h('div', { class: 'user-menu' });
  let open = false;

  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'user-menu-trigger',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick: () => {
        if (open) close();
        else show();
      },
    },
    h('span', { class: 'topbar-name' }, user?.name ?? user?.email ?? ''),
    h('span', { class: 'user-menu-caret', 'aria-hidden': 'true' }, '▾'),
  );

  let panel = null;

  function show() {
    open = true;
    trigger.setAttribute('aria-expanded', 'true');
    panel = buildPanel();
    wrapper.appendChild(panel);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
  }

  function close() {
    open = false;
    trigger.setAttribute('aria-expanded', 'false');
    if (panel) {
      panel.remove();
      panel = null;
    }
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey);
  }

  function onDocClick(e) {
    if (!wrapper.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function buildPanel() {
    const items = [];
    items.push(
      h(
        'a',
        {
          class: 'user-menu-item',
          href: '#/me',
          role: 'menuitem',
          onClick: () => close(),
        },
        'Profile',
      ),
    );
    if (user?.isSuperAdmin) {
      items.push(
        h(
          'a',
          {
            class: 'user-menu-item',
            href: '#/admin/users',
            role: 'menuitem',
            onClick: () => close(),
          },
          'Admin',
        ),
      );
    }
    items.push(h('hr', { class: 'user-menu-divider' }));
    items.push(
      h(
        'button',
        {
          type: 'button',
          class: 'user-menu-item',
          role: 'menuitem',
          onClick: async () => {
            close();
            try {
              await postJson('/auth/logout', {});
              location.href = '/login.html';
            } catch {
              showToast('Logout failed. Try again.', 'error');
            }
          },
        },
        'Sign out',
      ),
    );
    return h('div', { class: 'user-menu-panel', role: 'menu' }, ...items);
  }

  wrapper.appendChild(trigger);
  return wrapper;
}
