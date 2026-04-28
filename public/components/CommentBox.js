import { h } from '../lib/state.js';
import { attachMentions } from './MentionInput.js';

export function CommentBox({ initialValue = '', onSubmit, busy, disabled, placeholder, projectId }) {
  const root = h('form', { class: 'comment-box' });

  let value = initialValue ?? '';

  const ta = h('textarea', {
    class: 'comment-box-input field-input',
    rows: 3,
    placeholder: placeholder ?? 'Write a comment…',
    maxLength: 10_000,
    disabled: !!disabled,
    oninput: (e) => {
      value = e.target.value;
      updateButton();
    },
    onkeydown: (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSubmit()) submit();
      }
    },
  });
  ta.value = value;
  if (projectId) attachMentions(ta, { projectId });

  const submitBtn = h(
    'button',
    {
      type: 'submit',
      class: 'modal-btn modal-btn-primary',
    },
    busy ? 'Posting…' : 'Post comment',
  );

  function canSubmit() {
    return !busy && !disabled && value.trim().length > 0;
  }

  function updateButton() {
    submitBtn.disabled = !canSubmit();
  }

  function submit() {
    if (!canSubmit()) return;
    onSubmit(value);
  }

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  root.replaceChildren(
    ta,
    h(
      'div',
      { class: 'comment-box-actions' },
      h('span', { class: 'comment-box-hint muted' }, '⌘/Ctrl + Enter to post'),
      submitBtn,
    ),
  );

  updateButton();
  return root;
}
