import { DataStateNotice, StaleRefreshWarning } from '@/components/feedback';
import { Button } from '@/components/ui';
import type { DriveScorePageModel } from '../../hooks/useDriveScorePage';
import { summarizeScoreAdmission } from './scoreDomain';

interface ScoreSourceNoticesProps {
  model: Pick<DriveScorePageModel,
    't' | 'drivesSource' | 'apiScoreState' | 'vehicleIdStr' | 'hasDrives'
    | 'scoreQuery' | 'drivesIsError' | 'hasScore' | 'drivesLoading' | 'filteredDrives' | 'fmtInt'>;
}

export function ScoreSourceNotices({ model }: ScoreSourceNoticesProps) {
  const {
    t, drivesSource, apiScoreState, vehicleIdStr, hasDrives,
    scoreQuery, drivesIsError, hasScore, drivesLoading, filteredDrives, fmtInt,
  } = model;
  const { excluded, counts } = summarizeScoreAdmission(filteredDrives);
  const reasons = [
    counts.missing > 0 ? t('driveScore.partial.missing', {
      count: counts.missing, displayCount: fmtInt(counts.missing),
      defaultValue: '{{displayCount}} with missing inputs.',
    }) : '',
    counts.invalid > 0 ? t('driveScore.partial.invalid', {
      count: counts.invalid, displayCount: fmtInt(counts.invalid),
      defaultValue: '{{displayCount}} with invalid inputs.',
    }) : '',
    counts.shortDistance > 0 ? t('driveScore.partial.shortDistance', {
      count: counts.shortDistance, displayCount: fmtInt(counts.shortDistance),
      defaultValue: '{{displayCount}} below the 1,000 m minimum distance.',
    }) : '',
  ].filter(Boolean).join(' ');

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
      {!drivesLoading && excluded > 0 && (
        <DataStateNotice
          state="partial"
          title={t('driveScore.partial.title', 'Score evidence is partial')}
          message={`${t('driveScore.partial.message', {
            count: excluded,
            displayCount: fmtInt(excluded),
            defaultValue_one: '{{displayCount}} drive is excluded from the local heuristic. Reason counts may overlap.',
            defaultValue: '{{displayCount}} drives are excluded from the local heuristic. Reason counts may overlap.',
          })} ${reasons}`}
        />
      )}
    </>
  );
}
