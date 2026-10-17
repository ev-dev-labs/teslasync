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
import { ChartSkeleton, DataSourceNotice, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { gaugeTone, typography } from '@/lib/tokens';
import { convertDurationFromSI } from '@/lib/unitConversion';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type ArrivalPreset = 'now' | 60 | 120 | 180;

const PRESETS: ArrivalPreset[] = ['now', 60, 120, 180];

function waitMinutes(seconds: unknown): number | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? convertDurationFromSI(seconds, 'min')
    : null;
}

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
  if (busyness >= 75) return gaugeTone.danger;
  if (busyness >= 50) return gaugeTone.warning;
  if (busyness >= 25) return gaugeTone.info;
  return gaugeTone.success;
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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const verdictLabel = (verdict: string) => {
    switch (verdict) {
      case 'quiet': return t('wait_oracle.verdict.quiet', 'Quiet');
      case 'steady': return t('wait_oracle.verdict.steady', 'Steady');
      case 'busy': return t('wait_oracle.verdict.busy', 'Busy');
      case 'packed': return t('wait_oracle.verdict.packed', 'Packed');
      default: return verdict;
    }
  };
  const confidenceLabel = (confidence: string) => {
    switch (confidence) {
      case 'high': return t('wait_oracle.confidenceLevels.high', 'High');
      case 'medium': return t('wait_oracle.confidenceLevels.medium', 'Medium');
      case 'low': return t('wait_oracle.confidenceLevels.low', 'Low');
      default: return confidence;
    }
  };
  const [site, setSite] = useState<string | null>(null);
  const [preset, setPreset] = useState<ArrivalPreset>('now');
  const [custom, setCustom] = useState('');

  const sitesQuery = useWaitOracleSites();
  const sitesState = useDataState(sitesQuery);
  const sites = useMemo(() => sitesState.data ?? [], [sitesState.data]);
  const activeSite = site ?? sites[0]?.name ?? null;

  const arriveAt = useMemo(() => {
    if (custom) return toIsoOrNull(custom);
    if (preset === 'now') return null;
    return new Date(Date.now() + preset * 60_000).toISOString();
  }, [custom, preset]);

  const forecastQuery = useWaitOracleForecast(activeSite, arriveAt);
  const forecastState = useDataState(forecastQuery);
  const forecast = forecastState.data ?? null;
  const expectedWait = waitMinutes(forecast?.expected_wait_s);
  const savedWait = waitMinutes(forecast?.save_s);
  const sitesEmpty = sitesState.hasData && sites.length === 0;
  const waitingForSites = !sitesState.hasData;
  const pendingQuery = waitingForSites ? sitesQuery : forecastQuery;
  const pendingState = waitingForSites ? sitesState : forecastState;
  const loading = !pendingState.hasData && !pendingState.isRefreshBlocked
    && (pendingQuery.isLoading || pendingQuery.isFetching);
  const fallbackLabel = pendingState.isRefreshBlocked
    ? t('dataSources.status.paused', 'Refresh paused')
    : pendingState.fatalError
      ? t('dataState.unavailable.title', 'Service unavailable')
      : t('common.unknown', 'Unknown');

  const chartData = useMemo(
    () =>
      (forecast?.hours ?? []).map((h) => ({
        hour: h.hour,
        label: `${String(h.hour).padStart(2, '0')}:00`,
        wait: waitMinutes(h.expected_wait_s),
        busyness: h.busyness,
      })),
    [forecast?.hours],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Icons.clock className={`h-4 w-4 ${typography.color.secondary}`} aria-hidden="true" />
        {t('wait_oracle.title', 'Supercharger Wait Oracle')}
      </PanelTitle>
      <Text as="p" size="sm" color="secondary" className="mb-4">
        {t(
          'wait_oracle.subtitle',
          'Expected queue wait per site and arrival time, predicted from your fleet charging history. All hours UTC.',
        )}
      </Text>

      <div className="mb-4 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
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
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label={t('wait_oracle.arrival', 'Arrival')}>
            {PRESETS.map((p) => (
              <Button
                key={String(p)}
                variant={preset === p && !custom ? 'primary' : 'ghost'}
                size="sm"
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                aria-pressed={preset === p && !custom}
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
            className="min-h-11 md:min-h-10"
            aria-label={t('wait_oracle.customArrival', 'Custom arrival')}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
      </div>

      <StaleRefreshWarning
        state={sitesState}
        label={t('wait_oracle.site', 'Site')}
        data-last-success-at={sitesState.updatedAt ?? undefined}
        className="mb-3"
      />
      {activeSite != null && (
        <StaleRefreshWarning
          state={forecastState}
          label={t('wait_oracle.title', 'Supercharger Wait Oracle')}
          data-last-success-at={forecastState.updatedAt ?? undefined}
          className="mb-3"
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          {!sitesState.hasData && sitesState.isRefreshBlocked ? (
            <DataSourceNotice sources={[{
              id: 'wait-oracle-sites',
              label: t('wait_oracle.site', 'Site'),
              query: sitesQuery,
            }]} />
          ) : !sitesState.hasData && (sitesQuery.isLoading || sitesQuery.isFetching) ? (
            <ChartSkeleton
              className="h-[220px]"
              label={t('wait_oracle.loadingSites', 'Loading sites…')}
            />
          ) : sitesState.fatalError ? (
            <QueryError error={sitesState.fatalError} onRetry={() => sitesState.retry?.()} />
          ) : sitesEmpty ? (
            <EmptyState /* no-action: informational empty — no CTA */
              icon={<Icons.location className="h-10 w-10" />}
              message={t(
                'wait_oracle.noSites',
                'No named sites yet. Sync fleet charging sessions to build wait forecasts.',
              )}
            />
          ) : waitingForSites ? (
            <EmptyState /* no-action: unresolved source */
              message={t('common.unknown', 'Unknown')}
            />
          ) : !forecastState.hasData && forecastState.isRefreshBlocked ? (
            <DataSourceNotice sources={[{
              id: 'wait-oracle-forecast',
              label: t('wait_oracle.title', 'Supercharger Wait Oracle'),
              query: forecastQuery,
            }]} />
          ) : !forecastState.hasData && (forecastQuery.isLoading || forecastQuery.isFetching) ? (
            <ChartSkeleton
              className="h-[220px]"
              label={t('wait_oracle.loadingForecast', 'Forecasting wait…')}
            />
          ) : forecastState.fatalError ? (
            <QueryError error={forecastState.fatalError} onRetry={() => forecastState.retry?.()} />
          ) : forecast ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Text as="span" size="xl" className="font-semibold tabular-nums">
                {expectedWait == null
                  ? t('common.unknown', 'Unknown')
                  : t('wait_oracle.expectedWait', '{{min}} min expected wait', {
                    min: fmtNumber(expectedWait),
                  })}
              </Text>
              <Badge variant={verdictVariant(forecast.verdict)}>{verdictLabel(forecast.verdict)}</Badge>
              <Badge variant="neutral">
                {t('wait_oracle.confidence', '{{level}} confidence', {
                  level: confidenceLabel(forecast.confidence),
                })}
              </Badge>
            </div>
            <Text as="p" size="sm" color="secondary" className="mt-2">
              {t('wait_oracle.waitProb', '{{pct}}% chance of any wait · ~{{stalls}} stalls', {
                pct: fmtNumber(forecast.wait_probability_pct),
                stalls: forecast.stalls_estimated,
              })}
            </Text>
            {savedWait != null && savedWait >= 1 ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--semantic-info-border)] bg-[var(--semantic-info-bg)] p-3">
                <Icons.sparkles className={`mt-0.5 h-4 w-4 shrink-0 ${typography.color.secondary}`} aria-hidden="true" />
                <Text as="p" size="sm">
                  {t(
                    'wait_oracle.bestHour',
                    'Arrive {{hour}}:00 UTC instead to save ~{{min}} min.',
                    {
                      hour: String(forecast.best_hour_utc).padStart(2, '0'),
                      min: fmtNumber(savedWait),
                    },
                  )}
                </Text>
              </div>
            ) : null}
            <ul className="mt-3 space-y-1">
              {(forecast.evidence ?? []).map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          </div>
          ) : (
            <EmptyState /* no-action: unresolved source */
              message={t('common.unknown', 'Unknown')}
            />
          )}
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
              format: (v) => typeof v === 'number' && Number.isFinite(v)
                ? fmtNumber(v)
                : t('common.unknown', 'Unknown'),
            },
          ]}
          height={220}
          loading={!forecast && loading}
          empty={sitesEmpty || (forecast != null && chartData.length === 0)}
          emptyMessage={t('chart.noData', 'No data available')}
        >
          {forecast ? (
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
          ) : (
            <Text as="p" color="secondary" role="status">{fallbackLabel}</Text>
          )}
        </ChartContainer>
      </div>
    </GlassPanel>
  );
}
