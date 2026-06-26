// Native parity port of web/src/features/driving/pages/DrivingDynamicsPage.tsx.
//
// The web page is the Driving > Driving Dynamics dashboard: a `PageContainer`
// (title + subtitle + a `<VehicleSelect>` action) whose body is a single
// `space-y-6` stack of eleven driving-dynamics sections — live motor status,
// the G-force / pedal-usage / speed-gear panels, the autopilot section, the
// motor-history charts, the motor-efficiency insights, summary stats, the
// driving-coach and drive-analytics sections, and the driving-tips list. This
// port reproduces the identical data reads, state, SI->display unit handling,
// i18n key/fallback intent, and the same ordered section stack using React
// Native primitives instead of DOM / web UI components.
//
// Behaviour preserved verbatim:
//   * Data hooks `useMotorLatest(vehicleIdNum, 5000)`,
//     `useMotorHistory(vehicleIdNum, 200)`, `useDrives(vehicleIdStr)` and
//     `useDrivingCoach(vehicleIdStr)` and their API paths (via the already
//     ported web-parity hooks).
//   * State / derived names: `vehicleId`, `vehicleIdStr`, `vehicleIdNum`,
//     `motorLatest`/`motorLoading`, `motorHistory`, `drives`, `coachData`,
//     `unitPrefs`, `toDistanceDisplay`, `distanceUnit`, `speedUnit`,
//     `tempUnit`, `toSpeedDisplay`, `toTemperatureDisplay`,
//     `startDate`/`setStartDate`, `endDate`/`setEndDate`, `filteredDrives`,
//     `motorStats`, `throttleStyle`.
//   * The 30-day default date window, the `filteredDrives` memo (filtering on
//     `d.startTs?.slice(0, 10)`), and the `motorStats`/`throttleStyle` memos.
//   * The SI display converters `convertDistanceFromSI`/`convertSpeedFromSI`/
//     `convertTempFromSI` (backend is SI: meters, m/s, °C) — inlined with the
//     exact same constants and switch bodies as `@/lib/unitConversion`.
//   * `computeMotorStats` / `getThrottleStyle` (and the `MotorStats` /
//     `ThrottleStyle` types) — inlined verbatim from the not-yet-ported
//     `../components/driving-dynamics/helpers` module.
//   * The i18n keys `dynamics.title` / `dynamics.subtitle` and their English
//     fallbacks.
//   * Every section, in the same order, with the same props.
//
// Platform dependency swaps (no DOM, Recharts, Leaflet, framer-motion,
// react-router, or web UI components in native output — contract rule 4):
//   * `useTranslation` (react-i18next) -> `useNativeT`, a `t(key, fallback)`
//     that returns the English fallback (the page uses no interpolation vars).
//   * `useUnits` (which derives prefs from `useSettings`) -> `useNativeUnits`,
//     deriving the SAME distance/speed/temperature prefs directly from the
//     ported `useSettings()` query (mi -> mi/mph, F -> °F; km/km·h⁻¹/°C
//     otherwise).
//   * `useSelectedVehicle` (global store) + `<VehicleSelect>` (global form
//     component + react-router URL scope) -> `useNativeSelectedVehicle`
//     (first-vehicle default + local override) + a native pressable-chip
//     `VehicleSelect`; the store/URL precedence is browser-only (documented in
//     the sidecar).
//   * `usePageTitle` (document.title) -> `useNativePageTitle` no-op; the page
//     header still renders the title.
//   * `PageContainer` (`@/components/layout`) -> a native ScrollView layout
//     with the same title/subtitle/actions header and the same
//     loading/error/children precedence; the web `<Spinner>` -> RN
//     `ActivityIndicator`.
//   * `<div className="space-y-6">` -> a `<View>` with a 24px (Tailwind
//     space-y-6) vertical gap.
//   * The eleven section components are imported from the native-safe
//     `../components/driving-dynamics` barrel (each is a "native port pending"
//     placeholder until its dedicated file is ported); their props are passed
//     through unchanged.

