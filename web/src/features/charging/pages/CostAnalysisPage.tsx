import { useState, useMemo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DollarSign, Zap, TrendingDown, TrendingUp,
  Fuel, Leaf, BarChart3, Clock, Car,
  Trees, Calculator, Lightbulb,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Input, Button, DataTable, type Column } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, CHART_COLORS, ComposedChart, Legend,
  renderAnnotationLines, AddAnnotationPopover, AnnotationList,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { AnimatedNumber } from '@/components/data-display';
import { DateRangeFilter } from '@/components/forms';
import { useChargingSessionsPaginated, useCostForecast } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnnotations } from '@/hooks/useAnnotations';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { cn } from '@/lib/cn';
import type { ChargingSession } from '@/api/types';

// ── Constants ────────────────────────────────────────────────────────────
const DEFAULT_GAS_PRICE = 3.5;
const DEFAULT_MPG = 30;
const DEFAULT_ELECTRICITY_RATE = 0.13;
const CO2_PER_GAL_KG = 8.887;
const KG_CO2_PER_TREE_YEAR = 22;
const KWH_PER_GALLON = 33.7;

// ── Helpers ──────────────────────────────────────────────────────────────

function categorizeCharger(session: ChargingSession): string {
  const fct = (session.fast_charger_type ?? '').toLowerCase();
  if (fct.includes('tesla') || fct.includes('supercharger')) return 'Supercharger';
  if ((session.charger_power ?? 0) > 22) return 'Public DC';
  const loc = (session.location_name ?? '').toLowerCase();
  if (loc.includes('work') || loc.includes('office')) return 'Work / L2';
  return 'Home';
}

function gasEquivalentCost(
  energyKwh: number,
  mpg: number,
  gasPrice: number,
): number {
  const gallonsEquiv = energyKwh / KWH_PER_GALLON;
  const milesEquiv = gallonsEquiv * mpg;
  return (milesEquiv / mpg) * gasPrice;
}

interface MonthlyBucket {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
}

interface ChargerTypeData {
  name: string;
  cost: number;
  energy: number;
  sessions: number;
  color: string;
}

interface HourBucket {
  hour: number;
  label: string;
  sessions: number;
  avgCost: number;
  totalEnergy: number;
}

// ── Stat card helper ─────────────────────────────────────────────────────

