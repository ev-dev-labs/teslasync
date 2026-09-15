import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useDayLog } from '@/api/hooks/useDayLog';
import type { DayLogLayer } from '@/api/types';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSettings } from '@/hooks/useSettings';
import { browserTimezone } from '@/lib/timezone';
import { DAY_LOG_LAYERS, isValidYmd, todayYmd } from '../lib/daylog';
import { DayLogControls } from '../components/daylog/DayLogControls';
import { DayLogSummary } from '../components/daylog/DayLogSummary';
import { DayLogTimeline } from '../components/daylog/DayLogTimeline';
import { DayLogSources } from '../components/daylog/DayLogSources';

function parseLayers(raw: string | null): DayLogLayer[] {
  if (!raw) return [];
  const want = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  // Stable order, unknown tokens dropped (never trust the URL blindly).
  return DAY_LOG_LAYERS.filter((l) => want.has(l));
}

/**
 * Day log — "what happened to this vehicle today". One vehicle, one
 * local calendar day, reconstructed from session rows, the vehicle FSM
 * log, security events, software history, and signal edges.
 *
 * URL owns the shareable scope (`date`, `layers`); the vehicle comes
 * from the selected-vehicle store. Every section renders its own
 * loading/error/empty state — the page shell never hides behind data.
 */
export default function DayLogPage() {
  const { t } = useTranslation();
  const title = t('dayLog.title', 'Day log');
  usePageTitle(title);

  const { vehicleId } = useSelectedVehicle();
  const { settings } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();

  const timezone = useMemo(() => {
    const override = settings.timezone_user?.trim();
    return override !== '' && override != null ? override : browserTimezone();
  }, [settings.timezone_user]);

  const date = useMemo(() => {
    const raw = searchParams.get('date') ?? '';
    return isValidYmd(raw) ? raw : todayYmd(timezone);
  }, [searchParams, timezone]);

  const layers = useMemo(() => parseLayers(searchParams.get('layers')), [searchParams]);

  const dayLogQuery = useDayLog({ vehicleId, date, timezone, layers });
  const state = useDataState(dayLogQuery);

  const setDate = useCallback(
    (next: string) => {
      const out = new URLSearchParams(searchParams);
      out.set('date', next);
      setSearchParams(out);
    },
    [searchParams, setSearchParams],
  );

  const toggleLayer = useCallback(
    (layer: DayLogLayer) => {
      const out = new URLSearchParams(searchParams);
      const current = new Set(parseLayers(out.get('layers')));
      if (current.has(layer)) {
        current.delete(layer);
      } else {
        current.add(layer);
      }
      const ordered = DAY_LOG_LAYERS.filter((l) => current.has(l));
      if (ordered.length > 0) {
        out.set('layers', ordered.join(','));
      } else {
        out.delete('layers');
      }
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
      title={title}
      subtitle={t('dayLog.subtitle', 'What happened to this vehicle today')}
      query={dayLogQuery}
      copyLink
    >
      <FadeIn>
        <DayLogControls
          date={date}
          timezone={timezone}
          layers={layers}
          onDateChange={setDate}
          onToggleLayer={toggleLayer}
        />
      </FadeIn>

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
