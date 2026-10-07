import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout';
import { Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useDayLog } from '@/api/hooks/useDayLog';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import { isValidYmd, todayYmd } from '../lib/daylog';
import { DayLogControls } from '../components/daylog/DayLogControls';
import { DayLogSummary } from '../components/daylog/DayLogSummary';
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
  const state = useDataState(dayLogQuery);

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
  const isLoading = dayLogQuery.isPending;
  const fatalError = state.fatalError;

  return (
    <PageContainer
      actionLayout="scope-first"
      title={title}
      subtitle={
        <>
          {t('dayLog.subtitle', 'What happened to this vehicle today')}
          <Text as="span" variant="caption" className="mt-1 block [overflow-wrap:anywhere]" id="daylog-timezone">
            {t('dayLog.controls.timezoneNote', 'Day boundaries in {{tz}}', { tz: timezone })}
          </Text>
        </>
      }
      query={dayLogQuery}
      copyLink
      contextActions={<DayLogControls date={date} timezone={timezone} onDateChange={setDate} />}
    >
      <FadeIn delay={0.05}>
        <DayLogSummary summary={data?.summary ?? null} isLoading={isLoading} error={fatalError} onRetry={retry} />
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
    </PageContainer>
  );
}
