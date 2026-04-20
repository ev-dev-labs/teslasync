import { useQuery, useMutation } from '@tanstack/react-query';
import { getApiBase } from '@/lib/resilience';

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
  const base = getApiBase();
  const apiKey = getWatchApiKey();

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const res = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json();
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

interface WatchCommandResult {
  success: boolean;
  message: string;
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
    queryFn: () => watchRequest<WatchSummary>(`/watch/summary${params}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  });
}

/** Fetch minimal complication data. */
export function useWatchComplication(vehicleId?: number) {
  const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
  return useQuery({
    queryKey: watchKeys.complication(vehicleId),
    queryFn: () => watchRequest<WatchComplication>(`/watch/complication${params}`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Send a command from the watch. */
export function useWatchCommand() {
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
  });
}
