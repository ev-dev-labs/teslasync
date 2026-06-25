// Native parity port of web/src/components/status/StatusHero.tsx.
//
// StatusHero — large at-a-glance status card that answers "is my instance
// healthy?" in <1 second. The `status` prop drives the glyph, headline,
// ring/background tint, icon color, and the GlassPanel glow, exactly as on web.
// Reusable across the SystemStatusPage hero, future incident pages, and
// embedded dashboard summaries.
//
// Native-safe adaptations (documented in the sidecar):
//
//   - The shared web `Button` (`@/components/ui`) renders an icon + label with a
//     `gap-2` and a `variant="primary" size="md"` skin. The native `AppButton`
//     only accepts a string label, so — to preserve the spinning RefreshCw icon
//     and the `disabled-while-loading` behavior — a small inline `StatusHeroCta`
//     Pressable mirrors AppButton's primary visual style (accent background,
//     min-height 44, radius 14) and adds the View-drawn refresh glyph.
//
//   - `lucide-react` glyphs (CheckCircle / AlertTriangle / XCircle / HelpCircle /
//     Wrench / RefreshCw) have no native package here (no react-native-svg /
//     vector-icons), so they are drawn with React Native `View` primitives,
//     mirroring the LiveIndicator and BackgroundWorkSegment glyph ports. The
//     glyph kind is stored as a string discriminator instead of a component
//     reference; status color carries the primary semantic, the glyph reinforces.
//
//   - The web `boxShadow: 0 0 60px <glowRgba>` colored glow maps to native
//     `shadowColor`/`shadowOpacity`/`shadowRadius` + Android `elevation`.
//
//   - Tailwind utilities / CSS vars resolve to literal token values (green/amber/
//     red/zinc/blue 400|500 plus the native theme `text-secondary`/`text-muted`),
//     DOM `div`/`h2`/`span` become `View`/`AppText`, the `cn` class-merge becomes
//     StyleSheet + style arrays, and `role="status" aria-live="polite"` maps to
//     `accessibilityLiveRegion="polite"` (RN has no 'status' role). The icon ring
//     keeps the web `aria-hidden` via `accessibilityElementsHidden`.
//
//   - `<LiveIndicator variant="dot" />` reuses the already-ported native
//     LiveIndicator. The hardcoded English strings ("All systems operational",
//     "Live", …) are preserved verbatim since the web source uses no i18n here.
//
// No DOM elements, lucide-react, Recharts, Leaflet, or old web UI components are
// imported — only React Native primitives, native theme tokens, and the native
// GlassPanel / AppText / LiveIndicator parity components.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors} from '../../../theme/tokens';
import {LiveIndicator} from '../data-display/LiveIndicator';

/** Overall hero status, mirroring the web `HeroStatus` union. */
export type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

/** Discriminator for the View-drawn stand-in of each lucide status glyph. */
type StatusGlyphKind = 'check' | 'alert' | 'x' | 'help' | 'wrench';

interface StatusVisual {
  /** View-drawn glyph kind (web lucide icon). */
  glyph: StatusGlyphKind;
  /** Ring border color — web `ring-{c}-500/40`. */
  ring: string;
  /** Icon-ring background tint — web `bg-{c}-500/15`. */
  bg: string;
  /** Icon + headline color — web `text-{c}-400`. */
  text: string;
  /** Native shadow color for the GlassPanel glow (web `glowRgba` base hue). */
  glow: string;
  /** Native shadow opacity (web `glowRgba` alpha). */
  glowOpacity: number;
  /** Default headline when no override is supplied. */
  defaultHeadline: string;
}

