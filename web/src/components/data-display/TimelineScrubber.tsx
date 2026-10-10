import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden';
import { useMotionPreference } from '@/hooks/useMotionPreference';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TimelineMarkerKind =
  | 'start'
  | 'stop'
  | 'charge-start'
  | 'charge-stop'
  | 'fast-segment'
  | 'regen-peak'
  | 'low-soc'
  | 'event';

export interface TimelineMarker {
  /** Stable caller identity; markers are never sorted, sampled or clustered here. */
  id?: string | number;
  /** Normalized 0..1 position along the timeline. */
  at: number;
  kind: TimelineMarkerKind;
  /** Optional label rendered in the marker's hover tooltip. */
  label?: string;
  /** Full caller-prepared evidence, exposed in the accessible marker name. */
  description?: string;
  /** Caller-formatted clock label; never parsed or interpreted as elapsed time. */
  timeLabel?: string;
  /** Optional href — clicking the marker can route somewhere instead of seeking. */
  href?: string;
  /** When the marker represents N clustered events, surface the count visually. */
  count?: number;
}

export interface TimelinePreviewPoint {
  /** Normalized 0..1 position the preview was sampled for. */
  at: number;
  /** Pre-formatted strings — the scrubber does no number formatting itself. */
  speed?: string;
  power?: string;
  soc?: string;
  elevation?: string;
}

interface TimelineScrubberBaseProps {
  /** Notable moments along the timeline, in caller order. */
  markers?: TimelineMarker[];
  /** Optional decorative background; does not supply temporal geometry. */
  background?: ReactNode;
  className?: string;
}

export interface InteractiveTimelineScrubberProps extends TimelineScrubberBaseProps {
  /** Omitted for backward-compatible interactive seeking. */
  mode?: 'interactive';
  /** Disable all seeking while retaining the current playback position. */
  disabled?: boolean;
  /** Current playhead position (0..1). */
  progress: number;
  /** Buffered position (0..1) — reserved for future streaming use. */
  buffered?: number;
  /** Drive duration in seconds. Used purely for accessibility (aria-valuetext). */
  duration: number;
  /**
   * Sampler that returns formatted preview values for a given normalized
   * position. Called on hover and during drag. Heavy to call ~50ms — the
   * caller should ensure the lookup is cheap (e.g. binary-search into a
   * pre-built array).
   */
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  /** Final commit handler — invoked on click, on drag-release, and on marker click. */
  onSeek: (normalized: number) => void;
}

export interface ReadOnlyTimelineScrubberProps extends TimelineScrubberBaseProps {
  /** Proportional events only: no playback position or seeking controls. */
  mode: 'readOnly';
  progress?: never;
  buffered?: never;
  onSeek?: never;
  getPreviewAt?: never;
  disabled?: never;
  /** Accessible overview name, supplied in the caller's language. */
  label?: string;
  /** Window span in seconds. Null, negative and nonfinite spans are unknown. */
  duration?: number | null;
  /** Seconds at the window's left edge, e.g. -30 for reconstruction pre-roll. */
  clockOriginSeconds?: number | null;
  /** Formats origin + position * duration, including signed or absolute clocks. */
  formatTime?: (seconds: number) => string | null;
  /** Prepared boundary labels, independent of duration/origin validity. */
  startLabel?: string;
  endLabel?: string;
}

export type TimelineScrubberProps =
  | InteractiveTimelineScrubberProps
  | ReadOnlyTimelineScrubberProps;

/* ------------------------------------------------------------------ */
/*  Visual tokens                                                      */
/* ------------------------------------------------------------------ */

/** Marker tick colors. Aligns with severity tokens for a consistent feel. */
const MARKER_COLORS: Record<TimelineMarkerKind, string> = {
  start: 'bg-emerald-400',
  stop: 'bg-rose-400',
  'charge-start': 'bg-emerald-300',
  'charge-stop': 'bg-amber-300',
  'fast-segment': 'bg-amber-400',
  'regen-peak': 'bg-sky-300',
  'low-soc': 'bg-rose-300',
  event: 'bg-[var(--surface-2)]',
};

