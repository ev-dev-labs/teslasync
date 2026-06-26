// Native parity port of web/src/features/dashboard/widgets/FleetStatsWidget.tsx.
//
// `FleetStatsWidget` is a dashboard widget that renders the fleet summary bar:
// five metric panels (fleet size, 30-day distance, 30-day energy, efficiency,
// alerts) inside a `WidgetShell`. The web component is a thin orchestrator — it
// resolves the unit-display closures, fetches the primary vehicle's 5 most
// recent drives + charges for the sparklines, derives vehicleCount/onlineCount,
// and delegates all rendering to `<FleetStatsBar>`.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `useVehicles()`/`useFleetAnalytics(30)` reads + the exact destructured
// analytics query fields (isFetching/isStale/isError/dataUpdatedAt/refetch)
// (L13-14), the `useUnits()` `unitPrefs` read (L15), the `toDistanceDisplay`
// closure `convertDistanceFromSI(value, unitPrefs.distance)` (L16), the
// `distanceUnit`/`efficiencyUnit`/`toEfficiencyDisplay` derivations including
// the `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'` +
// `whPerKm * 1.609344` branches (L18-20), `primaryId = vehicles?.[0]?.id ?? 0`
// (L22), the two `useQuery`s (queryKeys `['drives', primaryId, 'recent-5']` /
// `['charging', primaryId, 'recent-5']`, queryFns hitting
// `/drives?vehicle_id=${primaryId}&limit=5` and
// `/charging?vehicle_id=${primaryId}&limit=5`, `enabled: primaryId > 0`)
// (L23-32), `vehicleCount = vehicles?.length ?? 0` (L34),
// `onlineCount = vehicles?.filter(v => v.state === 'online').length ?? 0`
// (L35), and the `WidgetShell`+`FleetStatsBar` prop wiring including the
// verbatim `analytics/recentDrives/recentCharges as Parameters<typeof
// FleetStatsBar>[0][...]` casts and `unreadAlerts={0}` (L37-50). Every API path
// and snake_case query param (`vehicle_id`) is kept verbatim.
//
// Real native parity deps reused (rule 5): `@/api/hooks/useVehicles` +
// `@/api/hooks/useAnalytics` (useFleetAnalytics) + `@/api/client` request +
// `@/api/types` Drive/ChargingSession are the already-ported web-parity modules
// (real TanStack Query against the real endpoints); `@tanstack/react-query`
// useQuery is used directly. `@/components/ui` GlassPanel + AppText and the
// theme tokens are the native app components.
//
// Web/DOM-only deps mapped native-safe + documented (rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (FleetStatsBar L1) -> a local
//     inline-English fallback shim ({{name}} interpolation, namespace accepted +
//     ignored), the same shim shape used by the sibling widget ports. Every
//     `fleet.*` key + English default is kept verbatim.
//   - `@/hooks/useUnits` `useUnits` (L4) -> a local shim exposing
//     `unitPrefs.distance`. There is no native settings/locale port yet, so it
//     resolves to 'km' (the web `deriveDistance` default when
//     `unit_of_length !== 'mi'`), keeping everything SI on disk and converting
//     only at this display boundary.
//   - `@/lib/unitConversion` `convertDistanceFromSI` (L10) -> inlined verbatim
//     (km -> m/1000, mi -> m/1609.344, ft -> m/0.3048).
//   - `@/components/data-display/AnimatedNumber` (FleetStatsBar L4) -> reproduced
//     locally as `<AnimatedNumber>`: the same 0 -> value ease-out-quad ramp over
//     `duration`s driven by requestAnimationFrame, the inlined safeNumber +
//     fmtNumber (en-US, honours `decimals`), and the prefix/suffix render. The
//     web `tabular-nums` is the RN `fontVariant: ['tabular-nums']`.
//   - `@/components/charts/MiniChart` (L5) -> the already-ported web-parity
//     MiniChart (renders <2-point series as nothing, matching its native parity
//     contract).
//   - `@/components/motion` StaggerContainer + StaggerItem (L6) -> StaggerItem is
//     reused directly; StaggerContainer's two responsibilities (the CSS grid
//     wrapper + the 0.06s stagger orchestration) are reproduced by a local
//     flex-wrap grid `View` plus explicit `delay={i * 0.06}` props (mirroring the
//     native StaggerContainer's own index*0.06 injection), because the native
//     StaggerContainer renders a plain column View that cannot carry grid layout.
//   - `@/components/ui/GlassPanel` (L3) -> the native app GlassPanel.
//   - `./WidgetShell` `WidgetShell` (FleetStatsWidget L7) -> reproduced locally
//     (sibling not yet ported, same self-contained approach as the
//     AnomalyDetector/ChargeSessionChart widget ports): loading -> skeleton
//     block, error -> centred danger text (surfaced, never hidden), the optional
//     title+icon header, the freshness chip via the converted web-parity
//     DataFreshness port, and the `noPadding` body switch. The web
//     pulse-on-data-change box-shadow glow + help-tooltip + pin-button header
//     slots are unused by this widget and intentionally not modeled.
//   - `./types` `WidgetProps` + `../types` Drive/ChargingSession/FleetAnalytics
//     (L8-9) -> WidgetProps/WidgetSize/WidgetConfig reproduced + exported;
//     Drive/ChargingSession reuse the ported `@/api/types`; FleetAnalytics is
//     reproduced locally (mirrors the web `../types` shape) for the FleetStatsBar
//     prop + the `Parameters<...>` casts.
//
// The web responsive grid (`grid-cols-2` base -> `sm:3 md:4 lg:5`) collapses to
// the mobile-first 2-column layout on native (RN has no viewport breakpoints).
// Tailwind spacing -> px (1u = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary; the named Tailwind
// value colours (cyan-300/emerald-300/amber-300/red-500/emerald-500) are kept as
// their palette hex.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors } from '../../../../theme/tokens';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { MiniChart } from '../../../components/charts/MiniChart';
import { StaggerItem } from '../../../components/motion';
import { useVehicles } from '../../../api/hooks/useVehicles';
import { useFleetAnalytics } from '../../../api/hooks/useAnalytics';
import { request } from '../../../api/client';
import type { Drive, ChargingSession } from '../../../api/types';

