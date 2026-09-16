import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopeKey, scopedPath, type QueryScope } from '../scope';
import type {
  ScienceChargeIR,
  ScienceElectrochem,
  ScienceNotebook,
  ScienceThermal,
  ScienceTires,
  ScienceWeather,
} from '../types';

export const scienceKeys = {
  electrochem: (scope: QueryScope) => ['science', 'electrochem', ...scopeKey(scope)] as const,
  thermal: (scope: QueryScope) => ['science', 'thermal', ...scopeKey(scope)] as const,
  weather: (scope: QueryScope) => ['science', 'weather', ...scopeKey(scope)] as const,
  tires: (scope: QueryScope) => ['science', 'tires', ...scopeKey(scope)] as const,
  notebook: (scope: QueryScope) => ['science', 'notebook', ...scopeKey(scope)] as const,
  chargeIr: (sessionId: string) => ['science', 'charge-ir', sessionId] as const,
};

export interface ScienceWindow {
  vehicleId: string | undefined;
  start?: string | null;
  end?: string | null;
}

function windowScope({ vehicleId, start, end }: ScienceWindow): QueryScope {
  return { vehicleId: vehicleId ?? null, start: start ?? null, end: end ?? null };
}

export function useScienceElectrochem(window: ScienceWindow) {
  const scope = windowScope(window);
  return useQuery({
    queryKey: scienceKeys.electrochem(scope),
    queryFn: ({ signal }) => request<ScienceElectrochem>(scopedPath('/science/electrochem', scope), { signal }),
    enabled: !!window.vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useScienceThermal(window: ScienceWindow) {
  const scope = windowScope(window);
  return useQuery({
    queryKey: scienceKeys.thermal(scope),
    queryFn: ({ signal }) => request<ScienceThermal>(scopedPath('/science/thermal', scope), { signal }),
    enabled: !!window.vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useScienceWeather(window: ScienceWindow) {
  const scope = windowScope(window);
  return useQuery({
    queryKey: scienceKeys.weather(scope),
    queryFn: ({ signal }) => request<ScienceWeather>(scopedPath('/science/weather', scope), { signal }),
    enabled: !!window.vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useScienceTires(window: ScienceWindow) {
  const scope = windowScope(window);
  return useQuery({
    queryKey: scienceKeys.tires(scope),
    queryFn: ({ signal }) => request<ScienceTires>(scopedPath('/science/tires', scope), { signal }),
    enabled: !!window.vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useScienceNotebook(window: ScienceWindow) {
  const scope = windowScope(window);
  return useQuery({
    queryKey: scienceKeys.notebook(scope),
    queryFn: ({ signal }) => request<ScienceNotebook>(scopedPath('/science/notebook', scope), { signal }),
    enabled: !!window.vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useScienceChargeIR(sessionId: string | undefined) {
  return useQuery({
    queryKey: scienceKeys.chargeIr(sessionId ?? ''),
    queryFn: ({ signal }) => request<ScienceChargeIR>(`/science/charging/${sessionId}/ir`, { signal }),
    enabled: !!sessionId,
    ...queryPolicy('historical'),
  });
}
