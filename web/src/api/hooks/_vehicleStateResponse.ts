import type { StateSummaryResponse, StateTimelineResponse } from '@/types/analytics';

function envelope(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validWindow(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.vehicle_id) && Number(value.vehicle_id) > 0
    && Number.isSafeInteger(value.days) && Number(value.days) >= 1
    && typeof value.start === 'string' && Number.isFinite(Date.parse(value.start))
    && typeof value.end === 'string' && Number.isFinite(Date.parse(value.end))
    && Date.parse(value.start) < Date.parse(value.end);
}

const nullableString = (value: unknown): boolean =>
  value === null || typeof value === 'string';

export function assertStateTimelineResponse(value: unknown): StateTimelineResponse {
  const data = envelope(value);
  if (!data || !validWindow(data) || !Array.isArray(data.transitions)
    || !data.transitions.every((item: unknown) => {
      const row = envelope(item);
      return row !== null
        && typeof row.ts === 'string' && Number.isFinite(Date.parse(row.ts))
        && nullableString(row.from_state)
        && typeof row.to_state === 'string' && row.to_state.length > 0
        && nullableString(row.trigger_field) && nullableString(row.trigger_value);
    })) {
    throw new Error('Invalid vehicle state timeline response');
  }
  return value as StateTimelineResponse;
}

export function assertStateSummaryResponse(value: unknown): StateSummaryResponse {
  const data = envelope(value);
  if (!data || !validWindow(data)
    || typeof data.total_seconds !== 'number' || !Number.isFinite(data.total_seconds)
    || data.total_seconds < 0 || !Array.isArray(data.by_state)
    || !data.by_state.every((item: unknown) => {
      const row = envelope(item);
      return row !== null
        && typeof row.state === 'string' && row.state.length > 0
        && typeof row.total_seconds === 'number' && Number.isFinite(row.total_seconds)
        && row.total_seconds >= 0
        && typeof row.percentage === 'number' && Number.isFinite(row.percentage)
        && row.percentage >= 0 && row.percentage <= 100
        && Number.isSafeInteger(row.transition_count) && Number(row.transition_count) >= 0;
    })) {
    throw new Error('Invalid vehicle state summary response');
  }
  return value as StateSummaryResponse;
}
