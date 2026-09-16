import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceWeather
} from '@/api/hooks/useScience';
import type {
  ScienceWeather
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
import { unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';

export function WeatherPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceWeather(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceWeather | undefined = state.data;
  const { formatSpeed, formatTemperature, unitPrefs } = useUnits();

  const columns: Column<ScienceWeather['points'][number]>[] = [
    { key: 'drive', header: t('science.weather.drive', 'Drive'), render: (r) => `#${r.drive_id}` },
    { key: 'at', header: t('science.weather.at', 'Start'), render: (r) => formatDateTime(r.at) },
    { key: 'temp', header: t('science.weather.temp', 'Temperature'), render: (r) => formatTemperature(r.temp_c) },
    { key: 'wind', header: t('science.weather.wind', 'Wind'), render: (r) => (r.wind_mps != null ? formatSpeed(r.wind_mps) : unknown(t)) },
    {
      key: 'res', header: t('science.weather.residual', 'Residual'),
      render: (r) => formatEnergyPerDistance(r.residual_wh_per_m, unitPrefs),
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
                : t('science.weather.joined', 'joined {{n}} drives', { n: data.points.length })}
            </Badge>
            <Badge variant="neutral" size="sm">
              ρ(density, residual): {data.density_r != null ? fmtNumber(data.density_r, 2) : unknown(t)}
            </Badge>
            <Badge variant="neutral" size="sm">
              ρ(wind, residual): {data.wind_r != null ? fmtNumber(data.wind_r, 2) : unknown(t)}
            </Badge>
            <Badge variant="neutral" size="sm">
              {t('science.weather.rainDry', 'rain/dry')}: {fmtNumber(data.rain_n, 0)}/{fmtNumber(data.dry_n, 0)}
            </Badge>
          </div>
          {data.points.length > 0 ? (
            <DataTable
              tableId="science:weather"
              columns={columns}
              data={data.points}
              keyExtractor={(r) => `${r.drive_id}`}
              emptyMessage={t('science.empty', 'No fit inputs in this window.')}
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
