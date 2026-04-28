import { h, state } from '../lib/state.js';
import { getJson, postJson, patchJson, deleteJson } from '../lib/api.js';
import { showToast } from '../components/Toast.js';
import { openModal } from '../components/Modal.js';
import { Tabs } from '../components/Tabs.js';
import { MetadataList } from '../components/MetadataList.js';

const TAB_KEYS = ['members', 'statuses', 'categories', 'priorities', 'danger'];
const ROLE_RANK = { viewer: 1, user: 2, developer: 3, super_admin: 3 };

function tabsForRole(role, isSuperAdmin) {
  const tabs = [{ key: 'members', label: 'Members' }];
  if (canEditMetadata(role)) {
    tabs.push(
      { key: 'statuses', label: 'Statuses' },
      { key: 'categories', label: 'Categories' },
      { key: 'priorities', label: 'Priorities' },
    );
  }
  if (isSuperAdmin) tabs.push({ key: 'danger', label: 'Danger zone' });
  return tabs;
}

function canEditMetadata(role) {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK.developer;
}

export function projectSettings(params) {
  const projectId = Number.parseInt(params.id, 10);
  const project = state.projects.find((p) => p.id === projectId);
  const isSuperAdmin = !!state.currentUser?.isSuperAdmin;

  if (!project) {
    return h(
      'section',
      { class: 'view view-project-settings' },
      h('h1', {}, 'Project not found'),
      h('p', { class: 'muted' }, "You don't have access to that project."),
      h('p', {}, h('a', { href: '#/' }, '← Back to projects')),
    );
  }

  const role = project.role;
  const tabs = tabsForRole(role, isSuperAdmin);
  const initialTab = tabs.find((t) => t.key === params.query?.tab)?.key ?? tabs[0].key;
  let currentTab = initialTab;

  let detail = null; // { project, members, metadata }

  const view = h(
    'section',
    { class: 'view view-project-settings' },
    h(
      'header',
      { class: 'view-header' },
      h(
        'p',
        { class: 'view-eyebrow' },
        h('a', { href: `#/projects/${project.id}` }, '← Back to project'),
      ),
      h('h1', {}, project.name + ' — Settings'),
    ),
  );

  const tabsHost = h('div');
  const content = h('div', { class: 'project-settings-content' });
  view.append(tabsHost, content);

  function renderTabs() {
    tabsHost.replaceChildren(
      Tabs({
        tabs,
        current: currentTab,
        onChange: (key) => {
          currentTab = key;
          renderTabs();
          renderContent();
          updateUrl();
        },
      }),
    );
  }

  function updateUrl() {
    const q = currentTab === tabs[0].key ? '' : `?tab=${currentTab}`;
    const newHash = `#/projects/${project.id}/settings${q}`;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }

  async function reload() {
    try {
      detail = await getJson(`/api/projects/${project.id}`);
      renderContent();
    } catch (err) {
      showToast(`Failed to load: ${err?.message ?? 'unknown error'}`, 'error');
    }
  }

  function renderContent() {
    if (!detail) {
      content.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
      return;
    }
    if (currentTab === 'members') {
      content.replaceChildren(renderMembers(detail, role, isSuperAdmin, reload));
    } else if (
      currentTab === 'statuses' ||
      currentTab === 'categories' ||
      currentTab === 'priorities'
    ) {
      content.replaceChildren(
        renderMetadataTab(currentTab, project.id, detail.metadata[currentTab], canEditMetadata(role), reload),
      );
    } else if (currentTab === 'danger') {
      content.replaceChildren(renderDangerZone(detail.project, reload));
    }
  }

  renderTabs();
  renderContent();
  reload();
  return view;
}

// ---------- Members ----------

