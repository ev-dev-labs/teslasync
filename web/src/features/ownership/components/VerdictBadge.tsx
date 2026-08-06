import { Badge } from '@/components/ui';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * Maps every verdict/status vocabulary the ownership engines emit onto a single
 * badge tone, so a "cancel", an "overdue", and an "unreliable" all read as the
 * same severity anywhere in the app.
 */
const TONE_BY_VALUE: Record<string, Tone> = {
  // Risk grades
  preferred: 'success',
  standard: 'info',
  substandard: 'warning',
  high: 'danger',
  // Match states
  exact: 'success',
  probable: 'info',
  ambiguous: 'warning',
  unmatched: 'danger',
  duplicate: 'danger',
  uninvoiced: 'warning',
  // Invoice status
  open: 'info',
  reconciled: 'success',
  disputed: 'warning',
  settled: 'neutral',
  // Trust grades
  trusted: 'success',
  watch: 'warning',
  unreliable: 'danger',
  unevaluated: 'neutral',
  // Subscription verdicts
  keep: 'success',
  review: 'warning',
  cancel: 'danger',
  unknown: 'neutral',
  too_early: 'info',
  // Lifecycle / coverage status
  healthy: 'success',
  active: 'success',
  monitor: 'info',
  due_soon: 'warning',
  expiring_soon: 'warning',
  overdue: 'danger',
  expired: 'danger',
  lapsed: 'danger',
  retired: 'neutral',
  // Drift
  stable: 'success',
  improving: 'success',
  degrading: 'danger',
  // Data quality
  sufficient: 'success',
  limited: 'warning',
  insufficient: 'danger',
};

interface VerdictBadgeProps {
  value: string | null | undefined;
  label?: string;
  dot?: boolean;
}

export function VerdictBadge({ value, label, dot = true }: VerdictBadgeProps) {
  const normalised = (value ?? '').toLowerCase();
  const tone = TONE_BY_VALUE[normalised] ?? 'neutral';
  const text = label ?? (normalised ? normalised.replace(/_/g, ' ') : '—');
  return (
    <Badge variant={tone} dot={dot}>
      {text}
    </Badge>
  );
}
