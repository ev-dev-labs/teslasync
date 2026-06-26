// Native parity port of
// web/src/features/analytics/components/review/SavingsSlide.tsx.
//
// The "You saved" slide of the Year in Review story: a 💰 emoji, a "You saved"
// eyebrow, the headline gas-savings dollar amount (an animated count-up), a
// "vs. driving a gas car" sub-line, and a max-w-xs comparison block with a full
// red "Gas would cost" bar, a proportional emerald "Electric cost" bar, and a
// "cups of coffee" savings note.
//
// React Native has no DOM, framer-motion, lucide-react, or Tailwind, so the web
// tree is reproduced with native View/AppText layers that preserve the same
// data, copy, colours, and proportional intent:
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/data-display AnimatedNumber -> an inlined native AnimatedNumber
//     that reproduces the exact ease-out-quad count-up (display 0 -> value over
//     `duration` seconds) using requestAnimationFrame + Date.now() (React Native
//     has no performance.now()), with the same prefix/suffix/decimals/format
//     contract. The count-up is cancelled on unmount.
//   - @/components/motion framer-motion `motion.span`/`motion.p`/`motion.div`
//     entrance animations (spring scale/rotate, fade + slide-up, stagger delays)
//     have no native equivalent here; following the established conversion idiom
//     (OverviewTab <FadeIn>, DriveScore framer-motion) they render in their final
//     rest state (the animations' end state), which is visually identical at
//     rest. The headline AnimatedNumber count-up is preserved.
//   - lucide-react Fuel / Zap / DollarSign 16px icons -> small colour-coded dot
//     markers. The native SemanticIcon primitive carries fixed tones (fuel/bolt =
//     warning amber, dollarSign = success green) that would drop the source's
//     deliberate red=cost / emerald=savings coding, so the exact red-400 /
//     emerald-400 hues are used verbatim (the same idiom OverviewTab used for the
//     CB-safe CHART_COLORS palette).
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every yearReview.* key verbatim and reproduces i18next's `{{var}}`
//     interpolation for the savingsNote default value.
//   - Tailwind utility colours map to exact hex/rgba constants (red-400,
//     emerald-400 with the /80, /70, /60 opacity variants, white/[0.06] track);
//     text-secondary / text-muted map to the shared theme tokens.
//
// No DOM, framer-motion, lucide-react, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useRef, useState} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {spacing} from '../../../../../theme/tokens';
import type {YearReview} from '../../../../api/types';

interface Props {
  data: YearReview;
}

/* ─── Source Tailwind colours (verbatim hues, theme tokens for text) ──────── */

const RED_400 = '#f87171';
const RED_400_70 = 'rgba(248, 113, 113, 0.7)';
const RED_400_60 = 'rgba(248, 113, 113, 0.6)';
const EMERALD_400 = '#34d399';
const EMERALD_400_80 = 'rgba(52, 211, 153, 0.8)';
const EMERALD_400_70 = 'rgba(52, 211, 153, 0.7)';
const EMERALD_400_60 = 'rgba(52, 211, 153, 0.6)';
const TRACK_BG = 'rgba(255, 255, 255, 0.06)';

/* ─── Native i18n fallback (mirrors i18next default-value interpolation) ───── */

type TInterpolation = {defaultValue: string} & Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every yearReview.* key verbatim. The object form reproduces
// i18next's `{{var}}` interpolation for the savingsNote message.
function t(_key: string, fallback: string | TInterpolation): string {
  if (typeof fallback === 'string') {
    return fallback;
  }
  const {defaultValue, ...vars} = fallback;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  });
}

/* ─── Numeric helpers (mirror web @/lib/numberFormat + null safety) ────────── */

