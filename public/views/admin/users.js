import { h } from '../../lib/state.js';
import { getJson, postJson, patchJson, qs } from '../../lib/api.js';
import { showToast } from '../../components/Toast.js';
import { openModal } from '../../components/Modal.js';
import { openMembershipsModal } from '../../components/MembershipsModal.js';
import { adminShell } from './shell.js';
import { debounce } from '../../lib/debounce.js';

export function adminUsersView(params) {
  let users = [];
  let search = params.query?.search ?? '';

  const body = h('div');
  const view = adminShell({
    active: 'adminUsers',
    title: 'Users',
    body,
  });

  if (!body.parentNode && !view.contains(body)) {
    return view;
  }

  const searchInput = h('input', {
    type: 'search',
    class: 'field-input',
    placeholder: 'Search by name or email',
    value: search,
    'aria-label': 'Search users',
  });

  const inviteBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: () => openInviteModal(reload),
    },
    'Invite user',
  );

  const toolbar = h('div', { class: 'admin-toolbar' }, searchInput, inviteBtn);
  const tableHost = h('div');
  body.append(toolbar, tableHost);

  const reloadDebounced = debounce(() => reload(), 200);
  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    reloadDebounced();
  });

  async function reload() {
    try {
      const url = `/api/admin/users${qs({ search: search || null })}`;
      const res = await getJson(url);
      users = res.users ?? [];
      render();
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, `Load failed: ${err?.message ?? 'unknown'}`));
    }
  }

  function render() {
    if (!users.length) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, 'No users.'));
      return;
    }
    const rows = users.map((u) => userRow(u, reload));
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
            h('th', {}, 'Name'),
            h('th', {}, 'Email'),
            h('th', {}, 'Last login'),
            h('th', {}, 'Status'),
            h('th', {}, 'Actions'),
          ),
        ),
        h('tbody', {}, rows),
      ),
    );
  }

  reload();
  return view;
}

function userRow(user, reload) {
  const nameCell = h(
    'td',
    {},
    h(
      'button',
      {
        type: 'button',
        class: 'rename-display',
        onClick: () => openEditUserModal(user, reload),
      },
      user.name || h('span', { class: 'muted' }, '(no name)'),
    ),
  );

  const statusCell = h(
    'td',
    {},
    user.is_disabled
      ? h('span', { class: 'role-badge', title: 'Disabled' }, 'disabled')
      : user.is_super_admin
        ? h('span', { class: 'role-badge role-badge-admin' }, 'admin')
        : h('span', { class: 'role-badge' }, 'active'),
  );

  const actions = h(
    'td',
    { class: 'admin-table-actions' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        onClick: () => openMembershipsModal({ user, onChanged: reload }),
      },
      'Memberships',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        onClick: () => sendMagicLink(user),
      },
      'Magic link',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        onClick: () => sendReset(user),
      },
      'Send reset',
    ),
    user.is_disabled
      ? h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            onClick: async () => {
              try {
                await postJson(`/api/admin/users/${user.id}/enable`);
                showToast('User enabled', 'info');
                reload();
              } catch (err) {
                showToast(err?.message ?? 'Failed', 'error');
              }
            },
          },
          'Enable',
        )
      : h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn-danger',
            onClick: () => disableUser(user, reload),
          },
          'Disable',
        ),
  );

  return h(
    'tr',
    {},
    nameCell,
    h('td', {}, user.email),
    h('td', {}, formatDate(user.last_login_at)),
    statusCell,
    actions,
  );
}

function openEditUserModal(user, reload) {
  const nameInput = h('input', {
    type: 'text',
    class: 'field-input',
    value: user.name ?? '',
    maxlength: '80',
    'aria-label': 'Display name',
  });
  const emailInput = h('input', {
    type: 'email',
    class: 'field-input',
    value: user.email ?? '',
    maxlength: '254',
    'aria-label': 'Email',
    disabled: user.is_super_admin,
  });
  const body = h(
    'div',
    { class: 'me-form' },
    h('label', {}, 'Name'),
    nameInput,
    h('label', {}, 'Email'),
    emailInput,
  );
  if (user.is_super_admin) {
    body.append(
      h('p', { class: 'muted' }, "The super-admin's email is set via SUPER_ADMIN_EMAIL and cannot be changed here."),
    );
  }
  openModal({
    title: 'Edit user',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        kind: 'primary',
        onClick: async (close) => {
          const name = nameInput.value.trim().replace(/\s+/g, ' ');
          const email = emailInput.value.trim().toLowerCase();
          if (!name) {
            showToast('Name cannot be empty', 'error');
            return;
          }
          if (!email) {
            showToast('Email cannot be empty', 'error');
            return;
          }
          const payload = {};
          if (name !== (user.name ?? '')) payload.name = name;
          if (!user.is_super_admin && email !== (user.email ?? '').toLowerCase()) {
            payload.email = email;
          }
          if (!Object.keys(payload).length) {
            close();
            return;
          }
          try {
            await patchJson(`/api/admin/users/${user.id}`, payload);
            close();
            showToast('Saved', 'info');
            reload();
          } catch (err) {
            showToast(editUserErrorMessage(err), 'error');
          }
        },
      },
    ],
  });
  queueMicrotask(() => nameInput.focus());
}

