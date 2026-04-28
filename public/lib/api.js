async function request(method, url, body) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('unauthorized');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json response */
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const getJson = (url) => request('GET', url);
export const postJson = (url, body = {}) => request('POST', url, body);
export const patchJson = (url, body = {}) => request('PATCH', url, body);
export const deleteJson = (url) => request('DELETE', url);

export function qs(obj) {
  if (!obj) return '';
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
    } else {
      const s = String(value);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(s)}`);
    }
  }
  return parts.length === 0 ? '' : '?' + parts.join('&');
}
