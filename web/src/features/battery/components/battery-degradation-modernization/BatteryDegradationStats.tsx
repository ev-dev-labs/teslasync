import { useTranslation } from 'react-i18next';
import { Battery, Calendar, TrendingDown, Zap } from 'lucide-react';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat, type DateFormatter } from '@/hooks/useDateFormat';
import type { BatteryHealthAnalytics } from '@/types/energy';

export function ageLabel(
  months: number,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  // Missing/invalid duration is not a recorded duration of zero months.
  if (!Number.isFinite(months) || months < 0) return '—';
  const m = Math.round(months);
  if (m < 12) return t('battery.degradation.monthsCount', '{{count}} months', { count: m });
  const years = Math.floor(m / 12);
  const rem = m % 12;
  return rem > 0
    ? t('battery.degradation.yearsMonthsShort', '{{y}}y {{m}}m', { y: years, m: rem })
    : t('battery.degradation.yearsCount', '{{y}} years', { y: years });
}

export type BatteryDegradationHealth = Omit<BatteryHealthAnalytics, 'history' | 'current_soh' | 'estimated_capacity_wh' | 'charge_habits_score' | 'stress_level' | 'risk_factors' | 'prediction' | 'degradation_rate_pct_per_year' | 'battery_age_months' | 'total_cycles' | 'avg_depth_of_discharge_pct'> & {
  history: (Omit<BatteryHealthAnalytics['history'][number], 'range_m' | 'odometer_m' | 'soh_pct' | 'capacity_wh'> & {
    soh_pct: number | null;
    capacity_wh: number | null;
    range_m: number | null;
    odometer_m: number | null;
    range_sampled_at?: string | null;
    odometer_sampled_at?: string | null;
  })[];
  total_cycles?: number | null;
  avg_depth_of_discharge_pct?: number | null;
  valid_energy_count?: number;
  battery_age_months?: number | null;
  observation_duration_months?: number | null;
  observation_started_at?: string | null;
  observation_source?: string;
  degradation_rate_pct_per_year?: number | null;
  degradation_rate_available?: boolean;
  prediction: Omit<BatteryHealthAnalytics['prediction'], 'slope_per_year' | 'years_to_80_pct'> & {
    interval?: {
      method: string;
      sample_count: number;
      residual_df: number;
      multiplier: number;
      empirical_coverage: string;
    } | null;
    fit_valid?: boolean;
    crossing_status?: 'future_crossing' | 'no_future_crossing' | 'below_threshold' | 'insufficient_fit';
    slope_per_year?: number | null;
    years_to_80_pct?: number | null;
  };
  current_soh?: number | null;
  estimated_capacity_wh?: number | null;
  current_soh_available?: boolean;
  estimated_capacity_wh_available?: boolean;
  valid_charge_count?: number;
  valid_start_soc_count?: number;
  valid_end_soc_count?: number;
  valid_dod_count?: number;
  total_cycles_available?: boolean;
  temp_exposure_available?: boolean;
  temp_sample_count?: number;
  charge_habits_score?: number | null;
  charge_habits_available?: boolean;
  stress_level?: string | null;
  risk_factors: (Omit<BatteryHealthAnalytics['risk_factors'][number], 'score'> & {
    score: number | null;
    available?: boolean;
  })[];
};

interface Props {
  data: BatteryDegradationHealth | undefined;
  loading?: boolean;
  retained?: boolean;
  prediction?: boolean;
}

export function batteryNumber(value: unknown, min = -Infinity, max = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value : null;
}

export function batteryCount(value: unknown): number | null {
  const number = batteryNumber(value, 0);
  return number != null && Number.isSafeInteger(number) ? number : null;
}

export function batteryStress(data: BatteryDegradationHealth | undefined): string | null {
  return data?.charge_habits_available !== false && batteryNumber(data?.charge_habits_score, 0, 100) != null &&
    (data?.stress_level === 'Low' || data?.stress_level === 'Medium' || data?.stress_level === 'High')
    ? data.stress_level : null;
}

export function driveDropEvidence(
  data: BatteryDegradationHealth | undefined,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  return t('battery.degradation.driveDropEvidence',
    'Arithmetic mean of start SOC minus end SOC across {{count}} valid recorded drives (0–100% SOC, start ≥ end, including zero drops). This is per-drive SOC change, not depth of a full discharge/recharge cycle. The depth score is 100 minus this mean.', {
      count: batteryCount(data?.valid_dod_count) ?? t('common.unknown', 'Unknown'),
    });
}

