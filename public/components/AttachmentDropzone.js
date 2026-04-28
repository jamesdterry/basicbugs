import { h } from '../lib/state.js';

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
]);

const ACCEPT_ATTR = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
  '.md',
  '.zip',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
].join(',');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * AttachmentDropzone — reusable drag-drop / click-to-browse upload control.
 *
 * mode = 'pending':
 *   - Stages files in a closure; parent reads them via getPending().
 *   - Used in NewIssueModal and beside the comment box, where uploads happen
 *     after the parent action (issue create / comment post) succeeds.
 *
 * mode = 'immediate':
 *   - Calls onFiles(File[]) on drop/select. Parent uploads and refetches.
 *   - Used on the issue detail Attachments section.
 *
 * Returns a DOM node with a `getPending()` method attached (only useful in
 * pending mode) and a `clear()` method.
 */
export function AttachmentDropzone({
  mode = 'immediate',
  onFiles,
  onError,
  disabled = false,
  label = 'Drop files here, or click to browse',
} = {}) {
  const root = h('div', { class: 'dropzone' });
  if (disabled) root.classList.add('dropzone-disabled');

  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    class: 'dropzone-input',
    accept: ACCEPT_ATTR,
  });

  const labelEl = h(
    'label',
    { class: 'dropzone-label' },
    h('span', { class: 'dropzone-cta' }, label),
    h(
      'span',
      { class: 'dropzone-hint muted' },
      `Up to ${formatBytes(MAX_BYTES)}. Images, PDF, txt, csv, zip, Office docs.`,
    ),
    fileInput,
  );

  const list = h('div', { class: 'dropzone-pending-list' });
  root.replaceChildren(labelEl, list);

  let pending = [];

  function reportError(message) {
    if (typeof onError === 'function') onError(message);
  }

  function validateAndAccept(files) {
    const accepted = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        reportError(`${f.name} is too large (${formatBytes(f.size)} > 25 MB)`);
        continue;
      }
      const type = (f.type || '').toLowerCase();
      if (type && !ALLOWED_MIME.has(type)) {
        reportError(`${f.name}: unsupported type (${type})`);
        continue;
      }
      accepted.push(f);
    }
    return accepted;
  }

  function renderPending() {
    list.replaceChildren(
      ...pending.map((file, idx) =>
        h(
          'div',
          { class: 'dropzone-pending-item' },
          h('span', { class: 'dropzone-pending-name' }, file.name),
          h('span', { class: 'dropzone-pending-size muted' }, formatBytes(file.size)),
          h(
            'button',
            {
              type: 'button',
              class: 'dropzone-pending-remove',
              title: 'Remove',
              onclick: () => {
                pending.splice(idx, 1);
                renderPending();
              },
            },
            '×',
          ),
        ),
      ),
    );
  }

  function ingest(files) {
    if (disabled) return;
    const accepted = validateAndAccept(Array.from(files ?? []));
    if (accepted.length === 0) return;
    if (mode === 'pending') {
      pending.push(...accepted);
      renderPending();
    } else if (typeof onFiles === 'function') {
      onFiles(accepted);
    }
  }

  fileInput.addEventListener('change', (e) => {
    ingest(e.target.files);
    e.target.value = '';
  });

  root.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!disabled) root.classList.add('dropzone-active');
  });
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!disabled) root.classList.add('dropzone-active');
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root) root.classList.remove('dropzone-active');
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('dropzone-active');
    if (!e.dataTransfer?.files) return;
    ingest(e.dataTransfer.files);
  });

  root.getPending = () => pending.slice();
  root.clear = () => {
    pending = [];
    renderPending();
  };
  return root;
}

export const ATTACHMENT_LIMITS = Object.freeze({ MAX_BYTES, ALLOWED_MIME });
