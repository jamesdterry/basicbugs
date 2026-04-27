const statusEl = document.getElementById('status');

function showStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

function disableForm(form, disabled) {
  for (const el of form.elements) el.disabled = disabled;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json response */
  }
  return { res, data };
}

const ERROR_MESSAGES = {
  invalid_link: 'That sign-in link is invalid or has expired. Request a new one below.',
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  weak_password: 'Password must be at least 10 characters.',
  invalid_token: 'That reset link is invalid or has expired.',
  internal: 'Something went wrong on our end. Try again.',
};

function messageForError(code) {
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Try again.';
}

const params = new URLSearchParams(location.search);
const queryError = params.get('error');
if (queryError) showStatus(messageForError(queryError), 'error');

document.getElementById('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  disableForm(form, true);
  try {
    const { res, data } = await postJson('/auth/login', { email, password });
    if (res.ok) {
      location.href = '/';
      return;
    }
    showStatus(messageForError(data?.error), 'error');
  } finally {
    disableForm(form, false);
  }
});

document.getElementById('magic-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  disableForm(form, true);
  try {
    const { res, data } = await postJson('/auth/magic-link', { email });
    if (res.ok) {
      showStatus(
        `If an account exists for ${email}, a sign-in link is on its way.`,
        'info',
      );
      form.reset();
    } else {
      showStatus(messageForError(data?.error), 'error');
    }
  } finally {
    disableForm(form, false);
  }
});

const forgotCard = document.getElementById('forgot-card');
document.getElementById('forgot-link').addEventListener('click', (event) => {
  event.preventDefault();
  forgotCard.hidden = false;
  forgotCard.querySelector('input').focus();
});

document.getElementById('forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  disableForm(form, true);
  try {
    const { res, data } = await postJson('/auth/forgot', { email });
    if (res.ok) {
      showStatus(
        `If an account exists for ${email}, a password reset link is on its way.`,
        'info',
      );
      form.reset();
    } else {
      showStatus(messageForError(data?.error), 'error');
    }
  } finally {
    disableForm(form, false);
  }
});
