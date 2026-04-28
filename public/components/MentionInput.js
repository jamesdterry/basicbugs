import { h } from '../lib/state.js';
import { getJson } from '../lib/api.js';

const TOKEN_RE = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_.+-]*)$/;
const memberCache = new Map(); // projectId → Promise<members[]>

function loadMembers(projectId) {
  if (memberCache.has(projectId)) return memberCache.get(projectId);
  const p = getJson(`/api/projects/${projectId}/member-mentions`)
    .then((r) => r.items ?? [])
    .catch(() => []);
  memberCache.set(projectId, p);
  return p;
}

export function clearMentionCache(projectId) {
  if (projectId == null) memberCache.clear();
  else memberCache.delete(projectId);
}

export function attachMentions(textarea, { projectId }) {
  if (!textarea || !projectId) return () => {};

  let members = [];
  loadMembers(projectId).then((m) => {
    members = m;
  });

  let open = false;
  let panel = null;
  let activeIndex = 0;
  let suggestions = [];
  let matchStart = -1; // index where the @ begins
  let matchLen = 0; // length of the @<partial> match including @

  function detect() {
    const upToCaret = textarea.value.slice(0, textarea.selectionStart ?? 0);
    const m = upToCaret.match(TOKEN_RE);
    if (!m) return null;
    const partial = m[1].toLowerCase();
    const start = upToCaret.length - (m[1].length + 1); // includes the @
    return { partial, start, len: m[1].length + 1 };
  }

  function score(member, partial) {
    if (!partial) return 1;
    const local = (member.emailLocal ?? '').toLowerCase();
    const name = (member.name ?? '').toLowerCase();
    if (local === partial || name === partial) return 100;
    if (local.startsWith(partial)) return 50;
    if (name.startsWith(partial)) return 40;
    if (local.includes(partial) || name.includes(partial)) return 10;
    return 0;
  }

  function update() {
    const m = detect();
    if (!m) {
      close();
      return;
    }
    matchStart = m.start;
    matchLen = m.len;
    const partial = m.partial;
    const ranked = members
      .map((mem) => ({ mem, s: score(mem, partial) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.mem);
    suggestions = ranked;
    activeIndex = 0;
    if (suggestions.length === 0) {
      close();
      return;
    }
    if (!open) show();
    render();
  }

  function show() {
    open = true;
    panel = h('div', { class: 'mention-popover', role: 'listbox' });
    // Anchor below the textarea.
    const parent = textarea.parentNode;
    if (!parent) return;
    parent.style.position = parent.style.position || 'relative';
    panel.style.position = 'absolute';
    panel.style.zIndex = '50';
    parent.appendChild(panel);
    positionPanel();
  }

  function positionPanel() {
    if (!panel) return;
    const rect = textarea.getBoundingClientRect();
    const parentRect = panel.parentNode.getBoundingClientRect();
    panel.style.left = `${rect.left - parentRect.left}px`;
    panel.style.top = `${rect.bottom - parentRect.top + 2}px`;
    panel.style.minWidth = '220px';
  }

  function close() {
    open = false;
    if (panel) {
      panel.remove();
      panel = null;
    }
    matchStart = -1;
    matchLen = 0;
    suggestions = [];
  }

  function render() {
    if (!panel) return;
    panel.replaceChildren(
      ...suggestions.map((mem, idx) =>
        h(
          'button',
          {
            type: 'button',
            class: `mention-item${idx === activeIndex ? ' is-active' : ''}`,
            role: 'option',
            'aria-selected': idx === activeIndex ? 'true' : 'false',
            onMouseDown: (e) => {
              // Use mousedown so we beat the textarea's blur.
              e.preventDefault();
              pick(idx);
            },
          },
          h('span', { class: 'mention-item-handle' }, `@${mem.emailLocal}`),
          mem.name && mem.name.trim()
            ? h('span', { class: 'mention-item-name muted' }, mem.name)
            : null,
        ),
      ),
    );
  }

  function pick(idx) {
    const mem = suggestions[idx];
    if (!mem || matchStart < 0) {
      close();
      return;
    }
    const before = textarea.value.slice(0, matchStart);
    const after = textarea.value.slice(matchStart + matchLen);
    const insert = `@${mem.emailLocal} `;
    textarea.value = before + insert + after;
    const caret = before.length + insert.length;
    textarea.selectionStart = caret;
    textarea.selectionEnd = caret;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    textarea.focus();
  }

  function onInput() {
    update();
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onBlur() {
    // Slight delay so click handlers in the panel can resolve.
    setTimeout(() => close(), 100);
  }

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKey);
  textarea.addEventListener('blur', onBlur);

  return () => {
    textarea.removeEventListener('input', onInput);
    textarea.removeEventListener('keydown', onKey);
    textarea.removeEventListener('blur', onBlur);
    close();
  };
}
