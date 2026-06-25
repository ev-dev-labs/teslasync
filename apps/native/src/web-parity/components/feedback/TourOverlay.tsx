// Native parity port of web/src/components/feedback/TourOverlay.tsx.
//
// `TourOverlay` is the full-screen product-tour spotlight: it dims the whole
// viewport except a padded rectangle around the current step's target element,
// draws a glowing border around that rectangle, and floats a tooltip card
// (step counter, title, description, skip/back/next controls, and progress
// dots) beside it. The web source is explicit that this is NOT a `<Modal>` —
// it is a transparent-cutout spotlight whose hole keeps the underlying target
// interactive — so the native port mirrors that with an absolutely-positioned,
// `pointerEvents="box-none"` full-screen overlay (NOT a React Native `<Modal>`,
// which would cover and disable the highlighted element).
//
// Browser-only dependencies with no native parity surface (rules 4/7) are
// replaced by native-safe equivalents, each documented in the sidecar:
//   - `DOMRect` (the `targetRect` prop + `getTooltipPosition` arg) -> a
//     native-safe `TourTargetRect` interface exposing exactly the fields the
//     web component reads (top/left/width/height/right/bottom). A native
//     `useTour` is expected to supply these via measure()/measureInWindow().
//   - the `@/hooks/useTour` `TourStep` type -> ported locally and re-exported
//     so this view has no dependency on the (separately converted) hook. The
//     web `target` CSS selector is retained on the type for shape fidelity but
//     is unused by this view (it only reads placement/title/description).
//   - the CSS `clip-path` polygon spotlight cutout has no native analog -> the
//     dim layer is reproduced as four dark Pressable bands (top/bottom/left/
//     right) framing the spotlight rectangle; tapping any band runs `onSkip`,
//     exactly like the web overlay's `onClick={onSkip}`. The hole between them
//     stays transparent so the underlying target shows through and remains
//     tappable. Band sizes are clamped to >= 0 (native Views reject negative
//     dimensions; the web clip-path tolerated off-screen points).
//   - `window.innerWidth/innerHeight` (in `getTooltipPosition`) -> the
//     `useWindowDimensions()` width/height; the clamp/placement math is ported
//     verbatim (gap 16, pad 16, maxW = min(360, vw - 32), bottomNav 72).
//   - `useMotionPreference().reduce` (framer-motion) -> an `AccessibilityInfo`
//     reduced-motion hook (same pattern as the DataFreshness / PollingEngine
//     ports). It gates the tooltip's entrance animation, the native analog of
//     the web `animate-in fade-in slide-in-from-bottom-2` (opacity 0->1,
//     translateY 8->0 == slide-in-from-bottom-2, duration-normal ~= 250ms,
//     Easing.out). The spotlight's continuous `transition-all` layout tween
//     and `backdrop-blur-xl` have no native analog and are omitted.
//   - lucide-react `X` / `ArrowLeft` / `ArrowRight` SVGs -> decorative AppText
//     glyphs ×/←/→ flagged hidden from accessibility (mirroring the web icons'
//     implicit aria-hidden), matching the sibling InlineCallout / OfflineBanner
//     glyph approach.
//   - the shared `@/components/ui` `Button` -> a local `NavButton` Pressable
//     (ghost / primary, size-sm) so the in-button arrow glyph the web Button
//     wrapped is preserved (the native AppButton ships label-only).
//
// Theme-var mapping (Tailwind/CSS var -> native token): --surface-overlay ->
// a dark scrim rgba(5,7,13,0.72) aligned to colors.background; --theme-primary
// -> colors.accent (border at /40 -> rgba(53,213,255,0.4); glow shadow at /0.2);
// --bg-secondary -> colors.surface; --border-subtle -> colors.border; shadow-2xl
// -> shadows.panel; --text-primary/secondary/muted -> the matching token colors;
// --surface-2 -> colors.surfaceRaised. role="dialog"/aria-modal="false"/aria-label
// -> accessibilityViewIsModal={false} + accessibilityLabel; data-tour-active
// -> testID="tour-overlay".

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

/**
 * Native-safe stand-in for the web `DOMRect` carried by `targetRect`. Exposes
 * exactly the fields `TourOverlay` reads; a native `useTour` is expected to
 * populate these from `measureInWindow()` on the highlighted element.
 */
export interface TourTargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/**
 * Ported from `@/hooks/useTour`. `target` is the web CSS selector for the
 * element to highlight — retained for shape fidelity but unused by this view,
 * which only consumes `placement`, `title`, and `description`.
 */
export interface TourStep {
  /** CSS selector (web) / element key (native) for the element to highlight. */
  target: string;
  /** Title of the tooltip. */
  title: string;
  /** Description text. */
  description: string;
  /** Position of the tooltip relative to the highlighted element. */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown (e.g., open sidebar). */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step. */
  onHide?: () => void;
}

