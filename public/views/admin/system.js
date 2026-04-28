import { h } from '../../lib/state.js';
import { getJson, postJson } from '../../lib/api.js';
import { showToast } from '../../components/Toast.js';
import { openModal } from '../../components/Modal.js';
import { adminShell } from './shell.js';

export function adminSystemView() {
  const body = h('div');
  const view = adminShell({
    active: 'adminSystem',
    title: 'System',
    body,
  });

  const summary = h('div', { class: 'me-section' }, h('h2', {}, 'Sign out a user everywhere'));
  body.appendChild(summary);

  const emailInput = h('input', {
    type: 'email',
    class: 'field-input',
    placeholder: 'user@example.com',
    'aria-label': 'Email of user to sign out',
  });
  const goBtn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-danger',
      onClick: async () => {
        const email = emailInput.value.trim().toLowerCase();
        if (!email) {
          showToast('Email is required', 'error');
          return;
        }
        let user;
        try {
          const res = await getJson(`/api/admin/users?search=${encodeURIComponent(email)}`);
          user = (res.users ?? []).find((u) => u.email === email);
        } catch (err) {
          showToast(err?.message ?? 'Lookup failed', 'error');
          return;
        }
        if (!user) {
          showToast('No user with that email', 'error');
          return;
        }
        openModal({
          title: 'Sign out everywhere?',
          body: `Revoke every active session for ${user.email}.`,
          actions: [
            { label: 'Cancel' },
            {
              label: 'Sign out',
              kind: 'danger',
              onClick: async (close) => {
                try {
                  await postJson(`/api/admin/users/${user.id}/sign-out-everywhere`);
                  close();
                  showToast(`${user.email} signed out`, 'info');
                  emailInput.value = '';
                } catch (err) {
                  showToast(err?.message ?? 'Failed', 'error');
                }
              },
            },
          ],
        });
      },
    },
    'Sign out',
  );

  summary.append(
    h(
      'div',
      { class: 'me-form' },
      h('label', {}, 'Email'),
      emailInput,
      h(
        'p',
        { class: 'muted' },
        'Use this when you suspect a session has been compromised. The user can sign back in from a fresh browser.',
      ),
    ),
    h('div', { class: 'admin-toolbar' }, goBtn),
  );

  return view;
}
