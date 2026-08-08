import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
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

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('explorer.title', 'Explorer')}
      />
    );
  }

  const sectionState: ExplorerSectionState = {
    isLoading: historyQuery.isLoading,
    error: historyQuery.isError ? historyQuery.error : null,
    onRetry: () => {
      void historyQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('explorer.title', 'Explorer')}
      subtitle={t(
        'explorer.subtitle',
        'How far and how wide your car actually roams',
      )}
      query={historyQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <ExplorerKpis
          summary={summary}
          state={sectionState}
          formatDistance={formatDistance}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={PRIMARY_COLUMNS} gap={4}>
          <DestinationDirectory
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
            className="xl:col-span-3"
          />
          <NewRepeatBehavior
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <MonthlyExplorationChart
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={EVEN_COLUMNS} gap={4}>
          <DistanceBandsChart
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
          />
          <DestinationRankings
            summary={summary}
            state={sectionState}
            formatDistance={formatDistance}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidenceCoverage summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.25}>
        <ExplorerMethodology
          summary={summary}
          state={sectionState}
        />
      </FadeIn>
    </PageContainer>
  );
}
