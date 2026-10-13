import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import {
  DestinationDirectory,
  DestinationRankings,
  DistanceBandsChart,
  EvidenceCoverage,
  ExplorerKpis,
  ExplorerMethodology,
  MonthlyExplorationChart,
  NewRepeatBehavior,
  type ExplorerSectionState,
} from '../components/explorer';
import {
  EXPLORER_HISTORY_LIMIT,
  summarizeExplorer,
} from '../lib/explorer';

const PRIMARY_COLUMNS = { default: 1, xl: 5 } as const;
const EVEN_COLUMNS = { default: 1, xl: 2 } as const;

export default function ExplorerPage() {
  const { t } = useTranslation();
  usePageTitle(t('explorer.title', 'Explorer'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdString =
    vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();
  const historyQuery = useDriveHistory(
    vehicleIdString,
    EXPLORER_HISTORY_LIMIT,
  );
  const summary = useMemo(
    () =>
      summarizeExplorer(historyQuery.data ?? [], {
        historyLimit: EXPLORER_HISTORY_LIMIT,
      }),
    [historyQuery.data],
  );
  const sourceState = useDataState(historyQuery, { provenance: 'historical' });

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('explorer.title', 'Explorer')}
      />
    );
  }

  const sectionState: ExplorerSectionState = {
    isLoading: sourceState.status === 'initial',
    error: sourceState.fatalError,
    onRetry: () => {
      void historyQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('explorer.title', 'Explorer')}
      subtitle={t(
        'explorer.subtitle',
        'How far and how wide your car actually roams',
      )}
      query={historyQuery}
      busy={sectionState.isLoading || sourceState.isRefreshing}
    >
      <StaleRefreshWarning state={sourceState} label={t('explorer.title', 'Explorer')} />
      <SectionErrorBoundary name="ExplorerKpis">
        <ExplorerKpis
          summary={summary}
          state={sectionState}
          formatDistance={formatDistance}
          retained={sourceState.status === 'stale' || sourceState.refreshError != null}
        />
      </SectionErrorBoundary>

      <Grid cols={PRIMARY_COLUMNS} gap={4}>
        <SectionErrorBoundary name="ExplorerDestinationDirectory">
          <DestinationDirectory
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
            className="xl:col-span-3"
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="ExplorerNewRepeatBehavior">
          <NewRepeatBehavior
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="ExplorerMonthlyExplorationChart">
        <MonthlyExplorationChart
          summary={summary}
          state={sectionState}
        />
      </SectionErrorBoundary>

      <Grid cols={EVEN_COLUMNS} gap={4}>
        <SectionErrorBoundary name="ExplorerDistanceBandsChart">
          <DistanceBandsChart
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="ExplorerDestinationRankings">
          <DestinationRankings
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
          />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="ExplorerEvidenceCoverage">
        <EvidenceCoverage summary={summary} state={sectionState} />
      </SectionErrorBoundary>

      <SectionErrorBoundary name="ExplorerMethodology">
        <ExplorerMethodology
          summary={summary}
          state={sectionState}
        />
      </SectionErrorBoundary>
    </PageLayout>
  );
}
