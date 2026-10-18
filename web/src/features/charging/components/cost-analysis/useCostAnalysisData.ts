import { useMemo } from 'react';
import type { ChargingSession } from '@/api/types';
import { distanceAddedM } from '../charging-curve/helpers';
import { ymdInTz } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { CHART_COLORS, CHARGER_COLORS } from '@/lib/colors';
import { KWH_PER_GALLON, CO2_PER_GAL_KG, KG_CO2_PER_TREE_YEAR } from './constants';
import { categorizeCharger, gasEquivalentCost } from './helpers';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import type {
  CoreStats, MonthlyBucket, ChargerTypeData, HourBucket,
  TouInsights, GasComparison, LifetimeMetrics,
} from './types';

interface UseCostAnalysisDataParams {
  sessions: ChargingSession[] | undefined;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  toDistanceDisplay: (meters: number) => number;
  isMiles: boolean;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function durationMinutes(start: string, end: string | null): number {
  if (!start || !end) return NaN;
  const milliseconds = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 60000 : NaN;
}

function coverage(sessions: ChargingSession[]) {
  const priced = sessions.filter(s => finite(s.cost_decimal) != null);
  const energized = sessions.filter(s => finite(s.total_energy_added_wh) != null);
  const paired = priced.filter(s => finite(s.total_energy_added_wh) != null);
  const pricedEnergyWh = paired.reduce((sum, s) => sum + s.total_energy_added_wh!, 0);
  const pairedCost = paired.reduce((sum, s) => sum + s.cost_decimal!, 0);
  const rate = pricedEnergyWh > 0 ? finite(pairedCost / (pricedEnergyWh / 1000)) : null;
  return {
    pricedCount: priced.length,
    energyCount: energized.length,
    pairedCount: paired.length,
    unknownCostCount: sessions.length - priced.length,
    unknownEnergyCount: sessions.length - energized.length,
    pricedEnergyWh,
    rate,
    rateStatus: rate == null ? 'unknown' as const
      : paired.length === sessions.length ? 'complete' as const : 'partial' as const,
  };
}

type Coverage = ReturnType<typeof coverage>;

interface SavingsDisclosure {
  /** Energy-content comparison, not savings proven from driven distance. */
  basis: 'energy-content-equivalence';
  modeledEvCost: number | null;
  modeledSavings: number | null;
  /** Uses recorded charging spend, but the gasoline comparator is still modeled. */
  actualSavings: number | null;
}

function savingsDisclosure(
  gasCost: number, energyKwh: number, actualSavings: number,
  electricityRate: number, dataCoverage: Coverage,
): SavingsDisclosure {
  const modeledEvCost = dataCoverage.unknownEnergyCount === 0 && finite(electricityRate) != null
    ? finite(energyKwh * electricityRate) : null;
  return {
    basis: 'energy-content-equivalence',
    modeledEvCost,
    modeledSavings: modeledEvCost == null ? null : finite(gasCost - modeledEvCost),
    actualSavings: finite(actualSavings),
  };
}

const OFF_PEAK_ASSUMPTION = {
  source: 'assumption',
  startHourInclusive: 22,
  endHourExclusive: 6,
} as const;

interface UseCostAnalysisDataResult {
  /** Timezone used for monthly accounting, hourly buckets and off-peak boundaries. */
  accountingTimezone: string;
  dateCoverage: { totalCount: number; datedCount: number; undatedCount: number };
  /** Bounds of loaded session starts, not query bounds or proof of continuous history. */
  observedWindow: {
    source: 'loaded-session-starts';
    firstSessionStart: string | null;
    lastSessionStart: string | null;
    observedMonthCount: number;
    accountingMonthCompleteness: 'unknown';
  };
  coverage: Coverage;
  rawMeasurements: {
    sessionId: number;
    cost: number | null;
    energyWh: number | null;
    durationMinutes: number | null;
    /** Charging-session odometer delta, not verified driven distance. */
    distanceM: number | null;
  }[];
  currencySummary: {
    currency: string | null;
    status: 'empty' | 'single' | 'mixed' | 'unknown';
    hasUnknownCurrency: boolean;
    unknownCostCount: number;
    totalsByCurrency: { currency: string; cost: number }[];
    recordedAmounts: { sessionId: number; amount: number | null; currency: string | null }[];
  };
  operationalTotals: { count: number; energyKwh: number; durationMinutes: number; distanceM: number };
  coreStats: (CoreStats & { coverage: Coverage; savingsDisclosure: SavingsDisclosure }) | null;
  monthlyData: (MonthlyBucket & {
    coverage: Coverage;
    accountingMonthCompleteness: 'unknown';
    savingsDisclosure: SavingsDisclosure;
  })[];
  costPerKwhTrend: { date: string; costPerKwh: number; currency: string }[];
  chargerTypeData: (ChargerTypeData & { coverage: Coverage })[];
  hourlyData: (HourBucket & { coverage: Coverage })[];
  /** Fixed analysis window, not an observed utility tariff. */
  touAssumptions: typeof OFF_PEAK_ASSUMPTION & { timezone: string };
  touInsights: (TouInsights & {
    /** Hour ranking compares recorded spend per session, not currency per kWh. */
    comparisonBasis: 'recorded-spend-per-session';
    /** Off-peak share excludes sessions whose start time is unknown. */
    datedSessionCount: number;
    undatedSessionCount: number;
  }) | null;
  gasComparison: (GasComparison & {
    basis: 'driven-distance';
    unavailableReason: 'no-verified-driven-distance';
    modeledSavings: number | null;
    actualSavings: number | null;
    projectionStatus: 'unavailable';
  }) | null;
  lifetimeMetrics: LifetimeMetrics | null;
}

export function useCostAnalysisData({
  sessions: sourceSessions,
  gasPrice,
  mpg,
  electricityRate,
}: UseCostAnalysisDataParams): UseCostAnalysisDataResult {
  const { tz: accountingTimezone, formatDateShort } = useDateFormat();
  const sessionDates = useMemo(() => {
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: accountingTimezone, hour: 'numeric', hourCycle: 'h23',
    });
    return new Map((sourceSessions ?? []).map(session => {
      const date = session.started_at ? new Date(session.started_at) : null;
      const validDate = date && Number.isFinite(date.getTime()) ? date : null;
      const hour = validDate
        ? Number(hourFormatter.formatToParts(validDate).find(part => part.type === 'hour')?.value)
        : NaN;
      return [session, {
        month: validDate ? ymdInTz(validDate, accountingTimezone)?.slice(0, 7) ?? null : null,
        hour: Number.isFinite(hour) ? hour : null,
        timestamp: validDate?.getTime() ?? null,
      }];
    }));
  }, [sourceSessions, accountingTimezone]);
  const dateCoverage = useMemo(() => {
    const totalCount = sourceSessions?.length ?? 0;
    const datedCount = (sourceSessions ?? []).filter(session => sessionDates.get(session)?.timestamp != null).length;
    return { totalCount, datedCount, undatedCount: totalCount - datedCount };
  }, [sourceSessions, sessionDates]);
  const observedWindow = useMemo<UseCostAnalysisDataResult['observedWindow']>(() => {
    const dates = [...sessionDates.values()];
    const timestamps = dates.flatMap(date => date.timestamp == null ? [] : [date.timestamp])
      .sort((a, b) => a - b);
    return {
      source: 'loaded-session-starts',
      firstSessionStart: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
      lastSessionStart: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
      observedMonthCount: new Set(dates.flatMap(date => date.month == null ? [] : [date.month])).size,
      accountingMonthCompleteness: 'unknown',
    };
  }, [sessionDates]);
  const rawMeasurements = useMemo(() => (sourceSessions ?? []).map(s => ({
    sessionId: s.id,
    cost: finite(s.cost_decimal),
    energyWh: finite(s.total_energy_added_wh),
    durationMinutes: finite(durationMinutes(s.started_at, s.ended_at)),
    distanceM: distanceAddedM(s),
  })), [sourceSessions]);
  const dataCoverage = useMemo(() => coverage(sourceSessions ?? []), [sourceSessions]);
  const currencySummary = useMemo<UseCostAnalysisDataResult['currencySummary']>(() => {
    const supportedCurrencies = new Set((Intl as typeof Intl & {
      supportedValuesOf(key: 'currency'): string[];
    }).supportedValuesOf('currency'));
    const recordedAmounts = (sourceSessions ?? []).map(session => ({
      sessionId: session.id,
      amount: session.cost_decimal != null && Number.isFinite(session.cost_decimal)
        ? session.cost_decimal : null,
      currency: supportedCurrencies.has(session.cost_currency?.trim().toUpperCase() ?? '')
        ? session.cost_currency!.trim().toUpperCase() : null,
    }));
    const currencies = new Set(recordedAmounts.flatMap(record => record.currency ? [record.currency] : []));
    const hasUnknownCurrency = recordedAmounts.some(record => record.currency == null);
    const status = recordedAmounts.length === 0 ? 'empty'
      : currencies.size > 1 ? 'mixed'
      : hasUnknownCurrency ? 'unknown' : 'single';
    const totals = new Map<string, number>();
    for (const record of recordedAmounts) {
      if (record.currency != null && record.amount != null) {
        totals.set(record.currency, (totals.get(record.currency) ?? 0) + record.amount);
      }
    }
    return {
      currency: status === 'single' ? recordedAmounts[0].currency : null,
      status,
      hasUnknownCurrency,
      unknownCostCount: recordedAmounts.filter(record => record.amount == null).length,
      totalsByCurrency: [...totals].map(([currency, cost]) => ({ currency, cost })),
      recordedAmounts,
    };
  }, [sourceSessions]);
  const operationalTotals = useMemo(() => ({
    count: sourceSessions?.length ?? 0,
    energyKwh: convertEnergyFromSI(rawMeasurements.reduce((sum, s) => sum + (s.energyWh ?? 0), 0), 'kWh'),
    durationMinutes: rawMeasurements.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
    distanceM: NaN,
  }), [sourceSessions, rawMeasurements]);
  // Existing views and calculator seeds are USD-only. Other denominations
  // remain in currencySummary, never relabelled or converted into USD.
  const sessions = currencySummary.currency === 'USD' ? sourceSessions : undefined;
  const coreStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const statsCoverage = coverage(sessions);
    const totalCost = statsCoverage.pricedCount > 0
      ? sessions.reduce((s, c) => s + (finite(c.cost_decimal) ?? 0), 0) : NaN;
    const totalEnergy = statsCoverage.energyCount > 0
      ? convertEnergyFromSI(sessions.reduce((s, c) => s + (finite(c.total_energy_added_wh) ?? 0), 0), 'kWh') : NaN;
    // Number-only view contracts stay compatible: existing formatters display
    // NaN as unavailable, while nullable raw values and coverage retain evidence.
    const avgCostPerKwh = statsCoverage.rate ?? NaN;
    const totalDuration = sessions.reduce((s, c) => s + (finite(durationMinutes(c.started_at, c.ended_at)) ?? 0), 0);

    // Stationary charging odometer deltas do not establish driven distance.
    // Keep distance-based views unavailable until verified driving evidence exists.
    const totalDistanceM = NaN;
    const costPerDist = NaN;

    const gallonsEquiv = totalEnergy / KWH_PER_GALLON;
    const gasCost = statsCoverage.unknownEnergyCount === 0 && finite(gasPrice) != null ? gallonsEquiv * gasPrice : NaN;
    const savings = statsCoverage.unknownCostCount === 0 ? gasCost - totalCost : NaN;
    const savingsPercent = gasCost !== 0 ? (savings / gasCost) * 100 : NaN;

    const co2SavedKg = gallonsEquiv * CO2_PER_GAL_KG;
    const treeEquiv = co2SavedKg / KG_CO2_PER_TREE_YEAR;

    return {
      totalCost, totalEnergy, avgCostPerKwh, totalDuration,
      totalDistanceM, costPerDist, gasCost, savings, savingsPercent,
      co2SavedKg, treeEquiv, gallonsEquiv, count: sessions.length, coverage: statsCoverage,
      savingsDisclosure: savingsDisclosure(gasCost, totalEnergy, savings, electricityRate, statsCoverage),
    };
  }, [sessions, gasPrice, electricityRate]);

  const monthlyData = useMemo<UseCostAnalysisDataResult['monthlyData']>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<string, { cost: number; energy: number; sessions: number; records: ChargingSession[] }> = {};
    sessions.forEach((s) => {
      const key = sessionDates.get(s)?.month;
      if (!key) return;
      if (!buckets[key]) buckets[key] = { cost: 0, energy: 0, sessions: 0, records: [] };
      buckets[key].records.push(s);
      buckets[key].cost += finite(s.cost_decimal) ?? 0;
      buckets[key].energy += finite(s.total_energy_added_wh) ?? 0;
      buckets[key].sessions++;
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const energyKwh = convertEnergyFromSI(v.energy, 'kWh');
        const bucketCoverage = coverage(v.records);
        const ge = bucketCoverage.unknownEnergyCount === 0 && finite(gasPrice) != null
          ? gasEquivalentCost(energyKwh, mpg, gasPrice) : NaN;
        const savings = bucketCoverage.unknownCostCount === 0 ? ge - v.cost : NaN;
        return {
          month,
          cost: bucketCoverage.pricedCount > 0 ? v.cost : NaN,
          energy: bucketCoverage.energyCount > 0 ? energyKwh : NaN,
          sessions: v.sessions,
          avgCostPerKwh: bucketCoverage.rate ?? NaN,
          coverage: bucketCoverage,
          gasEquiv: ge,
          savings,
          accountingMonthCompleteness: 'unknown',
          savingsDisclosure: savingsDisclosure(ge, energyKwh, savings, electricityRate, bucketCoverage),
        };
      });
  }, [sessions, gasPrice, mpg, electricityRate, sessionDates]);

  const costPerKwhTrend = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    return sessions
      .filter((s) => finite(s.cost_decimal) != null && finite(s.total_energy_added_wh) != null
        && s.total_energy_added_wh! > 0 && sessionDates.get(s)?.timestamp != null)
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      )
      .map((s) => ({
        date: formatDateShort(s.started_at),
        costPerKwh: (s.cost_decimal ?? 0) / ((s.total_energy_added_wh ?? 0) / 1000),
        currency: currencySummary.currency!,
      }));
  }, [sessions, currencySummary.currency, sessionDates, formatDateShort]);

  const chargerTypeData = useMemo<UseCostAnalysisDataResult['chargerTypeData']>(() => {
    if (!sessions || sessions.length === 0) return [];
    const groups: Record<string, { cost: number; energy: number; sessions: number; records: ChargingSession[] }> = {};
    sessions.forEach((s) => {
      const cat = categorizeCharger(s);
      if (!groups[cat]) groups[cat] = { cost: 0, energy: 0, sessions: 0, records: [] };
      groups[cat].records.push(s);
      groups[cat].cost += finite(s.cost_decimal) ?? 0;
      groups[cat].energy += finite(s.total_energy_added_wh) ?? 0;
      groups[cat].sessions++;
    });
    return Object.entries(groups)
      .map(([name, v]) => {
        const groupCoverage = coverage(v.records);
        return {
          name,
          cost: groupCoverage.pricedCount > 0 ? v.cost : NaN,
          energy: groupCoverage.energyCount > 0 ? convertEnergyFromSI(v.energy, 'kWh') : NaN,
          sessions: v.sessions,
          coverage: groupCoverage,
          color: CHARGER_COLORS[name] ?? CHART_COLORS[4],
        };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  const hourlyData = useMemo<UseCostAnalysisDataResult['hourlyData']>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<number, { sessions: number; totalCost: number; totalEnergy: number; records: ChargingSession[] }> = {};
    for (let h = 0; h < 24; h++) {
      buckets[h] = { sessions: 0, totalCost: 0, totalEnergy: 0, records: [] };
    }
    sessions.forEach((s) => {
      const hour = sessionDates.get(s)?.hour;
      if (hour == null) return;
      buckets[hour].sessions++;
      buckets[hour].records.push(s);
      buckets[hour].totalCost += finite(s.cost_decimal) ?? 0;
      buckets[hour].totalEnergy += finite(s.total_energy_added_wh) ?? 0;
    });
    return Object.entries(buckets)
      .map(([h, v]) => {
        const hourCoverage = coverage(v.records);
        return {
          hour: Number(h),
          label: `${String(h).padStart(2, '0')}:00`,
          sessions: v.sessions,
          avgCost: hourCoverage.pricedCount > 0 ? v.totalCost / hourCoverage.pricedCount : NaN,
          coverage: hourCoverage,
          totalEnergy: v.sessions === 0 || hourCoverage.energyCount > 0
            ? convertEnergyFromSI(v.totalEnergy, 'kWh') : NaN,
        };
      })
      .sort((a, b) => a.hour - b.hour);
  }, [sessions, sessionDates]);

  const touInsights = useMemo<UseCostAnalysisDataResult['touInsights']>(() => {
    if (hourlyData.length === 0) return null;
    const withSessions = hourlyData.filter((h) => h.sessions > 0 && h.coverage.unknownCostCount === 0);
    if (withSessions.length === 0) return null;
    const cheapest = [...withSessions].sort((a, b) => a.avgCost - b.avgCost)[0];
    const priciest = [...withSessions].sort((a, b) => b.avgCost - a.avgCost)[0];
    const busiest = [...hourlyData].sort((a, b) => b.sessions - a.sessions)[0];
    const offPeakCount = sessions?.filter((s) => {
      const h = sessionDates.get(s)?.hour;
      if (h == null) return false;
      return h >= OFF_PEAK_ASSUMPTION.startHourInclusive
        || h < OFF_PEAK_ASSUMPTION.endHourExclusive;
    }).length ?? 0;
    const datedSessionCount = hourlyData.reduce((sum, bucket) => sum + bucket.sessions, 0);
    const offPeakPct = (offPeakCount / datedSessionCount) * 100;
    return {
      cheapest, priciest, busiest, offPeakPct,
      comparisonBasis: 'recorded-spend-per-session',
      datedSessionCount,
      undatedSessionCount: (sessions?.length ?? 0) - datedSessionCount,
    };
  }, [hourlyData, sessions, sessionDates]);

  const gasComparison = useMemo<UseCostAnalysisDataResult['gasComparison']>(() => {
    if (!coreStats) return null;
    const { totalEnergy, totalCost } = coreStats;
    const gasCostCalc = NaN;
    const evCostCalc = coreStats.coverage.unknownEnergyCount === 0 && finite(electricityRate) != null
      ? totalEnergy * electricityRate : NaN;
    return {
      gasCost: gasCostCalc,
      evCost: evCostCalc,
      actualCost: totalCost,
      savings: NaN,
      monthlySavings: NaN,
      yearlySavings: NaN,
      costPerMileGas: NaN,
      costPerMileEV: coreStats.costPerDist,
      basis: 'driven-distance',
      unavailableReason: 'no-verified-driven-distance',
      modeledSavings: finite(gasCostCalc - evCostCalc),
      actualSavings: finite(gasCostCalc - totalCost),
      projectionStatus: 'unavailable',
    };
  }, [coreStats, electricityRate]);

  const lifetimeMetrics = useMemo<LifetimeMetrics | null>(() => {
    if (!sessions || sessions.length === 0 || !coreStats) return null;
    const avgSessionCost =
      coreStats.coverage.pricedCount > 0 ? coreStats.totalCost / coreStats.coverage.pricedCount : NaN;
    const avgSessionEnergy =
      coreStats.coverage.energyCount > 0 ? coreStats.totalEnergy / coreStats.coverage.energyCount : NaN;
    const durationCount = sessions.filter(s => finite(durationMinutes(s.started_at, s.ended_at)) != null).length;
    const avgDuration = durationCount > 0 ? coreStats.totalDuration / durationCount : NaN;
    const freeCount = sessions.filter(
      (s) => s.cost_decimal === 0,
    ).length;
    const freeEnergyWh = sessions
      .filter((s) => s.cost_decimal === 0)
      .reduce((sum, s) => sum + (finite(s.total_energy_added_wh) ?? 0), 0);
    // freeEnergy is rendered as kWh by LifetimeSummary (fmtWithUnit(_, 'kWh')),
    // so it must be converted from the SI Wh sum like every other energy
    // aggregate in this hook — otherwise the tile shows a 1000× value.
    const freeEnergy = sessions.some(s => s.cost_decimal === 0 && finite(s.total_energy_added_wh) == null)
      ? NaN : convertEnergyFromSI(freeEnergyWh, 'kWh');
    const recordedCosts = sessions.flatMap(s => finite(s.cost_decimal) == null ? [] : [s.cost_decimal!]);
    const maxSessionCost = recordedCosts.length ? Math.max(...recordedCosts) : NaN;
    const paidCosts = recordedCosts.filter(cost => cost !== 0);
    const minSessionCost = paidCosts.length > 0 ? Math.min(...paidCosts) : freeCount > 0 ? 0 : NaN;

    return {
      avgSessionCost, avgSessionEnergy, avgDuration,
      freeCount, freeEnergy, maxSessionCost, minSessionCost,
    };
  }, [sessions, coreStats]);

  return {
    accountingTimezone, dateCoverage, observedWindow,
    currencySummary, operationalTotals, coverage: dataCoverage, rawMeasurements,
    coreStats, monthlyData, costPerKwhTrend, chargerTypeData,
    touAssumptions: { ...OFF_PEAK_ASSUMPTION, timezone: accountingTimezone },
    hourlyData, touInsights, gasComparison, lifetimeMetrics,
  };
}
