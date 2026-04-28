import { h, state } from '../lib/state.js';

export function projectHome({ id }) {
  const numericId = Number.parseInt(id, 10);
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

  return h(
    'section',
    { class: 'view view-project' },
    h(
      'header',
      { class: 'view-header' },
      h('p', { class: 'view-eyebrow' }, h('a', { href: '#/' }, '← Projects')),
      h('h1', {}, project.name),
      project.role ? h('span', { class: 'role-badge' }, project.role) : null,
    ),
    h(
      'div',
      { class: 'placeholder-card' },
      h('p', {}, 'Issues land in Stage 6.'),
      h(
        'p',
        { class: 'muted' },
        'This is the project home placeholder. The filtered issue list, search, and pagination arrive in the next stage.',
      ),
    ),
  );
}
