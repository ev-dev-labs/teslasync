import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingUp, Zap, AlertTriangle, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button, Text } from '@/components/ui';
import { InlineMetric } from '@/components/data-display/InlineMetric';
import {
  HistoryListRow, ScoreBadge, BatteryDelta, RouteDisplay,
} from '@/components/data-display';
import { formatDateTime, formatTime, formatDurationMinutes } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { getEfficiency, gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { Icons } from '@/lib/icons';

export interface DriveCardProps {
  drive: Drive;
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  toEfficiencyDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
  efficiencyUnit: string;
  formatEnergyCost?: (kwh: number) => string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  onPreview?: (drive: Drive) => void;
  /** IANA timezone for time-of-day rendering. Defaults to browser local. */
  tz?: string;
  /** When true, render a high-energy-use badge to mark this row
 * as the one called out in the page-level anomaly summary. */
  isAnomaly?: boolean;
  fsdInsight?: DriveFsdInsight;
}

function DriveCardImpl({
  drive, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay,
  distanceUnit, speedUnit, efficiencyUnit, formatEnergyCost,
  selected, onToggleSelect, onPreview, tz, isAnomaly,
  fsdInsight,
}: DriveCardProps) {
  const { t } = useTranslation();
  const actualDistance = drive.distanceM;
  const isCompleted = drive.endTs != null;
  const hasData = actualDistance > 0 || drive.durationS > 0;
  const avgSpeed =
    drive.avgSpeedMps != null
      ? fmtInt(toSpeedDisplay(drive.avgSpeedMps))
      : drive.durationS > 0 && actualDistance > 0
        ? fmtInt(toSpeedDisplay(actualDistance / drive.durationS))
        : '—';
  const eff = getEfficiency(drive);
  const effConverted = eff != null ? toEfficiencyDisplay(eff) : null;
  const score = gradeFromEfficiency(eff);
  const hasBattery =
    drive.startBatteryPct !== null &&
    drive.endBatteryPct !== null &&
    !(drive.startBatteryPct === 0 && drive.endBatteryPct === 0 && isCompleted);

  const showCheckbox = typeof onToggleSelect === 'function';
  const fsdBadge = (() => {
    if (!fsdInsight) return null;
    if (fsdInsight.confidence === 'unknown' || fsdInsight.fsd_distance_m == null) {
      return {
        label: t('drives.fsdUnknown', 'FSD data unknown'),
        variant: 'neutral' as const,
        title: t(
          'drives.fsdUnknownHelp',
          'The cumulative counters do not provide enough synchronized evidence for this drive.',
        ),
      };
    }
    const prefix = fsdInsight.confidence === 'high' ? '' : '~';
    const value = fsdInsight.fsd_share_pct != null
      ? `${prefix}${fmtNumber(fsdInsight.fsd_share_pct, 0)}%`
      : `${prefix}${fmtNumber(toDistanceDisplay(fsdInsight.fsd_distance_m))} ${distanceUnit}`;
    const ambiguous = fsdInsight.confidence === 'ambiguous'
      ? ` · ${t('drives.fsdAmbiguous', 'ambiguous')}`
      : '';
    return {
      label: `FSD ${value}${ambiguous}`,
      variant: fsdInsight.confidence === 'high'
        ? 'success' as const
        : fsdInsight.confidence === 'ambiguous'
          ? 'warning' as const
          : 'info' as const,
      title: fsdInsight.reset_affected
        ? t('drives.fsdResetAffected', 'A counter reset lowered confidence for this drive.')
        : t(
            'drives.fsdReportedHelp',
            'Reported supervised-driving distance derived from cumulative counters.',
          ),
    };
  })();

  const checkbox = showCheckbox ? (
    <Checkbox
      checked={!!selected}
      onChange={(next) => onToggleSelect?.(drive.id, next)}
      aria-label={t('drives.selectDrive', 'Select drive on {{date}}', { date: formatDateTime(drive.startTs, { tz }) })}
    />
  ) : undefined;

  const primary = (
    <>
      {/* Time-of-day only — the date is shown in the date-group header above */}
      <Text as="span" size="sm" weight="semibold" color="primary" className="tabular-nums">
        {formatTime(drive.startTs, { tz })}
      </Text>
      <Text as="span" size="2xs" color="muted">·</Text>
      <Text as="span" size="xs" color="muted" className="tabular-nums">
        {formatDurationMinutes((drive.durationS) / 60)}
      </Text>
      {hasData ? (
        <Badge variant="info" size="sm">
          {fmtNumber(toDistanceDisplay(actualDistance))} {distanceUnit}
        </Badge>
      ) : isCompleted ? (
        <Badge variant="warning" size="sm">{t('drives.noTelemetry', 'No telemetry')}</Badge>
      ) : (
        <Badge variant="success" size="sm">{t('drives.inProgress', 'In progress')}</Badge>
      )}
      {drive.maxSpeedMps !== null && drive.maxSpeedMps > 58.1152 && (
        <Badge variant="danger" size="sm">{t('drives.highSpeed', 'High speed')}</Badge>
      )}
      {isAnomaly && (
        <Badge variant="danger" size="sm">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {t('drives.highEnergyUse', 'High energy use')}
        </Badge>
      )}
      {fsdBadge && (
        <Badge variant={fsdBadge.variant} size="sm" title={fsdBadge.title}>
          {fsdBadge.label}
        </Badge>
      )}
    </>
  );

  const route = (
    <RouteDisplay
      start={{ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }}
      end={{ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }}
    />
  );

  const metrics = (
    <>
      <InlineMetric icon={<Gauge aria-hidden />} value={`${t('drives.avg', 'Avg')} ${avgSpeed} ${speedUnit}`} />
      {drive.maxSpeedMps !== null && (
        <InlineMetric
          icon={<TrendingUp aria-hidden />}
          value={`${t('drives.max', 'Max')} ${fmtInt(toSpeedDisplay(drive.maxSpeedMps))} ${speedUnit}`}
        />
      )}
      {hasBattery && (
        <BatteryDelta
          startPct={drive.startBatteryPct}
          endPct={drive.endBatteryPct}
        />
      )}
      {effConverted != null && (
        <span className="flex items-center gap-1" style={{ color: score.color }}>
          <Zap className="h-3 w-3" aria-hidden /> {fmtInt(effConverted)} {efficiencyUnit}
        </span>
      )}
      {formatEnergyCost && drive.energyUsedWh != null && drive.energyUsedWh > 0 && (
        <span className="flex items-center gap-1 text-emerald-300">
          <DollarSign className="h-3 w-3" aria-hidden />
          ~{formatEnergyCost(drive.energyUsedWh / 1_000)}
        </span>
      )}
    </>
  );

  return (
    <HistoryListRow
      checkbox={checkbox}
      leading={(
        <ScoreBadge
          grade={score.label}
          ariaLabel={t(
            'drives.efficiencyGradeAria',
            'Efficiency grade {{grade}}',
            { grade: score.label },
          )}
        />
      )}
      primary={primary}
      route={route}
      metrics={metrics}
      actions={
        onPreview
          ? [
              <Button
                key="preview"
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label={t('drives.quickView', 'Quick view drive')}
                title={t('drives.quickView', 'Quick view drive')}
                onClick={() => onPreview(drive)}
              >
                <Icons.show className="h-4 w-4" aria-hidden="true" />
              </Button>,
            ]
          : undefined
      }
      href={`/drives/${drive.id}`}
      selected={selected}
    />
  );
}

/**
 * memo() with a custom equality so unchanged rows skip re-render when
 * the deferred filter value commits. `useSettings` returns fresh
 * function references on every parent render, so the default shallow
 * comparison would never short-circuit; here we only consider the
 * row-shaping inputs that actually affect the rendered output.
 */
export const DriveCard = memo(DriveCardImpl, (prev, next) =>
  prev.drive === next.drive &&
  prev.selected === next.selected &&
  prev.distanceUnit === next.distanceUnit &&
  prev.speedUnit === next.speedUnit &&
  prev.efficiencyUnit === next.efficiencyUnit &&
  prev.tz === next.tz &&
  prev.isAnomaly === next.isAnomaly &&
  prev.fsdInsight === next.fsdInsight &&
  prev.onToggleSelect === next.onToggleSelect &&
  prev.onPreview === next.onPreview, );
