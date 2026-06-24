import { Platform } from 'react-native';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

declare global {
  var TESLASYNC_API_BASE_URL: string | undefined;
}

type QueryParamPrimitive = string | number | boolean;
export type QueryParamValue =
  | QueryParamPrimitive
  | readonly QueryParamPrimitive[]
  | null
  | undefined;

interface CachedSudoToken {
  token: string;
  expiresAtMs: number;
}

let cachedSudoToken: CachedSudoToken | null = null;

function defaultApiBase(): string {
  if (globalThis.TESLASYNC_API_BASE_URL) {
    return globalThis.TESLASYNC_API_BASE_URL.replace(/\/$/, '');
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8080';
  }

  return 'http://localhost:8080';
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
}

export function apiUrl(path: string): string {
  return `${defaultApiBase()}/api/v1${normalizePath(path)}`;
}

export function buildQueryPath(path: string, params: Record<string, QueryParamValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        search.append(key, value.map(String).join(','));
      }
      continue;
    }

    search.append(key, String(value));
  }

  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function setCachedSudoToken(token: CachedSudoToken | null): void {
  cachedSudoToken = token;
}

function getCachedSudoToken(nowMs = Date.now()): CachedSudoToken | null {
  if (!cachedSudoToken) {
    return null;
  }

  if (cachedSudoToken.expiresAtMs <= nowMs) {
    cachedSudoToken = null;
    return null;
  }

  return cachedSudoToken;
}

function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const sudoToken = getCachedSudoToken();
  if (sudoToken && !headers.has('X-Sudo-Token')) {
    headers.set('X-Sudo-Token', sudoToken.token);
  }

  return headers;
}

async function parseError(response: Response): Promise<{message: string; code?: string}> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      message: typeof body.error === 'string' ? body.error : response.statusText,
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  }

  const text = await response.text().catch(() => '');
  return {message: text || response.statusText};
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: buildHeaders(init),
  });

  if (!response.ok) {
    const {message, code} = await parseError(response);
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
