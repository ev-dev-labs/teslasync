// Native parity port of web/src/features/dashboard/widgets/QuickNavWidget.tsx.
//
// `QuickNavWidget` is a tiny dashboard widget whose entire body is the
// `<QuickNav />` quick-links grid wrapped in a padding-less `<WidgetShell>`
// (source: `return (<WidgetShell noPadding><QuickNav /></WidgetShell>)`). The
// `WidgetProps` it receives (`_props`) are unused by the source and stay unused
// here (conversion rule 3 — behaviour preserved 1:1).
//
// Three sibling modules the source imports are NOT yet ported to the native
// parity layer, so each is reproduced locally in this file — the same
// self-contained approach the AnomalyDetector / DigitalTwinMini widget ports
// use (conversion rules 4/5/7):
//
//   - `../components/QuickNav` `QuickNav` (source L1) -> reproduced locally as a
//     native `<QuickNav>`. The web component renders a `grid grid-cols-2
//     sm:grid-cols-4 gap-3` of four `<Link to=…>` cards (Drives `/drives`,
//     Charging `/charging`, Analytics `/analytics`, Battery `/battery`). Every
//     route path, i18n key + English default, and accent colour from the web
//     `NAV_ITEMS` table is preserved verbatim. RN has no viewport breakpoints,
//     so the responsive `sm:grid-cols-4` collapses to the mobile-first
//     2-column grid (reproduced with a flex-wrap row: `marginHorizontal:-6` +
//     per-cell `paddingHorizontal:6` give the `gap-3`/12px column gutter and
//     `rowGap:12` the row gutter, matching the FleetStats grid precedent).
//
//   - `./WidgetShell` `WidgetShell` (source L2) -> reproduced locally as a
//     native `<WidgetShell>` (same shape as the DigitalTwinMini port): loading
//     -> skeleton block, error -> centred danger text (surfaced, never hidden),
//     optional title+icon header, optional `actions` slot, and the `noPadding`
//     body switch (`overflow:'hidden'` vs `px-4 pb-3`). This widget only ever
//     passes `noPadding`, so at runtime the body renders `<QuickNav />` flush
//     to the widget edges. The web shell's freshness chip / pulse-on-change
//     box-shadow glow / help-tooltip / pin-button slots are only active when
//     the caller passes `updatedAt`/`query`/`help`/`widgetId` — QuickNavWidget
//     passes none of them, so they are no-ops for this widget on web too and
//     are intentionally not modeled here (documented in the sidecar).
//
//   - `./types` `WidgetProps` (source L3) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Web/DOM-only dependencies of the reproduced `QuickNav` are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-router-dom `<Link to=…>` (QuickNav L1, L19) -> each card is a
//     `<Pressable accessibilityRole="link">`; the navigation target is exposed
//     via an optional `onNavigate(to)` callback (host-wired, mirroring the
//     NotionSidebar `onItemSelect` delegation). There is no router in the
//     isolated parity layer, so when no callback is supplied the press is a
//     no-op while the route paths stay preserved (documented).
//   - react-i18next `useTranslation('dashboard')` (QuickNav L2, L14) -> a local
//     fallback resolver returning the inline English string (`{{token}}`
//     interpolation kept; namespace accepted + ignored), the same shim shape
//     used across the dashboard widget ports.
//   - lucide-react `Route` / `BatteryCharging` / `Gauge` / `Activity` /
//     `ChevronRight` (QuickNav L3) -> there is no `react-native-svg` dependency
//     in the native app, so each renders a decorative glyph stand-in via
//     `<GlyphIcon>` (the AnomalyDetector / DigitalTwinMini glyph precedent):
//     Route -> "🛣️", BatteryCharging -> "🔋", Gauge -> "📊", Activity -> "📈",
//     ChevronRight -> "›". The per-item accent colour (#00f0ff / #10b981 /
//     #a855f7 / #f59e0b) and the `${color}10` icon-chip tint are preserved
//     verbatim; the chevron keeps its gray-700 (#374151) resting colour and
//     brightens to the secondary token on press (web `group-hover:text-…`).
//   - `@/components/ui/GlassPanel` `GlassPanel` (QuickNav L4) -> the native app
//     shared `GlassPanel`; the web `hover` + `group-hover:border-white/[0.12]`
//     affordance maps to a pressed border-brighten on the wrapping Pressable.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so
// the light/dark cascade is preserved at the token boundary.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{token}}` placeholders are interpolated from the
// options arg so the i18n keys + intent survive. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// ── lucide glyph stand-in ────────────────────────────────────────────────────
// No react-native-svg in the native app, so lucide icons render as decorative
// glyphs (accessibility-hidden; the surrounding link carries the label).
function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}>
      {glyph}
    </AppText>
  );
}

