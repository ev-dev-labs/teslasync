// ChargeStatusWidget — native parity port of
// web/src/features/dashboard/widgets/ChargeStatusWidget.tsx.
//
// The dashboard "Charge Status" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// that vehicle's live state (`GET /vehicles/{id}/state` via useVehicleState). The
// body has three branches, preserved verbatim from the web source:
//   1. state.is_charging -> a "Charging" header (BatteryCharging glyph + label)
//      over a 2-column grid: Power (kW), Rate (display-distance/h), Battery (%),
//      and Time to Full (hours, or "—" when not positive).
//   2. otherwise, when state exists -> a centered "Not Charging" block (Zap glyph
//      + label + "{battery_level}% · {rated_range} {unit}" summary line).
//   3. no state -> an EmptyState (Zap glyph + "No charge data").
// Every state name (vehicles, id, stateData, state, distanceUnit), API path,
// SI->display unit conversion, number-format precision, the i18n key + English
// fallback for each label, and each render branch is preserved; all 87 source
// lines are mapped in the .parity.json sidecar.
//
// SI-floor (web L16-17): state.rated_range and state.charge_rate arrive in
// METERS / metres·h⁻¹; convertDistanceFromSI handles the metres->user-unit
// conversion at the display boundary (the native hook normalises both to SI),
// and charger_power stays raw kW exactly like the web source.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L1/L12) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN).
//   - lucide-react Zap / BatteryCharging (web L2) -> the native SemanticIcon
//     glyphs 'bolt' (Zap = lightning bolt) and 'batteryCharging' (lucide is
//     browser-only). The BatteryCharging `animate-pulse` loop is purely cosmetic
//     and has no static-class equivalent, so the native glyph is rendered static.
//   - @/components/feedback EmptyState (web L3) -> an inline native EmptyState
//     (centered icon chip + muted message) — the feedback barrel is not in the
//     native parity manifest, so it is reproduced self-contained per the
//     BatteryGaugeWidget precedent.
//   - @/api/hooks useVehicles/useVehicleState (web L4) -> imported from their
//     canonical converted native hooks (../../../api/hooks/useVehicles) — same
//     query keys, same /vehicles + /vehicles/{id}/state paths, same fields.
//   - @/hooks/useUnits useUnits (web L5) -> an inline native useUnits that reads
//     the native useSettings (unit_of_length 'mi' -> 'mi' display, else 'km';
//     deriveDistance never yields 'ft', matching the web hook). Only unitPrefs.
//     distance is consumed, exactly like the web source.
//   - @/lib/unitConversion convertDistanceFromSI (web L6) -> ported inline
//     verbatim (metres / 1000 km, metres / 1609.344 mi, metres / 0.3048 ft).
//   - @/lib/numberFormat fmtNumber/fmtInt (web L7) -> ported inline (en-US
//     toLocaleString, default 2 fraction digits = the web global-precision
//     default; fmtInt === fmtNumber(v, 0)).
//   - ./WidgetShell (web L8) + ./types WidgetProps (web L9) -> reproduced
//     self-contained here: these sibling widget primitives have their own
//     (later) manifest entries and are not yet in the native tree, so the shell
//     chrome and the WidgetProps/WidgetSize types are ported inline (the
//     BatteryGaugeWidget conversion established this inline-reproduction
//     pattern). WidgetShell's browser-only DataFreshness/PinButton/HelpTooltip/
//     Skeleton/QueryError chrome becomes a native-safe freshness pill (relative
//     "updated" time + a refresh Pressable wired to onRefresh, with stale/error/
//     fetching markers) and a dimmed skeleton box.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon, the parity hooks, and theme tokens.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `size`/`config` are accepted
 *  for source parity but, like the web source, this widget reads only
 *  `vehicleId`. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported unit conversion (web @/lib/unitConversion convertDistanceFromSI) ───

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

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

// ── Ported number format (web @/lib/numberFormat fmtNumber/fmtInt) ────────────

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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

