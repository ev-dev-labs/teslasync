/**
 * Types for the unified vehicle operations-intelligence activity timeline
 * (`GET /api/v1/activity`). Mirrors `internal/models/activity.Item` /
 * `.ListResponse` — snake_case JSON tags, matching Go exactly.
 *
 * This is distinct from:
 *   - `/me/activity` (types/admin.ts UserActivityEntry) — the signed-in
 *     user's own audit-log actions (settings changes, command sends).
 *   - `/timeline` (analytics FSM state-transition timeline) — vehicle
 *     drive/charge/park state machine transitions, not domain events.
 *
 * This feed unions real domain tables (drives, charging_sessions,
 * notification_logs, software_updates, chart_annotations). It never
 * includes maintenance/service events — there is no real dated service
 * history table backing the existing `/maintenance` endpoint (it returns a
 * synthetic default schedule), so surfacing it here would fabricate data.
 */

/** The five domains the activity timeline currently surfaces. */
export type ActivityKind =
  | 'drive'
  | 'charging'
  | 'alert'
  | 'software_update'
  | 'annotation';

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'drive',
  'charging',
  'alert',
  'software_update',
  'annotation',
] as const;

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  drive: 'Drive',
  charging: 'Charging',
  alert: 'Alert',
  software_update: 'Software Update',
  annotation: 'Annotation',
};

/**
 * Wire shape of one row from `GET /api/v1/activity`. Source-authored text
 * remains text, while session measurements stay typed and SI-canonical so
 * the React render boundary can localize and format them via `useUnits()`.
 */
export interface ActivityItem {
  /** Stable composite id: "<source_table>:<source_id>". */
  id: string;
  kind: ActivityKind;
  occurred_at: string;
  vehicle_id?: number | null;
  title: string;
  summary: string;
  /** Populated for kind="alert" only: "info" | "warn" | "critical". */
  severity?: string | null;
  /** Domain-specific lifecycle/category status — always present. */
  status: string;
  /** Underlying row this item was computed from — provenance for the UI. */
  source_table: string;
  source_id: number;
  /** Safe existing frontend route for more detail; absent when none exists. */
  path?: string | null;
  duration_s?: number | null;
  start_soc_pct?: number | null;
  end_soc_pct?: number | null;
  energy_added_wh?: number | null;
  version?: string | null;
}

/** Stable envelope returned by `GET /api/v1/activity`. */
export interface ActivityListResponse {
  items: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
  generated_at: string;
}

/** Query params accepted by `GET /api/v1/activity` (snake_case, no `/api/v1` prefix). */
export interface ActivityListParams {
  vehicle_id?: number;
  start?: string;
  end?: string;
  kind?: ActivityKind[];
  limit?: number;
  offset?: number;
}
