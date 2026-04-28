import { h, state } from '../lib/state.js';
import { getJson } from '../lib/api.js';
import { IssueList } from './issueList.js';
import { showToast } from '../components/Toast.js';

export function projectHome(params) {
  const numericId = Number.parseInt(params.id, 10);
  const project = state.projects.find((p) => p.id === numericId);

  if (!project) {
    return h(
      'section',
      { class: 'view view-project' },
      h('h1', {}, 'Project not found'),
      h(
        'p',
        { class: 'muted' },
        "We couldn't find that project, or you don't have access to it.",
      ),
      h('p', {}, h('a', { href: '#/' }, '← Back to projects')),
    );
  }

  const content = h(
    'div',
    { class: 'issue-list-loading muted' },
    'Loading project…',
  );

  const canSeeSettings =
    project.role === 'super_admin' ||
    project.role === 'developer' ||
    state.currentUser?.isSuperAdmin;

  const view = h(
    'section',
    { class: 'view view-project' },
    h(
      'header',
      { class: 'view-header' },
      h('p', { class: 'view-eyebrow' }, h('a', { href: '#/' }, '← Projects')),
      h('h1', {}, project.name),
      project.role ? h('span', { class: 'role-badge' }, project.role) : null,
      canSeeSettings
        ? h(
            'div',
            { class: 'view-header-actions' },
            h('a', { class: 'icon-btn', href: `#/projects/${project.id}/settings` }, 'Settings'),
          )
        : null,
    ),
    content,
  );

  loadDetail(numericId).then((detail) => {
    if (!detail) return;
    const members = (detail.members ?? []).map((m) => ({
      id: m.user_id ?? m.id,
      name: m.name,
      email: m.email,
    }));
    content.replaceWith(
      IssueList({
        project: { ...detail.project, role: project.role },
        metadata: detail.metadata,
        members,
        currentUserId: state.currentUser?.id,
        initialQuery: params.query ?? {},
      }),
    );
  });

  return view;
}

async function loadDetail(projectId) {
  try {
    return await getJson(`/api/projects/${projectId}`);
  } catch (err) {
    showToast(`Could not load project: ${err?.message ?? 'unknown error'}`, 'error');
    return null;
  }
}
