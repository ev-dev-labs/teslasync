import { Activity, CalendarDays, Gauge, Route, Timer, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardEvidenceLedger({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const hasReturnedData = state.hasData;

  return (
    <section
      data-testid="share-card-evidence-ledger"
      aria-label={t('shareCard.evidence.aria', 'Share Card KPI and evidence ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.evidence.title', 'KPI and evidence ledger')}
        </PanelTitle>
        <ShareCardSectionBody state={state} showCachedStatus>
          <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
            <MetricCard
              label={t('shareCard.evidence.returned', 'Returned rows')}
              value={hasReturnedData
                ? display.formatNumber(analysis.returnedRows, 0)
                : '—'}
              subtitle={t('shareCard.evidence.returnedHint', 'Before runtime validation')}
              icon={<Activity className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('shareCard.evidence.eligible', 'Eligible drives')}
              value={hasReturnedData
                ? display.formatNumber(analysis.eligibleRows, 0)
                : '—'}
              subtitle={t('shareCard.evidence.eligibleHint', 'Unique ID and in-window timestamp')}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('shareCard.evidence.distance', 'Measured distance')}
              value={display.formatDistance(analysis.aggregates.distanceM.value)}
              subtitle={t('shareCard.evidence.supportRows', '{{count}} supporting rows', {
                count: analysis.aggregates.distanceM.supportRows,
              })}
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('shareCard.evidence.duration', 'Measured duration')}
              value={display.formatDuration(analysis.aggregates.durationS.value)}
              subtitle={t('shareCard.evidence.supportRows', '{{count}} supporting rows', {
                count: analysis.aggregates.durationS.supportRows,
              })}
              icon={<Timer className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('shareCard.evidence.energy', 'Measured drive energy')}
              value={display.formatEnergy(analysis.aggregates.energyUsedWh.value)}
              subtitle={t('shareCard.evidence.supportRows', '{{count}} supporting rows', {
                count: analysis.aggregates.energyUsedWh.supportRows,
              })}
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('shareCard.evidence.activeDays', 'Active vehicle days')}
              value={hasReturnedData
                ? display.formatNumber(analysis.activeDays, 0)
                : '—'}
              subtitle={t('shareCard.evidence.requestedDays', '{{value}} requested calendar days', {
                value: analysis.window.requestedCalendarDays ?? '—',
              })}
              icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
          </Grid>
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
      </GlassPanel>
    </section>
  );
}
