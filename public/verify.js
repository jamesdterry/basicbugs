const statusEl = document.getElementById('status');
const form = document.getElementById('verify-form');
const submitButton = form.querySelector('button');
const token = new URLSearchParams(location.search).get('token');

function showStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

function setBusy(busy) {
  submitButton.disabled = busy || !token;
  submitButton.textContent = busy ? 'Signing in...' : 'Sign in';
}

if (!token) {
  showStatus('That sign-in link is invalid or has expired. Request a new one from the sign-in page.', 'error');
  setBusy(false);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!token) return;
  setBusy(true);
  try {
    const res = await fetch('/auth/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      location.replace('/');
      return;
    }
    showStatus('That sign-in link is invalid or has expired. Request a new one from the sign-in page.', 'error');
  } catch {
    showStatus('Something went wrong on our end. Try again.', 'error');
  } finally {
    setBusy(false);
  }
});
