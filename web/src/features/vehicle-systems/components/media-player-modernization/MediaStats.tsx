import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MediaSnapshot } from '@/api/types';
import { finiteReading, listeningStats, sourcePresentation } from './mediaPresentation';

interface Props {
  filtered: readonly MediaSnapshot[];
  history: readonly MediaSnapshot[] | undefined;
  latest: MediaSnapshot | null;
  hasVehicle: boolean;
  historyLoading: boolean;
  mediaLoading: boolean;
  historyError: unknown;
  mediaError: unknown;
  start: string;
  end: string;
}

export function MediaStats({
  filtered, history, latest, hasVehicle, historyLoading, mediaLoading,
  historyError, mediaError, start, end,
}: Props) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const stats = listeningStats(filtered);
  const historyState = sourcePresentation(history, historyLoading, historyError);
  const mediaState = sourcePresentation(latest, mediaLoading, mediaError);
  const unavailable = t('media.modernization.unavailable', 'This source is unavailable');
  const loading = t('media.modernization.loading', 'Loading this source');
  const unknown = t('media.modernization.unknownReading', 'No reading reported');
  const selection = t('media.selectVehicle', 'Select a vehicle to see what’s playing');
  const historyReason = !hasVehicle ? selection : historyState.loading ? loading
    : historyState.fatal ? unavailable : !historyState.available ? unknown : undefined;
  const mediaReason = !hasVehicle ? selection : mediaState.loading ? loading
    : mediaState.fatal ? unavailable : !mediaState.available ? unknown : undefined;
  const historyAvailable = hasVehicle && historyState.available;
  // Text is deliberately source-formatted: preserve acquired fmtInt rounding of
  // average volume and fmtNumber precision of step. Neither is a percentage.
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
      metricId: 'text', occurrenceId: 'media-average-volume',
      label: t('media.avgVolume', 'Avg volume'),
      rawValue: historyAvailable && stats.avgVolume != null ? fmtInt(stats.avgVolume) : null,
      missingReason: historyReason ?? unknown,
      description: t('media.modernization.averageVolumeHelp', 'Arithmetic mean of finite audio volume readings in the returned history, rounded as before. Missing readings are excluded.'),
    },
    {
      metricId: 'text', occurrenceId: 'media-volume-step',
      label: t('media.volumeStepFull', 'Volume step'),
      rawValue: hasVehicle && latest && finiteReading(latest.audio_volume_increment) ? fmtNumber(latest.audio_volume_increment) : null,
      missingReason: mediaReason ?? unknown,
      description: t('media.modernization.volumeStepHelp', 'Audio volume increment from the latest media snapshot, not a historical average.'),
      context: t('media.modernization.latestSnapshot', 'Latest media snapshot'),
    },
  ];
  return (
    <StatStrip
      id="media-listening-stats"
      title={t('media.statsSection', 'Listening stats')}
      metrics={metrics}
      period={{
        kind: 'unknown',
        label: t('media.modernization.returnedHistory', 'Returned history: {{start}} – {{end}}', { start, end }),
        reason: t('media.modernization.historyCoverage', 'Listening totals describe returned snapshots within the selected dates, not complete listening time. Volume step uses the latest snapshot.'),
      }}
      retained={historyState.retained || mediaState.retained}
    />
  );
}
