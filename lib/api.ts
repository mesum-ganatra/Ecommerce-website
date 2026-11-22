import type { SessionUser } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
/** Uploaded images are stored as /media/... on the API server. */
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '');
export const mediaUrl = (u: string) => (u.startsWith('/media/') ? API_ORIGIN + u : u);
export const PLATFORM_DOMAIN = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost:3000';
// Without your own domain (e.g. on *.vercel.app) stores cannot have subdomains, so they are opened as <domain>/s/<name>.
export const PATH_STORES = process.env.NEXT_PUBLIC_STORE_PATHS === 'true';
/** Short text shown for a store's address, e.g. kababjess.shop.com or shop.vercel.app/s/kababjess */
export const storeAddress = (sub: string) => (PATH_STORES ? `${PLATFORM_DOMAIN}/s/${sub}` : `${sub}.${PLATFORM_DOMAIN}`);
export const storeUrl = (sub: string) => `${PLATFORM_DOMAIN.startsWith('localhost') ? 'http' : 'https'}://${storeAddress(sub)}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

// The access token lives only in memory (never localStorage). The refresh cookie is HttpOnly, set by the API.
let accessToken: string | null = null;
let refreshing: Promise<SessionUser | null> | null = null;
let onAuthLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setAuthLostHandler = (fn: (() => void) | null) => {
  onAuthLost = fn;
};

/** Trades the refresh cookie for a new access token. Calls are shared so rotation never races (React StrictMode runs effects twice). */
export function refreshSession(): Promise<SessionUser | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = (await res.json()) as { accessToken: string; user: SessionUser };
        accessToken = data.accessToken;
        return data.user;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await send(method, path, body);
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Is the API running?');
  }

  // Expired access token: refresh once and retry.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const user = await refreshSession();
    if (user) res = await send(method, path, body);
    else onAuthLost?.();
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);

/** Multipart upload (images, digital files). The browser sets the content type and boundary. */
export async function upload<T>(path: string, field: string, file: File): Promise<T> {
  const send = () => {
    const fd = new FormData();
    fd.append(field, file);
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      body: fd,
    });
  };
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Is the API running?');
  }
  if (res.status === 401) {
    const user = await refreshSession();
    if (user) res = await send();
    else onAuthLost?.();
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Upload failed (${res.status})`);
  return json as T;
}

type UploadedFile = { _id: string; name: string; sizeBytes: number };

/**
 * Adds a file to a digital product. When the API has object storage the file goes straight from the browser to the
 * private bucket (no size limit from the web host); otherwise it falls back to the normal multipart upload.
 */
export async function uploadDigitalFile(storeId: string, productId: string, file: File): Promise<UploadedFile> {
  const base = `/stores/${storeId}/products/${productId}/files`;
  const contentType = file.type || 'application/octet-stream';
  let signed: { key: string; uploadUrl: string; headers: Record<string, string> };
  try {
    signed = await post(`${base}/presign`, { size: file.size, contentType });
  } catch (err) {
    if (err instanceof ApiError && err.status === 501) return upload<UploadedFile>(base, 'file', file);
    throw err;
  }
  let put: Response;
  try {
    put = await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.headers, body: file });
  } catch {
    throw new ApiError(0, 'network', 'The upload was interrupted. Check your connection and try again.');
  }
  if (!put.ok) throw new ApiError(put.status, 'upload_failed', `Storage rejected the upload (${put.status}).`);
  return post<UploadedFile>(`${base}/confirm`, { key: signed.key, name: file.name });
}
