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
import { openNewIssueModal } from '../components/NewIssueModal.js';
import { canEditField } from '../components/IssueFields.js';

const PAGE_SIZE = 25;

export function IssueList({ project, metadata, members, currentUserId, initialQuery }) {
  const defaults = filterDefaults(metadata);

  let filters = resolveInitial(defaults, initialQuery, currentUserId, project.id);
  let page = parsePage(initialQuery?.page);
  let items = [];
  let pageInfo = { page, pageSize: PAGE_SIZE, total: 0, totalPages: 0 };
  let pending = false;
  let lastError = null;
  let requestSeq = 0;

  const contentEl = h('div', { class: 'issue-list-content' });
  const filterBarHolder = h('div', { class: 'filter-bar-holder' });
  const toolbarEl = buildToolbar();
  const debouncedFetch = debounce(() => fetchPage(), 200);

  filterBarHolder.replaceChildren(buildFilterBar());

  const root = h('div', { class: 'issue-list' }, toolbarEl, filterBarHolder, contentEl);

  fetchPage();

  return root;

  function buildToolbar() {
    const role = project.role ?? 'viewer';
    const canCreate = canEditField(role, 'name');
    return h(
      'div',
      { class: 'issue-list-toolbar' },
      h('div', { class: 'issue-list-toolbar-spacer' }),
      canCreate
        ? h(
            'button',
            {
              type: 'button',
              class: 'modal-btn modal-btn-primary',
              onclick: () =>
                openNewIssueModal({
                  project,
                  metadata,
                  members,
                  role,
                  onCreated: (issue) => {
                    location.hash = `#/projects/${project.id}/issues/${issue.number}`;
                  },
                }),
            },
            '+ New issue',
          )
        : null,
    );
  }

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
    page = 1;
    persistAndUrl();
    debouncedFetch();
  }

  function handleClearFilters() {
    filters = { ...defaults, status: defaults.status.slice() };
    page = 1;
    persistAndUrl();
    rebuildFilterBar();
    fetchPage();
  }

  function handleResetToDefaults() {
    clearStorage(currentUserId, project.id);
    filters = { ...defaults, status: defaults.status.slice() };
    page = 1;
    updateUrl();
    rebuildFilterBar();
    fetchPage();
  }

  function handleSortChange(nextSort) {
    if (nextSort === filters.sort) return;
    filters = { ...filters, sort: nextSort };
    page = 1;
    persistAndUrl();
    fetchPage();
  }

  function handlePageChange(nextPage) {
    if (pending) return;
    const maxPage = Math.max(1, pageInfo.totalPages);
    const bounded = Math.min(Math.max(1, nextPage), maxPage);
    if (bounded === page) return;
    page = bounded;
    updateUrl();
    fetchPage();
  }

  function persistAndUrl() {
    saveToStorage(currentUserId, project.id, filters);
    updateUrl();
  }

  function updateUrl() {
    const query = serializeToQuery(filters, defaults);
    if (page > 1) query.page = page;
    const queryString = qs(query);
    const target = `#/projects/${project.id}${queryString}`;
    if (location.hash !== target) {
      history.replaceState(null, '', target);
    }
  }

  async function fetchPage() {
    const requestId = ++requestSeq;
    pending = true;
    items = [];
    lastError = null;
    renderContent();

    const queryParams = {
      ...serializeToQuery(filters, defaults),
      limit: PAGE_SIZE,
      page,
    };

    const url = `/api/projects/${project.id}/issues${qs(queryParams)}`;

    try {
      const result = await getJson(url);
      if (requestId !== requestSeq) return;
      let nextPageInfo = normalizePageInfo(result);
      if (nextPageInfo.total === 0 && page > 1) {
        page = 1;
        nextPageInfo = { ...nextPageInfo, page };
        updateUrl();
      }
      if (nextPageInfo.total > 0 && nextPageInfo.totalPages > 0 && page > nextPageInfo.totalPages) {
        page = nextPageInfo.totalPages;
        updateUrl();
        fetchPage();
        return;
      }
      items = result.items ?? [];
      page = nextPageInfo.page;
      pageInfo = nextPageInfo;
    } catch (err) {
      if (requestId !== requestSeq) return;
      lastError = err;
      showToast(
        err?.message ? `Could not load issues: ${err.message}` : 'Could not load issues',
        'error',
      );
    } finally {
      if (requestId === requestSeq) {
        pending = false;
        renderContent();
      }
    }
  }

  function renderContent() {
    contentEl.replaceChildren(buildContent());
  }

  function buildContent() {
    if (pending) {
      return h('p', { class: 'issue-list-loading muted' }, 'Loading issues…');
    }
    if (items.length === 0 && lastError) {
      return h('p', { class: 'issue-list-error' }, 'Could not load issues. Please retry.');
    }
    if (pageInfo.total === 0) {
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
    const total = pageInfo.total;
    const totalPages = pageInfo.totalPages;
    if (totalPages <= 1) {
      return h(
        'p',
        { class: 'issue-list-footer muted' },
        `${total} ${total === 1 ? 'issue' : 'issues'}`,
      );
    }
    const start = (pageInfo.page - 1) * pageInfo.pageSize + 1;
    const end = Math.min(total, start + items.length - 1);
    return h(
      'nav',
      { class: 'issue-list-footer pager', 'aria-label': 'Issue pages' },
      h('span', { class: 'pager-summary muted' }, `Showing ${start}-${end} of ${total} issues`),
      h(
        'div',
        { class: 'pager-controls' },
        pageNavButton('Previous', pageInfo.page - 1, pageInfo.page <= 1),
        ...pageItems(pageInfo.page, totalPages).map((item) =>
          item === 'gap'
            ? h('span', { class: 'pager-gap', 'aria-hidden': 'true' }, '...')
            : pageNumberButton(item),
        ),
        pageNavButton('Next', pageInfo.page + 1, pageInfo.page >= totalPages),
      ),
    );
  }

  function pageNavButton(label, targetPage, disabled) {
    return h(
      'button',
      {
        type: 'button',
        class: 'pager-btn',
        disabled: disabled || pending,
        onclick: () => handlePageChange(targetPage),
      },
      label,
    );
  }

  function pageNumberButton(number) {
    const current = number === pageInfo.page;
    return h(
      'button',
      {
        type: 'button',
        class: `pager-page-btn${current ? ' is-current' : ''}`,
        disabled: current || pending,
        'aria-current': current ? 'page' : null,
        onclick: () => handlePageChange(number),
      },
      String(number),
    );
  }

  function normalizePageInfo(result) {
    const resultPage = Number.isInteger(result.page) && result.page > 0 ? result.page : page;
    const pageSize =
      Number.isInteger(result.pageSize) && result.pageSize > 0 ? result.pageSize : PAGE_SIZE;
    const total =
      Number.isInteger(result.total) && result.total >= 0
        ? result.total
        : (result.items ?? []).length;
    const totalPages =
      Number.isInteger(result.totalPages) && result.totalPages >= 0
        ? result.totalPages
        : Math.ceil(total / pageSize);
    return { page: resultPage, pageSize, total, totalPages };
  }

  function emptyState() {
    if (filtersAreDefault(filters, defaults)) {
      const role = project.role ?? 'viewer';
      const canCreate = canEditField(role, 'name');
      return h(
        'div',
        { class: 'empty-state' },
        h('p', {}, 'No issues yet.'),
        canCreate
          ? h(
              'button',
              {
                type: 'button',
                class: 'modal-btn modal-btn-primary',
                onclick: () =>
                  openNewIssueModal({
                    project,
                    metadata,
                    members,
                    role,
                    onCreated: (issue) => {
                      location.hash = `#/projects/${project.id}/issues/${issue.number}`;
                    },
                  }),
              },
              'Create the first issue',
            )
          : h('p', { class: 'muted' }, 'A project member will create issues here.'),
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
  if (hasPageQuery(initialQuery)) return { ...defaults, status: defaults.status.slice() };
  const fromStorage = loadFromStorage(userId, projectId);
  if (fromStorage) return fromStorage;
  return { ...defaults, status: defaults.status.slice() };
}

function parsePage(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function hasPageQuery(queryObj) {
  return queryObj != null && Object.prototype.hasOwnProperty.call(queryObj, 'page');
}

function pageItems(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);

  if (start > 2) items.push('gap');
  for (let n = start; n <= end; n++) items.push(n);
  if (end < totalPages - 1) items.push('gap');
  items.push(totalPages);

  return items;
}
