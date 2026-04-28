import { h } from '../lib/state.js';

export function FilterBar({
  filters,
  metadata,
  members,
  onChange,
  onClearFilters,
  onResetToDefaults,
  isDefault,
}) {
  const current = { ...filters };
  const emit = () => onChange({ ...current });

  const statusSelect = idMultiSelect({
    name: 'status',
    label: 'Status',
    options: metadata.statuses.map((s) => ({ id: s.id, label: s.name })),
    selectedIds: current.status,
    onSelect: (ids) => {
      current.status = ids;
      emit();
    },
  });

  const categorySelect = idMultiSelect({
    name: 'category',
    label: 'Category',
    options: metadata.categories.map((c) => ({ id: c.id, label: c.name })),
    selectedIds: current.category,
    onSelect: (ids) => {
      current.category = ids;
      emit();
    },
  });

  const prioritySelect = idMultiSelect({
    name: 'priority',
    label: 'Priority',
    options: metadata.priorities.map((p) => ({ id: p.id, label: p.name })),
    selectedIds: current.priority,
    onSelect: (ids) => {
      current.priority = ids;
      emit();
    },
  });

  const assigneeSelect = assigneeMultiSelect({
    members,
    selected: current.assignee,
    onSelect: (vals) => {
      current.assignee = vals;
      emit();
    },
  });

  const searchInput = h('input', {
    type: 'search',
    name: 'q',
    placeholder: 'Search by name…',
    value: current.q,
    maxLength: 200,
    oninput: (e) => {
      current.q = e.target.value;
      emit();
    },
  });

  const archivedCheckbox = h('input', {
    type: 'checkbox',
    name: 'archived',
    checked: current.archived,
    onchange: (e) => {
      current.archived = !!e.target.checked;
      emit();
    },
  });

  const archivedLabel = h(
    'label',
    { class: 'filter-bar-archived' },
    archivedCheckbox,
    ' Show archived',
  );

  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'filter-bar-link',
      disabled: !!isDefault,
      onclick: (e) => {
        e.preventDefault();
        onClearFilters();
      },
    },
    'Clear filters',
  );

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'filter-bar-link',
      onclick: (e) => {
        e.preventDefault();
        onResetToDefaults();
      },
    },
    'Reset to defaults',
  );

  return h(
    'section',
    { class: 'filter-bar', role: 'region', 'aria-label': 'Filters' },
    h(
      'div',
      { class: 'filter-bar-row' },
      field('Search', searchInput),
      statusSelect.node,
      categorySelect.node,
      prioritySelect.node,
      assigneeSelect.node,
    ),
    h(
      'div',
      { class: 'filter-bar-row filter-bar-row-secondary' },
      archivedLabel,
      h('span', { class: 'filter-bar-spacer' }),
      clearBtn,
      resetBtn,
    ),
  );
}

function field(label, control) {
  return h(
    'label',
    { class: 'filter-bar-field' },
    h('span', { class: 'filter-bar-label' }, label),
    control,
  );
}

function idMultiSelect({ name, label, options, selectedIds, onSelect }) {
  const select = h(
    'select',
    {
      multiple: true,
      name,
      size: Math.min(Math.max(options.length, 2), 4),
      onchange: (e) => {
        const ids = Array.from(e.target.selectedOptions)
          .map((o) => Number.parseInt(o.value, 10))
          .filter((n) => Number.isInteger(n));
        onSelect(ids);
      },
    },
    ...options.map((o) =>
      h(
        'option',
        {
          value: String(o.id),
          selected: selectedIds.includes(o.id),
        },
        o.label,
      ),
    ),
  );
  return {
    node: h(
      'label',
      { class: 'filter-bar-field' },
      h('span', { class: 'filter-bar-label' }, label),
      select,
    ),
    select,
  };
}

function assigneeMultiSelect({ members, selected, onSelect }) {
  const select = h(
    'select',
    {
      multiple: true,
      name: 'assignee',
      size: Math.min(Math.max(members.length + 1, 2), 4),
      onchange: (e) => {
        const vals = Array.from(e.target.selectedOptions).map((o) => {
          if (o.value === 'unassigned') return 'unassigned';
          const n = Number.parseInt(o.value, 10);
          return Number.isInteger(n) ? n : null;
        });
        onSelect(vals.filter((v) => v != null));
      },
    },
    h(
      'option',
      { value: 'unassigned', selected: selected.includes('unassigned') },
      '— Unassigned —',
    ),
    ...members.map((m) =>
      h(
        'option',
        {
          value: String(m.id),
          selected: selected.includes(m.id),
        },
        m.name && m.name.trim() ? m.name : m.email,
      ),
    ),
  );
  return {
    node: h(
      'label',
      { class: 'filter-bar-field' },
      h('span', { class: 'filter-bar-label' }, 'Assignee'),
      select,
    ),
    select,
  };
}
