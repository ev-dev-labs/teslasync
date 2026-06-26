// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetBigNumber.tsx.
//
// The web component is the shared dashboard "big number" presenter: a centered
// column with an (optionally animated) value, an optional unit, an uppercase
// label, a subtitle, and a status badge. It is a pure presentational component,
// so the native port stays hook-free for rendering and reproduces the same
// layout/visual intent with React Native primitives + theme tokens.
//
// Web dependencies that have no DOM in native are inlined here so the shared
// component remains self-contained (mirroring the sibling ProjectedRangeWidget
// port that inlined the same three helpers):
//   • @/components/data-display AnimatedNumber -> a local requestAnimationFrame
//     count-up (ease-out quad, 1-(1-p)^2, from 0 to `value` over `duration`s)
//     that renders fmtNumber(display, decimals) with tabular-nums and honours
//     the OS reduce-motion setting (jump straight to the final value).
//   • @/components/ui Badge -> a local native pill (success/warning/danger/
//     neutral) backed by the theme surface/foreground tokens.
//   • @/lib/cn -> dropped; React Native has no class names. The web
//     `cn('text-3xl font-bold', valueColor)` merge becomes a StyleSheet style +
//     a dynamic `{color: valueColor}` override.
//
// Tailwind -> native mapping: text-3xl font-bold -> 30px/bold, text-lg
// text-[var(--text-secondary)] unit -> 18px secondary tone, text-[10px]
// text-[var(--text-muted)] uppercase tracking-wider label -> 10px muted
// uppercase +letterSpacing, text-xs text-[var(--text-secondary)] subtitle ->
// 12px secondary caption, the null `text-[var(--text-muted)]` value -> muted.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, or web
// UI-kit modules are imported into the native output.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

// The web AnimatedNumber formats through @/lib/numberFormat, which reads a
// module-global locale set by useSettings (default "en-US"). Native has no such
// mutable singleton, so the locale is an optional prop defaulting to the same
// "en-US" default; locale-aware callers can thread their useSettings locale.
const DEFAULT_LOCALE = 'en-US';

// web @/lib/numberFormat safeNumber: nullish/NaN/Infinity collapse to 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/* ─── reduce-motion-aware count-up (web @/components/data-display) ────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // Reduce-motion query is best-effort; default to animating.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// web AnimatedNumber: a requestAnimationFrame loop eases (ease-out quad,
// 1-(1-p)^2) from 0 to `value` over `duration` seconds, rendering
// fmtNumber(display, decimals) with tabular-nums. Reduced motion jumps straight
// to the final value (same final output).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  locale,
  style,
  testID,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  locale: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }

    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [decimals, duration, reduceMotion, value]);

  return (
    <AppText style={[styles.tabularNums, style]} testID={testID} weight="bold">
      {fmtNumber(display, decimals, locale)}
    </AppText>
  );
}

/* ─── @/components/ui Badge (pill, size="sm") ────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
};

function Badge({
  variant = 'neutral',
  children,
  testID,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  testID?: string;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]} testID={testID}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

// web ./shared WidgetBigNumber badgeVariantMap (error -> danger).
const badgeVariantMap: Record<
  'success' | 'warning' | 'error' | 'neutral',
  BadgeVariant
> = {
  error: 'danger',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
};

export interface WidgetBigNumberProps {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'error' | 'neutral';
  };
  /**
   * Native color string for the value. Mirrors the web `valueColor` Tailwind
   * class prop (default web `text-white` -> native `colors.textPrimary`).
   */
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
  /** Optional locale for value formatting; defaults to "en-US" (web default). */
  locale?: string;
  testID?: string;
}

export function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = colors.textPrimary,
  nullDisplay = '—',
  animated = true,
  locale = DEFAULT_LOCALE,
  testID,
}: WidgetBigNumberProps) {
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.row}>
        {value !== null ? (
          animated ? (
            <AnimatedNumber
              locale={locale}
              style={[styles.value, {color: valueColor}]}
              value={value}
            />
          ) : (
            <AppText
              style={[styles.value, styles.tabularNums, {color: valueColor}]}
              weight="bold">
              {String(value)}
            </AppText>
          )
        ) : (
          <AppText style={[styles.value, styles.valueNull]} weight="bold">
            {nullDisplay}
          </AppText>
        )}
        {unit ? (
          <AppText style={styles.unit} tone="secondary">
            {unit}
          </AppText>
        ) : null}
      </View>

      {label ? (
        <AppText style={styles.label} tone="muted">
          {label}
        </AppText>
      ) : null}

      {subtitle ? (
        <AppText style={styles.subtitle} tone="secondary" variant="caption">
          {subtitle}
        </AppText>
      ) : null}

      {badge ? (
        <Badge variant={badgeVariantMap[badge.variant]}>{badge.text}</Badge>
      ) : null}
    </View>
  );
}

WidgetBigNumber.displayName = 'WidgetBigNumber';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  root: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  row: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  subtitle: {
    fontSize: 12,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 18,
  },
  value: {
    fontSize: 30,
    lineHeight: 36,
  },
  valueNull: {
    color: colors.textMuted,
  },
});
