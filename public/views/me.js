import { h, set, state } from '../lib/state.js';
import { getJson, patchJson, postJson, deleteJson } from '../lib/api.js';
import { showToast } from '../components/Toast.js';
import { openModal } from '../components/Modal.js';

function relativeOrAbsolute(date) {
  if (!date) return '—';
  const d = new Date(date.includes('T') ? date : date.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}

export function meView() {
  const view = h(
    'section',
    { class: 'view view-me' },
    h(
      'header',
      { class: 'view-header' },
      h('p', { class: 'view-eyebrow' }, h('a', { href: '#/' }, '← Back to projects')),
      h('h1', {}, 'Your profile'),
    ),
  );

  const content = h('div', { class: 'me-content' }, h('p', { class: 'muted' }, 'Loading…'));
  view.appendChild(content);

  let me = null;
  let sessions = [];

  async function load() {
    try {
      const [profileRes, sessionsRes] = await Promise.all([
        getJson('/api/me'),
        getJson('/api/me/sessions'),
      ]);
      me = profileRes.user;
      sessions = sessionsRes.sessions ?? [];
      render();
    } catch (err) {
      content.replaceChildren(h('p', { class: 'muted' }, `Could not load: ${err?.message ?? 'unknown'}`));
    }
  }

  function render() {
    content.replaceChildren(
      profileSection(me),
      passwordSection(me),
      sessionsSection(sessions, load),
    );
  }

  load();
  return view;
}

function profileSection(me) {
  const nameInput = h('input', {
    type: 'text',
    class: 'field-input',
    value: me.name ?? '',
    maxlength: '80',
    'aria-label': 'Display name',
  });
  const saveBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: async () => {
        const name = nameInput.value.trim().replace(/\s+/g, ' ');
        if (!name) {
          showToast('Name cannot be empty', 'error');
          return;
        }
        saveBtn.disabled = true;
        try {
          const res = await patchJson('/api/me', { name });
          showToast('Profile updated', 'info');
          if (state.currentUser) {
            set({ currentUser: { ...state.currentUser, name: res.user?.name ?? name } });
          }
        } catch (err) {
          showToast(err?.message ?? 'Save failed', 'error');
        } finally {
          saveBtn.disabled = false;
        }
      },
    },
    'Save',
  );

  return h(
    'section',
    { class: 'me-section' },
    h('h2', {}, 'Profile'),
    h(
      'div',
      { class: 'me-form' },
      h('label', {}, 'Email'),
      h('p', { class: 'muted' }, me.email),
      h('label', { for: 'me-name' }, 'Name'),
      nameInput,
    ),
    h('div', { class: 'admin-toolbar' }, saveBtn),
  );
}

function passwordSection(me) {
  const hasPassword = !!me.has_password;
  const currentInput = h('input', {
    type: 'password',
    class: 'field-input',
    autocomplete: 'current-password',
    'aria-label': 'Current password',
  });
  const newInput = h('input', {
    type: 'password',
    class: 'field-input',
    autocomplete: 'new-password',
    'aria-label': 'New password',
  });
  const confirmInput = h('input', {
    type: 'password',
    class: 'field-input',
    autocomplete: 'new-password',
    'aria-label': 'Confirm new password',
  });
  const submitBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: async () => {
        const currentPassword = hasPassword ? currentInput.value : null;
        const newPassword = newInput.value;
        const confirm = confirmInput.value;
        if (newPassword !== confirm) {
          showToast('New passwords do not match', 'error');
          return;
        }
        if (newPassword.length < 10) {
          showToast('New password must be at least 10 characters', 'error');
          return;
        }
        submitBtn.disabled = true;
        try {
          await postJson('/api/me/password', {
            currentPassword,
            newPassword,
          });
          showToast('Password updated', 'info');
          if (currentInput) currentInput.value = '';
          newInput.value = '';
          confirmInput.value = '';
        } catch (err) {
          showToast(err?.message ?? 'Update failed', 'error');
        } finally {
          submitBtn.disabled = false;
        }
      },
    },
    hasPassword ? 'Change password' : 'Set password',
  );

  const fields = [];
  if (hasPassword) {
    fields.push(h('label', {}, 'Current password'), currentInput);
  } else {
    fields.push(
      h(
        'p',
        { class: 'muted' },
        'No password set. Setting one lets you log in without the magic-link email.',
      ),
    );
  }
  fields.push(
    h('label', {}, 'New password'),
    newInput,
    h('label', {}, 'Confirm new password'),
    confirmInput,
  );

  return h(
    'section',
    { class: 'me-section' },
    h('h2', {}, 'Password'),
    h('div', { class: 'me-form' }, ...fields),
    h('div', { class: 'admin-toolbar' }, submitBtn),
  );
}

function sessionsSection(sessions, reload) {
  const rows = sessions.map((s) => {
    const isCurrent = s.is_current;
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        s.user_agent ? truncate(s.user_agent, 60) : 'Unknown device',
        isCurrent ? h('span', { class: 'role-badge role-badge-admin' }, 'this session') : null,
      ),
      h('td', {}, relativeOrAbsolute(s.created_at)),
      h('td', {}, relativeOrAbsolute(s.last_seen_at)),
      h(
        'td',
        { class: 'admin-table-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn-danger',
            disabled: isCurrent,
            title: isCurrent ? 'Use Sign out for this session' : 'Revoke this session',
            onClick: async () => {
              try {
                await deleteJson(`/api/me/sessions/${encodeURIComponent(s.id)}`);
                reload();
              } catch (err) {
                showToast(err?.message ?? 'Revoke failed', 'error');
              }
            },
          },
          'Revoke',
        ),
      ),
    );
  });

  const revokeAll = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-danger',
      onClick: () =>
        openModal({
          title: 'Revoke other sessions?',
          body: 'Sign out of every browser except this one.',
          actions: [
            { label: 'Cancel' },
            {
              label: 'Revoke others',
              kind: 'danger',
              onClick: async (close) => {
                try {
                  await postJson('/api/me/sessions/revoke-others');
                  close();
                  showToast('Other sessions revoked', 'info');
                  reload();
                } catch (err) {
                  showToast(err?.message ?? 'Failed', 'error');
                }
              },
            },
          ],
        }),
    },
    'Revoke all others',
  );

  return h(
    'section',
    { class: 'me-section' },
    h('h2', {}, 'Active sessions'),
    h(
      'table',
      { class: 'admin-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Device'),
          h('th', {}, 'Created'),
          h('th', {}, 'Last seen'),
          h('th', {}, ''),
        ),
      ),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '4', class: 'muted' }, 'No sessions.'))),
    ),
    h('div', { class: 'admin-toolbar' }, revokeAll),
  );
}

function truncate(s, len) {
  if (!s) return s;
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}