// Tailwind tokens resolved to literal values, preserving visual intent:
//   text  -> {c}-400, ring -> {c}-500 @ 0.40, bg -> {c}-500 @ 0.15,
//   glow  -> {c}-500 @ 0.35 (zinc/unknown @ 0.25) matching the web glowRgba.
const STATUS_CONFIG: Record<HeroStatus, StatusVisual> = {
  healthy: {
    glyph: 'check',
    ring: 'rgba(34, 197, 94, 0.4)', // ring-green-500/40
    bg: 'rgba(34, 197, 94, 0.15)', // bg-green-500/15
    text: '#4ade80', // text-green-400
    glow: '#22c55e', // rgba(34,197,94,0.35)
    glowOpacity: 0.35,
    defaultHeadline: 'All systems operational',
  },
  degraded: {
    glyph: 'alert',
    ring: 'rgba(245, 158, 11, 0.4)', // ring-amber-500/40
    bg: 'rgba(245, 158, 11, 0.15)', // bg-amber-500/15
    text: '#fbbf24', // text-amber-400
    glow: '#f59e0b', // rgba(245,158,11,0.35)
    glowOpacity: 0.35,
    defaultHeadline: 'Degraded performance',
  },
  unhealthy: {
    glyph: 'x',
    ring: 'rgba(239, 68, 68, 0.4)', // ring-red-500/40
    bg: 'rgba(239, 68, 68, 0.15)', // bg-red-500/15
    text: '#f87171', // text-red-400
    glow: '#ef4444', // rgba(239,68,68,0.35)
    glowOpacity: 0.35,
    defaultHeadline: 'Service outage',
  },
  unknown: {
    glyph: 'help',
    ring: 'rgba(113, 113, 122, 0.4)', // ring-zinc-500/40
    bg: 'rgba(113, 113, 122, 0.15)', // bg-zinc-500/15
    text: '#a1a1aa', // text-zinc-400
    glow: '#71717a', // rgba(113,113,122,0.25)
    glowOpacity: 0.25,
    defaultHeadline: 'Status unknown',
  },
  maintenance: {
    glyph: 'wrench',
    ring: 'rgba(59, 130, 246, 0.4)', // ring-blue-500/40
    bg: 'rgba(59, 130, 246, 0.15)', // bg-blue-500/15
    text: '#60a5fa', // text-blue-400
    glow: '#3b82f6', // rgba(59,130,246,0.35)
    glowOpacity: 0.35,
    defaultHeadline: 'Scheduled maintenance',
  },
};

export interface StatusHeroProps {
  status: HeroStatus;
  /** Override headline text. Default depends on status. */
  headline?: string;
  /** Sub-line shown beneath the headline. */
  subline?: ReactNode;
  /** Show "Live" indicator dot when live updates are connected. */
  live?: boolean;
  /**
   * Optional CTA button (e.g. "Run health check"). `onClick` keeps the web prop
   * name for source parity; it is wired to the native Pressable `onPress`.
   */
  cta?: {label: string; onClick: () => void; loading?: boolean};
  /** Optional ID — mapped to the panel `nativeID`/`testID` (web anchor intent). */
  id?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

const RING_SIZE = 56; // h-14 w-14
const GLYPH_SIZE = 28; // h-7 w-7
const CTA_ICON_SIZE = 16; // h-4 w-4

/**
 * `<StatusHero>` — large at-a-glance status card. See module header for the
 * native-safe adaptations of the web Button, lucide glyphs, glow, and ARIA.
 */
export function StatusHero({
  status,
  headline,
  subline,
  live = false,
  cta,
  id,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: StatusHeroProps) {
  const cfg = STATUS_CONFIG[status];
  const heading = headline ?? cfg.defaultHeadline;

  return (
    <GlassPanel
      nativeID={id}
      style={[
        styles.panel,
        {shadowColor: cfg.glow, shadowOpacity: cfg.glowOpacity},
        style,
      ]}
      testID={testID ?? dataTestID ?? id ?? 'status-hero'}>
      <View style={styles.row}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.iconRing, {backgroundColor: cfg.bg, borderColor: cfg.ring}]}>
          <StatusGlyph color={cfg.text} kind={cfg.glyph} size={GLYPH_SIZE} />
        </View>

        <View accessibilityLiveRegion="polite" style={styles.body}>
          <AppText style={[styles.heading, {color: cfg.text}]} testID="status-hero-heading">
            {heading}
          </AppText>
          {subline ? (
            <View style={styles.subline}>
              {renderSubline(subline)}
              {live ? (
                <View style={styles.liveWrap}>
                  <LiveIndicator variant="dot" />
                  <AppText style={styles.liveLabel} testID="status-hero-live">
                    Live
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {cta ? (
          <View style={styles.ctaWrap}>
            <StatusHeroCta
              label={cta.label}
              loading={cta.loading}
              onPress={cta.onClick}
            />
          </View>
        ) : null}
      </View>
    </GlassPanel>
  );
}

StatusHero.displayName = 'StatusHero';

/**
 * Render a `subline` ReactNode safely on native: bare strings/numbers (valid on
 * the web `<div>`) are wrapped in `<AppText>` so React Native does not throw on
 * a raw text child; element nodes are rendered as-is.
 */
function renderSubline(node: ReactNode): ReactNode {
  if (node === null || node === undefined || node === false) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return (
      <AppText style={styles.sublineText} testID="status-hero-subline">
        {node}
      </AppText>
    );
  }
  return node;
}

// ────────────────────────────────────────────────────────────────────────────
// CTA button — native stand-in for the shared web <Button variant="primary">.
// ────────────────────────────────────────────────────────────────────────────

interface StatusHeroCtaProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
}

function StatusHeroCta({label, onPress, loading}: StatusHeroCtaProps) {
  const isLoading = Boolean(loading);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isLoading}}
      disabled={isLoading}
      onPress={onPress}
      style={({pressed}) => [
        styles.cta,
        isLoading && styles.ctaDisabled,
        pressed && !isLoading && styles.ctaPressed,
      ]}
      testID="status-hero-cta">
      <RefreshGlyph
        color={colors.background}
        size={CTA_ICON_SIZE}
        spin={isLoading}
      />
      <AppText style={styles.ctaLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reduce-motion + spin helpers (shared with the LiveIndicator glyph port).
// ────────────────────────────────────────────────────────────────────────────

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function useSpin(active: boolean): Animated.Value {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      spin.setValue(0);
      return;
    }

    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 800,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [active, spin]);

