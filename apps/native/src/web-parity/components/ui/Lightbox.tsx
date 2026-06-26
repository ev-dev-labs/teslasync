// Native parity port of web/src/components/ui/Lightbox.tsx.
//
// The web `<Lightbox>` is an immersive full-viewport image viewer rendered via
// `createPortal(overlay, document.body)`: a `role="dialog" aria-modal` surface
// with a click-to-close backdrop, ←/→ sequence navigation, +/- zoom (1x–5x in
// 0.5x steps, `0` reset), drag-to-pan when zoomed (Pointer Events +
// setPointerCapture), a loading skeleton until the `<img>` decodes,
// `new Image()` neighbour pre-warming, a `n / total` counter, an optional
// caption, and a DOM focus trap (Tab/Shift+Tab cycle, focus restore on close)
// plus an imperative `keydown` listener for Esc/Arrow/Home/End/+/-/0. It is
// reproduced here with React Native primitives:
//
//   - `createPortal(..., document.body)` -> a native `<Modal transparent
//     animationType="fade">`. The Modal supplies the portal-to-root, the native
//     focus trap (so the whole `FOCUSABLE_SELECTOR` + Tab/Shift+Tab effect and
//     the `previouslyFocused` restore are dropped — there is no DOM focus model
//     on native), and `onRequestClose` wires the Android hardware back button as
//     the native analog of the web's `Esc` close.
//   - The remaining keyboard shortcuts (ArrowLeft/Right, Home/End, +/-/0) have no
//     touch-native analog, so the entire imperative `keydown` listener and the
//     `keyHandlersRef` ref-indirection it required are dropped; the on-screen
//     prev/next/zoom/reset/close buttons remain the interaction surface and call
//     the SAME `goPrev/goNext/goFirst/goLast/zoomIn/zoomOut/zoomReset/onClose`
//     callbacks (kept verbatim, including the `0`-reset pan clear).
//   - The backdrop `<div onClick={onClose}>` -> a full-screen `<Pressable
//     onPress={onClose}>` rendered first (z-bottom), hidden from screen readers
//     (the X button is the SR close affordance, mirroring the web `aria-hidden`).
//     The dialog's `pointer-events-none` + per-child `pointer-events-auto`
//     choreography becomes `pointerEvents="box-none"` on the content/image-area
//     containers, so taps that miss an interactive child fall through to the
//     backdrop and close — preserving "click outside the image closes". The
//     image's horizontal inset leaves box-none side strips as that outside region.
//   - The `<img>` -> a React Native `Image` (`resizeMode="contain"`). A
//     `PanResponder` replaces Pointer Events: it always claims the start responder
//     so a tap on the image does NOT close (matching `pointer-events-auto`), and
//     drags update the SAME `pan` state ONLY when zoomed (`zoom > 1`), preserving
//     the `DragState` capture-at-grant semantics. The CSS `transform:
//     translate(px) scale()` becomes the Image `transform: [{translateX},
//     {translateY}, {scale}]`; `transformOrigin center`, the `transition`/`cursor`
//     pointer affordances, and `draggable={false}` are browser-only and dropped.
//   - `new Image(); preload.src = …` neighbour pre-warming -> `Image.prefetch(uri)`
//     (fire-and-forget, guarded for the jest mock), preserving the ±1 cache warm.
//   - The decode skeleton (`animate-pulse`) -> a static dimmed placeholder shown
//     while `!decoded` (`onLoad`/`onError` -> `setDecoded(true)` verbatim); the
//     infinite pulse keyframe is dropped to avoid a background timer.
//   - lucide-react glyphs (X, ChevronLeft/Right, Minus, Plus, RotateCcw) -> the
//     decorative Unicode glyphs ✕ ‹ › − + ↺ in `AppText`
//     (`importantForAccessibility="no"`), the same approach the DataTableBulkBar
//     port took for the lucide `X`; each button keeps its `aria-label` ->
//     `accessibilityLabel`. `aria-live="polite"` on the zoom-percent ->
//     `accessibilityLiveRegion="polite"`.
//   - react-i18next is unavailable in native parity; a local t() shim returns the
//     English fallback and resolves `{{current}}/{{total}}/{{value}}`
//     interpolation, preserving every i18n key. The web CSS-var colors
//     (`--bg-app`, `--surface-1/2`, `--glass-border`, `--text-*`) are preserved as
//     literals / theme tokens. `forced-colors:*` Windows-High-Contrast overrides
//     are browser-only and dropped.
//   - `useId()` is kept and used to wire the counter (`nativeID`) to the dialog
//     container (`accessibilityLabelledBy`, Android) — the native analog of the
//     web `aria-labelledby`. `accessibilityViewIsModal` carries the `aria-modal`.