// ── QuickNav nav table (web ../components/QuickNav `NAV_ITEMS`) ───────────────
// Route paths, i18n keys + English defaults, and accent colours preserved 1:1.
interface NavItem {
  to: string;
  glyph: string;
  labelKey: string;
  label: string;
  descKey: string;
  desc: string;
  color: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/drives',
    glyph: '🛣️',
    labelKey: 'nav.drives',
    label: 'Drives',
    descKey: 'nav.drivesDesc',
    desc: 'Trip history',
    color: '#00f0ff',
  },
  {
    to: '/charging',
    glyph: '🔋',
    labelKey: 'nav.charging',
    label: 'Charging',
    descKey: 'nav.chargingDesc',
    desc: 'Sessions & costs',
    color: '#10b981',
  },
  {
    to: '/analytics',
    glyph: '📊',
    labelKey: 'nav.analytics',
    label: 'Analytics',
    descKey: 'nav.analyticsDesc',
    desc: 'Fleet insights',
    color: '#a855f7',
  },
  {
    to: '/battery',
    glyph: '📈',
    labelKey: 'nav.battery',
    label: 'Battery',
    descKey: 'nav.batteryDesc',
    desc: 'Health & degradation',
    color: '#f59e0b',
  },
] as const;

const CHEVRON_RESTING = '#374151'; // text-gray-700

// ── QuickNav card (web `<Link><GlassPanel>…</GlassPanel></Link>`) ────────────
function NavCard({
  nav,
  label,
  desc,
  onNavigate,
}: {
  nav: NavItem;
  label: string;
  desc: string;
  onNavigate?: (to: string) => void;
}) {
  // Dynamic per-item styling held in variables so nothing inline lands in JSX
  // (react-native/no-inline-styles). `${color}10` is the web icon-chip tint.
  const iconChipStyle: StyleProp<ViewStyle> = {backgroundColor: `${nav.color}10`};

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => onNavigate?.(nav.to)}>
      {({pressed}) => (
        <GlassPanel style={[styles.card, pressed ? styles.cardPressed : null]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconChip, iconChipStyle]}>
              <GlyphIcon glyph={nav.glyph} color={nav.color} size={20} />
            </View>
            <View style={styles.textCol}>
              <AppText numberOfLines={1} style={styles.label}>
                {label}
              </AppText>
              <AppText numberOfLines={1} style={styles.desc}>
                {desc}
              </AppText>
            </View>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.chevron, pressed ? styles.chevronPressed : null]}>
              ›
            </AppText>
          </View>
        </GlassPanel>
      )}
    </Pressable>
  );
}

// ── QuickNav grid (web ../components/QuickNav `QuickNav`) ─────────────────────
function QuickNav({onNavigate}: {onNavigate?: (to: string) => void}) {
  const {t} = useTranslation('dashboard');

  return (
    <View style={styles.grid}>
      {NAV_ITEMS.map(nav => (
        <View key={nav.to} style={styles.cell}>
          <NavCard
            nav={nav}
            label={t(nav.labelKey, nav.label)}
            desc={t(nav.descKey, nav.desc)}
            onNavigate={onNavigate}
          />
        </View>
      ))}
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  noPadding,
  actions,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {actions ? <View style={styles.headerRight}>{actions}</View> : null}
        </View>
      ) : actions ? (
        <View style={styles.actionsOnlyRow}>{actions}</View>
      ) : null}
      <View style={noPadding ? styles.bodyNoPad : styles.body}>{children}</View>
    </View>
  );
}

export default function QuickNavWidget(_props: WidgetProps) {
  return (
    <WidgetShell noPadding>
      <QuickNav />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  actionsOnlyRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  bodyNoPad: {
    flex: 1,
    overflow: 'hidden', // noPadding -> overflow-hidden
  },
  card: {
    borderRadius: 16, // rounded-2xl card
    padding: 16, // p-4
  },
  cardPressed: {
    borderColor: 'rgba(255, 255, 255, 0.18)', // group-hover:border-white/[0.12]
  },
  cardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12, // gap-3
  },
  cell: {
    paddingHorizontal: 6, // half of gap-3 -> 12px column gutter
    width: '50%', // grid-cols-2 (mobile-first collapse of sm:grid-cols-4)
  },
  chevron: {
    color: CHEVRON_RESTING,
    fontSize: 16, // h-4 w-4
    lineHeight: 16,
  },
  chevronPressed: {
    color: colors.textSecondary, // group-hover:text-[var(--text-secondary)]
  },
  desc: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6, // offsets the per-cell gutter so cards sit flush
    rowGap: 12, // gap-3 row gutter
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  iconChip: {
    borderRadius: 8, // rounded-lg
    padding: 8, // p-2
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 18,
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  textCol: {
    flex: 1,
    minWidth: 0, // min-w-0
  },
});
