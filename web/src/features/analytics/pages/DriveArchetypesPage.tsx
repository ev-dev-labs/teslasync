import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import {
  ArchetypeAssignmentDirectory,
  ArchetypeCandidateModels,
  ArchetypeCentroidMap,
  ArchetypeClusterComposition,
  ArchetypeConfidenceDistribution,
  ArchetypeEvidenceLedger,
  ArchetypeExactAccounting,
  ArchetypeFeatureEvidence,
  ArchetypeHistoryCoverage,
  ArchetypeHourlyProfile,
  ArchetypeMethodology,
  ArchetypeMonthlyComposition,
  ArchetypeProfiles,
  ArchetypeSeparation,
  ArchetypeSourceDisposition,
  useDriveArchetypeDisplay,
  type ArchetypeQueryState,
} from '../components/drive-archetypes';
import { summarizeArchetypes } from '../lib/driveArchetypes';

export default function DriveArchetypesPage() {
  const { t } = useTranslation();
  usePageTitle(t('archetypes.title', 'Drive Archetypes'));
  const { vehicleId } = useSelectedVehicle();
  const timeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const historyQuery = useDriveHistory(vehicleIdStr, 1000);
  const display = useDriveArchetypeDisplay(timeZone);
  const summary = useMemo(
    () => summarizeArchetypes(historyQuery.data ?? [], { timeZone }),
    [historyQuery.data, timeZone],
  );
  const hasData = historyQuery.data !== undefined;
  const retry = useCallback(() => {
    void historyQuery.refetch();
  }, [historyQuery.refetch]);
  const queryState = useMemo<ArchetypeQueryState>(
    () => ({
      vehicleSelected: vehicleId != null,
      hasData,
      isLoading:
        !hasData
        && (
          historyQuery.isLoading
          || (
            historyQuery.isPending
            && historyQuery.fetchStatus === 'fetching'
          )
        ),
      isResolved: historyQuery.isSuccess || hasData,
      isFetching: historyQuery.isFetching,
      isPaused: !hasData && historyQuery.fetchStatus === 'paused',
      refreshPaused: hasData && historyQuery.fetchStatus === 'paused',
      error:
        historyQuery.isError && !hasData
          ? historyQuery.error
          : null,
      refreshError:
        historyQuery.isError && hasData
          ? historyQuery.error
          : null,
      onRetry: retry,
    }),
    [
      hasData,
      historyQuery.error,
      historyQuery.fetchStatus,
      historyQuery.isError,
      historyQuery.isFetching,
      historyQuery.isLoading,
      historyQuery.isPending,
      historyQuery.isSuccess,
      retry,
      vehicleId,
    ],
  );
  const refresh = useCallback(() => {
    if (vehicleId == null) return;
    void historyQuery.refetch();
  }, [historyQuery.refetch, vehicleId]);

  return (
    <PageContainer
      title={t('archetypes.title', 'Drive Archetypes')}
      subtitle={t(
        'archetypes.subtitle',
        'A dense observational workspace for source eligibility, deterministic clustering, assignments, and interpretation limits',
      )}
      query={vehicleId != null ? historyQuery : undefined}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={vehicleId == null}
            loading={historyQuery.isFetching && vehicleId != null}
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            {t('archetypes.actions.refresh', 'Refresh evidence')}
          </Button>
          <VehicleSelect />
        </div>
      )}
    >
      <FadeIn>
        <ArchetypeEvidenceLedger summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.03}>
        <ArchetypeSourceDisposition summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.04}>
        <ArchetypeHistoryCoverage
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.05}>
        <ArchetypeFeatureEvidence
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.06}>
        <ArchetypeCandidateModels summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.07}>
        <ArchetypeCentroidMap
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <ArchetypeClusterComposition
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.09}>
        <ArchetypeProfiles
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.1}>
        <ArchetypeSeparation summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.11}>
        <ArchetypeConfidenceDistribution summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.12}>
        <ArchetypeHourlyProfile summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.13}>
        <ArchetypeMonthlyComposition
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.14}>
        <ArchetypeAssignmentDirectory
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
      <FadeIn delay={0.15}>
        <ArchetypeExactAccounting summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.16}>
        <ArchetypeMethodology
          summary={summary}
          state={queryState}
          display={display}
        />
      </FadeIn>
    </PageContainer>
  );
}
