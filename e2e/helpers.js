import crypto from 'node:crypto';

/**
 * Returns a short unique suffix for use in test resource names. Uses random
 * bytes (not Date.now()) so that two parallel workers never produce the same
 * value within the same millisecond.
 */
export function uniqueSuffix() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * `${prefix}-${uniqueSuffix()}` — convenience for naming projects, issues,
 * categories, etc. so each test owns its rows under a shared seeded DB.
 */
export function uniqueName(prefix) {
  return `${prefix}-${uniqueSuffix()}`;
}

/**
 * Returns the id of the first project visible to the current session
 * (typically the seeded "E2E Demo Project" for developer-authed tests).
 */
export async function getDefaultProjectId(page) {
  const response = await page.request.get('/api/projects');
  if (!response.ok()) {
    throw new Error(`getDefaultProjectId: ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.projects?.length) throw new Error('getDefaultProjectId: no projects visible');
  return body.projects[0].id;
}

/**
 * Reads the bb_csrf cookie from the page's context. The CSRF middleware
 * (Stage 14) requires X-CSRF-Token on state-changing /api/* requests; this
 * helper plumbs the value to page.request.* calls.
 */
export async function csrfHeader(page) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'bb_csrf')?.value;
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

/**
 * Creates an issue via the JSON API using the page's session cookie. Avoids
 * UI flakiness around the new-issue modal and lets each test work on its own
 * row regardless of what other parallel workers are doing.
 */
export async function createIssueViaApi(page, { projectId, name, description } = {}) {
  const id = projectId ?? (await getDefaultProjectId(page));
  const issueName = name ?? uniqueName('issue');
  const response = await page.request.post(`/api/projects/${id}/issues`, {
    data: { name: issueName, description: description ?? null },
    headers: await csrfHeader(page),
  });
  if (!response.ok()) {
    throw new Error(`createIssueViaApi failed: ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  return { ...body.issue, projectId: id };
}

/**
 * Direct SPA navigation to the issue detail page. Bypasses the project home
 * (and its issue-list rendering) so a test isn't coupled to other tests'
 * issues sharing the same project.
 */
export async function gotoIssue(page, projectId, number) {
  await page.goto(`/#/projects/${projectId}/issues/${number}`);
  await page.locator('.issue-detail-grid').waitFor();
}
