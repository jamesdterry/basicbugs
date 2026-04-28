import { h } from '../lib/state.js';
import { getJson, qs } from '../lib/api.js';
import { debounce } from '../lib/debounce.js';
import {
  defaults as filterDefaults,
  parseFromQuery,
  serializeToQuery,
  loadFromStorage,
  saveToStorage,
  clearStorage,
  isDefault as filtersAreDefault,
} from '../lib/filters.js';
import { FilterBar } from '../components/FilterBar.js';
import { IssueTable } from '../components/IssueTable.js';
import { showToast } from '../components/Toast.js';

export function IssueList({ project, metadata, members, currentUserId, initialQuery }) {
  const defaults = filterDefaults(metadata);

  let filters = resolveInitial(defaults, initialQuery, currentUserId, project.id);
  let items = [];
  let nextCursor = null;
  let pending = false;
  let lastError = null;

  const contentEl = h('div', { class: 'issue-list-content' });
  const filterBarHolder = h('div', { class: 'filter-bar-holder' });
  const debouncedFetch = debounce(() => fetchPage({ reset: true }), 200);

  filterBarHolder.replaceChildren(buildFilterBar());

  const root = h(
    'div',
    { class: 'issue-list' },
    filterBarHolder,
    contentEl,
  );

  fetchPage({ reset: true });

  return root;

  function buildFilterBar() {
    return FilterBar({
      filters,
      metadata,
      members,
      onChange: handleFilterChange,
      onClearFilters: handleClearFilters,
      onResetToDefaults: handleResetToDefaults,
      isDefault: filtersAreDefault(filters, defaults),
    });
  }

  function rebuildFilterBar() {
    filterBarHolder.replaceChildren(buildFilterBar());
  }

  function handleFilterChange(next) {
    filters = next;
    persistAndUrl();
    debouncedFetch();
  }

  function handleClearFilters() {
    filters = { ...defaults, status: defaults.status.slice() };
    persistAndUrl();
    rebuildFilterBar();
    fetchPage({ reset: true });
  }

  function handleResetToDefaults() {
    clearStorage(currentUserId, project.id);
    filters = { ...defaults, status: defaults.status.slice() };
    updateUrl();
    rebuildFilterBar();
    fetchPage({ reset: true });
  }

  function handleSortChange(nextSort) {
    if (nextSort === filters.sort) return;
    filters = { ...filters, sort: nextSort };
    persistAndUrl();
    fetchPage({ reset: true });
  }

  function handleLoadMore() {
    if (pending || !nextCursor) return;
    fetchPage({ reset: false });
  }

  function persistAndUrl() {
    saveToStorage(currentUserId, project.id, filters);
    updateUrl();
  }

  function updateUrl() {
    const query = serializeToQuery(filters, defaults);
    const queryString = qs(query);
    const target = `#/projects/${project.id}${queryString}`;
    if (location.hash !== target) {
      history.replaceState(null, '', target);
    }
  }

  async function fetchPage({ reset }) {
    pending = true;
    if (reset) {
      items = [];
      nextCursor = null;
    }
    lastError = null;
    renderContent();

    const queryParams = {
      ...serializeToQuery(filters, defaults),
      // Always send `archived` explicitly so non-default-true is preserved
      // (serializeToQuery already handles that). Default-false is omitted.
    };
    if (!reset && nextCursor) queryParams.cursor = nextCursor;

    const url = `/api/projects/${project.id}/issues${qs(queryParams)}`;

    try {
      const result = await getJson(url);
      items = reset ? result.items : [...items, ...result.items];
      nextCursor = result.nextCursor ?? null;
    } catch (err) {
      lastError = err;
      showToast(err?.message ? `Could not load issues: ${err.message}` : 'Could not load issues', 'error');
    } finally {
      pending = false;
      renderContent();
    }
  }

  function renderContent() {
    contentEl.replaceChildren(buildContent());
  }

  function buildContent() {
    if (items.length === 0 && pending) {
      return h('p', { class: 'issue-list-loading muted' }, 'Loading issues…');
    }
    if (items.length === 0 && lastError) {
      return h('p', { class: 'issue-list-error' }, 'Could not load issues. Please retry.');
    }
    if (items.length === 0) {
      return emptyState();
    }
    return h(
      'div',
      {},
      IssueTable({
        items,
        projectId: project.id,
        sort: filters.sort,
        onSortChange: handleSortChange,
      }),
      paginationFooter(),
    );
  }

  function paginationFooter() {
    if (nextCursor == null) {
      return h('p', { class: 'issue-list-footer muted' }, `${items.length} ${items.length === 1 ? 'issue' : 'issues'}`);
    }
    return h(
      'div',
      { class: 'issue-list-footer' },
      h(
        'button',
        {
          type: 'button',
          class: 'load-more-btn',
          disabled: pending,
          onclick: handleLoadMore,
        },
        pending ? 'Loading…' : 'Load more',
      ),
    );
  }

  function emptyState() {
    if (filtersAreDefault(filters, defaults)) {
      return h(
        'div',
        { class: 'empty-state' },
        h('p', {}, 'No issues yet.'),
        h('p', { class: 'muted' }, 'Issue creation lands in Stage 7.'),
      );
    }
    return h(
      'div',
      { class: 'empty-state' },
      h('p', {}, 'No issues match these filters.'),
      h(
        'button',
        {
          type: 'button',
          class: 'modal-btn modal-btn-primary',
          onclick: handleClearFilters,
        },
        'Clear filters',
      ),
    );
  }
}

function resolveInitial(defaults, initialQuery, userId, projectId) {
  const fromUrl = parseFromQuery(initialQuery, defaults);
  if (fromUrl) return fromUrl;
  const fromStorage = loadFromStorage(userId, projectId);
  if (fromStorage) return fromStorage;
  return { ...defaults, status: defaults.status.slice() };
}
