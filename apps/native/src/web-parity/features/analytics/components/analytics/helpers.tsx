// Native parity port of
// web/src/features/analytics/components/analytics/helpers.tsx.
//
// Two tiny presentational helpers shared across the analytics tabs:
//   - `MetricSkeleton` — a loading placeholder card (used by HeroGauges to
//     render a 6-up grid of shimmering metric tiles while data loads).
//   - `SectionTitle` — the small bold heading rendered above every analytics
//     chart panel (BatteryTab, DrivingTab, ChargingTab, OverviewTab, …).
//
// The web source pulls three modules; native-safe mapping (contract rules 4/5/6):
//   - `ReactNode` type (L1) is framework-agnostic and kept verbatim so
//     `SectionTitle` still accepts arbitrary children (in practice always an
//     i18n string).
//   - `GlassPanel` from `@/components/ui` (L2) -> the existing native shared
//     `components/ui/GlassPanel` primitive; the web `className="p-3"` (12px
//     padding) becomes a StyleSheet `padding: 12`.
//   - `Skeleton` from `@/components/feedback` (L3) has no native-parity port
//     (same as the sibling FleetTelemetryHealth port), so each `<Skeleton
//     width="60%" height={12} />` becomes a decorative fixed-size
//     `SkeletonBlock` View — muted raised surface, web `rounded` (4px) corners,
//     flagged hidden from a11y. The web `animate-pulse` shimmer is dropped (no
//     CSS keyframes in RN); the static muted block preserves the visual intent.
//     `width` is forwarded as a DimensionValue so the original "60%"/"40%"
//     percentages render identically; the second tile keeps its `mt-2` (8px)
//     top gap as `marginTop: 8`.
//   - The `<span className="text-sm font-semibold text-[var(--text-primary)]">`
//     (L16) maps to `AppText` (tone primary, weight semibold) with a text-sm
//     (14px / 20px line-height) style override — preserving size, weight and
//     the --text-primary colour token.
import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// ── SkeletonBlock (web <Skeleton/> not ported; decorative fixed-size block) ──
function SkeletonBlock({
  width,
  height,
  style,
}: {
  width: DimensionValue;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, {width, height}, style]}
    />
  );
}

export function MetricSkeleton() {
  return (
    <GlassPanel style={styles.panel}>
      <SkeletonBlock width="60%" height={12} />
      <SkeletonBlock width="40%" height={24} style={styles.skeletonSpaced} />
    </GlassPanel>
  );
}

export function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText tone="primary" weight="semibold" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 12, // p-3
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4, // Tailwind `rounded`
  },
  skeletonSpaced: {
    marginTop: 8, // mt-2
  },
  sectionTitle: {
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
});