// ── i18n shim (web react-i18next `useTranslation('dashboard')`) ──────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg. The namespace arg is accepted + ignored.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
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

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber) ────────────────────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale, the per-call precision arg is honoured.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 0): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Inlined `@/lib/unitConversion` `convertDistanceFromSI` ───────────────────
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

type DistanceUnitPref = 'km' | 'mi' | 'ft';

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// ── useUnits shim (web `@/hooks/useUnits`) ───────────────────────────────────
// No native settings/locale port yet, so the distance preference resolves to
// 'km' (the web `deriveDistance` default when `unit_of_length !== 'mi'`). All
// values stay SI on disk and convert only at this display boundary.
interface UnitPrefsShim {
  distance: DistanceUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShim } {
  return { unitPrefs: { distance: 'km' } };
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

// ── Type reproduction (web ../types `FleetAnalytics`) ────────────────────────
interface FleetAnalytics {
  total_vehicles: number;
  total_drives: number;
  total_charging_sessions: number;
  total_distance_km: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  period_days: number;
  most_efficient_vehicle?: { name: string; efficiency: number };
}

// Named Tailwind value colours (kept as palette hex).
const TEXT_CYAN_300 = '#67e8f9'; // text-cyan-300 (distance)
const TEXT_EMERALD_300 = '#6ee7b7'; // text-emerald-300 (energy)
const TEXT_AMBER_300 = '#fcd34d'; // text-amber-300 (efficiency)
const TEXT_RED_500 = '#ef4444'; // text-red-500 (alerts > 0)
const TEXT_EMERALD_500 = '#10b981'; // text-emerald-500 (alerts == 0)
const MINI_DISTANCE_COLOR = '#00f0ff'; // <MiniChart color> for drives
const MINI_ENERGY_COLOR = '#10b981'; // <MiniChart color> for charges

// Web `StaggerContainer` framer `staggerChildren: 0.06s`.
const STAGGER_SECONDS = 0.06;

// ── Local `AnimatedNumber` (web @/components/data-display/AnimatedNumber) ─────
interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, duration]);

  return (
    <AppText style={[styles.animatedNumber, style]}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

// ── Local `FleetStatsBar` (web ../components/FleetStatsBar) ───────────────────
interface FleetStatsBarProps {
  analytics: FleetAnalytics | undefined;
  vehicleCount: number;
  onlineCount: number;
  unreadAlerts: number;
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  toDistanceDisplay: (km: number) => number;
  toEfficiencyDisplay: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

function FleetStatsBar({
  analytics,
  vehicleCount,
  onlineCount,
  unreadAlerts,
  recentDrives,
  recentCharges,
  toDistanceDisplay,
  toEfficiencyDisplay,
  distanceUnit,
  efficiencyUnit,
}: FleetStatsBarProps) {
  const { t } = useTranslation('dashboard');
  const totalDistance = analytics?.total_distance_km ?? 0;
  const totalEnergy = analytics?.total_energy_kwh ?? 0;

  return (
    <View style={styles.grid}>
      <View style={styles.cell}>
        <StaggerItem delay={STAGGER_SECONDS * 0}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.metricLabel}>
              {t('fleet.size', 'Fleet Size')}
            </AppText>
            <AnimatedNumber
              value={vehicleCount}
              style={[styles.valueBase, styles.valuePrimary]}
            />
            <AppText style={styles.subLabel}>
              {onlineCount} {t('fleet.online', 'online')}
            </AppText>
          </GlassPanel>
        </StaggerItem>
      </View>

      <View style={styles.cell}>
        <StaggerItem delay={STAGGER_SECONDS * 1}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.metricLabel}>
              {t('fleet.distance', 'Distance (30d)')}
            </AppText>
            <AnimatedNumber
              value={toDistanceDisplay(totalDistance)}
              suffix={` ${distanceUnit}`}
              style={[styles.valueBase, styles.valueCyan]}
            />
            <View style={styles.miniChartWrap}>
              <MiniChart
                data={recentDrives?.map(d => d.distance_m).reverse() ?? [0]}
                color={MINI_DISTANCE_COLOR}
                height={24}
                width={60}
              />
            </View>
          </GlassPanel>
        </StaggerItem>
      </View>

      <View style={styles.cell}>
        <StaggerItem delay={STAGGER_SECONDS * 2}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.metricLabel}>
              {t('fleet.energy', 'Energy (30d)')}
            </AppText>
            <AnimatedNumber
              value={totalEnergy}
              decimals={1}
              suffix=" kWh"
              style={[styles.valueBase, styles.valueEmerald]}
            />
            <View style={styles.miniChartWrap}>
              <MiniChart
                data={
                  recentCharges?.map(s => s.total_energy_added_wh).reverse() ?? [
                    0,
                  ]
                }
                color={MINI_ENERGY_COLOR}
                height={24}
                width={60}
              />
            </View>
          </GlassPanel>
        </StaggerItem>
      </View>

      <View style={styles.cell}>
        <StaggerItem delay={STAGGER_SECONDS * 3}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.metricLabel}>
              {t('fleet.efficiency', 'Efficiency')}
            </AppText>
            <AnimatedNumber
              value={toEfficiencyDisplay(analytics?.avg_efficiency_wh_km ?? 0)}
              suffix={` ${efficiencyUnit}`}
              style={[styles.valueBase, styles.valueAmber]}
            />
            <AppText style={styles.subLabel}>
              {t('fleet.average', 'fleet average')}
            </AppText>
          </GlassPanel>
        </StaggerItem>
      </View>

      <View style={styles.cell}>
        <StaggerItem delay={STAGGER_SECONDS * 4}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.metricLabel}>
              {t('fleet.alerts', 'Alerts')}
            </AppText>
            <AnimatedNumber
              value={unreadAlerts}
              style={[
                styles.valueBase,
                { color: unreadAlerts > 0 ? TEXT_RED_500 : TEXT_EMERALD_500 },
              ]}
            />
            <AppText style={styles.subLabel}>
              {t('fleet.unread', 'unread')}
            </AppText>
          </GlassPanel>
        </StaggerItem>
      </View>
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
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  noPadding,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
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

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, noPadding ? styles.bodyNoPadding : styles.bodyPadded]}>
        {children}
      </View>
    </View>
  );
}

