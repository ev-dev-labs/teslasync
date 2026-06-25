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
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { request } from '../client';
import type {
  AlertRuleKind,
  AlertRuleOp,
  AlertRuleSeverity,
  ComputedMetricOp,
} from '../../../api/types';

const STALE_TIMES = {
  EXTENDED: 10 * 60_000,
} as const;

/**
 * ADR-014 - autocomplete suggestion served by
 * GET /api/v1/alerts/message-placeholders. Mirrors internal/alertmsg.Placeholder.
 */
export interface AlertMessagePlaceholder {
  key: string;
  label: string;
  description?: string;
  group: string;
  example?: string;
}

/**
 * ADR-014 - curated message-template preset served by
 * GET /api/v1/alerts/message-presets. Mirrors internal/alertmsg.Preset.
 */
export interface AlertMessagePreset {
  id: string;
  name: string;
  description?: string;
  template: string;
  kind?: '' | 'signal' | 'computed_metric';
  tags?: string[];
}

/**
 * ADR-014 - request body for POST /api/v1/alerts/message-preview.
 * Accepts the editor's draft rule shape so the preview renders against
 * the same inputs the production dispatch path uses.
 */
export interface AlertMessagePreviewRequest {
  name?: string;
  kind?: AlertRuleKind;
  signal_name?: string;
  op?: AlertRuleOp;
  severity?: AlertRuleSeverity;
  vehicle_name?: string;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  msg_template?: string | null;
  include_title?: boolean;
  signals?: Record<string, unknown>;
}

export interface AlertMessagePreviewResponse {
  title: string;
  body: string;
}

function buildQuery(
  entries: Array<[string, string | number | boolean | null | undefined]>,
): string {
  const qs = entries
    .filter(([, value]) => value != null && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');

  return qs ? `?${qs}` : '';
}

/**
 * Stable query keys for the message-helper endpoints. The catalog
 * responses are pure functions of their inputs (no per-user state) so
 * we can lean on TanStack's default cache + a long staleTime.
 */
export const alertMessageKeys = {
  presets: (kind?: AlertRuleKind | '') =>
    ['alerts', 'message-presets', kind ?? ''] as const,
  placeholders: (
    kind?: AlertRuleKind | '',
    signalName?: string,
    op?: AlertRuleOp,
    metricId?: string | null,
  ) =>
    [
      'alerts',
      'message-placeholders',
      kind ?? '',
      signalName ?? '',
      op ?? '',
      metricId ?? '',
    ] as const,
};

/**
 * Fetches the curated preset gallery. `kind` is optional; passing it
 * filters the catalog to either signal- or metric-only entries plus
 * the universal "" entries.
 */
export function useAlertMessagePresets(kind?: AlertRuleKind | '') {
  const qs = useMemo(() => buildQuery([['kind', kind]]), [kind]);
  return useQuery({
    queryKey: alertMessageKeys.presets(kind),
    queryFn: ({ signal }) =>
      request<AlertMessagePreset[]>(`/alerts/message-presets${qs}`, { signal }),
    staleTime: STALE_TIMES.EXTENDED,
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
  const qs = useMemo(
    () =>
      buildQuery([
        ['kind', kind],
        ['signal_name', signal_name],
        ['op', op],
        ['metric_id', metric_id],
      ]),
    [kind, signal_name, op, metric_id],
  );
  return useQuery({
    queryKey: alertMessageKeys.placeholders(kind, signal_name, op, metric_id),
    queryFn: ({ signal }) =>
      request<AlertMessagePlaceholder[]>(
        `/alerts/message-placeholders${qs}`,
        { signal },
      ),
    staleTime: STALE_TIMES.EXTENDED,
    enabled,
  });
}

/**
 * Renders a single message-preview against the backend. Implemented as
 * a mutation rather than a query because the input is the live editor
 * draft (changes on every keystroke) and we want explicit control over
 * when the network round-trip fires - the editor debounces it.
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
