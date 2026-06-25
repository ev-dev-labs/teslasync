import { Platform } from 'react-native';

type ResponseType = 'json' | 'text';
type RequestStatus = 'online' | 'offline' | 'unknown';
type HeadersInput = RequestInit['headers'];

export type ApiRequestOptions = Omit<RequestInit, 'signal'> & {
  responseType?: ResponseType;
  skipAuthRefresh?: boolean;
  signal?: AbortSignal | null;
};

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
  if (error instanceof ApiError) {
    return true;
  }

  if (error && typeof error === 'object' && 'name' in error && 'status' in error) {
    const candidate = error as { name: unknown; status: unknown };
    return candidate.name === 'ApiError' && typeof candidate.status === 'number';
  }

  return false;
}

declare global {
  var TESLASYNC_API_BASE_URL: string | undefined;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function camelCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelCaseKeys);
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const transformed = camelCaseKeys(nested);
      result[key] = transformed;

      const camelKey = snakeToCamel(key);
      if (camelKey !== key) {
        result[camelKey] = transformed;
      }
    }
    return result;
  }

  return value;
}

export function getApiBase(): string {
  const configured = globalThis.TESLASYNC_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.replace(/\/+$/, '');
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

/** Builds a fully qualified API URL for native-owned flows such as downloads. */
export function apiUrl(path: string): string {
  return `${getApiBase()}/api/v1${normalizePath(path)}`;
}

function buildHeaders(headers: HeadersInput | undefined, hasBody: boolean): Headers {
  const merged = new Headers(headers);
  if (!merged.has('Accept')) {
    merged.set('Accept', 'application/json');
  }
  if (hasBody && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return merged;
}

export const SUDO_REQUIRED_CODE = 'SUDO_REQUIRED';
export const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN';

export class SudoCanceledError extends Error {
  constructor(message = 'Reauthentication cancelled by user') {
    super(message);
    this.name = 'SudoCanceledError';
  }
}

export interface SudoCredential {
  mode: 'open' | 'session';
  token?: string;
  expiresAt?: string;
}

export type SudoChallengeProvider = (path: string) => Promise<SudoCredential>;

let sudoProvider: SudoChallengeProvider | null = null;

export function registerSudoChallengeProvider(
  provider: SudoChallengeProvider,
): () => void {
  sudoProvider = provider;
  return () => {
    if (sudoProvider === provider) {
      sudoProvider = null;
    }
  };
}

interface CachedSudoToken {
  token: string;
  expiresAtMs: number;
}

let cachedSudoToken: CachedSudoToken | null = null;

function getCachedSudoToken(): CachedSudoToken | null {
  if (cachedSudoToken == null) {
    return null;
  }

  if (cachedSudoToken.expiresAtMs <= Date.now()) {
    cachedSudoToken = null;
    return null;
  }

  return cachedSudoToken;
}

export function setCachedSudoToken(value: CachedSudoToken | null): void {
  cachedSudoToken = value;
}

export function __resetSudoStateForTests(): void {
  cachedSudoToken = null;
  sudoProvider = null;
}

async function parseError(res: Response): Promise<{ message: string; code?: string }> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const message =
      typeof body.error === 'string' && body.error.trim() !== ''
        ? body.error
        : res.statusText;
    const code =
      typeof body.code === 'string' && body.code.trim() !== ''
        ? body.code
        : undefined;
    return { message, code };
  }

  const text = await res.text().catch(() => '');
  return { message: text || res.statusText };
}

async function directRequest<T>(
  path: string,
  options: RequestInit,
  responseType: ResponseType,
): Promise<T> {
  const { headers, body, ...rest } = options;
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    ...rest,
    body,
    headers: buildHeaders(headers, body != null),
  });

  if (!res.ok) {
    const { message, code } = await parseError(res);
    throw new ApiError(message, res.status, code);
  }

  if (responseType === 'text') {
    return (await res.text()) as T;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return camelCaseKeys(await res.json()) as T;
}

function withSudoToken(headers: HeadersInput | undefined, token: string | null): Headers {
  const merged = new Headers(headers);
  if (token != null) {
    merged.set('X-Sudo-Token', token);
  }
  return merged;
}

function isSudoRequired(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 401 && err.code === SUDO_REQUIRED_CODE;
}

async function challengeForSudo(path: string): Promise<SudoCredential> {
  if (sudoProvider == null) {
    throw new SudoCanceledError('No reauth dialog is mounted');
  }
  return sudoProvider(path);
}

function expiresAtMsFromCredential(cred: SudoCredential): number {
  if (cred.expiresAt != null) {
    const parsed = Date.parse(cred.expiresAt);
    if (!Number.isNaN(parsed) && parsed > Date.now()) {
      return parsed;
    }
  }

  return Date.now() + 5 * 60 * 1000;
}

const inflight = new Map<string, Promise<unknown>>();
let connectionStatus: RequestStatus = 'unknown';

function setConnectionStatus(status: RequestStatus): void {
  connectionStatus = status;
}

