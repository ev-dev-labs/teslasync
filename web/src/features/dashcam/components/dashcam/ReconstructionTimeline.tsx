import { useTranslation } from 'react-i18next';
import { GlassPanel, Slider } from '@/components/ui';
import { Timeline, TimelineScrubber } from '@/components/data-display';
import type { TimelineItemData } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import { QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { ClipRecord, DashcamSettings } from '../../lib/types';
import type { UseReconstructionResult } from '../../hooks/useReconstruction';
import { toReconstructionMarkers } from '../../lib/timelineAlignment';
import { SignalPicker } from './SignalPicker';
import { ReconstructionSeriesList } from './ReconstructionSeriesList';

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
  const { t } = useTranslation();
  const { formatDuration } = useUnits();

  if (clip.capturedAtRaw == null) {
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

  const markers = result.reconstruction ? toReconstructionMarkers(result.reconstruction) : [];
  const incidentItems: TimelineItemData[] = (result.reconstruction?.incidentSequence ?? []).map((evt) => ({
    title: evt.signal,
    subtitle: evt.description,
    time: t('dashcam.events.atSeconds', 't={{seconds}}s', { seconds: evt.atSeconds.toFixed(1) }),
  }));

  return (
    <GlassPanel padding="md" className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t('dashcam.reconstruction.title', 'Telemetry-synchronized reconstruction')}
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          {t(
            'dashcam.reconstruction.description',
            'Filenames carry no timezone. Adjust the assumed camera clock offset below if the reconstruction looks shifted.',
          )}
        </p>
      </div>

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

      <QueryError error={result.isError ? result.error : null} />

      {result.reconstruction && (
        <>
          <div className="space-y-1">
            <TimelineScrubber
              progress={0}
              duration={result.reconstruction.reconstructionWindow.endSeconds - result.reconstruction.reconstructionWindow.startSeconds}
              markers={markers}
              onSeek={() => {}}
            />
            <p className="text-xs text-[var(--text-muted)]">
              {t('dashcam.reconstruction.window', 'Window: {{pre}} pre-roll → clip → {{post}} post-roll', {
                pre: formatDuration(settings.reconstructionPreRollSeconds),
                post: formatDuration(settings.reconstructionPostRollSeconds),
              })}
            </p>
          </div>

          <ReconstructionSeriesList series={result.reconstruction.series} />

          {incidentItems.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {t('dashcam.reconstruction.incidentSequence', 'Incident sequence (statistical)')}
              </h4>
              <Timeline items={incidentItems} />
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              {t('dashcam.reconstruction.noIncidents', 'No statistically significant telemetry changes were detected in this window.')}
            </p>
          )}
        </>
      )}
    </GlassPanel>
  );
}
