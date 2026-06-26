// Native parity port of web/src/features/dashboard/components/RecentActivity.tsx.
//
// Renders the dashboard's three-panel "Recent Activity" cluster: a unified
// drive+charge activity feed (Timeline), a battery-% trend area chart, and a
// fleet-performance summary with a "most efficient vehicle" callout. The web
// file leans on browser-only dependencies that are absent from the native
// parity manifest (contract rules 4, 5 & 7); each is replaced with a React
// Native-safe equivalent and documented here + in the sidecar:
//
//   - react-router-dom `Link to="/drives"` (web L1, L77) -> a React Native
//     Pressable with accessibilityRole="link" that calls the optional
//     `onNavigate('/drives')` prop. The native web-parity tree has no in-app
//     router, so the route target is preserved on the prop (matching the
//     VehicleHeroCard / LiveTelemetrySegment ports) and navigation is delegated
//     to the host screen.
//   - react-i18next `useTranslation('dashboard')` (web L2, L40) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default + translation-key
//     intent at each call site (activity.* / battery.* / perf.*).
//   - @/hooks/useFormatting `useFormatting().formatCurrency` (web L3, L41, L57)
//     -> the ported native useFormatPrefs() (settings-derived currency symbol +
//     locale-aware fmt) plus a tiny local formatCurrency closure reproducing the
//     web `${symbol}${fmtNumber(amount, d)}` output.
//   - lucide-react icons (web L4): Activity / BatteryCharging / TrendingUp /
//     Clock render as the shared native SemanticIcon (activity / batteryCharging
//     / trendUp / clock), decorative, since lucide SVG has no native renderer.
//     Route / Zap are used ONLY as Timeline item markers; the native Timeline's
//     22x22 marker cannot host a 30x30 SemanticIcon, so they collapse to the
//     native Timeline's built-in colored dot — the per-type hex colors
//     ('#00f0ff' drive, '#10b981' charge) are kept verbatim so the drive-vs-
//     charge visual distinction survives.
//   - @/components/ui/GlassPanel (web L5) -> the shared native GlassPanel.
//   - @/components/data-display/Timeline (web L6) -> the ported native Timeline
//     (identical {icon?, title, subtitle?, time, color?} item contract).
//   - @/components/data-display Currency (web L7, L143) -> the ported native
//     parity Currency (same settings-driven symbol, no FX conversion).
//   - @/components/charts/AreaChartWrapper (web L8) -> the ported native
//     AreaChartWrapper (same {data, xKey, series, height, yFormatter} contract;
//     Recharts hover tooltips degrade to a latest-value summary on native).
//   - @/lib/numberFormat fmtNumber + fmtInt (web L9, L48-49, L56, L147, L154)
//     -> the ported useFormatPrefs().fmt (the native port of numberFormat with
//     the same settings-derived global locale + precision): fmtNumber(v, 1) ->
//     fmt(v, 1), fmtInt(v) -> fmt(v, 0).
//   - @/lib/dateFormat formatDateShort (web L10, L24) -> ported inline as a
//     native-safe Intl `toLocaleDateString({month:'short', day:'numeric'})`
//     (the DateTime.tsx port precedent), used only as the >7-day fallback of
//     formatTimeAgo.
//   - @/lib/unitConversion convertDistanceFromSI + convertEnergyFromSI (web L11,
//     L48, L56) -> convertDistanceFromSI imported from the ported format
//     _formatPrimitives; convertEnergyFromSI ported inline (wh -> kWh = wh/1000)
//     since it is not yet in _formatPrimitives.
//   - ../types FleetAnalytics / Drive / ChargingSession (web L12) -> ported
//     inline as native types; the native dashboard feature has no types.ts yet.
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, Leaflet, or web UI components are imported -- only
// react, react-native primitives, the shared native AppText / GlassPanel /
// SemanticIcon / theme tokens, and the ported parity Timeline / Currency /
// AreaChartWrapper / format primitives.

import React from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {AreaChartWrapper} from '../../../components/charts/AreaChartWrapper';
import {Currency} from '../../../components/data-display/format/Currency';
import {
  convertDistanceFromSI,
  useFormatPrefs,
} from '../../../components/data-display/format/_formatPrimitives';
import {Timeline} from '../../../components/data-display/Timeline';

// Tailwind / neon palette hexes used by the web classes, kept verbatim for parity.
const COLOR_DRIVE = '#00f0ff'; // neon cyan — drive timeline marker (web L91)
const COLOR_CHARGE = '#10b981'; // emerald-500 — charge marker + battery trend (web L91, L115)
const COLOR_AMBER_300 = '#fcd34d'; // text-amber-300 — total cost value (web L143)
const COLOR_EMERALD_300 = '#6ee7b7'; // text-emerald-300 — CO₂ + most-efficient name

