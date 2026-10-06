import { useTranslation } from 'react-i18next';
import { GlassPanel, Slider, PanelTitle, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Timeline, TimelineScrubber } from '@/components/data-display';
import type { TimelineItemData } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { ClipRecord, DashcamSettings } from '../../lib/types';
import type { UseReconstructionResult } from '../../hooks/useReconstruction';
import { toReconstructionMarkers } from '../../lib/timelineAlignment';
import { SignalPicker } from './SignalPicker';
import { ReconstructionSeriesList } from './ReconstructionSeriesList';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface ReconstructionTimelineProps {
  clip: ClipRecord;
  vehicleId: number | null;
  settings: DashcamSettings;
  onUpdateSettings: (next: DashcamSettings) => void;
  selectedSignals: string[];
  onSelectedSignalsChange: (signals: string[]) => void;
  result: UseReconstructionResult;
}

/**
 * Telemetry-synchronized incident reconstruction: aligns the clip's
 * (timezone-assumed) start time to the selected vehicle's signal history
 * and renders a normalized timeline plus a statistically-derived incident
 * sequence, always paired with explicit coverage/quality and lookback
 * caveats. Hook orchestration (settings + the reconstruction query) lives
 * in the parent `ClipDetailPanel` so the same result can also feed the
 * export manifest without re-deriving it.
 */
export function ReconstructionTimeline({
  clip,
  vehicleId,
  settings,
  onUpdateSettings,
  selectedSignals,
  onSelectedSignalsChange,
  result,
}: ReconstructionTimelineProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDuration } = useUnits();

  if (clip.capturedAtRaw == null || result.clipEpochMs == null) {
    return (
      <GlassPanel padding="md">
        <InlineCallout variant="warning">
          {t(
            'dashcam.reconstruction.noTimestamp',
            "This clip's filename did not include a parseable capture time, so it cannot be aligned to telemetry history.",
          )}
        </InlineCallout>
      </GlassPanel>
    );
  }

  if (vehicleId == null) {
    return (
      <GlassPanel padding="md">
        <InlineCallout variant="info">
          {t('dashcam.reconstruction.noVehicle', 'Select a vehicle above to align this clip with telemetry history.')}
        </InlineCallout>
      </GlassPanel>
    );
  }

  const reconstruction = result.reconstruction;
  const source = deriveDataState({
    data: result.hasRetainedHistory ? reconstruction ?? undefined : undefined,
    error: result.isError ? result.error : null,
    isError: result.isError,
    isLoading: result.isLoading,
    refetch: result.refetch,
  }, { provenance: 'historical' });
  const clockLabel = (seconds: number) => t('dashcam.events.atSeconds', 't={{seconds}}s', { seconds: fmtNumber(seconds) });
  const markers = reconstruction ? toReconstructionMarkers(reconstruction).map((marker, index) => {
    const event = reconstruction.incidentSequence[index - 2];
    return {
      ...marker,
      id: index === 0 ? 'clip-start' : index === 1 ? 'clip-end' : event.id,
      label: index === 0 ? t('dashcam.reconstruction.clipStart', 'Clip start')
        : index === 1 ? t('dashcam.reconstruction.clipEnd', 'Clip end') : event.signal,
      description: event?.description,
      timeLabel: clockLabel(index === 0 ? reconstruction.clipWindow.startSeconds
        : index === 1 ? reconstruction.clipWindow.endSeconds : event.atSeconds),
    };
  }) : [];
  const incidentItems: TimelineItemData[] = (result.reconstruction?.incidentSequence ?? []).map((evt) => ({
    title: evt.signal,
    subtitle: evt.description,
    time: t('dashcam.events.atSeconds', 't={{seconds}}s', { seconds: fmtNumber(evt.atSeconds) }),
  }));

  return (
    <LayoutCard
      title={t('dashcam.reconstruction.title', 'Telemetry-synchronized reconstruction')}
      description={t('dashcam.reconstruction.description', 'Filenames carry no timezone. Adjust the assumed camera clock offset below if the reconstruction looks shifted.')}
    >

      <Slider
        label={t('dashcam.reconstruction.offsetLabel', 'Assumed camera clock offset from UTC')}
        min={-720}
        max={840}
        step={15}
        value={settings.assumedTimezoneOffsetMinutes}
        onChange={(v) => onUpdateSettings({ ...settings, assumedTimezoneOffsetMinutes: v })}
        formatValue={(n) => t('dashcam.reconstruction.offsetValue', '{{n}} min', { n })}
      />

      <SignalPicker vehicleId={vehicleId} selected={selectedSignals} onChange={onSelectedSignalsChange} />

      <InlineCallout variant="info">
        {t(
          'dashcam.reconstruction.lookbackNote',
          'Requesting the last {{hours}}h of telemetry history from now to reach this clip. Older signal data may already have been pruned server-side.',
          { hours: result.lookbackHours },
        )}
      </InlineCallout>
      {result.possiblyOutOfLookbackRange && (
        <InlineCallout variant="warning">
          {t('dashcam.reconstruction.outOfRange', 'This clip is old enough that server-side telemetry retention may not reach back this far.')}
        </InlineCallout>
      )}

      <SourceContent
        state={source.fatalError ? 'error' : source.refreshError ? 'retained'
          : result.isLoading && !source.hasData ? 'loading' : source.hasData ? 'ready' : 'empty'}
        label={t('dashcam.reconstruction.title', 'Telemetry-synchronized reconstruction')}
        error={source.fatalError}
        errorMessage={t('dashcam.reconstruction.loadFailed', 'Telemetry reconstruction could not be loaded.')}
        emptyMessage={selectedSignals.length === 0
          ? t('dashcam.reconstruction.selectSignals', 'Choose telemetry signals above to build a reconstruction.')
          : t('dashcam.reconstruction.noData', 'No telemetry reconstruction is available for this clip.')}
        errorRecovery={{ onRetry: () => { void result.refetch(); } }}
      >
      {reconstruction && (
        <>
          <div className="space-y-1">
            <TimelineScrubber
              mode="readOnly"
              label={t('dashcam.reconstruction.title', 'Telemetry-synchronized reconstruction')}
              duration={reconstruction.reconstructionWindow.endSeconds - reconstruction.reconstructionWindow.startSeconds}
              clockOriginSeconds={reconstruction.reconstructionWindow.startSeconds}
              formatTime={clockLabel}
              markers={markers}
            />
            <Text as="p" variant="caption">
              {t('dashcam.reconstruction.window', 'Window: {{pre}} pre-roll → clip → {{post}} post-roll', {
                pre: formatDuration(settings.reconstructionPreRollSeconds),
                post: formatDuration(settings.reconstructionPostRollSeconds),
              })}
            </Text>
          </div>

          <ReconstructionSeriesList series={reconstruction.series} />

          {incidentItems.length > 0 ? (
            <div className="space-y-2">
              <PanelTitle>
                {t('dashcam.reconstruction.incidentSequence', 'Incident sequence (statistical)')}
              </PanelTitle>
              <Timeline items={incidentItems} chronology="oldest-first" />
            </div>
          ) : (
            <Text as="p" variant="caption">
              {t('dashcam.reconstruction.noIncidents', 'No statistically significant telemetry changes were detected in this window.')}
            </Text>
          )}
        </>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
