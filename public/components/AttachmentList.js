import { h } from '../lib/state.js';
import { formatRelative, formatAbsolute } from '../lib/relativeTime.js';

const KB = 1024;
const MB = 1024 * KB;

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function isImage(contentType) {
  return typeof contentType === 'string' && contentType.startsWith('image/');
}

function uploaderName(uploader) {
  if (!uploader) return 'someone';
  return uploader.name?.trim() ? uploader.name : uploader.email;
}

export function AttachmentList({ attachments, currentUserId, role, onArchive }) {
  const root = h('div', { class: 'attachments-section' });

  if (!attachments || attachments.length === 0) {
    root.replaceChildren(h('p', { class: 'attachments-empty muted' }, 'No attachments yet.'));
    return root;
  }

  const cards = attachments.map((att) => attachmentCard(att, { currentUserId, role, onArchive }));
  root.replaceChildren(h('div', { class: 'attachments-grid' }, ...cards));
  return root;
}

function attachmentCard(att, { currentUserId, role, onArchive }) {
  const href = `/api/attachments/${att.id}`;
  const card = h('div', { class: 'attachment-card' });

  const preview = isImage(att.content_type)
    ? h(
        'a',
        {
          class: 'attachment-thumb-link',
          href,
          target: '_blank',
          rel: 'noopener',
          title: att.filename,
        },
        h('img', {
          class: 'attachment-thumb',
          src: href,
          alt: att.filename,
          loading: 'lazy',
        }),
      )
    : h(
        'a',
        {
          class: 'attachment-icon-link',
          href,
          target: '_blank',
          rel: 'noopener',
          title: att.filename,
        },
        h('span', { class: 'attachment-icon', 'aria-hidden': 'true' }, fileIcon(att.content_type)),
      );

  const meta = h(
    'div',
    { class: 'attachment-meta' },
    h(
      'a',
      {
        class: 'attachment-filename',
        href,
        target: '_blank',
        rel: 'noopener',
        title: att.filename,
      },
      att.filename,
    ),
    h(
      'div',
      { class: 'attachment-sub muted' },
      h('span', { class: 'attachment-size' }, formatBytes(att.size_bytes)),
      h('span', { class: 'attachment-sep' }, ' · '),
      h(
        'span',
        { class: 'attachment-uploader', title: formatAbsolute(att.created_at) },
        `${uploaderName(att.uploader)} · ${formatRelative(att.created_at)}`,
      ),
    ),
  );

  card.replaceChildren(preview, meta);

  const canArchive =
    typeof onArchive === 'function' &&
    (att.uploaded_by === currentUserId || role === 'developer' || role === 'super_admin');
  if (canArchive && !att.archived_at) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'attachment-archive-btn',
        title: 'Archive attachment',
        onclick: () => onArchive(att),
      },
      'Archive',
    );
    card.appendChild(btn);
  }

  if (att.archived_at) {
    card.classList.add('attachment-archived');
    card.appendChild(h('span', { class: 'attachment-archived-badge' }, 'Archived'));
  }

  return card;
}

function fileIcon(contentType) {
  if (!contentType) return '📄';
  if (contentType === 'application/pdf') return '📕';
  if (contentType.startsWith('text/')) return '📝';
  if (contentType.includes('zip')) return '🗜';
  if (contentType.includes('spreadsheet') || contentType.includes('excel')) return '📊';
  if (contentType.includes('word')) return '📘';
  return '📄';
}
