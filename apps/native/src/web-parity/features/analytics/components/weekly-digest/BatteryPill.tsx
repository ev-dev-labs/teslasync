// Native parity port of
// web/src/features/analytics/components/weekly-digest/BatteryPill.tsx.
//
// The web source is a small "pill" summarizing a single battery level: a
// GlassPanel laid out as a flex row containing a lucide `Battery` icon, a label
// + bold percentage column, and a right-aligned progress track whose fill width
// and colour track the level. The colour is driven by three thresholds:
//   level >= 60 -> STATUS_COLORS.good (#10b981)
//   level >= 30 -> STATUS_COLORS.warning (#f59e0b)
//   else        -> STATUS_COLORS.critical (#ef4444)
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI):
//   * `Battery` (lucide-react <svg>) -> a native View-based battery glyph
//     (outline + terminal nub) coloured with the same dynamic `color`, mirroring
//     the established BatteryDelta glyph approach (the native app ships no
//     react-native-svg / lucide-react-native renderer). `h-5 w-5` -> a 20px box.
//   * `GlassPanel` (@/components/ui barrel) -> the shared native GlassPanel; the
//     `cn('flex items-center gap-3 px-4 py-3', className)` Tailwind class string
//     becomes the equivalent RN flex-row + gap + padding `style`. There is no
//     `cn`/Tailwind in RN, so `className` is accepted only for source-call parity
//     (ignored) and a native `style` override is provided instead.
//   * `fmtInt` (@/lib/numberFormat) is not yet ported into web-parity, so a
//     native-safe inline mirrors its exact behaviour: safe-number coercion
//     (nullish/NaN/non-number -> 0) then en-US locale grouping at 0 decimals
//     (the web global-locale default when no user settings are loaded).
//   * `STATUS_COLORS` (@/lib/colors) -> an inline value-identical constant
//     preserving the three exact hex codes.
//   * `<span className="text-xs text-[var(--text-secondary)]">` label ->
//     AppText variant="caption" tone="secondary" (the native mapping for
//     text-xs + --text-secondary). The bold value `<span className="text-sm
//     font-bold" style={{color}}>` -> AppText weight="bold" at 14px with the
//     dynamic colour. The track `bg-[var(--surface-2)]` -> #151621 (the dark
//     theme value of --surface-2, the native app's only theme).

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

// Value-identical inline of web @/lib/colors `STATUS_COLORS`.
const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

// Dark-theme value of the web `--surface-2` CSS var (the native app is dark only).
const TRACK_BG = '#151621';

// text-sm == 14px; the bold percentage value.
const VALUE_FONT_SIZE = 14;

// Parity for web @/lib/numberFormat `fmtInt(v)` == `fmtNumber(v, 0)`:
// safe-number coercion (nullish / NaN / non-number -> 0) then en-US grouped
// integer formatting (the web global-locale default).
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return n.toFixed(0);
  }
}

// Native analogue of the lucide `Battery` icon (h-5 w-5, 20px box): an outline
// rounded body plus a terminal nub, coloured with the dynamic level `color`.
function BatteryGlyph({color}: {color: string}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.icon}>
      <View style={[styles.iconBody, {borderColor: color}]} />
      <View style={[styles.iconTerminal, {backgroundColor: color}]} />
    </View>
  );
}

interface BatteryPillProps {
  level: number;
  label: string;
  /** Web Tailwind override retained for source-call parity; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
}

export function BatteryPill({level, label, className: _className, style}: BatteryPillProps) {
  const color =
    level >= 60
      ? STATUS_COLORS.good
      : level >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  return (
    <GlassPanel style={[styles.root, style]}>
      <BatteryGlyph color={color} />
      <View style={styles.column}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        <AppText weight="bold" style={[styles.value, {color}]}>
          {fmtInt(level)}%
        </AppText>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min(level, 100)}%` as DimensionValue,
              backgroundColor: color,
            },
          ]}
        />
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
  // flex flex-col.
  column: {
    flexDirection: 'column',
  },
  // text-sm font-bold.
  value: {
    fontSize: VALUE_FONT_SIZE,
    lineHeight: 18,
  },
  // h-5 w-5 box for the battery glyph.
  icon: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBody: {
    width: 15,
    height: 9,
    borderWidth: 1.6,
    borderRadius: 2.5,
  },
  iconTerminal: {
    width: 2,
    height: 4,
    borderRadius: 1,
    marginLeft: 1,
  },
  // ml-auto h-2 w-16 overflow-hidden rounded-full bg-[var(--surface-2)].
  track: {
    marginLeft: 'auto',
    width: 64,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: TRACK_BG,
  },
  // block h-full rounded-full.
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
