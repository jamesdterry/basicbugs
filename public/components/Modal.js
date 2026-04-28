import { h } from '../lib/state.js';

const HOST_ID = 'modal-host';

export function openModal({ title, body, actions = [] }) {
  const host = document.getElementById(HOST_ID);
  if (!host) return () => {};

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  const buttons = actions.map((action) =>
    h(
      'button',
      {
        type: 'button',
        class: `modal-btn modal-btn-${action.kind ?? 'default'}`,
        onClick: async () => {
          if (action.onClick) await action.onClick(close);
          else close();
        },
      },
      action.label,
    ),
  );

  const dialog = h(
    'div',
    { class: 'modal-dialog', role: 'dialog', 'aria-modal': 'true' },
    title ? h('h2', { class: 'modal-title' }, title) : null,
    h(
      'div',
      { class: 'modal-body' },
      typeof body === 'string' ? document.createTextNode(body) : body,
    ),
    buttons.length ? h('div', { class: 'modal-actions' }, buttons) : null,
  );

  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: (e) => {
        if (e.target === backdrop) close();
      },
    },
    dialog,
  );

  host.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  return close;
}
