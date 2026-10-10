import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import type { StatMetric } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI } from '@/lib/unitConversion';

import { AnalyticsPanel } from './AnalyticsPanel';
import type { FleetAnalyticsQuery } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FleetSectionBrief } from '../operationalbrief-a-m/FleetSectionBrief';

export function DrivingTemperatureStats({ query }: { query: FleetAnalyticsQuery }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  // backend `temperature.{inside,outside}` is °C; convertTempFromSI expects °C.
  const fromC = (c: number) => convertTempFromSI(c, tempUnit);

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;
  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;
  // The backend always emits `temperature.{inside,outside}` — for a window with
  // no drives it returns a zeroed StatsSummary (`count: 0`) rather than omitting
  // the object. Treating that as "present" would render six misleading "0.0°"
  // cards and make the empty state unreachable, so gate on a real sample count.
  const insideHasData = !!insideTemp && safe(insideTemp.count) > 0;
  const outsideHasData = !!outsideTemp && safe(outsideTemp.count) > 0;
  const temperatureMetrics: StatMetric[] = [
    { metricId: 'temperature', occurrenceId: 'driving-inside-min', rawValue: insideHasData ? insideTemp?.min : null, label: t('analytics.driving.insideMin', 'Inside min') },
    { metricId: 'temperature', occurrenceId: 'driving-inside-average', rawValue: insideHasData ? insideTemp?.avg : null, label: t('analytics.driving.insideAvg', 'Inside avg') },
    { metricId: 'temperature', occurrenceId: 'driving-inside-max', rawValue: insideHasData ? insideTemp?.max : null, label: t('analytics.driving.insideMax', 'Inside max') },
    { metricId: 'temperature', occurrenceId: 'driving-outside-min', rawValue: outsideHasData ? outsideTemp?.min : null, label: t('analytics.driving.outsideMin', 'Outside min') },
    { metricId: 'temperature', occurrenceId: 'driving-outside-average', rawValue: outsideHasData ? outsideTemp?.avg : null, label: t('analytics.driving.outsideAvg', 'Outside avg') },
    { metricId: 'temperature', occurrenceId: 'driving-outside-max', rawValue: outsideHasData ? outsideTemp?.max : null, label: t('analytics.driving.outsideMax', 'Outside max') },
  ];
  const metrics: StatMetric[] = temperatureMetrics.map(metric => ({
    ...metric,
    context: t('analytics.brief.temperatureSamples', 'Inside samples: {{inside}}; outside samples: {{outside}}. A zero sample count does not establish a measured temperature.', {
      inside: insideTemp?.count ?? '—', outside: outsideTemp?.count ?? '—',
    }),
    display: { formatter: (raw: number) => ({ value: fmtNumber(fromC(raw)), unit: tempUnit }) },
  }));

  return (
    <AnalyticsPanel
      title={t('analytics.brief.temperatureTitle', 'Observed temperature measurements')}
      icon={<Thermometer className="h-4 w-4" />}
      loading={isLoading}
      error={err}
      onRetry={refetch}
      isEmpty={!insideHasData && !outsideHasData}
      emptyMessage={t('analytics.driving.noTempStats', 'No temperature stats')}
      skeletonHeight={120}
    >
      <FleetSectionBrief query={query} metrics={metrics}
        title={t('analytics.driving.tempStats', 'Temperature stats')}
        description={t('analytics.brief.temperatureDescription', 'Inside and outside temperatures have independent observed sample populations.')} />
    </AnalyticsPanel>
  );
}
