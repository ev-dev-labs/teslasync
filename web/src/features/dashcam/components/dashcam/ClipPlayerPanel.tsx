import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { PlaybackControls } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import type { ClipRecord } from '../../lib/types';
import { useMotionAnalysis } from '../../hooks/useMotionAnalysis';
import { RedactionOverlay } from './RedactionOverlay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface ClipPlayerPanelProps {
  clip: ClipRecord;
}

/**
 * Local video playback with redaction-region overlay and an honest,
 * on-demand motion-score trigger. The video element plays the clip's own
 * `Blob` via a component-owned object URL that is created on mount/clip
 * change and revoked on cleanup — no bytes are ever sent anywhere.
 */
export function ClipPlayerPanel({ clip }: ClipPlayerPanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const motionAnalysis = useMotionAnalysis();

  const objectUrl = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    setMediaDuration(null);
  }, [clip.id]);

  const duration = clip.durationSeconds != null && Number.isFinite(clip.durationSeconds)
    ? Math.max(0, clip.durationSeconds) : mediaDuration;

  const handleDurationChange = () => {
    const measured = videoRef.current?.duration;
    setMediaDuration(measured != null && Number.isFinite(measured) && measured >= 0 ? measured : null);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !duration) return;
    setProgress(Math.min(1, video.currentTime / duration));
  };

  const handleSeek = (normalized: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = normalized * duration;
    setProgress(normalized);
  };

  const play = () => {
    const video = videoRef.current;
    if (!video) return;
    void video.play();
  };

  const pause = () => {
    videoRef.current?.pause();
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setProgress(0);
  };

  const motionStatus = clip.motion.status;

  return (
    <LayoutCard title={t('dashcam.tabs.player', 'Player')}>
      <div className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black">
        <video
          ref={videoRef}
          src={objectUrl}
          muted
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onLoadStart={() => setMediaDuration(null)}
          onLoadedMetadata={handleDurationChange}
          onDurationChange={handleDurationChange}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          className="aspect-video w-full bg-black"
        />
        <RedactionOverlay regions={clip.redactions} />
      </div>

      <PlaybackControls
        framed={false}
        isPlaying={isPlaying}
        progress={progress}
        elapsed={duration == null ? '—' : formatDuration(progress * duration)}
        total={duration == null ? '—' : formatDuration(duration)}
        durationMs={duration == null ? undefined : duration * 1000}
        onPlay={play}
        onPause={pause}
        onRestart={restart}
        onSeek={handleSeek}
      />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
        <Text variant="caption" className="min-w-0 flex-1 break-words">
          {motionStatus === 'not_run' && t('dashcam.player.motionNotRun', 'Motion score not yet computed.')}
          {motionStatus === 'ok' && t('dashcam.player.motionScore', 'Sampled-frame pixel-difference score: {{score}} ({{pairs}} frame pairs)', {
            score: fmtNumber(clip.motion.score),
            pairs: clip.motion.samplePairs ?? 0,
          })}
          {motionStatus === 'unavailable' && t('dashcam.player.motionUnavailable', 'Motion analysis unavailable: {{reason}}', { reason: clip.motion.reason })}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          wrapLabel
          loading={motionAnalysis.isPending}
          onClick={() => motionAnalysis.mutate(clip)}
        >
          {t('dashcam.player.runMotion', 'Run local motion analysis')}
        </Button>
      </div>
    </LayoutCard>
  );
}
