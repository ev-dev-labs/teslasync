import { DataStateNotice, StaleRefreshWarning } from '@/components/feedback';
import { Button } from '@/components/ui';
import type { DriveScorePageModel } from '../../hooks/useDriveScorePage';

interface ScoreSourceNoticesProps {
  model: Pick<DriveScorePageModel,
    't' | 'drivesSource' | 'apiScoreState' | 'vehicleIdStr' | 'hasDrives'
    | 'scoreQuery' | 'drivesIsError' | 'hasScore' | 'drivesLoading' | 'unscoredDriveCount'>;
}

export function ScoreSourceNotices({ model }: ScoreSourceNoticesProps) {
  const {
    t, drivesSource, apiScoreState, vehicleIdStr, hasDrives,
    scoreQuery, drivesIsError, hasScore, drivesLoading, unscoredDriveCount,
  } = model;

  return (
    <>
      <StaleRefreshWarning state={drivesSource} label={t('driveScore.historySource', 'Drive history')} />
      <StaleRefreshWarning state={apiScoreState} label={t('driveScore.serverSource', 'Server drive score')} />
      {vehicleIdStr == null && (
        <DataStateNotice
          state="unavailable"
          role="status"
          title={t('common.noVehicleSelected.title', 'No vehicle selected')}
          message={t('driveScore.selectVehicle', 'Select a vehicle in the header to load drive score evidence.')}
        />
      )}
      {apiScoreState.fatalError && (
        <DataStateNotice
          state="unavailable"
          role="status"
          data-testid="drive-score-server-unavailable"
          title={hasDrives
            ? t('driveScore.serverUnavailable', 'Server drive score is unavailable; scored history remains visible')
            : t('driveScore.serverUnavailableOnly', 'Server drive score is unavailable')}
        >
          <Button variant="secondary" size="sm" wrapLabel onClick={() => { void scoreQuery.refetch(); }}>
            {t('common.retry', 'Retry')}
          </Button>
        </DataStateNotice>
      )}
      {drivesIsError && hasScore && (
        <DataStateNotice
          state="unavailable"
          role="status"
          data-testid="drive-score-history-unavailable"
          title={t('driveScore.historyUnavailable', 'Drive history is unavailable; the server drive score remains visible')}
        />
      )}
      {!drivesLoading && unscoredDriveCount > 0 && (
        <DataStateNotice
          state="partial"
          title={t('driveScore.partial.title', 'Score evidence is partial')}
          message={unscoredDriveCount === 1
            ? t(
                'driveScore.partial.message_one',
                '1 drive is excluded because measured energy, average power, or maximum speed is unavailable.',
              )
            : t(
                'driveScore.partial.message_other',
                '{{count}} drives are excluded because measured energy, average power, or maximum speed is unavailable.',
                { count: unscoredDriveCount },
              )}
        />
      )}
    </>
  );
}
