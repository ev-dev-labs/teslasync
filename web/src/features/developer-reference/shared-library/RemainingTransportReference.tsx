import { useState } from 'react';
import { MetricBar, PlaybackControls, TimelineScrubber, type TimelineMarker } from '@/components/data-display';
import { GlassPanel, SectionTitle } from '@/components/ui';
import type { ReplaySpeed } from '@/hooks/useTripReplay';
import { CHART_COLORS } from '@/lib/colors';
import { useCompletionLabels } from '../components/shared-library-completion/useCompletionLabels';

export function RemainingTransportReference() {
  const c = useCompletionLabels();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0.5);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const markers: TimelineMarker[] = [
    { id: 'first', at: 0.2, kind: 'event', label: c.eventFirst, description: c.eventMetadata, timeLabel: c.eventTimeFirst },
    { id: 'second', at: 0.8, kind: 'event', label: c.eventSecond, description: c.eventSubtitle, count: 2, timeLabel: c.eventTimeSecond },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GlassPanel data-shared-contract="metric-bar">
        <SectionTitle>{c.metricTitle}</SectionTitle>
        <div className="flex min-w-0 flex-col gap-4">
          <MetricBar label={c.progressLabel} value={65} max={100} color={CHART_COLORS[0]} />
          <MetricBar ariaLabel={c.progressLabel + ' · ' + c.zeroLabel} value={0}
            max={100} color={CHART_COLORS[0]} showHeader={false} size="slim" fill="solid" />
          <MetricBar ariaLabel={c.missingProgress} value={null} max={100}
            color={CHART_COLORS[0]} showHeader={false} size="slim" fill="solid" />
          <MetricBar label={c.progressLabel + ' · ' + c.rankPositive} value={75}
            max={100} color={CHART_COLORS[0]} showValue={false} size="slim" fill="solid" />
        </div>
      </GlassPanel>
      <GlassPanel data-shared-contract="playback-controls">
        <SectionTitle>{c.transportTitle}</SectionTitle>
        <div className="flex min-w-0 flex-col gap-4">
          <PlaybackControls isPlaying={playing} progress={progress} elapsed="0:30" total="1:00"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeek={setProgress}
            onRestart={() => setProgress(0)} onStop={() => setPlaying(false)}
            speed={speed} onSpeedChange={setSpeed} markers={markers} />
          <div className="w-full max-w-64">
            <PlaybackControls framed={false} isPlaying={playing} progress={progress} elapsed="0:30" total="1:00"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeek={setProgress} />
          </div>
        </div>
      </GlassPanel>
      <GlassPanel data-shared-contract="timeline-scrubber">
        <SectionTitle>{c.overviewTitle}</SectionTitle>
        <TimelineScrubber mode="readOnly" label={c.overviewLabel} markers={markers}
          duration={60} clockOriginSeconds={-30} formatTime={seconds => `${seconds}s`}
          startLabel={c.eventTimeFirst} endLabel={c.eventTimeSecond} />
        <TimelineScrubber mode="readOnly" label={c.unknownOverview} duration={null} clockOriginSeconds={null}
          markers={[...markers, { id: 'unknown', at: Number.NaN, kind: 'event', label: c.eventInvalid, description: c.unknown }]} />
      </GlassPanel>
    </div>
  );
}
