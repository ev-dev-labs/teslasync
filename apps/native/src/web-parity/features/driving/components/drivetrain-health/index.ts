// Native parity port of
// web/src/features/driving/components/drivetrain-health/index.ts.
//
// The web file is a pure re-export barrel that surfaces the twelve
// drivetrain-health section components consumed by DrivetrainHealthPage:
//   L1  HealthOverview          L7  StatorTempChart
//   L2  HealthGaugeGrid         L8  TorqueHistoryChart
//   L3  TemperatureGauges       L9  TemperatureTrendChart
//   L4  TemperatureMetricCards  L10 PowerOutputChart
//   L5  ThermalLoadPanel        L11 HealthRecommendations
//   L6  LiveMotorStatus         L12 DetailCards
//
// This native port preserves that public API 1:1 — every one of the twelve
// named exports keeps its identifier and its exact prop contract — using React
// Native primitives + the existing native AppText / GlassPanel / theme tokens,
// and importing no DOM modules, browser HTML elements, Recharts, Leaflet, or web
// UI components. Because the output path must be `index.ts` (not `.tsx`), the
// placeholder elements are built with `React.createElement` rather than JSX.
//
// Not-yet-ported sibling dependency is reduced explicitly and documented in the
// `.parity.json` sidecar (the AnomalyDashboardPage "reproduce locally / explicit
// unavailable state" precedent): the twelve sibling implementations
// (./HealthOverview … ./DetailCards) are not present in the native parity tree
// yet, and the file-by-file conversion loop commits exactly one source file +
// sidecar at a time, so this barrel cannot re-export the real siblings without
// failing `tsc --noEmit`. Each export is therefore a native-safe placeholder
// component that renders an explicit "pending native port" notice (never a
// hidden / null section), preserving the section identity + prop shape until the
// matching sibling is converted. `nativeDrivetrainHealthBarrelCapabilities`
// records this unavailable state. The consumed external types are kept faithful:
// MotorSnapshot is imported from the already-ported native api/types; the
// constants types (HealthStatus / TempSensor / ChartDataPoint /
// MotorChartDataPoint) and the @/types/driving subset (DrivingStats /
// DrivetrainHealthData) are mirrored locally, matching the DriveTimeline
// "mirror the consumed subset" convention for not-yet-ported type modules.

import React, {type ReactElement, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';
import type {MotorSnapshot} from '../../../../api/types';

/* ── ported: ./constants types (native constants not yet ported) ──────────── */

type HealthStatus = 'good' | 'warning' | 'critical';

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

interface ChartDataPoint {
  date: string;
  powerMax: number;
  powerMin: number;
  outsideTemp: number | null;
  distance: number;
}

interface MotorChartDataPoint {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: number | null;
  axle: number | null;
}

/* ── ported: @/types/driving consumed subset (driving types not yet ported) ─ */

type DrivingStats = Record<string, unknown>;
type DrivetrainHealthData = Record<string, unknown>;

/* ── preserved sibling prop contracts (verbatim from the web siblings) ────── */

interface HealthOverviewProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
}

interface HealthGaugeGridProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  sensors: TempSensor[];
  stats: DrivingStats | undefined;
}

interface TemperatureGaugesProps {
  sensors: TempSensor[];
}

interface TemperatureMetricCardsProps {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
}

interface ThermalLoadPanelProps {
  sensors: TempSensor[];
  peakPower: number;
  avgPowerMax: number;
  stats: DrivingStats | undefined;
}

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
}

interface StatorTempChartProps {
  data: MotorChartDataPoint[];
}

interface TorqueHistoryChartProps {
  data: MotorChartDataPoint[];
}

interface TemperatureTrendChartProps {
  data: ChartDataPoint[];
}

interface PowerOutputChartProps {
  data: ChartDataPoint[];
}

interface HealthRecommendationsProps {
  overallHealth: HealthStatus;
}

interface DetailCardsProps {
  health: DrivetrainHealthData;
  peakPower: number;
  avgPowerMax: number;
  minRegenPower: number;
  stats: DrivingStats | undefined;
}

/* ── native-safe placeholder for a not-yet-ported sibling section ─────────── */

export const DRIVETRAIN_HEALTH_NATIVE_PENDING_REASON =
  'The web drivetrain-health sibling components (HealthOverview, HealthGaugeGrid, ' +
  'TemperatureGauges, TemperatureMetricCards, ThermalLoadPanel, LiveMotorStatus, ' +
  'StatorTempChart, TorqueHistoryChart, TemperatureTrendChart, PowerOutputChart, ' +
  'HealthRecommendations, DetailCards) are not yet ported to the native parity ' +
  'tree. This barrel preserves their public names + prop contracts with ' +
  'native-safe placeholders that render an explicit pending-port notice until ' +
  'each sibling is converted.';

export const nativeDrivetrainHealthBarrelCapabilities = {
  siblingComponents: {
    available: false,
    reason: DRIVETRAIN_HEALTH_NATIVE_PENDING_REASON,
  },
} as const;

function renderPendingSection(label: string): ReactElement {
  const body = React.createElement(
    View,
    {style: styles.body},
    React.createElement(
      AppText,
      {variant: 'title', weight: 'semibold'},
      label,
    ),
    React.createElement(
      AppText,
      {variant: 'caption', tone: 'muted', style: styles.caption},
      'Pending native port',
    ),
  );

  return React.createElement(GlassPanel, {style: styles.panel, children: body});
}

/* ── preserved public API: the twelve drivetrain-health section exports ───── */

export const HealthOverview: React.FC<HealthOverviewProps> = () =>
  renderPendingSection('Health Overview');

export const HealthGaugeGrid: React.FC<HealthGaugeGridProps> = () =>
  renderPendingSection('Health Gauges');

export const TemperatureGauges: React.FC<TemperatureGaugesProps> = () =>
  renderPendingSection('Temperature Gauges');

export const TemperatureMetricCards: React.FC<TemperatureMetricCardsProps> = () =>
  renderPendingSection('Temperature Metrics');

export const ThermalLoadPanel: React.FC<ThermalLoadPanelProps> = () =>
  renderPendingSection('Thermal Load');

export const LiveMotorStatus: React.FC<LiveMotorStatusProps> = () =>
  renderPendingSection('Live Motor Status');

export const StatorTempChart: React.FC<StatorTempChartProps> = () =>
  renderPendingSection('Stator Temperature');

export const TorqueHistoryChart: React.FC<TorqueHistoryChartProps> = () =>
  renderPendingSection('Torque History');

export const TemperatureTrendChart: React.FC<TemperatureTrendChartProps> = () =>
  renderPendingSection('Temperature Trend');

export const PowerOutputChart: React.FC<PowerOutputChartProps> = () =>
  renderPendingSection('Power Output');

export const HealthRecommendations: React.FC<HealthRecommendationsProps> = () =>
  renderPendingSection('Health Recommendations');

export const DetailCards: React.FC<DetailCardsProps> = () =>
  renderPendingSection('Detail Cards');

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  body: {
    gap: spacing.xs,
  },
  caption: {
    marginTop: spacing.xs,
  },
});
