// Native parity port of web/src/features/dashboard/components/QuickNav.tsx.
//
// The web component is the dashboard's quick-navigation strip: a responsive
// Tailwind grid (grid-cols-2 → sm:grid-cols-4) of four GlassPanel link tiles —
// Drives, Charging, Analytics, Battery. Each tile is a react-router <Link>
// wrapping a GlassPanel that shows a tinted lucide icon chip (rounded-lg, p-2,
// backgroundColor `${color}10`), an i18n label (text-sm font-semibold) over a
// description (text-[10px] muted), and a trailing ChevronRight. This native
// port preserves that contract 1:1 — the same four `to` paths, per-item colours,
// i18n keys + English defaults, icon-chip + label/desc + chevron structure —
// using React Native primitives + the existing native GlassPanel / AppText /
// design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-router-dom <Link> (web L1): React Native has no DOM anchor / browser
//     history router, so each tile becomes a Pressable with
//     accessibilityRole="link" and navigation is delegated to an optional
//     onNavigate(to) bridge prop wired up by the native navigation shell (the
//     established HistoryListRow / GuardedLink precedent). Without a bridge a
//     press is an explicit no-op; every `to` path is preserved verbatim.
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime, so an inline useNativeTranslationFallback() returns
//     t(key, fallback?) = fallback ?? key, preserving every key + English
//     default (nav.drives/charging/analytics/battery + the matching *Desc keys).
//   - lucide-react Route / BatteryCharging / Gauge / Activity / ChevronRight
//     (web L3): DOM SVG icons → semantic emoji/glyph stand-ins (the established
//     native inline-icon approach), each tinted with the same per-item colour;
//     ChevronRight → the › guillemet glyph used across the native ports.
//   - @/components/ui/GlassPanel (web L4): web GlassPanel (hover/glow) → native
//     GlassPanel; the hover-only border/colour transitions (group-hover, web
//     L19-20/L29) have no native equivalent → dropped, replaced by a subtle
//     pressed-opacity feedback.
//   - the Tailwind responsive grid (grid-cols-2 sm:grid-cols-4, gap-3) collapses
//     to a mobile-first 2-column flex-wrap, matching the web base breakpoint.

import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

// lucide-react glyph stand-ins (web L3): Route, BatteryCharging, Gauge, Activity.
const GLYPH_ROUTE = '🛣️'; // Route
const GLYPH_BATTERY_CHARGING = '🔋'; // BatteryCharging
const GLYPH_GAUGE = '📊'; // Gauge
const GLYPH_ACTIVITY = '📈'; // Activity
// ChevronRight (web L3 + L29): › guillemet, matching Pagination/HistoryListRow.
const GLYPH_CHEVRON_RIGHT = '\u203A';

// Ported verbatim from web L6-11 (the lucide icon component → glyph string).
const NAV_ITEMS = [
  {
    to: '/drives',
    glyph: GLYPH_ROUTE,
    labelKey: 'nav.drives',
    label: 'Drives',
    descKey: 'nav.drivesDesc',
    desc: 'Trip history',
    color: '#00f0ff',
  },
  {
    to: '/charging',
    glyph: GLYPH_BATTERY_CHARGING,
    labelKey: 'nav.charging',
    label: 'Charging',
    descKey: 'nav.chargingDesc',
    desc: 'Sessions & costs',
    color: '#10b981',
  },
  {
    to: '/analytics',
    glyph: GLYPH_GAUGE,
    labelKey: 'nav.analytics',
    label: 'Analytics',
    descKey: 'nav.analyticsDesc',
    desc: 'Fleet insights',
    color: '#a855f7',
  },
  {
    to: '/battery',
    glyph: GLYPH_ACTIVITY,
    labelKey: 'nav.battery',
    label: 'Battery',
    descKey: 'nav.batteryDesc',
    desc: 'Health & degradation',
    color: '#f59e0b',
  },
] as const;

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback ?? _key;
}

export interface QuickNavProps {
  /**
   * Native bridge for the web react-router <Link>. Invoked with the tile's `to`
   * path when pressed. The web file takes no props; this is the only
   * native-navigation addition. Without it a press is an explicit no-op.
   */
  onNavigate?: (to: string) => void;
}

export function QuickNav({onNavigate}: QuickNavProps) {
  const t = useNativeTranslationFallback();

  return (
    <View style={styles.grid}>
      {NAV_ITEMS.map(nav => (
        <Pressable
          key={nav.to}
          accessibilityLabel={t(nav.labelKey, nav.label)}
          accessibilityRole="link"
          onPress={() => onNavigate?.(nav.to)}
          style={({pressed}) => [
            styles.gridItem,
            pressed ? styles.pressed : null,
          ]}>
          <GlassPanel style={styles.panel}>
            <View style={styles.row}>
              <View
                style={[styles.iconBox, {backgroundColor: `${nav.color}10`}]}>
                <AppText style={[styles.iconGlyph, {color: nav.color}]}>
                  {nav.glyph}
                </AppText>
              </View>
              <View style={styles.textCol}>
                <AppText style={styles.label} weight="semibold">
                  {t(nav.labelKey, nav.label)}
                </AppText>
                <AppText style={styles.desc} tone="muted">
                  {t(nav.descKey, nav.desc)}
                </AppText>
              </View>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.chevron}
                tone="muted">
                {GLYPH_CHEVRON_RIGHT}
              </AppText>
            </View>
          </GlassPanel>
        </Pressable>
      ))}
    </View>
  );
}

QuickNav.displayName = 'QuickNav';

const styles = StyleSheet.create({
  chevron: {
    fontSize: 16,
    lineHeight: 16,
  },
  desc: {
    fontSize: 10,
  },
  grid: {
    columnGap: spacing.md, // gap-3 (12px)
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  gridItem: {
    flexBasis: '47%', // grid-cols-2 base breakpoint
    flexGrow: 1,
  },
  iconBox: {
    borderRadius: 8, // rounded-lg
    padding: spacing.sm, // p-2 (8px)
  },
  iconGlyph: {
    fontSize: 18, // h-5 w-5
    lineHeight: 22,
  },
  label: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
  },
  panel: {
    padding: spacing.md + 4, // p-4 (16px)
  },
  pressed: {
    opacity: 0.85,
  },
  row: {
    alignItems: 'center',
    columnGap: spacing.md, // gap-3
    flexDirection: 'row',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
});
