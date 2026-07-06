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
 * responses are pure functions of their inputs (no per-user state) so
 * we can lean on TanStack's default cache + a long staleTime.
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
export function useAlertMessagePresets(kind?: AlertRuleKind | '') {
  const qs = useMemo(() => (kind ? `?kind=${encodeURIComponent(kind)}` : ''), [kind]);
  return useQuery({
    queryKey: alertMessageKeys.presets(kind),
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
  enabled?: boolean;
}) {
  const { kind, signal_name, op, metric_id, enabled = true } = args;
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (signal_name) params.set('signal_name', signal_name);
    if (op) params.set('op', op);
    if (metric_id) params.set('metric_id', metric_id);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [kind, signal_name, op, metric_id]);
  return useQuery({
    queryKey: alertMessageKeys.placeholders(kind, signal_name, op, metric_id),
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
