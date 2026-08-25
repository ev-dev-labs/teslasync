export type OperationalMode = 'live' | 'cached' | 'as_of';

export interface OperationalModeSnapshot {
  mode: OperationalMode;
  asOf: string | null;
  online: boolean;
  isReadOnly: boolean;
}

export const OPERATIONAL_MODE_READ_ONLY_CODE =
  'OPERATIONAL_MODE_READ_ONLY' as const;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function normalizeAsOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function deriveOperationalMode(
  asOf: string | null | undefined,
  online: boolean,
): OperationalModeSnapshot {
  const normalizedAsOf = normalizeAsOf(asOf);
  const mode: OperationalMode = normalizedAsOf
    ? 'as_of'
    : online
      ? 'live'
      : 'cached';

  return {
    mode,
    asOf: normalizedAsOf,
    online,
    isReadOnly: mode !== 'live',
  };
}

export function readOperationalModeFromEnvironment(): OperationalModeSnapshot {
  if (typeof window === 'undefined') {
    return deriveOperationalMode(null, true);
  }

  const asOf = new URLSearchParams(window.location.search).get('as_of');
  const online =
    typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return deriveOperationalMode(asOf, online);
}

export class OperationalModeWriteError extends Error {
  readonly code = OPERATIONAL_MODE_READ_ONLY_CODE;
  readonly mode: OperationalMode;

  constructor(mode: OperationalMode) {
    super(
      mode === 'as_of'
        ? 'Changes are unavailable while viewing historical data. Return to live mode first.'
        : 'Changes are unavailable while offline. Reconnect before trying again.',
    );
    this.name = 'OperationalModeWriteError';
    this.mode = mode;
  }
}

export function assertOperationalWriteAllowed(
  method: string | undefined,
  requiresLiveMode = false,
): void {
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  if (READ_METHODS.has(normalizedMethod) || !requiresLiveMode) return;

  const snapshot = readOperationalModeFromEnvironment();
  if (snapshot.isReadOnly) {
    throw new OperationalModeWriteError(snapshot.mode);
  }
}

export function isOperationalModeWriteError(
  error: unknown,
): error is OperationalModeWriteError {
  return (
    error instanceof OperationalModeWriteError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === OPERATIONAL_MODE_READ_ONLY_CODE)
  );
}