import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 5;
export const LIGHTBOX_ZOOM_STEP = 0.5;

export interface LightboxImage {
  /** Image URL (any platform-supported format). */
  src: string;
  /**
   * Accessible alt text for the image. Required — empty string is allowed
   * for purely decorative images but the prop must be present so callers
   * make a deliberate choice.
   */
  alt: string;
  /** Optional caption rendered below the image. */
  caption?: string;
}

export interface LightboxProps {
  /** Controls visibility — typically backed by useState in the caller. */
  open: boolean;
  /**
   * Called when the user requests close (Android back, X button, backdrop tap).
   * Caller is responsible for flipping `open` to false in response.
   */
  onClose: () => void;
  /** Sequence of images to navigate. Empty array renders nothing. */
  images: LightboxImage[];
  /**
   * Index of the image to show first. Re-applied each time the lightbox
   * transitions from closed to open; ignored while already open.
   * Out-of-range values clamp to 0 / images.length-1.
   */
  initialIndex?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override merged last onto the dialog container. */
  style?: StyleProp<ViewStyle>;
}

interface DragState {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  pointerId: number;
}

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys and `{{token}}` intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

export function Lightbox({
  open,
  onClose,
  images,
  initialIndex = 0,
  className: _className,
  style,
}: LightboxProps) {
  const t = useNativeTranslationFallback();
  const dragRef = useRef<DragState | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();

  const total = images.length;
  const safeInitialIndex = Math.min(
    Math.max(initialIndex, 0),
    Math.max(total - 1, 0),
  );

  const [index, setIndex] = useState(safeInitialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x: 0, y: 0});
  const [decoded, setDecoded] = useState(false);

  // Latest pan/zoom mirrored into refs so the single PanResponder (created
  // once) reads current values on every gesture without being re-created —
  // the native analog of the web `keyHandlersRef` ref-indirection.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Reset state on the closed->open transition. We deliberately ignore
  // changes to `initialIndex` while already open — once the user has
  // navigated past the starting image we must not snap them back if the
  // parent re-renders with a stale `initialIndex` prop.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setIndex(safeInitialIndex);
      setZoom(1);
      setPan({x: 0, y: 0});
      setDecoded(false);
    }
    wasOpenRef.current = open;
  }, [open, safeInitialIndex]);

  // Reset zoom + pan + decoded when navigating to a different image.
  useEffect(() => {
    setZoom(1);
    setPan({x: 0, y: 0});
    setDecoded(false);
  }, [index]);

  // Pre-warm neighbour images so prev/next navigation has them in cache.
  // `Image.prefetch` triggers the same fetch + decode path as the visible
  // <Image>; we don't await — the cache is the point.
  useEffect(() => {
    if (!open || total === 0) {
      return;
    }
    for (const offset of [-1, 1]) {
      const i = index + offset;
      if (i < 0 || i >= total) {
        continue;
      }
      const neighbour = images[i];
      if (!neighbour?.src) {
        continue;
      }
      if (typeof Image.prefetch === 'function') {
        const prefetched = Image.prefetch(neighbour.src) as
          | Promise<boolean>
          | undefined;
        if (prefetched && typeof prefetched.then === 'function') {
          prefetched.then(undefined, () => {
            // Pre-warm is best-effort; a failed prefetch must never throw.
          });
        }
      }
    }
  }, [open, index, images, total]);

  const goPrev = useCallback(() => {
    setIndex(i => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIndex(i => Math.min(total - 1, i + 1));
  }, [total]);
  // NOTE: the web `goFirst`/`goLast` callbacks existed solely to service the
  // Home/End keydown shortcuts, which have no touch-native analog; they are
  // dropped here alongside the keydown listener (see the file header).

  const zoomIn = useCallback(() => {
    setZoom(z =>
      Math.min(LIGHTBOX_MAX_ZOOM, +(z + LIGHTBOX_ZOOM_STEP).toFixed(2)),
    );
  }, []);
  const zoomOut = useCallback(() => {
    setZoom(z => {
      const next = Math.max(
        LIGHTBOX_MIN_ZOOM,
        +(z - LIGHTBOX_ZOOM_STEP).toFixed(2),
      );
      // Reset pan when we snap back to 1x — otherwise the image jumps
      // off-centre when the user re-zooms.
      if (next === LIGHTBOX_MIN_ZOOM) {
        setPan({x: 0, y: 0});
      }
      return next;
    });
  }, []);
  const zoomReset = useCallback(() => {
    setZoom(1);
    setPan({x: 0, y: 0});
  }, []);

  // Drag-to-pan when zoomed. A PanResponder replaces the web Pointer Events:
  // it always claims the start responder so a tap on the image swallows the
  // touch (the image never closes the lightbox, matching pointer-events-auto),
  // while pan only updates while zoomed. The drag captures the pan offset at
  // grant time (DragState.panX/panY), mirroring the web handlePointerDown.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => zoomRef.current > 1,
      onPanResponderGrant: (evt) => {
        if (zoomRef.current <= 1) {
          dragRef.current = null;
          return;
        }
        dragRef.current = {
          startX: evt.nativeEvent.pageX,
          startY: evt.nativeEvent.pageY,
          panX: panRef.current.x,
          panY: panRef.current.y,
          pointerId: Number(evt.nativeEvent.identifier) || 0,
        };
      },
      onPanResponderMove: (_evt, gesture) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        setPan({
          x: drag.panX + gesture.dx,
          y: drag.panY + gesture.dy,
        });
      },
      onPanResponderRelease: () => {
        dragRef.current = null;
      },
      onPanResponderTerminate: () => {
        dragRef.current = null;
      },
    }),
  ).current;

  if (!open || total === 0) {
    return null;
  }

  const current = images[Math.min(index, total - 1)];
  if (!current) {
    return null;
  }

  const atFirst = index === 0;
  const atLast = index >= total - 1;
  const canZoomIn = zoom < LIGHTBOX_MAX_ZOOM;
  const canZoomOut = zoom > LIGHTBOX_MIN_ZOOM;
  const isZoomed = zoom > 1;

  const imageDynamicStyle: ImageStyle = {
    opacity: decoded ? 1 : 0,
    transform: [{translateX: pan.x}, {translateY: pan.y}, {scale: zoom}],
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.root}>
        {/* Backdrop — tapping anywhere on it closes the lightbox. Hidden from
            screen readers; the X button is the SR close affordance. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
          testID="lightbox-backdrop"
        />

        {/* Dialog — pointerEvents box-none lets taps in the gaps fall through
            to the backdrop (so "tap outside image closes" works) while each
            interactive child still captures its own touches. */}
        <View
          accessibilityLabelledBy={titleId}
          accessibilityViewIsModal
          pointerEvents="box-none"
          style={[styles.content, style]}
          testID="lightbox-dialog">
          {/* Top bar — counter (left) + close (right). */}
          <View style={styles.topBar}>
            <AppText
              nativeID={titleId}
              style={styles.counter}
              testID="lightbox-counter">
              {t('lightbox.counter', '{{current}} / {{total}}', {
                current: index + 1,
                total,
              })}
            </AppText>
            <Pressable
              accessibilityLabel={t('lightbox.close', 'Close image viewer')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.iconButton,
                styles.closeButton,
                pressed && styles.iconButtonPressed,
              ]}
              testID="lightbox-close">
              <AppText importantForAccessibility="no" style={styles.closeGlyph}>
                {'\u2715'}
              </AppText>
            </Pressable>
          </View>

          {/* Image area — box-none so the left/right inset strips fall through
              to the backdrop; the Image, prev, and next children capture. */}
          <View pointerEvents="box-none" style={styles.imageArea}>
            {!decoded ? (
              <View
                pointerEvents="none"
                style={styles.skeleton}
                testID="lightbox-skeleton"
              />
            ) : null}
            <Image
              {...panResponder.panHandlers}
              accessibilityLabel={current.alt || undefined}
              accessibilityRole="image"
              accessible={current.alt.length > 0}
              onError={() => setDecoded(true)}
              onLoad={() => setDecoded(true)}
              resizeMode="contain"
              source={{uri: current.src}}
              style={[styles.image, imageDynamicStyle]}
              testID="lightbox-image"
            />

            {total > 1 ? (
              <>
                <Pressable
                  accessibilityLabel={t('lightbox.previous', 'Previous image')}
                  accessibilityRole="button"
                  accessibilityState={{disabled: atFirst}}
                  disabled={atFirst}
                  onPress={goPrev}
                  style={({pressed}) => [
                    styles.navButton,
                    styles.navButtonLeft,
                    pressed && !atFirst && styles.navButtonPressed,
                    atFirst && styles.controlDisabled,
                  ]}
                  testID="lightbox-prev">
                  <AppText importantForAccessibility="no" style={styles.navGlyph}>
                    {'\u2039'}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityLabel={t('lightbox.next', 'Next image')}
                  accessibilityRole="button"
                  accessibilityState={{disabled: atLast}}
                  disabled={atLast}
                  onPress={goNext}
                  style={({pressed}) => [
                    styles.navButton,
                    styles.navButtonRight,
                    pressed && !atLast && styles.navButtonPressed,
                    atLast && styles.controlDisabled,
                  ]}
                  testID="lightbox-next">
                  <AppText importantForAccessibility="no" style={styles.navGlyph}>
                    {'\u203A'}
                  </AppText>
                </Pressable>
              </>
            ) : null}
          </View>

          {/* Bottom bar — caption (top row) + zoom controls (bottom row). */}
          <View style={styles.bottomBar}>
            {current.caption ? (
              <AppText style={styles.caption} testID="lightbox-caption">
                {current.caption}
              </AppText>
            ) : null}
            <View style={styles.zoomBar}>
              <Pressable
                accessibilityLabel={t('lightbox.zoomOut', 'Zoom out')}
                accessibilityRole="button"
                accessibilityState={{disabled: !canZoomOut}}
                disabled={!canZoomOut}
                hitSlop={4}
                onPress={zoomOut}
                style={({pressed}) => [
                  styles.zoomButton,
                  pressed && canZoomOut && styles.iconButtonPressed,
                  !canZoomOut && styles.controlDisabled,
                ]}
                testID="lightbox-zoom-out">
                <AppText importantForAccessibility="no" style={styles.zoomGlyph}>
                  {'\u2212'}
                </AppText>
              </Pressable>
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.zoomLevel}
                testID="lightbox-zoom-level">
                {t('lightbox.zoomPercent', '{{value}}%', {
                  value: Math.round(zoom * 100),
                })}
              </AppText>
              <Pressable
                accessibilityLabel={t('lightbox.zoomIn', 'Zoom in')}
                accessibilityRole="button"
                accessibilityState={{disabled: !canZoomIn}}
                disabled={!canZoomIn}
                hitSlop={4}
                onPress={zoomIn}
                style={({pressed}) => [
                  styles.zoomButton,
                  pressed && canZoomIn && styles.iconButtonPressed,
                  !canZoomIn && styles.controlDisabled,
                ]}
                testID="lightbox-zoom-in">
                <AppText importantForAccessibility="no" style={styles.zoomGlyph}>
                  {'\u002B'}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityLabel={t('lightbox.zoomReset', 'Reset zoom')}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !isZoomed && pan.x === 0 && pan.y === 0,
                }}
                disabled={!isZoomed && pan.x === 0 && pan.y === 0}
                hitSlop={4}
                onPress={zoomReset}
                style={({pressed}) => {
                  const resetDisabled = !isZoomed && pan.x === 0 && pan.y === 0;
                  return [
                    styles.zoomButton,
                    pressed && !resetDisabled && styles.iconButtonPressed,
                    resetDisabled && styles.controlDisabled,
                  ];
                }}
                testID="lightbox-zoom-reset">
                <AppText importantForAccessibility="no" style={styles.zoomGlyph}>
                  {'\u21BA'}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

