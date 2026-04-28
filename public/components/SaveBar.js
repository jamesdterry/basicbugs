import { h } from '../lib/state.js';
import { attachMentions } from './MentionInput.js';

export function SaveBar({ patch, note, onNoteInput, onSave, onDiscard, busy, projectId }) {
  const dirty = patch && Object.keys(patch).length > 0;
  if (!dirty) return null;

  const noteEl = h('textarea', {
    class: 'save-bar-note field-input',
    rows: 2,
    placeholder: 'Optional note (added to the history entry)',
    maxLength: 5_000,
    oninput: (e) => onNoteInput(e.target.value),
  });
  noteEl.value = note ?? '';
  if (projectId) attachMentions(noteEl, { projectId });

  return h(
    'div',
    { class: 'save-bar', role: 'region', 'aria-label': 'Pending changes' },
    h(
      'div',
      { class: 'save-bar-summary' },
      h('strong', {}, summaryText(patch)),
    ),
    noteEl,
    h(
      'div',
      { class: 'save-bar-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn',
          onclick: onDiscard,
          disabled: !!busy,
        },
        'Discard',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn modal-btn-primary',
          onclick: onSave,
          disabled: !!busy,
        },
        busy ? 'Saving…' : 'Save changes',
      ),
    ),
  );
}

const FIELD_LABEL = {
  name: 'Name',
  description: 'Description',
  statusId: 'Status',
  categoryId: 'Category',
  priorityId: 'Priority',
  assignedTo: 'Assignee',
};

function summaryText(patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return '';
  const labels = keys.map((k) => FIELD_LABEL[k] ?? k);
  if (labels.length === 1) return `Pending change: ${labels[0]}`;
  if (labels.length === 2) return `Pending changes: ${labels[0]} and ${labels[1]}`;
  return `Pending changes: ${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}
