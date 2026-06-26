// Native parity port of
// web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx.
//
// The web component is the Analytics > Overview tab's vehicle-comparison block:
// four GlassPanels laid out in two responsive `grid-cols-1 lg:grid-cols-2` rows —
//   1. Fleet Usage   — a Recharts donut (PieChart) of per-vehicle distance share.
//   2. Efficiency Leaderboard — plain HTML progress bars (NOT Recharts), one per
//      vehicle, sorted ascending by Wh/km and scaled to the worst performer.
//   3. Vehicle Comparison — a Recharts RadarChart of four normalized axes
//      (Distance / Energy / Drives / Efficiency), shown only with 2+ vehicles.
//   4. Energy & Activity — a Recharts grouped BarChart of energy (kWh) + drives.
//
// All four web visualizations are driven by `data.vehicle_comparison`. This port
// keeps every data computation byte-for-byte (the `leaderboard` and `radarData`
// useMemos, the SI distance conversion feeding the donut, the unit handling, and
// the i18n key/fallback intent) and rebuilds the visuals with React Native
// primitives, because Recharts is a browser DOM/SVG renderer (forbidden in native
// output, contract rule 4). Following the established native chart parity
// philosophy (see components/charts/MiniBarChart, ChartSummary, SmallMultiples
// Chart) each chart becomes a native-safe data-visible alternative rather than a
// blank "unavailable" box:
//   * Donut          -> a legend list: colour swatch + name + converted distance
//                       value + a proportional share meter (the donut's intent).
//   * Leaderboard    -> a direct 1:1 native port of the web progress bars.
//   * Radar          -> per-axis normalized (0-100) meters, one row per vehicle,
//                       preserving the four-axis multi-vehicle comparison.
//   * Grouped Bar    -> per-vehicle energy + drives meters in the two web series
//                       colours, with a legend.
// The richer SVG donut/radar/bar geometry that depends on a browser SVG backend
// is the only thing not reproduced; that is documented in the sidecar.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI):
//   * `useTranslation` (react-i18next) -> a fallback `t(key, fallback)` returning
//     the English fallback (native has no i18n runtime wired yet), preserving
//     every key/fallback pair.
//   * `useUnits` (@/hooks/useUnits) + `convertDistanceFromSI`/`fmtNumber`
//     (@/lib/*) are not yet ported into web-parity, so native-safe inlines mirror
//     their exact behaviour (default distance unit = 'km', the web default when
//     no user settings are loaded; en-US locale formatter; meter->km/mi math).
//   * `GlassPanel` -> the shared native GlassPanel. `EmptyState message` (no
//     title) -> an inline centred muted message matching the web message-only
//     EmptyState. `SectionTitle` (web ./helpers, not yet ported) -> inlined.
//   * `safe`, `CHART_COLORS`, `NEON_COLORS` come from the native charts barrel
//     (value-identical palettes). `PIE_COLORS` comes from the ported ./constants.

import React, {useMemo, type ReactNode} from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';
import {CHART_COLORS, NEON_COLORS, safe} from '../../../../components/charts';
import type {FleetAnalytics} from '../../../../api/types';
import {PIE_COLORS} from './constants';

const KM_PER_MILE = 1.609344;

// Tailwind `lg:` breakpoint — at/above this width the two panels sit side by side
// (grid-cols-2); below it they stack (grid-cols-1).
const LG_BREAKPOINT = 1024;
// gap-4 / p-4 == 1rem == 16px.
const GAP = 16;
const PANEL_PADDING = 16;
// Web leaderboard / radar / pie track: `bg-white/[0.06]`.
const TRACK_BG = 'rgba(255, 255, 255, 0.06)';
// text-sm.
const SECTION_TITLE_SIZE = 14;

// ---------------------------------------------------------------------------
// Native-safe inlines for not-yet-ported web dependencies.
// ---------------------------------------------------------------------------

type DistanceUnitPref = 'km' | 'mi';

type NativeTFunction = (key: string, fallback: string) => string;

// Web read `t` from react-i18next; native parity has no i18n runtime, so the
// English fallback is returned, preserving the panel-title, series-label and
// empty-state key/fallback intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

// Mirror of `useUnits().unitPrefs.distance`. The web `deriveDistance` returns
// 'km' whenever `settings.unit_of_length` is anything but 'mi'; with no native
// settings store wired the resolved default is 'km'.
function useNativeUnits(): {unitPrefs: {distance: DistanceUnitPref}} {
  return useMemo(() => ({unitPrefs: {distance: 'km' as DistanceUnitPref}}), []);
}

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

// Parity for @/lib/unitConversion `convertDistanceFromSI(meters, to)`.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// Parity for @/lib/numberFormat `fmtNumber(v, decimals)`: locale-grouped, NaN/
// Infinity coerced to 0, with the web global-locale default of 'en-US'.
function fmtNumber(value: number, decimals: number): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, pct));
}

