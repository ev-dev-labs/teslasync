import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
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
  /** Normalized 0..1 position along the timeline. */
  at: number;
  kind: TimelineMarkerKind;
  /** Optional label rendered in the marker's hover tooltip. */
  label?: string;
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

export interface TimelineScrubberProps {
  /** Current playhead position (0..1). */
  progress: number;
  /** Buffered position (0..1) — reserved for future streaming use. */
  buffered?: number;
  /** Drive duration in seconds. Used purely for accessibility (aria-valuetext). */
  duration: number;
  /** Notable moments along the timeline. */
  markers?: TimelineMarker[];
  /**
   * Sampler that returns formatted preview values for a given normalized
   * position. Called on hover and during drag. Heavy to call ~50ms — the
   * caller should ensure the lookup is cheap (e.g. binary-search into a
   * pre-built array).
   */
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  /** Final commit handler — invoked on click, on drag-release, and on marker click. */
  onSeek: (normalized: number) => void;
  /**
   * Optional decorative background rendered behind the track at low opacity.
   * Pages typically pass a `<Sparkline>` of speed-over-time so the user can
   * see where the action is.
   */
  background?: ReactNode;
  className?: string;
}

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

/** Smooth-scrub interval — emit intermediate seeks every N ms while dragging. */
const SCRUB_INTERVAL_MS = 50;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Rich timeline scrubber for trip replay (Phase-40 / Prompt 57).
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
export function TimelineScrubber({
  progress,
  buffered,
  duration,
  markers,
  getPreviewAt,
  onSeek,
  background,
  className,
}: TimelineScrubberProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<TimelinePreviewPoint | null>(null);
  const lastEmitRef = useRef(0);

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const clampedBuffered = buffered != null ? Math.max(0, Math.min(1, buffered)) : null;

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
  }, [isDragging]);

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
    (hoverAt != null || isDragging) && (hoverPreview != null || previewTimeStr != null);
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
          <div className="flex flex-col items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--text-primary)] shadow-lg backdrop-blur-md">
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
          'relative flex h-8 w-full cursor-pointer items-center touch-none',
        )}
        role="slider"
        tabIndex={0}
        aria-label={t('replay.controls.progress', 'Playback progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampedProgress * 100)}
        aria-valuetext={ariaValueText}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Background sparkline (decorative, behind track). */}
        {background && (
          <div className="pointer-events-none absolute inset-x-0 top-1 h-6 overflow-hidden opacity-20">
            {background}
          </div>
        )}

        {/* Track */}
        <div className="relative h-1.5 w-full rounded-full bg-white/[0.08]">
          {/* Buffered (future use) */}
          {clampedBuffered != null && (
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-white/[0.12]"
              style={{ width: `${clampedBuffered * 100}%` }}
            />
          )}
          {/* Fill */}
          <div
            className={cn(
              'absolute left-0 top-0 h-full rounded-full bg-[var(--neon)]',
              !reduce && 'transition-[width] duration-fast',
            )}
            style={{ width: playheadLeft }}
          />

          {/* Markers */}
          {markers?.map((m, i) => (
            <TimelineMarkerTick
              key={`${m.kind}-${m.at}-${i}`}
              marker={m}
              onSeek={onSeek}
            />
          ))}
        </div>

        {/* Hover ghost playhead */}
        {hoverAt != null && !isDragging && (
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--surface-2)]"
            style={{ left: previewLeft }}
          />
        )}

        {/* Active playhead thumb */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg shadow-[var(--neon)]/30',
            !reduce && 'transition-[left] duration-fast',
            isDragging && 'h-4 w-4 ring-2 ring-[var(--neon)]/40',
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
}: {
  marker: TimelineMarker;
  onSeek: (normalized: number) => void;
}) {
  const { t } = useTranslation();
  const left = `${Math.min(100, Math.max(0, marker.at * 100))}%`;
  const color = MARKER_COLORS[marker.kind] ?? 'bg-[var(--surface-2)]';
  const ariaLabel = marker.label
    ? `${marker.label} ${t('replay.markers.atPercent', 'at {{pct}}%', { pct: Math.round(marker.at * 100) })}`
    : `${marker.kind} ${Math.round(marker.at * 100)}%`;
  return (
    <Tooltip
      content={marker.label ?? marker.kind}
      side="top"
    >
      <button
        type="button"
        data-timeline-marker
        className={cn(
          'touch-target-overlay absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/40',
          color,
        )}
        style={{ left }}
        onClick={(e) => {
          e.stopPropagation();
          onSeek(marker.at);
        }}
        aria-label={ariaLabel}
      >
        {marker.count != null && marker.count > 1 && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--surface-overlay)] px-1 text-[8px] font-mono text-[var(--text-primary)]">
            {marker.count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
