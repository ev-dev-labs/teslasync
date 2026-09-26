import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { StaleRefreshWarning } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { getDatePreset } from '@/lib/datePresets';
import { addCivilDays, civilDateInTimeZone } from '@/lib/dateRange';

import {
  FsdConfidencePanel,
  FsdDistanceTrend,
  FsdDriveAnalyticsPanels,
  FsdKpiBand,
  FsdObservatoryPanel,
  FsdShareTrend,
  FsdTopDays,
  FsdWeekdayPattern,
  type FsdSectionState,
} from '../components/fsd-insights';

const SPLIT_COLUMNS = { default: 1, xl: 2 } as const;
const LEGACY_PERIOD_PRESETS: Record<string, string> = {
  '7': '7d',
  '30': '30d',
  '90': '90d',
};

/**
 * FSD Insights — supervised self-driving distance telemetry.
 *
 * Thin orchestrator: one shared workspace-range query and a set of
 * independently mounted panels. Every panel renders its own shell in the
 * loading, error, empty, and no-vehicle states, so nothing on this page ever
 * disappears.
 *
 * Data-trust contract: panels read `state.data`, the page-level error surface
 * reads `state.fatalError` (set only when NOTHING is retained), and a failed
 * background refresh renders `<StaleRefreshWarning>` above retained content
 * instead of blanking it.
 *
 * The workspace range's IANA timezone travels with the request because the
 * backend groups counter deltas by local calendar day.
 */
export default function FSDInsightsPage() {
  const { t } = useTranslation();
  usePageTitle(t('fsd.title', 'FSD Insights'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const legacyDays = searchParams.get('days');
  const { preferences } = useProductPreferences();
  const { startInstant, endInstantExclusive, timezone, setRangeWithUrlUpdates } = useRangeState({
    defaultPresetId: preferences.defaultAnalysisRange,
  });
  const migratingLegacyLink = legacyDays !== null
    && !searchParams.has('from') && !searchParams.has('to');
  useEffect(() => {
    if (legacyDays === null) return;
    if (!migratingLegacyLink) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete('days');
        return next;
      }, { replace: true });
      return;
    }

    const now = new Date();
    const presetId = LEGACY_PERIOD_PRESETS[legacyDays] ?? '30d';
    const preset = getDatePreset(presetId);
    if (!preset) throw new Error(`Missing FSD date preset: ${presetId}`);
    const range = legacyDays === '365'
      ? {
          start: addCivilDays(civilDateInTimeZone(now, timezone), -364),
          end: civilDateInTimeZone(now, timezone),
        }
      : preset.resolve(now, timezone);
    setRangeWithUrlUpdates(range, { days: null }, legacyDays === '365' ? undefined : presetId);
  }, [legacyDays, migratingLegacyLink, setRangeWithUrlUpdates, setSearchParams, timezone]);

  const insightsQuery = useFsdInsightsRange(
    vehicleIdStr,
    migratingLegacyLink ? undefined : startInstant,
    migratingLegacyLink ? undefined : endInstantExclusive,
    timezone,
  );
  const insightsState = useDataState(insightsQuery, { provenance: 'historical' });

  const retry = insightsState.retry;
  const onRetry = useCallback(() => {
    retry?.();
  }, [retry]);

  useEffect(() => {
    if (insightsState.status === 'initial') return;
    const id = window.location.hash.replace(/^#/, '');
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [insightsState.status, insightsState.data]);

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
        </div>
      }
    >
      <StaleRefreshWarning state={insightsState} label={t('fsd.title', 'FSD Insights')} />

      <FadeIn>
        <FsdKpiBand insights={insightsState.data} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.04}>
        <FsdObservatoryPanel insights={insightsState.data} state={sectionState} />
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
        <div className="space-y-4 sm:space-y-5">
          <FsdDriveAnalyticsPanels insights={insightsState.data} state={sectionState} />
        </div>
      </FadeIn>

      <FadeIn delay={0.25}>
        <FsdConfidencePanel insights={insightsState.data} state={sectionState} />
      </FadeIn>
    </PageContainer>
  );
}
