import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SeverityBadge, TimeStamp } from '@/components/data-display';
import { Text } from '@/components/ui';
import { typography } from '@/lib/tokens';

import { cn } from '@/lib/cn';
import type { AnomalyEntry } from '@/api/hooks/useAnomalies';

import { anomalyTypeLabel } from './anomalyHelpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { PASCALS_PER_KPA } from '@/lib/unitConversion';

interface AnomalyTimelineCardProps {
  anomaly: Omit<AnomalyEntry, 'value' | 'baseline' | 'z_score'> & {
    value?: number | null;
    baseline?: number | null;
    z_score?: number | null;
    unit?: string;
  };
}

/**
 * One detected-anomaly card in the timeline bento. The neutral surface keeps
 * status emphasis on the shared badge's icon and text. API readings stay SI;
 * authoritative source units select display-only conversion here.
 */
function AnomalyTimelineCardImpl({ anomaly }: AnomalyTimelineCardProps) {
  const { fmtNumber } = useNumberFormatting();
  const units = useUnits();
  const { t } = useTranslation();

  const formatReading = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    switch (anomaly.unit) {
      case 'm': return units.formatDistance(value);
      case 'm/s': return units.formatSpeed(value);
      case '°C': return units.formatTemperature(value);
      case 'Pa': return units.formatPressure(value / PASCALS_PER_KPA);
      case 'kPa': return units.formatPressure(value);
      case 'Wh': return units.formatEnergy(value);
      case 'W': return units.formatPower(value);
      case 's': return units.formatDuration(value);
      default: return anomaly.unit ? `${fmtNumber(value)} ${anomaly.unit}` : fmtNumber(value);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="flex items-start justify-between gap-2">
        <SeverityBadge severity={anomaly.severity} size="sm">
          {t(`anomaly.severity.${anomaly.severity}`, anomaly.severity)}
        </SeverityBadge>
        <TimeStamp value={anomaly.detected_at} className={cn(typography.size['2xs'], typography.color.muted)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Text size="sm" weight="semibold" color="primary" className="truncate">
          {anomaly.signal}
        </Text>
        <Text
          as="span"
          size="2xs"
          weight="medium"
          color="muted"
          className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-2 py-0.5"
        >
          {anomalyTypeLabel(t, anomaly.type)}
        </Text>
        {typeof anomaly.z_score === 'number' && Number.isFinite(anomaly.z_score) && anomaly.z_score > 0 && (
          <Text size="2xs" color="muted" className="tabular-nums">
            {fmtNumber(anomaly.z_score)}σ
          </Text>
        )}
      </div>

      <Text as="p" variant="bodySm">{anomaly.message}</Text>

      <div className={cn('mt-auto flex flex-wrap gap-x-4 gap-y-1', typography.size['2xs'], typography.color.muted)}>
        <span>
          {t('anomaly.value', 'Value')}:{' '}
          <Text as="span" size="2xs" color="secondary" className="tabular-nums">
            {formatReading(anomaly.value)}
          </Text>
        </span>
        <span>
          {t('anomaly.baseline', 'Baseline')}:{' '}
          <Text as="span" size="2xs" color="secondary" className="tabular-nums">
            {formatReading(anomaly.baseline)}
          </Text>
        </span>
      </div>
    </li>
  );
}

/**
 * Memoized: the timeline renders these via `.map()` in a responsive grid,
 * and the parent page re-renders on vehicle switches, query refetches, and
 * AI-panel state changes. Each `anomaly` prop keeps a stable identity across
 * those renders (TanStack Query structural sharing), so the default shallow
 * comparison lets unchanged cards skip re-rendering — mirrors `DriveCard`.
 */
export const AnomalyTimelineCard = memo(AnomalyTimelineCardImpl);
