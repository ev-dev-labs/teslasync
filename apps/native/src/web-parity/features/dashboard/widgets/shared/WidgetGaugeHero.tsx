// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx.
//
// The web file is a shared, presentational dashboard-widget building block: a
// centered radial gauge "hero" with an optional row of small stat pairs and an
// optional children slot. It has no data fetching, i18n, or browser-only
// behaviour — it just lays out a <RadialGauge> plus formatted stats.
//
// This native port preserves the contract 1:1:
//   - GaugeHeroConfig / GaugeHeroStat / WidgetGaugeHeroProps (web L4-23) are
//     mirrored verbatim (same fields, optionality, and exported surface — the
//     two value/stat interfaces are exported, the props interface stays local).
//   - the compact-size rule `const size = compact ? 70 : 100` (web L26-28).
//   - the gauge render with identical props (web L32-39).
//   - the stats row gated on `!compact && stats && stats.length > 0`
//     (web L41-55), each stat showing a secondary-tone label and a
//     primary-tone semibold value with an optional secondary-tone unit suffix.
//   - the trailing `!compact && children` slot (web L57).
//
// DOM/web-only dependencies reduced explicitly and documented in the
// .parity.json sidecar:
//   - web L2 `import { RadialGauge } from '@/components/charts'`: the recharts
//     barrel is DOM-only -> the already-ported native web-parity RadialGauge
//     (positioned native View arc segments). Imported directly from its module
//     (matching the existing DriveScoreWidget native reproduction) to avoid
//     pulling the chart barrel's recharts wrappers.
//   - web L31/42/44 `<div className="flex …">` + L45-49 `<span className="…">`:
//     Tailwind flex/typography utilities -> React Native <View>/StyleSheet flex
//     layout + <AppText> tone/variant/weight props. Tailwind class -> native
//     mapping: `flex flex-col items-center justify-center gap-2` -> column,
//     centered, gap 8; `flex flex-wrap items-center justify-center gap-x-4
//     gap-y-1` -> row, wrap, centered, columnGap 20 / rowGap 4; `min-w-0
//     flex-col items-center text-center` -> centered column, minWidth 0;
//     `truncate` -> numberOfLines={1}; `text-xs`/`text-sm` -> caption/body
//     sizing; `font-semibold`/`font-normal` -> weight; `text-[var(--text-…)]`
//     -> tone="secondary"/"primary" (the same CSS-var-backed token colours);
//     `ml-0.5` unit gap -> a leading space inside the unit text.
//
// The styles mirror the existing native WidgetGaugeHero reproduction embedded
// in web-parity/features/dashboard/widgets/DriveScoreWidget.tsx so the two
// stay visually identical.

import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../../components/charts/RadialGauge';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

export interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

export interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetGaugeHeroProps {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}

export function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: WidgetGaugeHeroProps) {
  // Compact size never grows; the standard size renders at 100. On web the
  // standard size shrinks further on narrow widgets via container queries,
  // which have no native equivalent — the fixed 100 matches the web default
  // (web L26-28).
  const size = compact ? 70 : 100;

  return (
    <View style={styles.root}>
      <RadialGauge
        color={gauge.color}
        label={gauge.label}
        max={gauge.max}
        size={size}
        unit={gauge.unit}
        value={gauge.value}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.stat}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.statValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.statUnit}
                    tone="secondary"
                    variant="caption">
                    {` ${stat.unit}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  stat: {
    alignItems: 'center',
    minWidth: 0,
  },
  statLabel: {
    textAlign: 'center',
  },
  statsRow: {
    alignItems: 'center',
    columnGap: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.xs,
  },
  statUnit: {
    fontWeight: '400',
  },
  statValue: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
