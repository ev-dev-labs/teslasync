import { useTranslation } from 'react-i18next';

import { SeverityBadge, TimeStamp } from '@/components/data-display';
import { severityTokens, normalizeSeverity } from '@/lib/tokens';
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
export function AnomalyTimelineCard({ anomaly }: AnomalyTimelineCardProps) {
  const { t } = useTranslation();
  const tone = severityTokens[normalizeSeverity(anomaly.severity)];

  return (
    <li className={cn('flex flex-col gap-2 rounded-xl border p-4', tone.bg, tone.border)}>
      <div className="flex items-start justify-between gap-2">
        <SeverityBadge severity={anomaly.severity} size="sm">
          {t(`anomaly.severity.${anomaly.severity}`, anomaly.severity)}
        </SeverityBadge>
        <TimeStamp value={anomaly.detected_at} className="text-2xs text-[var(--text-muted)]" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
          {anomaly.signal}
        </span>
        <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-0.5 text-2xs font-medium text-[var(--text-muted)]">
          {anomalyTypeLabel(t, anomaly.type)}
        </span>
        {anomaly.z_score > 0 && (
          <span className="text-2xs tabular-nums text-[var(--text-muted)]">
            {fmtNumber(anomaly.z_score, 1)}σ
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)]">{anomaly.message}</p>

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-2xs text-[var(--text-muted)]">
        <span>
          {t('anomaly.value', 'Value')}:{' '}
          <span className="tabular-nums text-[var(--text-secondary)]">
            {fmtNumber(anomaly.value, 2)}
          </span>
        </span>
        <span>
          {t('anomaly.baseline', 'Baseline')}:{' '}
          <span className="tabular-nums text-[var(--text-secondary)]">
            {fmtNumber(anomaly.baseline, 2)}
          </span>
        </span>
      </div>
    </li>
  );
}