function StatBox({
  icon,
  label,
  value,
  sub,
  glow,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  glow?: 'cyan' | 'green' | 'purple';
}) {
  return (
    <GlassPanel glow={glow ?? 'none'} hover className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-white/5 p-2">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-gray-400">{label}</p>
          <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
      </div>
    </GlassPanel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export default function CostAnalysisPage() {
  const { t } = useTranslation();
  usePageTitle(t('costAnalysis.title', 'Cost Analysis'));

  const { isMiles, convertDistance, distanceUnit } = useSettings();
  const { data: vehicles } = useVehicles();

  // ── Filters ──────────────────────────────────────────────────────────
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().split('T')[0],
  );

  // ── Gas calculator inputs ────────────────────────────────────────────
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [mpg, setMpg] = useState(DEFAULT_MPG);
  const [electricityRate, setElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE);

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const {
    data: sessions,
    isLoading,
  } = useChargingSessionsPaginated(vehicleId, {
    limit: 5000,
    start: startDate,
    end: endDate,
  });
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { data: forecastData } = useCostForecast(vehicleIdStr);

  // ── Annotations ──────────────────────────────────────────────────────
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations('charging-cost', vehicleId);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pendingTimestamp, setPendingTimestamp] = useState<string | null>(null);

  const handleChartClick = useCallback(
    (state: { activeLabel?: string }) => {
      if (isAnnotating && state?.activeLabel) {
        setPendingTimestamp(String(state.activeLabel));
      }
    },
    [isAnnotating],
  );

  const handleAddAnnotation = useCallback(
    (label: string, category: Parameters<typeof addAnnotation>[2], description?: string) => {
      if (pendingTimestamp) {
        addAnnotation(pendingTimestamp, label, category, description);
        setPendingTimestamp(null);
        setIsAnnotating(false);
      }
    },
    [pendingTimestamp, addAnnotation],
  );

  // ── Core aggregated stats ────────────────────────────────────────────
  const coreStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const totalCost = sessions.reduce((s, c) => s + (c.cost ?? 0), 0);
    const totalEnergy = sessions.reduce((s, c) => s + c.charge_energy_added, 0);
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
    const totalDuration = sessions.reduce((s, c) => s + c.duration_min, 0);

    // Distance-based calculations
    let totalDistanceKm = 0;
    sessions.forEach((s) => {
      if (s.end_range_km != null && s.start_range_km != null) {
        const added = s.end_range_km - s.start_range_km;
        if (added > 0) totalDistanceKm += added;
      }
    });

    const distVal = convertDistance(totalDistanceKm);
    const costPerDist =
      distVal > 0 ? totalCost / distVal : 0;

    // Gas comparison
    const gallonsEquiv = totalEnergy / KWH_PER_GALLON;
    const gasCost = gallonsEquiv * gasPrice;
    const savings = gasCost - totalCost;
    const savingsPercent = gasCost > 0 ? (savings / gasCost) * 100 : 0;

    // CO2
    const co2SavedKg = gallonsEquiv * CO2_PER_GAL_KG;
    const treeEquiv = co2SavedKg / KG_CO2_PER_TREE_YEAR;

    return {
      totalCost,
      totalEnergy,
      avgCostPerKwh,
      totalDuration,
      totalDistanceKm,
      costPerDist,
      gasCost,
      savings,
      savingsPercent,
      co2SavedKg,
      treeEquiv,
      gallonsEquiv,
      count: sessions.length,
    };
  }, [sessions, gasPrice, convertDistance]);

  // ── Monthly aggregation ──────────────────────────────────────────────
  const monthlyData = useMemo<MonthlyBucket[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<string, { cost: number; energy: number; sessions: number }> = {};
    sessions.forEach((s) => {
      const d = new Date(s.start_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = { cost: 0, energy: 0, sessions: 0 };
      buckets[key].cost += s.cost ?? 0;
      buckets[key].energy += s.charge_energy_added;
      buckets[key].sessions++;
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const ge = gasEquivalentCost(v.energy, mpg, gasPrice);
        return {
          month,
          cost: v.cost,
          energy: v.energy,
          sessions: v.sessions,
          avgCostPerKwh: v.energy > 0 ? v.cost / v.energy : 0,
          gasEquiv: ge,
          savings: ge - v.cost,
        };
      });
  }, [sessions, gasPrice, mpg]);

  // ── Cost per kWh trend (per-session) ─────────────────────────────────
  const costPerKwhTrend = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    return sessions
      .filter((s) => s.cost != null && s.charge_energy_added > 0)
      .sort(
        (a, b) =>
          new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
      )
      .map((s) => ({
        date: formatDateShort(s.start_date),
        costPerKwh: (s.cost ?? 0) / s.charge_energy_added,
      }));
  }, [sessions]);

  // ── Charger type breakdown ───────────────────────────────────────────
  const chargerTypeData = useMemo<ChargerTypeData[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const groups: Record<string, { cost: number; energy: number; sessions: number }> = {};
    sessions.forEach((s) => {
      const cat = categorizeCharger(s);
      if (!groups[cat]) groups[cat] = { cost: 0, energy: 0, sessions: 0 };
      groups[cat].cost += s.cost ?? 0;
      groups[cat].energy += s.charge_energy_added;
      groups[cat].sessions++;
    });
    return Object.entries(groups)
      .map(([name, v]) => ({
        name,
        cost: v.cost,
        energy: v.energy,
        sessions: v.sessions,
        color: CHARGER_COLORS[name] ?? CHART_COLORS[4],
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  // ── Hourly distribution (ToU) ────────────────────────────────────────
  const hourlyData = useMemo<HourBucket[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<number, { sessions: number; totalCost: number; totalEnergy: number }> = {};
    for (let h = 0; h < 24; h++) {
      buckets[h] = { sessions: 0, totalCost: 0, totalEnergy: 0 };
    }
    sessions.forEach((s) => {
      const hour = new Date(s.start_date).getHours();
      buckets[hour].sessions++;
      buckets[hour].totalCost += s.cost ?? 0;
      buckets[hour].totalEnergy += s.charge_energy_added;
    });
    return Object.entries(buckets)
      .map(([h, v]) => ({
        hour: Number(h),
        label: `${String(h).padStart(2, '0')}:00`,
        sessions: v.sessions,
        avgCost: v.sessions > 0 ? v.totalCost / v.sessions : 0,
        totalEnergy: v.totalEnergy,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [sessions]);

  // ── ToU insights ─────────────────────────────────────────────────────
  const touInsights = useMemo(() => {
    if (hourlyData.length === 0) return null;
    const withSessions = hourlyData.filter((h) => h.sessions > 0);
    if (withSessions.length === 0) return null;
    const cheapest = [...withSessions].sort((a, b) => a.avgCost - b.avgCost)[0];
    const priciest = [...withSessions].sort((a, b) => b.avgCost - a.avgCost)[0];
    const busiest = [...withSessions].sort((a, b) => b.sessions - a.sessions)[0];
    const offPeakCount = sessions?.filter((s) => {
      const h = new Date(s.start_date).getHours();
      return h >= 22 || h < 6;
    }).length ?? 0;
    const offPeakPct = sessions && sessions.length > 0
      ? (offPeakCount / sessions.length) * 100
      : 0;
    return { cheapest, priciest, busiest, offPeakPct };
  }, [hourlyData, sessions]);

  // ── Gas vs Electric detailed comparison ──────────────────────────────
  const gasComparison = useMemo(() => {
    if (!coreStats) return null;
    const { totalEnergy, totalCost, totalDistanceKm } = coreStats;
    const distMiles = convertDistance(totalDistanceKm);
    const gallonsNeeded = isMiles
      ? distMiles / mpg
      : convertDistance(totalDistanceKm) / mpg;
    const gasCostCalc = gallonsNeeded * gasPrice;
    const evCostCalc = totalEnergy * electricityRate;
    const monthlySavings =
      monthlyData.length > 0
        ? (gasCostCalc - evCostCalc) / Math.max(monthlyData.length, 1)
        : 0;
    const yearlySavings = monthlySavings * 12;

    return {
      gasCost: gasCostCalc,
      evCost: evCostCalc,
      actualCost: totalCost,
      savings: gasCostCalc - totalCost,
      monthlySavings,
      yearlySavings,
      costPerMileGas: distMiles > 0 ? gasCostCalc / distMiles : 0,
      costPerMileEV: distMiles > 0 ? totalCost / distMiles : 0,
    };
  }, [coreStats, gasPrice, mpg, electricityRate, isMiles, convertDistance, monthlyData.length]);

  // ── Lifetime summary metrics ─────────────────────────────────────────
  const lifetimeMetrics = useMemo(() => {
    if (!sessions || sessions.length === 0 || !coreStats) return null;
    const avgSessionCost =
      coreStats.count > 0 ? coreStats.totalCost / coreStats.count : 0;
    const avgSessionEnergy =
      coreStats.count > 0 ? coreStats.totalEnergy / coreStats.count : 0;
    const avgDuration =
      coreStats.count > 0 ? coreStats.totalDuration / coreStats.count : 0;
    const freeCount = sessions.filter(
      (s) => !s.cost || s.cost === 0,
    ).length;
    const freeEnergy = sessions
      .filter((s) => !s.cost || s.cost === 0)
      .reduce((sum, s) => sum + s.charge_energy_added, 0);
    const maxSessionCost = Math.max(...sessions.map((s) => s.cost ?? 0));
    const minSessionCost = Math.min(
      ...sessions.filter((s) => (s.cost ?? 0) > 0).map((s) => s.cost!),
      0,
    );

    return {
      avgSessionCost,
      avgSessionEnergy,
      avgDuration,
      freeCount,
      freeEnergy,
      maxSessionCost,
      minSessionCost,
    };
  }, [sessions, coreStats]);

  // ── DataTable columns for monthly breakdown ──────────────────────────
  const monthlyColumns = useMemo<Column<MonthlyBucket>[]>(
    () => [
      {
        key: 'month',
        header: t('costAnalysis.table.month', 'Month'),
        sortable: true,
        render: (row) => (
          <span className="font-medium text-white">{row.month}</span>
        ),
      },
      {
        key: 'sessions',
        header: t('costAnalysis.table.sessions', 'Sessions'),
        sortable: true,
        render: (row) => fmtInt(row.sessions),
      },
      {
        key: 'energy',
        header: t('costAnalysis.table.energy', 'Energy'),
        sortable: true,
        render: (row) => fmtWithUnit(row.energy, 'kWh', 1),
      },
      {
        key: 'cost',
        header: t('costAnalysis.table.cost', 'Cost'),
        sortable: true,
        render: (row) => (
          <span className="text-cyan-400">${fmtNumber(row.cost, 2)}</span>
        ),
      },
      {
        key: 'avgCostPerKwh',
        header: t('costAnalysis.table.avgRate', 'Avg $/kWh'),
        sortable: true,
        render: (row) => `$${fmtNumber(row.avgCostPerKwh, 3)}`,
      },
      {
        key: 'gasEquiv',
        header: t('costAnalysis.table.gasEquiv', 'Gas Equiv'),
        sortable: true,
        render: (row) => (
          <span className="text-red-400">${fmtNumber(row.gasEquiv, 2)}</span>
        ),
      },
      {
        key: 'savings',
        header: t('costAnalysis.table.savings', 'Savings'),
        sortable: true,
        render: (row) => (
          <span
            className={cn(
              'font-medium',
              row.savings >= 0 ? 'text-green-400' : 'text-red-400',
            )}
          >
            {row.savings >= 0 ? '+' : ''}${fmtNumber(row.savings, 2)}
          </span>
        ),
      },
    ],
    [t],
  );

  // ── Sort state for DataTable ─────────────────────────────────────────
  const [tableSortKey, setTableSortKey] = useState('month');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedMonthlyData = useMemo(() => {
    if (monthlyData.length === 0) return [];
    return [...monthlyData].sort((a, b) => {
      const aVal = a[tableSortKey as keyof MonthlyBucket];
      const bVal = b[tableSortKey as keyof MonthlyBucket];
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
  }, [monthlyData, tableSortKey, tableSortDir]);

  const handleSort = (key: string) => {
    if (key === tableSortKey) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Loading state
  // ═══════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <FadeIn>
        <div className="space-y-6 p-6">
          {/* Header skeleton */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Skeleton width="220px" height={28} />
              <Skeleton width="340px" height={16} className="mt-2" />
            </div>
            <Skeleton width="200px" height={36} rounded />
          </div>
          {/* Card skeletons */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <GlassPanel key={i} className="p-4">
                <Skeleton height={14} width="60%" />
                <Skeleton height={24} width="80%" className="mt-2" />
                <Skeleton height={12} width="40%" className="mt-1" />
              </GlassPanel>
            ))}
          </div>
          {/* Chart skeletons */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GlassPanel className="p-4">
              <Skeleton height={16} width="40%" />
              <Skeleton height={200} className="mt-4" />
            </GlassPanel>
            <GlassPanel className="p-4">
              <Skeleton height={16} width="40%" />
              <Skeleton height={200} className="mt-4" />
            </GlassPanel>
          </div>
          {/* Table skeleton */}
          <GlassPanel className="p-4">
            <Skeleton height={16} width="30%" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={32} />
              ))}
            </div>
          </GlassPanel>
        </div>
      </FadeIn>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Empty state
  // ═══════════════════════════════════════════════════════════════════════
  if (!sessions || sessions.length === 0) {
    return (
      <FadeIn>
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <EmptyState
            icon={<DollarSign className="h-12 w-12 text-gray-500" />}
            title={t('costAnalysis.empty.title', 'No Charging Data')}
            message={t(
              'costAnalysis.empty.message',
              'Start charging your vehicle to see cost analysis and savings trends.',
            )}
          />
        </div>
      </FadeIn>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Main render
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <PageContainer
      title={t('costAnalysis.title', 'Cost Analysis')}
      subtitle={t('costAnalysis.subtitle', 'Electricity cost trends, gas savings, and charging economics')}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {vehicles && vehicles.length > 0 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={(e) => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v) => ({
                value: String(v.id),
                label: v.display_name,
              }))}
              className="w-48"
            />
          )}
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            presets
          />
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── Section 2: Cost summary cards (6) ───────────────────────── */}
        <StaggerContainer>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StaggerItem>
              <StatBox
                icon={<DollarSign className="h-5 w-5 text-cyan-400" />}
                label={t('costAnalysis.stats.totalCost', 'Total Cost')}
                value={`$${fmtNumber(coreStats?.totalCost ?? 0, 2)}`}
                sub={`${fmtInt(coreStats?.count ?? 0)} ${t('costAnalysis.stats.sessions', 'sessions')}`}
                glow="cyan"
              />
            </StaggerItem>
            <StaggerItem>
              <StatBox
                icon={<Zap className="h-5 w-5 text-yellow-400" />}
                label={t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh')}
                value={`$${fmtNumber(coreStats?.avgCostPerKwh ?? 0, 3)}`}
                sub={t('costAnalysis.stats.blendedRate', 'blended rate')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatBox
                icon={<Car className="h-5 w-5 text-blue-400" />}
                label={t('costAnalysis.stats.costPerDist', `Cost Per ${isMiles ? 'Mile' : 'km'}`)}
                value={`$${fmtNumber(coreStats?.costPerDist ?? 0, 3)}`}
                sub={`per ${distanceUnit}`}
              />
            </StaggerItem>
            <StaggerItem>
              <StatBox
                icon={<Zap className="h-5 w-5 text-green-400" />}
                label={t('costAnalysis.stats.totalEnergy', 'Total Energy')}
                value={fmtWithUnit(coreStats?.totalEnergy ?? 0, 'kWh', 1)}
                sub={fmtWithUnit(coreStats?.gallonsEquiv ?? 0, 'gal equiv', 1)}
                glow="green"
              />
            </StaggerItem>
            <StaggerItem>
              <StatBox
                icon={<Fuel className="h-5 w-5 text-red-400" />}
                label={t('costAnalysis.stats.gasSavings', 'Gas Savings $')}
                value={`$${fmtNumber(coreStats?.savings ?? 0, 2)}`}
                sub={`vs $${fmtNumber(gasPrice, 2)}/gal`}
                glow="green"
              />
            </StaggerItem>
            <StaggerItem>
              <StatBox
                icon={<TrendingDown className="h-5 w-5 text-emerald-400" />}
                label={t('costAnalysis.stats.savingsPercent', 'Savings %')}
                value={`${fmtNumber(coreStats?.savingsPercent ?? 0, 1)}%`}
                sub={t('costAnalysis.stats.vsGasoline', 'vs gasoline')}
                glow="green"
              />
            </StaggerItem>
          </div>
        </StaggerContainer>

        {/* ── Section 3 & 4: Monthly cost trend + Cost per kWh trend ─── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Monthly cost trend — AreaChart */}
          <GlassPanel className={cn('p-4', isAnnotating && 'ring-1 ring-blue-400/30')}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                {t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
              </h3>
              <button
                type="button"
                onClick={() => setIsAnnotating((v) => !v)}
                className={cn(
                  'rounded p-1 text-xs transition-colors',
                  isAnnotating ? 'text-blue-400' : 'text-white/30 hover:text-white/50',
                )}
                aria-label={t('annotation.toggle', 'Toggle annotations')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
              </button>
            </div>
            {monthlyData.length > 0 ? (
              <div className={isAnnotating ? 'cursor-crosshair' : undefined}>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData} onClick={handleChartClick}>
                    <defs>
                      <ChartGradient id="costGrad" color={CHART_COLORS[0]} />
                    </defs>
                    <CartesianGridComponent />
                    <XAxis
                      dataKey="month"
                      {...axisTickSm}
                      tickFormatter={(v: string) => {
                        const parts = v.split('-');
                        return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : v;
                      }}
                    />
                    <YAxis
                      {...axisTickSm}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {renderAnnotationLines(annotations, (ts) => ts)}
                    <Area
                      type="monotone"
                      dataKey="cost"
                      name={t('costAnalysis.charts.cost', 'Cost ($)')}
                      stroke={CHART_COLORS[0]}
                      fill="url(#costGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
                {t('costAnalysis.charts.noData', 'Not enough data')}
              </div>
            )}
            <AnnotationList annotations={annotations} onRemove={removeAnnotation} />
          </GlassPanel>
          <AddAnnotationPopover
            open={pendingTimestamp != null}
            timestamp={pendingTimestamp ?? ''}
            onAdd={handleAddAnnotation}
            onCancel={() => setPendingTimestamp(null)}
          />
          <GlassPanel className="p-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <BarChart3 className="h-4 w-4 text-purple-400" />
              {t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
            </h3>
            {costPerKwhTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={costPerKwhTrend}>
                  <CartesianGridComponent />
                  <XAxis dataKey="date" {...axisTickSm} />
                  <YAxis
                    {...axisTickSm}
                    tickFormatter={(v: number) => `$${fmtNumber(v, 2)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="costPerKwh"
                    name={t('costAnalysis.charts.rateLabel', '$/kWh')}
                    stroke={CHART_COLORS[2]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
                {t('costAnalysis.charts.noData', 'Not enough data')}
              </div>
            )}
          </GlassPanel>
        </div>

        {/* ── Section 5: Cost by charger type — Pie + detail bars ──────── */}
        <GlassPanel className="p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Zap className="h-4 w-4 text-yellow-400" />
            {t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
          </h3>
          {chargerTypeData.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Pie chart */}
              <div className="flex items-center justify-center">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={chargerTypeData}
                      dataKey="cost"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {chargerTypeData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Detail breakdown bars */}
              <div className="space-y-3">
                {/* Custom legend */}
                <div className="mb-2 flex flex-wrap gap-4">
                  {chargerTypeData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-xs text-gray-400">{entry.name}</span>
                    </div>
                  ))}
                </div>
                {chargerTypeData.map((entry) => {
                  const totalCost = coreStats?.totalCost ?? 1;
                  const pct = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0;
                  return (
                    <div key={entry.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-gray-300">
                          {entry.name}
                        </span>
                        <span className="text-gray-400">
                          ${fmtNumber(entry.cost, 2)} · {fmtInt(entry.sessions)}{' '}
                          {t('costAnalysis.chargerType.sessions', 'sessions')}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: entry.color,
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>
                          {fmtWithUnit(entry.energy, 'kWh', 1)}
                        </span>
                        <span>
                          {entry.energy > 0
                            ? `$${fmtNumber(entry.cost / entry.energy, 3)}/kWh`
                            : '—'}
                        </span>
                        <span>{fmtNumber(pct, 1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-gray-500">
              {t('costAnalysis.charts.noData', 'Not enough data')}
            </div>
          )}
        </GlassPanel>

        {/* ── Section 6: Gas vs Electric savings calculator ─────────── */}
        <GlassPanel glow="green" className="p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Calculator className="h-4 w-4 text-green-400" />
            {t('costAnalysis.calculator.title', 'Gas vs Electric Savings Calculator')}
          </h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Inputs */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                {t('costAnalysis.calculator.inputs', 'Your Assumptions')}
              </h4>
              <Input
                type="number"
                label={t('costAnalysis.calculator.gasPrice', 'Gas Price ($/gal)')}
                value={gasPrice}
                onChange={(e) => setGasPrice(Number(e.target.value) || 0)}
                suffix="$/gal"
              />
              <Input
                type="number"
                label={t('costAnalysis.calculator.mpg', 'Gas Car MPG')}
                value={mpg}
                onChange={(e) => setMpg(Number(e.target.value) || 1)}
                suffix="mpg"
              />
              <Input
                type="number"
                label={t('costAnalysis.calculator.elecRate', 'Electricity Rate ($/kWh)')}
                value={electricityRate}
                onChange={(e) =>
                  setElectricityRate(Number(e.target.value) || 0)
                }
                suffix="$/kWh"
              />
              <Button
                className="mt-2 w-full"
                onClick={() => {
                  setGasPrice(DEFAULT_GAS_PRICE);
                  setMpg(DEFAULT_MPG);
                  setElectricityRate(DEFAULT_ELECTRICITY_RATE);
                }}
              >
                {t('costAnalysis.calculator.reset', 'Reset Defaults')}
              </Button>
            </div>

            {/* Side-by-side comparison */}
            <div className="space-y-3 lg:col-span-2">
              <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                {t('costAnalysis.calculator.comparison', 'Comparison')}
              </h4>
              {gasComparison ? (
                <div className="grid grid-cols-2 gap-3">
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.calculator.gasCost', 'Gas Cost (equivalent)')}
                    </p>
                    <p className="mt-1 text-xl font-bold text-red-400">
                      ${fmtNumber(gasComparison.gasCost, 2)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      ${fmtNumber(gasComparison.costPerMileGas, 3)}/{distanceUnit}
                    </p>
                  </GlassPanel>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.calculator.evCost', 'EV Cost (actual)')}
                    </p>
                    <p className="mt-1 text-xl font-bold text-cyan-400">
                      ${fmtNumber(gasComparison.actualCost, 2)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      ${fmtNumber(gasComparison.costPerMileEV, 3)}/{distanceUnit}
                    </p>
                  </GlassPanel>
                  <GlassPanel glow="green" className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.calculator.totalSavings', 'Total Savings')}
                    </p>
                    <p className="mt-1 text-xl font-bold text-green-400">
                      ${fmtNumber(gasComparison.savings, 2)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      {t('costAnalysis.calculator.overPeriod', 'over selected period')}
                    </p>
                  </GlassPanel>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.calculator.monthlySavings', 'Monthly Savings')}
                    </p>
                    <p className="mt-1 text-xl font-bold text-green-300">
                      ${fmtNumber(gasComparison.monthlySavings, 2)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      ~${fmtNumber(gasComparison.yearlySavings, 0)}{' '}
                      {t('costAnalysis.calculator.perYear', '/ year')}
                    </p>
                  </GlassPanel>
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-sm text-gray-500">
                  {t('costAnalysis.calculator.noData', 'Not enough data for comparison')}
                </div>
              )}
            </div>
          </div>
        </GlassPanel>

        {/* ── Section 7: Monthly cost breakdown table ──────────────── */}
        <GlassPanel className="p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            {t('costAnalysis.table.title', 'Monthly Cost Breakdown')}
          </h3>
          {sortedMonthlyData.length > 0 ? (
            <DataTable<MonthlyBucket>
              columns={monthlyColumns}
              data={sortedMonthlyData}
              keyExtractor={(row) => row.month}
              sortKey={tableSortKey}
              sortDir={tableSortDir}
              onSort={handleSort}
              compact
              pagination
            />
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-gray-500">
              {t('costAnalysis.table.noData', 'No monthly data available')}
            </div>
          )}
        </GlassPanel>

        {/* ── Section 8: Electricity rate analysis (ToU) ───────────── */}
        <GlassPanel className="p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Clock className="h-4 w-4 text-amber-400" />
            {t('costAnalysis.tou.title', 'Electricity Rate Analysis (Time-of-Use)')}
          </h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Hourly bar chart */}
            <div className="lg:col-span-2">
              {hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={hourlyData}>
                    <CartesianGridComponent />
                    <XAxis
                      dataKey="label"
                      {...axisTickSm}
                      interval={2}
                    />
                    <YAxis
                      {...axisTickSm}
                      tickFormatter={(v: number) => `${v}`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="sessions"
                      name={t('costAnalysis.tou.sessions', 'Sessions')}
                      radius={[3, 3, 0, 0]}
                    >
                      {hourlyData.map((entry) => {
                        const isPeak = entry.hour >= 14 && entry.hour <= 19;
                        const isOffPeak = entry.hour >= 22 || entry.hour < 6;
                        const color = isPeak
                          ? '#ef4444'
                          : isOffPeak
                            ? '#10b981'
                            : CHART_COLORS[0];
                        return <Cell key={entry.hour} fill={color} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
                  {t('costAnalysis.charts.noData', 'Not enough data')}
                </div>
              )}

              {/* Legend for peak / off-peak */}
              <div className="mt-2 flex justify-center gap-6">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-xs text-gray-400">
                    {t('costAnalysis.tou.peak', 'Peak (2–7 PM)')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-3 w-3 rounded-full bg-[#00f0ff]"
                  />
                  <span className="text-xs text-gray-400">
                    {t('costAnalysis.tou.midPeak', 'Mid-peak')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-xs text-gray-400">
                    {t('costAnalysis.tou.offPeak', 'Off-peak (10 PM–6 AM)')}
                  </span>
                </div>
              </div>
            </div>

            {/* ToU insights */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                {t('costAnalysis.tou.insights', 'Insights')}
              </h4>
              {touInsights ? (
                <>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.tou.cheapestHour', 'Cheapest Hour')}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-green-400">
                      {touInsights.cheapest.label}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.tou.avgCost', 'avg')} $
                      {fmtNumber(touInsights.cheapest.avgCost, 3)}{' '}
                      {t('costAnalysis.tou.perSession', '/ session')}
                    </p>
                  </GlassPanel>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.tou.priciestHour', 'Priciest Hour')}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-red-400">
                      {touInsights.priciest.label}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.tou.avgCost', 'avg')} $
                      {fmtNumber(touInsights.priciest.avgCost, 3)}{' '}
                      {t('costAnalysis.tou.perSession', '/ session')}
                    </p>
                  </GlassPanel>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.tou.busiestHour', 'Busiest Hour')}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-cyan-400">
                      {touInsights.busiest.label}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {fmtInt(touInsights.busiest.sessions)}{' '}
                      {t('costAnalysis.tou.sessions', 'sessions')}
                    </p>
                  </GlassPanel>
                  <GlassPanel className="p-3">
                    <p className="text-xs text-gray-400">
                      {t('costAnalysis.tou.offPeakRatio', 'Off-Peak Charging')}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-emerald-400">
                      {fmtNumber(touInsights.offPeakPct, 1)}%
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.tou.offPeakDesc', 'of sessions between 10 PM–6 AM')}
                    </p>
                  </GlassPanel>
                </>
              ) : (
                <div className="flex h-32 items-center justify-center text-sm text-gray-500">
                  {t('costAnalysis.tou.noInsights', 'No insights available')}
                </div>
              )}
            </div>
          </div>
        </GlassPanel>

        {/* ── Section 8b: Cost Forecast ────────────────────────────── */}
        <FadeIn>
          <GlassPanel className="p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <TrendingUp className="h-4 w-4 text-neon-purple" />
              {t('costAnalysis.forecast.title', 'Cost Forecast')}
            </h3>
            {(forecastData?.historical ?? []).length >= 3 && (forecastData?.forecast ?? []).length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart
                  data={[
                    ...(forecastData?.historical ?? []).map((h) => ({
                      month: h.month,
                      actual: h.cost,
                      forecast: undefined as number | undefined,
                      ci_low: undefined as number | undefined,
                      ci_band: undefined as number | undefined,
                    })),
                    ...(forecastData?.forecast ?? []).map((f) => ({
                      month: f.month,
                      actual: undefined as number | undefined,
                      forecast: f.cost,
                      ci_low: f.cost_low,
                      ci_band: Math.max(0, f.cost_high - f.cost_low),
                    })),
                  ]}
                >
                  <CartesianGrid {...chartGrid} />
                  <defs>
                    <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="actualCostFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Area type="monotone" dataKey="ci_low" stackId="ci" stroke="none" fill="transparent" fillOpacity={0} legendType="none" />
                  <Area type="monotone" dataKey="ci_band" stackId="ci" stroke="none" fill="url(#forecastBand)" name={t('costAnalysis.forecast.confidence', '95% Confidence')} connectNulls={false} />
                  <Area type="monotone" dataKey="actual" stroke={CHART_COLORS[0]} fill="url(#actualCostFill)" strokeWidth={2} name={t('costAnalysis.forecast.actual', 'Actual Cost')} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" stroke="#a855f7" strokeWidth={2} strokeDasharray="8 4" dot={false} name={t('costAnalysis.forecast.projected', 'Projected Cost')} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={t('costAnalysis.forecast.needData', 'Need at least 3 months of charging data for cost forecasting.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Forecast: Breakdown + Savings + Insights */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Breakdown donut */}
          <FadeIn>
            <GlassPanel className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-white">
                {t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
              </h3>
              {forecastData ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: t('Home'), value: forecastData.breakdown.home.pct },
                          { name: t('Supercharger'), value: forecastData.breakdown.supercharger.pct },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        dataKey="value"
                      >
                        <Cell fill="#22c55e" />
                        <Cell fill="#f59e0b" />
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-2 text-xs w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-white/70">{t('Home')}</span>
                      </div>
                      <span className="font-medium text-white">${fmtNumber(forecastData.breakdown.home.avg_cost_per_kwh, 3)}/kWh</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                        <span className="text-white/70">{t('Supercharger')}</span>
                      </div>
                      <span className="font-medium text-white">${fmtNumber(forecastData.breakdown.supercharger.avg_cost_per_kwh, 3)}/kWh</span>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState message={t('costAnalysis.forecast.noBreakdown', 'Breakdown will appear once charging data is available.')} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* Savings calculator */}
          <FadeIn>
            <GlassPanel className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                <Fuel className="h-4 w-4 text-neon-green" />
                {t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
              </h3>
              {forecastData ? (
                <div className="space-y-4">
                  <div className="rounded-xl p-4 bg-neon-green/[0.06] border border-neon-green/10 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                      {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
                    </p>
                    <p className="text-3xl font-bold text-neon-green">
                      $<AnimatedNumber value={forecastData.gas_comparison.monthly_savings} decimals={0} />
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-lg bg-white/[0.04] p-3">
                      <p className="text-[10px] text-white/40">{t('costAnalysis.forecast.annual', 'Annual')}</p>
                      <p className="text-lg font-semibold text-white">${fmtNumber(forecastData.gas_comparison.annual_savings, 0)}</p>
                    </div>
                    <div className="rounded-lg bg-white/[0.04] p-3">
                      <p className="text-[10px] text-white/40">{t('costAnalysis.forecast.lifetime', 'Lifetime')}</p>
                      <p className="text-lg font-semibold text-white">${fmtNumber(forecastData.gas_comparison.lifetime_savings, 0)}</p>
                    </div>
                  </div>
                  <div className="text-xs text-white/40 space-y-1">
                    <div className="flex justify-between">
                      <span>{t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}</span>
                      <span className="text-red-400">${fmtNumber(forecastData.gas_comparison.gas_cost_per_month, 2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('costAnalysis.forecast.evCost', 'EV cost/mo')}</span>
                      <span className="text-green-400">${fmtNumber(forecastData.gas_comparison.ev_cost_per_month, 2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('costAnalysis.forecast.avgKm', 'Avg km/mo')}</span>
                      <span>{fmtNumber(forecastData.gas_comparison.avg_km_per_month, 0)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState message={t('costAnalysis.forecast.noSavings', 'Savings data will appear once driving history is available.')} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* Insights */}
          <FadeIn>
            <GlassPanel className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                <Lightbulb className="h-4 w-4 text-neon-amber" />
                {t('costAnalysis.forecast.insights', 'Insights')}
              </h3>
              {(forecastData?.insights ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(forecastData?.insights ?? []).map((insight, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]"
                    >
                      <Zap className="h-4 w-4 mt-0.5 shrink-0 text-neon-amber" />
                      <p className="text-sm text-white/70">{insight}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message={t('costAnalysis.forecast.noInsights', 'Insights will appear as more data is collected.')} />
              )}
            </GlassPanel>
          </FadeIn>
        </div>

        {/* Cost per kWh trend (from forecast historical data) */}
        {(forecastData?.historical ?? []).length > 1 && (
          <FadeIn>
            <GlassPanel className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-white">
                {t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={forecastData?.historical ?? []}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="cost_per_kwh" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4', r: 3 }} name={t('costAnalysis.forecast.costPerKwh', '$/kWh')} />
                </LineChart>
              </ResponsiveContainer>
            </GlassPanel>
          </FadeIn>
        )}

        {/* ── Section 9: Lifetime summary + environmental impact ──── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Lifetime metrics */}
          <GlassPanel glow="cyan" className="p-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              {t('costAnalysis.lifetime.title', 'Lifetime Summary')}
            </h3>
            {lifetimeMetrics && coreStats ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.totalSpent', 'Total Spent')}
                  value={`$${fmtNumber(coreStats.totalCost, 2)}`}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.totalEnergy', 'Total Energy')}
                  value={fmtWithUnit(coreStats.totalEnergy, 'kWh', 1)}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.totalSessions', 'Total Sessions')}
                  value={fmtInt(coreStats.count)}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.avgSessionCost', 'Avg Session Cost')}
                  value={`$${fmtNumber(lifetimeMetrics.avgSessionCost, 2)}`}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.avgEnergy', 'Avg Energy / Session')}
                  value={fmtWithUnit(lifetimeMetrics.avgSessionEnergy, 'kWh', 1)}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.avgDuration', 'Avg Duration')}
                  value={`${fmtNumber(lifetimeMetrics.avgDuration, 0)} min`}
                />
                <LifetimeMetric
                  label={t('costAnalysis.lifetime.freeSessions', 'Free Sessions')}
                  value={`${fmtInt(lifetimeMetrics.freeCount)} (${fmtWithUnit(lifetimeMetrics.freeEnergy, 'kWh', 1)})`}
                />
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-gray-500">
                {t('costAnalysis.lifetime.noData', 'No data')}
              </div>
            )}
          </GlassPanel>

          {/* Environmental impact */}
          <GlassPanel glow="green" className="p-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Leaf className="h-4 w-4 text-green-400" />
              {t('costAnalysis.environment.title', 'Environmental Impact')}
            </h3>
            {coreStats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-green-500/10 p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">
                      {fmtNumber(coreStats.co2SavedKg, 1)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {t('costAnalysis.environment.kgCo2', 'kg CO₂ saved')}
                    </p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">
                      {fmtNumber(coreStats.treeEquiv, 1)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {t('costAnalysis.environment.treeEquiv', 'tree-years equivalent')}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="flex items-start gap-3">
                    <Trees className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                    <div>
                      <p className="text-sm text-gray-300">
                        {t(
                          'costAnalysis.environment.desc',
                          'By driving electric instead of a gas car, you have avoided the equivalent of',
                        )}{' '}
                        <span className="font-semibold text-green-400">
                          {fmtNumber(coreStats.co2SavedKg, 0)} kg
                        </span>{' '}
                        {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
                        {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
                        <span className="font-semibold text-green-400">
                          {fmtNumber(coreStats.treeEquiv, 1)}
                        </span>{' '}
                        {t(
                          'costAnalysis.environment.treesAbsorbing',
                          'trees absorbing carbon for a full year.',
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white">
                      {fmtNumber(coreStats.gallonsEquiv, 1)}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.environment.gallons', 'gallons avoided')}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white">
                      {fmtNumber(coreStats.co2SavedKg / 1000, 2)}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.environment.metricTons', 'metric tons CO₂')}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white">
                      {fmtNumber(coreStats.savings, 0)}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {t('costAnalysis.environment.dollarsSaved', '$ saved total')}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-gray-500">
                {t('costAnalysis.environment.noData', 'No data')}
              </div>
            )}
          </GlassPanel>
        </div>
      </div>
    </PageContainer>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function LifetimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <p className="truncate text-[10px] text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function CartesianGridComponent() {
  return <CartesianGrid {...chartGrid} />;
}
