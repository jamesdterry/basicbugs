import { h, state } from '../lib/state.js';
import { getJson, patchJson, postJson, postForm } from '../lib/api.js';
import { showToast } from '../components/Toast.js';
import { openModal } from '../components/Modal.js';
import {
  NameField,
  DescriptionField,
  StatusField,
  CategoryField,
  PriorityField,
  AssigneeField,
  canEditField,
} from '../components/IssueFields.js';
import { HistoryTimeline } from '../components/HistoryTimeline.js';
import { SaveBar } from '../components/SaveBar.js';
import { CommentBox } from '../components/CommentBox.js';
import { AttachmentList } from '../components/AttachmentList.js';
import { AttachmentDropzone } from '../components/AttachmentDropzone.js';
import { formatRelative, formatAbsolute } from '../lib/relativeTime.js';

export function issueDetail(params) {
  const projectId = Number.parseInt(params.id, 10);
  const number = Number.parseInt(params.number, 10);

  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(number) || number <= 0) {
    return notFoundView();
  }

  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return notFoundView();

  const ctx = {
    projectId,
    number,
    project,
    role: project.role ?? 'viewer',
    metadata: null,
    members: [],
    issue: null,
    history: [],
    attachments: [],
    pendingPatch: {},
    saveNote: '',
    pendingCommentFiles: [],
    saving: false,
    commenting: false,
    archiving: false,
    requestSeq: 0,
    error: null,
    pageEl: null,
  };

  const root = h('section', { class: 'view view-issue-detail' });
  ctx.pageEl = root;

  renderLoading();
  load();

  return root;

  // ---------- top-level renderers ----------

  function renderLoading() {
    root.replaceChildren(
      header(),
      h('p', { class: 'issue-detail-loading muted' }, 'Loading issue…'),
    );
  }

  function renderError() {
    root.replaceChildren(
      header(),
      h('p', { class: 'issue-detail-error' }, ctx.error ?? 'Could not load this issue.'),
    );
  }

  function render() {
    if (ctx.error) return renderError();
    if (!ctx.issue) return renderLoading();

    root.replaceChildren(
      header(),
      h(
        'div',
        { class: 'issue-detail-grid' },
        h(
          'div',
          { class: 'issue-detail-main' },
          NameField({
            value: ctx.issue.name,
            role: ctx.role,
            dirty: 'name' in ctx.pendingPatch,
            onCommit: (next) => commitField('name', next, ctx.issue.name),
          }),
          DescriptionField({
            value: ctx.issue.description,
            role: ctx.role,
            dirty: 'description' in ctx.pendingPatch,
            onCommit: (next) =>
              commitField('description', normalizeDescription(next), ctx.issue.description ?? null),
          }),
          attachmentsSection(),
          h(
            'section',
            { class: 'issue-detail-history' },
            h('h2', {}, 'History'),
            HistoryTimeline({ events: ctx.history }),
          ),
          h(
            'section',
            { class: 'issue-detail-comment' },
            h('h2', {}, 'Add comment'),
            CommentBox({
              initialValue: '',
              onSubmit: postComment,
              busy: ctx.commenting,
              disabled: !canComment(),
              placeholder: canComment() ? 'Write a comment…' : 'Viewers cannot comment.',
            }),
            commentDropzone(),
          ),
        ),
        h(
          'aside',
          { class: 'issue-detail-sidebar' },
          StatusField({
            value: ctx.issue.status?.id,
            options: ctx.metadata?.statuses ?? [],
            role: ctx.role,
            dirty: 'statusId' in ctx.pendingPatch,
            onCommit: (next) => commitField('statusId', next, ctx.issue.status?.id),
          }),
          PriorityField({
            value: ctx.issue.priority?.id,
            options: ctx.metadata?.priorities ?? [],
            role: ctx.role,
            dirty: 'priorityId' in ctx.pendingPatch,
            onCommit: (next) => commitField('priorityId', next, ctx.issue.priority?.id),
          }),
          CategoryField({
            value: ctx.issue.category?.id,
            options: ctx.metadata?.categories ?? [],
            role: ctx.role,
            dirty: 'categoryId' in ctx.pendingPatch,
            onCommit: (next) => commitField('categoryId', next, ctx.issue.category?.id),
          }),
          AssigneeField({
            value: ctx.issue.assignee?.id ?? null,
            members: ctx.members,
            role: ctx.role,
            dirty: 'assignedTo' in ctx.pendingPatch,
            onCommit: (next) => commitField('assignedTo', next, ctx.issue.assignee?.id ?? null),
          }),
          metaBlock(),
          dangerZone(),
        ),
      ),
      SaveBar({
        patch: ctx.pendingPatch,
        note: ctx.saveNote,
        onNoteInput: (text) => {
          ctx.saveNote = text;
        },
        onSave: saveChanges,
        onDiscard: discardChanges,
        busy: ctx.saving,
      }),
    );
  }

  function header() {
    const archivedBadge = ctx.issue?.archived_at
      ? h('span', { class: 'role-badge issue-archived-badge' }, 'archived')
      : null;
    const heading = ctx.issue
      ? h(
          'h1',
          { class: 'issue-detail-heading' },
          h('span', { class: 'issue-detail-number muted' }, `#${ctx.issue.number}`),
          h('span', { class: 'issue-detail-name' }, ctx.issue.name),
          archivedBadge,
        )
      : h('h1', {}, `#${ctx.number}`);

    return h(
      'header',
      { class: 'view-header' },
      h(
        'p',
        { class: 'view-eyebrow' },
        h('a', { href: `#/projects/${ctx.projectId}` }, `← ${ctx.project.name}`),
      ),
      heading,
    );
  }

  function attachmentsSection() {
    const canUpload = !ctx.issue?.archived_at && canComment();
    const dropzone = canUpload
      ? AttachmentDropzone({
          mode: 'immediate',
          onFiles: (files) => uploadFiles(files),
          onError: (msg) => showToast(msg, 'error'),
          label: 'Drop files here, or click to attach',
        })
      : null;

    return h(
      'section',
      { class: 'issue-detail-attachments' },
      h('h2', {}, 'Attachments'),
      AttachmentList({
        attachments: ctx.attachments,
        currentUserId: state.currentUser?.id,
        role: ctx.role,
        onArchive: archiveAttachment,
      }),
      dropzone,
    );
  }

  function commentDropzone() {
    if (!canComment()) return null;
    const dz = AttachmentDropzone({
      mode: 'pending',
      label: 'Attach files to this comment (optional)',
      onError: (msg) => showToast(msg, 'error'),
    });
    ctx.commentDropzoneEl = dz;
    return dz;
  }

  function metaBlock() {
    if (!ctx.issue) return null;
    const created = ctx.issue.created_at;
    const updated = ctx.issue.updated_at;
    const author = ctx.issue.created_by;
    return h(
      'div',
      { class: 'issue-detail-meta' },
      h(
        'div',
        { class: 'field-cell' },
        h('div', { class: 'field-label' }, 'Created'),
        h(
          'div',
          { class: 'field-display muted' },
          author
            ? `${displayName(author)}, `
            : '',
          h(
            'time',
            { datetime: created ?? '', title: formatAbsolute(created) },
            formatRelative(created),
          ),
        ),
      ),
      h(
        'div',
        { class: 'field-cell' },
        h('div', { class: 'field-label' }, 'Updated'),
        h(
          'div',
          { class: 'field-display muted' },
          h(
            'time',
            { datetime: updated ?? '', title: formatAbsolute(updated) },
            formatRelative(updated),
          ),
        ),
      ),
    );
  }

  function dangerZone() {
    if (ctx.role !== 'developer' && ctx.role !== 'super_admin') return null;
    const archived = !!ctx.issue?.archived_at;
    return h(
      'div',
      { class: 'issue-detail-danger' },
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn modal-btn-danger',
          disabled: ctx.archiving,
          onclick: () => (archived ? confirmUnarchive() : confirmArchive()),
        },
        archived ? 'Unarchive issue' : 'Archive issue',
      ),
    );
  }

  // ---------- data flow ----------

  async function load() {
    const reqId = ++ctx.requestSeq;
    try {
      const [detail, projectDetail] = await Promise.all([
        getJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}`),
        getJson(`/api/projects/${ctx.projectId}`),
      ]);
      if (reqId !== ctx.requestSeq) return;
      ctx.issue = detail.issue;
      ctx.history = detail.history ?? [];
      ctx.attachments = detail.attachments ?? [];
      ctx.metadata = projectDetail.metadata ?? { statuses: [], categories: [], priorities: [] };
      ctx.members = (projectDetail.members ?? []).map((m) => ({
        id: m.user_id ?? m.id,
        name: m.name,
        email: m.email,
      }));
      ctx.role = projectDetail.project?.role ?? ctx.role;
      ctx.error = null;
    } catch (err) {
      if (reqId !== ctx.requestSeq) return;
      if (err?.status === 404) {
        ctx.error = 'Issue not found, or you do not have access.';
      } else {
        ctx.error = err?.message ?? 'Could not load this issue.';
      }
    }
    if (reqId === ctx.requestSeq) render();
  }

  async function refetchIssue() {
    const reqId = ++ctx.requestSeq;
    try {
      const detail = await getJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}`);
      if (reqId !== ctx.requestSeq) return;
      ctx.issue = detail.issue;
      ctx.history = detail.history ?? [];
      ctx.attachments = detail.attachments ?? [];
    } catch (err) {
      if (reqId !== ctx.requestSeq) return;
      showToast(`Could not refresh issue: ${err?.message ?? 'unknown error'}`, 'error');
    }
    if (reqId === ctx.requestSeq) render();
  }

  function commitField(key, nextValue, currentValue) {
    if (!canEditField(ctx.role, key)) return;
    if (sameValue(nextValue, currentValue)) {
      delete ctx.pendingPatch[key];
    } else {
      ctx.pendingPatch[key] = nextValue;
    }
    render();
  }

  async function saveChanges() {
    if (ctx.saving) return;
    if (Object.keys(ctx.pendingPatch).length === 0) return;
    ctx.saving = true;
    render();
    try {
      const body = {
        patch: { ...ctx.pendingPatch },
        note: ctx.saveNote.trim() ? ctx.saveNote.trim() : null,
      };
      await patchJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}`, body);
      ctx.pendingPatch = {};
      ctx.saveNote = '';
      showToast('Changes saved', 'info');
      await refetchIssue();
    } catch (err) {
      showToast(`Could not save: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      ctx.saving = false;
      render();
    }
  }

  function discardChanges() {
    ctx.pendingPatch = {};
    ctx.saveNote = '';
    render();
  }

  async function postComment(rawBody) {
    if (ctx.commenting) return;
    const body = (rawBody ?? '').trim();
    if (!body) return;
    ctx.commenting = true;
    render();
    try {
      await postJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}/comments`, { body });
      const pendingFiles = ctx.commentDropzoneEl?.getPending?.() ?? [];
      if (pendingFiles.length > 0) {
        const failures = await uploadFilesQuiet(pendingFiles);
        if (failures.length > 0) {
          showToast(`Comment posted; ${failures.length} attachment(s) failed`, 'error');
        } else {
          showToast('Comment posted', 'info');
        }
        ctx.commentDropzoneEl?.clear?.();
      } else {
        showToast('Comment posted', 'info');
      }
      await refetchIssue();
    } catch (err) {
      showToast(`Could not post comment: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      ctx.commenting = false;
      render();
    }
  }

  async function uploadFiles(files) {
    const failures = await uploadFilesQuiet(files);
    if (failures.length > 0) {
      showToast(
        `${failures.length} of ${files.length} attachment(s) failed`,
        'error',
      );
    } else {
      showToast(`Uploaded ${files.length} attachment${files.length === 1 ? '' : 's'}`, 'info');
    }
    await refetchIssue();
  }

  async function uploadFilesQuiet(files) {
    const failures = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file, file.name);
      try {
        await postForm(
          `/api/projects/${ctx.projectId}/issues/${ctx.number}/attachments`,
          fd,
        );
      } catch (err) {
        failures.push({ file, error: err });
      }
    }
    return failures;
  }

  async function archiveAttachment(att) {
    try {
      await postJson(`/api/attachments/${att.id}/archive`, {});
      showToast('Attachment archived', 'info');
      await refetchIssue();
    } catch (err) {
      showToast(`Could not archive: ${err?.message ?? 'unknown error'}`, 'error');
    }
  }

  function canComment() {
    return ctx.role === 'user' || ctx.role === 'developer' || ctx.role === 'super_admin';
  }

  function confirmArchive() {
    openModal({
      title: 'Archive this issue?',
      body: 'Archived issues stay searchable when "Show archived" is enabled, but are hidden from the default issue list.',
      actions: [
        { label: 'Cancel' },
        {
          label: 'Archive',
          kind: 'danger',
          onClick: async (close) => {
            close();
            await archive();
          },
        },
      ],
    });
  }

  function confirmUnarchive() {
    openModal({
      title: 'Unarchive this issue?',
      body: 'It will appear in the default issue list again.',
      actions: [
        { label: 'Cancel' },
        {
          label: 'Unarchive',
          kind: 'primary',
          onClick: async (close) => {
            close();
            await unarchive();
          },
        },
      ],
    });
  }

  async function archive() {
    if (ctx.archiving) return;
    ctx.archiving = true;
    render();
    try {
      await postJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}/archive`, {});
      showToast('Issue archived', 'info');
      await refetchIssue();
    } catch (err) {
      showToast(`Could not archive: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      ctx.archiving = false;
      render();
    }
  }

  async function unarchive() {
    if (ctx.archiving) return;
    ctx.archiving = true;
    render();
    try {
      await postJson(`/api/projects/${ctx.projectId}/issues/${ctx.number}/unarchive`, {});
      showToast('Issue restored', 'info');
      await refetchIssue();
    } catch (err) {
      showToast(`Could not unarchive: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      ctx.archiving = false;
      render();
    }
  }
}

function notFoundView() {
  return h(
    'section',
    { class: 'view view-issue-detail' },
    h('h1', {}, 'Issue not found'),
    h(
      'p',
      { class: 'muted' },
      "We couldn't find that issue, or you don't have access to it.",
    ),
    h('p', {}, h('a', { href: '#/' }, '← Back to projects')),
  );
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  return a === b;
}

function normalizeDescription(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function displayName(user) {
  if (!user) return '';
  if (user.name && user.name.trim()) return user.name;
  return user.email ?? '';
}
