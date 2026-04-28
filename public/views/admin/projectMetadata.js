import { h } from '../../lib/state.js';
import { getJson, postJson, patchJson, deleteJson } from '../../lib/api.js';
import { showToast } from '../../components/Toast.js';
import { openModal } from '../../components/Modal.js';
import { Tabs } from '../../components/Tabs.js';
import { MetadataList } from '../../components/MetadataList.js';
import { adminShell } from './shell.js';

const KIND_TABS = [
  { key: 'statuses', label: 'Statuses' },
  { key: 'categories', label: 'Categories' },
  { key: 'priorities', label: 'Priorities' },
];

export function adminProjectMetadataView(params) {
  const projectId = Number.parseInt(params.id, 10);
  let detail = null;
  let kind = KIND_TABS.find((t) => t.key === params.query?.tab)?.key ?? 'statuses';

  const body = h('div');
  const tabsHost = h('div');
  const toolbar = h('div', { class: 'admin-toolbar' });
  const listHost = h('div');
  body.append(tabsHost, toolbar, listHost);

  const view = adminShell({
    active: 'adminProjects',
    eyebrow: h('a', { href: '#/admin/projects' }, '← Projects'),
    title: 'Loading…',
    body,
  });

  async function loadProjects() {
    return (await getJson('/api/projects?includeArchived=1')).projects ?? [];
  }

  async function reload() {
    try {
      detail = await getJson(`/api/projects/${projectId}`);
      const heading = view.querySelector('h1');
      if (heading) heading.textContent = `${detail.project.name} — Metadata`;
      render();
    } catch (err) {
      listHost.replaceChildren(h('p', { class: 'muted' }, `Load failed: ${err?.message ?? 'unknown'}`));
    }
  }

  function updateUrl() {
    const newHash = `#/admin/projects/${projectId}/metadata${kind === 'statuses' ? '' : `?tab=${kind}`}`;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }

  function render() {
    tabsHost.replaceChildren(
      Tabs({
        tabs: KIND_TABS,
        current: kind,
        onChange: (next) => {
          kind = next;
          updateUrl();
          render();
        },
      }),
    );

    toolbar.replaceChildren(
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn',
          onClick: () => openResetModal(projectId, kind, reload),
        },
        'Reset to defaults',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn',
          onClick: () => openCopyModal(projectId, kind, loadProjects, reload),
        },
        'Copy from another project',
      ),
    );

    if (!detail) {
      listHost.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
      return;
    }

    const items = detail.metadata[kind];
    listHost.replaceChildren(
      MetadataList({
        kind,
        items,
        canEdit: true,
        onCreate: async (name) => {
          try {
            await postJson(`/api/projects/${projectId}/metadata/${kind}`, { name });
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Create failed', 'error');
          }
        },
        onRename: async (id, name) => {
          try {
            await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, { name });
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Rename failed', 'error');
          }
        },
        onSetDefault: async (id) => {
          try {
            await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, {
              isDefault: true,
            });
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Update failed', 'error');
          }
        },
        onSetClosed: async (id, isClosed) => {
          try {
            await patchJson(`/api/projects/${projectId}/metadata/${kind}/${id}`, { isClosed });
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Update failed', 'error');
          }
        },
        onArchive: (id) => {
          const item = items.find((i) => i.id === id);
          openModal({
            title: 'Archive item?',
            body: `Archive “${item?.name ?? 'this item'}”?`,
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
        },
        onMove: async (movedId, targetId) => {
          const moved = items.find((i) => i.id === movedId);
          const target = items.find((i) => i.id === targetId);
          if (!moved || !target) return;
          try {
            await patchJson(`/api/projects/${projectId}/metadata/${kind}/${movedId}`, {
              sortOrder: target.sort_order,
            });
            const direction = moved.sort_order < target.sort_order ? -1 : 1;
            const shifts = [];
            for (const it of items) {
              if (it.id === movedId) continue;
              if (direction === -1) {
                if (it.sort_order > moved.sort_order && it.sort_order <= target.sort_order) {
                  shifts.push(
                    patchJson(`/api/projects/${projectId}/metadata/${kind}/${it.id}`, {
                      sortOrder: it.sort_order - 1,
                    }),
                  );
                }
              } else {
                if (it.sort_order >= target.sort_order && it.sort_order < moved.sort_order) {
                  shifts.push(
                    patchJson(`/api/projects/${projectId}/metadata/${kind}/${it.id}`, {
                      sortOrder: it.sort_order + 1,
                    }),
                  );
                }
              }
            }
            await Promise.all(shifts);
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Reorder failed', 'error');
          }
        },
      }),
    );
  }

  reload();
  return view;
}

function openResetModal(projectId, kind, reload) {
  openModal({
    title: 'Reset to system defaults?',
    body: `Restore any missing or archived default ${kind} for this project. Custom rows are not changed.`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Reset',
        kind: 'primary',
        onClick: async (close) => {
          try {
            await postJson(`/api/admin/projects/${projectId}/metadata/${kind}/reset`);
            close();
            showToast('Defaults restored', 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Reset failed', 'error');
          }
        },
      },
    ],
  });
}

async function openCopyModal(projectId, kind, loadProjects, reload) {
  let projects;
  try {
    projects = await loadProjects();
  } catch (err) {
    showToast(err?.message ?? 'Load failed', 'error');
    return;
  }
  const others = projects.filter((p) => p.id !== projectId && !p.archived_at);
  if (!others.length) {
    showToast('No other projects to copy from', 'error');
    return;
  }
  const select = h(
    'select',
    { class: 'field-input', 'aria-label': 'Source project' },
    ...others.map((p) => h('option', { value: String(p.id) }, p.name)),
  );

  openModal({
    title: `Copy ${kind} from another project`,
    body: h(
      'div',
      { class: 'me-form' },
      h('label', {}, 'Source project'),
      select,
      h(
        'p',
        { class: 'muted' },
        `Names that already exist in this project will be skipped. Default and closed flags are not carried over.`,
      ),
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Copy',
        kind: 'primary',
        onClick: async (close) => {
          const srcId = Number.parseInt(select.value, 10);
          try {
            const res = await postJson(
              `/api/admin/projects/${projectId}/metadata/${kind}/copy-from/${srcId}`,
            );
            close();
            showToast(`Copied ${res.inserted} new ${kind}`, 'info');
            reload();
          } catch (err) {
            showToast(err?.message ?? 'Copy failed', 'error');
          }
        },
      },
    ],
  });
}
