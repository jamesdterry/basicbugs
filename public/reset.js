const statusEl = document.getElementById('status');
const form = document.getElementById('reset-form');

function showStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

const ERROR_MESSAGES = {
  invalid_token: 'That reset link is invalid or has expired. Request a new one from the sign-in page.',
  weak_password: 'Password must be at least 10 characters.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  mismatch: 'Passwords do not match.',
  missing_token: 'No reset token in URL. Request a new reset link.',
  internal: 'Something went wrong on our end. Try again.',
};

function messageForError(code) {
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Try again.';
}

const token = new URLSearchParams(location.search).get('token');

if (!token) {
  showStatus(messageForError('missing_token'), 'error');
  for (const el of form.elements) el.disabled = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!token) return;
  const password = form.elements.password.value;
  const confirm = form.elements.confirm.value;
  if (password !== confirm) {
    showStatus(messageForError('mismatch'), 'error');
    return;
  }

  for (const el of form.elements) el.disabled = true;
  try {
    const res = await fetch('/auth/reset', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      showStatus('Password updated. Redirecting to sign in...', 'info');
      setTimeout(() => {
        location.href = '/login.html';
      }, 1500);
      return;
    }
    showStatus(messageForError(data?.error), 'error');
    for (const el of form.elements) el.disabled = false;
  } catch {
    showStatus(messageForError('internal'), 'error');
    for (const el of form.elements) el.disabled = false;
  }
});
