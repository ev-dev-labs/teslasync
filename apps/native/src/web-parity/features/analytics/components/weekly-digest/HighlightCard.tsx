// Native parity port of
// web/src/features/analytics/components/weekly-digest/HighlightCard.tsx.
//
// HighlightCard is a generic weekly-digest summary tile: a GlassPanel column
// holding an icon+label row, a large bold value, an optional trend "change" row
// (a TrendingUp/TrendingDown icon + text, coloured emerald/red by direction) and
// an optional muted subtitle. Callers (SummaryHeroCards) pass `icon`, `label`,
// `value`, optional `change`/`subtitle` and a semantic `color`.
//
// Web -> native mapping (conversion-contract rules 4-7):
//   - lucide-react TrendingUp / TrendingDown (DOM SVG) -> SemanticIcon
//     trendUp/trendDown glyphs ('UP'/'DN') rendered inline via AppText, tinted
//     the same emerald-400 / red-400 as the surrounding change text.
//   - @/components/ui GlassPanel -> the native GlassPanel.
//   - @/lib/cn `cn(...)` -> dropped; RN composes styles with StyleSheet + style
//     arrays instead of className strings. The web `className` passthrough
//     becomes a `style?: StyleProp<ViewStyle>` prop forwarded to the panel.
//   - the `icon: React.ReactNode` prop stays a `ReactNode` rendered inline, so a
//     converted parent can pass any native node (matching the web contract).
//   - text colours map to AppText tones: `text-[var(--text-secondary)]` ->
//     tone="secondary", `text-white` -> the default primary tone (the existing
//     parity convention), `text-[var(--text-muted)]` -> tone="muted".
//   - GlassPanel's `glow` prop: in web the glow only manifests on hover, and
//     HighlightCard never enables hover, so it is visually inert at rest. The
//     glowMap is preserved verbatim and, because RN has no hover, the resolved
//     glow is applied as a static, subtle colored shadow reusing the EXACT web
//     hover-shadow values (rgba(34,211,238/74,222,128/192,132,252, 0.1), 15px).
// See the .parity.json sidecar for the line-by-line source map.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

// ---- Props (web HighlightCardProps L5-13) -----------------------------------
// `className` (L12) -> `style` (the native passthrough); every other field is
// reproduced verbatim so the SummaryHeroCards call sites stay identical.

type HighlightColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';
type GlowColor = 'cyan' | 'green' | 'purple' | 'none';

interface HighlightCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  change?: {value: string; positive: boolean};
  subtitle?: string;
  color?: HighlightColor;
  style?: StyleProp<ViewStyle>;
}

// web glowMap (L15-21) preserved verbatim: cyan/green/purple keep their glow,
// amber/red collapse to 'none'.
const glowMap: Record<HighlightColor, GlowColor> = {
  cyan: 'cyan',
  green: 'green',
  purple: 'purple',
  amber: 'none',
  red: 'none',
};

// web lucide TrendingUp / TrendingDown (L1) -> SemanticIcon trend glyphs.
const TREND_UP_GLYPH = getSemanticIconDefinition('trendUp').glyph;
const TREND_DOWN_GLYPH = getSemanticIconDefinition('trendDown').glyph;

export function HighlightCard({
  icon,
  label,
  value,
  change,
  subtitle,
  color = 'cyan',
  style,
}: HighlightCardProps): React.ReactElement {
  const glow = glowMap[color] ?? 'none';

  return (
    <GlassPanel style={[styles.panel, glowStyles[glow], style]}>
      <View style={styles.labelRow}>
        {icon}
        <AppText tone="secondary" style={styles.label}>
          {label}
        </AppText>
      </View>

      <AppText style={styles.value}>{value}</AppText>

      {change ? (
        <View style={styles.changeRow}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.changeGlyph,
              change.positive ? styles.changePositive : styles.changeNegative,
            ]}>
            {change.positive ? TREND_UP_GLYPH : TREND_DOWN_GLYPH}
          </AppText>
          <AppText
            style={[
              styles.changeText,
              change.positive ? styles.changePositive : styles.changeNegative,
            ]}>
            {change.value}
          </AppText>
        </View>
      ) : null}

      {subtitle ? (
        <AppText tone="muted" style={styles.subtitle}>
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

HighlightCard.displayName = 'HighlightCard';

const styles = StyleSheet.create({
  // web `flex flex-col gap-2 p-5` (L35) -> column (RN default) + gap 8 + pad 20.
  panel: {
    padding: 20,
    gap: 8,
  },
  // web label span `flex items-center gap-2 text-sm text-secondary` (L37).
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
  },
  // web value `text-2xl font-bold tracking-tight text-white` (L41).
  value: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  // web change span `flex items-center gap-1 text-xs font-medium` (L45-49).
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // web TrendingUp/Down `h-3.5 w-3.5` (L52/L54) rendered as a small glyph.
  changeGlyph: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  changeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  // web `text-emerald-400` (L48).
  changePositive: {
    color: '#34d399',
  },
  // web `text-red-400` (L48).
  changeNegative: {
    color: '#f87171',
  },
  // web subtitle `text-xs text-[var(--text-muted)]` (L60).
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});

// web GlassPanel hover glow shadows (glowClasses) reproduced statically because
// RN has no hover: `0 0 15px rgba(...,0.1)` -> shadowRadius 15 + shadowOpacity
// 0.1 at the exact web colours; 'none' adds nothing.
const glowStyles = StyleSheet.create<Record<GlowColor, ViewStyle>>({
  cyan: {
    shadowColor: '#22d3ee',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: {width: 0, height: 0},
  },
  green: {
    shadowColor: '#4ade80',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: {width: 0, height: 0},
  },
  purple: {
    shadowColor: '#c084fc',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: {width: 0, height: 0},
  },
  none: {},
});
