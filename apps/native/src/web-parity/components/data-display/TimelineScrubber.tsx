// Native parity port of web/src/components/data-display/TimelineScrubber.tsx.
// The web scrubber is a DOM <div role="slider"> that combines mouse-hover
// preview, pointer-capture drag-to-scrub, click-to-seek, keyframe marker ticks,
// and a decorative background. React Native has no DOM, no getBoundingClientRect,
// no hover, and no Pointer Events, so the interaction model is rebuilt with a
// PanResponder (drag + tap), an onLayout-measured track width, and grant-time
// pageX/locationX to derive the track's screen origin (the analogue of
// rect.left). Because touch surfaces have no hover, the preview tooltip is shown
// during an active drag instead of on hover, and the hover-only ghost playhead
// is therefore inert (documented in the parity sidecar). The web Tooltip,
// useMotionPreference transitions, react-i18next, cn(), and Tailwind classes are
// all replaced with native primitives / theme tokens. performance.now() becomes
// Date.now() for the smooth-scrub throttle.

import React, {useRef, useState, type ReactNode} from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Native i18n fallback                                               */
/* ------------------------------------------------------------------ */

/**
 * The parity layer ships no react-i18next provider, so translation calls fall
 * back to the English default. Supports the same `{{var}}` interpolation the
 * web source relies on for the marker percent label.
 */
function t(
  _key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    vars[name] == null ? '' : String(vars[name]),
  );
}

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
  /** Optional label rendered in the marker's accessibility label. */
  label?: string;
  /** Optional href — accepted for web source parity; native seeks instead. */
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
  /** Drive duration in seconds. Used purely for accessibility (value text). */
  duration: number;
  /** Notable moments along the timeline. */
  markers?: TimelineMarker[];
  /**
   * Sampler that returns formatted preview values for a given normalized
   * position. Called during drag. Heavy to call ~50ms — the caller should
   * ensure the lookup is cheap (e.g. binary-search into a pre-built array).
   */
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  /** Final commit handler — invoked on tap, on drag-release, and on marker tap. */
  onSeek: (normalized: number) => void;
  /**
   * Optional decorative background rendered behind the track at low opacity.
   * Pages typically pass a sparkline of speed-over-time so the user can see
   * where the action is.
   */
  background?: ReactNode;
  /** Accepted for web source parity; React Native has no CSS class names. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/* ------------------------------------------------------------------ */
/*  Visual tokens                                                      */
/* ------------------------------------------------------------------ */

/**
 * Marker tick colors. Mirrors the web Tailwind severity-aligned palette
 * (emerald/rose/amber/sky shades) with the closest native hex values so the
 * eight marker kinds stay visually distinct.
 */
export const MARKER_COLORS: Record<TimelineMarkerKind, string> = {
  start: '#34d399', // emerald-400
  stop: '#fb7185', // rose-400
  'charge-start': '#6ee7b7', // emerald-300
  'charge-stop': '#fcd34d', // amber-300
  'fast-segment': '#fbbf24', // amber-400
  'regen-peak': '#7dd3fc', // sky-300
  'low-soc': '#fda4af', // rose-300
  event: 'rgba(226, 232, 240, 0.55)', // var(--surface-2) stand-in
};

/** Fallback tick color, matching the web `?? bg-[var(--surface-2)]`. */
const FALLBACK_MARKER_COLOR = 'rgba(226, 232, 240, 0.55)';

/** Smooth-scrub interval — emit intermediate seeks every N ms while dragging. */
export const SCRUB_INTERVAL_MS = 50;

/* ------------------------------------------------------------------ */
/*  Pure helpers (mirror the web inline math; exported for reuse/tests) */
/* ------------------------------------------------------------------ */

/** Clamp a value into the 0..1 normalized range, treating non-finite as 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Native analogue of the web `positionAtClientX`: convert a pointer screen X
 * into a normalized 0..1 track position given the measured track origin/width.
 */
