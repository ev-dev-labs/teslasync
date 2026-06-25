import {useMutation, useQuery} from '@tanstack/react-query';

import {request, type ApiRequestOptions} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  STANDARD: 30_000,
  SLOW: 60_000,
} as const;

const STALE_TIMES = {
  MODERATE: 15_000,
  FAST: 30_000,
} as const;

const WATCH_API_KEY_STORAGE_KEY = 'teslasync-watch-key';

let watchApiKey = '';

export const nativeWatchApiKeyCapabilities = {
  storageKey: WATCH_API_KEY_STORAGE_KEY,
  urlSearchParamsAvailable: false,
  sessionStorageAvailable: false,
  moduleMemoryPersistence: true,
  nativeKeyInjection: 'setWatchApiKey or setWatchApiKeyFromUrl',
} as const;

function extractKeyFromUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) {
    return '';
  }

  const hashStart = url.indexOf('#', queryStart);
  const query = url.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
  for (const pair of query.split('&')) {
    const [rawName, rawValue = ''] = pair.split('=');
    if (decodeURIComponent(rawName.replace(/\+/g, ' ')) === 'key') {
      return decodeURIComponent(rawValue.replace(/\+/g, ' '));
    }
  }

  return '';
}

export function setWatchApiKey(apiKey: string | null | undefined): void {
  watchApiKey = apiKey?.trim() ?? '';
}

export function setWatchApiKeyFromUrl(url: string): string {
  const apiKey = extractKeyFromUrl(url);
  if (apiKey) {
    setWatchApiKey(apiKey);
  }
  return apiKey;
}

export function clearWatchApiKey(): void {
  watchApiKey = '';
}

export function getWatchApiKey(): string {
  return watchApiKey;
}

async function watchRequest<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const apiKey = getWatchApiKey();
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

export interface WatchSummary {
  vehicle_name: string;
  state: string;
  battery_level: number;
  range_km: number;
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

interface WatchCommandResult {
  success: boolean;
  message: string;
}

export const watchKeys = {
  summary: (vehicleId?: number) => ['watch-summary', vehicleId] as const,
  complication: (vehicleId?: number) => ['watch-complication', vehicleId] as const,
};

/** Fetch watch summary data. Auto-refreshes every 30 seconds. */
export function useWatchSummary(vehicleId?: number) {
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  return useQuery({
    queryKey: watchKeys.summary(vehicleId),
    queryFn: ({signal}) =>
      watchRequest<WatchSummary>(`/watch/summary${params}`, {signal}),
    refetchInterval: INTERVALS.STANDARD,
    staleTime: STALE_TIMES.MODERATE,
    retry: 2,
  });
}

/** Fetch minimal complication data. */
export function useWatchComplication(vehicleId?: number) {
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  return useQuery({
    queryKey: watchKeys.complication(vehicleId),
    queryFn: ({signal}) =>
      watchRequest<WatchComplication>(`/watch/complication${params}`, {signal}),
    refetchInterval: INTERVALS.SLOW,
    staleTime: STALE_TIMES.FAST,
  });
}

/** Send a command from the watch. */
export function useWatchCommand() {
  const {success, error} = useMutationToast();
  return useMutation<
    WatchCommandResult,
    Error,
    {vehicleId?: number; command: string}
  >({
    mutationFn: ({vehicleId, command}) =>
      watchRequest<WatchCommandResult>('/watch/command', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          vehicle_id: vehicleId ?? 0,
          command,
        }),
      }),
    onSuccess: data => {
      if (data.success) {
        success('toast.watchCommand.success', data.message || 'Command sent');
      } else {
        error(undefined, 'toast.watchCommand.error', data.message || 'Command failed');
      }
    },
    onError: (err: Error) => {
      error(
        undefined,
        'toast.watchCommand.failed',
        `Watch command failed: ${err.message}`,
      );
    },
  });
}