// ---------------------------------------------------------------------------
// Small presentational helpers.
// ---------------------------------------------------------------------------

// Web ./helpers `SectionTitle`: text-sm font-semibold text-[var(--text-primary)].
function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText weight="semibold" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

// Native analogue of the shared web `EmptyState message` (no title/icon used at
// these call sites): a centred muted message.
function EmptyStateView({message}: {message: string}) {
  return (
    <View style={styles.empty}>
      <AppText tone="muted">{message}</AppText>
    </View>
  );
}

// Horizontal proportional bar — the native vocabulary used by every chart
// rebuild here (mirrors components/charts MiniBarChart track/fill).
function MeterBar({pct, color}: {pct: number; color: string}) {
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          {width: `${clampPct(pct)}%` as DimensionValue, backgroundColor: color},
        ]}
      />
    </View>
  );
}

function LegendItem({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendLabel}>
      <View style={[styles.swatch, {backgroundColor: color}]} />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

// Responsive two-up row — `grid grid-cols-1 gap-4 lg:grid-cols-2`.
function ResponsiveRow({left, right}: {left: ReactNode; right: ReactNode}) {
  const {width} = useWindowDimensions();
  const twoCol = width >= LG_BREAKPOINT;
  return (
    <View style={[styles.gridRow, twoCol ? styles.gridRowWide : null]}>
      <View style={twoCol ? styles.gridCol : styles.gridColFull}>{left}</View>
      <View style={twoCol ? styles.gridCol : styles.gridColFull}>{right}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function OverviewVehicleComparison({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useNativeUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend efficiency is Wh/km — convert to Wh/mi when the user prefers miles.
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // Web wrote `const vehicles = data?.vehicle_comparison ?? []`; the native
  // eslint config (react-hooks/exhaustive-deps) rejects a fresh `??` array as a
  // useMemo dependency, so it is memoized here. Same value, same behaviour.
  const vehicles = useMemo(() => data?.vehicle_comparison ?? [], [data]);

  const leaderboard = useMemo(() => {
    const sorted = [...vehicles].sort((a, b) => safe(a.efficiency) - safe(b.efficiency));
    const maxEff = sorted.length > 0 ? safe(sorted[sorted.length - 1].efficiency) : 1;
    return sorted.map(v => ({...v, pct: maxEff > 0 ? (safe(v.efficiency) / maxEff) * 100 : 0}));
  }, [vehicles]);

  const radarData = useMemo(() => {
    if (vehicles.length < 2) {
      return [];
    }
    const maxDist = Math.max(...vehicles.map(v => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map(v => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map(v => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map(v => safe(v.efficiency)), 1);
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map(metric => {
      const row: Record<string, string | number> = {metric};
      vehicles.forEach(v => {
        switch (metric) {
          case 'Distance':
            row[v.name] = (safe(v.distance) / maxDist) * 100;
            break;
          case 'Energy':
            row[v.name] = (safe(v.energy) / maxEnergy) * 100;
            break;
          case 'Drives':
            row[v.name] = (safe(v.drives) / maxDrives) * 100;
            break;
          case 'Efficiency':
            row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100;
            break;
        }
      });
      return row;
    });
  }, [vehicles]);

  // Donut source data — per-vehicle distance share (web Pie `dataKey="value"`).
  const pieData = vehicles.map(v => ({
    id: v.id,
    name: v.name,
    value: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit),
  }));
  const pieTotal = pieData.reduce((sum, d) => sum + d.value, 0);

  // Grouped-bar maxima for native normalization (web BarChart auto-scaled Y).
  const maxBarEnergy = Math.max(...vehicles.map(v => safe(v.energy)), 1);
  const maxBarDrives = Math.max(...vehicles.map(v => safe(v.drives)), 1);

  return (
    <View style={styles.root}>
      {/* Fleet Usage Donut + Efficiency Leaderboard */}
      <ResponsiveRow
        left={
          <GlassPanel style={styles.panel}>
            <SectionTitle>{t('analytics.overview.fleetUsage', 'Fleet Usage')}</SectionTitle>
            {vehicles.length > 0 ? (
              <View style={styles.list}>
                {pieData.map((d, i) => (
                  <View key={d.id} style={styles.barBlock}>
                    <View style={styles.rowBetween}>
                      <LegendItem
                        color={PIE_COLORS[i % PIE_COLORS.length]}
                        label={d.name}
                      />
                      <AppText variant="caption" tone="muted">
                        {fmtNumber(d.value, 1)} {distanceUnit}
                      </AppText>
                    </View>
                    <MeterBar
                      pct={pieTotal > 0 ? (d.value / pieTotal) * 100 : 0}
                      color={PIE_COLORS[i % PIE_COLORS.length]}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <EmptyStateView message={t('analytics.overview.noVehicles', 'No vehicle data')} />
            )}
          </GlassPanel>
        }
        right={
          <GlassPanel style={styles.panel}>
            <SectionTitle>
              {t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard')}
            </SectionTitle>
            {leaderboard.length > 0 ? (
              <View style={styles.list}>
                {leaderboard.map((v, idx) => (
                  <View key={v.id} style={styles.barBlock}>
                    <View style={styles.rowBetween}>
                      <AppText variant="caption" weight="semibold" numberOfLines={1} style={styles.flexLabel}>
                        #{idx + 1} {v.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {fmtNumber(whPerKmToDisplay(safe(v.efficiency)), 1)} {efficiencyUnit}
                      </AppText>
                    </View>
                    <MeterBar pct={v.pct} color={NEON_COLORS[0]} />
                  </View>
                ))}
              </View>
            ) : (
              <EmptyStateView message={t('analytics.overview.noEfficiency', 'No efficiency data')} />
            )}
          </GlassPanel>
        }
      />

      {/* Radar Vehicle Comparison + Energy & Activity */}
      <ResponsiveRow
        left={
          <GlassPanel style={styles.panel}>
            <SectionTitle>
              {t('analytics.overview.vehicleComparison', 'Vehicle Comparison')}
            </SectionTitle>
            {radarData.length > 0 ? (
              <View style={styles.list}>
                <View style={styles.legendRow}>
                  {vehicles.map((v, i) => (
                    <LegendItem
                      key={v.id}
                      color={CHART_COLORS[i % CHART_COLORS.length]}
                      label={v.name}
                    />
                  ))}
                </View>
                {radarData.map(row => (
                  <View key={String(row.metric)} style={styles.metricBlock}>
                    <AppText variant="caption" tone="muted">
                      {String(row.metric)}
                    </AppText>
                    {vehicles.map((v, i) => (
                      <View key={v.id} style={styles.compareRow}>
                        <AppText variant="caption" numberOfLines={1} style={styles.compareName}>
                          {v.name}
                        </AppText>
                        <View style={styles.compareBarWrap}>
                          <MeterBar
                            pct={safe(row[v.name])}
                            color={CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        </View>
                        <AppText variant="caption" tone="muted" style={styles.compareVal}>
                          {fmtNumber(safe(row[v.name]), 0)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <EmptyStateView
                message={t('analytics.overview.noComparison', 'Need 2+ vehicles for comparison')}
              />
            )}
          </GlassPanel>
        }
        right={
          <GlassPanel style={styles.panel}>
            <SectionTitle>
              {t('analytics.overview.energyActivity', 'Energy & Activity')}
            </SectionTitle>
            {vehicles.length > 0 ? (
              <View style={styles.list}>
                <View style={styles.legendRow}>
                  <LegendItem
                    color={CHART_COLORS[1]}
                    label={t('analytics.overview.energykWh', 'Energy (kWh)')}
                  />
                  <LegendItem
                    color={CHART_COLORS[3]}
                    label={t('analytics.overview.drives', 'Drives')}
                  />
                </View>
                {vehicles.map(v => (
                  <View key={v.id} style={styles.metricBlock}>
                    <AppText variant="caption" numberOfLines={1}>
                      {v.name}
                    </AppText>
                    <View style={styles.compareRow}>
                      <View style={styles.compareBarWrap}>
                        <MeterBar
                          pct={(safe(v.energy) / maxBarEnergy) * 100}
                          color={CHART_COLORS[1]}
                        />
                      </View>
                      <AppText variant="caption" tone="muted" style={styles.compareVal}>
                        {fmtNumber(safe(v.energy), 1)}
                      </AppText>
                    </View>
                    <View style={styles.compareRow}>
                      <View style={styles.compareBarWrap}>
                        <MeterBar
                          pct={(safe(v.drives) / maxBarDrives) * 100}
                          color={CHART_COLORS[3]}
                        />
                      </View>
                      <AppText variant="caption" tone="muted" style={styles.compareVal}>
                        {fmtNumber(safe(v.drives), 0)}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyStateView message={t('analytics.overview.noVehicles', 'No vehicle data')} />
            )}
          </GlassPanel>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: GAP,
  },
  gridRow: {
    gap: GAP,
  },
  gridRowWide: {
    flexDirection: 'row',
  },
  gridCol: {
    flex: 1,
    minWidth: 0,
  },
  gridColFull: {
    width: '100%',
  },
  panel: {
    padding: PANEL_PADDING,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: SECTION_TITLE_SIZE,
  },
  list: {
    gap: spacing.md,
  },
  barBlock: {
    gap: spacing.xs,
  },
  metricBlock: {
    gap: spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  flexLabel: {
    flexShrink: 1,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: TRACK_BG,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compareName: {
    width: 80,
  },
  compareBarWrap: {
    flex: 1,
  },
  compareVal: {
    width: 44,
    textAlign: 'right',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
