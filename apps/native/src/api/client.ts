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

declare global {
  var TESLASYNC_API_BASE_URL: string | undefined;
}

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
  return withSlash.replace(/^\/api\/v1\//, '/');
}

export function apiUrl(path: string): string {
  return `${defaultApiBase()}/api/v1${normalizePath(path)}`;
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
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? {'Content-Type': 'application/json'} : {}),
      ...init.headers,
    },
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
