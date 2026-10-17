import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { request, type ApiRequestOptions } from '@/api/client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import { subscribe } from '@/lib/broadcast';
import { TOPICS } from '@/lib/broadcastTopics';

// --- Watch-specific API client ---
// Watch requests use API key auth (X-API-Key header) instead of
// cookie/OAuth auth. This avoids triggering the normal auth refresh
// flow on 401 responses.

function getWatchApiKey(persist = true): string {
  // Check URL params first (for PWA bookmark URLs)
  const params = new URLSearchParams(window.location.search);
  const urlKey = params.get('key');
  if (urlKey) {
    // Persist for future requests within this session
    if (persist) sessionStorage.setItem('teslasync-watch-key', urlKey);
    return urlKey;
  }
  return sessionStorage.getItem('teslasync-watch-key') ?? '';
}

/** Local prerequisite only: a configured key can still be rejected by the server. */
export type WatchAvailability = 'configured' | 'not-configured' | 'prerequisite-error';

class WatchPrerequisiteError extends Error {
  constructor() {
    super('Watch access could not be checked');
    this.name = 'WatchPrerequisiteError';
  }
}

function readWatchAvailability(): WatchAvailability {
  try {
    return getWatchApiKey(false) ? 'configured' : 'not-configured';
  } catch {
    // A denied read establishes neither a key nor its absence.
    return 'prerequisite-error';
  }
}

const availabilityListeners = new Set<() => void>();

function recheckWatchAvailability(): void {
  for (const listener of availabilityListeners) listener();
}

function subscribeWatchAvailability(onChange: () => void): () => void {
  availabilityListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'teslasync-watch-key' || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('popstate', onChange);
  window.addEventListener('focus', onChange);
  window.addEventListener('pageshow', onChange);
  document.addEventListener('visibilitychange', onChange);
  const unsubscribe = subscribe(message => {
    if (message.type === TOPICS.SETTINGS_CHANGED) onChange();
  });
  return () => {
    availabilityListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('pageshow', onChange);
    document.removeEventListener('visibilitychange', onChange);
    unsubscribe();
  };
}

function useWatchAvailability(): WatchAvailability {
  return useSyncExternalStore(subscribeWatchAvailability, readWatchAvailability, () => 'prerequisite-error');
}

function useWatchReadCapability(
  availability: WatchAvailability,
  requestError: Error | null,
  refetch: () => unknown,
) {
  const { t } = useTranslation();
  const failed = availability === 'prerequisite-error'
    || (availability === 'configured' && requestError instanceof WatchPrerequisiteError);
  const availabilityError = useMemo(
    () => failed ? new Error(t('watch:capability.readError', 'Watch access could not be checked')) : null,
    [failed, t],
  );
  const recheckAvailability = useCallback(() => {
    recheckWatchAvailability();
    if (readWatchAvailability() === 'configured' && requestError instanceof WatchPrerequisiteError) {
      void refetch();
    }
  }, [requestError, refetch]);
  return {
    availability: failed ? 'prerequisite-error' as const : availability,
    availabilityError,
    recheckAvailability,
  };
}

async function watchRequest<T>(
  path: string,
  options?: ApiRequestOptions,
  requiresKey = false,
): Promise<T> {
  let apiKey: string;
  if (requiresKey) {
    try {
      apiKey = getWatchApiKey();
    } catch {
      throw new WatchPrerequisiteError();
    }
  } else {
    apiKey = getWatchApiKey();
  }
  if (requiresKey && !apiKey) throw new Error('Watch API key required');
  const headers = new Headers(options?.headers);

  headers.set('Accept', 'application/json');
  if (apiKey) {
    headers.set('X-API-Key', apiKey);
  }

  return request<T>(path, {
    ...options,
    skipAuthRefresh: true,
    headers,
  });
}

// --- Types ---

