import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState, QueryError } from '@/components/feedback';
import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import type { SpeedSweetSpotSectionState } from '../speed-sweet-spot/types';
import { useSpeedSweetSpotDisplay } from '../speed-sweet-spot/useSpeedSweetSpotDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface SweetSpotSummaryBriefProps extends SpeedSweetSpotSectionState {
  summary: SweetSpotResult;
  scope: string;
  resolved: boolean;
  retained: boolean;
}

export function SweetSpotSummaryBrief({ summary, isLoading, error, onRetry, scope, resolved, retained }: SweetSpotSummaryBriefProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatBand, formatDistance, formatEfficiency } = useSpeedSweetSpotDisplay();
  const winning = summary.sweetSpot;
  const gap = summary.observedGapShare;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'speed', occurrenceId: 'best-qualified-band',
      rawValue: resolved && winning ? winning.fromKph / 3.6 : null,
      label: t('sweetSpot.spot', 'Best qualified band'),
      display: { formatter: (raw) => ({ value: winning ? formatBand(raw * 3.6, winning.toKph) : '—', unit: '' }) },
      context: winning ? t('sweetSpot.kpi.bandSample', '{{drives}} drives · {{distance}} observed', {
        drives: winning.drives, distance: formatDistance(winning.distanceM),
      }) : t('sweetSpot.kpi.noQualified', 'No band meets the sample floor'),
    },
    {
      metricId: 'efficiency', occurrenceId: 'band-consumption',
      rawValue: resolved && winning?.whPerKm != null ? winning.whPerKm / 1000 : null,
      label: t('sweetSpot.atSpot', 'Consumption in band'),
      display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) },
      description: t('sweetSpot.kpi.weightedBand', 'distance-weighted within this band'),
    },
    {
      metricId: 'efficiency', occurrenceId: 'overall-consumption',
      rawValue: resolved && summary.overallWhPerKm != null ? summary.overallWhPerKm / 1000 : null,
      label: t('sweetSpot.overall', 'Overall weighted consumption'),
      display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) },
      context: resolved ? summary.historyCapReached
        ? t('sweetSpot.kpi.cappedWindowSample', '{{eligible}} eligible · returned window hit the row cap', { eligible: summary.eligible })
        : t('sweetSpot.kpi.windowSample', '{{eligible}} eligible of {{observed}} returned drives', {
          eligible: summary.eligible, observed: summary.observed,
        }) : undefined,
    },
    {
      metricId: 'percent', occurrenceId: 'observed-gap',
      rawValue: resolved && gap != null ? gap * 100 : null,
      label: t('sweetSpot.observedGap', 'Observed efficiency gap'),
      display: { formatter: (raw) => ({ value: `${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fmtNumber(Math.abs(raw))}%`, unit: '' }) },
      description: t('sweetSpot.observedGapHint', 'descriptive comparison, not a savings forecast'),
    },
  ];
  return (
    <section data-testid="speed-sweet-spot-kpis" aria-label={t('sweetSpot.kpis', 'Sweet spot summary metrics')}>
      <DrivingSummaryBrief
        id="speed-sweet-spot-brief"
        title={t('sweetSpot.kpis', 'Sweet spot summary metrics')}
        description={t('sweetSpot.subtitle', 'Observed efficiency by whole-drive average speed — not instantaneous cruising speed or a recommended road speed')}
        metrics={metrics}
        scope={scope}
        provenance={t('sweetSpot.brief.provenance', 'Distance-weighted eligible returned drives; sample floor and row cap are unchanged.')}
        loading={isLoading}
        unavailable={!resolved || error != null}
        retained={retained}
        actions={error ? <QueryError error={error} onRetry={onRetry} /> : undefined}
      />
      {resolved && summary.observed === 0 && <EmptyState
        message={t('sweetSpot.emptyWindow', 'No drives were returned for this selected window.')}
      />}
    </section>
  );
}
