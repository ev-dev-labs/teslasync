import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Pause, Square, SkipBack, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { ReplaySpeed } from '@/hooks/useTripReplay';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  progress: number;
  elapsed: string;
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SPEEDS: ReplaySpeed[] = [1, 10, 25, 50, 100];

function nextSpeed(current: ReplaySpeed): ReplaySpeed {
  const idx = SPEEDS.indexOf(current);
  return SPEEDS[(idx + 1) % SPEEDS.length];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PlaybackControls({
  isPlaying,
  speed,
  progress,
  elapsed,
  total,
  onPlay,
  onPause,
  onStop,
  onSpeedChange,
  onSeek,
  className,
}: PlaybackControlsProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);

  const handleBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(pct);
    },
    [onSeek],
  );

  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 backdrop-blur-sm',
      className,
    )}>
      {/* Controls row */}
      <div className="flex items-center gap-2">
        {/* Reset */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onStop}
          aria-label={t('replay.controls.reset', 'Reset')}
          className="h-8 w-8 p-0"
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        {/* Play / Pause */}
        <Button
          variant="ghost"
          size="sm"
          onClick={isPlaying ? onPause : onPlay}
          aria-label={isPlaying
            ? t('replay.controls.pause', 'Pause')
            : t('replay.controls.play', 'Play')}
          className="h-8 w-8 p-0"
        >
          {isPlaying
            ? <Pause className="h-4 w-4" />
            : <Play className="h-4 w-4" />}
        </Button>

        {/* Stop */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onStop}
          aria-label={t('replay.controls.stop', 'Stop')}
          className="h-8 w-8 p-0"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>

        {/* Speed toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSpeedChange(nextSpeed(speed))}
          aria-label={t('replay.controls.speed', 'Playback speed')}
          className="flex items-center gap-0.5 px-2 text-xs font-mono"
        >
          {speed}x
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>

        {/* Progress bar */}
        <div
          ref={barRef}
          className="relative mx-2 flex-1 cursor-pointer"
          onClick={handleBarClick}
          role="slider"
          aria-label={t('replay.controls.progress', 'Playback progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          tabIndex={0}
        >
          {/* Track */}
          <div className="h-1.5 rounded-full bg-white/[0.08]">
            {/* Fill */}
            <div
              className="h-full rounded-full bg-[var(--neon)] transition-[width] duration-100"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-lg shadow-[var(--neon)]/30 transition-[left] duration-100"
            style={{ left: `calc(${Math.min(progress * 100, 100)}% - 6px)` }}
          />
        </div>

        {/* Time display */}
        <span className="min-w-[90px] text-right font-mono text-xs text-white/60">
          {elapsed} / {total}
        </span>
      </div>
    </div>
  );
}
