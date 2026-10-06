import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MediaSnapshot } from '@/api/types';
import { deriveDataState, type DataState } from '@/api/dataState';
import { finiteReading, listeningStats } from './mediaPresentation';

interface Props {
  filtered: readonly MediaSnapshot[];
  history: readonly MediaSnapshot[] | undefined;
  latest: MediaSnapshot | null;
  hasVehicle: boolean;
  historyLoading: boolean;
  mediaLoading: boolean;
  historyError: unknown;
  mediaError: unknown;
  historySource?: DataState<readonly MediaSnapshot[]>;
  mediaSource?: DataState<MediaSnapshot>;
  start: string;
  end: string;
}

export function MediaStats({
  filtered, history, latest, hasVehicle, historyLoading, mediaLoading,
  historyError, mediaError, historySource, mediaSource, start, end,
}: Props) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const stats = listeningStats(filtered);
  const trustedHistory = historySource ?? deriveDataState({
    data: history, isLoading: historyLoading, error: historyError,
  }, { provenance: 'historical' });
  const trustedMedia = mediaSource ?? deriveDataState({
    data: latest ?? undefined, isLoading: mediaLoading, error: mediaError,
  });
  const historyState = {
    loading: historyLoading && !trustedHistory.hasData,
    fatal: trustedHistory.fatalError != null,
    available: trustedHistory.hasData,
    retained: trustedHistory.refreshError != null || (trustedHistory.hasData && trustedHistory.isRefreshBlocked),
  };
  const mediaState = {
    loading: mediaLoading && !trustedMedia.hasData,
    fatal: trustedMedia.fatalError != null,
    available: trustedMedia.hasData,
    retained: trustedMedia.refreshError != null || (trustedMedia.hasData && trustedMedia.isRefreshBlocked),
  };
  const unavailable = t('media.modernization.unavailable', 'This source is unavailable');
  const loading = t('media.modernization.loading', 'Loading this source');
  const unknown = t('media.modernization.unknownReading', 'No reading reported');
  const selection = t('media.selectVehicle', 'Select a vehicle to see what’s playing');
  const historyReason = !hasVehicle ? selection : historyState.loading ? loading
    : historyState.fatal ? unavailable : !historyState.available ? unknown : undefined;
  const mediaReason = !hasVehicle ? selection : mediaState.loading ? loading
    : mediaState.fatal ? unavailable : !mediaState.available ? unknown : undefined;
  const historyAvailable = hasVehicle && historyState.available;
  // Audio levels are source scalars, not percentages or physical unit guesses.
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'media-unique-tracks',
      label: t('media.uniqueTracks', 'Unique tracks'),
      rawValue: historyAvailable ? stats.uniqueTracks : null,
      missingReason: historyReason,
      description: t('media.modernization.uniqueTracksHelp', 'Distinct non-empty track titles in the returned history inside the selected dates.'),
    },
    {
      metricId: 'text', occurrenceId: 'media-top-source',
      label: t('media.topSource', 'Top source'),
      rawValue: historyAvailable ? stats.topSource : null,
      missingReason: historyReason ?? unknown,
      description: t('media.modernization.topSourceHelp', 'Most frequent reported playback source in the returned history; missing source names are excluded.'),
    },
    {
      metricId: 'number', occurrenceId: 'media-average-volume',
      label: t('media.avgVolume', 'Avg volume'),
      rawValue: historyAvailable ? stats.avgVolume : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      missingReason: historyReason ?? unknown,
      description: t('media.modernization.averageVolumeHelp', 'Arithmetic mean of finite audio volume readings in the returned history, rounded as before. Missing readings are excluded.'),
    },
    {
      metricId: 'number', occurrenceId: 'media-volume-step',
      label: t('media.volumeStepFull', 'Volume step'),
      rawValue: hasVehicle && latest && finiteReading(latest.audio_volume_increment) ? latest.audio_volume_increment : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) },
      missingReason: mediaReason ?? unknown,
      description: t('media.modernization.volumeStepHelp', 'Audio volume increment from the latest media snapshot, not a historical average.'),
      context: t('media.modernization.latestSnapshot', 'Latest media snapshot'),
    },
  ];
  return (
    <VehicleOperationalBrief
      id="media-listening-stats"
      title={t('media.statsSection', 'Listening stats')}
      metrics={metrics}
      available={historyAvailable && hasVehicle && mediaState.available}
      period={{
        kind: 'unknown',
        label: t('media.modernization.returnedHistory', 'Returned history: {{start}} – {{end}}', { start, end }),
        reason: t('media.modernization.historyCoverage', 'Listening totals describe returned snapshots within the selected dates, not complete listening time. Volume step uses the latest snapshot.'),
      }}
      retained={historyState.retained || mediaState.retained}
    />
  );
}
