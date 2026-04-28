import { h } from '../lib/state.js';

const HOST_ID = 'toast-host';

export function showToast(message, kind = 'info', durationMs = 4000) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const toast = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}
