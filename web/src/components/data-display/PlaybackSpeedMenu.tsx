import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { ReplaySpeed } from '@/hooks/useTripReplay';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const REPLAY_SPEEDS: ReplaySpeed[] = [1, 10, 25, 50, 100];

/** Step the speed up by `delta` slots (signed). */
export function shiftSpeed(current: ReplaySpeed, delta: number): ReplaySpeed {
  const idx = REPLAY_SPEEDS.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const nextIdx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, safeIdx + delta));
  return REPLAY_SPEEDS[nextIdx];
}

/** Cycle to the next-fastest speed (wraps around). */
export function nextSpeed(current: ReplaySpeed): ReplaySpeed {
  const idx = REPLAY_SPEEDS.indexOf(current);
  return REPLAY_SPEEDS[(idx + 1) % REPLAY_SPEEDS.length];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface PlaybackSpeedMenuProps {
  speed: ReplaySpeed;
  onChange: (speed: ReplaySpeed) => void;
  className?: string;
}

/**
 * Compact playback-speed control. Click cycles to the next speed; right-click
 * cycles backwards. Used by `<PlaybackControls>` and any other surface that
 * exposes scrub-speed selection.
 *
 * Phase-40 / Prompt 57.
 */
export function PlaybackSpeedMenu({ speed, onChange, className }: PlaybackSpeedMenuProps) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onChange(nextSpeed(speed))}
      onContextMenu={(e) => {
        e.preventDefault();
        onChange(shiftSpeed(speed, -1));
      }}
      aria-label={t('replay.controls.speed', 'Playback speed')}
      className={className ?? 'flex items-center gap-0.5 px-2 text-xs font-mono'}
    >
      {speed}x
      <ChevronDown className="h-3 w-3 opacity-50" />
    </Button>
  );
}
