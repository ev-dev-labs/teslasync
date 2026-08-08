import type { UnitPref } from '@/lib/unitConversion';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
import type { SeasonalFitStatus, SeasonalSupport } from '../../lib/seasonalEfficiency';

type Translate = (key: string, fallback: string) => string;

export function fitStatusLabel(status: SeasonalFitStatus, t: Translate): string {
  switch (status) {
    case 'ready':
      return t('seasonalEfficiency.fitStatus.ready', 'Ready');
    case 'insufficient samples':
      return t('seasonalEfficiency.fitStatus.samples', 'Insufficient samples');
    case 'insufficient span':
      return t('seasonalEfficiency.fitStatus.span', 'Insufficient span');
    case 'insufficient month coverage':
      return t('seasonalEfficiency.fitStatus.months', 'Insufficient month coverage');
    case 'singular':
      return t('seasonalEfficiency.fitStatus.singular', 'Singular fit');
    case 'numerical failure':
      return t('seasonalEfficiency.fitStatus.numericalFailure', 'Numerical failure');
  }
}

export function supportBandLabel(
  band: SeasonalSupport['band'],
  t: Translate,
): string {
  switch (band) {
    case 'thin':
      return t('seasonalEfficiency.supportBand.thin', 'Thin');
    case 'moderate':
      return t('seasonalEfficiency.supportBand.moderate', 'Moderate');
    case 'strong':
      return t('seasonalEfficiency.supportBand.strong', 'Strong');
  }
}

export function formatIntensityWhPerM(
  value: number | null | undefined,
  unitPrefs: UnitPref,
  precision = 2,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const displayUnitsPerM = convertDistanceFromSI(1, unitPrefs.distance);
  const metersPerDisplayUnit = displayUnitsPerM > 0 ? 1 / displayUnitsPerM : 1_000;
  const displayEnergy = convertEnergyFromSI(
    value * metersPerDisplayUnit,
    unitPrefs.energy,
  );
  const formatted = new Intl.NumberFormat(unitPrefs.locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(displayEnergy);
  return `${formatted} ${unitPrefs.energy} / ${unitPrefs.distance}`;
}

export function toDisplayIntensity(
  value: number | null | undefined,
  unitPrefs: UnitPref,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const displayUnitsPerM = convertDistanceFromSI(1, unitPrefs.distance);
  const metersPerDisplayUnit = displayUnitsPerM > 0 ? 1 / displayUnitsPerM : 1_000;
  return convertEnergyFromSI(value * metersPerDisplayUnit, unitPrefs.energy);
}

export function formatDisplayIntensity(
  value: number | null | undefined,
  unitPrefs: UnitPref,
  precision = 2,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(unitPrefs.locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
  return `${formatted} ${unitPrefs.energy} / ${unitPrefs.distance}`;
}

export function formatDisplayDistance(
  value: number | null | undefined,
  unitPrefs: UnitPref,
  precision = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(unitPrefs.locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
  return `${formatted} ${unitPrefs.distance}`;
}

export function formatSignedIntensityWhPerMPerYear(
  value: number | null | undefined,
  unitPrefs: UnitPref,
  precision = 3,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatIntensityWhPerM(Math.abs(value), unitPrefs, precision)} / yr`;
}

export function formatLocalDate(
  timestampMs: number | null | undefined,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      new Date(timestampMs),
    );
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
      new Date(timestampMs),
    );
  }
}

export function formatMonth(
  month: number,
  locale: string,
  timeZone: string,
): string {
  const safeMonth = Math.max(1, Math.min(12, month));
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone,
  }).format(new Date(Date.UTC(2024, safeMonth - 1, 15)));
}

export function formatInteger(value: number | null | undefined, locale: string): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(value);
}