export interface WatchSummary {
  vehicle_name: string;
  state: string;
  battery_level: number;
  range_m: number;
  is_charging: boolean;
  charge_rate: number;
  time_to_full: number;
  is_locked: boolean;
  sentry_mode: boolean;
  inside_temp_c: number;
  outside_temp_c: number;
  is_climate_on: boolean;
  last_updated: string;
}

export interface WatchComplication {
  battery: string;
  range: string;
  state: string;
  charging: boolean;
}

/**
 * Result of `POST /watch/command`.
 *
 * The backend answers HTTP 200 in BOTH the success and the soft-failure
 * case, discriminated by `success`, with the human-readable reason in
 * `message`:
 *   • success → `{ success: true,  message: "Command sent successfully" }`
 *   • failure → `{ success: false, message: "Command failed: <reason>" }`
 *
 * Every field is optional so a 204 / empty / malformed body decodes into an
 * object we can read without throwing on an undefined access.
 */
interface WatchCommandResult {
  success?: boolean;
  message?: string;
}

// --- Hooks ---

export const watchKeys = {
  summary: (vehicleId?: number) => ['watch-summary', vehicleId] as const,
  complication: (vehicleId?: number) => ['watch-complication', vehicleId] as const,
};

/** Fetch watch summary data. Auto-refreshes every 30 seconds. */
export function useWatchSummary(vehicleId?: number) {
  const availability = useWatchAvailability();
  const configured = availability === 'configured';
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  const query = useQuery({
    queryKey: watchKeys.summary(vehicleId),
    queryFn: ({ signal }) => watchRequest<WatchSummary>(`/watch/summary${params}`, { signal }, true),
    enabled: configured,
    refetchInterval: query => configured && !(query.state.error instanceof WatchPrerequisiteError) ? INTERVALS.STANDARD : false,
    staleTime: STALE_TIMES.MODERATE,
    retry: (failureCount, error) => !(error instanceof WatchPrerequisiteError)
      && readWatchAvailability() === 'configured' && failureCount < 2,
  });
  const capability = useWatchReadCapability(availability, query.error, query.refetch);
  return { ...query, ...capability };
}

/** Fetch minimal complication data. */
export function useWatchComplication(vehicleId?: number) {
  const availability = useWatchAvailability();
  const configured = availability === 'configured';
  const defaultRetry = useQueryClient().defaultQueryOptions({ queryKey: watchKeys.complication(vehicleId) }).retry;
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  const query = useQuery({
    queryKey: watchKeys.complication(vehicleId),
    queryFn: ({ signal }) => watchRequest<WatchComplication>(`/watch/complication${params}`, { signal }, true),
    enabled: configured,
    refetchInterval: query => configured && !(query.state.error instanceof WatchPrerequisiteError) ? INTERVALS.SLOW : false,
    staleTime: STALE_TIMES.FAST,
    retry: (failureCount, error) => {
      if (error instanceof WatchPrerequisiteError || readWatchAvailability() !== 'configured') return false;
      if (typeof defaultRetry === 'function') return defaultRetry(failureCount, error);
      return defaultRetry === true || (defaultRetry !== false && failureCount < (defaultRetry ?? 3));
    },
  });
  const capability = useWatchReadCapability(availability, query.error, query.refetch);
  return { ...query, ...capability };
}

/** Send a command from the watch. */
export function useWatchCommand() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ vehicleId, command }: { vehicleId?: number; command: string }) =>
      watchRequest<WatchCommandResult>('/watch/command', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId ?? 0,
          command,
        }),
      }),
    networkMode: 'always',
    // Read `data?.` defensively: a 204 / empty / malformed body must surface
    // the generic failure toast rather than throw on `data.success`.
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(data.message || t('watch.command.success', 'Command sent'));
      } else {
        toast.error(data?.message || t('watch.command.failed', 'Command failed'));
      }
    },
    onError: (err: Error) => {
      toast.error(
        t('watch.command.error', 'Watch command failed: {{message}}', { message: err.message }),
      );
    },
  });
}
