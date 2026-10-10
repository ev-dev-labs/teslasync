import type { TFunction } from 'i18next';
import type { StatMetric, MetricPreferences, StatPeriod } from '@/components/data-display';
import type { ComplianceApportionment } from '@/types/ownership';
import type { UnitPref } from '@/lib/unitConversion';
import { formatDateTime } from '@/lib/dateFormat';
import { formatPct } from '../../formatters';

export function complianceSummary(
  report: ComplianceApportionment | undefined,
  units: UnitPref,
  precision: number,
  locale: string,
  t: TFunction,
): { metrics: StatMetric[]; preferences: MetricPreferences; period: StatPeriod } {
  const currency = report?.currency?.trim() ?? '';
  const rowCurrencies = (report?.jurisdictions ?? [])
    .filter((row) => row.jurisdiction_code !== 'UNASSIGNED'
      || [row.road_usage_charge_minor, row.registration_fee_minor, row.total_liability_minor]
        .some((amount) => amount != null && amount !== 0))
    .map((row) => row.currency?.trim() ?? '');
  const mixed = rowCurrencies.some((code) => code !== '' && code !== currency);
  const currencyList = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'currency') => string[];
  }).supportedValuesOf?.('currency');
  const knownCurrency = /^[A-Z]{3}$/.test(currency) && currency !== 'XXX'
    && currency !== 'XTS' && (!currencyList || currencyList.includes(currency));
  const unknownRowCurrency = rowCurrencies.some((code) => !code);
  const currencyReason = mixed
    ? t('ownership.compliance.stat.mixedCurrency', 'Mixed currencies; see the jurisdiction amounts below.')
    : !knownCurrency || unknownRowCurrency
      ? t('ownership.compliance.stat.unknownCurrency', 'The recorded liability currency is unknown.')
      : undefined;
  let fractionDigits = 2;
  if (knownCurrency) {
    try {
      fractionDigits = new Intl.NumberFormat(units.locale ?? 'en-US', {
        style: 'currency', currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      // Match the existing minor-unit formatter's invalid-locale fallback.
    }
  }
  const major = (minor: number | null | undefined) =>
    currencyReason || minor == null ? null : minor / 10 ** fractionDigits;
  const period: StatPeriod = report?.window?.from && report.window.to
    ? {
        kind: 'analysis',
        label: `${formatDateTime(report.window.from, { tz: 'UTC' })} → ${formatDateTime(report.window.to, { tz: 'UTC' })}`,
        start: report.window.from, endExclusive: report.window.to,
        timezone: 'UTC', completeness: 'unknown',
        provenance: t(
          'ownership.compliance.stat.periodSource',
          'Recorded apportionment window; source coverage and limitations are shown in the evidence below.',
        ),
      }
    : {
        kind: 'unknown',
        label: t('ownership.compliance.summary.title', 'Period liability'),
        reason: t('ownership.compliance.stat.unknownPeriod', 'No recorded apportionment window is available.'),
      };
  return {
    preferences: {
      units: { ...units, precision, locale },
      currency: { kind: 'iso', value: currency },
    },
    period,
    metrics: [
      {
        metricId: 'distance', occurrenceId: 'distance',
        label: t('ownership.compliance.stat.distance', 'Total distance'),
        rawValue: report?.total_distance_m,
        display: { precision: units.precision ?? 1, units: { locale: units.locale } },
        context: report?.drive_count != null
          ? t('ownership.compliance.stat.drives', '{{count}} drives', { count: report.drive_count })
          : t('ownership.compliance.stat.unknownDrives', 'Drive count unknown'),
      },
      {
        metricId: 'distance', occurrenceId: 'assigned',
        label: t('ownership.compliance.stat.assigned', 'Assigned to a jurisdiction'),
        rawValue: report?.assigned_distance_m,
        display: { precision: units.precision ?? 1, units: { locale: units.locale } },
      },
      {
        metricId: 'distance', occurrenceId: 'unassigned',
        label: t('ownership.compliance.stat.unassigned', 'Unassigned'),
        rawValue: report?.unassigned_distance_m,
        display: { precision: units.precision ?? 1, units: { locale: units.locale } },
        context: formatPct(report?.unassigned_share_pct, precision),
      },
      {
        metricId: 'currency', occurrenceId: 'roadUsage',
        label: t('ownership.compliance.stat.roadUsage', 'Road-usage charge'),
        rawValue: major(report?.total_road_usage_charge_minor),
        missingReason: currencyReason,
        display: { precision: fractionDigits, units: { locale: units.locale ?? 'en-US' } },
      },
      {
        metricId: 'currency', occurrenceId: 'liability',
        label: t('ownership.compliance.stat.liability', 'Total liability'),
        rawValue: major(report?.total_liability_minor),
        missingReason: currencyReason,
        display: { precision: fractionDigits, units: { locale: units.locale ?? 'en-US' } },
      },
      {
        metricId: 'mass', occurrenceId: 'emissions',
        label: t('ownership.compliance.stat.emissions', 'Attributed emissions'),
        rawValue: report?.total_emissions_g == null ? null : report.total_emissions_g / 1000,
        display: { precision },
      },
    ],
  };
}