export default function FleetStatsWidget(_props: WidgetProps) {
  const { data: vehicles } = useVehicles();
  const {
    data: analytics,
    isFetching: analyticsFetching,
    isStale: analyticsStale,
    isError: analyticsError,
    dataUpdatedAt: analyticsUpdatedAt,
    refetch: refetchAnalytics,
  } = useFleetAnalytics(30);
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  const primaryId = vehicles?.[0]?.id ?? 0;
  const { data: recentDrives } = useQuery({
    queryKey: ['drives', primaryId, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${primaryId}&limit=5`),
    enabled: primaryId > 0,
  });
  const { data: recentCharges } = useQuery({
    queryKey: ['charging', primaryId, 'recent-5'],
    queryFn: () =>
      request<ChargingSession[]>(
        `/charging?vehicle_id=${primaryId}&limit=5`,
      ),
    enabled: primaryId > 0,
  });

  const vehicleCount = vehicles?.length ?? 0;
  const onlineCount =
    vehicles?.filter(v => v.state === 'online').length ?? 0;

  return (
    <WidgetShell
      noPadding
      updatedAt={analyticsUpdatedAt}
      isFetching={analyticsFetching}
      isStale={analyticsStale}
      isError={analyticsError}
      onRefresh={() => refetchAnalytics()}
    >
      <FleetStatsBar
        analytics={
          analytics as Parameters<typeof FleetStatsBar>[0]['analytics']
        }
        vehicleCount={vehicleCount}
        onlineCount={onlineCount}
        unreadAlerts={0}
        recentDrives={
          recentDrives as Parameters<typeof FleetStatsBar>[0]['recentDrives']
        }
        recentCharges={
          recentCharges as Parameters<typeof FleetStatsBar>[0]['recentCharges']
        }
        toDistanceDisplay={toDistanceDisplay}
        toEfficiencyDisplay={toEfficiencyDisplay}
        distanceUnit={distanceUnit}
        efficiencyUnit={efficiencyUnit}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyNoPadding: {
    overflow: 'hidden',
  },
  bodyPadded: {
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  cell: {
    paddingBottom: 8, // grid row gap
    paddingHorizontal: 4, // grid column gap (gap-2 -> 4px each side)
    width: '50%', // grid-cols-2 (mobile-first base)
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
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
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    fontWeight: '500',
    letterSpacing: 0.5,
    marginBottom: 4, // mb-1
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  miniChartWrap: {
    alignSelf: 'center',
    marginTop: 4,
  },
  panel: {
    alignItems: 'center', // text-center
    justifyContent: 'center', // flex flex-col justify-center
    minHeight: 96, // approximates h-full equal-height fill
    paddingHorizontal: 12, // p-3
    paddingVertical: 12, // p-3
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  subLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    marginTop: 4, // mt-1
    textAlign: 'center',
  },
  valueAmber: {
    color: TEXT_AMBER_300,
  },
  valueBase: {
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    textAlign: 'center',
  },
  valueCyan: {
    color: TEXT_CYAN_300,
  },
  valueEmerald: {
    color: TEXT_EMERALD_300,
  },
  valuePrimary: {
    color: colors.textPrimary,
  },
});
