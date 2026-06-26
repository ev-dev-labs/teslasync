// Native parity port of web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx.
//
// `MotorPerformanceWidget` is a dashboard widget that surfaces the active
// vehicle's drive-unit (motor) telemetry. It has two layouts driven by
// `size.cols`:
//   - compact (cols <= 1): a stacked Gear label/value + Torque label/value, or
//     an empty state when there is no motor data.
//   - full: a titled shell whose body is a torque RadialGauge + a 2×2 grid of
//     StatCards (Stator Temp, Gear State, Lateral G, Longitudinal G), or an
//     empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `TORQUE_MAX = 600` const (L15) and the module-level `torqueColor` thresholds
// (L17-21: <200 #10b981, <400 #f59e0b, else #ef4444); the
// `toTemperatureDisplay = (v) => convertTempFromSI(v, unitPrefs.temperature)`
// closure (L26) + `tempUnit = unitPrefs.temperature` (L28); the
// `vid = vehicleId ?? vehicles?.[0]?.id` resolution (L29-30) feeding
// `useMotorLatest(vid ?? 0)` (L32-36); the destructured query result
// (data/isLoading/error/isFetching/isStale/isError/dataUpdatedAt/refetch);
// `isCompact = size.cols <= 1` (L38) and `hasData = !!data` (L39); the data
// derivations `torque = data?.di_torque ?? 0` (L41),
// `statorTemp = data?.di_stator_temp ?? data?.motor_temp_c_front ?? null` (L42),
// `gear = data?.gear ?? data?.shift_state ?? '—'` (L43), the
// `raw`/`lateralG`/`longitudinalG` unknown-cast safe reads (L46-48), and the
// memoized `gaugeColor = torqueColor(Math.abs(torque))` (L50); the `shellProps`
// bag (L52-60) plus the compact branch's redundant updatedAt/isFetching/isStale/
// isError/onRefresh overrides (L64-69). Every i18n key + English default
// (widget.motorPerformance.gear/torque/nm/noData/title/statorTemp/gearState/
// lateralG/longitudinalG) and the literal 'g' G-force unit are kept verbatim,
// and the `di_torque`/`di_stator_temp`/`motor_temp_c_front`/`gear`/`shift_state`/
// `lateral_accel`/`longitudinal_accel` field names are read identically. The
// `useMotorLatest` `/motor/latest?vehicle_id=` API path is reached through the
// already-ported web-parity hook.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (same shim shape as the
//     AnomalyDetector / BatteryDegradation widget ports); the namespace arg is
//     accepted + ignored. No `{{var}}` interpolation is needed by this widget.
//   - lucide-react `Zap` (L3) -> there is no `react-native-svg` dependency, so it
//     renders a decorative "⚡" glyph stand-in via `<GlyphIcon>` (the
//     AnomalyDetector glyph precedent): the header keeps the web
//     `text-yellow-400` (#facc15) intent; the empty-state icons inherit the
//     muted token, matching the web `EmptyState` icon styling.
//   - `@/components/charts` `RadialGauge` (L4) -> the already-ported web-parity
//     native `RadialGauge` (View-segment arc approximation) imported from the
//     charts barrel — same value/max/label/unit/color/size contract.
//   - `@/components/data-display` `StatCard` (L5) -> not yet ported, so the
//     label+value(+unit) subset is reproduced locally as `<LocalStatCard>` (a
//     var(--surface-1)/--glass-border card); the StatCard icon/trend/sublabel/
//     loading affordances are unused here and omitted.
//   - `@/components/feedback` `EmptyState` (L6) -> not yet ported, reproduced as
//     `<LocalEmptyState>` (centred glyph + muted message); the web `py-2`/`py-4`
//     paddings map to a `dense` flag. The "no-action transient empty state"
//     intent is preserved.
//   - `@/hooks/useUnits` `useUnits` (L9) -> a local shim exposing
//     `unitPrefs.temperature`. There is no native settings/locale port yet, so it
//     returns '°C' (SI floor); the display-boundary conversion contract is kept.
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` (L10) -> inlined native-safe
//     equivalents (+ their `safeNumber` dep): nullish/non-finite -> 0, en-US
//     locale, the per-call precision arg honoured (fmtInt = 0 dp).
//   - `@/lib/unitConversion` `convertTempFromSI` (L13) -> inlined verbatim
//     (°C identity, °F = c*9/5+32) with a local TemperatureUnitPref type.
//   - `./WidgetShell` `WidgetShell` (L11) -> reproduced locally as a native
//     `<WidgetShell>` (sibling not yet ported, same self-contained approach as
//     the AnomalyDetector port): loading -> skeleton block, error -> centred
//     danger text (surfaced, never hidden), title+icon header, the freshness chip
//     via the converted web-parity `DataFreshness` port, and the children body.
//     The web pulse-on-data-change box-shadow glow has no native analog and is
//     intentionally omitted (documented in the sidecar); the help-tooltip /
//     pin-button header slots are unused by this widget and are not modeled.
//   - `./types` `WidgetProps` (L12) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary.

import React, { useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { RadialGauge } from '../../../components/charts';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useMotorLatest, useVehicles } from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt) ────────────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale, the per-call precision arg is honoured.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ── Inlined `@/lib/unitConversion` `convertTempFromSI` ────────────────────────
type TemperatureUnitPref = '°C' | '°F';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// ── useUnits shim (web @/hooks/useUnits) ─────────────────────────────────────
// No native settings/locale port yet; the SI floor is °C. The display-boundary
// conversion contract (read SI, convert at render) is preserved.
interface UnitPrefsShim {
  temperature: TemperatureUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShim } {
  return { unitPrefs: { temperature: '°C' } };
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

// ── lucide `Zap` glyph stand-in ──────────────────────────────────────────────
const YELLOW_400 = '#facc15'; // text-yellow-400

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
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Module-level `torqueColor` (web L17-21, verbatim thresholds) ──────────────
const TORQUE_MAX = 600;

function torqueColor(nm: number): string {
  if (nm < 200) {
    return '#10b981';
  }
  if (nm < 400) {
    return '#f59e0b';
  }
  return '#ef4444';
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
  dense,
}: {
  icon?: ReactNode;
  message: string;
  dense?: boolean;
}) {
  // no-action: transient empty state — surfaces when source data is missing;
  // no specific recovery action available.
  return (
    <View style={[styles.emptyState, dense ? styles.emptyStateDense : null]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `StatCard` (web @/components/data-display, label+value subset) ──────
interface LocalStatCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

function LocalStatCard({ label, value, unit }: LocalStatCardProps) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statLabelRow}>
        <AppText style={styles.statLabel}>{label}</AppText>
      </View>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? <AppText style={styles.statUnit}>{unit}</AppText> : null}
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
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function MotorPerformanceWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMotorLatest(vid ?? 0);

  const isCompact = size.cols <= 1;
  const hasData = !!data;

  const torque = data?.di_torque ?? 0;
  const statorTemp = data?.di_stator_temp ?? data?.motor_temp_c_front ?? null;
  const gear = data?.gear ?? data?.shift_state ?? '—';
  // lateral_accel / longitudinal_accel may be present in the API response
  // but are not yet in the MotorSnapshot interface — access safely via unknown cast.
  const raw = data as unknown as
    | Record<string, number | null | undefined>
    | undefined;
  const lateralG = raw?.lateral_accel ?? null;
  const longitudinalG = raw?.longitudinal_accel ?? null;

  const gaugeColor = useMemo(() => torqueColor(Math.abs(torque)), [torque]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <View style={styles.compactBody}>
          {hasData ? (
            <>
              <AppText style={styles.compactLabel}>
                {t('widget.motorPerformance.gear', 'Gear')}
              </AppText>
              <AppText style={styles.compactGear}>{gear}</AppText>
              <AppText style={styles.compactLabelSpaced}>
                {t('widget.motorPerformance.torque', 'Torque')}
              </AppText>
              <AppText style={styles.compactTorque}>
                {fmtInt(torque)} {t('widget.motorPerformance.nm', 'Nm')}
              </AppText>
            </>
          ) : (
            <LocalEmptyState
              dense
              icon={
                <GlyphIcon glyph="⚡" color={colors.textMuted} size={20} />
              }
              message={t('widget.motorPerformance.noData', 'No motor data')}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorPerformance.title', 'Motor Performance')}
      icon={<GlyphIcon glyph="⚡" color={YELLOW_400} size={14} />}
      {...shellProps}
    >
      {hasData ? (
        <View style={styles.fullColumn}>
          <RadialGauge
            value={Math.abs(torque)}
            max={TORQUE_MAX}
            label={fmtInt(torque)}
            unit={t('widget.motorPerformance.nm', 'Nm')}
            color={gaugeColor}
            size={100}
          />
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <LocalStatCard
                label={t('widget.motorPerformance.statorTemp', 'Stator Temp')}
                value={
                  statorTemp != null
                    ? fmtNumber(toTemperatureDisplay(statorTemp), 0)
                    : '—'
                }
                unit={statorTemp != null ? tempUnit : undefined}
              />
            </View>
            <View style={styles.gridItem}>
              <LocalStatCard
                label={t('widget.motorPerformance.gearState', 'Gear State')}
                value={gear}
              />
            </View>
            <View style={styles.gridItem}>
              <LocalStatCard
                label={t('widget.motorPerformance.lateralG', 'Lateral G')}
                value={lateralG != null ? fmtNumber(lateralG, 2) : '—'}
                unit={lateralG != null ? 'g' : undefined}
              />
            </View>
            <View style={styles.gridItem}>
              <LocalStatCard
                label={t(
                  'widget.motorPerformance.longitudinalG',
                  'Longitudinal G',
                )}
                value={longitudinalG != null ? fmtNumber(longitudinalG, 2) : '—'}
                unit={longitudinalG != null ? 'g' : undefined}
              />
            </View>
          </View>
        </View>
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph="⚡" color={colors.textMuted} size={20} />}
          message={t('widget.motorPerformance.noData', 'No motor data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 4, // gap-1
    justifyContent: 'center',
    minHeight: 44, // min-h-[44px]
  },
  compactGear: {
    color: colors.textPrimary,
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
    lineHeight: 28,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  compactLabelSpaced: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    marginTop: 4, // mt-1
    textTransform: 'uppercase',
  },
  compactTorque: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md, // py-4
  },
  emptyStateDense: {
    paddingVertical: spacing.sm, // py-2
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
  fullColumn: {
    alignItems: 'center',
    rowGap: 12, // gap-3
  },
  grid: {
    columnGap: 12, // gap-3
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12, // gap-3
    width: '100%', // w-full
  },
  gridItem: {
    flexBasis: '47%', // grid-cols-2
    flexGrow: 1,
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
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  statCard: {
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    padding: 16, // p-4
    rowGap: 4, // gap-1
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  statLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
  },
  statValueRow: {
    alignItems: 'flex-end', // items-baseline
    flexDirection: 'row',
    gap: 4, // gap-1
  },
});
