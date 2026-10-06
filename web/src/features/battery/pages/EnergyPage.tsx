import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Zap, Leaf, Fuel, Sun, Moon, Activity, Gauge,
  DollarSign, Route, BatteryCharging, CalendarDays, TrendingUp,
  CircleAlert, Thermometer, MapPinned,
} from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard } from '@/components/layout';
import {
  BatteryPanelGrid, BatterySpecialistSummary, CostComparisonCard,
} from '../components/modernization';
import type { BatterySummaryMetric } from '../components/modernization/BatterySpecialistSummary';
import { BatteryEvidenceBrief } from '../components/operationalbrief-all/BatteryEvidenceBrief';
import {
  DataTable, Badge, Text, Caption,
  HelperText, type Column,
} from '@/components/ui';
import {
  ThresholdBar, ChartLegend, ChartTooltip, ChartGradient,
  chartGrid, axisTickSm, renderAnnotationLines,
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, ReferenceLine,
  PieChart, Pie, Cell, Brush, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
  ChartTimeRangeProvider, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import {
  AlertBanner,
  Skeleton,
  QueryError,
  EmptyState,
  ChartBlockSkeleton,
  StaleRefreshWarning,
} from '@/components/feedback';
import {
  Currency,
  DataFreshnessAuto,
  DataProvenanceBadge,
  SavedViewMenu,
  MetricTile,
  OperationalBrief,
  type OperationalAttention,
  type OperationalTone,
} from '@/components/data-display';


import { useEnergyStats, useVampireDrainStats } from '@/api/hooks/useEnergy';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useDataState } from '@/hooks/useDataState';
import { formatDateShort, formatDayKey, ymdInTz } from '@/lib/dateFormat';

import { CHARGER_COLORS } from '@/lib/colors';
import { chartTokens, type NeonColor } from '@/lib/tokens';
import type { ChargingSession } from '@/api/types';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { convertDistanceFromSI, convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { useTimezone } from '@/lib/timezone';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ── Local: Cost Comparison Card ────────────────────────────────── */

/**
 * Efficiency thresholds, in Wh per **metre** — the unit the API reports
 * (`avg_efficiency_wh_per_m`) and the input `toEfficiencyDisplay` expects.
 *
 * The previous ceiling was `toEfficiencyDisplay(300)`, which fed 300 Wh/m into
 * a converter that multiplies by 1000, producing a 300 000 Wh/km scale. A real
 * 180 Wh/km reading filled 0.06% of that ring, so the gauge was blank for every
 * user. The intended ceiling was plainly 300 Wh/km = 0.3 Wh/m.
 */
const EFFICIENCY_EXCELLENT_WH_PER_M = 0.14;
const EFFICIENCY_GOOD_WH_PER_M = 0.18;
const EFFICIENCY_AVERAGE_WH_PER_M = 0.22;
const EFFICIENCY_MAX_WH_PER_M = 0.3;
const CO2_SAVED_KG_PER_KWH = 0.4;

function inclusiveDayCount(start: string, end: string, fallback = 30): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return fallback;
  }
  return Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);
}

/* ── Page ────────────────────────────────────────────────────────── */

/**
 * Render-prop helper that subscribes the inner recharts chart to the
 * surrounding `<ChartTimeRangeProvider>`. The two daily-energy
 * panels share the same `daily_breakdown` dataset (matching `date` axis), so
 * they sync hover cursors and a persistent reference line through this helper.
 */
function EnergyChartSync({
  children, }: {
  children: (state: {
    sync: ReturnType<typeof useSyncedCursor>;
    syncedX: ReturnType<typeof useSyncedReferenceLineX>;
  }) => ReactNode;
}) {
  const sync = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  return <>{children({ sync, syncedX })}</>;
}

