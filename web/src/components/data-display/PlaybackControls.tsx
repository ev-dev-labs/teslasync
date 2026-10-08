import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Square, SkipBack, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { ReplaySpeed } from '@/hooks/useTripReplay';
import { PlaybackSpeedMenu, shiftSpeed } from './PlaybackSpeedMenu';
import {
  TimelineScrubber,
  type TimelineMarker,
  type TimelinePreviewPoint,
} from './TimelineScrubber';
import { useShortcut, type ShortcutDefinition } from '@/hooks/useShortcutRegistry';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  /** Speed selection is shown only when both speed and onSpeedChange are supplied. */
  speed?: ReplaySpeed;
  /** 0..1 normalized playback position. */
  progress: number;
  /** Pre-formatted elapsed time (e.g. "1:23"). */
  elapsed: string;
  /** Pre-formatted total time (e.g. "5:10"). */
  total: string;
  onPlay: () => void;
  onPause: () => void;
  /** Legacy callers also use this callback for Reset when onRestart is absent. */
  onStop?: () => void;
  /** Explicit restart capability, independent of stopping playback. */
  onRestart?: () => void;
  onSpeedChange?: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  /** Optional notable moments rendered as tick marks on the scrubber. */
  markers?: TimelineMarker[];
  /** Optional sampler for hover/scrub previews. */
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  /**
   * Optional decorative background rendered behind the scrubber track at low
   * opacity (typically a `<Sparkline>`).
   */
  scrubberBackground?: ReactNode;
  /**
   * Total duration in milliseconds. Required when `enableKeyboardShortcuts`
   * is true so seek-by-seconds shortcuts know how to translate to progress.
   */
  durationMs?: number;
  /**
   * Page-scoped keyboard shortcuts (Space, ←/→, J/K/L, etc.). Off by default
   * because global keyboard handlers are noisy if multiple pages mount this.
   */
  enableKeyboardShortcuts?: boolean;
  /** Seek by N seconds — used by keyboard shortcut handlers. */
  onSeekBy?: (deltaSeconds: number) => void;
  /** Step through the speed list — used by keyboard shortcut handlers. */
  onSpeedRelative?: (delta: number) => void;
  /** Step the playhead by N positions (frames). */
  onStepFrame?: (delta: number) => void;
  /** Remove the outer surface, border and padding when embedded in a caller's frame. */
  framed?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Inline shortcut hint                                               */
/* ------------------------------------------------------------------ */