Lightbox.displayName = 'Lightbox';

// Web CSS vars, preserved as literals / theme tokens.
const BACKDROP = 'rgba(5, 7, 13, 0.95)'; // --bg-app/95
const SKELETON = 'rgba(21, 22, 33, 0.6)'; // --surface-2/60

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BACKDROP,
  },
  bottomBar: {
    alignItems: 'center',
    flexDirection: 'column',
    flexShrink: 0,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  caption: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 480,
    textAlign: 'center',
  },
  closeButton: {
    height: 44,
    width: 44,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 22,
  },
  content: {
    flex: 1,
    flexDirection: 'column',
  },
  controlDisabled: {
    opacity: 0.4,
  },
  counter: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  image: {
    height: '100%',
    width: '100%',
  },
  imageArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    position: 'relative',
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginTop: -24,
    position: 'absolute',
    top: '50%',
    width: 48,
  },
  navButtonLeft: {
    left: spacing.sm,
  },
  navButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  navButtonRight: {
    right: spacing.sm,
  },
  navGlyph: {
    color: colors.textPrimary,
    fontSize: 26,
    lineHeight: 30,
  },
  root: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: SKELETON,
    borderRadius: 8,
    bottom: spacing.xl,
    left: 48,
    position: 'absolute',
    right: 48,
    top: spacing.xl,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  zoomBar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  zoomButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  zoomGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 20,
  },
  zoomLevel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
    lineHeight: 16,
    minWidth: 56,
    textAlign: 'center',
  },
});
