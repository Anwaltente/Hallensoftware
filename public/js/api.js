/**
 * REST-Client. Alle Requests laufen über api(); Session per HttpOnly-Cookie.
 * Bei 401 wird das globale Event "auth:required" ausgelöst (Login-Screen).
 */
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError(0, 'Server nicht erreichbar.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('auth:required'));
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Fehler ${res.status}`);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const upload = (p, form) => api(p, { method: 'POST', form });
