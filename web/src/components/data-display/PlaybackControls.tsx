import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Square, SkipBack, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
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
  speed: ReplaySpeed;
  /** 0..1 normalized playback position. */
  progress: number;
  /** Pre-formatted elapsed time (e.g. "1:23"). */
  elapsed: string;
  /** Pre-formatted total time (e.g. "5:10"). */
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
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
 * Playback control bar for trip replay.
 *
 * Composes:
 *   - Reset / Play-Pause / Stop buttons
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
  className,
}: PlaybackControlsProps) {
  const { t } = useTranslation();
  const [shortcutToast, setShortcutToast] = useState<ShortcutToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showShortcutToast = useCallback((label: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setShortcutToast({ id: Date.now(), label });
    toastTimerRef.current = setTimeout(() => {
      setShortcutToast(null);
      toastTimerRef.current = null;
    }, 900);
  }, []);

  /* ── Keyboard shortcuts ───────────────────────────────────────── */
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handler = (e: KeyboardEvent) => {
      // Don't hijack typing in form fields.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
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
          const next = Math.max(0, Math.min(1, progress + (delta * 1000) / durationMs));
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
          e.preventDefault();
          seekBySeconds(e.shiftKey ? -30 : -5, e.shiftKey ? '⏪ −30s' : '⏪ −5s');
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBySeconds(e.shiftKey ? 30 : 5, e.shiftKey ? '⏩ +30s' : '⏩ +5s');
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
          showShortcutToast(`${Math.round(pct * 100)}%`);
          break;
        }
        case 'j':
        case 'J':
          e.preventDefault();
          seekBySeconds(-10, '⏪ −10s');
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
          e.preventDefault();
          seekBySeconds(10, '⏩ +10s');
          break;
        case '+':
        case '=':
          e.preventDefault();
          if (onSpeedRelative) onSpeedRelative(1);
          else onSpeedChange(shiftSpeed(speed, 1));
          showShortcutToast(t('replay.shortcuts.speedUp', 'Faster'));
          break;
        case '-':
        case '_':
          e.preventDefault();
          if (onSpeedRelative) onSpeedRelative(-1);
          else onSpeedChange(shiftSpeed(speed, -1));
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
    durationMs,
    isPlaying,
    onPause,
    onPlay,
    onSeek,
    onSeekBy,
    onSpeedChange,
    onSpeedRelative,
    onStepFrame,
    progress,
    showShortcutToast,
    speed,
    t,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  /* ── Help content listing all shortcuts ──────────────────────── */
  // Note: do NOT hardcode text-white/* here — the parent <Tooltip> body
  // ships its own `text-gray-100 dark:text-gray-900` colour pair, which
  // inverts the surface in dark mode (light tooltip on dark page). White
  // text inside that white-in-dark-mode card was invisible. Inheriting
  // the tooltip's text colour keeps the labels readable in both themes.
  const helpContent = useMemo(
    () => (
      <div className="space-y-2 text-[11px]">
        <div className="font-semibold">
          {t('replay.shortcuts.title', 'Trip replay shortcuts')}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 opacity-90">
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">Space / K</kbd>
          <span>{t('replay.shortcuts.playPause', 'Play / Pause')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">← / →</kbd>
          <span>{t('replay.shortcuts.skip5', 'Skip ±5s (Shift = ±30s)')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">J / L</kbd>
          <span>{t('replay.shortcuts.skip10', 'Skip ±10s')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">, / .</kbd>
          <span>{t('replay.shortcuts.frame', 'Previous / next frame')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">Home / End</kbd>
          <span>{t('replay.shortcuts.startEnd', 'Jump to start / end')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">0 – 9</kbd>
          <span>{t('replay.shortcuts.percent', 'Jump to N×10%')}</span>
          <kbd className="rounded border border-gray-500/30 bg-gray-500/15 px-1.5 py-0.5 font-mono text-[10px]">+ / −</kbd>
          <span>{t('replay.shortcuts.speed', 'Speed up / slow down')}</span>
        </div>
      </div>
    ),
    [t],
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
      make('skip5', ['←', '→'], t('replay.shortcuts.skip5', 'Skip ±5s (Shift = ±30s)')),
      make('skip10', ['J', 'L'], t('replay.shortcuts.skip10', 'Skip ±10s')),
      make('frame', [',', '.'], t('replay.shortcuts.frame', 'Previous / next frame')),
      make('startEnd', ['Home', 'End'], t('replay.shortcuts.startEnd', 'Jump to start / end')),
      make('percent', ['0', '–', '9'], t('replay.shortcuts.percent', 'Jump to N×10%')),
      make('speed', ['+', '−'], t('replay.shortcuts.speed', 'Speed up / slow down')),
    ];
  }, [enableKeyboardShortcuts, t]);
  useShortcut(replayShortcutDefs);

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 backdrop-blur-sm',
        className,
      )}
    >
      {/* Inline shortcut feedback */}
      {shortcutToast && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute -top-7 right-3 z-10 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] shadow-lg backdrop-blur-md"
        >
          {shortcutToast.label}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Reset (rewind to start) */}
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

        {/* Speed */}
        <PlaybackSpeedMenu speed={speed} onChange={onSpeedChange} />

        {/* Scrubber takes the remaining space */}
        <div className="mx-2 flex-1">
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
        <span className="min-w-[90px] text-right font-mono text-xs text-[var(--text-secondary)]">
          {elapsed} / {total}
        </span>

        {/* Keyboard help */}
        {enableKeyboardShortcuts && (
          <Tooltip content={helpContent} side="top" multiline>
            <button
              type="button"
              aria-label={t('replay.shortcuts.help', 'Show keyboard shortcuts')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