import React, {useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useDrives, useDrivingCoach} from '../../../api/hooks/useDriving';
import {
  useMotorHistory,
  useMotorLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import type {MotorSnapshot} from '../../../api/types';
import {
  AutopilotSection,
  DriveAnalyticsSection,
  DrivingCoachSection,
  DrivingTips,
  GForcePanel,
  LiveMotorStatus,
  MotorEfficiencyInsights,
  MotorHistoryCharts,
  PedalUsage,
  SpeedGearPanel,
  SummaryStats,
} from '../components/driving-dynamics';

/* ── i18n swap ──────────────────────────────────────────────────────────── */

// react-i18next swap: the page calls `t(key, fallback)` with no interpolation
// vars, so the native shim simply returns the English fallback.
type NativeT = (key: string, fallback: string) => string;

function useNativeT(): NativeT {
  return useMemo<NativeT>(() => (_key, fallback) => fallback, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

/* ── Unit conversion (inlined from @/lib/unitConversion) ────────────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;

// Convert distance from SI meters to the user's display unit.
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

// Convert speed from SI meters-per-second to the user's display unit.
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// Convert temperature from SI Celsius to the user's display unit.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

/* ── useUnits swap (derive prefs from useSettings) ──────────────────────── */

interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
}

// Mirror of `useUnits().unitPrefs` resolved from `useSettings()`: distance/speed
// follow `unit_of_length` ('mi' -> mi/mph, else km/km·h⁻¹) and temperature
// follows `unit_of_temp` ('F' -> °F, else °C). The web defaults apply when
// settings are absent.
function useNativeUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return useMemo<{unitPrefs: UnitPrefs}>(() => {
    const distance: DistanceUnitPref =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const speed: SpeedUnitPref =
      settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
    const temperature: TemperatureUnitPref =
      settings?.unit_of_temp === 'F' ? '°F' : '°C';
    return {unitPrefs: {distance, speed, temperature}};
  }, [settings]);
}

/* ── Motor stats helpers (inlined from driving-dynamics/helpers) ─────────── */

type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

interface MotorStats {
  totalReadings: number;
  avgTorque: number;
  maxTorque: number;
  avgMotorTemp: number;
  maxMotorTemp: number;
  avgPower: number;
  peakPower: number;
  minPower: number;
  peakRegen: number;
  highTorquePct: number;
}

function getThrottleStyle(avgPower: number): ThrottleStyle {
  if (avgPower < 20) return 'conservative';
  if (avgPower < 80) return 'moderate';
  return 'aggressive';
}

function computeMotorStats(
  motorHistory: MotorSnapshot[] | undefined,
): MotorStats | null {
  const h = motorHistory ?? [];
  if (h.length === 0) return null;

  const vals = (fn: (s: MotorSnapshot) => number | undefined | null) =>
    h.map(fn).filter((v): v is number => v != null);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
  const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0);

  const torques = vals(s => {
    const f = s.torque_nm_front ?? 0;
    const r = s.torque_nm_rear ?? 0;
    if (s.torque_nm_front == null && s.torque_nm_rear == null) return null;
    return f + r;
  });
  const motorTemps = vals(s => {
    const f = s.motor_temp_c_front;
    const r = s.motor_temp_c_rear;
    if (f == null && r == null) return null;
    return Math.max(f ?? -Infinity, r ?? -Infinity);
  });
  const powers = vals(s => s.power_kw);
  const regens = vals(s => s.regen_kw);

  return {
    totalReadings: h.length,
    avgTorque: avg(torques),
    maxTorque: max(torques),
    avgMotorTemp: avg(motorTemps),
    maxMotorTemp: max(motorTemps),
    avgPower: avg(powers),
    peakPower: max(powers),
    minPower: min(powers),
    peakRegen: max(regens),
    highTorquePct:
      torques.length > 0
        ? (torques.filter(t => t > 200).length / torques.length) * 100
        : 0,
  };
}

/* ── useSelectedVehicle swap ────────────────────────────────────────────── */

interface VehicleOption {
  id: number;
  label: string;
}

