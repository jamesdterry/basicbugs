const ROUTES = [
  { name: 'home', match: (parts) => parts.length === 0 && { params: {} } },
  {
    name: 'projectHome',
    match: (parts) =>
      parts.length === 2 && parts[0] === 'projects' && { params: { id: parts[1] } },
  },
  {
    name: 'issueDetail',
    match: (parts) =>
      parts.length === 4 &&
      parts[0] === 'projects' &&
      parts[2] === 'issues' && { params: { id: parts[1], number: parts[3] } },
  },
  { name: 'admin', match: (parts) => parts[0] === 'admin' && { params: {} } },
  { name: 'me', match: (parts) => parts.length === 1 && parts[0] === 'me' && { params: {} } },
];

export function parseHash(rawHash) {
  const stripped = (rawHash ?? '').replace(/^#\/?/, '');
  const qIndex = stripped.indexOf('?');
  const pathPart = qIndex === -1 ? stripped : stripped.slice(0, qIndex);
  const queryString = qIndex === -1 ? '' : stripped.slice(qIndex + 1);
  const query = parseQuery(queryString);
  const parts = pathPart === '' ? [] : pathPart.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const result = route.match(parts);
    if (result) return { name: route.name, params: { ...result.params, query } };
  }
  return { name: 'notFound', params: { query } };
}

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  const params = new URLSearchParams(qs);
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function startRouter(handlers, mountEl) {
  function dispatch() {
    const { name, params } = parseHash(location.hash);
    const handler = handlers[name] ?? handlers.notFound;
    const node = handler(params) ?? document.createTextNode('');
    mountEl.replaceChildren(node);
  }
  window.addEventListener('hashchange', dispatch);
  dispatch();
  return dispatch;
}

export function navigate(hash) {
  if (location.hash === hash) return;
  location.hash = hash;
}