export function normalizedPosition(
  pointerX: number,
  trackLeft: number,
  trackWidth: number,
): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) {
    return 0;
  }
  return clamp01((pointerX - trackLeft) / trackWidth);
}

/** Format a duration in seconds as `m:ss`, matching the web aria-valuetext. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Convert a 0..1 fraction into a clamped CSS-style percentage dimension. */
function toPercent(fraction: number): DimensionValue {
  return `${clamp01(fraction) * 100}%` as DimensionValue;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Rich timeline scrubber for trip replay (native parity).
 *
 * Features beyond a basic progress bar:
 *  - Drag-to-scrub with intermediate seek emissions every {@link SCRUB_INTERVAL_MS}ms.
 *  - During-drag preview tooltip with formatted speed/power/SoC/elevation
 *    (the web shows this on hover; touch has no hover).
 *  - Keyframe marker ticks (charge boundaries, fast segments, regen peaks, low SoC).
 *  - Optional decorative background (e.g. a sparkline) behind the track.
 *  - Touch-friendly 32px-tall hit area.
 *
 * Accessibility:
 *  - Track has `accessibilityRole="adjustable"` with min/max/now/text value.
 *  - Markers are focusable buttons with an accessibility label.
 */
export function TimelineScrubber({
  progress,
  buffered,
  duration,
  markers,
  getPreviewAt,
  onSeek,
  background,
  className: _className,
  style,
  testID,
  accessibilityLabel,
}: TimelineScrubberProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<TimelinePreviewPoint | null>(
    null,
  );
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  }>({width: 0, height: 0});

  // Latest-value refs so the once-created PanResponder never reads stale props.
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const getPreviewRef = useRef(getPreviewAt);
  getPreviewRef.current = getPreviewAt;

  // Measured geometry (the native stand-in for getBoundingClientRect).
  const trackWidthRef = useRef(0);
  const trackLeftRef = useRef(0);
  const lastEmitRef = useRef(0);
  const lastAtRef = useRef(0);

  const clampedProgress = clamp01(progress);
  const clampedBuffered = buffered != null ? clamp01(buffered) : null;

  /* ── Drag-to-scrub via PanResponder (replaces pointer capture) ─── */
  const panResponderRef = useRef<ReturnType<
    typeof PanResponder.create
  > | null>(null);
  if (panResponderRef.current === null) {
    panResponderRef.current = PanResponder.create({
      // Non-capture: touches that start on a marker Pressable win first, so
      // markers seek themselves and the track handles everything else — the
      // native analogue of the web `closest('[data-timeline-marker]')` guard.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const {locationX, pageX} = evt.nativeEvent;
        // pageX - locationX == the track's left edge in screen space (~rect.left).
        trackLeftRef.current = pageX - locationX;
        const at = normalizedPosition(
          pageX,
          trackLeftRef.current,
          trackWidthRef.current,
        );
        lastAtRef.current = at;
        setIsDragging(true);
        setHoverAt(at);
        if (getPreviewRef.current) {
          setHoverPreview(getPreviewRef.current(at));
        }
        lastEmitRef.current = Date.now();
        onSeekRef.current(at);
      },
      onPanResponderMove: (
        _evt: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        const at = normalizedPosition(
          gesture.moveX,
          trackLeftRef.current,
          trackWidthRef.current,
        );
        lastAtRef.current = at;
        setHoverAt(at);
        if (getPreviewRef.current) {
          setHoverPreview(getPreviewRef.current(at));
        }
        const now = Date.now();
        if (now - lastEmitRef.current >= SCRUB_INTERVAL_MS) {
          lastEmitRef.current = now;
          onSeekRef.current(at);
        }
      },
      onPanResponderRelease: () => {
        // lastAtRef holds the grant position for a pure tap (no move fired).
        onSeekRef.current(lastAtRef.current);
        setIsDragging(false);
        setHoverAt(null);
        setHoverPreview(null);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        setHoverAt(null);
        setHoverPreview(null);
      },
    });
  }

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Number.isFinite(width) && width > 0) {
      trackWidthRef.current = width;
    }
  };

  const handlePreviewLayout = (event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    if (width !== previewSize.width || height !== previewSize.height) {
      setPreviewSize({width, height});
    }
  };

  /* ── Aria value text ─────────────────────────────────────────── */
  const valueText =
    Number.isFinite(duration) && duration > 0
      ? formatTimecode(duration * clampedProgress)
      : undefined;

  /* ── Preview tooltip content ─────────────────────────────────── */
  const previewLabelAt = hoverAt ?? clampedProgress;
  const previewSeconds =
    Number.isFinite(duration) && duration > 0
      ? Math.round(duration * previewLabelAt)
      : null;
  const previewTimeStr =
    previewSeconds != null ? formatTimecode(previewSeconds) : null;

  const showPreview =
    (hoverAt != null || isDragging) &&
    (hoverPreview != null || previewTimeStr != null);

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={
        accessibilityLabel ?? t('replay.controls.progress', 'Playback progress')
      }
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(clampedProgress * 100),
        ...(valueText ? {text: valueText} : {}),
      }}
      style={[styles.root, style]}
      testID={testID ?? 'timeline-scrubber'}>
      {/* ── During-drag preview tooltip ──────────────────────────── */}
      {showPreview ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={handlePreviewLayout}
          pointerEvents="none"
          style={[
            styles.previewWrap,
            {
              left: toPercent(previewLabelAt),
              marginTop: -(previewSize.height + 8),
              transform: [{translateX: -previewSize.width / 2}],
            },
          ]}>
          <View style={styles.previewCard}>
            {previewTimeStr ? (
              <AppText style={styles.previewTime} variant="caption">
                {previewTimeStr}
              </AppText>
            ) : null}
            {hoverPreview?.speed ? (
              <View style={styles.previewRow}>
                <AppText style={styles.previewGlyph} variant="caption">
                  {'\u26F0'}
                </AppText>
                <AppText style={styles.previewSpeed} variant="caption">
                  {hoverPreview.speed}
                </AppText>
              </View>
            ) : null}
            {hoverPreview?.power ? (
              <AppText style={styles.previewPower} variant="caption">
                {hoverPreview.power}
              </AppText>
            ) : null}
            {hoverPreview?.soc ? (
              <AppText style={styles.previewSoc} variant="caption">
                {hoverPreview.soc}
              </AppText>
            ) : null}
            {hoverPreview?.elevation ? (
              <AppText style={styles.previewElevation} variant="caption">
                {hoverPreview.elevation}
              </AppText>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ── Track wrapper (the slider hit area) ──────────────────── */}
      <View
        {...panResponderRef.current.panHandlers}
        onLayout={handleTrackLayout}
        style={styles.trackWrap}
        testID="timeline-scrubber-track">
        {/* Background sparkline (decorative, behind track). */}
        {background ? (
          <View pointerEvents="none" style={styles.background}>
            {background}
          </View>
        ) : null}

        {/* Track */}
        <View pointerEvents="none" style={styles.track}>
          {/* Buffered (future use) */}
          {clampedBuffered != null ? (
            <View
              style={[styles.buffered, {width: toPercent(clampedBuffered)}]}
            />
          ) : null}
          {/* Fill */}
          <View style={[styles.fill, {width: toPercent(clampedProgress)}]} />
        </View>

        {/* Markers (rendered in the tall wrapper for a usable touch target). */}
        {markers?.map((marker, index) => (
          <TimelineMarkerTick
            key={`${marker.kind}-${marker.at}-${index}`}
            marker={marker}
            onSeek={onSeek}
          />
        ))}

        {/* Hover ghost playhead — hover-only on web, inert on touch. */}
        {hoverAt != null && !isDragging ? (
          <View
            pointerEvents="none"
            style={[styles.ghost, {left: toPercent(hoverAt)}]}
          />
        ) : null}

        {/* Active playhead thumb */}
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {left: toPercent(clampedProgress)},
            isDragging ? styles.thumbDragging : null,
          ]}
        />
      </View>
    </View>
  );
}

