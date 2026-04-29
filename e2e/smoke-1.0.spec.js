import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { uniqueSuffix, csrfHeader } from './helpers.js';

const EMAIL_LOG = './data/e2e-emails.jsonl';

// Reads every email line written since the offset, returns the matching one
// (or undefined). Used to find the magic-link email a specific user just got.
function findEmailFor(toEmail, fromOffset) {
  if (!fs.existsSync(EMAIL_LOG)) return undefined;
  const fd = fs.openSync(EMAIL_LOG, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size <= fromOffset) return undefined;
    const buf = Buffer.alloc(stat.size - fromOffset);
    fs.readSync(fd, buf, 0, buf.length, fromOffset);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.to === toEmail) return entry;
      } catch {
        /* skip */
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return undefined;
}

async function waitForEmail(toEmail, fromOffset, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = findEmailFor(toEmail, fromOffset);
    if (entry) return entry;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for email to ${toEmail}`);
}

function emailLogSize() {
  return fs.existsSync(EMAIL_LOG) ? fs.statSync(EMAIL_LOG).size : 0;
}

// Stage 14 § 6 — Stage 14 verifies the full bring-up flow:
//   super admin login → create user → magic-link sent → user follows it →
//   user files an issue → super admin sees the audit row.
test('1.0 smoke: super admin onboards a new user end-to-end', async ({ browser }) => {
  test.setTimeout(60_000);

  // Two contexts — super admin (from admin storage state) and a fresh,
  // unauthed context for the invited user.
  const adminContext = await browser.newContext({
    storageState: '.auth/superadmin.json',
  });
  const userContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    const userPage = await userContext.newPage();

    // 1. Super admin lands on the admin shell.
    await adminPage.goto('/#/admin/users');
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible();

    // 2. Capture the email log offset before triggering the invite, so we
    //    only read messages that came from this run.
    const offset = emailLogSize();

    // 3. Create a fresh user via the invite UI. The "Invite user" button
    //    posts to /api/admin/users with sendInvite=true, which mints a
    //    magic-link token and delivers it (logs it, in this env).
    const newEmail = `smoke+${uniqueSuffix()}@e2e.local`;
    await adminPage.getByRole('button', { name: 'Invite user' }).click();
    await adminPage.locator('input[aria-label="Email"]').fill(newEmail);
    await adminPage.getByRole('button', { name: 'Send invite' }).click();
    await expect(
      adminPage.locator('.toast-info', { hasText: 'Invite sent' }),
    ).toBeVisible();

    // 4. Pull the magic-link URL out of the email log.
    const email = await waitForEmail(newEmail, offset);
    const link = email.links.find((u) => u.includes('/verify.html?token='));
    expect(link, 'magic-link URL present in invite email').toBeTruthy();

    // The dev base URL is http://localhost:8080 (from server config), but the
    // e2e server listens on :8081. Rewrite to the e2e port.
    const verifyUrl = link.replace('http://localhost:8080', 'http://localhost:8081');

    // 5. Brand-new browser context follows the link and confirms sign-in.
    await userPage.goto(verifyUrl);
    await userPage.getByRole('button', { name: 'Sign in' }).click();
    await userPage.waitForURL('http://localhost:8081/');
    await expect(userPage.locator('#topbar')).toBeVisible();

    // 6. Add the new user as a developer on the seeded project so they
    //    can file an issue. (Invite-without-project leaves them with no
    //    project memberships.)
    const projects = await adminPage.request
      .get('/api/projects')
      .then((r) => r.json());
    const project = projects.projects.find((p) => p.name === 'E2E Demo Project');
    expect(project, 'seeded project exists').toBeTruthy();

    const usersList = await adminPage.request
      .get(`/api/admin/users?search=${encodeURIComponent(newEmail)}`)
      .then((r) => r.json());
    const newUser = usersList.users.find((u) => u.email === newEmail);
    expect(newUser, 'new user row exists').toBeTruthy();

    const csrf = await csrfHeader(adminPage);
    const addMember = await adminPage.request.post(
      `/api/admin/projects/${project.id}/members`,
      {
        data: { userId: newUser.id, role: 'developer' },
        headers: csrf,
      },
    );
    expect(addMember.ok(), 'member add returned ok').toBeTruthy();

    // 7. The new user files an issue via the API (UI tested elsewhere).
    const userCsrf = await csrfHeader(userPage);
    // Trigger a GET first so the user's bb_csrf cookie is minted if it isn't yet.
    if (!userCsrf['X-CSRF-Token']) {
      await userPage.request.get('/api/projects');
    }
    const issueRes = await userPage.request.post(
      `/api/projects/${project.id}/issues`,
      {
        data: {
          name: `Smoke issue ${uniqueSuffix()}`,
          description: 'Filed by the invited user during the 1.0 smoke spec.',
        },
        headers: await csrfHeader(userPage),
      },
    );
    expect(issueRes.ok(), `POST issues: ${issueRes.status()}`).toBeTruthy();
    const issueBody = await issueRes.json();

    // 8. Super admin sees the new user creation in the audit log.
    await adminPage.goto('/#/admin/audit');
    await expect(
      adminPage.getByRole('heading', { name: 'Audit log' }),
    ).toBeVisible();
    await expect(
      adminPage.locator('.admin-table').getByText('user.create').first(),
    ).toBeVisible();
    await expect(
      adminPage.locator('.admin-table').getByText('member.add').first(),
    ).toBeVisible();

    // 9. Super admin sees the new issue in the project.
    await adminPage.goto(`/#/projects/${project.id}`);
    await expect(adminPage.getByText(issueBody.issue.name)).toBeVisible();
  } finally {
    await adminContext.close();
    await userContext.close();
  }
});
