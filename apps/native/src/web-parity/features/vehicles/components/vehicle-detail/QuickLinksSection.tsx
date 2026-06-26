// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx.
//
// The web original renders a single "Quick Links" GlassPanel: a header (a small
// neon-cyan ChevronRight + a bold title) followed by a responsive
// grid-cols-2/sm:3/lg:6 grid of six navigation tiles. Each tile is a
// react-router-dom <Link to={path}> wrapping a hoverable GlassPanel that stacks
// a lucide icon over a label. The six destinations (/drives, /charging,
// /battery, /climate, /efficiency, /settings) and their i18n labels
// (nav.drives/charging/battery/climate/efficiency/settings) are preserved
// verbatim, as is the section title key (vehicles.detail.quickLinks).
//
// Browser-only / not-yet-ported web dependencies and how each is reproduced:
//   - react-router-dom <Link to={path}> (web L1, L34): React Native has no DOM
//     router, so — following the committed native idiom (RecentDrivesListWidget,
//     ChargingSessionCard) — each link becomes an accessible Pressable with
//     accessibilityRole="link" and accessibilityValue.text = the destination
//     path, so the exact `to` target is preserved and assertable. There is no
//     native router wired here, so navigation itself is the host screen's
//     responsibility (the Pressable is the press surface), exactly as the web
//     <Link> delegated the actual navigation to the router.
//   - react-i18next useTranslation (web L2): not wired in native; a local
//     English-default t(key, fallback) returns the same default string i18next
//     surfaces for a missing key, keeping every nav.*/vehicles.detail.* key
//     verbatim.
//   - lucide-react icons Route/BatteryCharging/Battery/Thermometer/BarChart3/
//     Settings/ChevronRight (web L3-5): no native icon font, so the six tile
//     icons map to the shared SemanticIcon glyph that best matches each tile's
//     purpose (Route->'drives', BatteryCharging->'batteryCharging',
//     Battery->'battery', Thermometer->'climate', BarChart3->'efficiency',
//     Settings->'settings'); the small decorative header ChevronRight becomes an
//     accent-toned (neon-cyan) chevron glyph, the documented native idiom for a
//     lucide chevron (cf. ConditionBuilder's CHEVRON_GLYPH).
//   - @/components/ui GlassPanel (web L7) -> shared native GlassPanel, used
//     directly for both the section panel and the per-tile surface. The web
//     `hover`/`glow="cyan"`/`cursor-pointer` affordances are hover/pointer-only
//     and have no touch analog, so the cyan "glow" intent is reproduced as a
//     pressed-state accent border + surface tint on the tile Pressable.
//   - @/lib/cn (web L8): className merging is unnecessary once Tailwind classes
//     become a StyleSheet, so cn is dropped.
//   - Tailwind className styling -> React Native StyleSheet. The base layout is
//     already grid-cols-2 (two columns on the smallest breakpoint), so the
//     mobile-first native grid keeps a two-column wrap rather than collapsing to
//     a single column.
//
// No DOM, react-router-dom, Recharts, Leaflet, lucide-react, or old web UI
// components are imported — only React Native primitives + shared native tokens.

import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── i18n fallback (react-i18next is not wired in native) ─────────────────── */

// i18next returns the supplied default when a key is missing; this fallback
// returns the English default while keeping every key verbatim from the source.
function t(_key: string, fallback: string): string {
  return fallback;
}

// Native stand-in for lucide-react's ChevronRight (web L4): a single
// right-pointing angle glyph, accent-toned to preserve the neon-cyan accent.
const CHEVRON_RIGHT_GLYPH = '\u203A'; // ›

/* ─── Quick-link model (web L13-20, icons mapped to SemanticIcon names) ─────── */

interface QuickLink {
  label: string;
  icon: SemanticIconName;
  to: string;
}

export function QuickLinksSection() {
  const quickLinks: QuickLink[] = [
    {label: t('nav.drives', 'Drives'), icon: 'drives', to: '/drives'},
    {label: t('nav.charging', 'Charging'), icon: 'batteryCharging', to: '/charging'},
    {label: t('nav.battery', 'Battery'), icon: 'battery', to: '/battery'},
    {label: t('nav.climate', 'Climate'), icon: 'climate', to: '/climate'},
    {label: t('nav.efficiency', 'Efficiency'), icon: 'efficiency', to: '/efficiency'},
    {label: t('nav.settings', 'Settings'), icon: 'settings', to: '/settings'},
  ];

  return (
    <GlassPanel style={styles.panel} testID="quick-links-section">
      <View style={styles.header}>
        <AppText
          variant="title"
          weight="bold"
          tone="accent"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.chevron}>
          {CHEVRON_RIGHT_GLYPH}
        </AppText>
        <AppText
          variant="title"
          weight="bold"
          accessibilityRole="header"
          style={styles.title}>
          {t('vehicles.detail.quickLinks', 'Quick Links')}
        </AppText>
      </View>

      <View style={styles.grid}>
        {quickLinks.map(link => (
          <Pressable
            key={link.to}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            accessibilityValue={{text: link.to}}
            testID={`quick-links-link-${link.to}`}
            style={styles.linkCell}>
            {({pressed}) => (
              <GlassPanel style={[styles.tile, pressed && styles.tilePressed]}>
                <SemanticIcon name={link.icon} size="md" decorative />
                <AppText
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  style={styles.tileLabel}>
                  {link.label}
                </AppText>
              </GlassPanel>
            )}
          </Pressable>
        ))}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chevron: {
    lineHeight: 28,
  },
  title: {
    flexShrink: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  linkCell: {
    flexGrow: 1,
    flexBasis: '40%',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  tilePressed: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceHover,
  },
  tileLabel: {
    textAlign: 'center',
  },
});