  return spin;
}

// ────────────────────────────────────────────────────────────────────────────
// Status glyphs — View-drawn stand-ins for the lucide status icons. Static
// position/transparent-edge literals live in the StyleSheet; only the
// size-derived geometry + dynamic color stay inline (matching the LiveIndicator
// / BackgroundWorkSegment glyph pattern, keeping no-inline-styles quiet).
// ────────────────────────────────────────────────────────────────────────────

interface StatusGlyphProps {
  kind: StatusGlyphKind;
  size: number;
  color: string;
}

function StatusGlyph({kind, size, color}: StatusGlyphProps) {
  const stroke = Math.max(1.6, size * 0.09);

  if (kind === 'alert') {
    return <AlertGlyph color={color} size={size} stroke={stroke} />;
  }

  if (kind === 'wrench') {
    return <WrenchGlyph color={color} size={size} stroke={stroke} />;
  }

  // check / x / help all sit inside an outline circle (lucide *Circle icons).
  return (
    <View style={[styles.glyphBox, {height: size, width: size}]}>
      <View
        style={[
          styles.glyphCircle,
          {
            borderColor: color,
            borderRadius: size / 2,
            borderWidth: stroke,
            height: size,
            width: size,
          },
        ]}
      />
      {kind === 'check' ? (
        <CheckMark color={color} size={size} stroke={stroke} />
      ) : null}
      {kind === 'x' ? <XMark color={color} size={size} stroke={stroke} /> : null}
      {kind === 'help' ? (
        <QuestionMark color={color} size={size} stroke={stroke} />
      ) : null}
    </View>
  );
}

interface MarkProps {
  size: number;
  stroke: number;
  color: string;
}

// CheckCircle tick — the classic CSS checkmark: an L (right + bottom borders)
// rotated 45°, lifted slightly so it reads centered in the ring.
function CheckMark({size, stroke, color}: MarkProps) {
  return (
    <View
      style={[
        styles.checkMark,
        {
          borderColor: color,
          borderBottomWidth: stroke,
          borderRightWidth: stroke,
          height: size * 0.5,
          width: size * 0.28,
        },
      ]}
    />
  );
}

// XCircle cross — two rounded bars crossing at ±45°.
function XMark({size, stroke, color}: MarkProps) {
  const len = size * 0.52;
  return (
    <View style={[styles.markBox, {height: len, width: len}]}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: color,
            borderRadius: stroke,
            height: stroke,
            top: (len - stroke) / 2,
            transform: [{rotate: '45deg'}],
            width: len,
          },
        ]}
      />
      <View
        style={[
          styles.bar,
          {
            backgroundColor: color,
            borderRadius: stroke,
            height: stroke,
            top: (len - stroke) / 2,
            transform: [{rotate: '-45deg'}],
            width: len,
          },
        ]}
      />
    </View>
  );
}

// HelpCircle "?" — a rounded open-bottom hook (upper loop), a short stem, and a
// dot. An approximation of lucide's question mark, recognizable at ring scale.
function QuestionMark({size, stroke, color}: MarkProps) {
  return (
    <View style={[styles.markBox, {height: size * 0.58, width: size * 0.5}]}>
      <View
        style={[
          styles.absolute,
          {
            borderColor: color,
            borderLeftWidth: stroke,
            borderRightWidth: stroke,
            borderTopLeftRadius: size * 0.17,
            borderTopRightRadius: size * 0.17,
            borderTopWidth: stroke,
            height: size * 0.24,
            left: size * 0.08,
            top: 0,
            width: size * 0.34,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: color,
            height: size * 0.13,
            left: size * 0.25 - stroke / 2,
            top: size * 0.22,
            width: stroke,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: color,
            borderRadius: stroke,
            height: stroke,
            left: size * 0.25 - stroke / 2,
            top: size * 0.46,
            width: stroke,
          },
        ]}
      />
    </View>
  );
}

