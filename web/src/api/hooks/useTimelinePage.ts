import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { request } from '../client';

/** Point-in-time FSM record; nullable triggers and raw source states are retained. */
export interface TransitionRecord {
  ts: string;
  from_state: string | null;
  to_state: string;
  trigger_field: string | null;
  trigger_value: string | null;
}

/** Narrow envelope matching the original TimelinePage query's consumed DTO. */
export interface TimelineResponse {
  transitions: TransitionRecord[];
}

/** Dwell time remains in SI seconds; percentage is returned without conversion. */
export interface ByStateRow {
  state: string;
  total_seconds: number;
  percentage: number;
  transition_count: number;
}

export interface SummaryResponse {
  vehicle_id: number;
  days: number;
  total_seconds: number;
  by_state: ByStateRow[];
}

/**
 * Exact TimelinePage observer contract. Vehicle IDs deliberately remain strings
 * and unencoded, as in the original query; only the two bounds are encoded.
 * No select, signal forwarding, or local retry/stale/polling policy is added.
 */
export function useTimelinePageTimeline(
  activeId: string,
  startInstant: string,
  endInstantExclusive: string,
): UseQueryResult<TimelineResponse, Error> {
  const rangeQuery = `vehicle_id=${activeId}&start=${encodeURIComponent(startInstant)}&end=${encodeURIComponent(endInstantExclusive)}`;

  return useQuery({
    queryKey: ['vehicle-timeline', activeId, startInstant, endInstantExclusive],
    queryFn: () =>
      request<TimelineResponse>(
        `/vehicle-states/timeline?${rangeQuery}`,
      ),
    enabled: activeId !== '',
  });
}

/** Scalar summary envelope, not an array; preserves the original query policy. */
export function useTimelinePageSummary(
  activeId: string,
  startInstant: string,
  endInstantExclusive: string,
): UseQueryResult<SummaryResponse, Error> {
  const rangeQuery = `vehicle_id=${activeId}&start=${encodeURIComponent(startInstant)}&end=${encodeURIComponent(endInstantExclusive)}`;

  return useQuery({
    queryKey: ['vehicle-summary', activeId, startInstant, endInstantExclusive],
    queryFn: () =>
      request<SummaryResponse>(
        `/vehicle-states/summary?${rangeQuery}`,
      ),
    enabled: activeId !== '',
  });
}
