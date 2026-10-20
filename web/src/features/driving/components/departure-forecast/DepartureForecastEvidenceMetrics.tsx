import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';

import type { DepartureForecast } from '../../lib/departureForecast';
import {
  DepartureForecastEvidenceMetricGroup,
  type DepartureForecastEvidenceMetric,
} from './DepartureForecastEvidenceMetricGroup';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DepartureForecastEvidenceMetricsProps {
  forecast: DepartureForecast;
  locale: string;
}

export function DepartureForecastEvidenceMetrics({
  forecast,
  locale,
}: DepartureForecastEvidenceMetricsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const accounting = forecast.accounting;
  const evidence = forecast.evidenceStrength;
  const percent = (value: number | null): string =>
    value != null ? `${fmtNumber(value * 100, undefined, locale)}%` : '—';
  const excluded =
    accounting.invalidRows +
    accounting.futureRows +
    accounting.outsideWindowRows;
  const accountingMetrics: DepartureForecastEvidenceMetric[] = [
    {
      label: t('departure.quality.returned', 'Rows returned'),
      value: fmtInt(accounting.returnedRows, locale),
    },
    {
      label: t('departure.quality.included', 'Included departures'),
      value: fmtInt(accounting.includedRows, locale),
    },
    {
      label: t('departure.quality.excluded', 'Excluded rows'),
      value: fmtInt(excluded, locale),
    },
    {
      label: t('departure.quality.invalid', 'Invalid start times'),
      value: fmtInt(accounting.invalidRows, locale),
    },
    {
      label: t('departure.quality.future', 'Future start times'),
      value: fmtInt(accounting.futureRows, locale),
    },
    {
      label: t('departure.quality.outside', 'Outside 120 days'),
      value: fmtInt(accounting.outsideWindowRows, locale),
    },
  ];
  const coverageMetrics: DepartureForecastEvidenceMetric[] = [
    {
      label: t('departure.quality.activeDays', 'Active local days'),
      value: fmtInt(forecast.activeDays, locale),
    },
    {
      label: t('departure.quality.activeWeeks', 'Active local weeks'),
      value: fmtInt(forecast.activeWeeks, locale),
    },
    {
      label: t('departure.quality.elapsedDays', 'Elapsed returned-history span (days)'),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(forecast.observedSpanDays, undefined, locale)
          : '—',
    },
    {
      label: t('departure.quality.elapsedWeeks', 'Elapsed returned-history span (weeks)'),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(forecast.observedWeeks, undefined, locale)
          : '—',
    },
    {
      label: t('departure.quality.occupiedCells', 'Occupied cells'),
      value: fmtInt(evidence.occupiedCells, locale),
    },
    {
      label: t('departure.quality.repeatedCells', 'Repeated cells'),
      value: fmtInt(evidence.repeatedCells, locale),
    },
    {
      label: t(
        'departure.quality.repeatedDepartures',
        'Repeat events beyond first',
      ),
      value: fmtInt(evidence.repeatedDepartures, locale),
    },
    {
      label: t(
        'departure.quality.meanCalendarOpportunities',
        'Mean model-assumed opportunities per occupied cell',
      ),
      value:
        forecast.totalDepartures > 0
          ? fmtNumber(
              evidence.meanOccupiedCellOccurrences,
              undefined,
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
        'departure.quality.calendarOpportunityScore',
        'Calendar-opportunity ingredient',
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
          'departure.quality.calendarTitle',
          'Elapsed calendar opportunity and recorded recurrence',
        )}
        metrics={coverageMetrics}
      />
      <Text as="p" variant="caption">
        {t(
          'departure.quality.calendarQualifier',
          'Elapsed spans run from the earliest included drive start to the fixed model anchor. Cell opportunities are model-assumed elapsed local-hour boundaries over returned history, not measured recording coverage or proof that the vehicle was monitored during gaps.',
        )}
      </Text>
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