interface TourOverlayProps {
  step: TourStep;
  targetRect: TourTargetRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next has no native parity module; resolve to the inline English
// fallback and interpolate {{token}} options so the i18n key + copy intent
// survive (same pattern as the OfflineBanner / ReauthDialog ports).
function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return Object.entries(options).reduce(
      (text, [token, value]) => text.split(`{{${token}}}`).join(String(value)),
      fallback,
    );
  }).current;
}

// Native analog of web `useMotionPreference().reduce` — reads the OS
// reduce-motion setting via AccessibilityInfo and tracks live changes (same
// pattern as the DataFreshness / PollingEngine ports).
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduce;
}

const SPOTLIGHT_PADDING = 6;
// --surface-overlay: dark scrim aligned to colors.background (#05070d).
const OVERLAY_COLOR = 'rgba(5, 7, 13, 0.72)';
// --theme-primary at /40 (border) — colors.accent is #35d5ff == rgb(53,213,255).
const SPOTLIGHT_BORDER = 'rgba(53, 213, 255, 0.4)';
// duration-normal — the tooltip entrance timing.
const ENTRANCE_DURATION_MS = 250;
// slide-in-from-bottom-2 == 0.5rem == 8px.
const ENTRANCE_OFFSET = 8;

const clampNonNegative = (value: number): number => Math.max(0, value);

