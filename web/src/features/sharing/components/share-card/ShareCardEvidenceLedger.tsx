import { useTranslation } from 'react-i18next';

import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AlertBanner } from '@/components/feedback';
import { ShareCardBrief } from '../operationalbrief-all/ShareCardBrief';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardEvidenceLedger({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const hasReturnedData = state.enabled && state.hasData;
  const supportingRows = (count: number) => hasReturnedData
    ? t('shareCard.evidence.supportRows', '{{count}} supporting rows', { count })
    : t('shareCard.states.pending', 'Source availability has not resolved yet.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'returned', rawValue: hasReturnedData ? analysis.returnedRows : null,
      label: t('shareCard.evidence.returned', 'Returned rows'),
      description: t('shareCard.evidence.returnedHint', 'Before runtime validation'),
      display: { formatter: (raw) => ({ value: display.formatNumber(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'eligible', rawValue: hasReturnedData ? analysis.eligibleRows : null,
      label: t('shareCard.evidence.eligible', 'Eligible drives'),
      description: t('shareCard.evidence.eligibleHint', 'Unique ID and in-window timestamp'),
      display: { formatter: (raw) => ({ value: display.formatNumber(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'distance', rawValue: hasReturnedData ? analysis.aggregates.distanceM.value : null,
      label: t('shareCard.evidence.distance', 'Measured distance'),
      description: supportingRows(analysis.aggregates.distanceM.supportRows),
      display: { formatter: (raw) => ({ value: display.formatDistance(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: hasReturnedData ? analysis.aggregates.durationS.value : null,
      label: t('shareCard.evidence.duration', 'Measured duration'),
      description: supportingRows(analysis.aggregates.durationS.supportRows),
      display: { formatter: (raw) => ({ value: display.formatDuration(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', rawValue: hasReturnedData ? analysis.aggregates.energyUsedWh.value : null,
      label: t('shareCard.evidence.energy', 'Measured drive energy'),
      description: supportingRows(analysis.aggregates.energyUsedWh.supportRows),
      display: { formatter: (raw) => ({ value: display.formatEnergy(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'activeDays', rawValue: hasReturnedData ? analysis.activeDays : null,
      label: t('shareCard.evidence.activeDays', 'Active vehicle days'),
      description: t('shareCard.evidence.requestedDays', '{{value}} requested calendar days', {
        value: analysis.window.requestedCalendarDays ?? '—',
      }),
      display: { formatter: (raw) => ({ value: display.formatNumber(raw), unit: '' }) } },
  ];

  return (
    <section
      data-testid="share-card-evidence-ledger"
      aria-label={t('shareCard.evidence.aria', 'Share card KPI and evidence ledger')}
    >
      <ShareCardBrief
        analysis={analysis}
        state={state}
        display={display}
        metrics={metrics}
        title={t('shareCard.evidence.title', 'KPI and evidence ledger')}
        description={t('shareCard.brief.description', 'Only returned, runtime-validated selected-window evidence supports these measurements; field coverage and the query cap remain explicit.')}
      />
        <ShareCardSectionBody state={state} showCachedStatus>
          {analysis.returnedRows === 0 ? (
            <AlertBanner className="mt-4" variant="info">
              {t(
                'shareCard.evidence.validEmpty',
                'The drive endpoint returned a valid empty array for this selected window.',
              )}
            </AlertBanner>
          ) : analysis.returnedRows > 0 && analysis.eligibleRows === 0 ? (
            <AlertBanner className="mt-4" variant="warning">
              {t(
                'shareCard.evidence.noEligible',
                'Rows were returned, but none passed identity and selected-window timestamp validation.',
              )}
            </AlertBanner>
          ) : null}
        </ShareCardSectionBody>
    </section>
  );
}
