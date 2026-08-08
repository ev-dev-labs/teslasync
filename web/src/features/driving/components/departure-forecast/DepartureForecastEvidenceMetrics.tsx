import { useTranslation } from 'react-i18next';

import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import {
  DepartureForecastEvidenceMetricGroup,
  type DepartureForecastEvidenceMetric,
} from './DepartureForecastEvidenceMetricGroup';

interface DepartureForecastEvidenceMetricsProps {
  forecast: DepartureForecast;
  locale: string;
}

export function DepartureForecastEvidenceMetrics({
  forecast,
  locale,
}: DepartureForecastEvidenceMetricsProps) {
  const { t } = useTranslation();
  const accounting = forecast.accounting;
  const evidence = forecast.evidenceStrength;
  const percent = (value: number | null): string =>
    value != null ? `${fmtNumber(value * 100, 0, locale)}%` : '—';
  const excluded =
    accounting.invalidRows +
    accounting.futureRows +
    accounting.outsideWindowRows;
  const accountingMetrics: DepartureForecastEvidenceMetric[] = [
    {
      label: t('departure.quality.returned', 'Rows returned'),
      value: fmtInt(accounting.returnedRows),
    },
    {
      label: t('departure.quality.included', 'Included departures'),
      value: fmtInt(accounting.includedRows),
    },
    {
      label: t('departure.quality.excluded', 'Excluded rows'),
      value: fmtInt(excluded),
    },
    {
      label: t('departure.quality.invalid', 'Invalid start times'),
      value: fmtInt(accounting.invalidRows),
    },
    {
      label: t('departure.quality.future', 'Future start times'),
      value: fmtInt(accounting.futureRows),
    },
    {
      label: t('departure.quality.outside', 'Outside 120 days'),
      value: fmtInt(accounting.outsideWindowRows),
    },
  ];
  const coverageMetrics: DepartureForecastEvidenceMetric[] = [
    {
      label: t('departure.quality.activeDays', 'Active local days'),
      value: fmtInt(forecast.activeDays),
    },
    {
      label: t('departure.quality.activeWeeks', 'Active local weeks'),
      value: fmtInt(forecast.activeWeeks),
    },
    {
      label: t('departure.quality.spanDays', 'Observed span (days)'),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(forecast.observedSpanDays, 1, locale)
          : '—',
    },
    {
      label: t('departure.quality.spanWeeks', 'Observed span (weeks)'),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(forecast.observedWeeks, 1, locale)
          : '—',
    },
    {
      label: t('departure.quality.occupiedCells', 'Occupied cells'),
      value: fmtInt(evidence.occupiedCells),
    },
    {
      label: t('departure.quality.repeatedCells', 'Repeated cells'),
      value: fmtInt(evidence.repeatedCells),
    },
    {
      label: t(
        'departure.quality.repeatedDepartures',
        'Repeat events beyond first',
      ),
      value: fmtInt(evidence.repeatedDepartures),
    },
    {
      label: t(
        'departure.quality.meanOccurrences',
        'Mean occupied-cell occurrences',
      ),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(
              evidence.meanOccupiedCellOccurrences,
              1,
              locale,
            )
          : '—',
    },
  ];
  const supportMetrics: DepartureForecastEvidenceMetric[] = [
    {
      label: t('departure.quality.volumeScore', 'Event-volume ingredient'),
      value: percent(
        forecast.totalDepartures > 0 ? evidence.volumeScore : null,
      ),
    },
    {
      label: t(
        'departure.quality.activeWeekScore',
        'Active-week ingredient',
      ),
      value: percent(
        forecast.totalDepartures > 0 ? evidence.activeWeekScore : null,
      ),
    },
    {
      label: t('departure.quality.repeatScore', 'Repeat-cell ingredient'),
      value: percent(
        forecast.totalDepartures > 0 ? evidence.repeatScore : null,
      ),
    },
    {
      label: t(
        'departure.quality.occurrenceScore',
        'Cell-exposure ingredient',
      ),
      value: percent(
        forecast.totalDepartures > 0 ? evidence.occurrenceScore : null,
      ),
    },
    {
      label: t('departure.quality.supportIndex', 'Evidence support index'),
      value: percent(
        forecast.totalDepartures > 0 ? evidence.value : null,
      ),
    },
    {
      label: t(
        'departure.quality.concentration',
        'Routine concentration',
      ),
      value: percent(forecast.routineStability.routineConcentration),
    },
    {
      label: t('departure.quality.entropy', 'Normalized routine entropy'),
      value: percent(forecast.routineStability.normalizedEntropy),
    },
    {
      label: t('departure.quality.topCellShare', 'Top-cell event share'),
      value: percent(forecast.routineStability.topCellShare),
    },
  ];

  return (
    <div className="space-y-5">
      <DepartureForecastEvidenceMetricGroup
        title={t(
          'departure.quality.accountingTitle',
          'Returned-row accounting',
        )}
        metrics={accountingMetrics}
      />
      <DepartureForecastEvidenceMetricGroup
        title={t(
          'departure.quality.coverageTitle',
          'Coverage and recurrence',
        )}
        metrics={coverageMetrics}
      />
      <DepartureForecastEvidenceMetricGroup
        title={t(
          'departure.quality.supportTitle',
          'Support and descriptive stability',
        )}
        metrics={supportMetrics}
      />
    </div>
  );
}
