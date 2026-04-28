import { h } from '../lib/state.js';

export function ProjectPicker({ projects }) {
  if (!projects || projects.length === 0) {
    return h(
      'section',
      { class: 'view view-picker' },
      h('h1', {}, 'No projects yet'),
      h(
        'p',
        { class: 'muted' },
        "You haven't been added to any projects. Ask your admin to invite you.",
      ),
    );
  }

  const items = projects.map((p) =>
    h(
      'li',
      { class: 'project-card' },
      h(
        'a',
        { class: 'project-card-link', href: `#/projects/${p.id}` },
        h('span', { class: 'project-card-name' }, p.name),
        h(
          'span',
          { class: 'project-card-meta' },
          p.role ? h('span', { class: 'role-badge' }, p.role) : null,
        ),
      ),
    ),
  );

  return h(
    'section',
    { class: 'view view-picker' },
    h('h1', {}, 'Your projects'),
    h('ul', { class: 'project-list' }, items),
  );
}
