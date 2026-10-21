import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '@/components/layout';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDayLog } from '@/api/hooks/useDayLog';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import { isValidYmd, todayYmd } from '../lib/daylog';
import { DayLogControls } from '../components/daylog/DayLogControls';
import { DayLogOperationalSummary } from '../components/operationalbrief-a-m/DayLogOperationalSummary';
import { DayLogTimeline } from '../components/daylog/DayLogTimeline';
import { DayLogSources } from '../components/daylog/DayLogSources';

/**
 * Day log — "what happened to this vehicle today". One vehicle, one
 * local calendar day: the COMPLETE recorded history, every category on
 * by default with no active filters. Search + category chips filter
 * client-side over the already-complete dataset.
 *
 * URL owns the shareable scope (`date`); the vehicle comes from the
 * selected-vehicle store. Every section renders its own
 * loading/error/empty state — the page shell never hides behind data.
 */
export default function DayLogPage() {
  const { t } = useTranslation();
  const title = t('dayLog.title', 'Day log');
  usePageTitle(title);

  const { vehicleId } = useSelectedVehicle();
  const timezone = useTimezone('vehicle');
  const [searchParams, setSearchParams] = useSearchParams();

  const date = useMemo(() => {
    const raw = searchParams.get('date') ?? '';
    return isValidYmd(raw) ? raw : todayYmd(timezone);
  }, [searchParams, timezone]);

  // No layers param: the server defaults to the complete history.
  const dayLogQuery = useDayLog({ vehicleId, date, timezone });
  const state = useDataState(dayLogQuery, {
    provenance: 'historical',
    partial: dayLogQuery.data?.truncated === true
      || (dayLogQuery.data?.sources?.some((source) => source.status === 'unavailable') ?? false),
  });

  const setDate = useCallback(
    (next: string) => {
      const out = new URLSearchParams(searchParams);
      out.set('date', next);
      setSearchParams(out);
    },
    [searchParams, setSearchParams],
  );

  const retry = useCallback(() => {
    void dayLogQuery.refetch();
  }, [dayLogQuery]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={title} />;
  }

  const data = state.data ?? null;
  const initialDeferred = !state.hasData && state.isRefreshBlocked && !state.fatalError;
  const isLoading = !state.hasData && !state.isRefreshBlocked && dayLogQuery.isLoading;
  const fatalError = state.fatalError;

  return (
    <PageLayout
      actionLayout="scope-first"
      title={title}
      subtitle={t('dayLog.subtitle', 'What happened to this vehicle today')}
      query={dayLogQuery}
      copyLink
      contextActions={<DayLogControls date={date} timezone={timezone} onDateChange={setDate} />}
    >
      <StaleRefreshWarning
        state={state}
        label={title}
        title={state.status === 'partial' ? t('dataState.partial.title', 'Partial data') : undefined}
        message={state.status === 'partial'
          ? data?.truncated
            ? t('dayLog.timeline.truncated', 'Some records may be missing — the day exceeded the signal read cap. What loaded is shown in full.')
            : t('dayLog.brief.status.partial', 'Some sources unavailable')
          : undefined}
      />
      {initialDeferred ? (
        [
          { id: 'daylog-summary', title: t('dayLog.summary.title', 'Day summary') },
          { id: 'daylog-timeline', title: t('dayLog.timeline.title', 'Timeline') },
          { id: 'daylog-sources', title: t('dayLog.sources.title', 'Sources') },
        ].map((section) => (
          <GlassPanel key={section.id} className="min-w-0 space-y-3 p-6" data-testid={section.id}>
            <PanelTitle>{section.title}</PanelTitle>
            <Text as="p" variant="bodySm" color="secondary" role="status">
              {t('fleetOps.brief.refreshBlocked', 'Refresh paused')}
              {' · '}
              {t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.')}
            </Text>
            <Button variant="secondary" onClick={retry}>
              {t('error.retry', 'Retry')}
            </Button>
          </GlassPanel>
        ))
      ) : (
        <>
          <FadeIn delay={0.05}>
            <DayLogOperationalSummary
              data={data}
              date={date}
              isLoading={isLoading}
              error={fatalError}
              status={state.status}
              onRetry={retry}
            />
          </FadeIn>

          <FadeIn delay={0.1}>
            <DayLogTimeline
              events={data?.events ?? null}
              timezone={data?.timezone ?? timezone}
              vehicleId={vehicleId}
              truncated={data?.truncated ?? false}
              isLoading={isLoading}
              error={fatalError}
              onRetry={retry}
            />
          </FadeIn>

          <FadeIn delay={0.15}>
            <DayLogSources sources={data?.sources ?? null} isLoading={isLoading} error={fatalError} onRetry={retry} />
          </FadeIn>
        </>
      )}
    </PageLayout>
  );
}