// Nullish / non-finite -> 0, matching the web charts `safe` helper.
function safe(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber; en-US grouping stands in for the
// not-yet-ported global locale. AnimatedNumber passes an explicit precision.
function fmtNumber(v: unknown, decimals = 0): string {
  const n = safe(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/* ─── Inlined native AnimatedNumber (web @/components/data-display) ─────────── */

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

// Reproduces the web AnimatedNumber ease-out-quad count-up from 0 to `value`
// over `duration` seconds. Uses requestAnimationFrame + Date.now() because
// React Native has no performance.now(); the frame is cancelled on unmount.
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps): React.ReactElement {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
      // ease-out quad
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
  }, [value, duration]);

  return (
    <AppText style={style} weight="bold">
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ─── Colour-coded icon-slot stand-in for lucide Fuel / Zap / DollarSign ───── */

function IconDot({color}: {color: string}): React.ReactElement {
  return <View style={[styles.iconDot, {backgroundColor: color}]} />;
}

export function SavingsSlide({data}: Props): React.ReactElement {
  const gasSavings = safe(data.gas_savings);
  const totalChargingCost = safe(data.total_charging_cost);
  const gasCostEquiv = gasSavings + totalChargingCost;

  const electricPct =
    gasCostEquiv > 0
      ? Math.round((totalChargingCost / gasCostEquiv) * 100)
      : 0;

  return (
    <View style={styles.root}>
      <AppText style={styles.emoji}>💰</AppText>

      <AppText style={styles.eyebrow} tone="secondary">
        {t('yearReview.youSaved', 'You saved')}
      </AppText>

      <AnimatedNumber
        value={gasSavings}
        duration={1.5}
        prefix="$"
        style={styles.headline}
      />

      <AppText style={styles.subline} tone="muted">
        {t('yearReview.vsGas', 'vs. driving a gas car')}
      </AppText>

      {/* Comparison bars */}
      <View style={styles.bars}>
        <View>
          <View style={styles.barHeader}>
            <IconDot color={RED_400_70} />
            <AppText style={styles.barLabel} tone="secondary" variant="caption">
              {t('yearReview.gasCost', 'Gas would cost')}
            </AppText>
            <AppText style={styles.gasValue} variant="caption" weight="semibold">
              ${Math.round(gasCostEquiv)}
            </AppText>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, styles.fillFull, {backgroundColor: RED_400_60}]} />
          </View>
        </View>

        <View>
          <View style={styles.barHeader}>
            <IconDot color={EMERALD_400_70} />
            <AppText style={styles.barLabel} tone="secondary" variant="caption">
              {t('yearReview.electricCost', 'Electric cost')}
            </AppText>
            <AppText
              style={styles.electricValue}
              variant="caption"
              weight="semibold">
              ${Math.round(totalChargingCost)}
            </AppText>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {backgroundColor: EMERALD_400_60, width: `${electricPct}%`},
              ]}
            />
          </View>
        </View>

        <View style={styles.note}>
          <IconDot color={EMERALD_400} />
          <AppText style={styles.noteText} variant="caption">
            {t('yearReview.savingsNote', {
              cupsOfCoffee: Math.round(gasSavings / 5),
              defaultValue: "That's {{cupsOfCoffee}} cups of coffee!",
            })}
          </AppText>
        </View>
      </View>
    </View>
  );
}

SavingsSlide.displayName = 'SavingsSlide';

const styles = StyleSheet.create({
  bars: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 320,
    width: '100%',
  },
  barHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  barLabel: {
    flexShrink: 1,
  },
  electricValue: {
    color: EMERALD_400,
    marginLeft: 'auto',
  },
  emoji: {
    fontSize: 60,
    lineHeight: 68,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontSize: 18,
    letterSpacing: 1.2,
    lineHeight: 24,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  fill: {
    borderRadius: 999,
    height: '100%',
  },
  fillFull: {
    width: '100%',
  },
  gasValue: {
    color: RED_400,
    marginLeft: 'auto',
  },
  headline: {
    color: EMERALD_400,
    fontSize: 60,
    lineHeight: 68,
  },
  iconDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  note: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  noteText: {
    color: EMERALD_400_80,
  },
  root: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  subline: {
    marginBottom: spacing.xl,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  track: {
    backgroundColor: TRACK_BG,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
});