function editUserErrorMessage(err) {
  switch (err?.message) {
    case 'invalid_email':
      return 'Invalid email';
    case 'duplicate_email':
      return 'Email already in use';
    case 'invalid_name':
      return 'Invalid name';
    case 'forbidden':
      return "Cannot change the super-admin's email";
    default:
      return err?.message ?? 'Save failed';
  }
}

async function openInviteModal(reload) {
  let projects = [];
  try {
    projects = (await getJson('/api/projects?includeArchived=0')).projects ?? [];
  } catch {
    /* invite still works without project list */
  }

  const emailInput = h('input', {
    type: 'email',
    class: 'field-input',
    placeholder: 'user@example.com',
    'aria-label': 'Email',
  });
  const nameInput = h('input', {
    type: 'text',
    class: 'field-input',
    placeholder: 'Optional',
    'aria-label': 'Name (optional)',
  });
  const projectSelect = h(
    'select',
    { class: 'field-input', 'aria-label': 'Project' },
    h('option', { value: '' }, 'No project — add later'),
    ...projects
      .filter((p) => !p.archived_at)
      .map((p) => h('option', { value: String(p.id) }, p.name)),
  );
  const roleSelect = h(
    'select',
    { class: 'field-input', 'aria-label': 'Role', disabled: true },
    h('option', { value: 'viewer' }, 'viewer'),
    h('option', { value: 'user', selected: true }, 'user'),
    h('option', { value: 'developer' }, 'developer'),
  );
  projectSelect.addEventListener('change', () => {
    roleSelect.disabled = !projectSelect.value;
  });

  openModal({
    title: 'Invite user',
    body: h(
      'div',
      { class: 'me-form' },
      h('label', {}, 'Email'),
      emailInput,
      h('label', {}, 'Name (optional)'),
      nameInput,
      h('label', {}, 'Project'),
      projectSelect,
      h('label', {}, 'Role'),
      roleSelect,
      h(
        'p',
        { class: 'muted' },
        'A magic-link sign-in email will be sent. The user can set a password from their profile.',
      ),
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Send invite',
        kind: 'primary',
        onClick: async (close) => {
          const email = emailInput.value.trim().toLowerCase();
          const name = nameInput.value.trim().replace(/\s+/g, ' ') || null;
          if (!email) {
            showToast('Email is required', 'error');
            return;
          }
          const projectId = projectSelect.value ? Number.parseInt(projectSelect.value, 10) : null;
          const role = projectId ? roleSelect.value : null;
          try {
            await postJson('/api/admin/users', {
              email,
              name,
              ...(projectId ? { projectId, role } : {}),
            });
            close();
            showToast('Invite sent', 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Invite failed', 'error');
          }
        },
      },
    ],
  });
  queueMicrotask(() => emailInput.focus());
}

function disableUser(user, reload) {
  openModal({
    title: 'Disable user?',
    body: `Disabling ${user.email} signs them out and blocks future logins.`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Disable',
        kind: 'danger',
        onClick: async (close) => {
          try {
            await postJson(`/api/admin/users/${user.id}/disable`);
            close();
            showToast('User disabled', 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Failed', 'error');
          }
        },
      },
    ],
  });
}

async function sendMagicLink(user) {
  try {
    await postJson(`/api/admin/users/${user.id}/send-magic-link`);
    showToast(`Magic link sent to ${user.email}`, 'info');
  } catch (err) {
    showToast(err?.message ?? 'Failed', 'error');
  }
}

async function sendReset(user) {
  try {
    await postJson(`/api/admin/users/${user.id}/send-reset`);
    showToast(`Reset link sent to ${user.email}`, 'info');
  } catch (err) {
    showToast(err?.message ?? 'Failed', 'error');
  }
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}
