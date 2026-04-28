const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function parseDbDate(value) {
  if (!value) return null;
  const iso = typeof value === 'string' ? value.replace(' ', 'T') : value;
  const stamped = typeof iso === 'string' && !iso.endsWith('Z') ? `${iso}Z` : iso;
  const d = new Date(stamped);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRelative(value, now = new Date()) {
  const d = parseDbDate(value);
  if (!d) return '';
  const diff = now.getTime() - d.getTime();
  const abs = Math.abs(diff);

  if (abs < 30_000) return 'just now';
  if (abs < HOUR) {
    const m = Math.round(abs / MINUTE);
    return diff >= 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return diff >= 0 ? `${h}h ago` : `in ${h}h`;
  }
  if (abs < WEEK) {
    const days = Math.round(abs / DAY);
    return diff >= 0 ? `${days}d ago` : `in ${days}d`;
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatAbsolute(value) {
  const d = parseDbDate(value);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
