// Native parity port of
// web/src/features/charging/components/cost-analysis/StatBox.tsx.
//
// StatBox is a small cost-analysis summary tile: a GlassPanel holding a leading
// icon chip and a content column (a truncated muted label, a large semibold
// value, and an optional muted sub line). Callers (CostSummaryCards) pass an
// `icon` node plus label/value/sub strings and an optional `glow` colour.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - `import type { ReactNode } from 'react'` (web L1) -> kept; `icon` stays a
//     `ReactNode` rendered inline so a converted parent can pass any native node
//     (matching the web contract — the icon source itself is a sibling file).
//   - `@/components/ui` GlassPanel (web L2) -> the native GlassPanel
//     (../../../../../components/ui/GlassPanel).
//   - GlassPanel `glow={glow ?? 'none'} hover className="p-4"` (web L14): the
//     `glow ?? 'none'` fallback is preserved verbatim. In web the glow only
//     manifests on hover; `hover` has no React Native equivalent (touch surface),
//     so — following the HighlightCard precedent — the resolved glow is applied
//     as a static, subtle colored shadow reusing the EXACT web hover-shadow
//     values (rgba(34,211,238 / 74,222,128 / 192,132,252, 0.1) at 15px blur).
//     `className="p-4"` -> styles.panel padding 16.
//   - the DOM `<div>`/`<p>` tree (web L15-22) -> React Native View/AppText:
//     `flex items-start gap-3` -> row + flex-start + gap 12; the icon chip
//     `rounded-lg bg-[var(--surface-2)] p-2` -> borderRadius 8 + surfaceRaised
//     (the established --surface-2 inner-chip mapping) + padding 8; `min-w-0
//     flex-1` -> flex 1 + minWidth 0; the label `truncate text-xs
//     text-[var(--text-muted)]` -> AppText numberOfLines={1} caption tone="muted";
//     the value `mt-0.5 text-lg font-semibold text-white` -> AppText marginTop 2
//     + fontSize 18 + weight semibold + default primary tone (the parity
//     text-white convention); the optional sub `mt-0.5 text-xs
//     text-[var(--text-muted)]` -> AppText marginTop 2 caption tone="muted",
//     guarded with a ternary (RN cannot render a bare string outside <Text>).
// See the .parity.json sidecar for the line-by-line source map.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

type GlowColor = 'cyan' | 'green' | 'purple' | 'none';

// ---- Props (web StatBoxProps L4-10) ----------------------------------------
// Reproduced verbatim so the CostSummaryCards call sites stay identical; `glow`
// keeps the web `'cyan' | 'green' | 'purple'` set (the 'none' fallback is
// applied at the GlassPanel boundary, exactly like the web L14 `glow ?? 'none'`).

interface StatBoxProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  glow?: 'cyan' | 'green' | 'purple';
}

export function StatBox({
  icon,
  label,
  value,
  sub,
  glow,
}: StatBoxProps): React.ReactElement {
  return (
    <GlassPanel style={[styles.panel, glowStyles[glow ?? 'none']]}>
      <View style={styles.row}>
        <View style={styles.iconBox}>{icon}</View>
        <View style={styles.content}>
          <AppText numberOfLines={1} tone="muted" variant="caption">
            {label}
          </AppText>
          <AppText style={styles.value} weight="semibold">
            {value}
          </AppText>
          {sub ? (
            <AppText style={styles.sub} tone="muted" variant="caption">
              {sub}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

StatBox.displayName = 'StatBox';

const PANEL_PADDING = 16; // web `p-4`
const ICON_RADIUS = 8; // web `rounded-lg`
const SUB_MARGIN_TOP = 2; // web `mt-0.5`
const VALUE_FONT_SIZE = 18; // web `text-lg`

const styles = StyleSheet.create({
  // web `flex items-start gap-3` (L15).
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  // web `p-4` (L14).
  panel: {
    padding: PANEL_PADDING,
  },
  // web `rounded-lg bg-[var(--surface-2)] p-2` (L16).
  iconBox: {
    borderRadius: ICON_RADIUS,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.sm,
  },
  // web `min-w-0 flex-1` (L17).
  content: {
    flex: 1,
    minWidth: 0,
  },
  // web value `mt-0.5 text-lg font-semibold text-white` (L19).
  value: {
    marginTop: SUB_MARGIN_TOP,
    fontSize: VALUE_FONT_SIZE,
  },
  // web sub `mt-0.5 text-xs text-[var(--text-muted)]` (L20).
  sub: {
    marginTop: SUB_MARGIN_TOP,
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