export function capacityEvidence(
  data: BatteryDegradationHealth | undefined,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  const source = data?.capacity_source;
  const original = data?.original_capacity_wh;
  const baseline = t('battery.degradation.capacityEvidence',
    'Nominal baseline evidence: capacity_source={{source}}; original_capacity_wh={{capacity}}. This baseline is an assumption, not an observed or calibrated original pack capacity.', {
      source: source || t('common.unknown', 'Unknown'),
      capacity: original != null && Number.isFinite(original) && original > 0
        ? String(original) : t('common.unknown', 'Unknown'),
    });
  const estimator = data?.estimated_capacity_wh_available !== false &&
    batteryNumber(data?.estimated_capacity_wh, 0) != null
    ? t('battery.degradation.capacityEstimator',
      'Current capacity is a telemetry-derived estimator: the median of up to eight recent valid daily capacity estimates, or EnergyRemaining / (BatteryLevel / 100) when history is unavailable. SOH compares this estimator with the nominal baseline; it is not a direct capacity measurement.')
    : t('battery.degradation.capacityEstimatorUnavailable',
      'Observed current-capacity estimator unavailable; the nominal baseline alone does not establish current capacity or SOH.');
  return `${baseline} ${estimator} ${t('battery.degradation.capacityCalibration',
    'Actual pack-capacity calibration remains candidate BD-C01; no calibration is applied here.')}`;
}

export function observationEvidence(
  data: BatteryDegradationHealth | undefined,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
  formatStart: DateFormatter,
): string {
  return t('battery.degradation.observationEvidence',
    'Observation duration is time since the earliest retained battery history, charging session or drive session; it is not true pack age. Start: {{start}}; source: {{source}}. Manufacture and replacement dates are unknown.', {
      start: formatStart(data?.observation_started_at),
      source: data?.observation_source ?? t('common.unknown', 'Unknown'),
    });
}

export function predictionIntervalEvidence(
  data: BatteryDegradationHealth | undefined,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  const interval = data?.prediction?.interval;
  if (data?.prediction?.fit_valid !== true || !interval ||
    interval.method !== 'approximate_ols_future_observation' ||
    !Number.isInteger(interval.sample_count) || interval.sample_count < 3 ||
    interval.residual_df !== interval.sample_count - 2 ||
    interval.multiplier !== (interval.sample_count > 30 ? 1.96 : 2)) {
    return t('battery.degradation.predictionIntervalUnavailable',
      'Approximate prediction band: fit sample basis and multiplier unavailable. This is not a calibrated 95% confidence interval; empirical coverage remains unmeasured in BD-C01.');
  }
  return t('battery.degradation.predictionIntervalEvidence',
    'Approximate OLS prediction band for a future SOH observation, not confidence in the fitted mean. Basis: {{count}} valid dated SOH samples (finite, 0–100%); residual degrees of freedom: {{df}}. Half-width = {{multiplier}} × residual standard error × sqrt(1 + 1/n + (x − mean(x))² / Sxx). The fixed multiplier is 2 for 3–30 samples and 1.96 above 30, not a Student-t quantile. Displayed bounds are clipped to 0–100% and rounded to 0.1 percentage point. Linear trend and independent, constant-variance residuals are model assumptions; empirical coverage remains unmeasured in BD-C01, not calibrated 95% coverage.', {
      count: interval.sample_count,
      df: interval.residual_df,
      multiplier: interval.multiplier,
    });
}