// ── Inline native useUnits (web @/hooks/useUnits) — reads native useSettings ──

interface UnitPrefsLite {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const unitPrefs = React.useMemo<UnitPrefsLite>(
    () => ({distance}),
    [distance],
  );
  return {unitPrefs};
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0) label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError ? styles.freshnessError : isStale ? styles.freshnessStale : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
}

function WidgetShell({
  title,
  icon,
  loading,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function ChargeStatusWidget({vehicleId}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch} =
    useVehicleState(id);
  /* SI-floor: state.rated_range and state.charge_rate arrive in METERS / m·h⁻¹.
   * convertDistanceFromSI handles the meters→user-unit conversion. */
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const stateValue = stateData?.state;
  const state =
    stateValue != null && typeof stateValue === 'object' ? stateValue : undefined;

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      <View style={styles.centerBody}>
        {state?.is_charging ? (
          <View style={styles.chargingContainer}>
            <View style={styles.chargingHeader}>
              {glyphNode('batteryCharging', colors.success, styles.glyphHeader)}
              <AppText style={styles.chargingHeaderLabel}>
                {t('widget.charging', 'Charging')}
              </AppText>
            </View>
            <View style={styles.chargingGrid}>
              <View style={styles.gridCell}>
                <AppText style={styles.chargeLabel}>{t('widget.power', 'Power')}</AppText>
                <AppText style={styles.powerValue}>
                  {`${fmtNumber(state.charger_power)} kW`}
                </AppText>
              </View>
              <View style={styles.gridCell}>
                <AppText style={styles.chargeLabel}>{t('widget.rate', 'Rate')}</AppText>
                <AppText style={styles.chargeValue}>
                  {`${fmtInt(convertDistanceFromSI(state.charge_rate ?? 0, distanceUnit))} ${distanceUnit}/h`}
                </AppText>
              </View>
              <View style={styles.gridCell}>
                <AppText style={styles.chargeLabel}>{t('widget.battery', 'Battery')}</AppText>
                <AppText style={styles.chargeValue}>{`${state.battery_level}%`}</AppText>
              </View>
              <View style={styles.gridCell}>
                <AppText style={styles.chargeLabel}>
                  {t('widget.timeToFull', 'Time to Full')}
                </AppText>
                <AppText style={styles.chargeValue}>
                  {state.time_to_full_charge > 0
                    ? `${fmtNumber(state.time_to_full_charge, 1)}h`
                    : '—'}
                </AppText>
              </View>
            </View>
          </View>
        ) : state ? (
          <View style={styles.notChargingContainer}>
            {glyphNode('bolt', colors.textMuted, styles.glyphLarge)}
            <AppText style={styles.notChargingTitle}>
              {t('widget.notCharging', 'Not Charging')}
            </AppText>
            <AppText style={styles.notChargingSub}>
              {`${state.battery_level}% \u00B7 ${fmtNumber(
                convertDistanceFromSI(state.rated_range ?? 0, distanceUnit),
                0,
              )} ${distanceUnit}`}
            </AppText>
          </View>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <EmptyState
            icon={glyphNode('bolt', colors.textMuted, styles.iconGlyph)}
            message={t('widget.noChargeData', 'No charge data')}
          />
        )}
      </View>
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  centerBody: {
    flex: 1,
    justifyContent: 'center',
  },
  chargeLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  chargeValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  chargingContainer: {
    gap: 12,
  },
  chargingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  chargingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  chargingHeaderLabel: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  glyphHeader: {
    fontSize: 13,
    lineHeight: 16,
  },
  glyphLarge: {
    fontSize: 20,
    lineHeight: 24,
    marginBottom: 8,
    textAlign: 'center',
  },
  gridCell: {
    width: '48%',
  },
  iconGlyph: {
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 14,
    textAlign: 'center',
  },
  notChargingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notChargingSub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  notChargingTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  powerValue: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
});
