import { h } from '../lib/state.js';

export function notFound() {
  return h(
    'section',
    { class: 'view view-not-found' },
    h('h1', {}, 'Page not found'),
    h('p', { class: 'muted' }, "That route doesn't exist."),
    h('p', {}, h('a', { href: '#/' }, '← Back to projects')),
  );
}

export function placeholder(title, message) {
  return () =>
    h(
      'section',
      { class: 'view view-placeholder' },
      h('h1', {}, title),
      h('p', { class: 'muted' }, message),
      h('p', {}, h('a', { href: '#/' }, '← Back to projects')),
    );
}
