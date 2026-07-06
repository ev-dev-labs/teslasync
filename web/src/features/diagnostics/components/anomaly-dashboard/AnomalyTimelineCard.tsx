import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SeverityBadge, TimeStamp } from '@/components/data-display';
import { Text } from '@/components/ui';
import { severityTokens, normalizeSeverity, typography } from '@/lib/tokens';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { AnomalyEntry } from '@/api/hooks/useAnomalies';

import { anomalyTypeLabel } from './anomalyHelpers';

interface AnomalyTimelineCardProps {
  anomaly: AnomalyEntry;
}

/**
 * One detected-anomaly card in the timeline bento. Tint + badge come from the
 * shared `severityTokens` so status is conveyed by icon **and** text (not color
 * alone). Values are raw signal readings (unit-less at this layer) formatted
 * with `fmtNumber`.
 */
function AnomalyTimelineCardImpl({ anomaly }: AnomalyTimelineCardProps) {
  const { t } = useTranslation();
  const tone = severityTokens[normalizeSeverity(anomaly.severity)];

  return (
    <li className={cn('flex flex-col gap-2 rounded-xl border p-4', tone.bg, tone.border)}>
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
          className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-0.5"
        >
          {anomalyTypeLabel(t, anomaly.type)}
        </Text>
        {anomaly.z_score > 0 && (
          <Text size="2xs" color="muted" className="tabular-nums">
            {fmtNumber(anomaly.z_score, 1)}σ
          </Text>
        )}
      </div>

      <Text as="p" variant="bodySm">{anomaly.message}</Text>

      <div className={cn('mt-auto flex flex-wrap gap-x-4 gap-y-1', typography.size['2xs'], typography.color.muted)}>
        <span>
          {t('anomaly.value', 'Value')}:{' '}
          <Text as="span" size="2xs" color="secondary" className="tabular-nums">
            {fmtNumber(anomaly.value, 2)}
          </Text>
        </span>
        <span>
          {t('anomaly.baseline', 'Baseline')}:{' '}
          <Text as="span" size="2xs" color="secondary" className="tabular-nums">
            {fmtNumber(anomaly.baseline, 2)}
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
