import { h } from '../../lib/state.js';
import { getJson, postJson, patchJson } from '../../lib/api.js';
import { showToast } from '../../components/Toast.js';
import { openModal } from '../../components/Modal.js';
import { adminShell } from './shell.js';

export function adminProjectsView() {
  let projects = [];
  let showArchived = false;

  const body = h('div');
  const view = adminShell({
    active: 'adminProjects',
    title: 'Projects',
    body,
  });

  const archivedToggle = h('label', { class: 'admin-toolbar-checkbox' });
  const archivedCb = h('input', {
    type: 'checkbox',
    checked: showArchived,
    onChange: () => {
      showArchived = archivedCb.checked;
      reload();
    },
  });
  archivedToggle.append(archivedCb, document.createTextNode(' Show archived'));

  const createBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: () => openCreateModal(reload),
    },
    'Create project',
  );

  const toolbar = h('div', { class: 'admin-toolbar' }, archivedToggle, createBtn);
  const tableHost = h('div');
  body.append(toolbar, tableHost);

  async function reload() {
    try {
      const url = showArchived ? '/api/projects?includeArchived=1' : '/api/projects';
      const res = await getJson(url);
      projects = res.projects ?? [];
      render();
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, `Load failed: ${err?.message ?? 'unknown'}`));
    }
  }

  function render() {
    if (!projects.length) {
      tableHost.replaceChildren(h('p', { class: 'muted' }, 'No projects yet.'));
      return;
    }
    const rows = projects.map((p) => projectRow(p, reload));
    tableHost.replaceChildren(
      h(
        'table',
        { class: 'admin-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Status'), h('th', {}, 'Actions')),
        ),
        h('tbody', {}, rows),
      ),
    );
  }

  reload();
  return view;
}

function projectRow(project, reload) {
  const isArchived = !!project.archived_at;
  const archiveBtn = h(
    'button',
    {
      type: 'button',
      class: `icon-btn${isArchived ? '' : ' icon-btn-danger'}`,
      onClick: () =>
        openModal({
          title: isArchived ? 'Unarchive project?' : 'Archive project?',
          body: isArchived
            ? `Restore “${project.name}”?`
            : `Archive “${project.name}”?`,
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
                  showToast(isArchived ? 'Unarchived' : 'Archived', 'info');
                  reload();
                } catch (err) {
                  showToast(err?.message ?? 'Failed', 'error');
                }
              },
            },
          ],
        }),
    },
    isArchived ? 'Unarchive' : 'Archive',
  );

  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h(
        'a',
        { href: `#/projects/${project.id}` },
        project.name,
      ),
    ),
    h(
      'td',
      {},
      isArchived
        ? h('span', { class: 'role-badge', title: 'Archived' }, 'archived')
        : h('span', { class: 'role-badge' }, 'active'),
    ),
    h(
      'td',
      { class: 'admin-table-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          onClick: () => openRenameModal(project, reload),
        },
        'Rename',
      ),
      h(
        'a',
        { class: 'icon-btn', href: `#/projects/${project.id}/settings?tab=members` },
        'Members',
      ),
      h(
        'a',
        { class: 'icon-btn', href: `#/admin/projects/${project.id}/metadata` },
        'Metadata',
      ),
      archiveBtn,
    ),
  );
}

function openRenameModal(project, reload) {
  const input = h('input', {
    type: 'text',
    class: 'field-input',
    value: project.name,
    maxlength: '80',
    'aria-label': 'Project name',
  });
  openModal({
    title: `Rename — ${project.name}`,
    body: h('div', { class: 'me-form' }, h('label', {}, 'Name'), input),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        kind: 'primary',
        onClick: async (close) => {
          const name = input.value.trim().replace(/\s+/g, ' ');
          if (!name) {
            showToast('Name cannot be empty', 'error');
            return;
          }
          try {
            await patchJson(`/api/admin/projects/${project.id}`, { name });
            close();
            showToast('Saved', 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Save failed', 'error');
          }
        },
      },
    ],
  });
  queueMicrotask(() => input.focus());
}

function openCreateModal(reload) {
  const input = h('input', {
    type: 'text',
    class: 'field-input',
    placeholder: 'Project name',
    'aria-label': 'Project name',
  });
  const addSelfCheckbox = h('input', {
    type: 'checkbox',
    checked: true,
    'aria-label': 'Add me as a developer on this project',
  });
  const addSelfLabel = h(
    'label',
    { class: 'inline-checkbox' },
    addSelfCheckbox,
    document.createTextNode(' Add me as a developer (so I can be assigned issues)'),
  );
  openModal({
    title: 'Create project',
    body: h(
      'div',
      { class: 'me-form' },
      h('label', {}, 'Name'),
      input,
      addSelfLabel,
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create',
        kind: 'primary',
        onClick: async (close) => {
          const name = input.value.trim().replace(/\s+/g, ' ');
          if (!name) {
            showToast('Name cannot be empty', 'error');
            return;
          }
          try {
            await postJson('/api/admin/projects', {
              name,
              addSelfAsMember: addSelfCheckbox.checked,
            });
            close();
            showToast('Project created', 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Create failed', 'error');
          }
        },
      },
    ],
  });
  queueMicrotask(() => input.focus());
}
