import { hashKey, useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { validateAnalyticalHistory } from '@/lib/analyticalHistory';
import { STALE_TIMES } from '@/lib/constants';
import type { Drive } from '@/types/driving';
import type { SearchToken } from '@/lib/searchQuery';

export interface DriveGridScope {
  start: string;
  end: string;
  timezone: string;
}

export interface DriveGridQuery {
  sort?: string;
  direction?: 'asc' | 'desc';
  collection?: string;
  fsd?: string;
  status?: string;
  text?: Record<string, string>;
  minimum?: Record<string, number>;
  grade?: string;
  invalid?: boolean;
  values?: Record<string, { exclude: boolean; keys: unknown[] }>;
  search?: Array<SearchToken & { target?: number }>;
  locale: string;
  precision: number;
  distance_unit_scale?: number;
}

interface DriveGridPage {
  items: Drive[];
  total: number;
  page: number;
}

export interface DriveGridStats {
  count: number;
  total_distance_m: number;
  total_duration_s: number;
  total_energy_wh: number;
  energy_measured_count: number;
  efficiency_measured_count: number;
  efficiency_wh_per_m: number | null;
  top_speed_mps: number | null;
  longest_distance_m: number | null;
}

export interface DriveGridOverview {
  current: DriveGridStats;
  prior: DriveGridStats | null;
  days: Array<DriveGridStats & { date: string }>;
  evidence: Array<Pick<Drive, 'id' | 'startTs' | 'endTs' | 'distanceM' | 'energyUsedWh' | 'startAddress' | 'endAddress'> & { anomalous: boolean }>;
  anomaly_count: number;
  notable_count: number;
  commute_count: number;
  route_context_count: number;
}

export interface DriveGridFacet {
  value: string | number | null;
  count: number;
}

export const DRIVE_GRID_MAX_SELECTION = 500;

type View = 'page' | 'overview' | 'values' | 'ids';
function requestDriveGrid<T>(vehicleId: number, scope: DriveGridScope, view: View, args: Record<string, string>, signal: AbortSignal) {
  const parameters = new URLSearchParams({ vehicle_id: String(vehicleId), ...scope, view, ...args });
  return request<T>(`/drives?${parameters}`, { signal });
}

export function useDriveGridPage(vehicleId: number | null, scope: DriveGridScope, grid: DriveGridQuery, page: number, size: number) {
  const args = { grid: JSON.stringify(grid), limit: String(size), offset: String((page - 1) * size) };
  const filteredScope = ['drives', vehicleId, 'grid-page', scope, grid];
  return useQuery<DriveGridPage>({
    queryKey: [...filteredScope, page, size],
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
    // Keep navigation focused during a page change, without showing the old rows.
    placeholderData: (previous, source) => source && hashKey(source.queryKey.slice(0, -2)) === hashKey(filteredScope)
      ? previous : undefined,
    queryFn: async ({ signal }) => {
      const result = await requestDriveGrid<DriveGridPage>(vehicleId!, scope, 'page', args, signal);
      if (!result || !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) || result.page < 1
        || !Array.isArray(result.items) || result.items.length > size) throw new Error('Invalid drive page response');
      validateAnalyticalHistory(result.items, 'drive');
      return result;
    },
  });
}

export function useDriveGridOverview(vehicleId: number | null, scope: DriveGridScope, priorStart?: string) {
  return useQuery({
    queryKey: ['drives', vehicleId, 'grid-overview', scope, priorStart],
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
    queryFn: async ({ signal }) => {
      const overview = await requestDriveGrid<DriveGridOverview>(vehicleId!, scope, 'overview', priorStart ? { prior_start: priorStart } : {}, signal);
      if (!overview?.current || !Array.isArray(overview.days) || !Array.isArray(overview.evidence))
        throw new Error('Invalid drive overview response');
      return overview;
    },
  });
}

export function useDriveGridValues(vehicleId: number, scope: DriveGridScope, field: string, locale: string, precision: number, enabled: boolean) {
  return useQuery({
    queryKey: ['drives', vehicleId, 'grid-values', scope, field, locale, precision],
    enabled,
    staleTime: STALE_TIMES.FAST,
    queryFn: ({ signal }) => requestDriveGrid<DriveGridFacet[]>(vehicleId, scope, 'values', {
      field, grid: JSON.stringify({ locale, precision }),
    }, signal),
  });
}

export async function getMatchingDriveIds(vehicleId: number, scope: DriveGridScope, grid: DriveGridQuery, signal: AbortSignal) {
  const ids = await requestDriveGrid<number[]>(vehicleId, scope, 'ids', { grid: JSON.stringify(grid) }, signal);
  if (!Array.isArray(ids) || ids.length > DRIVE_GRID_MAX_SELECTION || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Invalid drive selection response');
  }
  return ids;
}
