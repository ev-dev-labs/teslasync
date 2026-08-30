import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useFsdInsights } from '@/api/hooks/useAnalytics';
import { StaleRefreshWarning } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUrlState } from '@/hooks/useUrlState';
import { browserTimezone } from '@/lib/timezone';
import { FSD_DEFAULT_PERIOD_DAYS, type FsdPeriodDays } from '@/types/fsd';

import {
  FsdConfidencePanel,
  FsdDistanceTrend,
  FsdKpiBand,
  FsdPeriodControl,
  FsdShareTrend,
  FsdTopDays,
  FsdWeekdayPattern,
  coercePeriodDays,
  type FsdSectionState,
} from '../components/fsd-insights';

const SPLIT_COLUMNS = { default: 1, xl: 2 } as const;

/** `?days=` is validated on read, so a hand-edited URL degrades to the default. */
const DAYS_URL_STATE = {
  key: 'days',
  defaultValue: FSD_DEFAULT_PERIOD_DAYS,
  parse: (raw: string): FsdPeriodDays | undefined => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? coercePeriodDays(parsed, FSD_DEFAULT_PERIOD_DAYS) : undefined;
  },
  serialize: (value: FsdPeriodDays) => String(value),
  // Keep `?days=30` in the URL after an explicit selection so a copied link
  // always carries the period the operator was actually looking at.
  omitDefault: false,
} as const;

/**
 * FSD Insights — supervised self-driving distance telemetry.
 *
 * Thin orchestrator: one query, one URL-backed period control, and a set of
 * independently mounted panels. Every panel renders its own shell in the
 * loading, error, empty, and no-vehicle states, so nothing on this page ever
 * disappears.
 *
 * Data-trust contract: panels read `state.data`, the page-level error surface
 * reads `state.fatalError` (set only when NOTHING is retained), and a failed
 * background refresh renders `<StaleRefreshWarning>` above retained content
 * instead of blanking it.
 *
 * The browser's IANA timezone travels with the request because the backend
 * groups counter deltas by LOCAL calendar day; `browserTimezone()` falls back
 * to UTC when `Intl` is unavailable.
 */
export default function FSDInsightsPage() {
  const { t } = useTranslation();
  usePageTitle(t('fsd.title', 'FSD Insights'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  // Period lives in the URL so Copy link, reload, and browser back all restore
  // the same window. `replace` (the hook default) keeps a filter toggle out of
  // the history stack, matching the repo's URL-state guidance.
  const [days, setDays] = useUrlState<FsdPeriodDays>(DAYS_URL_STATE);

  const insightsQuery = useFsdInsights(vehicleIdStr, days, browserTimezone());
  const insightsState = useDataState(insightsQuery, { provenance: 'historical' });

  const retry = insightsState.retry;
  const onRetry = useCallback(() => {
    retry?.();
  }, [retry]);

  const sectionState: FsdSectionState = {
    // `initial` is the only status with nothing retained AND no failure, so it
    // is the only one that should show a skeleton. A failed refresh keeps the
    // retained payload on screen.
    isLoading: insightsState.status === 'initial',
    error: insightsState.fatalError,
    onRetry,
    noVehicle: vehicleId == null,
  };

  return (
    <PageContainer
      title={t('fsd.title', 'FSD Insights')}
      subtitle={t(
        'fsd.subtitle',
        'Reported supervised self-driving distance and its share of observed driving, with the counter evidence behind every metric.',
      )}
      query={insightsQuery}
      copyLink
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge
            provenance={insightsState.provenance}
            status={insightsState.status}
            updatedAt={insightsState.updatedAt}
          />
          <VehicleSelect />
          <FsdPeriodControl value={days} onChange={setDays} disabled={vehicleId == null} />
        </div>
      }
    >
      <StaleRefreshWarning state={insightsState} label={t('fsd.title', 'FSD Insights')} />

      <FadeIn>
        <FsdKpiBand insights={insightsState.data} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <FsdDistanceTrend insights={insightsState.data} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={SPLIT_COLUMNS} gap={4}>
          <FsdShareTrend insights={insightsState.data} state={sectionState} />
          <FsdWeekdayPattern insights={insightsState.data} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <FsdTopDays insights={insightsState.data} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <FsdConfidencePanel insights={insightsState.data} state={sectionState} />
      </FadeIn>
    </PageContainer>
  );
}
