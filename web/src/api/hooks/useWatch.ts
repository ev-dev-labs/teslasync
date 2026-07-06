import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { request } from '@/api/client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';

// --- Watch-specific API client ---
// Watch requests use API key auth (X-API-Key header) instead of
// cookie/OAuth auth. This avoids triggering the normal auth refresh
// flow on 401 responses.

function getWatchApiKey(): string {
  // Check URL params first (for PWA bookmark URLs)
  const params = new URLSearchParams(window.location.search);
  const urlKey = params.get('key');
  if (urlKey) {
    // Persist for future requests within this session
    sessionStorage.setItem('teslasync-watch-key', urlKey);
    return urlKey;
  }
  return sessionStorage.getItem('teslasync-watch-key') ?? '';
}

async function watchRequest<T>(path: string, options?: RequestInit): Promise<T> {
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

// --- Types ---

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
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  return useQuery({
    queryKey: watchKeys.summary(vehicleId),
    queryFn: ({ signal }) => watchRequest<WatchSummary>(`/watch/summary${params}`, { signal }),
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
    queryFn: ({ signal }) => watchRequest<WatchComplication>(`/watch/complication${params}`, { signal }),
    refetchInterval: INTERVALS.SLOW,
    staleTime: STALE_TIMES.FAST,
  });
}

/** Send a command from the watch. */
export function useWatchCommand() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ vehicleId, command }: { vehicleId?: number; command: string }) =>
      watchRequest<WatchCommandResult>('/watch/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId ?? 0,
          command,
        }),
      }),
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
