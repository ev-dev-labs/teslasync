/**
 * TanStack Query hooks for the Alert Studio message-template helper endpoints:
 *
 *   - GET  /api/v1/alerts/message-presets
 *   - GET  /api/v1/alerts/message-placeholders
 *   - POST /api/v1/alerts/message-preview
 *
 * Kept separate from `useAlerts.ts` so editor-only helpers do not expand the
 * AlertRule mutation surface for every notification render.
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { useSettings } from './useSettings';
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
  AlertMessagePreviewRequest,
  AlertMessagePreviewResponse,
  AlertRuleKind,
  AlertRuleOp,
} from '@/api/types';

/**
 * Stable query keys for the message-helper endpoints. The catalog
 * responses also depend on persisted display preferences. Consumers include
 * the formatting fingerprint so settings changes cannot retain stale examples.
 */
export const alertMessageKeys = {
  presets: (kind?: AlertRuleKind | '') => ['alerts', 'message-presets', kind ?? ''] as const,
  placeholders: (kind?: AlertRuleKind | '', signalName?: string, op?: AlertRuleOp, metricId?: string | null) =>
    ['alerts', 'message-placeholders', kind ?? '', signalName ?? '', op ?? '', metricId ?? ''] as const,
};

/**
 * Fetches the curated preset gallery. `kind` is optional; passing it
 * filters the catalog to either signal- or metric-only entries plus
 * the universal "" entries.
 */
export function useAlertMessageFormattingKey() {
  const { data: settings } = useSettings();
  return JSON.stringify([
    settings?.decimal_precision, settings?.locale, settings?.language,
    settings?.unit_of_length, settings?.unit_of_temp, settings?.unit_of_pressure,
    settings?.currency_symbol, settings?.tz_display_default, settings?.timezone_user,
    settings?.time_format_default,
  ]);
}

export function useAlertMessagePresets(kind?: AlertRuleKind | '', draft?: {
  signal_name?: string;
  op?: AlertRuleOp;
  metric_id?: string | null;
  vehicle_timezone?: string;
}) {
  const formattingKey = useAlertMessageFormattingKey();
  const signalName = draft?.signal_name;
  const op = draft?.op;
  const metricId = draft?.metric_id;
  const vehicleTimezone = draft?.vehicle_timezone;
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (signalName) params.set('signal_name', signalName);
    if (op) params.set('op', op);
    if (metricId) params.set('metric_id', metricId);
    if (vehicleTimezone) params.set('vehicle_timezone', vehicleTimezone);
    return params.size ? `?${params}` : '';
  }, [kind, signalName, op, metricId, vehicleTimezone]);
  return useQuery({
    queryKey: [...alertMessageKeys.presets(kind), signalName ?? '', op ?? '', metricId ?? '', vehicleTimezone ?? '', formattingKey],
    queryFn: ({ signal }) =>
      request<AlertMessagePreset[]>(`/alerts/message-presets${qs}`, { signal }),
    staleTime: STALE_TIMES.EXTENDED,
    // Coerce a null / non-array payload to [] so preset-gallery consumers
    // can `.map`/`.filter` without an extra guard (matches every other
    // list hook in this directory).
    select: safeArray,
  });
}

/**
 * Fetches the autocomplete catalog for the given rule shape. Returns
 * the built-in placeholders, the triggering signal (when known), and
 * sibling signals in the same protomodel Category.
 */
export function useAlertMessagePlaceholders(args: {
  kind?: AlertRuleKind | '';
  signal_name?: string;
  op?: AlertRuleOp;
  metric_id?: string | null;
  vehicle_timezone?: string;
  enabled?: boolean;
}) {
  const { kind, signal_name, op, metric_id, vehicle_timezone, enabled = true } = args;
  const formattingKey = useAlertMessageFormattingKey();
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (signal_name) params.set('signal_name', signal_name);
    if (op) params.set('op', op);
    if (metric_id) params.set('metric_id', metric_id);
    if (vehicle_timezone) params.set('vehicle_timezone', vehicle_timezone);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [kind, signal_name, op, metric_id, vehicle_timezone]);
  return useQuery({
    queryKey: [...alertMessageKeys.placeholders(kind, signal_name, op, metric_id), vehicle_timezone ?? '', formattingKey],
    queryFn: ({ signal }) =>
      request<AlertMessagePlaceholder[]>(`/alerts/message-placeholders${qs}`, { signal }),
    staleTime: STALE_TIMES.EXTENDED,
    enabled,
    // Coerce a null / non-array payload to [] so the autocomplete catalog
    // never crashes on `.filter`/`.length` (matches every other list hook).
    select: safeArray,
  });
}

/**
 * Renders a single message-preview against the backend. Implemented as
 * a mutation rather than a query because the input is the live editor
 * draft (changes on every keystroke) and we want explicit control over
 * when the network round-trip fires — the editor debounces it.
 */
export function useAlertMessagePreview() {
  return useMutation({
    mutationFn: (body: AlertMessagePreviewRequest) =>
      request<AlertMessagePreviewResponse>('/alerts/message-preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}