// AlertTriangle — a filled triangle (border-trick) with a dark exclamation, the
// universal warning sign. Filled (vs. the lucide outline) reads more clearly at
// ring scale; the dark "!" uses the panel background for contrast on the tint.
function AlertGlyph({size, stroke, color}: MarkProps) {
  return (
    <View style={[styles.glyphBox, {height: size, width: size}]}>
      <View
        style={[
          styles.triangle,
          {
            borderBottomColor: color,
            borderBottomWidth: size * 0.82,
            borderLeftWidth: size * 0.46,
            borderRightWidth: size * 0.46,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: colors.background,
            height: size * 0.24,
            left: size / 2 - stroke / 2,
            top: size * 0.36,
            width: stroke,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: colors.background,
            borderRadius: stroke,
            height: stroke,
            left: size / 2 - stroke / 2,
            top: size * 0.68,
            width: stroke,
          },
        ]}
      />
    </View>
  );
}

// Wrench — a diagonal rounded handle with an open "[" jaw at the upper end.
function WrenchGlyph({size, stroke, color}: MarkProps) {
  return (
    <View style={[styles.glyphBox, {height: size, width: size}]}>
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: color,
            borderRadius: size * 0.1,
            height: size * 0.64,
            left: size * 0.4,
            top: size * 0.2,
            transform: [{rotate: '45deg'}],
            width: size * 0.2,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            borderBottomWidth: stroke,
            borderColor: color,
            borderLeftWidth: stroke,
            borderRadius: size * 0.07,
            borderTopWidth: stroke,
            height: size * 0.34,
            left: size * 0.06,
            top: size * 0.08,
            transform: [{rotate: '45deg'}],
            width: size * 0.34,
          },
        ]}
      />
    </View>
  );
}

// RefreshCw — an outline ring with two arrowheads, spinning while loading
// (web `animate-spin`), honoring the OS reduce-motion preference.
function RefreshGlyph({
  size,
  color,
  spin,
}: {
  size: number;
  color: string;
  spin: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const spinValue = useSpin(spin && !reduceMotion);
  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const stroke = Math.max(1.4, size * 0.12);
  const head = size * 0.22;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.glyphBox, {height: size, transform: [{rotate}], width: size}]}>
      <View
        style={[
          styles.glyphCircle,
          {
            borderColor: color,
            borderRadius: size / 2,
            borderWidth: stroke,
            height: size,
            width: size,
          },
        ]}
      />
      <View
        style={[
          styles.refreshHead,
          {
            borderBottomColor: color,
            borderBottomWidth: head,
            borderLeftWidth: head * 0.6,
            borderRightWidth: head * 0.6,
            right: -head * 0.1,
            top: 0,
          },
        ]}
      />
      <View
        style={[
          styles.refreshHead,
          {
            borderBottomColor: color,
            borderBottomWidth: head,
            borderLeftWidth: head * 0.6,
            borderRightWidth: head * 0.6,
            bottom: 0,
            left: -head * 0.1,
            transform: [{rotate: '180deg'}],
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  absolute: {
    position: 'absolute',
  },
  bar: {
    left: 0,
    position: 'absolute',
  },
  body: {
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
    width: '100%',
  },
  checkMark: {
    backgroundColor: 'transparent',
    transform: [{translateY: -2}, {rotate: '45deg'}],
  },
  cta: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  ctaDisabled: {
    opacity: 0.48,
  },
  ctaLabel: {
    color: colors.background,
  },
  ctaPressed: {
    opacity: 0.82,
  },
  ctaWrap: {
    flexShrink: 0,
  },
  glyphBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glyphCircle: {
    position: 'absolute',
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    textAlign: 'center',
  },
  iconRing: {
    alignItems: 'center',
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    flexShrink: 0,
    height: RING_SIZE,
    justifyContent: 'center',
    width: RING_SIZE,
  },
  liveLabel: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  liveWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  markBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  panel: {
    elevation: 14,
    padding: 16,
    shadowOffset: {height: 0, width: 0},
    shadowRadius: 28,
  },
  refreshHead: {
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    height: 0,
    position: 'absolute',
    width: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: 16,
    width: '100%',
  },
  subline: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 4,
  },
  sublineText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  triangle: {
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    height: 0,
    width: 0,
  },
});
