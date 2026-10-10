import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceWeather
} from '@/api/hooks/useScience';
import type {
  ScienceWeather,
  ScienceWeatherPoint
} from '@/api/types';
import { EmptyState, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import {
  DataTable,
  Text,
  type Column
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import { formatEnergyPerDistance } from '@/lib/unitConversion';
import { Link } from 'react-router-dom';
import { asList, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { ScienceSummaryBrief } from './operationalbrief-all/ScienceSummaryBrief';

export function WeatherPanel({ window }: { window: ScienceWindow }) {
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  const t = useT();
  const query = useScienceWeather(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceWeather | undefined = state.data;
  const { formatSpeed, formatTemperature, unitPrefs } = useUnits();
  const fitGuide = t('science.weather.fitGuide', 'Pearson r requires at least five complete matched drives and variation in both values. An unknown coefficient is not a zero effect; association is not causation.');
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'matched-drives',
      label: t('science.overview.weather', 'Weather matches'),
      rawValue: data ? asList(data.points).length : null,
      description: data?.weather_unknown
        ? t('science.weather.weatherUnknown', 'weather unknown')
        : data ? t('science.weather.joined', 'joined {{n}} drives', { n: asList(data.points).length }) : t('science.overview.noCount', 'Awaiting a successful report'),
      context: data?.honesty,
    },
    {
      metricId: 'ratio', occurrenceId: 'density-correlation',
      label: t('science.weather.densityCorrelation', 'r(density, residual)'),
      rawValue: data?.density_r,
      description: fitGuide,
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '' }) },
      missingReason: t('science.unknown', 'unknown'),
    },
    {
      metricId: 'ratio', occurrenceId: 'wind-correlation',
      label: t('science.weather.windCorrelation', 'r(wind, residual)'),
      rawValue: data?.wind_r,
      description: fitGuide,
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '' }) },
      missingReason: t('science.unknown', 'unknown'),
    },
    {
      metricId: 'count', occurrenceId: 'rain-drives',
      label: t('science.weather.rainCount', 'Rain drives'),
      rawValue: data?.rain_n,
      description: t('science.weather.rainDry', 'rain/dry'),
      context: data ? `${t('science.weather.rainDry', 'rain/dry')}: ${fmtNumber(data.rain_n)}/${fmtNumber(data.dry_n)}` : undefined,
    },
    {
      metricId: 'count', occurrenceId: 'dry-drives',
      label: t('science.weather.dryCount', 'Dry drives'),
      rawValue: data?.dry_n,
      description: t('science.weather.rainDry', 'rain/dry'),
    },
  ];

  const columns: Column<ScienceWeatherPoint>[] = [
    { key: 'drive', header: t('science.weather.drive', 'Drive'), render: (r) =>
      <Link className="underline underline-offset-4" to={`/drives/${r.drive_id}`}>#{r.drive_id}</Link> },
    { key: 'at', header: t('science.weather.at', 'Start'), render: (r) => formatDateTime(r.at) },
    { key: 'temp', align: 'right', header: t('science.weather.temp', 'Temperature'), render: (r) => r.temp_c != null ? formatTemperature(r.temp_c) : unknown(t) },
    { key: 'wind', align: 'right', header: t('science.weather.wind', 'Wind'), render: (r) => (r.wind_mps != null ? formatSpeed(r.wind_mps) : unknown(t)) },
    { key: 'density', align: 'right', header: t('science.weather.density', 'Air density'), render: (r) => r.density_kg_m3 != null ? `${fmtScientificNumber(r.density_kg_m3, 3)} kg/m³` : unknown(t) },
    { key: 'rain', align: 'right', header: t('science.weather.rain', 'Precipitation'), render: (r) => r.precip_mm != null ? `${fmtNumber(r.precip_mm)} mm` : unknown(t) },
    { key: 'session', align: 'right', header: t('science.weather.session', 'Session energy / distance'), render: (r) =>
      r.session_wh_per_m != null ? formatEnergyPerDistance(r.session_wh_per_m, unitPrefs) : unknown(t) },
    {
      key: 'res', align: 'right', header: t('science.weather.residual', 'Residual'),
      render: (r) => r.residual_wh_per_m != null ? formatEnergyPerDistance(r.residual_wh_per_m, unitPrefs) : unknown(t),
    },
  ];

  return (
    <section data-testid="science-weather" className="min-w-0">
      <LayoutCard title={t('science.weather.title', 'Weather coupling (correlation)')}>
      <StaleRefreshWarning state={state} />
      <ScienceSummaryBrief
        title={t('science.weather.title', 'Weather coupling (correlation)')}
        description={data?.honesty ?? t('science.overview.weatherMeaning', 'Associations with energy residuals do not establish causation.')}
        metrics={metrics} states={[state]} window={window} report={data}
        limited={!data || data.weather_unknown || data.density_r == null || data.wind_r == null}
        testId="science-weather-brief"
      />
      <SourceContent
        state={state.status === 'initial' ? 'loading' : state.fatalError ? 'error' : !data ? 'empty' : 'ready'}
        label={t('science.weather.title', 'Weather coupling (correlation)')}
        emptyMessage={t('science.empty', 'No fit inputs in this window.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={state.fatalError}
        errorRecovery={{ onRetry: () => { void query.refetch(); } }}
        loadingContent={<Skeleton className="h-32" />}
        emptyContent={<EmptyState title={t('science.weather.title', 'Weather coupling')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />}
      >
      {data && (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          <Text as="p" size="sm" color="secondary">
            {fitGuide}
          </Text>
          {asList(data.points).length > 0 ? (
            <DataTable
              tableId="science:weather"
              columns={columns}
              data={asList(data.points)}
              keyExtractor={(r) => `${r.drive_id}`}
              emptyMessage={t('science.empty', 'No fit inputs in this window.')}
              pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
              mobileColumns={['drive', 'temp', 'res']}
            />
          ) : (
            <Text as="p" size="sm" color="secondary">{t('science.weather.empty', 'No drives joined archive weather in this window.')}</Text>
          )}
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
      </SourceContent>
      </LayoutCard>
    </section>
  );
}
