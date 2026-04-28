import { h } from '../lib/state.js';
import { attachMentions } from './MentionInput.js';

// Shared building blocks for displaying and editing issue fields.
// Used by the inline editor on issue detail and by the new-issue modal.

export const FIELD_MIN_ROLE = Object.freeze({
  name: 'user',
  description: 'user',
  assignedTo: 'user',
  statusId: 'developer',
  categoryId: 'developer',
  priorityId: 'developer',
});

const ROLE_RANK = Object.freeze({ viewer: 1, user: 2, developer: 3, super_admin: 3 });

export function canEditField(role, key) {
  const min = FIELD_MIN_ROLE[key];
  if (!min) return false;
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

export function memberDisplay(user) {
  if (!user) return 'Unassigned';
  if (user.name && user.name.trim()) return user.name;
  return user.email ?? '—';
}

// ---------- Inline editable fields (issue detail) ----------

/**
 * Wraps a value in a click-to-edit cell. The renderDisplay/renderEditor callbacks
 * own their own DOM; the wrapper just toggles which is mounted.
 */
function inlineCell({ editable, label, dirty, displayNode, buildEditor, onCommit }) {
  let editing = false;
  let editorNode = null;

  const wrapper = h('div', {
    class: `field-cell${editable ? ' field-editable' : ''}${dirty ? ' field-dirty' : ''}`,
  });

  function render() {
    wrapper.replaceChildren(
      h('div', { class: 'field-label' }, label),
      editing ? editorNode : displayNode,
    );
  }

  function enterEdit() {
    if (!editable || editing) return;
    editing = true;
    editorNode = buildEditor({
      commit: (value) => {
        onCommit(value);
        editing = false;
        render();
      },
      cancel: () => {
        editing = false;
        render();
      },
    });
    render();
    queueMicrotask(() => {
      const focusable = editorNode.querySelector('input, select, textarea');
      if (focusable) focusable.focus();
    });
  }

  if (editable) {
    wrapper.addEventListener('click', (e) => {
      // Don't re-enter edit when interacting with the editor itself
      if (editing) return;
      if (e.target.closest('a, button')) return;
      enterEdit();
    });
  }

  render();
  return wrapper;
}

export function NameField({ value, role, dirty, onCommit }) {
  const editable = canEditField(role, 'name');
  const display = h('div', { class: 'field-display field-name' }, value || '—');
  return inlineCell({
    editable,
    label: 'Name',
    dirty,
    displayNode: display,
    buildEditor: ({ commit, cancel }) => {
      const input = h('input', {
        type: 'text',
        class: 'field-input',
        value: value ?? '',
        maxLength: 200,
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(input.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        },
        onblur: () => commit(input.value),
      });
      return h('div', { class: 'field-editor' }, input);
    },
    onCommit,
  });
}

export function DescriptionField({ value, role, dirty, onCommit, projectId }) {
  const editable = canEditField(role, 'description');
  const display = h(
    'div',
    { class: 'field-display field-description' },
    value
      ? value
      : h('span', { class: 'muted' }, editable ? 'No description. Click to add.' : 'No description.'),
  );
  return inlineCell({
    editable,
    label: 'Description',
    dirty,
    displayNode: display,
    buildEditor: ({ commit, cancel }) => {
      const ta = h('textarea', {
        class: 'field-input field-textarea',
        rows: 6,
        maxLength: 10_000,
        onkeydown: (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        },
        onblur: () => commit(ta.value),
      });
      ta.value = value ?? '';
      if (projectId) attachMentions(ta, { projectId });
      return h(
        'div',
        { class: 'field-editor' },
        ta,
        h(
          'p',
          { class: 'field-hint muted' },
          'Press Esc to cancel. Click outside to save the change.',
        ),
      );
    },
    onCommit,
  });
}

function metadataField({ label, kind, currentId, options, role, dirty, onCommit }) {
  const editable = canEditField(role, kind);
  const current = options.find((o) => o.id === currentId);
  const display = h(
    'div',
    { class: 'field-display' },
    current ? current.name : h('span', { class: 'muted' }, '—'),
  );
  return inlineCell({
    editable,
    label,
    dirty,
    displayNode: display,
    buildEditor: ({ commit, cancel }) => {
      const select = h(
        'select',
        {
          class: 'field-input',
          onchange: () => {
            const n = Number.parseInt(select.value, 10);
            commit(Number.isInteger(n) ? n : null);
          },
          onkeydown: (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          },
        },
        ...options.map((o) =>
          h('option', { value: String(o.id), selected: o.id === currentId }, o.name),
        ),
      );
      return h('div', { class: 'field-editor' }, select);
    },
    onCommit,
  });
}

export function StatusField({ value, options, role, dirty, onCommit }) {
  return metadataField({
    label: 'Status',
    kind: 'statusId',
    currentId: value,
    options,
    role,
    dirty,
    onCommit,
  });
}

export function CategoryField({ value, options, role, dirty, onCommit }) {
  return metadataField({
    label: 'Category',
    kind: 'categoryId',
    currentId: value,
    options,
    role,
    dirty,
    onCommit,
  });
}

export function PriorityField({ value, options, role, dirty, onCommit }) {
  return metadataField({
    label: 'Priority',
    kind: 'priorityId',
    currentId: value,
    options,
    role,
    dirty,
    onCommit,
  });
}

export function AssigneeField({ value, members, role, dirty, onCommit }) {
  const editable = canEditField(role, 'assignedTo');
  const current = value ? members.find((m) => m.id === value) : null;
  const display = h(
    'div',
    { class: 'field-display' },
    current
      ? memberDisplay(current)
      : h('span', { class: 'muted' }, 'Unassigned'),
  );
  return inlineCell({
    editable,
    label: 'Assignee',
    dirty,
    displayNode: display,
    buildEditor: ({ commit, cancel }) => {
      const select = h(
        'select',
        {
          class: 'field-input',
          onchange: () => {
            if (select.value === '') return commit(null);
            const n = Number.parseInt(select.value, 10);
            commit(Number.isInteger(n) ? n : null);
          },
          onkeydown: (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          },
        },
        h('option', { value: '', selected: value == null }, '— Unassigned —'),
        ...members.map((m) =>
          h(
            'option',
            { value: String(m.id), selected: m.id === value },
            memberDisplay(m),
          ),
        ),
      );
      return h('div', { class: 'field-editor' }, select);
    },
    onCommit,
  });
}

// ---------- Plain controls for the new-issue modal ----------

export function makeNameInput({ value = '' } = {}) {
  return h('input', {
    type: 'text',
    name: 'name',
    class: 'field-input',
    value,
    maxLength: 200,
    required: true,
  });
}

export function makeDescriptionInput({ value = '', projectId } = {}) {
  const ta = h('textarea', {
    name: 'description',
    class: 'field-input field-textarea',
    rows: 5,
    maxLength: 10_000,
  });
  ta.value = value;
  if (projectId) attachMentions(ta, { projectId });
  return ta;
}

export function makeMetadataSelect({ name, options, defaultId }) {
  return h(
    'select',
    { name, class: 'field-input' },
    ...options.map((o) =>
      h(
        'option',
        { value: String(o.id), selected: o.id === defaultId },
        o.name,
      ),
    ),
  );
}

export function makeAssigneeSelect({ members, value = null }) {
  return h(
    'select',
    { name: 'assignedTo', class: 'field-input' },
    h('option', { value: '', selected: value == null }, '— Unassigned —'),
    ...members.map((m) =>
      h(
        'option',
        { value: String(m.id), selected: m.id === value },
        memberDisplay(m),
      ),
    ),
  );
}