/** SI values enter the shared renderer here; rate and duration retain specialist formatting. */
export function BatteryDegradationStats({ data, loading = false, retained = false, prediction = false }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatDate } = useDateFormat();
  const capacityHelp = capacityEvidence(data, t);
  const cycleHelp = t('battery.degradation.chargeEquivalentEvidence',
    'Estimated charge equivalents: recorded energy added across {{count}} valid charging sessions divided by nominal original capacity. Partial equivalents add up; zero-energy sessions are included. This is not a measured lifetime count of full discharge/recharge cycles. The nominal capacity is an assumption.')
    .replace('{{count}}', String(batteryCount(data?.valid_energy_count) ?? t('common.unknown', 'Unknown')));
  const driveHelp = driveDropEvidence(data, t);
  const rateHelp = t('help.battery.degradationRate',
    'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).');
  const rate = prediction ? data?.prediction?.slope_per_year : data?.degradation_rate_pct_per_year;
  const stress = batteryStress(data);
  const rateMetric: StatMetric = {
    metricId: 'rate',
    occurrenceId: prediction ? 'battery-degradation-fit-rate' : 'battery-degradation-rate',
    label: prediction ? t('battery.degradation.fittedSohTrend', 'Fitted SOH trend') : t('battery.degradation.rate', 'Degradation rate'),
    rawValue: rate != null && Number.isFinite(rate) &&
      (prediction ? data?.prediction?.fit_valid === true && data.prediction.has_enough_data
        : data?.degradation_rate_available !== false) ? rate : null,
    display: { formatter: raw => ({ value: `${fmtNumber(raw)}%/yr`, unit: '' }) },
    description: prediction
      ? t('battery.degradation.fittedSohTrendHelp', 'Signed fitted SOH change in percentage points per year. Negative values indicate declining health; positive values indicate improving fitted health.')
      : rateHelp,
    context: <TrendingDown className="h-4 w-4" aria-hidden="true" />,
  };
  const metrics: StatMetric[] = prediction ? [
    rateMetric,
    {
      metricId: 'status',
      rawValue: stress != null
        ? t(`battery.degradation.stressValue.${stress}`, stress) : null,
      label: t('battery.degradation.stress', 'Stress level'),
    },
    {
      metricId: 'number', rawValue: data?.total_cycles_available === false ||
        data?.total_cycles == null || !Number.isFinite(data.total_cycles) || data.total_cycles < 0
        ? null : data.total_cycles,
      display: { precision: 2 },
      label: t('battery.degradation.totalCycles', 'Total cycles'),
      description: cycleHelp,
    },
    {
      metricId: 'percent', rawValue: (batteryCount(data?.valid_dod_count) ?? 0) > 0
        ? batteryNumber(data?.avg_depth_of_discharge_pct, 0, 100) : null,
      label: t('battery.degradation.avgDoD', 'Avg depth of discharge'),
      display: { precision: 2 },
      description: driveHelp,
    },
  ] : [
    {
      metricId: 'percent', rawValue: data?.current_soh_available === false ? null : batteryNumber(data?.current_soh, 0, 100),
      label: t('battery.degradation.currentSoh', 'Current SOH'),
      description: capacityHelp,
      context: <Battery className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'energy', rawValue: data?.estimated_capacity_wh_available === false ? null : batteryNumber(data?.estimated_capacity_wh, 0),
      display: { precision: 1 },
      label: t('battery.degradation.estimatedCapacity', 'Estimated capacity'),
      description: capacityHelp,
      context: <Zap className="h-4 w-4" aria-hidden="true" />,
    },
    rateMetric,
    {
      metricId: 'number',
      rawValue: data?.observation_duration_months != null && Number.isFinite(data.observation_duration_months) &&
        data.observation_duration_months >= 0 ? data.observation_duration_months : null,
      display: { formatter: raw => ({ value: ageLabel(raw, t), unit: '' }) },
      label: t('battery.degradation.observationDuration', 'Observation duration'),
      description: observationEvidence(data, t, formatDate),
      context: <Calendar className="h-4 w-4" aria-hidden="true" />,
    },
  ];
  return (
    <BatteryEvidenceBrief
      id={prediction ? 'battery-degradation-prediction-stats' : 'battery-degradation-summary'}
      title={prediction ? t('battery.degradation.brief.prediction', 'Degradation model evidence') : t('battery.degradation.brief.summary', 'Battery degradation evidence')}
      metrics={metrics}
      secondary={loading ? undefined : `${capacityHelp} ${observationEvidence(data, t, formatDate)}${prediction ? ` ${cycleHelp} ${driveHelp} ${predictionIntervalEvidence(data, t)}` : ''}`}
      loading={loading}
      retained={retained}
      period={{
        kind: 'unknown',
        label: t('battery.degradation.sampleWindow', 'Available battery history'),
        reason: t('battery.degradation.estimateEvidence',
          'Health, capacity, range and forecasts are estimates derived from available telemetry snapshots, not direct pack-capacity measurements.'),
      }}
    />
  );
}