// ── ../types (ported inline; native dashboard types not yet present) ──

interface FleetAnalytics {
  total_vehicles: number;
  total_drives: number;
  total_charging_sessions: number;
  total_distance_km: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  period_days: number;
  most_efficient_vehicle?: {name: string; efficiency: number};
}

interface Drive {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  start_ts: string;
  distance_m: number;
  duration_s: number;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  avg_power_w: number | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  energy_used_wh: number | null;
  regen_energy_wh: number | null;
  start_address?: string;
  end_address?: string;
}

interface ChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  total_energy_added_wh: number;
  start_soc_pct: number;
  end_soc_pct: number | null;
  cost_decimal: number | null;
  cost?: number | null;
  startedAt: string;
  duration_min: number;
}

// ── react-i18next useTranslation replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/unitConversion convertEnergyFromSI (ported inline) ──
type EnergyUnit = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnit): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

// ── @/lib/dateFormat formatDateShort (ported inline, native-safe Intl) ──
/** Short date: "Apr 4". Returns "—" for an unparseable date. */
function formatDateShort(date: Date): string {
  if (isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* Relative time helper (web L14-25, ported verbatim). */
function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return 'Just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  const days = Math.floor(hrs / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDateShort(date);
}

interface RecentActivityProps {
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  analytics: FleetAnalytics | undefined;
  toEfficiencyDisplay: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
  /**
   * Native-only: routes the "View all" link target ('/drives'). The web-parity
   * tree has no in-app router, so navigation is delegated to the host screen.
   */
  onNavigate?: (path: string) => void;
}

interface ActivityItem {
  type: string;
  title: string;
  subtitle: string;
  time: Date;
}

export function RecentActivity({
  recentDrives,
  recentCharges,
  analytics,
  toEfficiencyDisplay,
  distanceUnit,
  efficiencyUnit,
  onNavigate,
}: RecentActivityProps) {
  const t = useNativeTranslation();
  const {currencySymbol, fmt, precision} = useFormatPrefs();

  // useFormatting().formatCurrency: `${symbol}${fmtNumber(amount, d)}` (web L32-35).
  const formatCurrency = (amount: number, decimals?: number) =>
    `${currencySymbol}${fmt(amount, decimals ?? precision)}`;

  // Build unified activity timeline (web L43-61).
  const activityItems: ActivityItem[] = [];
  recentDrives?.forEach(d =>
    activityItems.push({
      type: 'drive',
      title: `${fmt(
        convertDistanceFromSI(d.distance_m ?? 0, distanceUnit === 'mi' ? 'mi' : 'km'),
        1,
      )} ${distanceUnit} ${t('activity.drive', 'drive')}`,
      subtitle: `${Math.floor((d.duration_s ?? 0) / 3600)}h ${fmt(
        Math.floor(((d.duration_s ?? 0) % 3600) / 60),
        0,
      )}m · ${d.start_soc_pct ?? '?'}% → ${d.end_soc_pct ?? '?'}%`,
      time: new Date(d.started_at),
    }),
  );
  recentCharges?.forEach(s =>
    activityItems.push({
      type: 'charge',
      title: `${fmt(
        convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'),
        1,
      )} kWh ${t('activity.charged', 'charged')}`,
      subtitle: `${s.start_soc_pct ?? '?'}% → ${s.end_soc_pct ?? '?'}%${
        typeof s.cost === 'number' ? ` · ${formatCurrency(s.cost, 2)}` : ''
      }`,
      time: new Date(s.started_at),
    }),
  );
  activityItems.sort((a, b) => b.time.getTime() - a.time.getTime());

  // Battery trend for chart (web L63-67).
  const batteryTrend =
    recentDrives
      ?.map((d, i) => ({
        i: String(i),
        v: d.end_soc_pct ?? 50,
      }))
      .reverse() ?? [];

  return (
    <View style={styles.container}>
      {/* Activity Feed */}
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <View style={styles.titleGroup}>
            <SemanticIcon name="activity" size="sm" decorative />
            <AppText style={styles.sectionTitle}>
              {t('activity.title', 'Recent Activity')}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="link"
            onPress={() => onNavigate?.('/drives')}
            style={styles.viewAll}>
            <AppText style={styles.viewAllText}>
              {t('activity.viewAll', 'View all')}
            </AppText>
          </Pressable>
        </View>
        {activityItems.length > 0 ? (
          <ScrollView nestedScrollEnabled style={styles.feedScroll}>
            <Timeline
              items={activityItems.slice(0, 8).map(item => ({
                title: item.title,
                subtitle: item.subtitle,
                time: formatTimeAgo(item.time),
                color: item.type === 'drive' ? COLOR_DRIVE : COLOR_CHARGE,
              }))}
            />
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <SemanticIcon
              name="clock"
              size="md"
              decorative
              style={styles.emptyIcon}
            />
            <AppText style={styles.emptyText}>
              {t('activity.empty', 'No activity yet. Start driving!')}
            </AppText>
          </View>
        )}
      </GlassPanel>

      {/* Battery Trend + Fleet Performance */}
      <View style={styles.rightColumn}>
        {/* Battery Trend Chart */}
        <GlassPanel style={styles.panel}>
          <View style={styles.titleHeader}>
            <SemanticIcon name="batteryCharging" size="sm" decorative />
            <AppText style={styles.sectionTitle}>
              {t('battery.title', 'Battery Trend')}
            </AppText>
          </View>
          {batteryTrend.length > 1 ? (
            <AreaChartWrapper
              data={batteryTrend}
              xKey="i"
              series={[{key: 'v', label: 'Battery %', color: COLOR_CHARGE}]}
              height={180}
              yFormatter={v => `${v}%`}
            />
          ) : (
            <View style={styles.chartEmpty}>
              <AppText style={styles.chartEmptyText}>
                {t('battery.empty', 'Charge data will appear here')}
              </AppText>
            </View>
          )}
        </GlassPanel>

        {/* Fleet Performance */}
        <GlassPanel style={styles.panel}>
          <View style={styles.titleHeader}>
            <SemanticIcon name="trendUp" size="sm" decorative />
            <AppText style={styles.sectionTitle}>
              {t('perf.title', 'Fleet Performance')}
            </AppText>
          </View>
          <View style={styles.perfList}>
            <View style={styles.perfRow}>
              <AppText style={styles.perfLabel}>
                {t('perf.drives', 'Total Drives (30d)')}
              </AppText>
              <AppText style={styles.perfValue}>
                {String(analytics?.total_drives ?? 0)}
              </AppText>
            </View>
            <View style={styles.perfRow}>
              <AppText style={styles.perfLabel}>
                {t('perf.charges', 'Charge Sessions')}
              </AppText>
              <AppText style={styles.perfValue}>
                {String(analytics?.total_charging_sessions ?? 0)}
              </AppText>
            </View>
            <View style={styles.perfRow}>
              <AppText style={styles.perfLabel}>
                {t('perf.cost', 'Total Cost')}
              </AppText>
              <Currency
                value={analytics?.total_cost ?? 0}
                style={[styles.perfValue, styles.amber300]}
              />
            </View>
            <View style={styles.perfRow}>
              <AppText style={styles.perfLabel}>
                {t('perf.co2', 'CO₂ Saved')}
              </AppText>
              <AppText style={[styles.perfValue, styles.emerald300]}>
                {`${fmt((analytics?.total_energy_kwh ?? 0) * 0.42, 0)} kg`}
              </AppText>
            </View>
            {analytics?.most_efficient_vehicle ? (
              <View style={styles.efficientCard}>
                <AppText style={styles.efficientEyebrow}>
                  {t('perf.mostEfficient', 'Most Efficient')}
                </AppText>
                <AppText style={styles.efficientName}>
                  {analytics.most_efficient_vehicle.name}
                </AppText>
                <AppText style={styles.efficientValue}>
                  {`${fmt(
                    toEfficiencyDisplay(
                      analytics.most_efficient_vehicle.efficiency ?? 0,
                    ),
                    0,
                  )} ${efficiencyUnit}`}
                </AppText>
              </View>
            ) : null}
          </View>
        </GlassPanel>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },
  panel: {
    padding: 20,
  },
  rightColumn: {
    gap: 24,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  titleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  viewAll: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  viewAllText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  feedScroll: {
    maxHeight: 320,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyIcon: {
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  chartEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
  },
  chartEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  perfList: {
    gap: 16,
  },
  perfRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  perfLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  perfValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  amber300: {
    color: COLOR_AMBER_300,
  },
  emerald300: {
    color: COLOR_EMERALD_300,
  },
  efficientCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    padding: 12,
  },
  efficientEyebrow: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  efficientName: {
    color: COLOR_EMERALD_300,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  efficientValue: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
