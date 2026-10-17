import { type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Archive,
  CircleHelp,
  Database,
  Sigma,
  Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import type { DataProvenance, DataStatus } from '@/api/dataState';
import { useDateFormat } from '@/hooks/useDateFormat';

export interface DataProvenanceBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  provenance: DataProvenance;
  /** Downgrades the badge tone when the payload is no longer trustworthy. */
  status?: DataStatus;
  /** Raw update epoch ms; a successful fetch is not a signal observation. */
  updatedAt?: number | null;
  size?: 'sm' | 'md';
  /** Hide the icon (dense table cells). */
  iconOnly?: boolean;
}

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const PROVENANCE_CONFIG: Record<
  DataProvenance,
  { Icon: typeof Activity; variant: BadgeVariant; key: string; label: string; hint: string }
> = {
  live: {
    Icon: Activity,
    variant: 'success',
    key: 'provenance.live',
    label: 'Live',
    hint: 'Current state pushed by the vehicle telemetry pipeline.',
  },
  cached: {
    Icon: Database,
    variant: 'neutral',
    key: 'provenance.cached',
    label: 'Cached',
    hint: 'Loaded earlier and retained. Not confirmed against the server since.',
  },
  historical: {
    Icon: Archive,
    variant: 'info',
    key: 'provenance.historical',
    label: 'Historical',
    hint: 'Read from stored history rather than current state.',
  },
  inferred: {
    Icon: Sigma,
    variant: 'warning',
    key: 'provenance.inferred',
    label: 'Estimated',
    hint: 'Derived from other readings. The vehicle did not report this value directly.',
  },
  repaired: {
    Icon: Wrench,
    variant: 'warning',
    key: 'provenance.repaired',
    label: 'Repaired',
    hint: 'Corrected by the data-repair workflow rather than captured as-is.',
  },
  unknown: {
    Icon: CircleHelp,
    variant: 'neutral',
    key: 'provenance.unknown',
    label: 'Unknown source',
    hint: 'The origin of this value could not be established.',
  },
};

/**
 * Where a displayed value came from — `live`, `cached`, `historical`,
 * `inferred`, `repaired`, or honestly `unknown`.
 *
 * Provenance and freshness are separate axes and this component keeps them
 * that way: `<FreshnessDot>` answers "how old", this answers "how was it
 * produced". An inferred value that arrived one second ago is still an
 * estimate, and a historical value that is an hour old is not stale — it is
 * history. Collapsing the two is how an estimate ends up being read as a
 * measurement.
 *
 * A degraded `status` only tones the badge down (a `live` provenance with a
 * failed refresh renders as neutral rather than green); it never rewrites the
 * provenance itself.
 */
export function DataProvenanceBadge({
  updatedAt,
  ...props
}: DataProvenanceBadgeProps) {
  const asOf = updatedAt != null && Number.isFinite(updatedAt)
    ? new Date(updatedAt)
    : null;

  // Untimed badges also appear on public surfaces without workspace providers.
  return asOf != null && Number.isFinite(asOf.getTime())
    ? <TimedProvenanceBadge {...props} asOf={asOf} />
    : <ProvenanceBadge {...props} />;
}

function TimedProvenanceBadge({
  asOf,
  ...props
}: DataProvenanceBadgeProps & { asOf: Date }) {
  const { formatDateTime, tz } = useDateFormat();
  const time = `${formatDateTime(asOf, { clock: { second: '2-digit' } })} (${tz})`;
  return <ProvenanceBadge {...props} time={time} />;
}

function ProvenanceBadge({
  provenance,
  status,
  time,
  size = 'sm',
  iconOnly = false,
  ...props
}: Omit<DataProvenanceBadgeProps, 'updatedAt'> & { time?: string }) {
  const { t } = useTranslation();
  const config = PROVENANCE_CONFIG[provenance] ?? PROVENANCE_CONFIG.unknown;
  const Icon = config.Icon;

  const degraded = status === 'stale' || status === 'partial' || status === 'unavailable';
  const variant: BadgeVariant = degraded ? 'neutral' : config.variant;

  const label = t(config.key, config.label);
  const title = time != null
    ? `${t(`${config.key}Hint`, config.hint)} ${t('freshness.lastUpdated', 'Last updated: {{time}}', {
        time,
      })}`
    : t(`${config.key}Hint`, config.hint);

  return (
    <Badge
      {...props}
      variant={variant}
      size={size}
      title={title}
      aria-label={label}
      data-provenance={provenance}
      data-data-status={status ?? 'ok'}
    >
      {iconOnly ? null : <Icon className="h-3 w-3" aria-hidden="true" />}
      <span>{label}</span>
    </Badge>
  );
}