const FORCED_TRACK = 'forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:!bg-[Canvas] forced-colors:[forced-color-adjust:none]';
const FORCED_MARKER = 'forced-colors:!bg-[CanvasText] forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[Canvas] forced-colors:[forced-color-adjust:none]';

/** Smooth-scrub interval — emit intermediate seeks every N ms while dragging. */
const SCRUB_INTERVAL_MS = 50;

/** Keyboard nudge (1%) and page-jump (10%) increments for slider a11y. */
const KEY_STEP = 0.01;
const KEY_PAGE = 0.1;

/**
 * Clamp to the 0..1 track range, coercing non-finite input (NaN / ±Infinity /
 * undefined-as-NaN) to 0. Without this a stray `NaN` progress leaks straight
 * into an inline `width: NaN%` and `aria-valuenow={NaN}`, corrupting both the
 * render and the screen-reader announcement.
 */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Interactive trip replay by default; explicit `mode="readOnly"` renders only
 * caller-prepared proportional events, without a playhead or seeking listeners.
 *
 * Features beyond a basic progress bar:
 *  - Hover preview tooltip with formatted speed/power/SoC/elevation.
 *  - Drag-to-scrub with intermediate seek emissions every {@link SCRUB_INTERVAL_MS}ms.
 *  - Keyframe marker ticks (charge boundaries, fast segments, regen peaks, low SoC).
 *  - Optional decorative background (e.g. a `<Sparkline>`) to show where the
 *    action is at a glance.
 *  - Touch-friendly hit area (32px tall on coarse pointers).
 *
 * Accessibility:
 *  - Track has `role="slider"`, `aria-valuemin/max/now`, and `aria-valuetext`
 *    rendering the current playback time.
 *  - Markers are focusable buttons with `aria-label`.
 *  - Honors `prefers-reduced-motion`: no transition on the playhead position.
 */
export function TimelineScrubber(props: TimelineScrubberProps) {
  return props.mode === 'readOnly'
    ? <ReadOnlyTimelineOverview {...props} />
    : <InteractiveTimelineScrubber {...props} />;
}

