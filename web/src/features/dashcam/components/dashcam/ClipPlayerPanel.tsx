import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack } from 'lucide-react';
import { Button, GlassPanel } from '@/components/ui';
import { TimelineScrubber } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import type { ClipRecord } from '../../lib/types';
import { useMotionAnalysis } from '../../hooks/useMotionAnalysis';
import { RedactionOverlay } from './RedactionOverlay';

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
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const motionAnalysis = useMotionAnalysis();

  const objectUrl = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
  }, [clip.id]);

  const duration = clip.durationSeconds ?? videoRef.current?.duration ?? 0;

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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setProgress(0);
  };

  const motionStatus = clip.motion.status;

  return (
    <GlassPanel padding="md" className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black">
        <video
          ref={videoRef}
          src={objectUrl}
          muted
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          className="aspect-video w-full bg-black"
        />
        <RedactionOverlay regions={clip.redactions} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={restart} aria-label={t('dashcam.player.restart', 'Restart')} className="h-8 w-8 p-0">
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={togglePlay} aria-label={isPlaying ? t('dashcam.player.pause', 'Pause') : t('dashcam.player.play', 'Play')} className="h-8 w-8 p-0">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex-1">
          <TimelineScrubber progress={progress} duration={duration} onSeek={handleSeek} />
        </div>
        <span className="min-w-[70px] text-right font-mono text-xs text-[var(--text-secondary)]">
          {formatDuration(progress * duration)} / {formatDuration(duration)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
        <div className="text-xs text-[var(--text-muted)]">
          {motionStatus === 'not_run' && t('dashcam.player.motionNotRun', 'Motion score not yet computed.')}
          {motionStatus === 'ok' && t('dashcam.player.motionScore', 'Sampled-frame pixel-difference score: {{score}} ({{pairs}} frame pairs)', {
            score: clip.motion.score?.toFixed(3),
            pairs: clip.motion.samplePairs ?? 0,
          })}
          {motionStatus === 'unavailable' && t('dashcam.player.motionUnavailable', 'Motion analysis unavailable: {{reason}}', { reason: clip.motion.reason })}
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={motionAnalysis.isPending}
          onClick={() => motionAnalysis.mutate(clip)}
        >
          {t('dashcam.player.runMotion', 'Run local motion analysis')}
        </Button>
      </div>
    </GlassPanel>
  );
}
