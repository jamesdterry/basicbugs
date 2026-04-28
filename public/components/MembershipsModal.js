import { h } from '../lib/state.js';
import { openModal } from './Modal.js';
import { showToast } from './Toast.js';
import { getJson, postJson, patchJson, deleteJson } from '../lib/api.js';

const ROLE_OPTIONS = [
  { value: '', label: 'Not a member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'user', label: 'User' },
  { value: 'developer', label: 'Developer' },
];

export async function openMembershipsModal({ user, onChanged }) {
  let projects = [];
  let memberships = new Map();
  try {
    const [projRes, userRes] = await Promise.all([
      getJson('/api/projects?includeArchived=1'),
      getJson(`/api/admin/users/${user.id}`),
    ]);
    projects = projRes.projects ?? [];
    for (const m of userRes.memberships ?? []) {
      memberships.set(m.project_id, m.role);
    }
  } catch (err) {
    showToast(`Could not load memberships: ${err?.message ?? 'unknown error'}`, 'error');
    return;
  }

  const desired = new Map(memberships);

  const rows = projects
    .filter((p) => !p.archived_at)
    .map((p) => {
      const select = h(
        'select',
        {
          class: 'field-input',
          'aria-label': `Role for ${p.name}`,
          onChange: (e) => {
            const v = e.target.value;
            if (v) desired.set(p.id, v);
            else desired.delete(p.id);
          },
        },
        ...ROLE_OPTIONS.map((opt) =>
          h(
            'option',
            { value: opt.value, selected: (desired.get(p.id) ?? '') === opt.value },
            opt.label,
          ),
        ),
      );
      return h(
        'div',
        { class: 'membership-row' },
        h('span', { class: 'membership-name' }, p.name),
        select,
      );
    });

  const body = h(
    'div',
    { class: 'memberships-modal-body' },
    h('p', { class: 'muted' }, `Edit ${user.name || user.email}'s project memberships.`),
    h('div', { class: 'memberships-list' }, rows.length ? rows : h('p', { class: 'muted' }, 'No projects yet.')),
  );

  openModal({
    title: 'Memberships',
    body,
    actions: [
      { label: 'Cancel', kind: 'default' },
      {
        label: 'Save',
        kind: 'primary',
        onClick: async (close) => {
          const ops = [];
          const projectIds = new Set([...memberships.keys(), ...desired.keys()]);
          for (const pid of projectIds) {
            const before = memberships.get(pid);
            const after = desired.get(pid);
            if (before === after) continue;
            if (!before && after) {
              ops.push(
                postJson(`/api/admin/projects/${pid}/members`, {
                  userId: user.id,
                  role: after,
                }),
              );
            } else if (before && !after) {
              ops.push(deleteJson(`/api/admin/projects/${pid}/members/${user.id}`));
            } else if (before && after) {
              ops.push(
                patchJson(`/api/admin/projects/${pid}/members/${user.id}`, { role: after }),
              );
            }
          }
          try {
            await Promise.all(ops);
            close();
            showToast('Memberships updated', 'info');
            if (onChanged) onChanged();
          } catch (err) {
            showToast(`Save failed: ${err?.message ?? 'unknown error'}`, 'error');
          }
        },
      },
    ],
  });
}
