// Native parity port of
// web/src/features/system/components/status/StatusPageSkeleton.tsx.
//
// StatusPageSkeleton is the layout-shaped placeholder shown during the initial
// fetch of the System Status page. It mirrors the real page's vertical rhythm
// (hero -> chip bar -> 6 health rows -> action items -> resources -> 4 accordion
// stubs) so there is no layout shift once data loads. (web L1-10 doc comment.)
//
// Web -> native adaptations (documented in the sidecar):
//   - web `Skeleton` from @/components/feedback/Skeleton (web L12) -> an inline
//     STATIC <Skeleton> placeholder box. The web primitive pulses via the
//     Tailwind `animate-pulse` utility (which honours prefers-reduced-motion);
//     a native Animated.loop would leak under jest --detectOpenHandles, so the
//     box is rendered static — the BackendStatusSection / LiveControls
//     precedent in this same directory. The full prop contract is preserved:
//     `width` (px-string like "56px" or percentage like "60%" or a number),
//     `height` (number, default 16), and `rounded` (rounded-full -> a pill /
//     circle via borderRadius = height / 2; the default `rounded` Tailwind
//     class -> 4px). `lines` is part of the web API but unused by this source,
//     so it is intentionally not reproduced.
//   - web `GlassPanel` from @/components/ui (web L13) -> the shared CONVERTED
//     native GlassPanel (imported), with the per-panel Tailwind padding
//     (`p-5`/`p-3`/`p-4`) passed through as a `padding` style.
//   - the root `<div>` (web L21-27) -> a React Native <View>. Its
//     accessibility contract is preserved natively: `role="status"` +
//     `aria-busy="true"` -> accessibilityRole="progressbar" +
//     accessibilityState={{busy: true}}; `aria-label` -> accessibilityLabel
//     ("Loading system status"); `data-testid` -> testID
//     ("status-page-skeleton"). React Native has no 'status' a11y role, so
//     'progressbar' (the PageLoader precedent for a busy/loading region) is the
//     closest analog while the busy state + label carry the same intent.
//   - all Tailwind layout utilities (`space-y-*` vertical rhythm, `flex`/`gap`
//     rows, `overflow-hidden`, `max-w-3xl mx-auto`, `flex-1`) -> StyleSheet
//     flex/gap/maxWidth/alignSelf equivalents. The English a11y label is the
//     only copy; the web source wires no i18n, so none is added.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web ui
// components are imported — only react-native primitives + the shared native
// GlassPanel + theme tokens.

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

// web Skeleton accepts width as a px-string ("56px"), a percentage ("60%") or a
// number; normalise to a React Native DimensionValue. Undefined -> full width
// (the web default of `width ?? '100%'`).
function toDimension(value: number | string | undefined): DimensionValue {
  if (value == null) {
    return '100%';
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value.endsWith('%')) {
    return value as DimensionValue;
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : '100%';
}

interface SkeletonProps {
  width?: number | string;
  height?: number;
  rounded?: boolean;
  style?: StyleProp<ViewStyle>;
}

// web @/components/feedback/Skeleton -> a static placeholder box (no pulse).
function Skeleton({width, height = 16, rounded, style}: SkeletonProps) {
  return (
    <View
      style={[
        styles.skeleton,
        {
          width: toDimension(width),
          height,
          borderRadius: rounded ? height / 2 : 4,
        },
        style,
      ]}
    />
  );
}

// web SkeletonRow (L15-17): a full-width Skeleton, default height 44.
function SkeletonRow({height = 44}: {height?: number}) {
  return <Skeleton height={height} width="100%" />;
}

export function StatusPageSkeleton() {
  return (
    <View
      style={styles.root}
      accessibilityRole="progressbar"
      accessibilityState={{busy: true}}
      accessibilityLabel="Loading system status"
      testID="status-page-skeleton">
      {/* Hero */}
      <GlassPanel style={styles.heroPanel}>
        <View style={styles.heroRow}>
          <Skeleton width="56px" height={56} rounded />
          <View style={styles.heroBody}>
            <Skeleton height={24} width="60%" />
            <Skeleton height={14} width="40%" />
          </View>
          <Skeleton width="120px" height={36} />
        </View>
      </GlassPanel>

      {/* Chip bar */}
      <View style={styles.chipBar}>
        {Array.from({length: 8}).map((_, i) => (
          <Skeleton key={i} width="92px" height={32} rounded />
        ))}
      </View>

      {/* Health rows */}
      <GlassPanel style={styles.healthPanel}>
        <Skeleton height={18} width="80px" style={styles.titleSpacer} />
        {Array.from({length: 6}).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </GlassPanel>

      {/* Action items + Resources */}
      <GlassPanel style={styles.actionsPanel}>
        <Skeleton height={18} width="180px" />
        <SkeletonRow height={32} />
        <SkeletonRow height={32} />
      </GlassPanel>

      <GlassPanel style={styles.resourcesPanel}>
        <Skeleton height={18} width="120px" />
        {Array.from({length: 5}).map((_, i) => (
          <SkeletonRow key={i} height={28} />
        ))}
      </GlassPanel>

      {/* Accordion stubs */}
      {Array.from({length: 4}).map((_, i) => (
        <GlassPanel key={i} style={styles.accordionPanel}>
          <View style={styles.accordionRow}>
            <Skeleton width="20px" height={20} />
            <View style={styles.accordionBody}>
              <Skeleton height={16} width="40%" />
              <Skeleton height={12} width="60%" style={styles.subSpacer} />
            </View>
            <Skeleton width="60px" height={24} />
          </View>
        </GlassPanel>
      ))}
    </View>
  );
}

StatusPageSkeleton.displayName = 'StatusPageSkeleton';

const styles = StyleSheet.create({
  // space-y-5 max-w-3xl mx-auto: 20px vertical rhythm, 768px max width, centred.
  root: {
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
  },
  // Hero GlassPanel p-5.
  heroPanel: {
    padding: spacing.lg,
  },
  // flex items-start gap-4.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  // flex-1 space-y-2.
  heroBody: {
    flex: 1,
    gap: spacing.sm,
  },
  // flex gap-2 overflow-hidden.
  chipBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  // Health GlassPanel p-3 space-y-1.
  healthPanel: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  // Title Skeleton mb-2 (8px below, on top of the panel's 4px gap).
  titleSpacer: {
    marginBottom: spacing.sm,
  },
  // Action items GlassPanel p-4 space-y-2.
  actionsPanel: {
    padding: 16,
    gap: spacing.sm,
  },
  // Resources GlassPanel p-4 space-y-3.
  resourcesPanel: {
    padding: 16,
    gap: spacing.md,
  },
  // Accordion stub GlassPanel p-5.
  accordionPanel: {
    padding: spacing.lg,
  },
  // flex items-center gap-3.
  accordionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // flex-1 column holding the title + subtitle skeletons.
  accordionBody: {
    flex: 1,
  },
  // Subtitle Skeleton mt-1 (4px).
  subSpacer: {
    marginTop: spacing.xs,
  },
});

export default StatusPageSkeleton;
