// Native parity port of
// web/src/features/analytics/components/weekly-digest/MiniStat.tsx.
//
// The web source is a tiny labelled-stat "pill": a GlassPanel laid out as a flex
// row containing an optional muted icon, then a column with a small secondary
// label above a slightly larger semibold white value. It accepts `label`,
// `value` (string | number, rendered via String(value)), an optional `icon`
// (React.ReactNode), and an optional Tailwind `className` merged onto the panel.
//
// Platform dependency swaps (no DOM, Tailwind/cn, Recharts, Leaflet, or web UI):
//   * `GlassPanel` (@/components/ui barrel) -> the shared native GlassPanel.
//   * `cn` (@/lib/cn) + the `flex items-center gap-3 px-4 py-3` class string ->
//     there is no Tailwind/cn in RN, so the classes become an equivalent RN
//     flex-row + gap + padding `style`. `className` is accepted only for
//     source-call parity (ignored); a native `style` override is provided.
//   * `<span className="text-[var(--text-muted)]">{icon}</span>` icon wrapper ->
//     a View; RN has no CSS `currentColor` cascade into arbitrary children, so a
//     string/number icon is rendered through AppText tone="muted" (the native
//     mapping of --text-muted) while an element icon keeps its own colour.
//   * `<span className="text-xs text-[var(--text-secondary)]">` label ->
//     AppText variant="caption" (text-xs == 12px) tone="secondary"
//     (--text-secondary).
//   * `<span className="text-sm font-semibold text-white">` value ->
//     AppText weight="semibold" (font-semibold == 600) at 14px (text-sm) with
//     color textPrimary (the established native mapping for text-white).

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../../../theme/tokens';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  /** Web Tailwind override retained for source-call parity; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
}

export function MiniStat({label, value, icon, className: _className, style}: MiniStatProps) {
  return (
    <GlassPanel style={[styles.root, style]}>
      {icon ? (
        <View pointerEvents="none" style={styles.icon}>
          {typeof icon === 'string' || typeof icon === 'number' ? (
            <AppText tone="muted">{icon}</AppText>
          ) : (
            icon
          )}
        </View>
      ) : null}
      <View style={styles.column}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        <AppText weight="semibold" style={styles.value}>
          {String(value)}
        </AppText>
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  // flex items-center gap-3 px-4 py-3.
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // wrapper for the optional muted icon.
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flex flex-col.
  column: {
    flexDirection: 'column',
  },
  // text-sm font-semibold text-white.
  value: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
});
