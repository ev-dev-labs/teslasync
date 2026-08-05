import type { CameraPosition, ClipSource, EventCandidateType, EventConfidence } from '../../lib/types';
import type { CoverageQuality } from '../../lib/timelineAlignment';
import type { BadgeProps } from '@/components/ui';

/** Human-readable camera position labels (English fallback; wrap with t() at call sites). */
export const CAMERA_LABELS: Record<CameraPosition, string> = {
  front: 'Front',
  back: 'Back',
  left_repeater: 'Left repeater',
  right_repeater: 'Right repeater',
  left_pillar: 'Left pillar',
  right_pillar: 'Right pillar',
  unknown: 'Unknown camera',
};

export const SOURCE_LABELS: Record<ClipSource, string> = {
  RecentClips: 'Recent',
  SavedClips: 'Saved',
  SentryClips: 'Sentry',
  unknown: 'Unknown source',
};

export const EVENT_TYPE_LABELS: Record<EventCandidateType, string> = {
  sentry_trigger: 'Sentry trigger',
  manual_save: 'Manual save',
  impact: 'Impact',
  hard_brake: 'Hard brake (statistical)',
  hard_accel: 'Hard accel (statistical)',
  sharp_turn: 'Sharp turn (statistical)',
  motion: 'Motion detected',
  unknown: 'Unclassified',
};

export const CONFIDENCE_BADGE_VARIANT: Record<EventConfidence, NonNullable<BadgeProps['variant']>> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};

export const COVERAGE_BADGE_VARIANT: Record<CoverageQuality, NonNullable<BadgeProps['variant']>> = {
  none: 'neutral',
  sparse: 'warning',
  partial: 'warning',
  good: 'success',
};

export const COVERAGE_LABELS: Record<CoverageQuality, string> = {
  none: 'No coverage',
  sparse: 'Sparse coverage',
  partial: 'Partial coverage',
  good: 'Good coverage',
};
