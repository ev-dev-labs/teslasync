import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { Text, Button } from '@/components/ui';

import { QueryError, StaleRefreshWarning, DataStateNotice } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';

import { deriveDataState } from '@/api/dataState';
import { analyzeChargeDepartureAlignment } from '../lib/chargeDepartureAlignment';
import { AlignmentStats, AlignmentPairs, observedBounds } from '../components/charge-departure-alignment-modernization';

const CHART_KEY = 'charge-departure-alignment';

function dayLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function ChargeDepartureAlignmentPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const hiddenSeries = useHiddenSeries(CHART_KEY);

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr);
  const sessionsState = deriveDataState(sessionsQuery, { provenance: 'historical' });
  const drivesState = deriveDataState(drivesQuery, { provenance: 'historical' });
  const dataSources = useMemo(
    () => [
      {
        id: 'charging-history',
        label: t('dataSources.labels.chargingHistory', 'Charging history'),
        query: sessionsQuery,
      },
      {
        id: 'drive-history',
        label: t('dataSources.labels.driveHistory', 'Drive history'),
        query: drivesQuery,
      },
    ],
    [drivesQuery, sessionsQuery, t],
  );

  const summary = useMemo(
    () => analyzeChargeDepartureAlignment(sessionsQuery.data ?? [], drivesQuery.data ?? []),
    [sessionsQuery.data, drivesQuery.data],
  );
  const chargeBounds = useMemo(
    () => observedBounds((sessionsQuery.data ?? []).map(session => session.ended_at)),
    [sessionsQuery.data],
  );
  const driveBounds = useMemo(
    () => observedBounds((drivesQuery.data ?? []).map(drive => drive.startTs)),
    [drivesQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.pairs.map((p) => ({
        date: dayLabel(p.chargeEndedMs, i18n.language),
        dwellMin: Math.round(p.dwellS / 60),
        margin: p.readinessMarginPct,
        misaligned: p.flags.length > 0,
      })),
    [summary.pairs, i18n.language],
  );

  // ChartContainer's CSV export only accepts scalar cells, so the boolean
  // misalignment marker (which only drives Cell colouring) is dropped here.
  const exportData = useMemo(
    () => chartData.map(({ misaligned: _misaligned, ...rest }) => rest),
    [chartData],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment')} />;
  }

  const available = sessionsState.hasData && drivesState.hasData;
  const isLoading =
    (!sessionsState.hasData && sessionsQuery.isLoading)
    || (!drivesState.hasData && drivesQuery.isLoading);
  const fatalError = sessionsState.fatalError ?? drivesState.fatalError;
  const missingReason = t(
    'chargeDepartureAlignment.modernization.pending',
    'Both charging and drive history must be loaded before pairings can be evaluated.',
  );
  const retained = available && (
    sessionsState.refreshError != null || drivesState.refreshError != null
    || sessionsState.isRefreshBlocked || drivesState.isRefreshBlocked
  );
  const sourceEntries = [
    {
      id: 'charging-history', state: sessionsState,
      label: t('dataSources.labels.chargingHistory', 'Charging history'),
      query: sessionsQuery, bounds: chargeBounds,
      count: sessionsQuery.data?.length,
      boundsLabel: t('chargeDepartureAlignment.modernization.chargeBounds', 'Observed charge-end timestamps'),
    },
    {
      id: 'drive-history', state: drivesState,
      label: t('dataSources.labels.driveHistory', 'Drive history'),
      query: drivesQuery, bounds: driveBounds,
      count: drivesQuery.data?.length,
      boundsLabel: t('chargeDepartureAlignment.modernization.driveBounds', 'Observed drive-start timestamps'),
    },
  ];

  return (
    <PageLayout
      title={t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment')}
      subtitle={t(
        'chargeDepartureAlignment.subtitle',
        'How well each charge matched the very next drive \u2014 a temporal pairing, never proof of intent',
      )}
      query={[sessionsQuery, drivesQuery]}
      dataSources={dataSources}
      busy={sessionsState.isRefreshing || drivesState.isRefreshing}
      className="w-full min-w-0"
    >
      {/* Recovery belongs to each source; retained arrays never become fatal errors. */}
      {sourceEntries.map(({ id, state, label, query }) => (
        <div key={id} data-alignment-source={id}>
          <StaleRefreshWarning state={state} label={label} />
          {state.fatalError && <QueryError
            error={state.fatalError} resourceName={label}
            onRetry={() => { void query.refetch(); }}
          />}
          {!state.hasData && state.isRefreshBlocked && !state.fatalError && (
            <DataStateNotice state="stale" title={label}>
              <Text as="p" variant="bodySm">{t(
                'chargeDepartureAlignment.modernization.paused',
                'History loading is paused. Connect to resume or retry this source.',
              )}</Text>
              <Button variant="secondary" onClick={() => { void query.refetch(); }}>
                {t('error.retry', 'Retry')}
              </Button>
            </DataStateNotice>
          )}
        </div>
      ))}
      {/* 1 — KPI band */}
      <FadeIn>
        <AlignmentStats
          summary={available ? summary : undefined}
          loading={isLoading} retained={retained} missingReason={missingReason}
          historyContext={
            <dl className="grid min-w-0 gap-3 @xl:grid-cols-2">
              {sourceEntries.map(({ id, label, count, bounds, boundsLabel }) => (
                <div key={id} className="min-w-0 space-y-1 break-words" data-alignment-bounds={id}>
                  <dt>{label}</dt>
                  <dd>{t('chargeDepartureAlignment.modernization.loaded', '{{count}} records loaded', {
                    count: count ?? undefined,
                    replace: { count: count ?? '—' },
                  })}</dd>
                  <dd>{boundsLabel}: {bounds != null
                    ? t('chargeDepartureAlignment.modernization.bounds', '{{first}} → {{last}} ({{count}} valid timestamps)', {
                      first: new Date(bounds.first).toLocaleString(i18n.language),
                      last: new Date(bounds.last).toLocaleString(i18n.language),
                      count: bounds.count,
                    })
                    : t('chargeDepartureAlignment.modernization.noBounds', 'No valid observed timestamps available.')}</dd>
                </div>
              ))}
            </dl>
          }
        />
      </FadeIn>

      {/* 2 — Dwell and readiness margin over time */}
      <FadeIn delay={0.1}>
          <ChartContainer
            title={t('chargeDepartureAlignment.chart', 'Dwell Time vs. Readiness Margin')}
            subtitle={t('chargeDepartureAlignment.chartHint', 'Bars are minutes parked after charging; the line is SoC left after that drive')}
            ariaLabel={t(
              'chargeDepartureAlignment.chartAria',
              'Bar chart of post-charge dwell minutes with a line showing the readiness margin left after the paired drive',
            )}
            chartKey={CHART_KEY}
            loading={isLoading}
            error={fatalError}
            onRetry={() => {
              if (sessionsState.fatalError) void sessionsQuery.refetch();
              if (drivesState.fatalError) void drivesQuery.refetch();
            }}
            empty={chartData.length === 0}
            emptyMessage={!available ? missingReason : t(
              'chargeDepartureAlignment.noData',
              'No charge could be paired with a following drive within 24 hours yet.',
            )}
            emptyIcon={<Link2 className="h-8 w-8" />}
            className="w-full min-w-0"
            height={340}
            data={exportData}
            exportData={exportData}
            dataColumns={[
              { key: 'date', label: t('chargeDepartureAlignment.col.date', 'Date') },
              { key: 'dwellMin', label: t('chargeDepartureAlignment.col.dwell', 'Dwell (min)') },
              { key: 'margin', label: t('chargeDepartureAlignment.col.margin', 'Readiness margin (%)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis yAxisId="dwell" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis yAxisId="margin" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hiddenSeries} />
                <Bar
                  yAxisId="dwell"
                  dataKey="dwellMin"
                  name={t('chargeDepartureAlignment.col.dwell', 'Dwell (min)')}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries.isHidden('dwellMin')}
                >
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.misaligned ? chartTokens.series[3] : chartTokens.series[0]}
                      fillOpacity={d.misaligned ? 1 : 0.7}
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="margin"
                  type="monotone"
                  dataKey="margin"
                  name={t('chargeDepartureAlignment.col.margin', 'Readiness margin (%)')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  dot
                  hide={hiddenSeries.isHidden('margin')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
      </FadeIn>

      {/* 3 — Pair detail */}
      <FadeIn delay={0.2}>
        <AlignmentPairs pairs={summary.pairs} loading={isLoading} available={available} missingReason={missingReason} />
      </FadeIn>
    </PageLayout>
  );
}
