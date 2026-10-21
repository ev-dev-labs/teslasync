import type { TFunction } from 'i18next';
import type { AnomalyEntry } from '@/api/hooks/useAnomalies';
import { PASCALS_PER_KPA } from '@/lib/unitConversion';

type UnitFormatters = Record<'formatDistance' | 'formatSpeed' | 'formatTemperature' | 'formatPressure' | 'formatEnergy' | 'formatPower' | 'formatDuration', (value: number) => string>;
type Explanation = Pick<AnomalyEntry, 'signal' | 'message' | 'explanation_code' | 'explanation_params'>;

/** Preserve canonical numbers while converting explanation facts for display. */
export function formatAnomalyReading(value: number | null | undefined, unit: string | undefined, units: UnitFormatters, fmtNumber: (value: number) => string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  switch (unit) {
    case 'm': return units.formatDistance(value);
    case 'm/s': return units.formatSpeed(value);
    case '°C': return units.formatTemperature(value);
    case 'Pa': return units.formatPressure(value / PASCALS_PER_KPA);
    case 'kPa': return units.formatPressure(value);
    case 'Wh': return units.formatEnergy(value);
    case 'W': return units.formatPower(value);
    case 's': return units.formatDuration(value);
    default: return unit ? `${fmtNumber(value)} ${unit}` : fmtNumber(value);
  }

}

/** Unknown/incomplete explanation contracts retain the legacy prose verbatim. */
export function formatAnomalyExplanation(anomaly: Explanation, t: TFunction, formatReading: (value: number) => string, fmtNumber: (value: number) => string): string {
  const facts = anomaly.explanation_params;
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (!facts || !finite(facts.value) || !finite(facts.baseline)) return anomaly.message;
  const values = { signal: anomaly.signal, value: formatReading(facts.value), baseline: formatReading(facts.baseline) };
  switch (anomaly.explanation_code) {
    case 'z_score':
      return finite(facts.z_score) ? t('anomaly.explanation.zScore', '{{signal}} value {{value}} is {{sigma}} standard deviations from the mean ({{baseline}}).', { ...values, sigma: fmtNumber(facts.z_score) }) : anomaly.message;
    case 'below_minimum':
      return finite(facts.minimum) ? t('anomaly.explanation.belowMinimum', '{{signal}} value {{value}} is below the safe minimum ({{minimum}}).', { ...values, minimum: formatReading(facts.minimum) }) : anomaly.message;
    case 'above_maximum':
      return finite(facts.maximum) ? t('anomaly.explanation.aboveMaximum', '{{signal}} value {{value}} exceeds the safe maximum ({{maximum}}).', { ...values, maximum: formatReading(facts.maximum) }) : anomaly.message;
    case 'trend_increased':
      return t('anomaly.explanation.increased', '{{signal}} increased in the last 24 hours compared with the seven-day average ({{baseline}} to {{value}}).', values);
    case 'trend_decreased':
      return t('anomaly.explanation.decreased', '{{signal}} decreased in the last 24 hours compared with the seven-day average ({{baseline}} to {{value}}).', values);
    case 'trend_increased_percent':
      return finite(facts.percent_change) ? t('anomaly.explanation.increasedPercent', '{{signal}} increased by {{percent}}% in the last 24 hours compared with the seven-day average ({{baseline}} to {{value}}).', { ...values, percent: fmtNumber(facts.percent_change) }) : anomaly.message;
    case 'trend_decreased_percent':
      return finite(facts.percent_change) ? t('anomaly.explanation.decreasedPercent', '{{signal}} decreased by {{percent}}% in the last 24 hours compared with the seven-day average ({{baseline}} to {{value}}).', { ...values, percent: fmtNumber(facts.percent_change) }) : anomaly.message;
    default: return anomaly.message;
  }

}
