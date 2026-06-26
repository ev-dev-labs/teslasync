// Native parity port of
// web/src/features/analytics/components/review/TitleSlide.tsx.
//
// The opening "Year in Review" slide: a centred 🚗 glyph, the animated year, the
// "Year in Review" subtitle, and the vehicle display name.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - framer-motion motion.div/h1/p (scale/translate/opacity entrances) ->
//     rendered in their settled end-state with React Native primitives; the
//     final centred layout (visual intent) is preserved.
//   - `@/components/data-display` AnimatedNumber -> inlined native AnimatedNumber
//     that renders the settled value through `fmtNumber` (same locale-separated
//     output the web count-up settles on, e.g. the year as "2,024").
//   - `@/lib/numberFormat` fmtNumber -> inlined native-safe formatter.
//   - react-i18next useTranslation -> useNativeTranslation() fallback shim.
//   - `import type { YearReview } from '@/api/types'` -> native parity type.

import React from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {YearReview} from '../../../../api/types';

/* ─── inline shims (react-i18next + data-display + numberFormat) ───────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safe(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safe(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

// Settled native equivalent of the web count-up AnimatedNumber (the count-up is
// purely decorative; the final value is the meaningful visual).
function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  return (
    <AppText style={style} weight="bold">
      {prefix}
      {fmtNumber(value, decimals)}
      {suffix}
    </AppText>
  );
}

interface Props {
  data: YearReview;
}

export function TitleSlide({data}: Props) {
  const t = useNativeTranslation();

  return (
    <View style={styles.container}>
      <AppText style={styles.emoji}>🚗</AppText>
      <AnimatedNumber decimals={0} style={styles.year} value={data.year} />
      <AppText style={styles.subtitle} tone="secondary">
        {t('yearReview.title', 'Year in Review')}
      </AppText>
      <AppText style={styles.vehicle} tone="secondary">
        {data.vehicle.display_name}
      </AppText>
    </View>
  );
}

TitleSlide.displayName = 'TitleSlide';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 64,
    lineHeight: 72,
    marginBottom: spacing.lg,
  },
  subtitle: {
    fontSize: 22,
    lineHeight: 28,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  vehicle: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  year: {
    color: colors.textPrimary,
    fontSize: 56,
    lineHeight: 64,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