export function TourOverlay({
  step,
  targetRect,
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: TourOverlayProps) {
  const t = useNativeTranslationFallback();
  const reduce = useReduceMotion();
  const {width: vw, height: vh} = useWindowDimensions();

  // All hooks must run before the early return below (React rules of hooks);
  // the web component returns null on a missing rect after its two hooks too.
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      entrance.setValue(1);
      return undefined;
    }
    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduce, entrance]);

  if (!targetRect) {
    return null;
  }

  const spotlight = {
    top: targetRect.top - SPOTLIGHT_PADDING,
    left: targetRect.left - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
  };

  const tooltipPosition = getTooltipPosition(step.placement, targetRect, vw, vh);

  const isLastStep = currentStep === totalSteps - 1;

  // Four dark bands frame the spotlight rectangle, reproducing the web
  // clip-path cutout; each band runs onSkip like the web overlay onClick.
  const topBand: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: clampNonNegative(spotlight.top),
  };
  const bottomBand: ViewStyle = {
    position: 'absolute',
    top: clampNonNegative(spotlight.top + spotlight.height),
    left: 0,
    right: 0,
    bottom: 0,
  };
  const leftBand: ViewStyle = {
    position: 'absolute',
    top: clampNonNegative(spotlight.top),
    left: 0,
    width: clampNonNegative(spotlight.left),
    height: clampNonNegative(spotlight.height),
  };
  const rightBand: ViewStyle = {
    position: 'absolute',
    top: clampNonNegative(spotlight.top),
    left: clampNonNegative(spotlight.left + spotlight.width),
    right: 0,
    height: clampNonNegative(spotlight.height),
  };

  const spotlightGlow: ViewStyle = {
    position: 'absolute',
    top: spotlight.top,
    left: spotlight.left,
    width: clampNonNegative(spotlight.width),
    height: clampNonNegative(spotlight.height),
  };

  const tooltipStyle: ViewStyle = {
    position: 'absolute',
    maxWidth: tooltipPosition.maxWidth,
    ...(tooltipPosition.top !== undefined ? {top: tooltipPosition.top} : null),
    ...(tooltipPosition.bottom !== undefined
      ? {bottom: tooltipPosition.bottom}
      : null),
    ...(tooltipPosition.left !== undefined
      ? {left: tooltipPosition.left}
      : null),
    ...(tooltipPosition.right !== undefined
      ? {right: tooltipPosition.right}
      : null),
  };

  const entranceStyle = {
    opacity: entrance,
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [ENTRANCE_OFFSET, 0],
        }),
      },
    ],
  };

  const dialogLabel = t(
    'tour.dialogLabel',
    'Tour step {{current}} of {{total}}',
    {current: currentStep + 1, total: totalSteps},
  );

  return (
    <View pointerEvents="box-none" style={styles.root} testID="tour-overlay">
      {/* Dark overlay with spotlight cutout — four pressable bands; tap dims to skip */}
      <Pressable
        accessibilityLabel={t('tour.skip', 'Skip tour')}
        accessibilityRole="button"
        onPress={onSkip}
        style={[styles.band, topBand]}
      />
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onSkip}
        style={[styles.band, bottomBand]}
      />
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onSkip}
        style={[styles.band, leftBand]}
      />
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onSkip}
        style={[styles.band, rightBand]}
      />

      {/* Spotlight border glow */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.spotlight, spotlightGlow]}
      />

      {/* Tooltip */}
      <Animated.View
        accessibilityLabel={dialogLabel}
        accessibilityViewIsModal={false}
        style={[styles.tooltip, tooltipStyle, entranceStyle]}>
        {/* Close button — 44px touch target for mobile */}
        <Pressable
          accessibilityLabel={t('tour.close', 'Close tour')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onSkip}
          style={({pressed}) => [styles.closeButton, pressed && styles.pressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.closeGlyph}>
            ×
          </AppText>
        </Pressable>

        {/* Step counter */}
        <AppText style={styles.counter}>
          {currentStep + 1} / {totalSteps}
        </AppText>

        {/* Content */}
        <AppText style={styles.title} weight="semibold">
          {step.title}
        </AppText>
        <AppText style={styles.description} tone="secondary">
          {step.description}
        </AppText>

        {/* Navigation */}
        <View style={styles.nav}>
          <Pressable
            accessibilityLabel={t('tour.skip', 'Skip tour')}
            accessibilityRole="button"
            onPress={onSkip}
            style={({pressed}) => [styles.skip, pressed && styles.pressed]}>
            <AppText style={styles.skipText}>{t('tour.skip', 'Skip tour')}</AppText>
          </Pressable>
          <View style={styles.navActions}>
            {currentStep > 0 ? (
              <NavButton
                leadingGlyph="←"
                label={t('tour.prev', 'Back')}
                onPress={onPrev}
                variant="ghost"
              />
            ) : null}
            <NavButton
              label={
                isLastStep
                  ? t('tour.finish', 'Get Started!')
                  : t('tour.next', 'Next')
              }
              onPress={onNext}
              trailingGlyph={isLastStep ? undefined : '→'}
              variant="primary"
            />
          </View>
        </View>

        {/* Progress dots */}
        <View style={styles.dots}>
          {Array.from({length: totalSteps}).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentStep
                  ? styles.dotActive
                  : i < currentStep
                  ? styles.dotInactive
                  : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

TourOverlay.displayName = 'TourOverlay';

interface TooltipPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxWidth: number;
}

// Ported verbatim from the web `getTooltipPosition`, with window.innerWidth/
// innerHeight replaced by the supplied viewport dimensions.
function getTooltipPosition(
  placement: string,
  rect: TourTargetRect,
  vw: number,
  vh: number,
): TooltipPosition {
  const gap = 16;
  const pad = 16;
  const maxW = Math.min(360, vw - pad * 2);
  const bottomNav = 72; // mobile bottom tab bar height

  const clampLeft = (x: number) => Math.max(pad, Math.min(x, vw - maxW - pad));
  const clampTop = (y: number) =>
    Math.max(pad, Math.min(y, vh - bottomNav - 160));

  switch (placement) {
    case 'bottom':
      return {top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW};
    case 'top':
      return {
        bottom: Math.max(pad + bottomNav, vh - rect.top + gap),
        left: clampLeft(rect.left),
        maxWidth: maxW,
      };
    case 'right':
      return {top: clampTop(rect.top), left: clampLeft(rect.right + gap), maxWidth: maxW};
    case 'left':
      return {
        top: clampTop(rect.top),
        right: Math.max(pad, vw - rect.left + gap),
        maxWidth: maxW,
      };
    default:
      return {top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW};
  }
}

interface NavButtonProps {
  label: string;
  onPress: () => void;
  variant: 'ghost' | 'primary';
  leadingGlyph?: string;
  trailingGlyph?: string;
}

// Local stand-in for the shared `Button` (size="sm"); preserves the in-button
// arrow glyph that the web `<Button>` wrapped, which the label-only AppButton
// cannot express.
function NavButton({
  label,
  onPress,
  variant,
  leadingGlyph,
  trailingGlyph,
}: NavButtonProps) {
  const textStyle: TextStyle =
    variant === 'ghost' ? styles.navTextGhost : styles.navTextPrimary;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.navButton,
        variant === 'ghost' ? styles.navButtonGhost : styles.navButtonPrimary,
        pressed && styles.pressed,
      ]}>
      {leadingGlyph ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.navGlyph, textStyle]}>
          {leadingGlyph}
        </AppText>
      ) : null}
      <AppText style={[styles.navLabel, textStyle]} weight="semibold">
        {label}
      </AppText>
      {trailingGlyph ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.navGlyph, textStyle]}>
          {trailingGlyph}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
  },
  band: {
    backgroundColor: OVERLAY_COLOR,
  },
  spotlight: {
    borderColor: SPOTLIGHT_BORDER,
    borderRadius: 8,
    borderWidth: 2,
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  tooltip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 384,
    padding: 16,
    ...shadows.panel,
  },
  closeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 16,
  },
  counter: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  nav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  skip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  skipText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  navActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  navButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  navButtonGhost: {
    backgroundColor: 'transparent',
  },
  navButtonPrimary: {
    backgroundColor: colors.accent,
  },
  navTextGhost: {
    color: colors.textSecondary,
  },
  navTextPrimary: {
    color: colors.background,
  },
  navLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  navGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    marginTop: 12,
  },
  dot: {
    borderRadius: 999,
    height: 4,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 16,
  },
  dotInactive: {
    backgroundColor: colors.surfaceRaised,
    width: 6,
  },
  pressed: {
    opacity: 0.7,
  },
});

export default TourOverlay;