// Parity for `useSelectedVehicle` + the global `<VehicleSelect>`: defaults to
// the first vehicle once the fleet loads and allows a local override (the
// store/URL precedence is browser-only). A single instance backs both the
// `vehicleId` read and the `<VehicleSelect>` action so they stay in sync, just
// like the shared web store.
function useNativeSelectedVehicle(): {
  vehicleId: number | null;
  options: VehicleOption[];
  setVehicleId: (id: number | null) => void;
} {
  const {data: vehicles} = useVehicles();
  const [override, setOverride] = useState<number | null>(null);
  const list = vehicles ?? [];
  const firstId = list.length > 0 ? list[0].id : null;
  const vehicleId = override ?? firstId;
  const options = list.map(v => ({
    id: v.id,
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return {vehicleId, options, setVehicleId: setOverride};
}

/* ── Native shared-component re-implementations ─────────────────────────── */

// `<PageContainer title subtitle loading error actions>` -> native scroll
// layout. `loading` shows a spinner instead of the body; `error` shows the
// message; otherwise the children render (mirrors the web precedence).
function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText tone="muted" style={styles.subtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText tone="danger">{error.message}</AppText>
        </View>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </ScrollView>
  );
}

// `<VehicleSelect>` — native pressable chip cycling the fleet (the URL scope is
// browser-only; this mirrors the picker behaviour with a local override).
function VehicleSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: VehicleOption[];
  onChange: (id: number | null) => void;
}) {
  const current = options.find(o => o.id === value);
  const label = current?.label ?? 'Vehicle';
  const onPress = () => {
    if (options.length === 0) {
      return;
    }
    const idx = options.findIndex(o => o.id === value);
    const next = options[(idx + 1) % options.length];
    onChange(next.id);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Selected vehicle ${label}`}
      disabled={options.length <= 1}
      onPress={onPress}
      style={styles.vehicleChip}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function DrivingDynamicsPage() {
  const t = useNativeT();
  useNativePageTitle(t('dynamics.title', 'Driving Dynamics'));

  /* ---- vehicle selection ---- */
  const {vehicleId, options: vehicleOptions, setVehicleId} =
    useNativeSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- data hooks ---- */
  const vehicleIdNum = vehicleId ?? 0;
  const {data: motorLatest, isLoading: motorLoading} = useMotorLatest(
    vehicleIdNum,
    5000,
  );
  const {data: motorHistory} = useMotorHistory(vehicleIdNum, 200);
  const {data: drives} = useDrives(vehicleIdStr);
  const {data: coachData} = useDrivingCoach(vehicleIdStr);

  /* ---- settings ---- */
  const {unitPrefs} = useNativeUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  /* ---- date filter (page-scoped: used by SpeedGear + DriveAnalytics) ---- */
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  /* ---- filtered drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter(d => {
      const driveDate = d.startTs?.slice(0, 10) ?? '';
      return driveDate >= startDate && driveDate <= endDate;
    });
  }, [drives, startDate, endDate]);

  /* ---- motor stats (cross-section) ---- */
  const motorStats = useMemo(() => computeMotorStats(motorHistory), [
    motorHistory,
  ]);
  const throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t(
        'dynamics.subtitle',
        'Live motor telemetry, G-forces & driving analysis',
      )}
      loading={motorLoading}
      error={null}
      actions={
        <VehicleSelect
          value={vehicleId}
          options={vehicleOptions}
          onChange={setVehicleId}
        />
      }>
      <View style={styles.stack}>
        <LiveMotorStatus
          motorLatest={motorLatest}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />
        <GForcePanel vehicleId={vehicleId} />
        <PedalUsage vehicleId={vehicleId} />
        <SpeedGearPanel
          motorLatest={motorLatest}
          filteredDrives={filteredDrives}
          toSpeedDisplay={toSpeedDisplay}
          speedUnit={speedUnit}
        />
        <AutopilotSection vehicleId={vehicleId} />
        <MotorHistoryCharts
          motorHistory={motorHistory}
          toSpeedDisplay={toSpeedDisplay}
          speedUnit={speedUnit}
        />
        <MotorEfficiencyInsights
          motorStats={motorStats}
          throttleStyle={throttleStyle}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />
        <SummaryStats
          motorStats={motorStats}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />
        <DrivingCoachSection coachData={coachData} />
        <DriveAnalyticsSection
          filteredDrives={filteredDrives}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          toDistanceDisplay={toDistanceDisplay}
          toSpeedDisplay={toSpeedDisplay}
          distanceUnit={distanceUnit}
          speedUnit={speedUnit}
        />
        <DrivingTips motorStats={motorStats} throttleStyle={throttleStyle} />
      </View>
    </PageContainer>
  );
}

// space-y-6 (1.5rem = 24px) vertical rhythm between the stacked sections.
const SECTION_GAP = 24;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  body: {
    gap: spacing.lg,
  },
  stack: {
    gap: SECTION_GAP,
  },
  loadingBox: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  vehicleChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});
