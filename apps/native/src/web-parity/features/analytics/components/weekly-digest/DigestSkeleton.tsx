// Native parity port of
// web/src/features/analytics/components/weekly-digest/DigestSkeleton.tsx.
//
// The web module is the Weekly Digest loading placeholder: a FadeIn-wrapped
// `space-y-6` column of three GlassPanels — a 2-line text Skeleton, a
// responsive 1/2/3-column grid of six height-80 Skeleton tiles, and a single
// height-260 chart Skeleton. It is pure presentation: no props, state, data,
// i18n, or unit handling.
//
// Native-safe substitutions (rules 4/5), documented in the parity sidecar:
//   • @/components/ui GlassPanel -> the already-ported native GlassPanel
//     (rounded, bordered, translucent surface). The web `p-6` (24px) padding is
//     supplied through the panel `style` prop.
//   • @/components/feedback Skeleton -> the already-ported native Skeleton
//     (animated pulse bar). The `lines` and `height` props are passed verbatim.
//   • @/components/motion FadeIn -> the already-ported native FadeIn. The web
//     `space-y-6` (24px) vertical rhythm becomes the FadeIn container `gap: 24`.
//   • The CSS grid (`grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3`)
//     -> a flex-wrap row (gap 16 == gap-4, padding 24 == p-6) of
//     flexGrow/flexBasis cells that wrap to ~2-up on a phone, reproducing the
//     responsive 1/2/3-column intent (the SummaryStatsRow precedent).
// No DOM elements, Tailwind classes, Recharts, Leaflet, framer-motion,
// react-dom, or web UI-kit modules are imported into the native output.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {Skeleton} from '../../../../components/feedback/Skeleton';
import {FadeIn} from '../../../../components/motion/FadeIn';

export function DigestSkeleton() {
  return (
    <FadeIn style={styles.container}>
      <GlassPanel style={styles.panel}>
        <Skeleton lines={2} />
      </GlassPanel>
      <GlassPanel style={styles.gridPanel}>
        {Array.from({length: 6}).map((_, i) => (
          <View key={i} style={styles.gridCell}>
            <Skeleton height={80} />
          </View>
        ))}
      </GlassPanel>
      <GlassPanel style={styles.panel}>
        <Skeleton height={260} />
      </GlassPanel>
    </FadeIn>
  );
}

DigestSkeleton.displayName = 'DigestSkeleton';

const styles = StyleSheet.create({
  // web FadeIn `space-y-6`: a 24px vertical gap between the three panels.
  container: {
    gap: 24,
  },
  // web GlassPanel `p-6`: 24px padding inside the panel.
  panel: {
    padding: 24,
  },
  // web grid GlassPanel `grid grid-cols-1 gap-4 p-6 sm:grid-cols-2
  // lg:grid-cols-3`: padding 24 (p-6) + a flex-wrap row with a 16px gap
  // (gap-4); the cells below provide the responsive column count.
  gridPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    padding: 24,
  },
  // Responsive grid slot: wraps to ~2-up on a phone (sm:grid-cols-2) — the
  // SummaryStatsRow precedent for a 1/2/3-column web grid.
  gridCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 120,
  },
});
