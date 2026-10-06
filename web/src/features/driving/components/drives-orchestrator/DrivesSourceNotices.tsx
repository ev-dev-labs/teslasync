import { Button, Text } from '@/components/ui';
import { StaleRefreshWarning, DataStateNotice } from '@/components/feedback';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'drivesState' | 'fsdRangeSupported' | 'fsdState' | 'fsdDataAvailable'
  | 'refetchFsd' | 'isDrivesLoading' | 'currentStats' | 'missingEfficiencyCount'>;

export function DrivesSourceNotices({
  t, drivesState, fsdRangeSupported, fsdState, fsdDataAvailable,
  refetchFsd, isDrivesLoading, currentStats, missingEfficiencyCount,
}: Props) {
  return (
    <>
      <StaleRefreshWarning
        state={drivesState}
        label={t('drives.title', 'Drive History')}
      />

      {!fsdRangeSupported && (
        <DataStateNotice
          state="unsupported"
          title={t('drives.fsdRangeUnsupported.title', 'FSD evidence is unavailable for this range')}
          message={t(
            'drives.fsdRangeUnsupported.message',
            'FSD attribution supports up to 366 days at a time. Drive history remains available, but FSD filters and sorting are disabled.',
          )}
        />
      )}

      {fsdRangeSupported && fsdState.fatalError && (
        <DataStateNotice
          state="unavailable"
          title={t('drives.fsdUnavailable.title', 'FSD evidence could not be loaded')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text>
              {t(
                'drives.fsdUnavailable.message',
                'Drive history remains available, but FSD badges, filters, and sorting are disabled until this data loads successfully.',
              )}
            </Text>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { void refetchFsd(); }}
            >
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        </DataStateNotice>
      )}

      {fsdRangeSupported && fsdState.hasData && !fsdState.fatalError && !fsdDataAvailable && (
        <DataStateNotice
          state="unavailable"
          role="status"
          title={t('drives.fsdMissing.title', 'Per-drive FSD evidence is unavailable')}
          message={t(
            'drives.fsdMissing.message',
            'This response has no per-drive FSD attribution. Drive history remains available; FSD filters and sorting stay disabled.',
          )}
        />
      )}

      {fsdRangeSupported && (
        <StaleRefreshWarning
          state={fsdState}
          label={t('drives.fsdEvidence', 'FSD evidence')}
        />
      )}

      {!isDrivesLoading && currentStats.count > 0 && missingEfficiencyCount > 0 && (
        <DataStateNotice
          state="partial"
          title={t('drives.partialEnergy.title', 'Efficiency evidence is partial')}
          message={t(
            'drives.partialEnergy.message',
            '{{measured}} of {{total}} drives include measured energy and at least 1 km of distance. Activity, route, and timing evidence remain complete.',
            {
              measured: currentStats.efficiencyMeasuredCount,
              total: currentStats.count,
            },
          )}
        />
      )}
    </>
  );
}
