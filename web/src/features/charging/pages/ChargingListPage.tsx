import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BatteryCharging, Zap, TrendingUp,
  Plug, Home, Bolt, Calendar, ArrowUpDown, Filter, Download,
  Cable, Activity, Gauge,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Select, Pagination } from '@/components/ui';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  RadialGauge, ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
} from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { DateRangeFilter } from '@/components/forms';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtWithUnit, fmtPercent } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { cn } from '@/lib/cn';
import type { ChargingSession } from '@/api/types';
import {
  ChargingSessionCard,
  getChargerCategory,
  formatDuration,
} from '../components/ChargingSessionCard';

type SortKey = 'date' | 'energy' | 'cost' | 'duration' | 'power';
type ChargerFilter = 'all' | 'supercharger' | 'dc' | 'home';

export default function ChargingListPage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.list.title', 'Charging Sessions'));

  const { convertDistance, distanceUnit } = useSettings();
  const { data: vehicles } = useVehicles();

  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDesc, setSortDesc] = useState(true);
  const [chargerFilter, setChargerFilter] = useState<ChargerFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const {
    data: sessions,
    isLoading,
    error,
    refetch,
  } = useChargingSessionsPaginated(vehicleId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });

  // ── Aggregated Statistics ────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const totalEnergy = sessions.reduce((sum, s) => sum + s.charge_energy_added, 0);
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const totalDuration = sessions.reduce((sum, s) => sum + s.duration_min, 0);
    const withPower = sessions.filter((s) => s.charger_power);
    const avgPower =
      withPower.reduce((sum, s) => sum + (s.charger_power ?? 0), 0) /
      Math.max(withPower.length, 1);
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
    const homeCount = sessions.filter(
      (s) => getChargerCategory(s.fast_charger_type) === 'home',
    ).length;
    const scCount = sessions.filter(
      (s) => getChargerCategory(s.fast_charger_type) === 'supercharger',
    ).length;
    const dcCount = sessions.filter(
      (s) => getChargerCategory(s.fast_charger_type) === 'dc',
    ).length;
    return {
      totalEnergy, totalCost, totalDuration, avgPower, avgCostPerKwh,
      homeCount, scCount, dcCount, count: sessions.length,
    };
  }, [sessions]);

  // ── Charger type breakdown (pie chart) ───────────────────────────────
  const chargerBreakdown = useMemo(() => {
    if (!stats) return [];
    return [
      { name: t('charging.chargerTypes.supercharger', 'Supercharger'), value: stats.scCount, fill: CHARGER_COLORS.supercharger },
      { name: t('charging.chargerTypes.dc', 'DC Fast'), value: stats.dcCount, fill: CHARGER_COLORS.dc },
      { name: t('charging.chargerTypes.home', 'Home / AC'), value: stats.homeCount, fill: CHARGER_COLORS.home },
    ].filter((d) => d.value > 0);
  }, [stats, t]);

  // ── Energy trend (last 20 sessions) ──────────────────────────────────
  const energyTrend = useMemo(() => {
    if (!sessions) return [];
    return sessions
      .slice(0, 20)
      .reverse()
      .map((s) => ({
        date: formatDateShort(s.start_date),
        energy: parseFloat((s.charge_energy_added ?? 0).toFixed(1)),
        cost: s.cost ?? 0,
      }));
  }, [sessions]);

  // ── Cost by charger type ─────────────────────────────────────────────
  const chargerLabels: Record<string, string> = {
    supercharger: t('charging.chargerTypes.supercharger', 'Supercharger'),
    dc: t('charging.chargerTypes.dc', 'DC Fast'),
    home: t('charging.chargerTypes.home', 'Home / AC'),
  };

  const costByType = useMemo(() => {
    if (!sessions) return [];
    const groups: Record<string, { energy: number; cost: number; count: number }> = {};
    sessions.forEach((s) => {
      const cat = chargerLabels[getChargerCategory(s.fast_charger_type)];
      if (!groups[cat]) groups[cat] = { energy: 0, cost: 0, count: 0 };
      groups[cat].energy += s.charge_energy_added;
      groups[cat].cost += s.cost ?? 0;
      groups[cat].count++;
    });
    return Object.entries(groups).map(([name, v]) => ({
      name,
      energy: parseFloat(v.energy.toFixed(1)),
      cost: parseFloat(v.cost.toFixed(2)),
      perKwh: v.energy > 0 ? parseFloat((v.cost / v.energy).toFixed(3)) : 0,
    }));
  }, [sessions, chargerLabels]);

  // ── Start battery level distribution (bar chart) ─────────────────────
  const startLevelDist = useMemo(() => {
    if (!sessions) return [];
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 10}%`,
      count: 0,
    }));
    sessions.forEach((s) => {
      const idx = Math.min(Math.floor(s.start_battery_level / 10), 9);
      buckets[idx].count++;
    });
    return buckets;
  }, [sessions]);

  // ── AC/DC energy & cost breakdown ────────────────────────────────────
  const acDcBreakdown = useMemo(() => {
    if (!sessions) return null;
    const ac = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
    const dc = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
    sessions.forEach((s) => {
      const isDC = !!(s.fast_charger_type || (s.charger_power && s.charger_power > 22));
      const bucket = isDC ? dc : ac;
      bucket.energy += s.charge_energy_added;
      bucket.energyUsed += s.charge_energy_used ?? s.charge_energy_added;
      bucket.cost += s.cost ?? 0;
      bucket.count++;
      bucket.totalDuration += s.duration_min;
      if (!s.cost || s.cost === 0) {
        bucket.freeCount++;
        bucket.freeEnergy += s.charge_energy_added;
      }
    });
    return {
      ac,
      dc,
      total: {
        energy: ac.energy + dc.energy,
        cost: ac.cost + dc.cost,
        freeEnergy: ac.freeEnergy + dc.freeEnergy,
        freeCount: ac.freeCount + dc.freeCount,
      },
    };
  }, [sessions]);

  // ── Charging efficiency stats ────────────────────────────────────────
  const efficiencyStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const withEfficiency = sessions.filter(
      (s) => s.charge_energy_used && s.charge_energy_used > 0 && s.charge_energy_added > 0,
    );
    if (withEfficiency.length === 0) return null;
    const efficiencies = withEfficiency.map((s) => ({
      id: s.id,
      date: s.start_date,
      efficiency: (s.charge_energy_added / s.charge_energy_used!) * 100,
      added: s.charge_energy_added,
      used: s.charge_energy_used!,
    }));
    const totalAdded = withEfficiency.reduce((sum, s) => sum + s.charge_energy_added, 0);
    const totalUsed = withEfficiency.reduce((sum, s) => sum + s.charge_energy_used!, 0);
    const avgEfficiency = totalUsed > 0 ? (totalAdded / totalUsed) * 100 : 0;
    const sorted = [...efficiencies].sort((a, b) => b.efficiency - a.efficiency);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const wallLoss = totalUsed - totalAdded;
    return { avgEfficiency, best, worst, wallLoss, totalAdded, totalUsed, count: withEfficiency.length };
  }, [sessions]);

  // ── Charger specs breakdown ──────────────────────────────────────────
  const chargerSpecsBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const byVoltage: Record<string, { count: number; energy: number; power: number }> = {};
    const byPhase: Record<string, { count: number; energy: number }> = {};
    const byCable: Record<string, { count: number; energy: number }> = {};
    const byBrand: Record<string, { count: number; energy: number; power: number }> = {};
    sessions.forEach((s) => {
      if (s.charger_voltage != null) {
        const vKey = s.charger_voltage <= 130 ? '120V' : s.charger_voltage <= 260 ? '240V' : '480V+';
        if (!byVoltage[vKey]) byVoltage[vKey] = { count: 0, energy: 0, power: 0 };
        byVoltage[vKey].count++;
        byVoltage[vKey].energy += s.charge_energy_added;
        byVoltage[vKey].power += s.charger_power ?? 0;
      }
      if (s.charger_phases != null) {
        const pKey = `${s.charger_phases}-phase`;
        if (!byPhase[pKey]) byPhase[pKey] = { count: 0, energy: 0 };
        byPhase[pKey].count++;
        byPhase[pKey].energy += s.charge_energy_added;
      }
      if (s.conn_charge_cable) {
        if (!byCable[s.conn_charge_cable]) byCable[s.conn_charge_cable] = { count: 0, energy: 0 };
        byCable[s.conn_charge_cable].count++;
        byCable[s.conn_charge_cable].energy += s.charge_energy_added;
      }
      if (s.fast_charger_brand) {
        if (!byBrand[s.fast_charger_brand]) byBrand[s.fast_charger_brand] = { count: 0, energy: 0, power: 0 };
        byBrand[s.fast_charger_brand].count++;
        byBrand[s.fast_charger_brand].energy += s.charge_energy_added;
        byBrand[s.fast_charger_brand].power += s.charger_power ?? 0;
      }
    });
    const toArr = (obj: Record<string, { count: number; energy: number; power?: number }>) =>
      Object.entries(obj)
        .map(([name, v]) => ({ name, ...v, avgPower: v.power ? v.power / v.count : undefined }))
        .sort((a, b) => b.count - a.count);
    return {
      voltage: toArr(byVoltage),
      phase: toArr(byPhase),
      cable: toArr(byCable),
      brand: toArr(byBrand),
    };
  }, [sessions]);

  // ── Enhanced statistics ──────────────────────────────────────────────
  const enhancedStats = useMemo(() => {
    if (!sessions || sessions.length === 0 || !stats) return null;
    const avgDuration = stats.count > 0 ? stats.totalDuration / stats.count : 0;
    const chargerTypes = sessions.reduce<Record<string, number>>((acc, s) => {
      const ct = s.fast_charger_type || 'AC/Home';
      acc[ct] = (acc[ct] || 0) + 1;
      return acc;
    }, {});
    const mostCommonType = Object.entries(chargerTypes).sort((a, b) => b[1] - a[1])[0];
    return { avgDuration, mostCommonType };
  }, [sessions, stats]);

  // ── Filtered & sorted sessions ───────────────────────────────────────
  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    let filtered: ChargingSession[] = sessions;
    if (chargerFilter !== 'all') {
      filtered = filtered.filter((s) => getChargerCategory(s.fast_charger_type) === chargerFilter);
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'date':
          cmp = new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
          break;
        case 'energy':
          cmp = b.charge_energy_added - a.charge_energy_added;
          break;
        case 'cost':
          cmp = (b.cost ?? 0) - (a.cost ?? 0);
          break;
        case 'duration':
          cmp = b.duration_min - a.duration_min;
          break;
        case 'power':
          cmp = (b.charger_power ?? 0) - (a.charger_power ?? 0);
          break;
      }
      return sortDesc ? cmp : -cmp;
    });
  }, [sessions, chargerFilter, sortBy, sortDesc]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <PageContainer
      title={t('charging.list.title', 'Charging Sessions')}
      subtitle={t('charging.list.subtitle', 'Cost analysis, charger breakdown, energy patterns, and performance tracking')}
      actions={
        vehicles && vehicles.length > 0 ? (
          <Select
            value={String(vehicleId ?? '')}
            onChange={(e) => setSelectedVehicle(Number(e.target.value))}
            className="text-sm px-3 py-2"
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
          />
        ) : undefined
      }
    >
      {/* Date range filter */}
      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={() => setPage(1)}
        />
      </FadeIn>

      {error && <QueryError error={error as Error} onRetry={refetch} />}

      {/* ── Hero Gauges ─────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
              <RadialGauge value={stats.count} max={Math.max(stats.count, 50)} label={t('charging.gauges.sessions', 'Sessions')} unit="" color="#00f0ff" />
              <RadialGauge value={Math.round(stats.totalEnergy)} max={Math.max(stats.totalEnergy, 500)} label={t('charging.gauges.energy', 'Energy')} unit="kWh" color="#10b981" />
              <RadialGauge value={parseFloat((stats.totalCost ?? 0).toFixed(0))} max={Math.max(stats.totalCost ?? 0, 100)} label={t('charging.gauges.totalCost', 'Total Cost')} unit="$" color="#f59e0b" />
              <RadialGauge value={Math.round(stats.avgPower)} max={250} label={t('charging.gauges.avgPower', 'Avg Power')} unit="kW" color="#a855f7" />
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-neon-green">
                  $<AnimatedNumber value={parseFloat((stats.avgCostPerKwh ?? 0).toFixed(2))} decimals={3} />
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                  {t('charging.gauges.avgCostPerKwh', 'Avg $/kWh')}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('charging.noStats', 'No charging statistics available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Quick Metrics ───────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-3 sm:p-5">
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-neon-green"><AnimatedNumber value={stats.homeCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
                  <Home className="h-3 w-3" /> {t('charging.metrics.home', 'Home')}
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-red"><AnimatedNumber value={stats.scCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
                  <Bolt className="h-3 w-3" /> {t('charging.metrics.supercharger', 'Supercharger')}
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-amber"><AnimatedNumber value={stats.dcCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
                  <Zap className="h-3 w-3" /> {t('charging.metrics.dcFast', 'DC Fast')}
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(stats.totalDuration)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.totalTime', 'Total Time')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">${fmtInt(stats.totalCost / 12)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.monthlyAvg', 'Monthly Avg')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{fmtWithUnit(stats.totalEnergy / stats.count, 'kWh')}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.perSession', 'Per Session')}</p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('charging.noMetrics', 'No charging metrics available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Charts Row ──────────────────────────────────────────── */}
      {sessions && sessions.length > 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Energy & Cost Trend */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-neon-cyan" />
                {t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
              </h3>
              <div className="h-40 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={energyTrend}>
                    <defs>
                      <ChartGradient id="eGrad" color="#10b981" />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="energy" name="Energy (kWh)" stroke="#10b981" fill="url(#eGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cost" name="Cost ($)" stroke="#f59e0b" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Charger Type Breakdown */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Plug className="h-4 w-4 text-neon-purple" />
                {t('charging.charts.chargerBreakdown', 'Charger Breakdown')}
              </h3>
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                <div className="h-36 w-36 sm:h-48 sm:w-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chargerBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                        {chargerBreakdown.map((d, i) => (
                          <Cell key={i} fill={d.fill} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-3">
                  {costByType.map((ct) => (
                    <div key={ct.name}>
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">{ct.name}</span>
                        <span className="text-[var(--text-primary)] font-medium">{fmtWithUnit(ct.energy, 'kWh')}</span>
                      </div>
                      <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>${fmtNumber(ct.cost)} total</span>
                        <span>${fmtNumber(ct.perKwh)}/kWh</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      {/* ── AC/DC Detailed Stats ────────────────────────────────── */}
      {acDcBreakdown && (acDcBreakdown.ac.count > 0 || acDcBreakdown.dc.count > 0) && (
        <FadeIn delay={0.17}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-neon-amber" />
              {t('charging.stats.chargingByType', 'Charging Stats by Type')}
            </h3>
            {/* Energy Split Bar */}
            <div className="mb-4">
              <p className="text-[10px] text-[var(--text-muted)] mb-1.5">
                {t('charging.stats.energySplitLabel', 'Energy Split (AC vs DC)')}
              </p>
              <div
                className="grid h-4 rounded-full overflow-hidden"
                style={{ gridTemplateColumns: `${(acDcBreakdown.ac.energy / acDcBreakdown.total.energy) * 100}% ${(acDcBreakdown.dc.energy / acDcBreakdown.total.energy) * 100}%` }}
              >
                {acDcBreakdown.ac.energy > 0 && (
                  <div className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] bg-blue-500">
                    AC {fmtPercent((acDcBreakdown.ac.energy / acDcBreakdown.total.energy) * 100)}
                  </div>
                )}
                {acDcBreakdown.dc.energy > 0 && (
                  <div className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] bg-amber-500">
                    DC {fmtPercent((acDcBreakdown.dc.energy / acDcBreakdown.total.energy) * 100)}
                  </div>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
                <span>AC: {acDcBreakdown.ac.energy >= 1000 ? fmtWithUnit(acDcBreakdown.ac.energy / 1000, 'MWh') : fmtWithUnit(acDcBreakdown.ac.energy, 'kWh')}</span>
                <span>Total: {acDcBreakdown.total.energy >= 1000 ? fmtWithUnit(acDcBreakdown.total.energy / 1000, 'MWh') : fmtWithUnit(acDcBreakdown.total.energy, 'kWh')}</span>
                <span>DC: {acDcBreakdown.dc.energy >= 1000 ? fmtWithUnit(acDcBreakdown.dc.energy / 1000, 'MWh') : fmtWithUnit(acDcBreakdown.dc.energy, 'kWh')}</span>
              </div>
            </div>
            {/* Stats Table */}
            <div className="overflow-x-auto">
              <AcDcTable ac={acDcBreakdown.ac} dc={acDcBreakdown.dc} />
            </div>
            {/* Free charging total */}
            {acDcBreakdown.total.freeCount > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-center gap-4 text-xs text-[var(--text-secondary)]">
                <span>{t('charging.table.freeCharged', 'Free charged')}: <strong className="text-neon-green">{acDcBreakdown.total.freeCount} sessions</strong></span>
                <span>{t('charging.table.freeEnergy', 'Free energy')}: <strong className="text-neon-green">{fmtWithUnit(acDcBreakdown.total.freeEnergy, 'kWh')}</strong></span>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Battery Level at Charge Start ───────────────────────── */}
      {startLevelDist.length > 0 && sessions && sessions.length > 5 && (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-neon-amber" />
              {t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
              <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
                {t('charging.charts.batteryLevelHint', 'How low do you typically go before charging?')}
              </span>
            </h3>
            <div className="h-36 sm:h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={startLevelDist}>
                  {chartGrid}
                  <XAxis dataKey="range" tick={axisTickSm} />
                  <YAxis tick={axisTickSm} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Sessions" fill="#f59e0b" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Enhanced Statistics Summary ──────────────────────────── */}
      {stats && enhancedStats && (
        <FadeIn delay={0.22}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-neon-cyan" />
              {t('charging.stats.detailedStatistics', 'Detailed Statistics')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={stats.count} /></p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.totalSessions', 'Total Sessions')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(enhancedStats.avgDuration)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgDuration', 'Avg Duration')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-purple">{fmtWithUnit(stats.avgPower, 'kW')}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgPower', 'Avg Power')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{enhancedStats.mostCommonType[0]}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.topCharger', 'Top Charger')} ({enhancedStats.mostCommonType[1]}×)</p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-amber">${fmtNumber(stats.totalCost)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.totalCost', 'Total Cost')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-green">${fmtNumber(stats.avgCostPerKwh)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgCostPerKwh', 'Avg $/kWh')}</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Charging Efficiency Panel ───────────────────────────── */}
      {efficiencyStats && (
        <FadeIn delay={0.24}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-neon-green" />
              {t('charging.efficiency.title', 'Charging Efficiency')}
              <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
                {t('charging.efficiency.hint', 'Wall-to-battery energy conversion')} ({efficiencyStats.count} {t('charging.efficiency.sessionsWithData', 'sessions with data')})
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <GlassPanel className="p-5 text-center">
                <p className="text-2xl font-bold text-neon-cyan">{fmtPercent(efficiencyStats.avgEfficiency)}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.average', 'Average Efficiency')}</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full rounded-full bg-neon-cyan" style={{ width: `${Math.min(efficiencyStats.avgEfficiency, 100)}%` }} />
                </div>
              </GlassPanel>
              <GlassPanel className="p-5 text-center">
                <p className="text-2xl font-bold text-neon-green">{fmtPercent(efficiencyStats.best.efficiency)}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.best', 'Best Session')}</p>
                <p className="text-[9px] text-[var(--text-muted)]">{formatDateTime(efficiencyStats.best.date)}</p>
              </GlassPanel>
              <GlassPanel className="p-5 text-center">
                <p className="text-2xl font-bold text-neon-red">{fmtPercent(efficiencyStats.worst.efficiency)}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.worst', 'Worst Session')}</p>
                <p className="text-[9px] text-[var(--text-muted)]">{formatDateTime(efficiencyStats.worst.date)}</p>
              </GlassPanel>
              <GlassPanel className="p-5 text-center">
                <p className="text-2xl font-bold text-neon-amber">{fmtWithUnit(efficiencyStats.wallLoss, 'kWh')}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.wallLoss', 'Wall-to-Battery Loss')}</p>
                <p className="text-[9px] text-[var(--text-muted)]">{fmtNumber(efficiencyStats.totalUsed)} kWh → {fmtNumber(efficiencyStats.totalAdded)} kWh</p>
              </GlassPanel>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Charger Specs Breakdown ─────────────────────────────── */}
      <FadeIn delay={0.26}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Gauge className="h-4 w-4 text-neon-purple" />
            {t('charging.specs.title', 'Charger Specs Breakdown')}
          </h3>
          {chargerSpecsBreakdown && (chargerSpecsBreakdown.voltage.length > 0 || chargerSpecsBreakdown.cable.length > 0 || chargerSpecsBreakdown.brand.length > 0) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                {chargerSpecsBreakdown.voltage.length > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1">
                      <Zap className="h-3 w-3" /> {t('charging.specs.byVoltage', 'By Voltage')}
                    </p>
                    <div className="space-y-2">
                      {chargerSpecsBreakdown.voltage.map((v) => (
                        <div key={v.name} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--text-primary)] font-medium">{v.name}</span>
                          <span className="text-[var(--text-muted)]">{v.count} sessions · {fmtWithUnit(v.energy, 'kWh')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState message={t('charging.specs.noVoltage', 'No voltage data')} />
                )}
              </div>
              <div>
                {chargerSpecsBreakdown.phase.length > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1">
                      <Activity className="h-3 w-3" /> {t('charging.specs.byPhase', 'By Phase')}
                    </p>
                    <div className="space-y-2">
                      {chargerSpecsBreakdown.phase.map((v) => (
                        <div key={v.name} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--text-primary)] font-medium">{v.name}</span>
                          <span className="text-[var(--text-muted)]">{v.count} sessions · {fmtWithUnit(v.energy, 'kWh')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState message={t('charging.specs.noPhase', 'No phase data')} />
                )}
              </div>
              <div>
                {chargerSpecsBreakdown.cable.length > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1">
                      <Cable className="h-3 w-3" /> {t('charging.specs.byCable', 'By Cable')}
                    </p>
                    <div className="space-y-2">
                      {chargerSpecsBreakdown.cable.map((v) => (
                        <div key={v.name} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--text-primary)] font-medium">{v.name}</span>
                          <span className="text-[var(--text-muted)]">{v.count} sessions · {fmtWithUnit(v.energy, 'kWh')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState message={t('charging.specs.noCable', 'No cable data')} />
                )}
              </div>
              <div>
                {chargerSpecsBreakdown.brand.length > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1">
                      <Plug className="h-3 w-3" /> {t('charging.specs.byBrand', 'By Brand')}
                    </p>
                    <div className="space-y-2">
                      {chargerSpecsBreakdown.brand.map((v) => (
                        <div key={v.name} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--text-primary)] font-medium">{v.name}</span>
                          <span className="text-[var(--text-muted)]">{v.count} · {v.avgPower != null ? `${fmtInt(v.avgPower)} kW avg` : fmtWithUnit(v.energy, 'kWh')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState message={t('charging.specs.noBrand', 'No brand data')} />
                )}
              </div>
            </div>
          ) : (
            <EmptyState message={t('charging.specs.noData', 'No charger specification data available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Session List ────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : sessions && sessions.length > 0 ? (
        <>
          {/* Sort & Filter controls */}
          <FadeIn delay={0.22}>
            <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 sm:gap-3">
              <h3 className="section-title flex items-center gap-2 flex-1">
                <BatteryCharging className="h-4 w-4 text-neon-green" />
                {t('charging.sessions.allSessions', 'All Sessions')}
                <span className="text-xs text-[var(--text-muted)] font-normal ml-1">({filteredSessions.length})</span>
              </h3>
              {/* Charger filter */}
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
                <Filter className="h-3 w-3 text-[var(--text-muted)] ml-1" />
                {([
                  { key: 'all' as const, label: t('charging.sessions.filterAll', 'All') },
                  { key: 'home' as const, label: t('charging.sessions.filterHome', 'Home') },
                  { key: 'supercharger' as const, label: t('charging.sessions.filterSC', 'SC') },
                  { key: 'dc' as const, label: t('charging.sessions.filterDC', 'DC') },
                ] as const).map((f) => (
                  <Button
                    key={f.key}
                    variant="ghost"
                    size="sm"
                    onClick={() => setChargerFilter(f.key)}
                    className={cn(
                      'px-2.5 py-1 h-auto rounded-md text-[11px] font-medium transition-all',
                      chargerFilter === f.key
                        ? 'bg-white/[0.08] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-transparent',
                    )}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              {/* Sort controls */}
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
                <ArrowUpDown className="h-3 w-3 text-[var(--text-muted)] ml-1" />
                {([
                  { key: 'date' as const, label: t('charging.sessions.sortDate', 'Date') },
                  { key: 'energy' as const, label: t('charging.sessions.sortEnergy', 'kWh') },
                  { key: 'cost' as const, label: t('charging.sessions.sortCost', 'Cost') },
                  { key: 'duration' as const, label: t('charging.sessions.sortTime', 'Time') },
                  { key: 'power' as const, label: t('charging.sessions.sortPower', 'Power') },
                ] as const).map((k) => (
                  <Button
                    key={k.key}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (sortBy === k.key) setSortDesc(!sortDesc);
                      else { setSortBy(k.key); setSortDesc(true); }
                    }}
                    className={cn(
                      'px-2.5 py-1 h-auto rounded-md text-[11px] font-medium transition-all',
                      sortBy === k.key
                        ? 'bg-white/[0.08] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-transparent',
                    )}
                  >
                    {k.label}
                    {sortBy === k.key && <span className="ml-0.5">{sortDesc ? '↓' : '↑'}</span>}
                  </Button>
                ))}
              </div>
              {/* Export buttons */}
              <div className="flex items-center gap-2">
                <a
                  href={`/api/v1/export/charging?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                  download="teslasync-charging.csv"
                >
                  <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                    {t('charging.sessions.exportCsv', 'CSV')}
                  </Button>
                </a>
                <a
                  href={`/api/v1/export/charging?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                  download="teslasync-charging.json"
                >
                  <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                    {t('charging.sessions.exportJson', 'JSON')}
                  </Button>
                </a>
              </div>
            </div>
          </FadeIn>

          {/* Session cards */}
          <StaggerContainer className="space-y-3">
            {filteredSessions.map((s) => (
              <StaggerItem key={s.id}>
                <ChargingSessionCard session={s} convertDistance={convertDistance} distanceUnit={distanceUnit} />
              </StaggerItem>
            ))}
          </StaggerContainer>

          {/* Pagination */}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={
              filteredSessions.length < pageSize
                ? (page - 1) * pageSize + filteredSessions.length
                : page * pageSize + 1
            }
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </>
      ) : (
        <EmptyState
          icon={<BatteryCharging className="h-8 w-8" />}
          title={t('charging.list.empty', 'No charging sessions yet')}
          message={t('charging.list.emptyDescription', 'Charging data will appear here once your vehicle records a session.')}
        />
      )}
    </PageContainer>
  );
}

// ── AC/DC Breakdown Table ─────────────────────────────────────────────
interface AcDcBucket {
  energy: number;
  energyUsed: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

interface AcDcTableRow {
  label: string;
  color: string;
  energy: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

function AcDcTable({
  ac,
  dc,
}: {
  ac: AcDcBucket;
  dc: AcDcBucket;
}) {
  const { t } = useTranslation();
  const data: AcDcTableRow[] = [
    { label: t('charging.table.acCharging', 'AC Charging'), color: '#3b82f6', ...ac },
    { label: t('charging.table.dcCharging', 'DC Charging'), color: '#f59e0b', ...dc },
  ].filter((r) => r.count > 0);

  const columns: Column<AcDcTableRow>[] = [
    { key: 'type', header: t('charging.table.type', 'Type'), render: (r) => <span className={cn('font-medium', r.color === '#3b82f6' ? 'text-blue-500' : 'text-amber-500')}>{r.label}</span> },
    { key: 'sessions', header: t('charging.table.sessionCount', 'Sessions'), render: (r) => <span className="text-[var(--text-primary)]">{r.count}</span>, className: 'text-right' },
    { key: 'energy', header: t('charging.table.energy', 'Energy'), render: (r) => <span className="text-[var(--text-primary)]">{r.energy >= 1000 ? fmtWithUnit(r.energy / 1000, 'MWh') : fmtWithUnit(r.energy, 'kWh')}</span>, className: 'text-right' },
    { key: 'cost', header: t('charging.table.cost', 'Cost'), render: (r) => <span className="text-neon-amber">${fmtNumber(r.cost)}</span>, className: 'text-right' },
    { key: 'perKwh', header: t('charging.table.costPerKwh', '$/kWh'), render: (r) => <span className="text-[var(--text-secondary)]">${r.energy > 0 ? fmtNumber(r.cost / r.energy) : '—'}</span>, className: 'text-right' },
    { key: 'avgEnergy', header: t('charging.table.avgEnergy', 'Avg Energy'), render: (r) => <span className="text-[var(--text-secondary)]">{fmtWithUnit(r.energy / r.count, 'kWh')}</span>, className: 'text-right' },
    { key: 'avgTime', header: t('charging.table.avgTime', 'Avg Time'), render: (r) => <span className="text-[var(--text-secondary)]">{formatDuration(r.totalDuration / r.count)}</span>, className: 'text-right' },
    { key: 'free', header: t('charging.table.free', 'Free'), render: (r) => <span className="text-neon-green">{r.freeCount > 0 ? `${r.freeCount} (${fmtWithUnit(r.freeEnergy, 'kWh')})` : '—'}</span>, className: 'text-right' },
  ];

  return (
    <DataTable<AcDcTableRow>
      columns={columns}
      data={data}
      keyExtractor={(r) => r.label}
      compact
    />
  );
}