export default function EnergyPage() {
  const { fmtPercent, fmtNumber, fmtInt, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('energy.title', 'Energy'));
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency, currencySymbol, estimateGasCost } = useFormatting();
  const timezone = useTimezone();
  const sessionHourFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }),
    [timezone],
  );
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const toEnergyDisplay = (wh: number) => convertEnergyFromSI(wh, unitPrefs.energy);

  const distanceUnit = unitPrefs.distance;
  const energyUnit = unitPrefs.energy;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerM: number) => unitPrefs.distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000;
  const savedView = useSavedViewUrl();

  /* ── Vehicle selector ─────────────────────────────────────────── */
  const { vehicleId } = useSelectedVehicle();

  /* ── Date range ───────────────────────────────────────────────── */
  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'energy.range',
  });
  const periodDays = inclusiveDayCount(startDate, endDate);

  /* URL-persisted hidden-series state for the two-series
     energy/efficiency composed chart. */
  const energyCostHidden = useHiddenSeries('energy-cost-daily');
  /* URL-persisted hidden-series state for the efficiency + distance trend. */
  const efficiencyHidden = useHiddenSeries('energy-efficiency-trend');
  /* URL-persisted hidden-series state for energy + session-count buckets. */
  const timeOfDayHidden = useHiddenSeries('energy-charging-time-of-day');

  /* ── Data fetching ────────────────────────────────────────────── */
  const statsQuery = useEnergyStats(
    vehicleId != null ? String(vehicleId) : null,
    { start: startDate },
  );
  const {
    data: stats, isLoading, refetch,
  } = statsQuery;
  const statsDataState = useDataState(statsQuery, { provenance: 'inferred' });

  const sessionsQuery = useChargingSessionsPaginated(vehicleId, {
    limit: 100, start: startDate, end: endDate,
  });
  const sessionsDataState = useDataState(sessionsQuery, { provenance: 'historical' });
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);

  const liveChargingQuery = useChargingTelemetryLatest(vehicleId ?? 0);
  const liveChargingDataState = useDataState(liveChargingQuery, { provenance: 'live' });
  const liveCharging = liveChargingQuery.data;
  const idleDrainQuery = useVampireDrainStats(
    vehicleId != null ? String(vehicleId) : null,
  );
  const idleDrainDataState = useDataState(idleDrainQuery, { provenance: 'inferred' });

  /* ── Derived metrics ──────────────────────────────────────────── */
  const sessionCapReached = sessions.length >= 100;
  const costedSessions = sessions.filter(
    (session) =>
      typeof session.cost_decimal === 'number'
      && Number.isFinite(session.cost_decimal),
  );
  const costCoverageComplete =
    sessionsQuery.isSuccess
    && sessions.length > 0
    && costedSessions.length === sessions.length
    && !sessionCapReached;
  const totalChargingEnergyWh = sessions.reduce(
    (sum, session) => sum + (Number.isFinite(session.total_energy_added_wh) ? session.total_energy_added_wh : 0),
    0,
  );
  const costedEnergyWh = costedSessions.reduce(
    (sum, session) => sum + (Number.isFinite(session.total_energy_added_wh) ? session.total_energy_added_wh : 0),
    0,
  );
  const totalCost = costedSessions.reduce(
    (sum, session) => sum + (session.cost_decimal ?? 0),
    0,
  );
  const dailyEnergy = useMemo(
    () =>
      (stats?.daily_breakdown ?? []).filter(
        (day) => day.date >= startDate && day.date <= endDate,
      ),
    [endDate, startDate, stats?.daily_breakdown],
  );
  const scopedDriveEnergyWh = dailyEnergy.reduce(
    (sum, day) => sum + (day.energy_wh ?? 0),
    0,
  );
  const totalDistance = dailyEnergy.reduce(
    (sum, day) => sum + (day.distance_m ?? 0),
    0,
  );
  const avgEfficiency = totalDistance > 0
    ? scopedDriveEnergyWh / totalDistance
    : 0;
  const co2Saved = (scopedDriveEnergyWh / 1000) * CO2_SAVED_KG_PER_KWH;
  const measuredEfficiencyDays = dailyEnergy.filter(
    (day) =>
      Number.isFinite(day.efficiency_wh_per_m)
      && (day.efficiency_wh_per_m ?? 0) > 0
      && Number.isFinite(day.distance_m)
      && (day.distance_m ?? 0) > 0,
  );
  const peakEfficiencyDay = measuredEfficiencyDays.reduce<(typeof measuredEfficiencyDays)[number] | null>(
    (peak, day) =>
      peak == null || day.efficiency_wh_per_m > peak.efficiency_wh_per_m ? day : peak,
    null,
  );
  const bestEfficiencyDay = measuredEfficiencyDays.reduce<(typeof measuredEfficiencyDays)[number] | null>(
    (best, day) =>
      best == null || day.efficiency_wh_per_m < best.efficiency_wh_per_m ? day : best,
    null,
  );
  const efficiencySpreadPct =
    peakEfficiencyDay != null
    && bestEfficiencyDay != null
    && avgEfficiency > 0
      ? ((peakEfficiencyDay.efficiency_wh_per_m - bestEfficiencyDay.efficiency_wh_per_m) / avgEfficiency) * 100
      : null;

  // Qualitative efficiency regions, converted to whichever display unit the
  // reading itself uses so the bands never disagree with the number.
  const efficiencyBands = useMemo(
    () => [
      {
        from: 0,
        to: toEfficiencyDisplay(EFFICIENCY_EXCELLENT_WH_PER_M),
        color: '#10b9818c',
        label: t('energy.gauge.band.excellent', 'Excellent'),
      },
      {
        from: toEfficiencyDisplay(EFFICIENCY_EXCELLENT_WH_PER_M),
        to: toEfficiencyDisplay(EFFICIENCY_GOOD_WH_PER_M),
        color: '#38bdf88c',
        label: t('energy.gauge.band.good', 'Good'),
      },
      {
        from: toEfficiencyDisplay(EFFICIENCY_GOOD_WH_PER_M),
        to: toEfficiencyDisplay(EFFICIENCY_AVERAGE_WH_PER_M),
        color: '#f59e0b8c',
        label: t('energy.gauge.band.average', 'Average'),
      },
      {
        from: toEfficiencyDisplay(EFFICIENCY_AVERAGE_WH_PER_M),
        to: toEfficiencyDisplay(EFFICIENCY_MAX_WH_PER_M),
        color: '#ef44448c',
        label: t('energy.gauge.band.heavy', 'Heavy'),
      },
    ],
    [unitPrefs.distance, t],
  );
  const costPerDistance =
    costCoverageComplete && totalDistance > 0
      ? totalCost / toDistanceDisplay(totalDistance)
      : null;
  const costPerKwh = costedEnergyWh > 0 ? totalCost / (costedEnergyWh / 1000) : null;
  // The shared formatter bridges SI meters to the configured gas unit and
  // efficiency. Missing/invalid fuel settings return null instead of a
  // fabricated comparison.
  const gasEquivalent = totalDistance > 0 ? estimateGasCost(totalDistance) : null;
  const observedCost = costCoverageComplete ? totalCost : null;
  const monthlyProjectedCost =
    costPerDistance != null
      ? costPerDistance * (toDistanceDisplay(totalDistance) / periodDays) * 30
      : null;
  const yearlyProjectedCost =
    observedCost != null ? (observedCost / periodDays) * 365 : null;
  const projectedMonthlyConsumptionWh =
    scopedDriveEnergyWh > 0 ? (scopedDriveEnergyWh / periodDays) * 30 : null;
  const savings =
    observedCost != null && gasEquivalent != null
      ? gasEquivalent - observedCost
      : null;

  /* The API daily breakdown is SI (Wh, Wh/m, m). Convert once to the user's
     display units so the efficiency chart plots values matching its labels. */
  const dailyEfficiencyData = useMemo(
    () =>
      dailyEnergy.map((d) => ({
        date: d.date,
        efficiency: (d.efficiency_wh_per_m ?? 0) * (distanceUnit === 'mi' ? 1609.344 : 1000),
        distance: convertDistanceFromSI(d.distance_m ?? 0, distanceUnit),
      })),
    [dailyEnergy, distanceUnit],
  );

  /* Consumption comes from the drive aggregate; recorded cost comes from
     charging sessions because the energy cagg intentionally emits cost=0. */
  const dailyConsumptionCostData = useMemo(() => {
    const rows = new Map<string, { date: string; energy: number; cost: number | null }>();
    dailyEnergy.forEach((day) => {
      rows.set(day.date, {
        date: day.date,
        energy: convertEnergyFromSI(day.energy_wh ?? 0, energyUnit),
        cost: null,
      });
    });
    sessions.forEach((session) => {
      const date = ymdInTz(new Date(session.started_at), timezone);
      if (date == null || date < startDate || date > endDate) return;
      const row = rows.get(date) ?? { date, energy: 0, cost: null };
      if (typeof session.cost_decimal === 'number' && Number.isFinite(session.cost_decimal)) {
        row.cost = (row.cost ?? 0) + session.cost_decimal;
      }
      rows.set(date, row);
    });
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyEnergy, endDate, energyUnit, sessions, startDate, timezone]);

  const secondarySourceFailures = [
    sessionsQuery.isError
      ? t('energy.sources.chargingHistory', 'charging history')
      : null,
    idleDrainQuery.isError
      ? t('energy.sources.idleDrain', 'idle-drain history')
      : null,
    liveChargingQuery.isError
      ? t('energy.sources.lifetimeTelemetry', 'lifetime telemetry')
      : null,
  ].filter((source): source is string => source != null);

  const idleDrainRate = idleDrainQuery.data?.avg_drain_pct_per_day ?? null;
  const idleDrainHigh = idleDrainRate != null && idleDrainRate >= 3;
  const costSeriesLabel = t('energy.chart.recordedCost', 'Recorded charging cost');

  /* Replay vehicles and brand-new accounts need an honest empty hero instead
     of valid-looking zeroes while independent sources resolve. */
  const hasNoEnergyData =
    (vehicleId == null || sessionsQuery.isSuccess)
    && sessions.length === 0
    && scopedDriveEnergyWh === 0
    && totalDistance === 0;

  const efficiencyTone: OperationalTone =
    avgEfficiency <= 0
      ? 'neutral'
      : avgEfficiency <= EFFICIENCY_GOOD_WH_PER_M
        ? 'success'
        : avgEfficiency <= EFFICIENCY_AVERAGE_WH_PER_M
          ? 'warning'
          : 'danger';

  const energyStatusTone: OperationalTone =
    hasNoEnergyData
      ? 'neutral'
      : idleDrainHigh
        || efficiencyTone === 'danger'
        || secondarySourceFailures.length > 0
        ? 'warning'
        : efficiencyTone;

  const energyAttention: OperationalAttention[] = [];
  if (hasNoEnergyData) {
    energyAttention.push({
      key: 'energy-data',
      title: t('operations.energy.noDataTitle', 'Energy evidence is still building'),
      description: t(
        'operations.energy.noDataDescription',
        'Complete a drive or charging session to establish efficiency and cost baselines.',
      ),
      tone: 'info',
    });
  } else {
    if (avgEfficiency > EFFICIENCY_AVERAGE_WH_PER_M) {
      energyAttention.push({
        key: 'energy-efficiency',
        title: t('operations.energy.efficiencyAttention', 'Efficiency is outside the preferred band'),
        description: t(
          'operations.energy.efficiencyAttentionDescription',
          'Compare the linked temperature, speed, and route evidence; this page does not attribute a cause.',
        ),
        tone: 'warning',
      });
    }
    if (idleDrainHigh) {
      energyAttention.push({
        key: 'idle-drain',
        title: t('operations.energy.idleDrainAttention', 'Parked drain needs review'),
        description: t(
          'operations.energy.idleDrainAttentionDescription',
          'The 90-day parked, non-charging average is {{value}} per day.',
          { value: fmtPercent(idleDrainRate) },
        ),
        tone: 'warning',
      });
    }
    if (savings != null) {
      if (savings >= 0) {
        energyAttention.push({
          key: 'energy-savings',
          title: t('operations.energy.savingsTitle', 'Electric operation remains cost-favorable'),
          description: t(
            'operations.energy.savingsDescription',
            'Estimated savings versus the configured gas-equivalent model are {{value}}.',
            { value: formatCurrency(savings) },
          ),
          tone: 'success',
        });
      } else {
        energyAttention.push({
          key: 'energy-cost-premium',
          title: t('operations.energy.costPremiumTitle', 'Recorded electric cost exceeds the gas model'),
          description: t(
            'operations.energy.costPremiumDescription',
            'Recorded charging cost is {{value}} above the configured gas-equivalent model for this distance.',
            { value: formatCurrency(Math.abs(savings)) },
          ),
          tone: 'warning',
        });
      }
    }
    if (sessions.length > 0 && !costCoverageComplete) {
      energyAttention.push({
        key: 'cost-coverage',
        title: t('operations.energy.costCoverageTitle', 'Cost coverage is partial'),
        description: t(
          'operations.energy.costCoverageDescription',
          '{{priced}} of {{total}} returned sessions include recorded cost; savings and cost projections are withheld.',
          { priced: costedSessions.length, total: sessions.length },
        ),
        tone: 'info',
      });
    }
    if (sessionCapReached) {
      energyAttention.push({
        key: 'session-cap',
        title: t('operations.energy.sessionCapTitle', 'Charging history reached the analysis cap'),
        description: t(
          'operations.energy.sessionCapDescription',
          'The latest 100 sessions are shown; older sessions may be outside cost and pattern analysis.',
        ),
        tone: 'info',
      });
    }
  }
  energyAttention.push({
    key: 'charging-loss',
    title: t('operations.energy.lossUnavailableTitle', 'Charging losses are not measured'),
    description: t(
      'operations.energy.lossUnavailableDescription',
      'Independent wall-input and battery-retained energy are absent from the session contract, so no loss percentage is fabricated.',
    ),
    tone: 'neutral',
  });

  /* ── Time-of-day analysis ─────────────────────────────────────── */
  const timeOfDayData = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const labels = [
      t('energy.timeOfDay.night', 'Night (0-6)'),
      t('energy.timeOfDay.morning', 'Morning (6-12)'),
      t('energy.timeOfDay.afternoon', 'Afternoon (12-18)'),
      t('energy.timeOfDay.evening', 'Evening (18-24)'),
    ];
    const buckets: Record<string, { count: number; energy: number }> = {};
    labels.forEach((l) => { buckets[l] = { count: 0, energy: 0 }; });
    sessions.forEach((s) => {
      const hour = Number(sessionHourFormatter.format(new Date(s.started_at)));
      if (!Number.isFinite(hour)) return;
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[labels[idx]].count++;
      buckets[labels[idx]].energy += s.total_energy_added_wh ?? 0;
    });
    // Buckets accumulate SI watt-hours; expose the display-unit energy so the
    // "Energy (kWh)" bar plots values that match its label.
    return labels.map((name) => ({
      name,
      count: buckets[name].count,
      energy: convertEnergyFromSI(buckets[name].energy, energyUnit),
    }));
  }, [sessions, t, energyUnit, sessionHourFormatter]);

  /* ── Charger-type breakdown ───────────────────────────────────── */
  const chargerBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const types: Record<string, {
      count: number;
      energy: number;
      cost: number;
      costedEnergy: number;
      pricedCount: number;
    }> = {};
    // Stable internal grouping keys (also used for CHARGER_COLORS lookup + React keys).
    sessions.forEach((s) => {
      const chargerDescription = `${s.charger_type ?? ''} ${s.cable_type ?? ''}`.toLowerCase();
      const key = chargerDescription.includes('tesla') || chargerDescription.includes('supercharger')
        ? 'Supercharger'
        : /\b(ccs|chademo|dc|fast)\b/.test(chargerDescription) ? 'DC Fast' : 'Home/AC';
      if (!types[key]) {
        types[key] = {
          count: 0,
          energy: 0,
          cost: 0,
          costedEnergy: 0,
          pricedCount: 0,
        };
      }
      types[key].count++;
      types[key].energy += s.total_energy_added_wh ?? 0;
      if (typeof s.cost_decimal === 'number' && Number.isFinite(s.cost_decimal)) {
        types[key].cost += s.cost_decimal;
        types[key].costedEnergy += s.total_energy_added_wh ?? 0;
        types[key].pricedCount++;
      }
    });
    const chargerLabels: Record<string, string> = {
      Supercharger: t('energy.chargerType.supercharger', 'Supercharger'),
      'DC Fast': t('energy.chargerType.dcFast', 'DC fast'),
      'Home/AC': t('energy.chargerType.homeAc', 'Home/AC'),
    };
    return Object.entries(types).map(([name, data]) => ({
      name,
      label: chargerLabels[name] ?? name,
      ...data,
      fill: CHARGER_COLORS[name] ?? '#00f0ff',
    }));
  }, [sessions, t]);

  const chargerEvidence = useMemo(() => chargerBreakdown.map(b => ({
    charger: b.label, sessions: b.count, energy_wh: b.energy,
    cost: b.pricedCount > 0 ? b.cost : null,
    costed_energy_wh: b.costedEnergy, priced_sessions: b.pricedCount,
  })), [chargerBreakdown]);

  /* ── Table columns ────────────────────────────────────────────── */
  const sessionColumns: Column<ChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      header: t('energy.table.date', 'Date'),
      render: (s) => (
        <Link to={`/charging/${s.id}`} className="text-[var(--text-secondary)] transition-colors hover:text-cyan-300">
          {formatDateShort(s.started_at)}
        </Link>
      ),
    },
    {
      key: 'energy',
      align: 'right',
      header: t('energy.table.energy', 'Energy'),
      render: (s) => (
        <Text weight="medium" className="text-cyan-300">
          {formatEnergy(s.total_energy_added_wh ?? 0)}
        </Text>
      ),
    },
    {
      key: 'battery',
      align: 'right',
      className: 'whitespace-nowrap',
      header: t('energy.table.battery', 'Battery'),
      render: (s) => (
        <>
          <Text color="muted">{s.start_soc_pct}%</Text>
          <Text color="muted" className="mx-1">→</Text>
          <Text className="text-emerald-300">{s.end_soc_pct ?? '—'}%</Text>
        </>
      ),
    },
    {
      key: 'power',
      align: 'right',
      header: t('energy.table.power', 'Power'),
      render: (s) => <>{s.peak_power_w != null ? `${fmtNumber(convertPowerFromSI(s.peak_power_w, 'kW'))} kW` : '—'}</>,
    },
    {
      key: 'type',
      header: t('energy.table.type', 'Type'),
      render: (s) => {
        const isTesla = s.charger_type?.toLowerCase().includes('tesla');
        const variant = isTesla ? 'danger' : s.charger_type ? 'warning' : 'success';
        const label = isTesla
          ? t('energy.chargerType.supercharger', 'Supercharger')
          : s.charger_type || t('energy.chargerType.ac', 'AC');
        return <Badge variant={variant} size="sm">{label}</Badge>;
      },
    },
    {
      key: 'cost',
      align: 'right',
      header: t('energy.table.cost', 'Cost'),
      render: (s) => <>{typeof s.cost_decimal === 'number' ? formatCurrency(s.cost_decimal) : '—'}</>,
    },
    {
      key: 'perKwh',
      align: 'right',
      header: t('energy.table.perKwh', '$/kWh'),
      render: (s) => (
        <Text color="muted">
          {typeof s.cost_decimal === 'number' && s.total_energy_added_wh > 0
            ? formatCurrency(s.cost_decimal / convertEnergyFromSI(s.total_energy_added_wh, 'kWh'))
            : '—'}
        </Text>
      ),
    },
  ], [t, formatCurrency, formatEnergy, fmtNumber]);

  /* ── KPI band definition ──────────────────────────────────────── */
  const recordedCostValue =
    costedSessions.length > 0
      ? `${costCoverageComplete ? '' : '≥ '}${formatCurrency(totalCost)}`
      : '—';
  const kpis: (BatterySummaryMetric & { color: NeonColor })[] = [
    {
      key: 'costPerDist',
      label: t('energy.metric.costPerDist', { unit: distanceUnit, defaultValue: 'Cost per {{unit}}' }),
      value: costPerDistance != null ? formatCurrency(costPerDistance) : '—',
      metricId: 'currency', rawValue: costPerDistance,
      icon: <DollarSign className="h-4 w-4" />, color: 'cyan',
    },
    {
      key: 'costPerKwh',
      label: t('energy.metric.costPerKwh', 'Cost per kWh'),
      value: costPerKwh != null ? formatCurrency(costPerKwh) : '—',
      metricId: 'currency', rawValue: costPerKwh,
      icon: <Zap className="h-4 w-4" />, color: 'green',
    },
    {
      key: 'totalDistance',
      label: t('energy.metric.totalDistance', 'Total distance'),
      value: !statsDataState.hasData
        ? '—'
        : `${fmtInt(toDistanceDisplay(totalDistance ?? 0))} ${distanceUnit}`,
      metricId: 'distance', rawValue: statsDataState.hasData ? totalDistance : null,
      icon: <Route className="h-4 w-4" />, color: 'blue',
    },
    {
      key: 'sessions',
      label: t('energy.metric.sessions', 'Sessions'),
      value: !sessionsDataState.hasData
        ? '—'
        : `${sessionCapReached ? '≥ ' : ''}${sessions.length}`,
      metricId: 'count', rawValue: sessionsDataState.hasData ? sessions.length : null,
      icon: <BatteryCharging className="h-4 w-4" />, color: 'purple',
    },
    {
      key: 'monthlyEst',
      label: t('energy.metric.monthlyEst', 'Monthly est.'),
      value: monthlyProjectedCost != null ? formatCurrency(monthlyProjectedCost) : '—',
      metricId: 'currency', rawValue: monthlyProjectedCost,
      icon: <CalendarDays className="h-4 w-4" />, color: 'amber',
    },
    {
      key: 'yearlyEst',
      label: t('energy.metric.yearlyEst', 'Yearly est.'),
      value: yearlyProjectedCost != null ? formatCurrency(yearlyProjectedCost) : '—',
      metricId: 'currency', rawValue: yearlyProjectedCost,
      icon: <TrendingUp className="h-4 w-4" />, color: 'red',
    },
  ];
  const narrativeEvidence: OperationalNarrative['evidence'] = [
    ...dailyEnergy
      .slice(-3)
      .reverse()
      .map((day) => ({
        id: `energy-day-${day.date}`,
        summary: t(
          'operations.energy.narrative.dailySummary',
          '{{date}}: {{energy}} consumed across {{distance}}.',
          {
            date: day.date,
            energy: formatEnergy(day.energy_wh ?? 0),
            distance: `${fmtNumber(toDistanceDisplay(day.distance_m ?? 0))} ${distanceUnit}`,
          },
        ),
        observedAt: day.date,
        provenance: {
          source: t('operations.energy.consumptionSource', 'Drive consumption'),
          recordId: day.date,
          method: t(
            'operations.energy.narrative.dailyMethod',
            'Daily aggregate of measured drive energy and distance.',
          ),
        },
      })),
    ...sessions.slice(0, 2).map((session) => ({
      id: `energy-charge-${session.id}`,
      summary: t(
        'operations.energy.narrative.sessionSummary',
        '{{date}} charging: {{energy}} added; recorded cost {{cost}}.',
        {
          date: session.started_at,
          energy: formatEnergy(session.total_energy_added_wh ?? 0),
          cost:
            session.cost_decimal == null
              ? t('operations.energy.narrative.costMissing', 'not recorded')
              : formatCurrency(session.cost_decimal),
        },
      ),
      observedAt: session.started_at,
      provenance: {
        source: t('operations.energy.narrative.chargingSource', 'Charging history'),
        recordId: String(session.id),
        method: t(
          'operations.energy.narrative.sessionMethod',
          'Direct charging-session energy and recorded cost.',
        ),
      },
    })),
  ];
  const narrative: OperationalNarrative = {
    whatChanged: !statsDataState.hasData
      ? t('operations.energy.noDataDescription', 'Complete a drive or charging session to establish efficiency and cost baselines.')
      : t(
      'operations.energy.narrative.whatChanged',
      '{{energy}} of measured drive energy across {{days}} daily records, with {{cost}} in recorded charging cost.',
      {
        energy: formatEnergy(Math.max(0, scopedDriveEnergyWh)),
        days: dailyEnergy.length,
        cost: formatCurrency(totalCost),
      },
    ),
    whyItMatters: t(
      'operations.energy.narrative.impact',
      'Energy intensity and cost coverage determine operating exposure and whether projections are decision-ready.',
    ),
    confidence: {
      label:
        dailyEnergy.length >= 7
        && secondarySourceFailures.length === 0
        && (sessions.length === 0 || costedSessions.length === sessions.length)
          ? 'high'
          : dailyEnergy.length > 0 || sessions.length > 0
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.energy.narrative.dailyBasis',
          '{{count}} daily drive aggregates contain measured energy.',
          { count: dailyEnergy.length },
        ),
        t(
          'operations.energy.narrative.costBasis',
          '{{priced}} of {{total}} returned charging sessions include recorded cost.',
          { priced: costedSessions.length, total: sessions.length },
        ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      energyAttention[0]?.description
      ?? t(
        'operations.energy.narrative.monitorResponse',
        'No immediate response is indicated; continue collecting drive and charging evidence.',
      ),
    limitations: [
      t(
        'operations.energy.lossUnavailableDescription',
        'Independent wall-input and battery-retained energy are absent from the session contract, so no loss percentage is fabricated.',
      ),
      ...(secondarySourceFailures.length > 0
        ? [
            t(
              'operations.energy.narrative.sourceLimitation',
              '{{count}} supporting data source is unavailable, so this assessment is partial.',
              { count: secondarySourceFailures.length },
            ),
          ]
        : []),
      ...(costedSessions.length < sessions.length
        ? [
            t(
              'operations.energy.narrative.costLimitation',
              'Cost totals exclude sessions without a recorded price.',
            ),
          ]
        : []),
      t(
        'operations.energy.narrative.windowLimitation',
        'Idle drain uses a separate 90-day source window and is not attributed to a specific cause.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t('operations.energy.consumptionSource', 'Drive consumption'),
        method: t(
          'operations.energy.narrative.driveMethod',
          'Sums canonical measured drive energy and distance in the active analysis window.',
        ),
      },
      {
        source: t('operations.energy.narrative.chargingSource', 'Charging history'),
        method: t(
          'operations.energy.narrative.costMethod',
          'Sums only cost values persisted on returned charging sessions.',
        ),
      },
      {
        source: t('operations.energy.narrative.idleSource', 'Parked-state history'),
        method: t(
          'operations.energy.narrative.idleMethod',
          'Computes parked, non-charging battery change over the separate 90-day source window.',
        ),
      },
    ],
  };

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <PageLayout
      busy={isLoading}
      title={t('energy.pageTitle', 'Energy intelligence')}
      subtitle={t('energy.pageSubtitle', 'Deep cost analytics, efficiency trends, savings projections, and consumption patterns')}
      overflowActions={
        <SavedViewMenu
          route="/energy"
          currentQuery={savedView.currentQuery}
          onApply={savedView.apply}
        />
      }
    >
      {statsDataState.fatalError && <QueryError error={statsDataState.fatalError} onRetry={refetch} />}
      <StaleRefreshWarning state={statsDataState} />
      <StaleRefreshWarning state={sessionsDataState} />
      <StaleRefreshWarning state={liveChargingDataState} />
      <StaleRefreshWarning state={idleDrainDataState} />
      {secondarySourceFailures.length > 0 && (
        <AlertBanner
          data-testid="energy-partial-data"
          variant="warning"
          title={t('energy.sources.partialTitle', 'Some energy sources are unavailable')}
          icon={<CircleAlert className="h-4 w-4" aria-hidden="true" />}
        >
          {t(
            'energy.sources.partialDescription',
            'Available sections remain visible. Unavailable sources: {{sources}}.',
            { sources: secondarySourceFailures.join(', ') },
          )}
        </AlertBanner>
      )}

      <OperationalBrief
        compact
        testId="energy-operational-brief"
        eyebrow={t('operations.energy.eyebrow', 'Energy posture')}
        title={t('operations.energy.title', 'Consumption, efficiency, and cost in one operating view')}
        description={t(
          'operations.energy.description',
          'The selected window combines measured drive consumption, charging cost coverage, idle drain, and projected usage.',
        )}
        statusLabel={
          !statsDataState.hasData || hasNoEnergyData
            ? t('operations.status.awaitingData', 'Awaiting data')
            : energyStatusTone === 'success'
              ? t('operations.status.onTrack', 'On track')
              : t('operations.status.review', 'Review recommended')
        }
        statusTone={energyStatusTone}
        narrative={narrative}
        scope={
          <Badge variant="neutral" size="sm">
            {t('operations.scope.days', '{{count}} days', { count: periodDays })}
          </Badge>
        }
        freshness={
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenanceBadge
              provenance={statsDataState.provenance}
              status={statsDataState.status}
              updatedAt={statsDataState.updatedAt}
            />
            <DataFreshnessAuto
              query={statsQuery}
              source={t('operations.energy.consumptionSource', 'Drive consumption')}
            />
          </div>
        }
        metrics={[
          {
            key: 'consumption',
            rawValue: scopedDriveEnergyWh > 0 ? scopedDriveEnergyWh : null,
            valueState: scopedDriveEnergyWh > 0 ? 'value' : 'missing',
            label: t('operations.energy.consumption', 'Drive consumption'),
            value: scopedDriveEnergyWh > 0 ? formatEnergy(scopedDriveEnergyWh) : '—',
            detail: t(
              'operations.energy.consumptionDetail',
              'Measured traction energy in the selected drive aggregate.',
            ),
            tone: 'info',
          },
          {
            key: 'efficiency',
            rawValue: avgEfficiency > 0 ? avgEfficiency : null,
            valueState: avgEfficiency > 0 ? 'value' : 'missing',
            label: t('energy.gauge.efficiency', 'Efficiency'),
            value: avgEfficiency > 0
              ? `${fmtInt(toEfficiencyDisplay(avgEfficiency))} ${efficiencyUnit}`
              : '—',
            detail: t(
              'operations.energy.efficiencyDetail',
              'Average energy consumed per display-distance unit.',
            ),
            tone: efficiencyTone,
          },
          {
            key: 'idle-drain',
            rawValue: idleDrainRate,
            valueState: idleDrainRate == null ? 'missing' : 'value',
            label: t('operations.energy.idleDrain', 'Idle drain'),
            value: idleDrainQuery.isLoading
              ? t('common.loading', 'Loading…')
              : idleDrainRate != null
                ? `${fmtNumber(idleDrainRate)}%/day`
                : '—',
            detail: t(
              'operations.energy.idleDrainDetail',
              'Average parked, non-charging loss across the separate 90-day source window.',
            ),
            tone: idleDrainHigh ? 'warning' : idleDrainRate != null ? 'success' : 'neutral',
          },
          {
            key: 'charging-loss',
            rawValue: null,
            valueState: 'missing',
            label: t('operations.energy.chargingLoss', 'Charging losses'),
            value: t('operations.energy.notMeasured', 'Not measured'),
            detail: t(
              'operations.energy.chargingLossDetail',
              'Wall input and battery-retained energy are not independently available.',
            ),
            tone: 'neutral',
          },
          {
            key: 'cost',
            rawValue: costedSessions.length > 0 ? totalCost : null,
            valueState: costedSessions.length > 0 ? 'value' : 'missing',
            label: t('operations.energy.recordedCost', 'Recorded cost'),
            value: recordedCostValue,
            detail: t(
              'operations.energy.costDetail',
              '{{priced}} of {{total}} returned sessions include cost.',
              { priced: costedSessions.length, total: sessions.length },
            ),
            tone: costCoverageComplete ? 'neutral' : costedSessions.length > 0 ? 'info' : 'neutral',
          },
          {
            key: 'projection',
            rawValue: projectedMonthlyConsumptionWh,
            valueState: projectedMonthlyConsumptionWh == null ? 'missing' : 'value',
            label: t('operations.energy.projectedUsage', 'Projected 30-day use'),
            value: projectedMonthlyConsumptionWh != null
              ? formatEnergy(projectedMonthlyConsumptionWh)
              : '—',
            detail: t(
              'operations.energy.projectedUsageDetail',
              'Straight-line projection from measured consumption in the selected window.',
            ),
            tone: 'neutral',
          },
        ]}
        metricColumns={3}
        attention={energyAttention}
        provenance={t(
          'operations.energy.provenance',
          'Drive consumption comes from SI daily aggregates; costs from returned charging sessions; idle drain from 90-day FSM and signal history. Charging loss remains unsupported.',
        )}
      />

      {/* ── KPI band ────────────────────────────────────────────── */}
      <BatterySpecialistSummary
        testId="energy-summary"
        title={t('energy.kpis', 'Key energy metrics')}
        metrics={kpis}
        period={{
          kind: 'unknown',
          label: t('operations.scope.days', '{{count}} days', { count: periodDays }),
          reason: t('operations.energy.provenance', 'Drive consumption comes from SI daily aggregates; costs from returned charging sessions; idle drain from 90-day FSM and signal history. Charging loss remains unsupported.'),
        }}
        loading={isLoading && !sessionsDataState.hasData}
        retained={statsDataState.status === 'stale' || sessionsDataState.status === 'stale'}
      />

      <FadeIn delay={0.04}>
        <LayoutCard title={t('energy.drivers.title', 'Efficiency driver investigation')}>
          <Text as="p" variant="bodySm" className="mt-1 max-w-4xl">
            {t(
              'energy.drivers.description',
              'Daily intensity identifies when efficiency changed; temperature, speed, and route workspaces provide the evidence needed to investigate why.',
            )}
          </Text>
          {isLoading ? <ChartBlockSkeleton height={200} /> : peakEfficiencyDay != null && bestEfficiencyDay != null ? (
            <>
              <BatteryEvidenceBrief
                title={t('energy.drivers.title', 'Efficiency driver investigation')}
                period={{ kind: 'unknown', label: t('operations.scope.days', '{{count}} days', { count: periodDays }),
                  reason: t('energy.drivers.contextNotCause', 'Context only, not causal attribution') }}
                retained={statsDataState.status === 'stale'}
                metrics={[
                  { metricId: 'efficiency', occurrenceId: 'highest-day', rawValue: peakEfficiencyDay.efficiency_wh_per_m,
                    label: t('energy.drivers.highestDay', 'Highest observed day'),
                    display: { formatter: raw => ({ value: fmtNumber(toEfficiencyDisplay(raw)), unit: efficiencyUnit }) },
                    context: formatDayKey(peakEfficiencyDay.date, { style: 'long' }) },
                  { metricId: 'efficiency', occurrenceId: 'lowest-day', rawValue: bestEfficiencyDay.efficiency_wh_per_m,
                    label: t('energy.drivers.lowestDay', 'Lowest observed day'),
                    display: { formatter: raw => ({ value: fmtNumber(toEfficiencyDisplay(raw)), unit: efficiencyUnit }) },
                    context: formatDayKey(bestEfficiencyDay.date, { style: 'long' }) },
                  { metricId: 'percent', occurrenceId: 'observed-spread', rawValue: efficiencySpreadPct,
                    label: t('energy.drivers.spread', 'Observed daily spread'),
                    context: t('energy.drivers.spreadHint', 'Difference relative to weighted average') },
                  { metricId: 'distance', occurrenceId: 'highest-day-distance', rawValue: peakEfficiencyDay.distance_m,
                    label: t('energy.drivers.distanceContext', 'Distance on highest day'),
                    display: { formatter: raw => ({ value: fmtNumber(toDistanceDisplay(raw)), unit: distanceUnit }) },
                    context: t('energy.drivers.contextNotCause', 'Context only, not causal attribution') },
                ]}
              />
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Link
                  to="/temperature-impact"
                  className="flex min-h-11 items-center gap-3 rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-3)]"
                >
                  <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  <Text size="sm" weight="semibold">{t('energy.drivers.temperature', 'Review temperature impact')}</Text>
                </Link>
                <Link
                  to="/speed-profile"
                  className="flex min-h-11 items-center gap-3 rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-3)]"
                >
                  <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <Text size="sm" weight="semibold">{t('energy.drivers.speed', 'Review speed profile')}</Text>
                </Link>
                <Link
                  to="/route-efficiency"
                  className="flex min-h-11 items-center gap-3 rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-3)]"
                >
                  <MapPinned className="h-4 w-4 text-purple-300" aria-hidden="true" />
                  <Text size="sm" weight="semibold">{t('energy.drivers.route', 'Review route efficiency')}</Text>
                </Link>
              </div>
              <HelperText className="mt-3">
                {t(
                  'energy.drivers.disclosure',
                  'These daily observations are descriptive. They do not attribute efficiency changes to a specific cause.',
                )}
              </HelperText>
            </>
          ) : (
            // no-action: this evidence requires additional measured drive days.
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              message={t('energy.drivers.empty', 'More measured drive days are needed to compare efficiency pressure.')}
              className="py-8"
            />
          )}
        </LayoutCard>
      </FadeIn>

      {/* ── Hero bento: gauges (primary) + lifetime (context) ───── */}
      <FadeIn delay={0.05}>
        <BatteryPanelGrid
          label={t('energy.overview', 'Energy overview')}
          ids={['energy-overview', 'energy-lifetime']}
          sizes={['half', 'third']}
        >
          <LayoutCard title={t('energy.hero.title', 'Efficiency & cost overview')}>
            {isLoading ? <ChartBlockSkeleton height={200} /> : hasNoEnergyData ? (
              <EmptyState /* no-action: surfaces when no energy data exists yet — user must drive/charge to populate */
                icon={<Zap className="h-10 w-10" />}
                message={t('energy.empty.hero', 'No energy data yet — connect your vehicle and complete a drive or charging session to see efficiency, cost, and CO₂ savings.')}
              />
            ) : (
              <div className="grid grid-cols-2 items-center gap-4 sm:grid-cols-4 sm:gap-6">
                <MetricTile
                  value={statsDataState.hasData ? toEnergyDisplay(scopedDriveEnergyWh) : null}
                  label={t('energy.gauge.energyUsed', 'Energy used')}
                  unit={energyUnit}
                  accentClass="text-cyan-300"
                />
                {statsDataState.hasData && totalDistance > 0 ? <ThresholdBar
                  value={toEfficiencyDisplay(avgEfficiency)}
                  min={0}
                  max={toEfficiencyDisplay(EFFICIENCY_MAX_WH_PER_M)}
                  bands={efficiencyBands}
                  label={t('energy.gauge.efficiency', 'Efficiency')}
                  unit={efficiencyUnit}
                  decimals={displayPrecision}
                  className="col-span-2 sm:col-span-1"
                /> : <Text variant="bodySm">{t('energy.gauge.efficiency', 'Efficiency')}: —</Text>}
                <MetricTile
                  value={statsDataState.hasData ? co2Saved : null}
                  label={t('energy.gauge.co2Saved', 'CO₂ saved')}
                  unit="kg"
                  accentClass="text-purple-300"
                />
                <MetricTile
                  value={observedCost}
                  label={t('energy.gauge.totalCost', 'Total cost')}
                  unit={observedCost != null ? currencySymbol : undefined}
                  accentClass="text-amber-300"
                />
              </div>
            )}
          </LayoutCard>

          <LayoutCard title={t('energy.lifetime.title', 'Lifetime metrics')}>
            {liveChargingQuery.isLoading && !liveChargingDataState.hasData && <Skeleton className="mb-3 h-16 rounded-xl" />}
            {liveChargingDataState.fatalError && <QueryError error={liveChargingDataState.fatalError} onRetry={() => { void liveChargingQuery.refetch(); }} />}
            <BatteryEvidenceBrief
              title={t('energy.lifetime.title', 'Lifetime metrics')}
              retained={liveChargingDataState.status === 'stale' || sessionsDataState.status === 'stale'}
              period={{ kind: 'unknown', label: t('energy.lifetime.brief.scope', 'Lifetime BMS reading and selected charging window'),
                reason: t('energy.lifetime.brief.description', 'The lifetime BMS counter is reported in kWh; charging energy uses the selected date range and may be a lower bound when returned sessions reach the cap.') }}
              metrics={[
                { metricId: 'number', occurrenceId: 'lifetime-energy', rawValue: liveCharging?.lifetime_energy_used,
                  label: t('energy.lifetime.energyUsed', 'Lifetime energy used'),
                  display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kWh' }) },
                  description: t('energy.lifetime.energyUsedDesc', 'Total energy consumed since vehicle delivery') },
                { metricId: 'energy', occurrenceId: 'period-energy', rawValue: sessionsDataState.hasData ? totalChargingEnergyWh : null,
                  label: t('energy.lifetime.periodEnergy', { days: periodDays, defaultValue: 'Last {{days}} Days' }),
                  display: { formatter: raw => ({ value: `${sessionCapReached ? '≥ ' : ''}${fmtNumber(toEnergyDisplay(raw))}`, unit: energyUnit }) },
                  description: t('energy.lifetime.periodEnergyDesc', 'Energy added during selected date range') },
              ]}
            />
          </LayoutCard>
        </BatteryPanelGrid>
      </FadeIn>

      {/* ── Cost vs Gas Savings ─────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <BatteryPanelGrid
          label={t('energy.savings', 'Cost savings versus gas')}
          ids={['energy-cost-period', 'energy-cost-annual']}
        >
          <CostComparisonCard
            label={t('energy.cost.periodTotal', { days: periodDays, defaultValue: '{{days}}-Day Total' })}
            evCost={observedCost}
            gasCost={gasEquivalent}
            icon={<Fuel className="h-4 w-4" />}
          />
          <CostComparisonCard
            label={t('energy.cost.projectedAnnual', 'Projected annual')}
            evCost={yearlyProjectedCost}
            gasCost={gasEquivalent != null ? (gasEquivalent / periodDays) * 365 : null}
            icon={<Leaf className="h-4 w-4" />}
          />
        </BatteryPanelGrid>
      </FadeIn>

      {/* ── Charts Row 1: Energy & Cost Daily + Efficiency ────
          Both panels share the same `daily_breakdown` dataset (matching
          `date` axis), so they're wrapped in a single `<ChartTimeRangeProvider>`
          to mirror hover cursors and draw a persistent reference line on both
          at the last hovered date. */}
      <FadeIn delay={0.15}>
        <ChartTimeRangeProvider syncId="energy.daily">
          <BatteryPanelGrid
            label={t('energy.dailyCharts', 'Daily energy trends')}
            ids={['energy-cost-daily', 'energy-efficiency-trend']}
          >
            <ChartCard
              toolbar size="standard" height={256} mobileHeight={224}
              title={t('energy.chart.energyCostDaily', 'Energy & cost daily')}
              ariaLabel={t('energy.chart.energyCostDailyAria', 'Daily drive consumption and recorded charging cost chart')}
              exportable
              exportFilename="energy-cost-daily"
              data={dailyConsumptionCostData}
              exportData={dailyConsumptionCostData}
              dataColumns={[
                { key: 'date', label: t('energy.table.date', 'Date') },
                { key: 'energy', label: t('energy.chart.driveConsumption', 'Drive consumption'),
                  format: value => value != null ? `${fmtNumber(Number(value))} ${energyUnit}` : '—' },
                { key: 'cost', label: costSeriesLabel,
                  format: value => value != null ? formatCurrency(Number(value)) : '—' },
              ]}
              chartKey="energy-cost-daily"
              annotations={{ vehicleId, scope: 'energy', chartId: 'energy-cost-daily' }}
            >
              {({ annotations: chartAnnotations }) => (
                <div className="h-56 sm:h-64">
                  {isLoading ? <ChartBlockSkeleton height={240} /> : dailyConsumptionCostData.length > 0 ? (
                    <EnergyChartSync>
                      {({ sync, syncedX }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={dailyConsumptionCostData}
                            syncId={sync.syncId}
                            syncMethod={sync.syncMethod}
                            onMouseMove={sync.onMouseMove}
                          >
                            <defs>
                              <ChartGradient id="energyBarGrad" color="#00f0ff" opacity={0.8} />
                            </defs>
                            {chartGrid}
                            <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              tick={axisTickSm}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value: number) => formatCurrency(value)}
                            />
                            <Tooltip
                              content={(
                                <ChartTooltip
                                  valueFormatter={(value, name) =>
                                    name === costSeriesLabel
                                      ? formatCurrency(Number(value))
                                      : `${fmtNumber(Number(value))} ${energyUnit}`
                                  }
                                />
                              )}
                            />
                            <ChartLegend state={energyCostHidden} />
                            {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                            <Bar
                              yAxisId="left"
                              dataKey="energy"
                              name={t('energy.chart.driveConsumption', 'Drive consumption')}
                              fill="url(#energyBarGrad)"
                              fillOpacity={0.6}
                              radius={[3, 3, 0, 0]}
                              animationDuration={800}
                              hide={energyCostHidden.isHidden('energy')}
                            />
                            <Line
                              {...AREA_DEFAULTS}
                              yAxisId="right"
                              dataKey="cost"
                              name={costSeriesLabel}
                              stroke="#10b981"
                              animationDuration={800}
                              connectNulls={false}
                              hide={energyCostHidden.isHidden('cost')}
                            />
                            {syncedX != null && (
                              <ReferenceLine
                                yAxisId="left"
                                x={syncedX}
                                stroke={chartTokens.cursor.stroke}
                                strokeWidth={chartTokens.cursor.strokeWidth}
                                strokeDasharray={chartTokens.cursor.strokeDasharray}
                                ifOverflow="hidden"
                                isFront
                              />
                            )}
                            {dailyConsumptionCostData.length > 14 && (
                              <Brush
                                dataKey="date"
                                height={20}
                                stroke="#6b7280"
                                fill="rgba(255,255,255,0.02)"
                                travellerWidth={8}
                              />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </EnergyChartSync>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Zap className="h-8 w-8" />}
                      message={t('energy.chart.noEnergyData', 'Connect vehicle to see energy data')}
                      className="py-8"
                    />
                  )}
                </div>
              )}
            </ChartCard>

            <ChartCard
              toolbar size="standard" height={256} mobileHeight={224}
              title={t('energy.chart.efficiencyTrend', 'Efficiency trend')}
              ariaLabel={t('energy.chart.efficiencyTrendAria', 'Daily efficiency and distance area chart')}
              exportable
              exportFilename="efficiency-trend"
              data={dailyEfficiencyData}
              exportData={dailyEfficiencyData}
              dataColumns={[
                { key: 'date', label: t('energy.table.date', 'Date') },
                { key: 'efficiency', label: efficiencyUnit },
                { key: 'distance', label: t('energy.chart.distance', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' }) },
              ]}
              chartKey="energy-efficiency-trend"
            >
              <div className="h-56 sm:h-64">
                {isLoading ? <ChartBlockSkeleton height={240} /> : dailyEfficiencyData.length > 0 ? (
                  <EnergyChartSync>
                    {({ sync, syncedX }) => (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={dailyEfficiencyData}
                          syncId={sync.syncId}
                          syncMethod={sync.syncMethod}
                          onMouseMove={sync.onMouseMove}
                        >
                          <defs>
                            <ChartGradient id="effGrad" color="#10b981" opacity={0.3} />
                            <ChartGradient id="distGrad2" color="#00f0ff" opacity={0.15} />
                          </defs>
                          {chartGrid}
                          <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                          <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <ChartLegend state={efficiencyHidden} />
                          <Area
                            {...AREA_DEFAULTS}
                            dataKey="efficiency"
                            name={efficiencyUnit}
                            stroke="#10b981"
                            fill="url(#effGrad)"
                            animationDuration={800}
                            hide={efficiencyHidden.isHidden('efficiency')}
                          />
                          <Area
                            {...AREA_DEFAULTS}
                            dataKey="distance"
                            name={t('energy.chart.distance', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' })}
                            stroke="#00f0ff"
                            fill="url(#distGrad2)"
                            strokeWidth={1}
                            strokeDasharray="4 4"
                            animationDuration={800}
                            hide={efficiencyHidden.isHidden('distance')}
                          />
                          {syncedX != null && (
                            <ReferenceLine
                              x={syncedX}
                              stroke={chartTokens.cursor.stroke}
                              strokeWidth={chartTokens.cursor.strokeWidth}
                              strokeDasharray={chartTokens.cursor.strokeDasharray}
                              ifOverflow="hidden"
                              isFront
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </EnergyChartSync>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                    icon={<Activity className="h-8 w-8" />}
                    message={t('energy.chart.noEfficiencyData', 'No efficiency data yet')}
                    className="py-8"
                  />
                )}
              </div>
            </ChartCard>
          </BatteryPanelGrid>
        </ChartTimeRangeProvider>
      </FadeIn>

      {/* ── Charts Row 2: Time of Day + Charger Breakdown ──── */}
      <FadeIn delay={0.2}>
        <BatteryPanelGrid
          label={t('energy.patternCharts', 'Charging patterns')}
          ids={['energy-charging-time-of-day', 'energy-charger-breakdown']}
        >
          <ChartCard
            toolbar size="standard" height={300} mobileHeight={300}
            title={t('energy.chart.chargingByTime', 'Charging by time of day')}
            ariaLabel={t('energy.chart.chargingByTimeAria', 'Charging energy and session count by time of day bar chart')}
            exportable
            exportFilename="charging-by-time"
            data={timeOfDayData}
            exportData={timeOfDayData}
            dataColumns={[
              { key: 'name', label: t('energy.chart.chargingByTime', 'Charging by time of day') },
              { key: 'energy', label: t('energy.chart.energyDisplay', { unit: energyUnit, defaultValue: 'Energy ({{unit}})' }) },
              { key: 'count', label: t('energy.chart.sessions', 'Sessions') },
            ]}
            chartKey="energy-charging-time-of-day"
          >
            {sessionsQuery.isLoading ? (
              <Skeleton className="h-60 rounded-xl" />
            ) : sessionsDataState.fatalError ? (
              <QueryError
                error={sessionsQuery.error}
                onRetry={() => void sessionsQuery.refetch()}
              />
            ) : timeOfDayData.length > 0 ? (
              <>
                <div className="h-44 sm:h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeOfDayData}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend state={timeOfDayHidden} />
                      <Bar
                        dataKey="energy"
                        name={t('energy.chart.energyDisplay', { unit: energyUnit, defaultValue: 'Energy ({{unit}})' })}
                        fill="#f59e0b"
                        fillOpacity={0.7}
                        radius={[3, 3, 0, 0]}
                        animationDuration={800}
                        hide={timeOfDayHidden.isHidden('energy')}
                      />
                      <Bar
                        dataKey="count"
                        name={t('energy.chart.sessions', 'Sessions')}
                        fill="#a855f7"
                        fillOpacity={0.5}
                        radius={[3, 3, 0, 0]}
                        animationDuration={800}
                        hide={timeOfDayHidden.isHidden('count')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Caption className="flex items-center gap-1">
                    <Moon className="h-3 w-3" aria-hidden="true" />
                    {t('energy.tip.timezone', 'Buckets use {{timezone}} session start time.', { timezone })}
                  </Caption>
                  <Caption className="flex items-center gap-1">
                    <Sun className="h-3 w-3" aria-hidden="true" />
                    {t('energy.tip.noSavingsClaim', 'Timing alone does not prove tariff or solar savings.')}
                  </Caption>
                </div>
              </>
            ) : (
              // no-action: the global vehicle and analysis-window controls remain available.
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t(
                  'energy.chart.noTimeOfDayData',
                  'No charging sessions fall within the selected analysis window.',
                )}
                description={t(
                  'energy.chart.noTimeOfDayDataDescription',
                  'Session timing patterns appear after completed charges are recorded in this period.',
                )}
                className="py-8"
              />
            )}
          </ChartCard>

          <ChartCard
            toolbar size="standard" height={300} mobileHeight={420}
            title={t('energy.chart.chargerBreakdown', 'Charger type breakdown')}
            ariaLabel={t('energy.chart.chargerBreakdownAria', 'Charger type share pie chart')}
            exportable
            exportFilename="charger-breakdown"
            data={chargerEvidence}
            exportData={chargerEvidence}
            dataColumns={[
              { key: 'charger', label: t('energy.table.type', 'Type') },
              { key: 'sessions', label: t('energy.chart.sessions', 'Sessions') },
              { key: 'energy_wh', label: t('energy.table.energy', 'Energy'),
                format: value => value != null ? formatEnergy(Number(value)) : '—' },
              { key: 'cost', label: t('energy.table.cost', 'Cost'),
                format: value => value != null ? formatCurrency(Number(value)) : '—' },
              { key: 'costed_energy_wh', label: t('energy.chart.costedEnergy', 'Energy with recorded cost'),
                format: value => value != null ? formatEnergy(Number(value)) : '—' },
              { key: 'priced_sessions', label: t('energy.chart.pricedSessions', 'Sessions with recorded cost') },
            ]}
          >
            {sessionsQuery.isLoading ? (
              <Skeleton className="h-60 rounded-xl" />
            ) : sessionsDataState.fatalError ? (
              <QueryError
                error={sessionsQuery.error}
                onRetry={() => void sessionsQuery.refetch()}
              />
            ) : chargerBreakdown.length > 0 ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <div className="h-40 w-40 shrink-0 sm:h-48 sm:w-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chargerBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="energy"
                        nameKey="label"
                      >
                        {chargerBreakdown.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full flex-1 space-y-3">
                  {chargerBreakdown.map((b) => (
                    <div key={b.name}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.fill }} aria-hidden="true" />
                          <Text size="sm" color="secondary">{b.label}</Text>
                        </span>
                        <Caption>
                          {b.count} {t('energy.breakdown.sessions', 'sessions')}
                        </Caption>
                      </div>
                      <div className="flex items-center justify-between">
                        <Text size="xs" className="text-cyan-300">{fmtNumber(toEnergyDisplay(b.energy ?? 0))} {energyUnit}</Text>
                        <Text size="xs" className="text-emerald-300">
                          {b.pricedCount > 0 ? <Currency value={b.cost} /> : '—'}
                        </Text>
                        <Caption>
                          {b.costedEnergy > 0
                            ? <><Currency value={b.cost / (b.costedEnergy / 1000)} precision={displayPrecision} />/kWh</>
                            : '—'}
                        </Caption>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // no-action: the global vehicle and analysis-window controls remain available.
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t(
                  'energy.chart.noChargerBreakdownData',
                  'No charger-type energy is available for the selected analysis window.',
                )}
                description={t(
                  'energy.chart.noChargerBreakdownDataDescription',
                  'Home, AC, and DC shares appear after completed sessions include charger classification.',
                )}
                className="py-8"
              />
            )}
          </ChartCard>
        </BatteryPanelGrid>
      </FadeIn>

      {/* ── Recent Charging Sessions ─────────────────────────── */}
      <FadeIn delay={0.25}>
        <LayoutCard title={t('energy.sessions.title', 'Recent charging sessions')}>
          {sessionsQuery.isLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : sessionsDataState.fatalError ? (
            <QueryError
              error={sessionsQuery.error}
              onRetry={() => { void sessionsQuery.refetch(); }}
            />
          ) : sessions.length > 0 ? (
            <DataTable
              tableId="battery:energy-sessions"
              columns={sessionColumns}
              mobileColumns={['date', 'energy', 'cost']}
              data={sessions.slice(0, 15)}
              keyExtractor={(s) => s.id}
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8" />}
              message={t('energy.sessions.empty', 'No charging sessions recorded')}
              className="py-8"
            />
          )}
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