export function getConnectionStatus(): RequestStatus {
  return connectionStatus;
}

function dedup<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const pending = run().finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

function makeAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      onAbort = () => {
        cleanup();
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function combineSignals(
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (userSignal == null) {
    return { signal: timeoutSignal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const forwardAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const onUserAbort = () => forwardAbort();
  const onTimeoutAbort = () => forwardAbort();

  if (userSignal.aborted) {
    forwardAbort();
  } else {
    userSignal.addEventListener('abort', onUserAbort, { once: true });
  }

  if (timeoutSignal.aborted) {
    forwardAbort();
  } else {
    timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      userSignal.removeEventListener('abort', onUserAbort);
      timeoutSignal.removeEventListener('abort', onTimeoutAbort);
    },
  };
}

interface ResilientOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  dedupKey?: string;
}

async function doFetch<T>(
  path: string,
  fetchOptions: RequestInit,
  retries: number,
  retryDelay: number,
  timeout: number,
): Promise<T> {
  let lastError: Error | null = null;
  const { signal: rawSignal, headers, body, ...restOptions } = fetchOptions;
  const userSignal = rawSignal ?? undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (userSignal?.aborted) {
      throw makeAbortError();
    }

    const timeoutController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeoutController.abort();
    }, timeout);
    const merged = combineSignals(userSignal, timeoutController.signal);

    try {
      const res = await fetch(apiUrl(path), {
        credentials: 'include',
        ...restOptions,
        body,
        headers: buildHeaders(headers, body != null),
        signal: merged.signal,
      });

      setConnectionStatus('online');

      if (!res.ok) {
        const { message, code } = await parseError(res);
        throw new ApiError(message, res.status, code);
      }

      if (res.status === 204) {
        return undefined as T;
      }

      return camelCaseKeys(await res.json()) as T;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }

      if (userSignal?.aborted) {
        throw makeAbortError();
      }

      const errName =
        err instanceof Error
          ? err.name
          : typeof (err as { name?: unknown })?.name === 'string'
            ? (err as { name: string }).name
            : '';

      if (errName === 'AbortError') {
        lastError = new ApiError('Request timed out', 408);
      } else {
        setConnectionStatus('offline');
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5);
        await abortableSleep(delay, userSignal);
        continue;
      }
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      merged.cleanup();
    }
  }

  throw lastError ?? new ApiError('Request failed', 0);
}

async function resilientFetch<T>(
  path: string,
  options: ResilientOptions = {},
): Promise<T> {
  const {
    retries = 1,
    retryDelay = 1000,
    timeout = 15000,
    dedupKey,
    ...fetchOptions
  } = options;

  const canDedup = !fetchOptions.signal;
  const key =
    canDedup && (!fetchOptions.method || fetchOptions.method === 'GET')
      ? dedupKey ?? path
      : '';

  if (key) {
    return dedup(key, () => doFetch<T>(path, fetchOptions, retries, retryDelay, timeout));
  }

  return doFetch<T>(path, fetchOptions, retries, retryDelay, timeout);
}

export async function request<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    responseType = 'json',
    skipAuthRefresh = false,
    headers,
    ...fetchOptions
  } = options;

  const normalisedPath = normalizePath(path);
  const directResponseType: ResponseType = responseType;
  const cached = getCachedSudoToken();
  const headersWithToken = withSudoToken(headers, cached?.token ?? null);
  const buildRequestOptions = (nextHeaders: Headers): RequestInit => {
    const { signal, ...rest } = fetchOptions;
    return signal == null
      ? { ...rest, headers: nextHeaders }
      : { ...rest, headers: nextHeaders, signal };
  };

  try {
    return await directRequest<T>(
      normalisedPath,
      buildRequestOptions(headersWithToken),
      directResponseType,
    );
  } catch (err) {
    if (isSudoRequired(err)) {
      let cred: SudoCredential;
      try {
        cred = await challengeForSudo(normalisedPath);
      } catch (challengeErr) {
        if (challengeErr instanceof SudoCanceledError) {
          throw challengeErr;
        }
        throw new SudoCanceledError(
          challengeErr instanceof Error ? challengeErr.message : 'Reauth dialog failed',
        );
      }

      if (cred.mode === 'open') {
        return await directRequest<T>(
          normalisedPath,
          buildRequestOptions(withSudoToken(headers, null)),
          directResponseType,
        );
      }

      if (cred.token == null || cred.token.trim() === '') {
        throw new SudoCanceledError('Reauth provider returned no token');
      }

      setCachedSudoToken({
        token: cred.token,
        expiresAtMs: expiresAtMsFromCredential(cred),
      });

      return await directRequest<T>(
        normalisedPath,
        buildRequestOptions(withSudoToken(headers, cred.token)),
        directResponseType,
      );
    }

    if (responseType === 'text' || skipAuthRefresh) {
      throw err;
    }

    return resilientFetch<T>(normalisedPath, buildRequestOptions(headersWithToken));
  }
}