function ReadOnlyTimelineOverview({
  markers,
  background,
  className,
  label,
  duration,
  clockOriginSeconds,
  formatTime,
  startLabel,
  endLabel,
}: ReadOnlyTimelineScrubberProps) {
  const { t } = useTranslation();
  const timeAt = (at: number): string | null => {
    if (
      !Number.isFinite(at) ||
      duration == null || !Number.isFinite(duration) || duration < 0 ||
      clockOriginSeconds == null || !Number.isFinite(clockOriginSeconds)
    ) return null;
    const seconds = clockOriginSeconds + clamp01(at) * duration;
    return Number.isFinite(seconds) ? formatTime?.(seconds) ?? null : null;
  };
  return (
    <div
      className={cn('relative w-full', className)}
      role="group"
      aria-label={label ?? t('replay.overview.label', 'Event overview')}
      data-timeline-mode="readOnly"
    >
      <div className="relative flex h-8 w-full items-center">
        {background && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1 h-6 overflow-hidden opacity-20">
            {background}
          </div>
        )}
        <div data-timeline-track className={cn('h-1.5 w-full rounded-full bg-[var(--surface-2)]', FORCED_TRACK)} aria-hidden="true" />
        <div className="absolute inset-0" role="list">
          {markers?.map((marker, index) => {
            const validPosition = Number.isFinite(marker.at);
            const time = marker.timeLabel ?? timeAt(marker.at);
            const description = [
              marker.label ?? marker.kind,
              marker.description,
              time,
              marker.count != null && marker.count > 1
                ? t('replay.overview.clusterCount', '{{count}} events', { count: marker.count })
                : null,
              !validPosition
                ? t('replay.overview.positionUnavailable', 'Position unavailable')
                : null,
            ].filter(Boolean).join(' — ');
            if (!validPosition) {
              return (
                <VisuallyHidden
                  as="div"
                  key={marker.id ?? `${marker.kind}-${marker.at}-${index}`}
                  role="listitem"
                  aria-label={description}
                  title={description}
                  data-timeline-marker
                  data-marker-id={marker.id}
                  data-position-unavailable
                >
                  {description}
                </VisuallyHidden>
              );
            }
            return (
              <div
                key={marker.id ?? `${marker.kind}-${marker.at}-${index}`}
                role="listitem"
                aria-label={description}
                title={description}
                data-timeline-marker
                data-marker-id={marker.id}
                data-position-unavailable={!validPosition || undefined}
                className={cn(
                  'absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm [outline-style:solid] outline-1 outline-[var(--border-strong)]',
                  MARKER_COLORS[marker.kind],
                  FORCED_MARKER,
                )}
                style={validPosition ? { left: `${clamp01(marker.at) * 100}%` } : undefined}
              >
                <VisuallyHidden>{description}</VisuallyHidden>
                {marker.count != null && marker.count > 1 && validPosition && (
                  <span aria-hidden="true" className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--surface-overlay)] px-1 text-2xs font-mono text-[var(--text-primary)]">
                    {marker.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {(startLabel != null || endLabel != null || formatTime != null) && (
        <div className="flex justify-between gap-2 text-xs font-mono text-[var(--text-secondary)]">
          <span>{startLabel ?? timeAt(0)}</span>
          <span>{endLabel ?? timeAt(1)}</span>
        </div>
      )}
    </div>
  );
}

function InteractiveTimelineScrubber({
  progress,
  buffered,
  duration,
  markers,
  getPreviewAt,
  onSeek,
  background,
  className,
  disabled = false,
}: InteractiveTimelineScrubberProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<TimelinePreviewPoint | null>(null);
  const lastEmitRef = useRef(0);
  // A pointer down→up sequence already commits its own seek; the browser then
  // fires a trailing synthetic `click` on the same track. This latch lets the
  // click handler swallow that one redundant `onSeek` without disabling the
  // click path entirely (it stays live as a fallback for non-pointer input).
  const pointerHandledRef = useRef(false);

  const clampedProgress = clamp01(progress);
  const clampedBuffered = buffered != null ? clamp01(buffered) : null;

  /* ── Position calc helpers ───────────────────────────────────── */
  const positionAtClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  /* ── Hover handlers ──────────────────────────────────────────── */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging) return; // dragging path takes over
      const at = positionAtClientX(e.clientX);
      setHoverAt(at);
      if (getPreviewAt) setHoverPreview(getPreviewAt(at));
    },
    [getPreviewAt, isDragging, positionAtClientX],
  );

  const handleMouseLeave = useCallback(() => {
    if (isDragging) return;
    setHoverAt(null);
    setHoverPreview(null);
  }, [isDragging]);

  /* ── Click-to-seek (no drag) ─────────────────────────────────── */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // A pointer sequence (down→up) already committed this seek; the trailing
      // synthetic click would otherwise fire a second, redundant onSeek at the
      // same position. Swallow exactly one such click.
      if (pointerHandledRef.current) {
        pointerHandledRef.current = false;
        return;
      }
      // Ignore clicks bubbling from marker buttons — they call onSeek themselves.
      if ((e.target as HTMLElement).closest('[data-timeline-marker]')) return;
      const at = positionAtClientX(e.clientX);
      onSeek(at);
    },
    [onSeek, positionAtClientX],
  );

  /* ── Drag-to-scrub ───────────────────────────────────────────── */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only start drag from the playhead thumb itself OR plain left-click on track.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement;
      // Marker clicks should not start a drag.
      if (target.closest('[data-timeline-marker]')) return;
      // Mark that a pointer sequence owns this interaction so the trailing
      // click is swallowed (see handleClick).
      pointerHandledRef.current = true;
      setIsDragging(true);
      const at = positionAtClientX(e.clientX);
      setHoverAt(at);
      if (getPreviewAt) setHoverPreview(getPreviewAt(at));
      lastEmitRef.current = performance.now();
      onSeek(at);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on some browsers if the pointer ID is invalid;
        // in that case we fall back to window-level listeners (handled below).
      }
    },
    [getPreviewAt, onSeek, positionAtClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      const at = positionAtClientX(e.clientX);
      setHoverAt(at);
      if (getPreviewAt) setHoverPreview(getPreviewAt(at));
      const now = performance.now();
      if (now - lastEmitRef.current >= SCRUB_INTERVAL_MS) {
        lastEmitRef.current = now;
        onSeek(at);
      }
    },
    [getPreviewAt, isDragging, onSeek, positionAtClientX],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      const at = positionAtClientX(e.clientX);
      onSeek(at);
      setIsDragging(false);
      setHoverAt(null);
      setHoverPreview(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Already released — safe to ignore.
      }
    },
    [isDragging, onSeek, positionAtClientX],
  );

  // Window-level cleanup if the pointer is released outside the track.
  useEffect(() => {
    if (disabled) {
      setIsDragging(false);
      setHoverAt(null);
      setHoverPreview(null);
      pointerHandledRef.current = false;
      return;
    }
    if (!isDragging) return;
    const onUp = () => {
      setIsDragging(false);
      setHoverAt(null);
      setHoverPreview(null);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isDragging, disabled]);

  /* ── Keyboard operability (slider a11y) ──────────────────────── */
  // `role="slider" tabIndex=0` promises keyboard control; a <div> gets none for
  // free. Arrow/Home/End/PageUp/PageDown nudge the playhead and commit via
  // onSeek, mirroring the aria value scale (0..100).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = clampedProgress + KEY_STEP;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = clampedProgress - KEY_STEP;
          break;
        case 'PageUp':
          next = clampedProgress + KEY_PAGE;
          break;
        case 'PageDown':
          next = clampedProgress - KEY_PAGE;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = 1;
          break;
        default:
          return; // leave every other key (Tab, Enter, …) to the browser
      }
      e.preventDefault();
      onSeek(clamp01(next));
    },
    [clampedProgress, onSeek],
  );

  /* ── Aria value text ─────────────────────────────────────────── */
  const ariaValueText = useMemo(() => {
    if (!Number.isFinite(duration) || duration <= 0) return undefined;
    const s = Math.round(duration * clampedProgress);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }, [duration, clampedProgress]);

  /* ── Preview tooltip content ─────────────────────────────────── */
  const previewLabelAt = hoverAt ?? clampedProgress;
  const previewSeconds =
    Number.isFinite(duration) && duration > 0
      ? Math.round(duration * previewLabelAt)
      : null;
  const previewTimeStr = previewSeconds != null
    ? `${Math.floor(previewSeconds / 60)}:${String(previewSeconds % 60).padStart(2, '0')}`
    : null;

  const showPreview =
    !disabled && (hoverAt != null || isDragging) && (hoverPreview != null || previewTimeStr != null);
  const previewLeft = `${Math.min(100, Math.max(0, (hoverAt ?? clampedProgress) * 100))}%`;
  const playheadLeft = `${Math.min(100, clampedProgress * 100)}%`;

  return (
    <div
      className={cn('relative w-full select-none', className)}
      data-print-hide
    >
      {/* ── Hover preview tooltip ────────────────────────────────── */}
      {showPreview && (
        <div
          className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: previewLeft }}
        >
          <div className="flex flex-col items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] shadow-lg backdrop-blur-md">
            {previewTimeStr && <div className="text-[var(--text-secondary)]">{previewTimeStr}</div>}
            {hoverPreview?.speed && (
              <div className="flex items-center gap-1 text-cyan-300">
                <span className="text-[var(--text-muted)]">⛰</span>
                <span>{hoverPreview.speed}</span>
              </div>
            )}
            {hoverPreview?.power && (
              <div className="text-amber-300">{hoverPreview.power}</div>
            )}
            {hoverPreview?.soc && (
              <div className="text-emerald-300">{hoverPreview.soc}</div>
            )}
            {hoverPreview?.elevation && (
              <div className="text-[var(--text-secondary)]">{hoverPreview.elevation}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Track wrapper ────────────────────────────────────────── */}
      <div
        ref={trackRef}
        className={cn(
          'relative flex h-8 w-full items-center',
          disabled ? 'cursor-default' : 'cursor-pointer touch-none',
        )}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={t('replay.controls.progress', 'Playback progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampedProgress * 100)}
        aria-valuetext={ariaValueText}
        onMouseMove={disabled ? undefined : handleMouseMove}
        onMouseLeave={disabled ? undefined : handleMouseLeave}
        onClick={disabled ? undefined : handleClick}
        onKeyDown={disabled ? undefined : handleKeyDown}
        onPointerDown={disabled ? undefined : handlePointerDown}
        onPointerMove={disabled ? undefined : handlePointerMove}
        onPointerUp={disabled ? undefined : handlePointerUp}
      >
        {/* Background sparkline (decorative, behind track). */}
        {background && (
          <div className="pointer-events-none absolute inset-x-0 top-1 h-6 overflow-hidden opacity-20">
            {background}
          </div>
        )}

        {/* Track */}
        <div data-timeline-track className={cn('relative h-1.5 w-full rounded-full bg-[var(--surface-2)]', FORCED_TRACK)}>
          {/* Buffered (future use) */}
          {clampedBuffered != null && (
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-[var(--surface-3)]"
              style={{ width: `${clampedBuffered * 100}%` }}
            />
          )}
          {/* Fill */}
          <div
            data-timeline-fill
            className={cn(
              'absolute left-0 top-0 h-full rounded-full bg-[var(--theme-primary)] forced-colors:!bg-[Highlight] forced-colors:[forced-color-adjust:none]',
              !reduce && 'transition-[width] duration-fast',
            )}
            style={{ width: playheadLeft }}
          />

          {/* Markers */}
          {markers?.map((m, i) => (
            <TimelineMarkerTick
              key={m.id ?? `${m.kind}-${m.at}-${i}`}
              marker={m}
              onSeek={onSeek}
              disabled={disabled}
              boundaryRef={trackRef}
            />
          ))}
        </div>

        {/* Hover ghost playhead */}
        {!disabled && hoverAt != null && !isDragging && (
          <div
            data-timeline-ghost-playhead
            className={cn('pointer-events-none absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--text-secondary)]', FORCED_MARKER)}
            style={{ left: previewLeft }}
          />
        )}

        {/* Active playhead thumb */}
        <div
          data-timeline-playhead
          className={cn(
            'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-primary)] shadow-lg',
            FORCED_MARKER,
            !reduce && 'transition-[left] duration-fast',
            isDragging && 'h-4 w-4 ring-2 ring-[var(--theme-primary)]/40',
          )}
          style={{ left: playheadLeft }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Marker tick                                                        */
/* ------------------------------------------------------------------ */

function TimelineMarkerTick({
  marker,
  onSeek,
  disabled,
  boundaryRef,
}: {
  marker: TimelineMarker;
  onSeek: (normalized: number) => void;
  disabled: boolean;
  boundaryRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const validPosition = Number.isFinite(marker.at);
  const left = validPosition ? `${clamp01(marker.at) * 100}%` : undefined;
  const color = MARKER_COLORS[marker.kind] ?? 'bg-[var(--surface-2)]';
  const positionLabel = !validPosition
    ? `${marker.label ?? marker.kind} — ${t('replay.overview.positionUnavailable', 'Position unavailable')}`
    : marker.label
    ? `${marker.label} ${t('replay.markers.atPercent', 'at {{pct}}%', { pct: fmtNumber(marker.at * 100) })}`
    : `${marker.kind} ${fmtPercent(marker.at * 100)}`;
  const ariaLabel = [positionLabel, marker.description, marker.timeLabel].filter(Boolean).join(' — ');
  if (!validPosition) {
    return (
      <VisuallyHidden as={Button} type="button" variant="ghost" disabled
        data-timeline-marker aria-label={ariaLabel}>
        {ariaLabel}
      </VisuallyHidden>
    );
  }
  return (
    <span data-timeline-marker-position
      className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2" style={{ left }}>
    <Tooltip
      content={marker.description ?? marker.label ?? marker.kind}
      side="top"
      multiline
      boundaryRef={boundaryRef}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || !validPosition}
        data-timeline-marker
        className={cn(
          'touch-target-overlay relative h-3 w-1 border-0 p-0 rounded-sm [outline-style:solid] outline-1 outline-[var(--border-strong)] opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/40',
          color,
          FORCED_MARKER,
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSeek(marker.at);
        }}
        aria-label={ariaLabel}
      >
        {marker.count != null && marker.count > 1 && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--surface-overlay)] px-1 text-2xs font-mono text-[var(--text-primary)]">
            {marker.count}
          </span>
        )}
      </Button>
    </Tooltip>
    </span>
  );
}