interface ShortcutToast {
  id: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Caller-controlled playback transport; owns no media lifecycle or clock.
 *
 * Composes:
 *   - Play-Pause with optional Restart / Stop (legacy Reset invokes Stop)
 *   - {@link PlaybackSpeedMenu} for cycling through {1, 10, 25, 50, 100}×
 *   - {@link TimelineScrubber} with marker ticks, hover preview, and drag-to-scrub
 *   - Optional keyboard shortcuts (toggleable via `enableKeyboardShortcuts`)
 *
 * The existing `onPlay/onPause/onStop/onSpeedChange/onSeek` API is preserved
 * so callers that don't opt into the new features still work unchanged.
 */
export function PlaybackControls({
  isPlaying,
  speed,
  progress,
  elapsed,
  total,
  onPlay,
  onPause,
  onStop,
  onRestart,
  onSpeedChange,
  onSeek,
  markers,
  getPreviewAt,
  scrubberBackground,
  durationMs,
  enableKeyboardShortcuts = false,
  onSeekBy,
  onSpeedRelative,
  onStepFrame,
  framed = true,
  className,
}: PlaybackControlsProps) {
  const { t } = useTranslation();
  const { fmtPercent } = useNumberFormatting();
  const [shortcutToast, setShortcutToast] = useState<ShortcutToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = onRestart ?? onStop;
  const canSeekBy = Boolean(onSeekBy) || (Number.isFinite(durationMs) && (durationMs ?? 0) > 0);
  const canChangeSpeed = speed !== undefined && Boolean(onSpeedChange);
  const canStepSpeed = Boolean(onSpeedRelative) || canChangeSpeed;

  const showShortcutToast = useCallback((label: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setShortcutToast({ id: Date.now(), label });
    toastTimerRef.current = setTimeout(() => {
      setShortcutToast(null);
      toastTimerRef.current = null;
    }, 900);
  }, []);

  // `progress` advances on every animation frame during playback. Reading it
  // from a ref inside the keydown handler keeps the global listener attached
  // exactly once (keyed off the stable, infrequently-changing inputs below)
  // instead of tearing it down and re-adding it ~60×/second while playing.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  /* ── Keyboard shortcuts ───────────────────────────────────────── */
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handler = (e: KeyboardEvent) => {
      // Don't hijack typing in form fields.
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable ||
          target.closest('button, a, [role="slider"], [contenteditable="true"]')
        ) {
          return;
        }
      }
      // Skip when a modifier other than Shift is held (Ctrl+K = palette etc.).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const seekBySeconds = (delta: number, label: string) => {
        if (onSeekBy) {
          onSeekBy(delta);
        } else if (durationMs && durationMs > 0) {
          const next = Math.max(0, Math.min(1, progressRef.current + (delta * 1000) / durationMs));
          onSeek(next);
        }
        showShortcutToast(label);
      };

      switch (e.key) {
        case ' ': // Space
          e.preventDefault();
          if (isPlaying) onPause();
          else onPlay();
          showShortcutToast(isPlaying ? t('replay.shortcuts.pause', 'Pause') : t('replay.shortcuts.play', 'Play'));
          break;
        case 'ArrowLeft':
          if (!canSeekBy) break;
          e.preventDefault();
          seekBySeconds(
            e.shiftKey ? -30 : -5,
            t('replay.shortcuts.seekBack', '⏪ −{{n}}s', { n: e.shiftKey ? 30 : 5 }),
          );
          break;
        case 'ArrowRight':
          if (!canSeekBy) break;
          e.preventDefault();
          seekBySeconds(
            e.shiftKey ? 30 : 5,
            t('replay.shortcuts.seekForward', '⏩ +{{n}}s', { n: e.shiftKey ? 30 : 5 }),
          );
          break;
        case ',':
          if (onStepFrame) {
            e.preventDefault();
            onStepFrame(-1);
            showShortcutToast(t('replay.shortcuts.prevFrame', '⏮ frame'));
          }
          break;
        case '.':
          if (onStepFrame) {
            e.preventDefault();
            onStepFrame(1);
            showShortcutToast(t('replay.shortcuts.nextFrame', '⏭ frame'));
          }
          break;
        case 'Home':
          e.preventDefault();
          onSeek(0);
          showShortcutToast(t('replay.shortcuts.start', '⏮ start'));
          break;
        case 'End':
          e.preventDefault();
          onSeek(1);
          showShortcutToast(t('replay.shortcuts.end', '⏭ end'));
          break;
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          e.preventDefault();
          const pct = Number(e.key) / 10;
          onSeek(pct);
          showShortcutToast(fmtPercent(pct * 100));
          break;
        }
        case 'j':
        case 'J':
          if (!canSeekBy) break;
          e.preventDefault();
          seekBySeconds(-10, t('replay.shortcuts.seekBack', '⏪ −{{n}}s', { n: 10 }));
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          if (isPlaying) onPause();
          else onPlay();
          showShortcutToast(isPlaying ? t('replay.shortcuts.pause', 'Pause') : t('replay.shortcuts.play', 'Play'));
          break;
        case 'l':
        case 'L':
          if (!canSeekBy) break;
          e.preventDefault();
          seekBySeconds(10, t('replay.shortcuts.seekForward', '⏩ +{{n}}s', { n: 10 }));
          break;
        case '+':
        case '=':
          if (!canStepSpeed) break;
          e.preventDefault();
          if (onSpeedRelative) onSpeedRelative(1);
          else if (onSpeedChange && speed !== undefined) onSpeedChange(shiftSpeed(speed, 1));
          showShortcutToast(t('replay.shortcuts.speedUp', 'Faster'));
          break;
        case '-':
        case '_':
          if (!canStepSpeed) break;
          e.preventDefault();
          if (onSpeedRelative) onSpeedRelative(-1);
          else if (onSpeedChange && speed !== undefined) onSpeedChange(shiftSpeed(speed, -1));
          showShortcutToast(t('replay.shortcuts.speedDown', 'Slower'));
          break;
        case 'm':
        case 'M':
          // Reserved for future audio-cue mute. No-op today.
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enableKeyboardShortcuts,
    canSeekBy,
    canStepSpeed,
    durationMs,
    isPlaying,
    onPause,
    onPlay,
    onSeek,
    onSeekBy,
    onSpeedChange,
    onSpeedRelative,
    onStepFrame,
    showShortcutToast,
    speed,
    t,
    fmtPercent,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  /* ── Help content listing all shortcuts ──────────────────────── */
  // Note: do NOT hardcode a fixed light foreground here — the parent
  // <Tooltip> body ships its own inverted gray foreground pair, which
  // inverts the surface in dark mode (light tooltip on dark page). A pinned
  // light foreground inside that inverted card was invisible. Inheriting
  // the tooltip's text colour keeps the labels readable in both themes.
  const helpContent = useMemo(
    () => (
      <Text as="div" size="xs" className="space-y-2">
        <Text as="div" weight="semibold">
          {t('replay.shortcuts.title', 'Trip replay shortcuts')}
        </Text>
        <div className="grid grid-cols-replay-shortcuts gap-x-3 gap-y-1">
          <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">Space / K</Text>
          <span>{t('replay.shortcuts.playPause', 'Play / Pause')}</span>
          {canSeekBy && (
            <>
              <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">← / →</Text>
              <span>{t('replay.shortcuts.skip5', 'Skip ±5s (Shift = ±30s)')}</span>
              <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">J / L</Text>
              <span>{t('replay.shortcuts.skip10', 'Skip ±10s')}</span>
            </>
          )}
          {onStepFrame && (
            <>
              <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">, / .</Text>
              <span>{t('replay.shortcuts.frame', 'Previous / next frame')}</span>
            </>
          )}
          <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">Home / End</Text>
          <span>{t('replay.shortcuts.startEnd', 'Jump to start / end')}</span>
          <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">0 – 9</Text>
          <span>{t('replay.shortcuts.percent', 'Jump to N×10%')}</span>
          {canStepSpeed && (
            <>
              <Text as="kbd" size="xs" mono className="rounded-shape-xs border border-current px-1.5 py-0.5">+ / −</Text>
              <span>{t('replay.shortcuts.speed', 'Speed up / slow down')}</span>
            </>
          )}
        </div>
      </Text>
    ),
    [t, canSeekBy, canStepSpeed, onStepFrame],
  );

  /* Keyboard shortcut cheatsheet. */
  const replayShortcutDefs = useMemo<ShortcutDefinition[]>(() => {
    if (!enableKeyboardShortcuts) return [];
    const group = t('shortcuts.groups.replay', 'Trip replay');
    const replayRoute = /\/drives\/[^/]+\/replay/;
    const make = (
      id: string,
      keys: string[],
      description: string,
    ): ShortcutDefinition => ({
      id: `replay.scrubber.${id}`,
      keys,
      description,
      group,
      scope: 'route',
      routeMatch: replayRoute,
    });
    return [
      make('playPause', ['Space'], t('replay.shortcuts.playPause', 'Play / Pause')),
      ...(canSeekBy ? [
        make('skip5', ['←', '→'], t('replay.shortcuts.skip5', 'Skip ±5s (Shift = ±30s)')),
        make('skip10', ['J', 'L'], t('replay.shortcuts.skip10', 'Skip ±10s')),
      ] : []),
      ...(onStepFrame ? [make('frame', [',', '.'], t('replay.shortcuts.frame', 'Previous / next frame'))] : []),
      make('startEnd', ['Home', 'End'], t('replay.shortcuts.startEnd', 'Jump to start / end')),
      make('percent', ['0', '–', '9'], t('replay.shortcuts.percent', 'Jump to N×10%')),
      ...(canStepSpeed ? [make('speed', ['+', '−'], t('replay.shortcuts.speed', 'Speed up / slow down'))] : []),
    ];
  }, [enableKeyboardShortcuts, t, canSeekBy, canStepSpeed, onStepFrame]);
  useShortcut(replayShortcutDefs);

  return (
    <div
      className={cn(
        'relative min-w-0',
        framed && 'rounded-panel border border-[var(--border-default)] bg-[var(--panel-bg)] px-4 py-3 shadow-panel',
        className,
      )}
    >
      {/* Inline shortcut feedback */}
      {shortcutToast && (
        <Text
          as="div"
          variant="code"
          aria-live="polite"
          className="pointer-events-none absolute -top-7 end-3 z-10 max-w-full break-words rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-2)] px-2 py-1 shadow-e2"
        >
          {shortcutToast.label}
        </Text>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {restart && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={restart}
            aria-label={onRestart
              ? t('replay.controls.restart', 'Restart')
              : t('replay.controls.reset', 'Reset')}
            className="h-11 w-11 shrink-0 p-0"
          >
            <SkipBack className="h-4 w-4" aria-hidden />
          </Button>
        )}

        {/* Play / Pause */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={isPlaying ? onPause : onPlay}
          aria-label={isPlaying
            ? t('replay.controls.pause', 'Pause')
            : t('replay.controls.play', 'Play')}
          className="h-11 w-11 shrink-0 p-0"
        >
          {isPlaying
            ? <Pause className="h-4 w-4" aria-hidden />
            : <Play className="h-4 w-4" aria-hidden />}
        </Button>

        {/* Stop */}
        {onStop && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onStop}
            aria-label={t('replay.controls.stop', 'Stop')}
            className="h-11 w-11 shrink-0 p-0"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}

        {/* Speed */}
        {speed !== undefined && onSpeedChange && (
          <PlaybackSpeedMenu
            speed={speed}
            onChange={onSpeedChange}
            className="flex h-11 min-w-11 shrink-0 items-center gap-0.5 px-2 text-xs font-mono"
          />
        )}

        {/* Scrubber takes the remaining space */}
        <div className="min-w-0 flex-replay-scrubber">
          <TimelineScrubber
            progress={progress}
            duration={durationMs ? durationMs / 1000 : 0}
            markers={markers}
            getPreviewAt={getPreviewAt}
            onSeek={onSeek}
            background={scrubberBackground}
          />
        </div>

        {/* Time display */}
        <Text variant="caption" mono className="min-w-0 break-all text-end">
          {elapsed ?? '—'} / {total ?? '—'}
        </Text>

        {/* Keyboard help */}
        {enableKeyboardShortcuts && (
          <Tooltip content={helpContent} side="top" multiline>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('replay.shortcuts.help', 'Show keyboard shortcuts')}
              className="h-11 w-11 shrink-0 p-0"
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