function renderMembers(detail, role, isSuperAdmin, reload) {
  const wrap = h('div');

  if (isSuperAdmin) {
    wrap.appendChild(addMemberForm(detail.project.id, reload));
  }

  const rows = (detail.members ?? []).map((m) => {
    const tds = [
      h('td', {}, m.name || ''),
      h('td', {}, m.email),
      h(
        'td',
        {},
        isSuperAdmin
          ? roleSelect(m.role, async (next) => {
              try {
                await patchJson(
                  `/api/admin/projects/${detail.project.id}/members/${m.user_id}`,
                  { role: next },
                );
                showToast('Role updated', 'info');
                reload();
              } catch (err) {
                showToast(`Update failed: ${err?.message ?? 'unknown'}`, 'error');
              }
            })
          : h('span', { class: 'role-badge' }, m.role),
      ),
    ];
    if (isSuperAdmin) {
      tds.push(
        h(
          'td',
          { class: 'admin-table-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn icon-btn-danger',
              onClick: () => removeMember(detail.project.id, m, reload),
            },
            'Remove',
          ),
        ),
      );
    }
    return h('tr', {}, ...tds);
  });

  const headers = ['Name', 'Email', 'Role'];
  if (isSuperAdmin) headers.push('');

  wrap.appendChild(
    h(
      'table',
      { class: 'admin-table' },
      h('thead', {}, h('tr', {}, ...headers.map((label) => h('th', {}, label)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: String(headers.length), class: 'muted' }, 'No members.'))),
    ),
  );

  if (!isSuperAdmin) {
    wrap.appendChild(
      h(
        'p',
        { class: 'settings-note' },
        'Only super admins can change project membership.',
      ),
    );
  }

  return wrap;
}

function roleSelect(current, onChange) {
  return h(
    'select',
    {
      class: 'field-input',
      onChange: (e) => onChange(e.target.value),
    },
    ...['viewer', 'user', 'developer'].map((r) =>
      h('option', { value: r, selected: r === current }, r),
    ),
  );
}

function addMemberForm(projectId, reload) {
  const emailInput = h('input', {
    type: 'email',
    class: 'field-input',
    placeholder: 'user@example.com',
    'aria-label': 'Email of user to add',
  });
  const roleSel = h(
    'select',
    { class: 'field-input', 'aria-label': 'Role' },
    ...['viewer', 'user', 'developer'].map((r) =>
      h('option', { value: r, selected: r === 'user' }, r),
    ),
  );
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: async () => {
        const email = emailInput.value.trim().toLowerCase();
        if (!email) return;
        btn.disabled = true;
        try {
          const list = await getJson(`/api/admin/users?search=${encodeURIComponent(email)}`);
          const user = (list.users ?? []).find((u) => u.email === email);
          if (!user) {
            showToast('No user with that email. Invite them via Admin → Users first.', 'error');
            return;
          }
          await postJson(`/api/admin/projects/${projectId}/members`, {
            userId: user.id,
            role: roleSel.value,
          });
          emailInput.value = '';
          showToast('Member added', 'info');
          reload();
        } catch (err) {
          showToast(`Add failed: ${err?.message ?? 'unknown'}`, 'error');
        } finally {
          btn.disabled = false;
        }
      },
    },
    'Add member',
  );
  return h('div', { class: 'admin-toolbar' }, emailInput, roleSel, btn);
}

function removeMember(projectId, member, reload) {
  openModal({
    title: 'Remove member?',
    body: `Remove ${member.name || member.email} from this project?`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Remove',
        kind: 'danger',
        onClick: async (close) => {
          try {
            await deleteJson(`/api/admin/projects/${projectId}/members/${member.user_id}`);
            close();
            showToast('Member removed', 'info');
            reload();
          } catch (err) {
            showToast(`Remove failed: ${err?.message ?? 'unknown'}`, 'error');
          }
        },
      },
    ],
  });
}

// ---------- Metadata tab ----------

