import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useWaitOracleForecast,
  useWaitOracleSites,
  type WaitOracleForecast,
} from '@/api/hooks/useCharging';
import { useDataState } from '@/hooks/useDataState';
import {
  Bar,
  BarChart,
  Cell,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTickSm,
  chartGrid,
} from '@/components/charts';
import { Badge, Button, GlassPanel, Input, PanelTitle, Select, Text } from '@/components/ui';
import { ChartSkeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';

type ArrivalPreset = 'now' | 60 | 120 | 180;

const PRESETS: ArrivalPreset[] = ['now', 60, 120, 180];

function verdictVariant(verdict: WaitOracleForecast['verdict']) {
  switch (verdict) {
    case 'quiet':
      return 'success' as const;
    case 'steady':
      return 'info' as const;
    case 'busy':
      return 'warning' as const;
    default:
      return 'danger' as const;
  }
}

function barFill(busyness: number): string {
  if (busyness >= 75) return '#fb7185';
  if (busyness >= 50) return '#fbbf24';
  if (busyness >= 25) return '#38bdf8';
  return '#34d399';
}

function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Supercharger wait-time oracle: pick a site + arrival, get the expected
 * queue wait predicted from fleet history (Erlang-C over hour-of-week
 * demand), the best nearby arrival hour, and the full-day wait curve.
 */
export function WaitOraclePanel() {
  const { t } = useTranslation();
  const [site, setSite] = useState<string | null>(null);
  const [preset, setPreset] = useState<ArrivalPreset>('now');
  const [custom, setCustom] = useState('');

  const sitesQuery = useWaitOracleSites();
  const sitesState = useDataState(sitesQuery);
  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const activeSite = site ?? sites[0]?.name ?? null;

  const arriveAt = useMemo(() => {
    if (custom) return toIsoOrNull(custom);
    if (preset === 'now') return null;
    return new Date(Date.now() + preset * 60_000).toISOString();
  }, [custom, preset]);

  const forecastQuery = useWaitOracleForecast(activeSite, arriveAt);
  const forecastState = useDataState(forecastQuery);
  const forecast = forecastQuery.data ?? null;

  const chartData = useMemo(
    () =>
      (forecast?.hours ?? []).map((h) => ({
        hour: h.hour,
        label: `${String(h.hour).padStart(2, '0')}:00`,
        wait: (h.expected_wait_s ?? 0) / 60,
        busyness: h.busyness,
      })),
    [forecast?.hours],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Icons.clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('wait_oracle.title', 'Supercharger Wait Oracle')}
      </PanelTitle>
      <Text as="p" size="sm" color="secondary" className="mb-4">
        {t(
          'wait_oracle.subtitle',
          'Expected queue wait per site and arrival time, predicted from your fleet charging history. All hours UTC.',
        )}
      </Text>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Select
          label={t('wait_oracle.site', 'Site')}
          value={activeSite ?? ''}
          options={sites.map((s) => ({
            value: s.name,
            label: `${s.name} (${t('wait_oracle.sessions', '{{count}} sessions', { count: s.sessions })})`,
          }))}
          placeholder={t('wait_oracle.pickSite', 'Select a site')}
          disabled={sitesQuery.isLoading || sites.length === 0}
          onChange={(event) => setSite(event.target.value || null)}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1" role="group" aria-label={t('wait_oracle.arrival', 'Arrival')}>
            {PRESETS.map((p) => (
              <Button
                key={String(p)}
                variant={preset === p && !custom ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setPreset(p);
                  setCustom('');
                }}
              >
                {p === 'now'
                  ? t('wait_oracle.now', 'Now')
                  : t('wait_oracle.plusHours', '+{{hours}}h', { hours: p / 60 })}
              </Button>
            ))}
          </div>
          <Input
            type="datetime-local"
            aria-label={t('wait_oracle.customArrival', 'Custom arrival')}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
      </div>

      {sitesQuery.isLoading ? (
        <ChartSkeleton
          className="h-[220px]"
          label={t('wait_oracle.loadingSites', 'Loading sites…')}
        />
      ) : sitesState.fatalError ? (
        <QueryError error={sitesState.fatalError} onRetry={() => sitesState.retry?.()} />
      ) : sites.length === 0 ? (
        <EmptyState
          icon={<Icons.location className="h-10 w-10" />}
          message={t(
            'wait_oracle.noSites',
            'No named sites yet. Sync fleet charging sessions to build wait forecasts.',
          )}
        />
      ) : forecastQuery.isLoading ? (
        <ChartSkeleton
          className="h-[220px]"
          label={t('wait_oracle.loadingForecast', 'Forecasting wait…')}
        />
      ) : forecastState.fatalError ? (
        <QueryError error={forecastState.fatalError} onRetry={() => forecastState.retry?.()} />
      ) : forecast ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Text as="span" size="xl" className="font-semibold tabular-nums">
                {t('wait_oracle.expectedWait', '{{min}} min expected wait', {
                  min: fmtNumber((forecast.expected_wait_s ?? 0) / 60, 0),
                })}
              </Text>
              <Badge variant={verdictVariant(forecast.verdict)}>{forecast.verdict}</Badge>
              <Badge variant="neutral">
                {t('wait_oracle.confidence', '{{level}} confidence', {
                  level: forecast.confidence,
                })}
              </Badge>
            </div>
            <Text as="p" size="sm" color="secondary" className="mt-2">
              {t('wait_oracle.waitProb', '{{pct}}% chance of any wait · ~{{stalls}} stalls', {
                pct: fmtNumber(forecast.wait_probability_pct, 0),
                stalls: forecast.stalls_estimated,
              })}
            </Text>
            {(forecast.save_s ?? 0) >= 60 ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <Icons.sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <Text as="p" size="sm">
                  {t(
                    'wait_oracle.bestHour',
                    'Arrive {{hour}}:00 UTC instead to save ~{{min}} min.',
                    {
                      hour: String(forecast.best_hour_utc).padStart(2, '0'),
                      min: fmtNumber((forecast.save_s ?? 0) / 60, 0),
                    },
                  )}
                </Text>
              </div>
            ) : null}
            <ul className="mt-3 space-y-1">
              {forecast.evidence.map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          </div>
          <ChartContainer
            title={t('wait_oracle.chart.title', 'Wait across the arrival day (UTC)')}
            ariaLabel={t('wait_oracle.chart.aria', 'Expected wait minutes by hour of day')}
            data={chartData}
            dataColumns={[
              { key: 'label', label: t('wait_oracle.chart.col.hour', 'Hour (UTC)') },
              {
                key: 'wait',
                label: t('wait_oracle.chart.col.wait', 'Expected wait (min)'),
                format: (v) => fmtNumber(v as number, 1),
              },
            ]}
            height={220}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                {chartGrid}
                <XAxis dataKey="label" tick={axisTickSm} interval={2} />
                <YAxis tick={axisTickSm} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="wait" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.hour} fill={barFill(entry.busyness)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      ) : null}
    </GlassPanel>
  );
}
