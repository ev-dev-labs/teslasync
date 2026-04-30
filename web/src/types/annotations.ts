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
