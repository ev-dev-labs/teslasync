import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@/components/ui';

/**
 * Maps every verdict/status vocabulary the ownership engines emit onto a single
 * badge tone, so a "cancel", an "overdue", and an "unreliable" all read as the
 * same severity anywhere in the app.
 */
const TONE_BY_VALUE = {
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
  // Evidence strength describes reliance, not outcome or health.
  strong: 'info',
  moderate: 'neutral',
  weak: 'warning',
} satisfies Record<string, NonNullable<BadgeProps['variant']>>;

type KnownVerdict = keyof typeof TONE_BY_VALUE;

const LABEL_KEY_BY_VALUE: { [Value in KnownVerdict]: `ownership.verdict.${Value}` } = {
  preferred: 'ownership.verdict.preferred',
  standard: 'ownership.verdict.standard',
  substandard: 'ownership.verdict.substandard',
  high: 'ownership.verdict.high',
  exact: 'ownership.verdict.exact',
  probable: 'ownership.verdict.probable',
  ambiguous: 'ownership.verdict.ambiguous',
  unmatched: 'ownership.verdict.unmatched',
  duplicate: 'ownership.verdict.duplicate',
  uninvoiced: 'ownership.verdict.uninvoiced',
  open: 'ownership.verdict.open',
  reconciled: 'ownership.verdict.reconciled',
  disputed: 'ownership.verdict.disputed',
  settled: 'ownership.verdict.settled',
  trusted: 'ownership.verdict.trusted',
  watch: 'ownership.verdict.watch',
  unreliable: 'ownership.verdict.unreliable',
  unevaluated: 'ownership.verdict.unevaluated',
  keep: 'ownership.verdict.keep',
  review: 'ownership.verdict.review',
  cancel: 'ownership.verdict.cancel',
  unknown: 'ownership.verdict.unknown',
  too_early: 'ownership.verdict.too_early',
  healthy: 'ownership.verdict.healthy',
  active: 'ownership.verdict.active',
  monitor: 'ownership.verdict.monitor',
  due_soon: 'ownership.verdict.due_soon',
  expiring_soon: 'ownership.verdict.expiring_soon',
  overdue: 'ownership.verdict.overdue',
  expired: 'ownership.verdict.expired',
  lapsed: 'ownership.verdict.lapsed',
  retired: 'ownership.verdict.retired',
  stable: 'ownership.verdict.stable',
  improving: 'ownership.verdict.improving',
  degrading: 'ownership.verdict.degrading',
  sufficient: 'ownership.verdict.sufficient',
  limited: 'ownership.verdict.limited',
  insufficient: 'ownership.verdict.insufficient',
  strong: 'ownership.verdict.strong',
  moderate: 'ownership.verdict.moderate',
  weak: 'ownership.verdict.weak',
};

function isKnownVerdict(value: string): value is KnownVerdict {
  return Object.prototype.hasOwnProperty.call(TONE_BY_VALUE, value);
}

interface VerdictBadgeProps {
  value: string | null | undefined;
  label?: string;
  dot?: boolean;
}

export function VerdictBadge({ value, label, dot = true }: VerdictBadgeProps) {
  const { t } = useTranslation();
  const normalised = (value ?? '').toLowerCase();
  const known = isKnownVerdict(normalised);
  const tone = known ? TONE_BY_VALUE[normalised] : 'neutral';
  const fallback = normalised ? normalised.replace(/_/g, ' ') : '—';
  const text = label ?? (known ? t(LABEL_KEY_BY_VALUE[normalised], fallback) : fallback);
  return (
    <Badge variant={tone} dot={dot}>
      {text}
    </Badge>
  );
}
