import { h } from '../lib/state.js';
import { getJson, postJson } from '../lib/api.js';
import { formatRelative } from '../lib/relativeTime.js';

const KIND_LABEL = {
  assigned_to_me: 'Assigned to you',
  mentioned: 'Mentioned you',
  watched_status_change: 'Status changed',
  watched_any_change: 'Updated',
};

export function NotificationBell() {
  const wrapper = h('div', { class: 'notif-bell' });
  let open = false;
  let panel = null;

  const badge = h('span', { class: 'notif-bell-badge', hidden: true }, '0');
  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'notif-bell-trigger',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Notifications',
      title: 'Notifications',
      onClick: () => (open ? close() : show()),
    },
    h('span', { class: 'notif-bell-icon', 'aria-hidden': 'true' }, '🔔'),
    badge,
  );

  function setUnread(n) {
    const count = Number(n) || 0;
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.hidden = true;
    }
  }

  async function refreshCount() {
    try {
      const res = await getJson('/api/me/notifications?unread=1&limit=1');
      setUnread(res.unreadCount);
    } catch {
      /* silent */
    }
  }

  async function show() {
    open = true;
    trigger.setAttribute('aria-expanded', 'true');
    panel = buildPanel();
    wrapper.appendChild(panel);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    await loadList();
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
    const list = h('div', { class: 'notif-list' }, h('div', { class: 'notif-empty' }, 'Loading…'));
    const footer = h(
      'div',
      { class: 'notif-footer' },
      h(
        'button',
        {
          type: 'button',
          class: 'notif-mark-all',
          onClick: async () => {
            try {
              await postJson('/api/me/notifications/read-all', {});
              setUnread(0);
              await loadList();
            } catch {
              /* silent */
            }
          },
        },
        'Mark all read',
      ),
      h(
        'a',
        { class: 'notif-settings-link', href: '#/me?tab=notifications', onClick: () => close() },
        'Settings',
      ),
    );
    return h(
      'div',
      { class: 'notif-panel', role: 'menu' },
      h('div', { class: 'notif-header' }, 'Notifications'),
      list,
      footer,
    );
  }

  async function loadList() {
    if (!panel) return;
    const list = panel.querySelector('.notif-list');
    let res;
    try {
      res = await getJson('/api/me/notifications?limit=20');
    } catch {
      list.replaceChildren(h('div', { class: 'notif-empty' }, 'Failed to load.'));
      return;
    }
    setUnread(res.unreadCount);
    if (!res.items || res.items.length === 0) {
      list.replaceChildren(h('div', { class: 'notif-empty' }, 'No notifications yet.'));
      return;
    }
    const rows = res.items.map((n) => renderRow(n));
    list.replaceChildren(...rows);
  }

  function renderRow(n) {
    const issueRef = `#${n.issue_number} ${n.issue_name}`;
    const actor = n.actor_name?.trim() || n.actor_email || 'Someone';
    const isUnread = !n.read_at;
    const row = h(
      'a',
      {
        class: `notif-row${isUnread ? ' notif-row-unread' : ''}`,
        href: `#/projects/${n.project_id}/issues/${n.issue_number}`,
        role: 'menuitem',
        onClick: async (e) => {
          // Allow native nav, but still mark read in the background.
          if (isUnread) {
            try {
              const r = await postJson(`/api/me/notifications/${n.id}/read`, {});
              setUnread(r.unreadCount);
            } catch {
              /* silent */
            }
          }
          // Close even if same route — the user expects the dropdown to dismiss.
          close();
          // If we're already on the destination route, the click won't trigger
          // hashchange; that's fine — the user is already there.
          void e;
        },
      },
      h('span', { class: 'notif-row-kind' }, KIND_LABEL[n.kind] ?? n.kind),
      h('span', { class: 'notif-row-issue' }, issueRef),
      h('span', { class: 'notif-row-actor' }, actor),
      h('span', { class: 'notif-row-time' }, formatRelative(n.created_at)),
    );
    return row;
  }

  // Refresh badge on route changes — cheap and replaces a polling loop.
  window.addEventListener('hashchange', () => {
    refreshCount();
  });

  wrapper.appendChild(trigger);
  // Kick off the initial fetch.
  refreshCount();
  return wrapper;
}