function renderMetadataTab(kind, projectId, items, canEdit, reload) {
  const onCreate = async (name) => {
    try {
      await postJson(`/api/projects/${projectId}/metadata/${kind}`, { name });
      reload();
    } catch (err) {
      showToast(err?.message ?? 'Create failed', 'error');
    }
  };
  const onRename = async (id, name) => {
    try {
      await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, { name });
      reload();
    } catch (err) {
      showToast(err?.message ?? 'Rename failed', 'error');
    }
  };
  const onSetDefault = async (id) => {
    try {
      await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, { isDefault: true });
      reload();
    } catch (err) {
      showToast(err?.message ?? 'Update failed', 'error');
    }
  };
  const onSetClosed = async (id, isClosed) => {
    try {
      await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, { isClosed });
      reload();
    } catch (err) {
      showToast(err?.message ?? 'Update failed', 'error');
    }
  };
  const onArchive = (id) => {
    const item = items.find((i) => i.id === id);
    openModal({
      title: 'Archive item?',
      body: `Archive “${item?.name ?? 'this item'}”? Issues using it will keep it in their history.`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Archive',
          kind: 'danger',
          onClick: async (close) => {
            try {
              await deleteJson(`/api/projects/${projectId}/metadata/${kind}/${id}`);
              close();
              reload();
            } catch (err) {
              showToast(err?.message ?? 'Archive failed', 'error');
            }
          },
        },
      ],
    });
  };
  const onMove = async (movedId, targetId) => {
    const moved = items.find((i) => i.id === movedId);
    const target = items.find((i) => i.id === targetId);
    if (!moved || !target) return;
    const newSort = target.sort_order;
    try {
      await patchJson(`/api/projects/${projectId}/metadata/${kind}/${movedId}`, {
        sortOrder: newSort,
      });
      // Shift surrounding items so order stays consistent.
      const shiftPromises = [];
      const direction = moved.sort_order < target.sort_order ? -1 : 1;
      for (const it of items) {
        if (it.id === movedId) continue;
        if (direction === -1) {
          // moving down: bump items between old and new up by -1
          if (it.sort_order > moved.sort_order && it.sort_order <= target.sort_order) {
            shiftPromises.push(
              patchJson(`/api/projects/${projectId}/metadata/${kind}/${it.id}`, {
                sortOrder: it.sort_order - 1,
              }),
            );
          }
        } else {
          // moving up: bump items between new and old down by +1
          if (it.sort_order >= target.sort_order && it.sort_order < moved.sort_order) {
            shiftPromises.push(
              patchJson(`/api/projects/${projectId}/metadata/${kind}/${it.id}`, {
                sortOrder: it.sort_order + 1,
              }),
            );
          }
        }
      }
      await Promise.all(shiftPromises);
      reload();
    } catch (err) {
      showToast(err?.message ?? 'Reorder failed', 'error');
    }
  };

  return MetadataList({
    kind,
    items,
    canEdit,
    onCreate,
    onRename,
    onSetDefault,
    onSetClosed,
    onArchive,
    onMove,
  });
}

// ---------- Danger zone ----------

function renderDangerZone(project, reload) {
  const isArchived = !!project.archived_at;
  const archiveBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-danger',
      onClick: () => {
        openModal({
          title: isArchived ? 'Unarchive project?' : 'Archive project?',
          body: isArchived
            ? `Restore “${project.name}” to the active list.`
            : `Archive “${project.name}”? It will no longer appear in the project list for non-admins.`,
          actions: [
            { label: 'Cancel' },
            {
              label: isArchived ? 'Unarchive' : 'Archive',
              kind: 'danger',
              onClick: async (close) => {
                try {
                  await postJson(
                    `/api/admin/projects/${project.id}/${isArchived ? 'unarchive' : 'archive'}`,
                  );
                  close();
                  showToast(isArchived ? 'Project unarchived' : 'Project archived', 'info');
                  reload();
                } catch (err) {
                  showToast(err?.message ?? 'Failed', 'error');
                }
              },
            },
          ],
        });
      },
    },
    isArchived ? 'Unarchive project' : 'Archive project',
  );

  return h(
    'div',
    { class: 'danger-zone' },
    h('h3', {}, 'Danger zone'),
    h(
      'p',
      {},
      isArchived
        ? 'This project is archived. Restoring it returns it to the active list.'
        : 'Archiving hides the project from non-admins. Issues are preserved and can be unarchived later.',
    ),
    archiveBtn,
  );
}

export const _testing = { TAB_KEYS };
