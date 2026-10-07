import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceWeather
} from '@/api/hooks/useScience';
import type {
  ScienceWeather,
  ScienceWeatherPoint
} from '@/api/types';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { formatEnergyPerDistance } from '@/lib/unitConversion';
import { Link } from 'react-router-dom';
import { asList, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';

export function WeatherPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceWeather(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceWeather | undefined = state.data;
  const { formatSpeed, formatTemperature, unitPrefs } = useUnits();

  const columns: Column<ScienceWeatherPoint>[] = [
    { key: 'drive', header: t('science.weather.drive', 'Drive'), render: (r) =>
      <Link className="underline underline-offset-4" to={`/drives/${r.drive_id}`}>#{r.drive_id}</Link> },
    { key: 'at', header: t('science.weather.at', 'Start'), render: (r) => formatDateTime(r.at) },
    { key: 'temp', header: t('science.weather.temp', 'Temperature'), render: (r) => r.temp_c != null ? formatTemperature(r.temp_c) : unknown(t) },
    { key: 'wind', header: t('science.weather.wind', 'Wind'), render: (r) => (r.wind_mps != null ? formatSpeed(r.wind_mps) : unknown(t)) },
    { key: 'density', header: t('science.weather.density', 'Air density'), render: (r) => r.density_kg_m3 != null ? `${fmtNumber(r.density_kg_m3, 3)} kg/m³` : unknown(t) },
    { key: 'rain', header: t('science.weather.rain', 'Precipitation'), render: (r) => r.precip_mm != null ? `${fmtNumber(r.precip_mm, 1)} mm` : unknown(t) },
    { key: 'session', header: t('science.weather.session', 'Session energy / distance'), render: (r) =>
      r.session_wh_per_m != null ? formatEnergyPerDistance(r.session_wh_per_m, unitPrefs) : unknown(t) },
    {
      key: 'res', header: t('science.weather.residual', 'Residual'),
      render: (r) => r.residual_wh_per_m != null ? formatEnergyPerDistance(r.residual_wh_per_m, unitPrefs) : unknown(t),
    },
  ];

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-weather">
      <PanelTitle>{t('science.weather.title', 'Weather coupling (correlation)')}</PanelTitle>
      <StaleRefreshWarning state={state} />
      {state.status === 'initial' ? (
        <Skeleton className="h-32" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <EmptyState title={t('science.weather.title', 'Weather coupling')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />
      ) : (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.weather_unknown ? 'warning' : 'success'} size="sm">
              {data.weather_unknown
                ? t('science.weather.weatherUnknown', 'weather unknown')
                : t('science.weather.joined', 'joined {{n}} drives', { n: asList(data.points).length })}
            </Badge>
            <Badge variant="neutral" size="sm">
              r(density, residual): {data.density_r != null ? fmtNumber(data.density_r, 2) : unknown(t)}
            </Badge>
            <Badge variant="neutral" size="sm">
              r(wind, residual): {data.wind_r != null ? fmtNumber(data.wind_r, 2) : unknown(t)}
            </Badge>
            <Badge variant="neutral" size="sm">
              {t('science.weather.rainDry', 'rain/dry')}: {fmtNumber(data.rain_n, 0)}/{fmtNumber(data.dry_n, 0)}
            </Badge>
          </div>
          <Text as="p" size="sm" color="secondary">
            {t('science.weather.fitGuide', 'Pearson r requires at least five complete matched drives and variation in both values. An unknown coefficient is not a zero effect; association is not causation.')}
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
    </GlassPanel>
  );
}
