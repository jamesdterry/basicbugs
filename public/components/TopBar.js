import { h } from '../lib/state.js';
import { postJson } from '../lib/api.js';
import { showToast } from './Toast.js';

export function TopBar({ user }) {
  const brand = h(
    'a',
    { class: 'topbar-brand', href: '#/', 'aria-label': 'Basic Bugs home' },
    'Basic Bugs',
  );

  const nameEl = h('span', { class: 'topbar-name' }, user?.name ?? user?.email ?? '');
  const userBadge = user?.isSuperAdmin
    ? h('span', { class: 'role-badge role-badge-admin', title: 'Super admin' }, 'admin')
    : null;

  const logoutBtn = h(
    'button',
    {
      type: 'button',
      class: 'topbar-logout',
      onClick: async () => {
        logoutBtn.disabled = true;
        try {
          await postJson('/auth/logout', {});
          location.href = '/login.html';
        } catch {
          logoutBtn.disabled = false;
          showToast('Logout failed. Try again.', 'error');
        }
      },
    },
    'Sign out',
  );

  const right = h('div', { class: 'topbar-right' }, nameEl, userBadge, logoutBtn);

  return h('div', { class: 'topbar-inner' }, brand, right);
}
