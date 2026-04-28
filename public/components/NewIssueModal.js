import { h } from '../lib/state.js';
import { openModal } from './Modal.js';
import { postJson } from '../lib/api.js';
import { showToast } from './Toast.js';
import {
  makeNameInput,
  makeDescriptionInput,
  makeMetadataSelect,
  makeAssigneeSelect,
  canEditField,
} from './IssueFields.js';

export function openNewIssueModal({ project, metadata, members, role, onCreated }) {
  const nameInput = makeNameInput();
  const descriptionInput = makeDescriptionInput();

  const statusDefault = metadata.statuses.find((s) => s.is_default) ?? metadata.statuses[0];
  const categoryDefault = metadata.categories.find((c) => c.is_default) ?? metadata.categories[0];
  const priorityDefault = metadata.priorities.find((p) => p.is_default) ?? metadata.priorities[0];

  const canSetMetadata = canEditField(role, 'statusId');
  const canSetAssignee = canEditField(role, 'assignedTo');

  const statusSelect = canSetMetadata
    ? makeMetadataSelect({
        name: 'statusId',
        options: metadata.statuses,
        defaultId: statusDefault?.id ?? null,
      })
    : null;
  const categorySelect = canSetMetadata
    ? makeMetadataSelect({
        name: 'categoryId',
        options: metadata.categories,
        defaultId: categoryDefault?.id ?? null,
      })
    : null;
  const prioritySelect = canSetMetadata
    ? makeMetadataSelect({
        name: 'priorityId',
        options: metadata.priorities,
        defaultId: priorityDefault?.id ?? null,
      })
    : null;
  const assigneeSelect = canSetAssignee ? makeAssigneeSelect({ members }) : null;

  const errorEl = h('p', { class: 'modal-error muted' });

  const fieldRow = (label, control) =>
    h(
      'label',
      { class: 'modal-field' },
      h('span', { class: 'modal-field-label' }, label),
      control,
    );

  const body = h(
    'div',
    { class: 'new-issue-form' },
    fieldRow('Name', nameInput),
    fieldRow('Description', descriptionInput),
    statusSelect ? fieldRow('Status', statusSelect) : null,
    categorySelect ? fieldRow('Category', categorySelect) : null,
    prioritySelect ? fieldRow('Priority', prioritySelect) : null,
    assigneeSelect ? fieldRow('Assignee', assigneeSelect) : null,
    errorEl,
  );

  let busy = false;
  let close = () => {};

  async function submit(closeFn) {
    if (busy) return;
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Name is required.';
      nameInput.focus();
      return;
    }
    errorEl.textContent = '';
    busy = true;

    const payload = {
      name,
      description: descriptionInput.value,
    };
    if (statusSelect) payload.statusId = Number.parseInt(statusSelect.value, 10);
    if (categorySelect) payload.categoryId = Number.parseInt(categorySelect.value, 10);
    if (prioritySelect) payload.priorityId = Number.parseInt(prioritySelect.value, 10);
    if (assigneeSelect && assigneeSelect.value !== '') {
      payload.assignedTo = Number.parseInt(assigneeSelect.value, 10);
    }

    try {
      const result = await postJson(`/api/projects/${project.id}/issues`, payload);
      closeFn();
      if (typeof onCreated === 'function') onCreated(result.issue);
      else if (result.issue) {
        location.hash = `#/projects/${project.id}/issues/${result.issue.number}`;
      }
    } catch (err) {
      errorEl.textContent = err?.message
        ? `Could not create issue: ${err.message}`
        : 'Could not create issue.';
      showToast(errorEl.textContent, 'error');
    } finally {
      busy = false;
    }
  }

  close = openModal({
    title: 'New issue',
    body,
    actions: [
      { label: 'Cancel' },
      { label: 'Create issue', kind: 'primary', onClick: submit },
    ],
  });

  queueMicrotask(() => nameInput.focus());

  return close;
}