TimelineScrubber.displayName = 'TimelineScrubber';

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
  const pct = Math.round(clamp01(marker.at) * 100);
  const color = MARKER_COLORS[marker.kind] ?? FALLBACK_MARKER_COLOR;
  const accessibilityLabel = marker.label
    ? `${marker.label} ${t('replay.markers.atPercent', 'at {{pct}}%', {pct})}`
    : `${marker.kind} ${pct}%`;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => onSeek(marker.at)}
      style={({pressed}) => [
        styles.marker,
        {backgroundColor: color, left: toPercent(marker.at)},
        pressed ? styles.markerPressed : null,
      ]}
      testID={`timeline-marker-${marker.kind}`}>
      {marker.count != null && marker.count > 1 ? (
        <View pointerEvents="none" style={styles.markerCount}>
          <AppText style={styles.markerCountText} variant="caption">
            {marker.count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

TimelineMarkerTick.displayName = 'TimelineMarkerTick';

const TRACK_HEIGHT = 32;
const MARKER_HEIGHT = 12;
const MARKER_WIDTH = 4;
const THUMB_SIZE = 12;
const THUMB_DRAG_SIZE = 16;
const GHOST_HEIGHT = 12;

const styles = StyleSheet.create({
  background: {
    bottom: 4,
    left: 0,
    opacity: 0.2,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 4,
  },
  buffered: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  fill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  ghost: {
    backgroundColor: colors.textSecondary,
    height: GHOST_HEIGHT,
    marginTop: -GHOST_HEIGHT / 2,
    position: 'absolute',
    top: '50%',
    transform: [{translateX: -0.5}],
    width: 1,
  },
  marker: {
    borderRadius: 2,
    height: MARKER_HEIGHT,
    marginTop: -MARKER_HEIGHT / 2,
    opacity: 0.8,
    position: 'absolute',
    top: '50%',
    transform: [{translateX: -MARKER_WIDTH / 2}],
    width: MARKER_WIDTH,
  },
  markerCount: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    minWidth: 14,
    paddingHorizontal: 3,
    position: 'absolute',
    left: '50%',
    top: -14,
    transform: [{translateX: -7}],
  },
  markerCountText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 8,
    lineHeight: 12,
  },
  markerPressed: {
    opacity: 1,
  },
  previewCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewElevation: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  previewGlyph: {
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  previewPower: {
    color: colors.warning,
    fontFamily: 'monospace',
  },
  previewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  previewSoc: {
    color: colors.success,
    fontFamily: 'monospace',
  },
  previewSpeed: {
    color: colors.accent,
    fontFamily: 'monospace',
  },
  previewTime: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  previewWrap: {
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    zIndex: 20,
  },
  root: {
    position: 'relative',
    width: '100%',
  },
  thumb: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    height: THUMB_SIZE,
    marginTop: -THUMB_SIZE / 2,
    position: 'absolute',
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.3,
    shadowRadius: 6,
    top: '50%',
    transform: [{translateX: -THUMB_SIZE / 2}],
    width: THUMB_SIZE,
  },
  thumbDragging: {
    borderColor: colors.accentSoft,
    borderWidth: 2,
    height: THUMB_DRAG_SIZE,
    marginTop: -THUMB_DRAG_SIZE / 2,
    transform: [{translateX: -THUMB_DRAG_SIZE / 2}],
    width: THUMB_DRAG_SIZE,
  },
  track: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    height: 6,
    width: '100%',
  },
  trackWrap: {
    height: TRACK_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
});
