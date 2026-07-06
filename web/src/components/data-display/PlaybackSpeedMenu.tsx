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
  // Coerce the step to a whole, finite slot count. A NaN/Infinity/fractional
  // `delta` would otherwise flow through Math.min/Math.max as NaN and make
  // `REPLAY_SPEEDS[NaN]` return `undefined`, silently breaking the
  // `: ReplaySpeed` contract for every caller. A meaningless step stays put.
  const step = Number.isFinite(delta) ? Math.round(delta) : 0;
  const nextIdx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, safeIdx + step));
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
 */
export function PlaybackSpeedMenu({ speed, onChange, className }: PlaybackSpeedMenuProps) {
  const { t } = useTranslation();
  // Fold the current value into the accessible name — the aria-label overrides
  // the visible `{speed}x`, so without it screen-reader users would only hear
  // "Playback speed" and never learn (or hear updates to) the active rate.
  const label = t('replay.controls.speed', 'Playback speed');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onChange(nextSpeed(speed))}
      onContextMenu={(e) => {
        e.preventDefault();
        onChange(shiftSpeed(speed, -1));
      }}
      aria-label={`${label}: ${speed}x`}
      title={label}
      className={className ?? 'flex items-center gap-0.5 px-2 text-xs font-mono'}
    >
      {speed}x
      <ChevronDown className="h-3 w-3 opacity-50" aria-hidden />
    </Button>
  );
}
