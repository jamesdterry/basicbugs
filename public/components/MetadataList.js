import { h } from '../lib/state.js';

const KIND_LABEL = {
  statuses: 'status',
  categories: 'category',
  priorities: 'priority',
};

export function MetadataList({
  kind,
  items,
  canEdit,
  onCreate,
  onRename,
  onSetDefault,
  onSetClosed,
  onArchive,
  onMove,
}) {
  const root = h('div', { class: 'metadata-list', role: 'list' });
  let dragId = null;

  function singular() {
    return KIND_LABEL[kind] ?? 'item';
  }

  function rowFor(item, index) {
    const row = h('div', {
      class: 'metadata-row',
      role: 'listitem',
      draggable: canEdit ? 'true' : null,
      dataset: { id: String(item.id) },
    });

    if (canEdit) {
      row.addEventListener('dragstart', (e) => {
        dragId = item.id;
        row.classList.add('is-dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(item.id));
        } catch {
          /* some browsers throw if dataTransfer is locked */
        }
      });
      row.addEventListener('dragend', () => {
        dragId = null;
        row.classList.remove('is-dragging');
        for (const r of root.querySelectorAll('.is-drop-target')) {
          r.classList.remove('is-drop-target');
        }
      });
      row.addEventListener('dragover', (e) => {
        if (dragId == null || dragId === item.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-drop-target');
        const movedId = dragId;
        dragId = null;
        if (movedId == null || movedId === item.id) return;
        onMove(movedId, item.id);
      });
    }

    const handle = h(
      'span',
      {
        class: 'drag-handle',
        'aria-hidden': 'true',
        title: canEdit ? `Drag to reorder` : null,
      },
      '⋮⋮',
    );

    const name = item.name;
    const nameEl = canEdit ? renameField(name, (value) => onRename(item.id, value)) : h('span', {}, name);

    const defaultBadge = item.is_default
      ? h('span', { class: 'badge badge-default', title: 'Default' }, 'default')
      : null;
    const closedBadge =
      kind === 'statuses' && item.is_closed
        ? h('span', { class: 'badge badge-closed', title: 'Closed state' }, 'closed')
        : null;

    const actions = h('div', { class: 'metadata-actions' });

    if (canEdit) {
      const upBtn = h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Move ${name} up`,
          disabled: index === 0,
          onClick: () => {
            if (index > 0) onMove(item.id, items[index - 1].id);
          },
        },
        '↑',
      );
      const downBtn = h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Move ${name} down`,
          disabled: index === items.length - 1,
          onClick: () => {
            if (index < items.length - 1) onMove(item.id, items[index + 1].id);
          },
        },
        '↓',
      );
      actions.append(upBtn, downBtn);

      if (!item.is_default) {
        const defaultBtn = h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Make ${name} the default`,
            title: 'Set as default',
            onClick: () => onSetDefault(item.id),
          },
          'Default',
        );
        actions.append(defaultBtn);
      }

      if (kind === 'statuses') {
        const closedBtn = h(
          'button',
          {
            type: 'button',
            class: `icon-btn${item.is_closed ? ' is-active' : ''}`,
            'aria-pressed': item.is_closed ? 'true' : 'false',
            title: item.is_closed ? 'Mark as open state' : 'Mark as closed state',
            onClick: () => onSetClosed(item.id, !item.is_closed),
          },
          item.is_closed ? 'Open' : 'Closed',
        );
        actions.append(closedBtn);
      }

      const archiveBtn = h(
        'button',
        {
          type: 'button',
          class: 'icon-btn icon-btn-danger',
          'aria-label': `Archive ${name}`,
          title: item.is_default ? 'Cannot archive the default' : 'Archive',
          disabled: item.is_default,
          onClick: () => onArchive(item.id),
        },
        'Archive',
      );
      actions.append(archiveBtn);
    }

    row.append(
      handle,
      h('span', { class: 'metadata-name' }, nameEl),
      h('span', { class: 'metadata-badges' }, defaultBadge, closedBadge),
      actions,
    );
    return row;
  }

  items.forEach((item, i) => root.appendChild(rowFor(item, i)));

  if (canEdit) {
    root.appendChild(addRow(singular(), onCreate));
  } else if (!items.length) {
    root.appendChild(h('p', { class: 'muted' }, `No ${singular()} values yet.`));
  }

  return root;
}

function renameField(current, onCommit) {
  let editing = false;
  const wrapper = h('span', { class: 'rename-field' });

  function showDisplay() {
    editing = false;
    wrapper.replaceChildren(
      h(
        'button',
        {
          type: 'button',
          class: 'rename-display',
          title: 'Click to rename',
          onClick: showEditor,
        },
        current,
      ),
    );
  }

  function showEditor() {
    editing = true;
    const input = h('input', {
      type: 'text',
      class: 'rename-input field-input',
      value: current,
      maxlength: '64',
    });
    function submit() {
      const next = input.value.trim().replace(/\s+/g, ' ');
      if (next && next !== current) onCommit(next);
      else showDisplay();
    }
    input.addEventListener('blur', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        showDisplay();
      }
    });
    wrapper.replaceChildren(input);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  }

  // editing flag tracks UI state for the rename field; referenced by closures above.
  showDisplay();
  void editing;
  return wrapper;
}

function addRow(singular, onCreate) {
  const input = h('input', {
    type: 'text',
    class: 'field-input',
    placeholder: `Add ${singular}…`,
    maxlength: '64',
    'aria-label': `New ${singular} name`,
  });
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'modal-btn modal-btn-primary',
      onClick: submit,
    },
    'Add',
  );
  function submit() {
    const value = input.value.trim().replace(/\s+/g, ' ');
    if (!value) return;
    btn.disabled = true;
    Promise.resolve(onCreate(value))
      .then(() => {
        input.value = '';
      })
      .finally(() => {
        btn.disabled = false;
      });
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  return h('div', { class: 'metadata-add' }, input, btn);
}
