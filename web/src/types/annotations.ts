export interface DataAnnotation {
  id: string;
  /** ISO timestamp of the annotated point */
  timestamp: string;
  /** Short label (displayed on chart) */
  label: string;
  /** Optional longer description (shown in tooltip) */
  description?: string;
  /** Category for color coding */
  category: AnnotationCategory;
  /** Which chart/page this annotation belongs to */
  context: string;
  /** Optional: specific vehicle */
  vehicleId?: number;
  /** Created timestamp */
  createdAt: string;
}

export type AnnotationCategory =
  | 'milestone'
  | 'maintenance'
  | 'trip'
  | 'issue'
  | 'upgrade'
  | 'custom';

/**
 * Annotations are scoped to chart "buckets" so the
 * same row can appear on every chart that opts into a bucket. Keep this union
 * in sync with `validScopeBuckets` in
 * `internal/api/chart_annotation_handler.go`.
 */
export type AnnotationScope =
  | 'battery'
  | 'efficiency'
  | 'cost'
  | 'tire'
  | 'energy'
  | 'drivetrain'
  | 'mileage'
  | 'charging';

export const ANNOTATION_SCOPES: readonly AnnotationScope[] = [
  'battery',
  'efficiency',
  'cost',
  'tire',
  'energy',
  'drivetrain',
  'mileage',
  'charging',
] as const;

/**
 * Wire shape from `GET /api/v1/annotations`. Mirrors `models.ChartAnnotation`
 * — snake_case JSON tags. The frontend uses `toDataAnnotation` to project
 * this onto the existing chart-render shape so the legacy components keep
 * working unchanged.
 */
export interface ChartAnnotationRow {
  id: number;
  user_id?: number | null;
  vehicle_id?: number | null;
  occurred_at: string;
  category: AnnotationCategory;
  title: string;
  description?: string | null;
  scope: string[];
  color?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Project a backend row onto the chart-render shape. The numeric `id` is
 * stringified so it can flow through the existing `<AnnotationList>` and
 * `<ReferenceLine>` consumers without change.
 *
 * `scope` is read defensively: a nil Go slice (`models.ChartAnnotation.Scope`)
 * marshals to JSON `null` rather than `[]`, so indexing it directly would throw
 * a `TypeError` at the wire boundary. A missing/empty scope collapses to a
 * blank context instead of crashing the chart overlay.
 */
export function toDataAnnotation(row: ChartAnnotationRow): DataAnnotation {
  return {
    id: String(row.id),
    timestamp: row.occurred_at,
    label: row.title,
    description: row.description ?? undefined,
    category: row.category,
    context: row.scope?.[0] ?? '',
    vehicleId: row.vehicle_id ?? undefined,
    createdAt: row.created_at,
  };
}

export const ANNOTATION_COLORS: Record<AnnotationCategory, string> = {
  milestone: '#3b82f6',
  maintenance: '#f59e0b',
  trip: '#22c55e',
  issue: '#ef4444',
  upgrade: '#a855f7',
  custom: '#94a3b8',
};

export const ANNOTATION_CATEGORY_LABELS: Record<AnnotationCategory, string> = {
  milestone: 'Milestone',
  maintenance: 'Maintenance',
  trip: 'Trip',
  issue: 'Issue',
  upgrade: 'Upgrade',
  custom: 'Custom',
};
